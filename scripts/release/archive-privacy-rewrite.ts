/**
 * Start or read the one-off pseudonymisation of the queue-message archive (#1177, api-videos
 * lib/archivePrivacyRewrite.ts).
 *
 *   node --experimental-strip-types scripts/release/archive-privacy-rewrite.ts start --env qa            # dry run
 *   node --experimental-strip-types scripts/release/archive-privacy-rewrite.ts start --env qa --apply    # writes
 *   node --experimental-strip-types scripts/release/archive-privacy-rewrite.ts status --env qa --run <runId>
 *
 * `start` sends the run's first message to the env's processing-check queue (Cloudflare Queues API);
 * api-videos lists the archive one prefix (one day, or one analytics prefix) at a time in a few
 * lanes (--lanes, default 4, max 8) and records counts in global_settings
 * ops/archive-privacy/runs/<runId>/, which `status` reads (R2 API). A dry run counts what it would
 * rewrite or delete and writes nothing. Needs CLOUDFLARE_API_TOKEN (or a wrangler login) with Queues
 * write and R2 read.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '0e4b6e7f9faf280c3c9bf95995edc64f';
const ENVS = {
  qa: { queue: 'al-ummah-now-processing-check-qa', bucket: 'global-settings-qa' },
  stage: { queue: 'al-ummah-now-processing-check-stage', bucket: 'global-settings-stage' },
  production: { queue: 'al-ummah-now-processing-check', bucket: 'global-settings' },
} as const;
type EnvName = keyof typeof ENVS;
const COUNTS = ['listed', 'stamped', 'clean', 'rewritten', 'deleted', 'unreadable'] as const;

function token(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const file of [join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), join(homedir(), '.wrangler/config/default.toml'), join(homedir(), '.config/.wrangler/config/default.toml')]) {
    if (!existsSync(file)) continue;
    const match = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(file, 'utf8'));
    if (match) return match[1];
  }
  throw new Error('No Cloudflare token: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
}

async function cf(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function queueId(name: string): Promise<string> {
  const res = await cf(`/queues?per_page=100`);
  const body = (await res.json()) as { result?: Array<{ queue_id: string; queue_name: string }> };
  const found = body.result?.find((q) => q.queue_name === name);
  if (!found) throw new Error(`Queue ${name} not found (${res.status})`);
  return found.queue_id;
}

async function readJson<T>(bucket: string, key: string): Promise<T | null> {
  const res = await cf(`/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 read failed (${key}): ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Counts = Record<(typeof COUNTS)[number], number>;

async function main(): Promise<void> {
  const command = process.argv[2];
  const env = arg('env') as EnvName | undefined;
  if (!env || !(env in ENVS)) throw new Error(`--env must be one of ${Object.keys(ENVS).join(', ')}`);
  const target = ENVS[env];

  if (command === 'start') {
    const apply = process.argv.includes('--apply');
    const runId = `archive-privacy-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const message = {
      kind: 'archive-privacy-rewrite',
      runId,
      lane: 0,
      prefixIndex: 0,
      cursor: null,
      start: { dryRun: !apply, lanes: Number(arg('lanes') ?? 4), limit: Number(arg('limit') ?? 100) },
    };
    const res = await cf(`/queues/${await queueId(target.queue)}/messages`, { method: 'POST', body: JSON.stringify({ body: message, content_type: 'json' }) });
    if (!res.ok) throw new Error(`Queue send failed: ${res.status} ${await res.text()}`);
    process.stdout.write(`${apply ? 'APPLY' : 'dry run'} started on ${env}: ${runId}\nstatus: node --experimental-strip-types scripts/release/archive-privacy-rewrite.ts status --env ${env} --run ${runId}\n`);
    return;
  }

  if (command === 'status') {
    const runId = arg('run');
    if (!runId) throw new Error('--run <runId> is required');
    const prefix = `ops/archive-privacy/runs/${runId}`;
    const meta = await readJson<{ dryRun: boolean; lanes: number; prefixes: string[]; startedAt: string; key: string | null }>(target.bucket, `${prefix}/meta.json`);
    if (!meta) {
      process.stdout.write('not started yet (no meta): the first message has not run\n');
      return;
    }
    const totals = Object.fromEntries(COUNTS.map((k) => [k, 0])) as Counts;
    const nonEmpty: Record<string, Counts> = {};
    const lanes: Array<{ lane: number; status: string; prefixesDone: number; updatedAt: string }> = [];
    for (let lane = 0; lane < meta.lanes; lane++) {
      const state = await readJson<{ status: string; updatedAt: string; prefixes: Record<string, Counts> }>(target.bucket, `${prefix}/lane-${lane}.json`);
      if (!state) continue;
      lanes.push({ lane, status: state.status, prefixesDone: Object.keys(state.prefixes).length, updatedAt: state.updatedAt });
      for (const [p, counts] of Object.entries(state.prefixes)) {
        for (const k of COUNTS) totals[k] += counts[k] ?? 0;
        if (counts.listed > 0) nonEmpty[p] = counts;
      }
    }
    const done = lanes.length === meta.lanes && lanes.every((l) => l.status === 'done');
    const out = { dryRun: meta.dryRun, done, keyHeld: meta.key !== null, startedAt: meta.startedAt, prefixes: meta.prefixes.length, lanes, totals, ...(process.argv.includes('--by-prefix') ? { byPrefix: nonEmpty } : {}) };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  throw new Error('usage: archive-privacy-rewrite.ts start|status --env qa|stage|production [--apply] [--lanes n] [--run <id>] [--by-prefix]');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
