import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import vitalsRouter from '../src/routers/vitals.router';
import abuseRouter from '../src/routers/abuse.router';
import {
  analyticsItemKey,
  analyticsQuery,
  AnalyticsEngineError,
  checkAnalyticsAccess,
  classifyFailure,
  cloudflareErrorText,
  isMissingTable,
} from '../src/lib/analytics-engine';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';

/** Cloudflare's answer to a token without Account Analytics Read (QA admin-api, 2026-11-21) */
const AUTH_ERROR = '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}],"messages":[],"result":null}\n';
const RATE_LIMITED = '{"success":false,"errors":[{"code":10429,"message":"Rate limited. Please wait and consider throttling your request speed"}],"messages":[],"result":null}\n';

type Sent = { events?: Array<{ kind: string; ref: string; message: string; extra?: Record<string, unknown>; action?: Record<string, unknown> }>; resolved?: string[] };

/** A fake ERRORS_QUEUE that keeps what admin-api queued for the Errors page */
function errorsQueue() {
  const sent: Sent[] = [];
  return { sent, queue: { send: async (msg: Sent) => void sent.push(msg) } };
}

function withFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const real = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

function app(env: Record<string, unknown>) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'adm', roles: ['Super Admin'] } as never);
    await next();
  });
  a.route('/api/vitals', vitalsRouter as never);
  a.route('/api/abuse', abuseRouter as never);
  return (path: string) => a.request(path, {}, env);
}

/** Lets the deferred Errors page writes (waitUntil is unavailable in a.request) finish */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('Analytics Engine client (lib/analytics-engine.ts)', () => {
  it('classifies Cloudflare answers', () => {
    assert.equal(classifyFailure(401, AUTH_ERROR), 'auth');
    assert.equal(classifyFailure(403, 'forbidden'), 'auth');
    assert.equal(classifyFailure(400, AUTH_ERROR), 'auth');
    assert.equal(classifyFailure(429, RATE_LIMITED), 'rate_limited');
    assert.equal(classifyFailure(422, 'error in query: unknown function quantileFoo'), 'query');
    assert.equal(classifyFailure(502, 'bad gateway'), 'upstream');
    assert.equal(cloudflareErrorText(AUTH_ERROR), '10000 Authentication error');
    assert.equal(cloudflareErrorText('  plain text problem \n'), 'plain text problem');
    assert.equal(isMissingTable('unknown table al_ummah_now_rum_qa'), true);
    assert.equal(isMissingTable("Table al_ummah_now_rum doesn't exist"), true);
    assert.equal(isMissingTable(AUTH_ERROR), false);
  });

  it('returns rows, [] for a dataset never written to, and throws a classified error otherwise', async () => {
    const reply = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    assert.deepEqual(await analyticsQuery('acc', 't', 'SELECT 1', { panel: 'vitals', fetchImpl: reply('{"data":[{"x":"1"}]}') }), [{ x: '1' }]);
    assert.deepEqual(await analyticsQuery('acc', 't', 'SELECT 1', { panel: 'vitals', fetchImpl: reply('unknown table x', 422) }), []);
    const cases: Array<[typeof fetch, string, number]> = [
      [reply(AUTH_ERROR, 401), 'auth', 401],
      [reply(RATE_LIMITED, 429), 'rate_limited', 429],
      [reply('Internal error', 500), 'upstream', 500],
      [reply('<html>not json</html>'), 'bad_response', 200],
      [reply('{"data":"nope"}'), 'bad_response', 200],
      [(async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch, 'unreachable', 0],
    ];
    for (const [fetchImpl, reason, status] of cases) {
      await assert.rejects(analyticsQuery('acc', 't', 'SELECT 1', { panel: 'abuse', fetchImpl }), (e: unknown) => {
        assert.ok(e instanceof AnalyticsEngineError);
        assert.equal(e.reason, reason);
        assert.equal(e.status, status);
        return true;
      });
    }
  });

  it('never sends the token anywhere but the Authorization header', async () => {
    let seen: RequestInit | undefined;
    await analyticsQuery('acc', 'sekret', 'SHOW TABLES', {
      panel: 'vitals',
      fetchImpl: (async (_u: string, init: RequestInit) => {
        seen = init;
        return new Response(AUTH_ERROR, { status: 401 });
      }) as unknown as typeof fetch,
    }).catch((e: AnalyticsEngineError) => assert.doesNotMatch(`${e.message} ${e.detail}`, /sekret/));
    assert.equal((seen?.headers as Record<string, string>).Authorization, 'Bearer sekret');
  });
});

describe('Web vitals and Abuse panels on a refused token', () => {
  it('not_configured only when the token or the account is missing', async () => {
    for (const env of [{}, { CF_ANALYTICS_TOKEN: 't' }, { CLOUDFLARE_ACCOUNT_ID: 'acc' }, { CF_ANALYTICS_TOKEN: { get: async () => { throw new Error('no secret'); } }, CLOUDFLARE_ACCOUNT_ID: 'acc' }]) {
      const res = await app(env)('/api/vitals/summary');
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { code: string }).code, 'not_configured');
    }
  });

  it('answers unavailable with the reason and a reference, flags the Errors page once per panel, and stops after the first refusal', async () => {
    const q = errorsQueue();
    let calls = 0;
    const restore = withFetch(async () => {
      calls++;
      return new Response(AUTH_ERROR, { status: 401 });
    });
    try {
      const res = await app({ CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc', ERRORS_QUEUE: q.queue, ENVIRONMENT: 'qa' })('/api/vitals/summary?env=qa&days=7');
      assert.equal(res.status, 503);
      const body = (await res.json()) as { code: string; reason: string; ref: string; error: string };
      assert.equal(body.code, 'unavailable');
      assert.equal(body.reason, 'auth');
      assert.match(body.ref, /\S{6,}/);
      // The detail query is not sent after the overall one was refused
      assert.equal(calls, 1);
      await settle();
      const events = q.sent.flatMap((m) => m.events ?? []);
      assert.equal(events.length, 1);
      const [event] = events;
      assert.equal(event.kind, 'action');
      assert.equal(event.ref, body.ref);
      assert.equal(event.action?.key, analyticsItemKey('vitals'));
      assert.equal(event.action?.source, 'ops');
      assert.equal(event.action?.itemUrl, '/web-vitals');
      assert.deepEqual(event.action?.retry, { kind: 'builtin', handler: 'analytics-engine', args: { panel: 'vitals' } });
      assert.match(event.message, /Account → Account Analytics → Read/);
      assert.match(event.message, /HTTP 401\): 10000 Authentication error/);
      assert.deepEqual(event.extra, { panel: 'vitals', reason: 'auth', status: 401 });
      assert.equal(q.sent.some((m) => (m.resolved ?? []).length), false);

      const abuse = await app({ CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc', ERRORS_QUEUE: q.queue })('/api/abuse/summary?env=qa');
      assert.equal(abuse.status, 503);
      assert.equal(((await abuse.json()) as { reason: string }).reason, 'auth');
      await settle();
      assert.equal(q.sent.flatMap((m) => m.events ?? []).at(-1)?.action?.key, analyticsItemKey('abuse'));
    } finally {
      restore();
    }
  });

  it('a rate limit and a Cloudflare outage are reported as such', async () => {
    for (const [status, body, reason] of [[429, RATE_LIMITED, 'rate_limited'], [503, 'upstream down', 'upstream']] as const) {
      const restore = withFetch(async () => new Response(body, { status }));
      try {
        const res = await app({ CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' })('/api/vitals/summary?env=stage&days=1');
        assert.equal(res.status, 503);
        assert.equal(((await res.json()) as { reason: string }).reason, reason);
      } finally {
        restore();
      }
    }
  });

  it('an empty dataset is a summary with no samples, and a good read closes the Errors page item', async () => {
    const q = errorsQueue();
    const restore = withFetch(async () => new Response('{"meta":[],"data":[],"rows":0}'));
    try {
      const res = await app({ CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc', ERRORS_QUEUE: q.queue })('/api/vitals/summary?env=production&days=28&locale=ar');
      assert.equal(res.status, 200);
      const { result } = (await res.json()) as { result: { overall: object; rows: unknown[]; days: number } };
      assert.deepEqual(result.overall, {});
      assert.deepEqual(result.rows, []);
      assert.equal(result.days, 28);
      await settle();
      assert.deepEqual(q.sent.flatMap((m) => m.resolved ?? []), [analyticsItemKey('vitals')]);
      assert.equal(q.sent.flatMap((m) => m.events ?? []).length, 0);
    } finally {
      restore();
    }
  });

  it('Errors page "Check again" resolves once Cloudflare accepts the token and stays open while it refuses', async () => {
    const env = { CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' } as never;
    let restore = withFetch(async (_u, init) => {
      assert.equal(init.body, 'SHOW TABLES');
      return new Response(AUTH_ERROR, { status: 401 });
    });
    try {
      const open = await BUILTIN_RETRIES['analytics-engine'](env, { panel: 'vitals' }, 'a1');
      assert.equal(open.ok, false);
      assert.equal(open.status, 'open');
      assert.match(open.result, /auth, HTTP 401\): 10000 Authentication error/);
    } finally {
      restore();
    }
    restore = withFetch(async () => new Response('{"data":[{"dataset":"al_ummah_now_rum"}]}'));
    try {
      const done = await BUILTIN_RETRIES['analytics-engine'](env, { panel: 'abuse' }, 'a2');
      assert.deepEqual(done, { ok: true, status: 'resolved', result: 'Cloudflare accepted the token' });
      assert.equal((await BUILTIN_RETRIES['analytics-engine'](env, { panel: 'other' }, 'a3')).ok, false);
      assert.equal((await checkAnalyticsAccess({} as never)).ok, false);
    } finally {
      restore();
    }
  });
});
