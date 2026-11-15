/**
 * /api/media/troubleshoot/* — the R2 transcode troubleshooting panel: the sealed read-only
 * Cloudflare token (set/test/remove by super admins, audited by last 4), no-token answers that never
 * fail, Cloudflare reads scoped to our own names, filters checked server-side, log scrubbing,
 * Retry now / Cancel audited per video and forwarded to api-videos.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import mediaRouter from '../src/routers/media.router';
import { clearStatusCache, deps, mergeInstances } from '../src/routers/mediaTroubleshoot.router';
import { mediaNames, parseInstance, readLogs, toLogLine } from '../src/lib/media-troubleshoot/cloudflare';
import { open, readToken, seal, SETTING_KEY, tokenProblem } from '../src/lib/media-troubleshoot/token';
import { SERVICE_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

const VIDEO = '912859ed-e618-4d04-8438-874a74a251dd';
const DO_ID = 'a'.repeat(64);
const TOKEN = 'cf-read-only-token-0123456789-WXYZ';
const KEY = 'internal-key-of-at-least-16';
const ACCOUNT = '0e4b6e7f9faf280c3c9bf95995edc64f';
const APP_ID = 'app-123';

const JOBS = {
  at: '2026-11-15T12:00:00.000Z',
  transcoder: 'ok',
  items: [
    {
      videoId: VIDEO, jobId: 'job-1', title: 'Clip', state: 'start_retry', attempt: 3, maxAttempts: 8, queuedAt: '2026-11-15T11:00:00.000Z', startedAt: null,
      nextRetryAt: '2026-11-15T12:05:00.000Z', lastSeenAt: null, progress: null, reason: 'container_start_failed', error: 'container start failed',
      instance: { name: VIDEO, durableObjectId: DO_ID, state: null },
    },
  ],
};
const LIVE = { transcoding: 0, queued: 2, maxTranscodes: 2, oldestQueuedAt: '2026-11-15T11:00:00.000Z', oldestQueuedSeconds: 3600, at: JOBS.at };

type CfAnswer = (path: string, body: any) => { status: number; json: unknown };
const cfOk = (result: unknown) => ({ status: 200, json: { success: true, errors: [], result } });

/** A fake Cloudflare API: our application, one instance, the queues and their backlog, log events. */
const fakeCloudflare: CfAnswer = (path, body) => {
  if (path.endsWith('/containers/applications')) return cfOk([{ id: 'other', name: 'someone-elses-app', max_instances: 99 }, { id: APP_ID, name: 'al-ummah-now-media-qa-transcoder', max_instances: 2, health: { instances: { active: 1, healthy: 1 } } }]);
  if (path.endsWith(`/applications/${APP_ID}/instances`)) return cfOk([{ id: 'inst-1', state: 'running', durable_object_id: DO_ID, location: 'fra' }]);
  if (path.includes('/queues')) return cfOk([{ queue_name: 'al-ummah-now-transcode-qa', queue_id: 'q1' }, { queue_name: 'al-ummah-now-transcode-dlq-qa', queue_id: 'q2' }]);
  if (path.endsWith('/graphql')) {
    if (String(body.query).includes('workersInvocationsAdaptive')) return { status: 200, json: { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } } } };
    return { status: 200, json: { data: { viewer: { accounts: [{ queueBacklogAdaptiveGroups: [{ avg: { messages: body.variables.q === 'q1' ? 2 : 0 } }] }] } } } };
  }
  if (path.endsWith('/observability/telemetry/query')) {
    const isWorker = body.parameters.filters[0].key === '$workers.scriptName';
    const events = isWorker
      ? [
          { timestamp: Date.parse('2026-11-15T11:59:00Z'), $metadata: { level: 'warn', message: 'transcode start failed' }, source: { videoId: VIDEO, jobId: 'job-1', error: 'fetch https://x.r2.dev/a?X-Amz-Signature=secret failed' } },
          { timestamp: Date.parse('2026-11-15T11:58:00Z'), $metadata: { level: 'info', message: 'request' }, source: {} },
          { timestamp: Date.parse('2026-11-15T11:57:00Z'), $metadata: { level: 'error', message: 'another video' }, source: { videoId: 'ffffffff-0000-0000-0000-000000000000' } },
        ]
      : [{ timestamp: Date.parse('2026-11-15T11:59:30Z'), source: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/review.mjs' ${VIDEO}`, $container: { instanceId: 'inst-1', exitCode: 1 } }];
    return cfOk({ events: { events } });
  }
  return { status: 404, json: { success: false, errors: [{ message: 'not found' }] } };
};

function setup(roles: string[], opts: { cf?: CfAnswer; environment?: string; videos?: (path: string, body: any) => { status: number; json: unknown } } = {}) {
  const videoCalls: { path: string; method: string; body: any }[] = [];
  const cfCalls: { path: string; body: any; auth: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: KEY,
    ENVIRONMENT: opts.environment ?? 'qa',
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        videoCalls.push({ path: url.pathname + url.search, method: init?.method ?? 'GET', body });
        const answer = opts.videos?.(url.pathname, body);
        if (answer) return new Response(JSON.stringify(answer.json), { status: answer.status });
        const result = url.pathname.endsWith('/troubleshoot') ? JOBS : url.pathname.endsWith('/summary') ? { live: LIVE } : { job: { id: 'admin-job-1', status: 'queued' } };
        return new Response(JSON.stringify({ success: true, result }), { status: 200 });
      },
    },
  };
  deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.cloudflare.com', 'only the Cloudflare API is called');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    cfCalls.push({ path: url.pathname + url.search, body, auth: new Headers(init?.headers).get('authorization') });
    const r = (opts.cf ?? fakeCloudflare)(url.pathname, body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', email: 'admin-1@example.com', roles } as never);
    await next();
  });
  app.route('/api/media', mediaRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log ORDER BY created_at').all<any>()).results ?? [];
  return { req, env, videoCalls, cfCalls, audit };
}

const send = (method: string, json?: unknown): RequestInit => ({ method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }) });
const body = async (res: Response) => (await res.json()) as any;

afterEach(() => clearStatusCache());

describe('troubleshoot token storage', () => {
  it('seals the token; it opens only with the same internal key', async () => {
    const stored = await seal(TOKEN, KEY);
    assert.ok(!stored.ciphertext.includes(TOKEN));
    assert.equal(stored.last4, 'WXYZ');
    assert.equal(await open(stored, KEY), TOKEN);
    assert.equal(await open(stored, 'a-rotated-internal-key'), null);
  });

  it('refuses values that are not a token', () => {
    assert.equal(tokenProblem(42), 'not_text');
    assert.equal(tokenProblem('short'), 'bad_shape');
    assert.equal(tokenProblem('has a space in it 0123456789'), 'bad_shape');
    assert.equal(tokenProblem(TOKEN), null);
  });
});

describe('/api/media/troubleshoot without a token', () => {
  it('answers with our own job records and says the token is missing; Cloudflare is never called', async () => {
    const { req, cfCalls } = setup(['admin']);
    const res = await req('/api/media/troubleshoot');
    assert.equal(res.status, 200);
    const { result } = await body(res);
    assert.equal(result.status.token, 'missing');
    assert.equal(result.status.containers, null);
    assert.equal(result.status.queues, null);
    assert.deepEqual(result.status.waiting, { queued: 2, oldestQueuedAt: LIVE.oldestQueuedAt, oldestQueuedSeconds: 3600 });
    assert.equal(result.jobs.items[0].reason, 'container_start_failed');
    assert.equal(result.token.set, false);
    const logs = await body(await req('/api/media/troubleshoot/logs'));
    assert.deepEqual(logs.result.lines, []);
    assert.equal(logs.result.token, 'missing');
    assert.equal(cfCalls.length, 0);
  });

  it('still answers when api-videos is down', async () => {
    const { req } = setup(['admin'], { videos: () => ({ status: 503, json: { success: false, error: 'down' } }) });
    const res = await req('/api/media/troubleshoot');
    assert.equal(res.status, 200);
    const { result } = await body(res);
    assert.equal(result.jobs, null);
    assert.equal(result.status.waiting, null);
  });

  it('a token sealed under a rotated internal key reads as unreadable, not an error', async () => {
    const { req, env } = setup(['admin']);
    const stored = await seal(TOKEN, 'the-old-internal-key-value');
    await env.REPORTS_DB.prepare('INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').bind(SETTING_KEY, JSON.stringify(stored), 'x', JOBS.at).run();
    const { result } = await body(await req('/api/media/troubleshoot'));
    assert.equal(result.status.token, 'unreadable');
    assert.equal(result.token.unreadable, true);
  });
});

describe('/api/media/troubleshoot token routes', () => {
  it('only a super admin sets, tests or removes it', async () => {
    const { req, cfCalls } = setup(['admin']);
    assert.equal((await req('/api/media/troubleshoot/token', send('PUT', { token: TOKEN }))).status, 403);
    assert.equal((await req('/api/media/troubleshoot/token/test', send('POST'))).status, 403);
    assert.equal((await req('/api/media/troubleshoot/token', send('DELETE'))).status, 403);
    assert.equal(cfCalls.length, 0);
  });

  it('moderators cannot even read the panel', async () => {
    const { req, videoCalls } = setup(['moderator']);
    assert.equal((await req('/api/media/troubleshoot')).status, 403);
    assert.equal((await req('/api/media/troubleshoot/token')).status, 403);
    assert.equal(videoCalls.length, 0);
  });

  it('set: tested, sealed, audited by last 4 only; the value is never returned', async () => {
    const { req, env, audit, cfCalls } = setup(['super_admin']);
    const res = await req('/api/media/troubleshoot/token', send('PUT', { token: TOKEN }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(TOKEN));
    const { result } = JSON.parse(text);
    assert.equal(result.token.set, true);
    assert.equal(result.token.last4, 'WXYZ');
    assert.equal(result.token.updatedBy, 'admin-1@example.com');
    assert.equal(result.test.ok, true);
    assert.deepEqual(result.test.checks.map((c: any) => c.name), ['observability', 'containers', 'queues', 'analytics']);
    assert.ok(cfCalls.every((c) => c.auth === `Bearer ${TOKEN}`));
    const row = await env.REPORTS_DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SETTING_KEY).first<{ value: string }>();
    assert.ok(row && !row.value.includes(TOKEN));
    assert.equal((await readToken(env.REPORTS_DB as never, KEY)).token, TOKEN);
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(TOKEN));
    assert.deepEqual(JSON.parse(rows[0].new_value), { action: 'set', last4: 'WXYZ', test: true });
  });

  it('test reports each missing permission', async () => {
    const denyObservability: CfAnswer = (path, b) => (path.includes('observability') || path.includes('/queues') ? { status: 403, json: { success: false, errors: [{ code: 10000 }] } } : fakeCloudflare(path, b));
    const { req } = setup(['super_admin'], { cf: denyObservability });
    const { result } = await body(await req('/api/media/troubleshoot/token', send('PUT', { token: TOKEN })));
    assert.equal(result.test.ok, false);
    assert.deepEqual(result.test.checks.filter((c: any) => !c.ok).map((c: any) => c.name), ['observability', 'queues']);
  });

  it('test again and remove are audited', async () => {
    const { req, audit } = setup(['super_admin']);
    assert.equal((await req('/api/media/troubleshoot/token/test', send('POST'))).status, 409);
    await req('/api/media/troubleshoot/token', send('PUT', { token: TOKEN }));
    assert.equal((await req('/api/media/troubleshoot/token/test', send('POST'))).status, 200);
    const removed = await body(await req('/api/media/troubleshoot/token', send('DELETE')));
    assert.equal(removed.result.removed, true);
    assert.deepEqual((await audit()).map((r) => JSON.parse(r.new_value).action), ['set', 'tested', 'removed']);
    assert.equal((await body(await req('/api/media/troubleshoot/token'))).result.token.set, false);
  });

  it('refuses a malformed token without echoing it', async () => {
    const { req } = setup(['super_admin']);
    const res = await req('/api/media/troubleshoot/token', send('PUT', { token: 'not a token' }));
    assert.equal(res.status, 400);
    assert.ok(!(await res.text()).includes('not a token'));
  });
});

describe('/api/media/troubleshoot with a token', () => {
  async function withToken(roles = ['super_admin'], opts: Parameters<typeof setup>[1] = {}) {
    const s = setup(roles, opts);
    const stored = await seal(TOKEN, KEY);
    await s.env.REPORTS_DB.prepare('INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').bind(SETTING_KEY, JSON.stringify(stored), 'x', JOBS.at).run();
    return s;
  }

  it('reads only our application and queues and puts the instance state on its job', async () => {
    const { req, cfCalls } = await withToken(['admin']);
    const { result } = await body(await req('/api/media/troubleshoot'));
    assert.equal(result.status.token, 'ok');
    assert.equal(result.status.containers.application, 'al-ummah-now-media-qa-transcoder');
    assert.equal(result.status.containers.maxInstances, 2);
    assert.equal(result.status.containers.inUse, 1);
    assert.deepEqual(result.status.queues.queue, { name: 'al-ummah-now-transcode-qa', backlog: 2 });
    assert.deepEqual(result.status.queues.dlq, { name: 'al-ummah-now-transcode-dlq-qa', backlog: 0 });
    assert.equal(result.jobs.items[0].instance.state, 'running');
    assert.ok(cfCalls.every((c) => c.path.startsWith(`/client/v4/accounts/${ACCOUNT}/`) || c.path === '/client/v4/graphql'));
    assert.ok(!cfCalls.some((c) => c.path.includes('/other/')));
  });

  it('caches the Cloudflare status reads between quick refreshes', async () => {
    const { req, cfCalls } = await withToken(['admin']);
    await req('/api/media/troubleshoot');
    const first = cfCalls.length;
    await req('/api/media/troubleshoot');
    assert.equal(cfCalls.length, first);
  });

  it('a refused Cloudflare read shows as forbidden; the panel still answers', async () => {
    const { req } = await withToken(['admin'], { cf: () => ({ status: 403, json: { success: false, errors: [{ code: 10000 }] } }) });
    const res = await req('/api/media/troubleshoot');
    assert.equal(res.status, 200);
    const { result } = await body(res);
    assert.deepEqual(result.status.containers, { ok: false, error: 'forbidden' });
    assert.deepEqual(result.status.queues, { ok: false, error: 'forbidden' });
    assert.equal(result.jobs.items[0].instance.state, null);
  });

  it('logs: our Worker and our container only, warn/error Worker lines, scrubbed, filtered by id', async () => {
    const { req, cfCalls } = await withToken(['admin']);
    const { result } = await body(await req(`/api/media/troubleshoot/logs?q=${VIDEO}&hours=6`));
    assert.deepEqual(result.sources, { worker: 'ok', container: 'ok' });
    assert.deepEqual(result.lines.map((l: any) => l.source), ['container', 'worker']);
    assert.ok(result.lines[0].message.includes('ERR_MODULE_NOT_FOUND'));
    assert.ok(!JSON.stringify(result.lines).includes('secret'), 'URL queries are scrubbed');
    const queries = cfCalls.filter((c) => c.path.endsWith('/telemetry/query')).map((c) => c.body.parameters.filters);
    assert.deepEqual(queries, [
      [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: 'al-ummah-now-media-qa' }],
      [{ key: '$container.applicationId', operation: 'eq', type: 'string', value: APP_ID }],
    ]);
  });

  it('logs refuse anything but an id, an allowed period and a known source', async () => {
    const { req, cfCalls } = await withToken(['admin']);
    for (const q of ['q=a%20b', 'q=$workers.scriptName', 'q=short', 'hours=48', 'source=everything']) {
      assert.equal((await req(`/api/media/troubleshoot/logs?${q}`)).status, 400, q);
    }
    assert.equal(cfCalls.length, 0);
  });

  it('reads nothing where the environment has no media names (local, previews)', async () => {
    const { req, cfCalls } = await withToken(['admin'], { environment: 'development' });
    const { result } = await body(await req('/api/media/troubleshoot'));
    assert.equal(result.status.containers, null);
    assert.equal(cfCalls.length, 0);
  });
});

describe('Retry now and Cancel', () => {
  it('are audited per video and queued through api-videos with the actor', async () => {
    const { req, videoCalls, audit } = setup(['admin']);
    assert.equal((await req(`/api/media/troubleshoot/jobs/${VIDEO}/retry-now`, send('POST'))).status, 202);
    assert.equal((await req(`/api/media/troubleshoot/jobs/${VIDEO}/cancel`, send('POST'))).status, 202);
    assert.deepEqual(videoCalls.map((c) => [c.path, c.body]), [
      ['/internal/media/troubleshoot/actions', { action: 'retry-now', videoId: VIDEO, actorId: 'admin-1' }],
      ['/internal/media/troubleshoot/actions', { action: 'cancel', videoId: VIDEO, actorId: 'admin-1' }],
    ]);
    const rows = await audit();
    assert.deepEqual(rows.map((r) => [r.key, JSON.parse(r.new_value).action, r.actor_id]), [
      [`media:video:${VIDEO}`, 'transcode_retry_now', 'admin-1'],
      [`media:video:${VIDEO}`, 'transcode_cancel', 'admin-1'],
    ]);
  });

  it('a refused action leaves no audit row; bad ids never reach api-videos', async () => {
    const { req, videoCalls, audit } = setup(['admin'], { videos: () => ({ status: 409, json: { success: false, error: 'nothing to cancel' } }) });
    assert.equal((await req(`/api/media/troubleshoot/jobs/${VIDEO}/cancel`, send('POST'))).status, 409);
    assert.equal((await audit()).length, 0);
    assert.equal((await req('/api/media/troubleshoot/jobs/..%2Fetc/cancel', send('POST'))).status, 400);
    assert.equal(videoCalls.length, 1);
  });

  it('the Errors page may retry the stall and the action jobs', () => {
    const paths = SERVICE_RETRIES['api-videos']!.paths;
    assert.ok(paths.includes('/internal/media/troubleshoot/retry-now'));
    assert.ok(paths.includes('/internal/media/troubleshoot/jobs/retry'));
  });
});

describe('pure helpers', () => {
  it('mediaNames: our names per environment, none elsewhere', () => {
    assert.equal(mediaNames('production')!.application, 'al-ummah-now-media-transcoder');
    assert.equal(mediaNames('stage')!.worker, 'al-ummah-now-media-stage');
    assert.equal(mediaNames('development'), null);
    assert.equal(mediaNames(undefined), null);
  });

  it('parseInstance reads the Durable Object id from any 64-hex field', () => {
    assert.deepEqual(parseInstance({ id: 'i', status: { current: 'running' }, some_field: DO_ID }), { id: 'i', state: 'running', durableObjectId: DO_ID, location: null, createdAt: null });
    assert.equal(parseInstance({}), null);
  });

  it('toLogLine scrubs credentials and signed URLs', () => {
    const line = toLogLine({ timestamp: 1, $metadata: { level: 'error', message: 'GET https://a.example/x?token=abc' }, source: { error: 'Authorization: Bearer abcdefghijklmnop' } }, 'worker')!;
    assert.ok(!line.message.includes('abc'));
    assert.ok(!line.detail!.includes('abcdefghijklmnop'));
  });

  it('readLogs drops an injected filter that is not an id', async () => {
    const calls: any[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, result: { events: { events: [] } } }));
    }) as unknown as typeof fetch;
    await readLogs({ token: TOKEN, accountId: ACCOUNT, fetchImpl }, mediaNames('qa')!, null, { hours: 1, filter: '" OR 1=1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parameters.filters.length, 1);
  });

  it('mergeInstances leaves jobs alone when containers could not be read', () => {
    const jobs = JOBS as never;
    assert.equal(mergeInstances(jobs, { ok: false, error: 'forbidden' }), jobs);
    assert.equal(mergeInstances(jobs, null), jobs);
  });
});
