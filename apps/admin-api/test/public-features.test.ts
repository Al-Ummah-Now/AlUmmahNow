/**
 * GET /public/features (lib/public-features.ts) and the newsletter's feature_off answers: www hides
 * the newsletter (footer, pages) unless it can actually send; unsubscribe keeps working regardless.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { publicFeatures, publicFeaturesRoute } from '../src/lib/public-features';
import newsletterInternal from '../src/endpoints/newsletter/NewsletterInternal';
import { sqliteD1 } from './d1-sqlite';

const queue = { sendBatch: async () => {} };
const on = { RESEND_API_KEY: 'k', INTERNAL_API_KEY: 'internal-key', CONTACT_MAIL_QUEUE: queue };

describe('publicFeatures', () => {
  it('newsletter is on when Resend, the mail queue and the internal key are all there', async () => {
    assert.deepEqual(await publicFeatures(on as never), { newsletter: true });
  });
  it('newsletter is off when any of them is missing or empty', async () => {
    assert.equal((await publicFeatures({ ...on, RESEND_API_KEY: undefined } as never)).newsletter, false);
    assert.equal((await publicFeatures({ ...on, RESEND_API_KEY: '' } as never)).newsletter, false);
    assert.equal((await publicFeatures({ ...on, INTERNAL_API_KEY: undefined } as never)).newsletter, false);
    assert.equal((await publicFeatures({ ...on, CONTACT_MAIL_QUEUE: undefined } as never)).newsletter, false);
  });
  it('reads Secrets Store bindings, and a failing binding counts as missing', async () => {
    const ok = { get: async () => 'secret' };
    const broken = { get: async () => { throw new Error('store down'); } };
    assert.equal((await publicFeatures({ ...on, RESEND_API_KEY: ok, INTERNAL_API_KEY: ok } as never)).newsletter, true);
    assert.equal((await publicFeatures({ ...on, RESEND_API_KEY: broken } as never)).newsletter, false);
  });
});

describe('GET /public/features', () => {
  const app = (env: Record<string, unknown>) => {
    const a = new Hono();
    a.get('/public/features', (c) => publicFeaturesRoute(c as never));
    return (path: string) => a.request(path, {}, env);
  };
  it('answers booleans only, cached briefly at the edge', async () => {
    const res = await app(on)('/public/features');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=30');
    assert.deepEqual(await res.json(), { newsletter: true });
  });
  it('says off when unconfigured', async () => {
    const res = await app({})('/public/features');
    assert.deepEqual(await res.json(), { newsletter: false });
  });
});

describe('/internal/newsletter while the newsletter is off', () => {
  const call = async (path: string, body: unknown, env: Record<string, unknown>) => {
    const a = new Hono();
    a.route('/internal/newsletter', newsletterInternal as never);
    return a.request(`/internal/newsletter${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'internal-key' }, body: JSON.stringify(body) }, env);
  };
  const off = { REPORTS_DB: sqliteD1(), ENVIRONMENT: 'production', INTERNAL_API_KEY: 'internal-key', TURNSTILE_MODE: 'off', CONTACT_MAIL_QUEUE: queue };
  const token = 'a'.repeat(40);

  it('subscribe and confirm answer 404 feature_off', async () => {
    for (const [path, body] of [['/subscribe', { email: 'person@example.org', locale: 'en' }], ['/confirm', { token }]] as const) {
      const res = await call(path, body, off);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { success: false, code: 'feature_off' });
    }
  });
  it('unsubscribe still works', async () => {
    const res = await call('/unsubscribe', { token }, off);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { result: { status: string } }).result.status, 'invalid');
  });
  it('still needs the internal key first', async () => {
    const a = new Hono();
    a.route('/internal/newsletter', newsletterInternal as never);
    const res = await a.request('/internal/newsletter/subscribe', { method: 'POST', body: '{}' }, off);
    assert.equal(res.status, 401);
  });
});
