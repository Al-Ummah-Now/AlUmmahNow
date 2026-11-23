/**
 * admin-api answers errors in the shared envelope (wiki AUN-FEATURES §5.2, decision O40): the
 * whole app, including the onError answer, localized by Accept-Language, with the reference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { API_ERROR_CATALOGUE } from '@al-ummah/shared-types';
import { errorEnvelope } from '../src/middleware/error-envelope';

describe('admin-api error envelope', () => {
  const app = new Hono();
  app.onError((_err, c) => c.json({ success: false, error: 'Internal server error', reference: 'ERR-AAAA-BBBB' }, 500, { 'X-Error-Ref': 'ERR-AAAA-BBBB' }));
  app.use('*', errorEnvelope);
  app.get('/forbidden', (c) => c.json({ success: false, code: 'forbidden', error: 'Missing permission features:manage' }, 403));
  app.get('/boom', () => {
    throw new Error('D1 exploded');
  });
  app.get('/ok', (c) => c.json({ success: true, items: [] }));

  it('localizes a coded answer and keeps the legacy error text', async () => {
    const res = await app.request('/forbidden', { headers: { 'Accept-Language': 'ar,en;q=0.5' } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'forbidden');
    assert.equal(body.message, API_ERROR_CATALOGUE.forbidden.ar);
    assert.equal(body.lang, 'ar');
    assert.equal(body.error, 'Missing permission features:manage');
    assert.match(res.headers.get('vary') ?? '', /X-App-Locale/);
  });

  it('wraps the onError answer with its reference and a retry action', async () => {
    const res = await app.request('/boom');
    const body = await res.json();
    assert.equal(body.code, 'server_error');
    assert.equal(body.action, 'retry');
    assert.equal(body.reference, 'ERR-AAAA-BBBB');
    assert.ok(!JSON.stringify(body).includes('D1 exploded'));
  });

  it('leaves successes alone', async () => {
    assert.deepEqual(await (await app.request('/ok')).json(), { success: true, items: [] });
  });

  it('is registered on the real app before the 5xx recorder', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const envelope = src.indexOf("app.use('*', errorEnvelope)");
    assert.ok(envelope > 0 && envelope < src.indexOf('// 5xx answers that did not throw'));
    assert.match(src, /allowHeaders: \[[^\]]*'X-App-Locale'/);
  });
});
