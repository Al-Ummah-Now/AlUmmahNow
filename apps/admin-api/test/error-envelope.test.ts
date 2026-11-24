/**
 * admin-api answers errors in the shared envelope (wiki AUN-FEATURES §5.2, decision O40): the
 * whole app, including the onError answer, localized by X-App-Locale, with the reference.
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
    const res = await app.request('/forbidden', { headers: { 'X-App-Locale': 'ar', 'Accept-Language': 'en' } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'forbidden');
    assert.equal(body.message, API_ERROR_CATALOGUE.forbidden.ar);
    assert.equal(body.lang, 'ar');
    assert.equal(body.error, 'Missing permission features:manage');
    assert.match(res.headers.get('vary') ?? '', /X-App-Locale/);
  });

  it('invites and admin transfers keep their own texts: the owner-move texts of api-videos are not theirs (CC-6)', async () => {
    const own = new Hono();
    own.use('*', errorEnvelope);
    own.get('/purge', (c) => c.json({ success: false, code: 'confirm_mismatch', error: 'Type the invite email to confirm' }, 400));
    own.get('/transfer/:code', (c) => c.json({ success: false, code: c.req.param('code'), error: c.req.param('code') }, 409));
    const ask = async (path: string, lang: string) => (await (await own.request(path, { headers: { 'X-App-Locale': lang } })).json()) as { code: string; error: string; message: string };
    const purge = { en: 'Something in this request isn’t right. Check it and try again.', ar: 'في هذا الطلب ما لا يصح. راجعه وحاول مرة أخرى.' };
    const conflict = { en: 'This changed while you were working on it. Reload and try again.', ar: 'تغيّر هذا أثناء عملك عليه. أعد التحميل وحاول مرة أخرى.' };
    for (const lang of ['en', 'ar'] as const) {
      const p = await ask('/purge', lang);
      assert.deepEqual([p.code, p.error, p.message], ['confirm_mismatch', 'Type the invite email to confirm', purge[lang]]);
      for (const code of ['channel_is_live', 'channel_has_support', 'new_owner_banned', 'new_owner_channel_limit', 'already_owner', 'transfer_in_progress', 'transfer_unfinished', 'channel_suspended']) {
        const t = await ask(`/transfer/${code}`, lang);
        assert.deepEqual([t.code, t.error, t.message], [code, code, conflict[lang]]);
      }
    }
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
