/**
 * COST-1: credentials sealed by admin-api and opened here, product pulls on API fixtures
 * (Containers GraphQL, Bunny billing, Resend emails), and the job queue: planning, retry with
 * backoff, flagging on the Errors page with Retry, the DLQ backstop and the no-token path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sealCostCredential, openCostCredential, type CostProvider } from '@al-ummah/shared-types';
import { sqliteD1 } from './d1-sqlite';
import { cloudflareToken, storedCredential } from '../src/credentials';
import { bunnyDayRow, countResendEmails, fetchContainers, priceContainers, resendDayRow, BUNNY_BILLING_URL, RESEND_EMAILS_URL } from '../src/products';
import { GRAPHQL_URL } from '../src/graphql';
import { CF_API } from '../src/discover';
import { backoffSeconds, consumeJobs, handleJob, isCostJob, jobKey, MAX_ATTEMPTS, plannedJobs, planJobs, runProductJob, type CostJob, type JobsEnv } from '../src/jobs';
import { runJob } from '../src/index';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
const INTERNAL = 'qa-internal-api-key-0123456789';
const ACCOUNT = '0e4b6e7f9faf280c3c9bf95995edc64f';

async function store(db: D1Database, provider: CostProvider, value: string, key = INTERNAL) {
  const s = await sealCostCredential(provider, value, { INTERNAL_API_KEY: key });
  await db
    .prepare('INSERT INTO cost_credentials (provider, ciphertext, iv, key_id, last4, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(provider, s.ciphertext, s.iv, s.key_id, s.last4, 'admin-1', '2026-11-14T00:00:00Z')
    .run();
}

function jobsEnv(extra: Partial<JobsEnv> = {}): JobsEnv & { posted: Record<string, unknown>[] } {
  return {
    COSTS_DB: sqliteD1(),
    INTERNAL_API_KEY: INTERNAL,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    COLLECT_ENVS: 'production,stage,qa',
    ENVIRONMENT: 'qa',
    ERRORS_INGEST_URL: 'https://admin.api.qa.alummahnow.net/internal/errors',
    posted: [],
    ...extra,
  };
}

/** Routes requests to the fixtures; records error-ingest posts. */
function apiFetch(env: { posted: Record<string, unknown>[] }, opts: { bunnyStatus?: number; containersStatus?: number } = {}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const h = new Headers(init?.headers);
    if (url === `${CF_API}/accounts/${ACCOUNT}/containers/applications`) {
      assert.equal(h.get('Authorization'), 'Bearer cf-admin-token-abcdefghijklmnop');
      return new Response(fixture('containers-apps.json'), { status: opts.containersStatus ?? 200 });
    }
    if (url === GRAPHQL_URL) return new Response(fixture('containers-usage.json'), { status: 200 });
    if (url === BUNNY_BILLING_URL) {
      assert.equal(h.get('AccessKey'), 'bunny-account-key-0123456789abcdef');
      return new Response(opts.bunnyStatus && opts.bunnyStatus !== 200 ? '{}' : fixture('bunny-billing.json'), { status: opts.bunnyStatus ?? 200 });
    }
    if (url.startsWith(RESEND_EMAILS_URL)) {
      return new Response(fixture(url.includes('after=e-0004') ? 'resend-emails-page2.json' : 'resend-emails-page1.json'), { status: 200 });
    }
    if (url.includes('/internal/errors')) {
      env.posted.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 202 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const flush = async (env: { posted: unknown[] }, want = 1) => {
  const until = Date.now() + 2000;
  do await new Promise((r) => setTimeout(r, 20));
  while (env.posted.length < want && Date.now() < until);
};

describe('credentials', () => {
  it('opens what admin-api sealed; a rotated master or another provider row reads as unset', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'cloudflare', 'cf-admin-token-abcdefghijklmnop');
    assert.equal(await storedCredential(env, 'cloudflare'), 'cf-admin-token-abcdefghijklmnop');
    assert.equal(await storedCredential({ ...env, INTERNAL_API_KEY: 'a-different-internal-key-xyz' }, 'cloudflare'), null);
    const sealed = await sealCostCredential('bunny', 'bunny-account-key-0123456789abcdef', { INTERNAL_API_KEY: INTERNAL });
    assert.equal(await openCostCredential({ ...sealed, provider: 'resend' }, { INTERNAL_API_KEY: INTERNAL }), null);
    assert.equal(sealed.last4, 'cdef');
    assert.ok(!sealed.ciphertext.includes('bunny'));
  });

  it('prefers the admin token, falls back to the bound release token, else none', async () => {
    const env = jobsEnv({ CF_ANALYTICS_TOKEN: 'release-token' });
    assert.deepEqual(await cloudflareToken(env), { token: 'release-token', source: 'release' });
    await store(env.COSTS_DB, 'cloudflare', 'cf-admin-token-abcdefghijklmnop');
    assert.equal((await cloudflareToken(env)).source, 'admin');
    assert.deepEqual(await cloudflareToken(jobsEnv()), { token: '', source: 'none' });
  });
});

describe('products', () => {
  it('prices our containers per env from the billing dataset and drops other projects', async () => {
    const env = jobsEnv();
    const rows = await fetchContainers('cf-admin-token-abcdefghijklmnop', ACCOUNT, '2026-11-13', ['production', 'qa'], apiFetch(env));
    const byEnv = Object.fromEntries(rows.map((r) => [r.env, r]));
    assert.deepEqual(Object.keys(byEnv).sort(), ['production', 'qa']);
    // 1440 GiB-s × 0.0000025 + 1200 vCPU-s × 0.00002 + 2000 GB-s × 0.00000007
    assert.equal(byEnv.production.cost, 0.02774);
    assert.equal(byEnv.qa.cost, 0.006935);
    assert.equal(byEnv.production.quantity, 1200);
    assert.equal(priceContainers('2026-11-14', [], new Map()).length, 0);
  });

  it('a token without Containers access gives no rows instead of failing', async () => {
    const env = jobsEnv();
    assert.deepEqual(await fetchContainers('cf-admin-token-abcdefghijklmnop', ACCOUNT, '2026-11-13', ['qa'], apiFetch(env, { containersStatus: 403 })), []);
  });

  it("splits Bunny's month-to-date charges into days that add up to Bunny's figure", () => {
    assert.equal(bunnyDayRow('2026-11-14', 18.4321, 15).cost, 3.4321);
    assert.equal(bunnyDayRow('2026-11-14', 10, 12).cost, 0);
  });

  it('counts the day of Resend emails across pages and prices the plan and overage', async () => {
    const env = jobsEnv();
    const f = apiFetch(env);
    const r = await countResendEmails('re_full_access_key_0123456789', '2026-11-13', f, async () => {});
    assert.deepEqual(r, { count: 3, complete: true });
    assert.equal(f.calls.filter((u) => u.startsWith(RESEND_EMAILS_URL)).length, 2);
    // Free plan: $0; Pro: $20 / 30 days, plus 0.9 per 1,000 over 50,000 in the month
    assert.equal(resendDayRow('2026-11-13', 3, 0, 'free').cost, 0);
    assert.equal(resendDayRow('2026-11-13', 2000, 49_000, 'pro').cost, Math.round((20 / 30 + 0.9) * 1e6) / 1e6);
  });
});

describe('jobs', () => {
  it('the hourly cron plans collection, containers and Bunny; the daily one the final pass and Resend', () => {
    const at = new Date('2026-11-14T03:30:00Z');
    assert.deepEqual(plannedJobs('hourly', at).map((j) => `${j.job}:${j.day ?? ''}`), ['hourly:', 'containers:2026-11-14', 'bunny:2026-11-14']);
    assert.deepEqual(plannedJobs('daily', at).map((j) => `${j.job}:${j.day ?? ''}`), ['daily:', 'containers:2026-11-13', 'bunny:2026-11-13', 'resend:2026-11-13', 'resend:2026-11-14']);
    for (const j of plannedJobs('daily', at)) assert.ok(isCostJob(j));
    assert.equal(isCostJob({ v: 1, job: 'rm -rf', at: 'x' }), false);
    assert.equal(isCostJob({ v: 1, job: ['hourly'], at: at.toISOString() }), false);
    assert.equal(isCostJob({ v: 1, job: 'hourly', at: 'sometime' }), false);
    assert.equal(isCostJob({ v: 1, job: 'resend', at: at.toISOString(), day: '2026-02-30' }), false);
  });

  it('crons only enqueue when the queue is bound', async () => {
    const sent: unknown[] = [];
    const env = jobsEnv({ COST_JOBS_QUEUE: { sendBatch: async (m) => void sent.push(...m) } });
    await planJobs('hourly', new Date('2026-11-14T05:10:00Z'), env, undefined, async () => assert.fail('must not run inline'));
    assert.equal(sent.length, 3);
  });

  it('with no keys at all every job is skipped, nothing is flagged', async () => {
    const env = jobsEnv();
    const f = apiFetch(env);
    for (const job of plannedJobs('daily', new Date('2026-11-14T03:30:00Z'))) {
      assert.equal(await handleJob(job, 1, env, undefined, runJob, f), 'ack');
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(env.posted.length, 0);
    const runs = (await env.COSTS_DB.prepare('SELECT job, status FROM cost_job_runs ORDER BY job').all<{ job: string; status: string }>()).results;
    assert.ok(runs.every((r) => r.status === 'skipped' || r.job === 'daily'), JSON.stringify(runs));
    assert.equal(f.calls.filter((u) => !u.includes('/internal/errors')).length, 0);
    const state = await env.COSTS_DB.prepare("SELECT value FROM cost_settings WHERE key = 'collector'").first<{ value: string }>();
    assert.equal(JSON.parse(state!.value).tokenSource, 'none');
  });

  it('stores Bunny and Containers rows with stored keys (idempotent on re-run)', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'cloudflare', 'cf-admin-token-abcdefghijklmnop');
    await store(env.COSTS_DB, 'bunny', 'bunny-account-key-0123456789abcdef');
    const f = apiFetch(env);
    const now = new Date('2026-11-14T10:10:00Z');
    const job = (kind: CostJob['job'], day: string): CostJob => ({ v: 1, job: kind, at: now.toISOString(), day });
    for (let i = 0; i < 2; i++) {
      assert.equal((await runProductJob(job('containers', '2026-11-13'), env, f, now)).status, 'ok');
      assert.equal((await runProductJob(job('bunny', '2026-11-14'), env, f, now)).status, 'ok');
    }
    const rows = (await env.COSTS_DB.prepare('SELECT day, env, product, cost_usd FROM cost_product_daily ORDER BY product, env').all<{ product: string; env: string; cost_usd: number }>()).results;
    assert.deepEqual(rows.map((r) => `${r.product}:${r.env}:${r.cost_usd}`), ['bunny:account:18.4321', 'containers:production:0.02774', 'containers:qa:0.006935']);
  });

  it('a retryable failure retries with backoff, the last attempt flags the Errors page with Retry', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'bunny', 'bunny-account-key-0123456789abcdef');
    const f = apiFetch(env, { bunnyStatus: 503 });
    const job: CostJob = { v: 1, job: 'bunny', at: '2026-11-14T10:10:00Z', day: '2026-11-14' };
    assert.equal(await handleJob(job, 1, env, undefined, runJob, f), 'retry');
    assert.equal(backoffSeconds(1), 60);
    assert.equal(backoffSeconds(5), 960);
    assert.equal(await handleJob(job, MAX_ATTEMPTS, env, undefined, runJob, f), 'ack');
    await flush(env);
    const action = (env.posted[0] as { events: { action: Record<string, unknown> }[] }).events[0]!.action;
    assert.equal(action.key, jobKey(job));
    assert.equal(action.key, 'cost-job:bunny:2026-11-14');
    assert.deepEqual(action.retry, { kind: 'builtin', handler: 'cost-job', args: { job: 'bunny', at: job.at, day: '2026-11-14' } });
    assert.equal(action.itemUrl, '/costs');
  });

  it('a rate-limited Containers list skips today\'s hourly pass; yesterday\'s daily pass still fails and retries', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'cloudflare', 'cf-admin-token-abcdefghijklmnop');
    const now = new Date('2026-11-18T22:10:00Z');
    const f = apiFetch(env, { containersStatus: 429 });
    const today = await runProductJob({ v: 1, job: 'containers', at: now.toISOString(), day: '2026-11-18' }, env, f, now);
    assert.equal(today.status, 'skipped');
    const yesterday = await runProductJob({ v: 1, job: 'containers', at: now.toISOString(), day: '2026-11-17' }, env, f, now);
    assert.equal(yesterday.status, 'failed');
    assert.equal(yesterday.permanent, false);
  });

  it('the hourly collection is one standing item: every hour updates it, the next good hour resolves it', () => {
    const a: CostJob = { v: 1, job: 'hourly', at: '2026-11-18T21:10:00Z' };
    const b: CostJob = { v: 1, job: 'hourly', at: '2026-11-18T22:10:00Z' };
    assert.equal(jobKey(a), 'cost-job:hourly');
    assert.equal(jobKey(a), jobKey(b));
    assert.equal(jobKey({ v: 1, job: 'containers', at: a.at, day: '2026-11-18' }), 'cost-job:containers:2026-11-18');
  });

  it('a refused key fails for good at once (no pointless retries)', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'bunny', 'bunny-account-key-0123456789abcdef');
    const job: CostJob = { v: 1, job: 'bunny', at: '2026-11-14T10:10:00Z', day: '2026-11-14' };
    assert.equal(await handleJob(job, 1, env, undefined, runJob, apiFetch(env, { bunnyStatus: 401 })), 'ack');
    await flush(env);
    assert.equal(env.posted.length, 1);
  });

  it('the consumer retries or acks per message; the DLQ flags and drops malformed bodies', async () => {
    const env = jobsEnv();
    await store(env.COSTS_DB, 'bunny', 'bunny-account-key-0123456789abcdef');
    const seen: string[] = [];
    const msg = (body: unknown, attempts = 1) => ({ id: String(seen.length), body, attempts, ack: () => seen.push('ack'), retry: (o?: { delaySeconds?: number }) => seen.push(`retry:${o?.delaySeconds}`) });
    const job: CostJob = { v: 1, job: 'bunny', at: '2026-11-14T10:10:00Z', day: '2026-11-14' };
    await consumeJobs({ queue: 'al-ummah-cost-jobs-qa', messages: [msg(job), msg({ nope: true })] }, env, undefined, runJob, apiFetch(env, { bunnyStatus: 500 }));
    assert.deepEqual(seen, ['retry:60', 'ack']);
    seen.length = 0;
    await consumeJobs({ queue: 'al-ummah-cost-jobs-dlq-qa', messages: [msg(job, 1)] }, env, undefined, runJob, apiFetch(env));
    assert.deepEqual(seen, ['ack']);
    await flush(env);
    assert.match(String((env.posted[0] as { events: { message: string }[] }).events[0]!.message), /dead-lettered/);
  });
});
