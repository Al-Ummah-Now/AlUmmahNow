import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  decodeJwtPayload,
  isStaffRole,
  passkeyClaimsFromPayload,
  passkeyGate,
  passkeySetupUrl,
  signedInWithPasskey,
  stepUpVerdict,
} from '@al-ummah/shared-types';
import { passkeyMiddleware, stepUp, setupUrlFor } from '../src/middleware/passkeys';
import { registerStepUpRoutes, STEP_UP_ROUTES } from '../src/middleware/step-up-routes';

const NOW = 1_800_000_000;
const staff = { roles: ['Admin'] };

describe('staff passkey rule (shared-types staff-passkeys)', () => {
  it('reads every staff role spelling, and nothing else, as staff', () => {
    for (const role of ['Super Admin', 'Admin', 'Moderator', 'Writer', 'Content Reviewer', 'Senior Reviewer', 'super_admin']) {
      assert.equal(isStaffRole([role]), true, role);
    }
    assert.equal(isStaffRole(['Scholar', 'Member']), false);
    assert.equal(isStaffRole(undefined), false);
  });

  it('a missing or malformed amr is no passkey', () => {
    assert.equal(signedInWithPasskey(undefined), false);
    assert.equal(signedInWithPasskey('passkey'), false);
    assert.equal(signedInWithPasskey(['pwd']), false);
    assert.equal(signedInWithPasskey(['passkey']), true);
  });

  it('no deadline: ok (enforcement off)', () => {
    assert.deepEqual(passkeyGate({ ...staff, amr: ['pwd'] }, NOW), { state: 'ok' });
  });

  it('deadline in the future without a passkey: grace', () => {
    assert.deepEqual(passkeyGate({ ...staff, amr: ['pwd'], passkeyDeadline: NOW + 60 }, NOW), { state: 'grace', deadline: NOW + 60 });
  });

  it('deadline reached or past without a passkey: blocked, also with amr missing', () => {
    assert.deepEqual(passkeyGate({ ...staff, amr: ['pwd'], passkeyDeadline: NOW }, NOW), { state: 'blocked', deadline: NOW });
    assert.deepEqual(passkeyGate({ ...staff, passkeyDeadline: NOW - 1 }, NOW), { state: 'blocked', deadline: NOW - 1 });
  });

  it('a passkey sign-in passes after the deadline', () => {
    assert.deepEqual(passkeyGate({ ...staff, amr: ['passkey'], passkeyDeadline: NOW - 100 }, NOW), { state: 'ok' });
  });

  it('non-staff are never affected', () => {
    assert.deepEqual(passkeyGate({ roles: ['Scholar'], amr: ['pwd'], passkeyDeadline: NOW - 100 }, NOW), { state: 'ok' });
  });

  it('step-up: fresh passes, stale or missing auth_time does not', () => {
    assert.deepEqual(stepUpVerdict({ ...staff, authTime: NOW - 899 }, NOW), { ok: true });
    assert.deepEqual(stepUpVerdict({ ...staff, authTime: NOW - 900 }, NOW), { ok: false, reason: 'stale' });
    assert.deepEqual(stepUpVerdict({ ...staff }, NOW), { ok: false, reason: 'stale' });
  });

  it('step-up: fresh but no passkey while the rule applies (grace) asks for a passkey', () => {
    assert.deepEqual(stepUpVerdict({ ...staff, amr: ['pwd'], authTime: NOW - 10, passkeyDeadline: NOW + 3600 }, NOW), { ok: false, reason: 'passkey' });
    assert.deepEqual(stepUpVerdict({ ...staff, amr: ['passkey'], authTime: NOW - 10, passkeyDeadline: NOW + 3600 }, NOW), { ok: true });
  });

  it('reads the claims from a token payload', () => {
    const payload = { amr: ['pwd', 1], auth_time: NOW, properties: { roles: ['Admin'], passkey_deadline: NOW + 5 } };
    const token = `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
    assert.deepEqual(passkeyClaimsFromPayload(decodeJwtPayload(token)), { roles: ['Admin'], amr: ['pwd'], authTime: NOW, passkeyDeadline: NOW + 5 });
    assert.equal(decodeJwtPayload('nope'), null);
    assert.deepEqual(passkeyClaimsFromPayload(null), {});
  });

  it('builds the setup link back to the app', () => {
    assert.equal(
      passkeySetupUrl('https://auth.qa.alummahnow.net', 'https://admin.qa.alummahnow.net'),
      'https://auth.qa.alummahnow.net/passkeys/setup?return_to=https%3A%2F%2Fadmin.qa.alummahnow.net',
    );
    assert.equal(setupUrlFor({}), undefined);
  });
});

/** App with the auth context taken from test headers, then the passkey middleware and the step-up routes. */
function makeApp() {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const h = (name: string) => c.req.header(name);
    c.set('auth' as never, {
      userId: 'usr_1',
      roles: (h('x-roles') ?? 'Admin').split(','),
      payload: {
        amr: h('x-amr') ? h('x-amr')!.split(',') : undefined,
        auth_time: h('x-auth-time') ? Number(h('x-auth-time')) : undefined,
        passkey_deadline: h('x-deadline') ? Number(h('x-deadline')) : undefined,
      },
    } as never);
    await next();
  });
  app.use('/api/*', passkeyMiddleware);
  registerStepUpRoutes(app);
  app.get('/api/reports', (c) => c.json({ success: true }));
  app.post('/api/trash/:kind/:id/purge', (c) => c.json({ success: true }));
  app.post('/api/moderation/reports/:reportId/action', async (c) => c.json({ success: true, action: (await c.req.json()).action }));
  return app;
}

const env = { Issuer: 'https://auth.qa.alummahnow.net', ADMIN_WEB_URL: 'https://admin.qa.alummahnow.net' };
const now = () => Math.floor(Date.now() / 1000);

describe('passkeyMiddleware', () => {
  it('passes when enforcement is off (no deadline)', async () => {
    const res = await makeApp().request('/api/reports', { headers: { 'x-amr': 'pwd' } }, env);
    assert.equal(res.status, 200);
  });

  it('passes during the grace period', async () => {
    const res = await makeApp().request('/api/reports', { headers: { 'x-amr': 'pwd', 'x-deadline': String(now() + 3600) } }, env);
    assert.equal(res.status, 200);
  });

  it('answers 403 passkey_required with the setup link after the deadline', async () => {
    const res = await makeApp().request('/api/reports', { headers: { 'x-amr': 'pwd', 'x-deadline': String(now() - 1) } }, env);
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'passkey_required');
    assert.equal(body.setup_url, 'https://auth.qa.alummahnow.net/passkeys/setup?return_to=https%3A%2F%2Fadmin.qa.alummahnow.net');
  });

  it('passes a passkey sign-in after the deadline', async () => {
    const res = await makeApp().request('/api/reports', { headers: { 'x-amr': 'passkey', 'x-deadline': String(now() - 1) } }, env);
    assert.equal(res.status, 200);
  });
});

describe('step-up routes', () => {
  it('answers 401 step_up_required with max_age 900 for a stale sign-in', async () => {
    const res = await makeApp().request('/api/trash/theme/t1/purge', { method: 'POST', headers: { 'x-auth-time': String(now() - 3600) } }, env);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { success: false, error: 'step_up_required', code: 'step_up_required', max_age: 900 });
  });

  it('runs the action for a fresh sign-in', async () => {
    const res = await makeApp().request('/api/trash/theme/t1/purge', { method: 'POST', headers: { 'x-auth-time': String(now() - 60) } }, env);
    assert.equal(res.status, 200);
  });

  it('asks for a passkey (403, reason step_up) for a fresh password sign-in during the grace period', async () => {
    const res = await makeApp().request('/api/trash/theme/t1/purge', {
      method: 'POST',
      headers: { 'x-auth-time': String(now() - 60), 'x-amr': 'pwd', 'x-deadline': String(now() + 3600) },
    }, env);
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'passkey_required');
    assert.equal(body.reason, 'step_up');
  });

  it('a report action steps up only when it bans, and the handler still reads the body', async () => {
    const stale = { 'x-auth-time': String(now() - 3600), 'content-type': 'application/json' };
    const app = makeApp();
    const ban = await app.request('/api/moderation/reports/r1/action', { method: 'POST', headers: stale, body: JSON.stringify({ action: 'banned' }) }, env);
    assert.equal(ban.status, 401);
    const dismiss = await app.request('/api/moderation/reports/r1/action', { method: 'POST', headers: stale, body: JSON.stringify({ action: 'dismissed' }) }, env);
    assert.equal(dismiss.status, 200);
    assert.equal(((await dismiss.json()) as { action: string }).action, 'dismissed');
  });

  it('reads are never stepped up', async () => {
    const res = await makeApp().request('/api/reports', { headers: { 'x-auth-time': String(now() - 3600) } }, env);
    assert.equal(res.status, 200);
  });

  it('covers the high-risk actions of the spec that admin-api has', () => {
    const paths = STEP_UP_ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const p of [
      'POST /api/auth-requests',
      'POST /api/content/users/:id/ban',
      'POST /api/content/users/:id/unban',
      'POST /api/content/users/:id/delete-data',
      'POST /api/content/deletions/:kind/:id/purge',
      'POST /api/trash/:kind/:id/purge',
      'POST /api/status/incidents/:id/purge',
      'POST /api/invites/:id/purge',
    ]) assert.ok(paths.includes(p), p);
  });

  it('stepUp() without a predicate always checks', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('auth' as never, { roles: ['Admin'], payload: {} } as never); await next(); });
    app.post('/x', stepUp(), (c) => c.text('ran'));
    assert.equal((await app.request('/x', { method: 'POST' })).status, 401);
  });
});

describe('stepUpMaxAge', () => {
  it('is 900 s everywhere unless the local stack asks for longer, never on production or stage', async () => {
    const { stepUpMaxAge } = await import('../src/middleware/passkeys');
    assert.equal(stepUpMaxAge(undefined), 900);
    assert.equal(stepUpMaxAge({ ENVIRONMENT: 'qa' }), 900);
    assert.equal(stepUpMaxAge({ ENVIRONMENT: 'qa', STEP_UP_MAX_AGE_S: '86400' }), 86400);
    assert.equal(stepUpMaxAge({ ENVIRONMENT: 'qa', STEP_UP_MAX_AGE_S: '60' }), 900);
    assert.equal(stepUpMaxAge({ ENVIRONMENT: 'production', STEP_UP_MAX_AGE_S: '86400' }), 900);
    assert.equal(stepUpMaxAge({ ENVIRONMENT: 'stage', STEP_UP_MAX_AGE_S: '86400' }), 900);
  });
});
