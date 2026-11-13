/**
 * Start or read a public MP4 backfill run (#1182, api-videos lib/media/mp4-backfill.ts).
 *
 *   node --experimental-strip-types scripts/release/mp4-backfill.ts start --env qa            # dry run: lists candidates
 *   node --experimental-strip-types scripts/release/mp4-backfill.ts start --env qa --apply    # queues remux-only jobs
 *   node --experimental-strip-types scripts/release/mp4-backfill.ts status --env qa --run <runId> [--json]
 *
 * `start` sends page 0 to the env's processing-check queue (Cloudflare Queues API); api-videos pages
 * through media_jobs, reads each record and (with --apply) queues one remux-only job per rendition
 * without the MP4 on the transcode queue (apps/media). The run, with one line per video, is in
 * global_settings ops/mp4-backfill/runs/<runId>.json, which `status` reads (R2 API). Needs
 * CLOUDFLARE_API_TOKEN (or a wrangler login) with Queues write and R2 read.
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

async function main(): Promise<void> {
  const command = process.argv[2];
  const env = arg('env') as EnvName | undefined;
  if (!env || !(env in ENVS)) throw new Error(`--env must be one of ${Object.keys(ENVS).join(', ')}`);
  const target = ENVS[env];

  if (command === 'start') {
    const apply = process.argv.includes('--apply');
    const runId = `mp4-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const message = { kind: 'mp4-backfill', runId, page: 0, cursor: null, dryRun: !apply, limit: Number(arg('limit') ?? 20) };
    const res = await cf(`/queues/${await queueId(target.queue)}/messages`, { method: 'POST', body: JSON.stringify({ body: message, content_type: 'json' }) });
    if (!res.ok) throw new Error(`Queue send failed: ${res.status} ${await res.text()}`);
    process.stdout.write(`${apply ? 'APPLY' : 'dry run'} started on ${env}: ${runId}\nstatus: node --experimental-strip-types scripts/release/mp4-backfill.ts status --env ${env} --run ${runId}\n`);
    return;
  }

  if (command === 'status') {
    const runId = arg('run');
    if (!runId) throw new Error('--run <runId> is required');
    const res = await cf(`/r2/buckets/${target.bucket}/objects/${encodeURIComponent(`ops/mp4-backfill/runs/${runId}.json`)}`);
    if (res.status === 404) {
      process.stdout.write('not started yet (no run file): the first page has not run\n');
      return;
    }
    if (!res.ok) throw new Error(`R2 read failed: ${res.status} ${await res.text()}`);
    const run = (await res.json()) as {
      status: string;
      dryRun: boolean;
      totals: Record<string, number>;
      pages: Record<string, unknown>;
      items: { id: string; title: string | null; state: string; access: string | null; rev: string | null; mp4Rung: string | null; public: boolean; action: string }[];
    };
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ status: run.status, dryRun: run.dryRun, pages: Object.keys(run.pages).length, totals: run.totals }, null, 2)}\n`);
    for (const i of run.items) {
      process.stdout.write(`${[env, i.id, i.state, i.action, i.access ?? '-', i.rev ?? '-', i.mp4Rung ?? '-', i.public ? 'public' : 'not-public', (i.title ?? '').slice(0, 60)].join('\t')}\n`);
    }
    return;
  }

  throw new Error('usage: mp4-backfill.ts start|status --env qa|stage|production [--apply] [--run <id>]');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
