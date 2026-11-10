/**
 * admin-web error reporting: the /api/errors forwarding route and the
 * friendly error boundaries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { ERROR_REF_PATTERN, errorRefFromDigest } from '@al-ummah/shared-types';
import { handleErrorReport, MAX_REPORT_BYTES, type RouteDeps } from '../src/lib/errors/forward';
import { boundaryOutcome, handleBoundaryError } from '../src/lib/errors/boundary';
import { BoundaryError, FriendlyError } from '../src/components/FriendlyError';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

/** react-dom/server and this app resolve different @types/react copies; render through one typed helper. */
function render<P extends object>(component: (props: P) => unknown, props: P): string {
  return renderToStaticMarkup(React.createElement(component as unknown as React.FC<P>, props) as never);
}

const batch = JSON.stringify({ events: [{ app: 'admin-web', kind: 'unhandled', ref: 'ERR-0000-0000', message: 'x', occurredAt: '2026-11-10T00:00:00Z' }] });

function harness(overrides: Partial<RouteDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: RouteDeps = {
    key: async () => 'k-123',
    adminApiUrl: () => 'https://admin.api.qa.alummahnow.net/',
    waitUntil: (p) => pending.push(p),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch,
    ...overrides,
  };
  return { deps, calls, settle: () => Promise.all(pending) };
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://admin.qa.alummahnow.net/api/errors', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

describe('/api/errors forwarding route', () => {
  it('forwards the batch with the key, client IP, user agent and browser source', async () => {
    const h = harness();
    const res = await handleErrorReport(post(batch, { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Mozilla/5.0 Test', 'sec-fetch-site': 'same-origin' }), h.deps);
    assert.equal(res.status, 202);
    await h.settle();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://admin.api.qa.alummahnow.net/internal/errors');
    const headers = h.calls[0].init.headers as Record<string, string>;
    assert.equal(headers['X-API-Key'], 'k-123');
    assert.equal(headers['X-Client-IP'], '203.0.113.9');
    assert.equal(headers['X-Client-User-Agent'], 'Mozilla/5.0 Test');
    assert.equal(headers['X-Report-Source'], 'browser');
    assert.equal(headers['X-Report-App'], 'admin-web');
    assert.equal(headers['X-Client-User-Id'], undefined);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(h.calls[0].init.body, batch);
  });

  it('vouches for the signed-in admin from the server session, never the page', async () => {
    const h = harness({ userId: async () => 'usr_admin42' });
    const forged = JSON.stringify({ events: [{ app: 'admin-web', kind: 'unhandled', ref: 'ERR-0000-0000', message: 'x', occurredAt: '2026-11-10T00:00:00Z', userId: 'usr_forged99' }] });
    await handleErrorReport(post(forged, { 'sec-fetch-site': 'same-origin' }), h.deps);
    await h.settle();
    assert.equal((h.calls[0].init.headers as Record<string, string>)['X-Client-User-Id'], 'usr_admin42');
  });

  it('accepts sendBeacon text/plain bodies', async () => {
    const h = harness();
    const res = await handleErrorReport(post(batch, { 'content-type': 'text/plain;charset=UTF-8' }), h.deps);
    assert.equal(res.status, 202);
    await h.settle();
    assert.equal(h.calls.length, 1);
  });

  it('answers before admin-api does (the upstream call runs in waitUntil)', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const h = harness({ fetch: (async () => { await slow; return new Response(null, { status: 202 }); }) as unknown as typeof fetch });
    const res = await handleErrorReport(post(batch), h.deps);
    assert.equal(res.status, 202);
    release();
    await h.settle();
  });

  it('drops oversized, malformed, empty, cross-site and odd content types with 204', async () => {
    const big = JSON.stringify({ events: [{ message: 'x'.repeat(MAX_REPORT_BYTES) }] });
    const cases: Request[] = [
      post(big),
      post(batch, { 'content-length': String(MAX_REPORT_BYTES + 1) }),
      post('{not json'),
      post(JSON.stringify({ events: [] })),
      post(batch, { 'sec-fetch-site': 'cross-site' }),
      post(batch, { 'content-type': 'application/x-www-form-urlencoded' }),
    ];
    for (const req of cases) {
      const h = harness();
      const res = await handleErrorReport(req, h.deps);
      assert.equal(res.status, 204);
      await h.settle();
      assert.equal(h.calls.length, 0);
    }
  });

  it('never fails the page: no key, no URL or admin-api down still answer quickly', async () => {
    for (const overrides of [
      { key: async () => '' },
      { adminApiUrl: () => undefined },
      { fetch: (async () => { throw new Error('down'); }) as unknown as typeof fetch },
    ] as Partial<RouteDeps>[]) {
      const h = harness(overrides);
      const res = await handleErrorReport(post(batch), h.deps);
      assert.ok(res.status === 202 || res.status === 204);
      await h.settle();
    }
  });
});

describe('error boundaries', () => {
  const raw = Object.assign(new Error('SECRET: D1_ERROR at /_next/static/chunks/app.js:1:2 token=abc'), { stack: 'Error: SECRET\n    at foo (webpack-internal:///./src/x.ts:1:1)' });

  it('show a friendly screen with a reference and never the raw error', () => {
    const html = render(BoundaryError, { error: raw, reset: () => undefined, locale: 'en' });
    assert.match(html, /Something went wrong/);
    assert.match(html, /data-testid="friendly-error-ref"[^>]*>ERR-[0-9A-Z]{4}-[0-9A-Z]{4}</);
    assert.match(html, /Try again/);
    for (const leak of ['SECRET', 'D1_ERROR', '_next', 'webpack', 'token', 'at foo']) assert.ok(!html.includes(leak), leak);
  });

  it('use the digest reference for server errors, so the server event is found', () => {
    const err = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '1234567890' });
    const outcome = boundaryOutcome(err);
    assert.equal(outcome.ref, errorRefFromDigest('1234567890'));
    assert.equal(outcome.kind, 'server');
    assert.equal(outcome.report, null);
    const html = render(BoundaryError, { error: err, locale: 'ar' });
    assert.match(html, /dir="rtl"/);
    assert.match(html, /تعذّر تحميل هذه الصفحة/);
    assert.ok(html.includes(errorRefFromDigest('1234567890')));
    assert.ok(!html.includes('Server Components'));
  });

  it('report a client error as shown, under the reference on screen', () => {
    const reports: unknown[][] = [];
    const outcome = boundaryOutcome(raw);
    assert.match(outcome.ref, ERROR_REF_PATTERN);
    const recovering = handleBoundaryError(raw, outcome, { recover: () => false, report: (...a) => (reports.push(a), outcome.ref) });
    assert.equal(recovering, false);
    assert.deepEqual(reports, [[raw, { kind: 'boundary', shown: true, ref: outcome.ref }]]);
  });

  it('version skew: render nothing, hand over to the skew recovery, still report kind skew', () => {
    const skew = Object.assign(new Error('Server Action "abc123" was not found on the server.'), { name: 'UnrecognizedActionError' });
    const outcome = boundaryOutcome(skew);
    assert.equal(outcome.skew, true);
    assert.equal(render(BoundaryError, { error: skew, locale: 'en' }), '');
    const order: string[] = [];
    const reports: unknown[][] = [];
    const recovering = handleBoundaryError(skew, outcome, {
      recover: (_e, source) => (order.push(`recover:${source}`), true),
      report: (...a) => (order.push('report'), reports.push(a), outcome.ref),
    });
    assert.equal(recovering, true);
    assert.deepEqual(order, ['recover:boundary', 'report']);
    assert.deepEqual(reports, [[skew, { kind: 'skew', ref: outcome.ref }]]);
  });

  it('not found offers the way home and no reference', () => {
    const html = render(FriendlyError, { locale: 'en', kind: 'notFound', homeLabel: 'Go to Dashboard' });
    assert.match(html, /Page not found/);
    assert.match(html, /href="\/dashboard"[^>]*>Go to Dashboard</);
    assert.ok(!html.includes('friendly-error-ref'));
  });
});
