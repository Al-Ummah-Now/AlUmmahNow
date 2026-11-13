import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import vitalsRouter, { vitalsQuery, summarizeVitals, rate, VITALS_DATASETS, FEW_SAMPLES } from '../src/routers/vitals.router';

describe('Web vitals panel (/api/vitals)', () => {
  it('builds both queries from the fixed dataset, window and locale lists', () => {
    const overall = vitalsQuery(VITALS_DATASETS.production, 7, 'all', 'metric');
    assert.match(overall, /FROM al_ummah_now_rum WHERE timestamp > NOW\(\) - INTERVAL '7' DAY GROUP BY metric /);
    assert.match(overall, /quantileExactWeighted\(0\.75\)\(double1, _sample_interval\)/);
    assert.doesNotMatch(overall, /blob4/);
    const detail = vitalsQuery(VITALS_DATASETS.qa, 28, 'ar', 'detail');
    assert.match(detail, /FROM al_ummah_now_rum_qa WHERE timestamp > NOW\(\) - INTERVAL '28' DAY AND blob4 = 'ar' GROUP BY metric, kind, device/);
  });

  it('rates p75 against the web.dev limits', () => {
    assert.equal(rate('LCP', 2500), 'good');
    assert.equal(rate('LCP', 2501), 'needs_improvement');
    assert.equal(rate('LCP', 4001), 'poor');
    assert.equal(rate('CLS', 0.1), 'good');
    assert.equal(rate('CLS', 0.3), 'poor');
    assert.equal(rate('INP', 350), 'needs_improvement');
  });

  it('pivots the detail rows per page kind and device, busiest first, and flags small samples', () => {
    const s = summarizeVitals(
      'production',
      7,
      'all',
      [
        { metric: 'LCP', p75: '2100.5', n: '900' },
        { metric: 'CLS', p75: '0.31', n: '880' },
        { metric: 'BOGUS', p75: '1', n: '5' },
      ],
      [
        { metric: 'LCP', kind: 'watch', device: 'phone', p75: '3200', n: '40' },
        { metric: 'INP', kind: 'watch', device: 'phone', p75: '180', n: '12' },
        { metric: 'LCP', kind: 'home', device: 'desktop', p75: '1500', n: '600' },
        { metric: 'LCP', kind: '', device: 'phone', p75: '1', n: '9' },
        { metric: 'CLS', kind: 'home', device: 'desktop', p75: 'NaN', n: '9' },
      ],
      new Date('2026-11-13T00:00:00Z'),
    );
    assert.deepEqual(Object.keys(s.overall).sort(), ['CLS', 'LCP']);
    assert.equal(s.overall.LCP?.rating, 'good');
    assert.equal(s.overall.CLS?.rating, 'poor');
    assert.equal(s.rows.length, 2);
    assert.deepEqual([s.rows[0].kind, s.rows[0].device], ['home', 'desktop']);
    const watch = s.rows[1];
    assert.equal(watch.metrics.LCP?.rating, 'needs_improvement');
    assert.equal(watch.metrics.LCP?.few, 40 < FEW_SAMPLES);
    assert.equal(watch.metrics.INP?.samples, 12);
    assert.equal(s.rows[0].metrics.CLS, undefined);
    assert.equal(s.generatedAt, '2026-11-13T00:00:00.000Z');
  });

  function app(roles: string[], env: Record<string, unknown>) {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'adm', roles } as never);
      await next();
    });
    a.route('/api/vitals', vitalsRouter as never);
    return (path: string) => a.request(path, {}, env);
  }

  it('needs ops:read', async () => {
    assert.equal((await app([], {})('/api/vitals/summary')).status, 403);
  });

  it('answers 503 without the token; with it, runs both queries and clamps unknown params', async () => {
    assert.equal((await app(['Super Admin'], {})('/api/vitals/summary')).status, 503);
    const realFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const sql = String(init.body);
      sent.push(sql);
      const data = sql.includes('kind')
        ? [{ metric: 'LCP', kind: 'watch', device: 'phone', p75: '2600', n: '120' }]
        : [{ metric: 'LCP', p75: '2600', n: '120' }];
      return new Response(JSON.stringify({ data }));
    }) as typeof fetch;
    try {
      const res = await app(['Super Admin'], { CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' })(
        "/api/vitals/summary?env=stage&days=999&locale=fr'--",
      );
      assert.equal(res.status, 200);
      const { result } = (await res.json()) as { result: { env: string; days: number; locale: string; overall: { LCP: { rating: string } }; rows: unknown[] } };
      assert.equal(result.env, 'stage');
      assert.equal(result.days, 7);
      assert.equal(result.locale, 'all');
      assert.equal(result.overall.LCP.rating, 'needs_improvement');
      assert.equal(result.rows.length, 1);
      assert.equal(sent.length, 2);
      for (const sql of sent) {
        assert.match(sql, /al_ummah_now_rum_stage/);
        assert.doesNotMatch(sql, /fr'|blob4/);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a dataset nobody has written to yet is "no data", not an error; other failures are 503', async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response('unknown table al_ummah_now_rum_qa', { status: 422 })) as typeof fetch;
      const empty = await app(['Super Admin'], { CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' })('/api/vitals/summary?env=qa&days=1');
      assert.equal(empty.status, 200);
      const { result } = (await empty.json()) as { result: { rows: unknown[]; overall: object } };
      assert.deepEqual(result.rows, []);
      assert.deepEqual(result.overall, {});
      globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
      const failed = await app(['Super Admin'], { CF_ANALYTICS_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc' })('/api/vitals/summary?env=qa&days=28');
      assert.equal(failed.status, 503);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
