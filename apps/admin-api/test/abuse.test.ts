import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import abuseRouter, { abuseQuery, summarize, ABUSE_DATASETS } from '../src/routers/abuse.router';

describe('Abuse panel (/api/abuse)', () => {
  it('builds the query from the fixed dataset list and window', () => {
    const sql = abuseQuery(ABUSE_DATASETS.qa, 24);
    assert.match(sql, /FROM al_ummah_now_abuse_qa WHERE timestamp > NOW\(\) - INTERVAL '24' HOUR/);
    assert.match(sql, /SUM\(_sample_interval\)/);
  });

  it('summarizes rows (string counts from the SQL API) and totals per kind', () => {
    const s = summarize('production', 24, [
      { app: 'auth', endpoint: 'auth.sign_up', kind: 'turnstile_fail', n: '7' },
      { app: 'videos', endpoint: 'videos.comment', kind: 'rate_limited', n: '3' },
      { app: 'videos', endpoint: 'videos.report', kind: 'turnstile_fail', n: '2' },
      { app: 'x', endpoint: '', kind: 'rate_limited', n: '9' },
    ], new Date('2026-11-13T00:00:00Z'));
    assert.equal(s.rows.length, 3);
    assert.equal(s.totals.turnstile_fail, 9);
    assert.equal(s.totals.rate_limited, 3);
    assert.equal(s.totals.bad_user_agent, 0);
    assert.equal(s.generatedAt, '2026-11-13T00:00:00.000Z');
  });

  function app(roles: string[], env: Record<string, unknown>) {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'adm', roles } as never);
      await next();
    });
    a.route('/api/abuse', abuseRouter as never);
    return (path: string) => a.request(path, {}, env);
  }

  it('needs ops:read', async () => {
    const res = await app([], {})('/api/abuse/summary');
    assert.equal(res.status, 403);
  });

  it('answers 503 not_configured without the token, and queries Analytics Engine with it', async () => {
    assert.equal((await app(['Super Admin'], {})('/api/abuse/summary')).status, 503);
    const realFetch = globalThis.fetch;
    let sent = '';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ data: [{ app: 'auth', endpoint: 'auth.sign_up', kind: 'turnstile_pass', n: '12' }] }));
    }) as typeof fetch;
    try {
      const res = await app(['Super Admin'], { CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' })('/api/abuse/summary?env=stage&hours=999');
      assert.equal(res.status, 200);
      const { result } = (await res.json()) as { result: { env: string; hours: number; totals: Record<string, number> } };
      assert.equal(result.env, 'stage');
      assert.equal(result.hours, 168);
      assert.equal(result.totals.turnstile_pass, 12);
      assert.match(sent, /al_ummah_now_abuse_stage/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
