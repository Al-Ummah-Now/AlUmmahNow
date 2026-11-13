/**
 * Start or read a publishedAt backfill run (api-videos lib/publishedAtBackfill.ts).
 *
 *   node --experimental-strip-types scripts/release/published-at-backfill.ts start --env qa            # dry run
 *   node --experimental-strip-types scripts/release/published-at-backfill.ts start --env qa --apply    # writes
 *   node --experimental-strip-types scripts/release/published-at-backfill.ts status --env qa --run <runId>
 *
 * `start` sends page 0 to the env's processing-check queue (Cloudflare Queues API); api-videos pages
 * through the videos bucket and records the run in global_settings ops/published-at/runs/<runId>.json,
 * which `status` reads (R2 API). A dry run counts and writes nothing. Needs CLOUDFLARE_API_TOKEN (or
 * a wrangler login) with Queues write and R2 read.
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
    const runId = `published-at-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const message = { kind: 'published-at-backfill', runId, page: 0, cursor: null, dryRun: !apply, limit: Number(arg('limit') ?? 50) };
    const res = await cf(`/queues/${await queueId(target.queue)}/messages`, { method: 'POST', body: JSON.stringify({ body: message, content_type: 'json' }) });
    if (!res.ok) throw new Error(`Queue send failed: ${res.status} ${await res.text()}`);
    process.stdout.write(`${apply ? 'APPLY' : 'dry run'} started on ${env}: ${runId}\nstatus: node --experimental-strip-types scripts/release/published-at-backfill.ts status --env ${env} --run ${runId}\n`);
    return;
  }

  if (command === 'status') {
    const runId = arg('run');
    if (!runId) throw new Error('--run <runId> is required');
    const res = await cf(`/r2/buckets/${target.bucket}/objects/${encodeURIComponent(`ops/published-at/runs/${runId}.json`)}`);
    if (res.status === 404) {
      process.stdout.write('not started yet (no run file): the first page has not run\n');
      return;
    }
    if (!res.ok) throw new Error(`R2 read failed: ${res.status} ${await res.text()}`);
    const run = (await res.json()) as { status: string; dryRun: boolean; totals: Record<string, number>; pages: Record<string, unknown> };
    process.stdout.write(`${JSON.stringify({ status: run.status, dryRun: run.dryRun, pages: Object.keys(run.pages).length, totals: run.totals }, null, 2)}\n`);
    return;
  }

  throw new Error('usage: published-at-backfill.ts start|status --env qa|stage|production [--apply] [--run <id>]');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
