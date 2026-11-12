/**
 * End-of-job leftover check for a deployed run (QA/stage): nothing this run created may be left
 * (owner rule: test sets clean up every resource they use).
 *
 *   node --experimental-strip-types --no-warnings scripts/e2e/run-leftovers.ts --env qa --marker "$E2E_RUN_ID" --collect-ids   # before the accounts are deleted
 *   node --experimental-strip-types --no-warnings scripts/e2e/run-leftovers.ts --env qa --marker "$E2E_RUN_ID" [--user-ids-file <path> ...]
 *
 * --collect-ids appends the run accounts' ids to E2E_RUN_USER_IDS_FILE and exits: the workflow runs
 * it before its teardown deletes the accounts, so the check afterwards still knows whose rows to look for.
 *
 * A few targeted queries (QA's D1 serves one query at a time: no table scans):
 * - auth D1: users whose email is e2e+<marker>-… (the run accounts; not yet deleted);
 * - search D1 content_ownership: videos, channels, playlists and posts owned by a run user (the
 *   ownership index mirrors every R2 write; a video row left means its Bunny video is left too),
 *   except those already deleted with their purge queued (admin_deletions: the purge job removes
 *   media and Bunny video; reported, not failed);
 * - search D1 creator_tier_assignments of run users;
 * - QA only, through a read-only probe worker (scripts/e2e/leftovers-probe, Bunny key from the
 *   Secrets Store, never on the runner): the QA library's videos and collections whose title holds
 *   the run id, and R2 objects under the run's video ids (recorded by builders.ts in
 *   E2E_RUN_RESOURCES_FILE, plus those Bunny videos): thumbnails, renditions, originals, src/ parts.
 *   A video whose purge is queued is allowed (grace), reported.
 * Run users = the auth lookup plus E2E_RUN_USER_IDS_FILE / --user-ids-file (ids recorded while the
 * accounts existed). Exits 1 when anything is left. Read-only: it never deletes anything.
 * Needs CLOUDFLARE_API_TOKEN (D1 read); without it, warns and exits 0.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createCfClient, d1Query } from '../release/cf-api.ts';
import { DATABASES, type UploadEnv } from '../release/upload-budget.ts';

const MARKER = /^\d{1,20}-\d{1,3}$/;
const SAFE_ID = /^[A-Za-z0-9_:-]{6,128}$/;

export interface Leftovers {
  accounts: string[];
  content: { kind: string; id: string; owner: string; state: string }[];
  pendingPurge: { kind: string; id: string }[];
  tiers: string[];
  /** QA Bunny library: videos and collections whose title/name holds the run id (probe) */
  bunnyVideos: { guid: string; title: string; status: number }[];
  bunnyCollections: { guid: string; name: string }[];
  /** QA R2 objects under the run's video ids (probe) */
  r2Objects: { bucket: string; key: string }[];
}

/** Resources recorded while the run made them (builders.ts: "<kind> <id>" per line). */
export function readResources(text: string): { videos: string[]; channels: string[] } {
  const videos = new Set<string>();
  const channels = new Set<string>();
  for (const line of text.split('\n')) {
    const [kind, id] = line.trim().split(/\s+/);
    if (!id || !/^[A-Za-z0-9_:-]{6,128}$/.test(id)) continue;
    if (kind === 'video') videos.add(id);
    if (kind === 'channel') channels.add(id);
  }
  return { videos: [...videos], channels: [...channels] };
}

/** Bunny videos and R2 objects of a video whose purge is queued are allowed (the purge job removes them). */
export function applyPurgeGrace(l: Leftovers, purging: Set<string>): { allowed: number } {
  const before = l.bunnyVideos.length + l.r2Objects.length;
  l.bunnyVideos = l.bunnyVideos.filter((v) => !purging.has(v.guid));
  l.r2Objects = l.r2Objects.filter((o) => ![...purging].some((id) => o.key.includes(`${id}/`)));
  return { allowed: before - l.bunnyVideos.length - l.r2Objects.length };
}

export function failing(l: Leftovers): number {
  return l.accounts.length + l.content.length + l.tiers.length + l.bunnyVideos.length + l.bunnyCollections.length + l.r2Objects.length;
}

export function parseArgs(argv: string[]): { env: UploadEnv; marker: string; idFiles: string[] } {
  const value = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
  const env = (value('--env')[0] ?? 'qa') as UploadEnv;
  if (env !== 'qa' && env !== 'stage') throw new Error(`--env must be qa or stage (never production), got ${env}`);
  const marker = value('--marker')[0] ?? process.env.E2E_RUN_ID ?? '';
  if (!MARKER.test(marker)) throw new Error(`--marker must be a run id (<run>-<attempt>), got ${JSON.stringify(marker)}`);
  return { env, marker, idFiles: [...value('--user-ids-file'), ...(process.env.E2E_RUN_USER_IDS_FILE ? [process.env.E2E_RUN_USER_IDS_FILE] : [])] };
}

export function report(marker: string, l: Leftovers): string[] {
  return [
    `Leftovers of run ${marker}: ${failing(l)}${l.pendingPurge.length ? ` (+${l.pendingPurge.length} deleted, purge queued)` : ''}`,
    ...l.accounts.map((a) => `  - auth account ${a}`),
    ...l.content.map((c) => `  - ${c.kind} ${c.id} of ${c.owner} (${c.state})`),
    ...l.tiers.map((t) => `  - creator tier of ${t}`),
    ...l.bunnyVideos.map((v) => `  - Bunny video ${v.guid} (status ${v.status}): ${v.title}`),
    ...l.bunnyCollections.map((c) => `  - Bunny collection ${c.guid}: ${c.name}`),
    ...l.r2Objects.slice(0, 40).map((o) => `  - R2 ${o.bucket}/${o.key}`),
    ...l.pendingPurge.slice(0, 20).map((p) => `  · ${p.kind} ${p.id}: purge queued`),
  ];
}

async function main(): Promise<void> {
  const { env, marker, idFiles } = parseArgs(process.argv.slice(2));
  let cf;
  try {
    cf = createCfClient();
  } catch (error) {
    process.stdout.write(`::warning::leftover check skipped: ${(error as Error).message}\n`);
    return;
  }
  const db = DATABASES[env];
  const accounts = await d1Query<{ id: string; email: string }>(cf, db.auth, "SELECT id, email FROM users WHERE email LIKE ? AND deleted_at IS NULL", [`e2e+${marker}-%`]);
  if (process.argv.includes('--collect-ids')) {
    const file = process.env.E2E_RUN_USER_IDS_FILE;
    if (!file) throw new Error('--collect-ids needs E2E_RUN_USER_IDS_FILE');
    for (const a of accounts) appendFileSync(file, `${a.id}\n`);
    process.stdout.write(`recorded ${accounts.length} run account ids\n`);
    return;
  }
  const recorded = idFiles.filter((f) => existsSync(f)).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()));
  const ids = [...new Set([...accounts.map((a) => a.id), ...recorded])].filter((id) => SAFE_ID.test(id));
  const leftovers: Leftovers = { accounts: accounts.map((a) => a.email), content: [], pendingPurge: [], tiers: [], bunnyVideos: [], bunnyCollections: [], r2Objects: [] };
  const resourceFile = process.env.E2E_RUN_RESOURCES_FILE;
  const resources = readResources(resourceFile && existsSync(resourceFile) ? readFileSync(resourceFile, 'utf8') : '');
  if (ids.length) {
    const list = ids.map(() => '?').join(',');
    const owned = await d1Query<{ kind: string; id: string; owner_id: string; is_deleted: number; upload_status: string | null }>(
      cf, db.search, `SELECT kind, id, owner_id, is_deleted, upload_status FROM content_ownership WHERE owner_id IN (${list})`, ids,
    );
    const purging = new Set(
      (await d1Query<{ kind: string; target_id: string }>(cf, db.search, `SELECT kind, target_id FROM admin_deletions WHERE owner_id IN (${list}) AND purge_requested_at IS NOT NULL`, ids))
        .map((r) => `${r.kind}:${r.target_id}`),
    );
    for (const row of owned) {
      if (purging.has(`${row.kind}:${row.id}`)) leftovers.pendingPurge.push({ kind: row.kind, id: row.id });
      else leftovers.content.push({ kind: row.kind, id: row.id, owner: row.owner_id, state: row.is_deleted ? 'in the trash, no purge' : row.upload_status ?? 'live' });
    }
    leftovers.tiers = (await d1Query<{ user_id: string }>(cf, db.search, `SELECT user_id FROM creator_tier_assignments WHERE user_id IN (${list})`, ids)).map((r) => r.user_id);
  }
  // QA's Bunny library and R2, through the read-only probe the workflow deployed for this run
  const probe = process.env.LEFTOVERS_PROBE_URL;
  const token = process.env.LEFTOVERS_PROBE_TOKEN;
  if (probe && token && env === 'qa') {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const bunny = await fetch(`${probe}/bunny?marker=${encodeURIComponent(marker)}`, { headers });
    if (!bunny.ok) throw new Error(`probe /bunny answered ${bunny.status}`);
    const found = (await bunny.json()) as { videos: Leftovers['bunnyVideos']; collections: Leftovers['bunnyCollections'] };
    leftovers.bunnyVideos = found.videos;
    leftovers.bunnyCollections = found.collections;
    const videoIds = [...new Set([...resources.videos, ...found.videos.map((v) => v.guid)])];
    if (videoIds.length) {
      const objects = await fetch(`${probe}/r2`, { method: 'POST', headers, body: JSON.stringify({ videoIds }) });
      if (!objects.ok) throw new Error(`probe /r2 answered ${objects.status}`);
      leftovers.r2Objects = ((await objects.json()) as { objects: Leftovers['r2Objects'] }).objects;
      // Grace: the purge of a deleted video removes its Bunny video and media in the background
      const list = videoIds.filter((id) => SAFE_ID.test(id));
      const queued = await d1Query<{ target_id: string }>(
        cf, db.search, `SELECT target_id FROM admin_deletions WHERE kind = 'video' AND target_id IN (${list.map(() => '?').join(',')}) AND purge_requested_at IS NOT NULL`, list,
      );
      const purging = new Set(queued.map((r) => r.target_id));
      for (const id of purging) if (!leftovers.pendingPurge.some((p) => p.id === id)) leftovers.pendingPurge.push({ kind: 'video', id });
      applyPurgeGrace(leftovers, purging);
    }
  } else if (env === 'qa') {
    process.stdout.write('::warning::no leftover probe (LEFTOVERS_PROBE_URL/TOKEN): Bunny and R2 not checked\n');
  }
  const lines = report(marker, leftovers);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Leftovers (${env})\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  if (failing(leftovers) > 0) process.exit(1);
}

if (import.meta.main) await main();
