/**
 * /api/media/* (Delivery comparison, epic #687): media:manage permission,
 * forwarding to api-videos' /internal/media over the VIDEOS binding, audit
 * rows written first and dropped when api-videos fails, input validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import mediaRouter, { MEDIA_SETTINGS_AUDIT_KEY, MEDIA_VIDEO_AUDIT_PREFIX, parseSettingsInput } from '../src/routers/media.router';
import { hasPermission } from '../src/lib/roles';
import { SERVICE_RETRIES } from '../src/lib/errors-actions';
import { DEFAULT_MEDIA_SETTINGS } from '@al-ummah/shared-types';
import { sqliteD1 } from './d1-sqlite';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const SETTINGS = { mode: 'bunny', r2Percent: 10, assign: 'video', transcode: true };

type Answer = (path: string, method: string, body: any) => { status: number; json: unknown };
const ok = (result: unknown) => ({ status: 200, json: { success: true, result } });

function setup(roles: string[], answer: Answer = (path, method, body) => (path.endsWith('/settings') ? ok(method === 'PUT' ? { ...SETTINGS, ...body } : SETTINGS) : ok({ ok: true }))) {
  const calls: { path: string; method: string; body: any; key: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const method = init?.method ?? 'GET';
        calls.push({ path: url.pathname + url.search, method, body, key: new Headers(init?.headers).get('X-API-Key') });
        const r = answer(url.pathname, method, body);
        return new Response(JSON.stringify(r.json), { status: r.status });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/media', mediaRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log').all<any>()).results ?? [];
  return { req, calls, audit };
}

const send = (method: string, json: unknown): RequestInit => ({ method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('media:manage', () => {
  it('is granted to admins and super admins only', () => {
    assert.equal(hasPermission(['Admin'], 'media:manage'), true);
    assert.equal(hasPermission(['Super Admin'], 'media:manage'), true);
    assert.equal(hasPermission(['Moderator'], 'media:manage'), false);
    assert.equal(hasPermission([], 'media:manage'), false);
  });
});

describe('/api/media', () => {
  it('refuses moderators before calling api-videos', async () => {
    const { req, calls } = setup(['moderator']);
    for (const path of ['/api/media/summary', '/api/media/jobs', '/api/media/settings']) assert.equal((await req(path)).status, 403);
    assert.equal((await req('/api/media/retry', send('POST', { ids: [ID] }))).status, 403);
    assert.equal(calls.length, 0);
  });

  it('summary forwards a clamped period with the internal key', async () => {
    const { req, calls } = setup(['Admin']);
    assert.equal((await req('/api/media/summary?days=7')).status, 200);
    assert.equal(calls[0].path, '/internal/media/summary?days=7');
    assert.equal(calls[0].key, 'k');
    await req('/api/media/summary?days=9999');
    assert.equal(calls[1].path, '/internal/media/summary?days=120');
    await req('/api/media/summary');
    assert.equal(calls[2].path, '/internal/media/summary?days=30');
  });

  it('summary passes the live figures through, and asks for them alone with only=live', async () => {
    const live = { transcoding: 1, queued: 3, maxTranscodes: 2, oldestQueuedAt: '2026-11-11T11:45:00.000Z', oldestQueuedSeconds: 900, at: '2026-11-11T12:00:00.000Z' };
    const { req, calls } = setup(['Admin'], (path) => (path.endsWith('/summary') ? ok({ days: 30, jobs: null, qoe: [], costs: [], live }) : ok({})));
    const body = (await (await req('/api/media/summary')).json()) as { result: { live: unknown } };
    assert.deepEqual(body.result.live, live);
    await req('/api/media/summary?only=live');
    assert.equal(calls[1].path, '/internal/media/summary?days=30&only=live');
    await req('/api/media/summary?only=everything');
    assert.equal(calls[2].path, '/internal/media/summary?days=30');
  });

  it('jobs forwards the status filter and refuses unknown ones', async () => {
    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/media/jobs?status=failed&limit=20')).status, 200);
    assert.equal(calls[0].path, '/internal/media/jobs?status=failed&limit=20');
    assert.equal((await req('/api/media/jobs?status=weird')).status, 400);
    assert.equal(calls.length, 1);
  });

  it('retry is audited per video before the call', async () => {
    const { req, calls, audit } = setup(['super_admin']);
    const other = 'abcdef12-3456';
    assert.equal((await req('/api/media/retry', send('POST', { ids: [ID, other, ID] }))).status, 200);
    assert.deepEqual(calls[0].body, { ids: [ID, other] });
    assert.equal(calls[0].path, '/internal/media/retry');
    const rows = await audit();
    assert.deepEqual(rows.map((r) => r.key).sort(), [`${MEDIA_VIDEO_AUDIT_PREFIX}${ID}`, `${MEDIA_VIDEO_AUDIT_PREFIX}${other}`].sort());
    assert.equal(JSON.parse(rows[0].new_value).action, 'transcode_again');
    assert.equal(rows[0].actor_id, 'admin-1');
  });

  it('retry refuses bad ids; a failed retry leaves no audit row', async () => {
    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/media/retry', send('POST', { ids: ['../etc'] }))).status, 400);
    assert.equal((await req('/api/media/retry', send('POST', { ids: [] }))).status, 400);
    assert.equal(calls.length, 0);
    const failing = setup(['admin'], () => ({ status: 500, json: { success: false, error: 'boom' } }));
    const res = await failing.req('/api/media/retry', send('POST', { ids: [ID] }));
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as any).error, 'boom');
    assert.equal((await failing.audit()).length, 0);
  });

  it('settings change is audited with the old and new value; actorId is the admin', async () => {
    const { req, calls, audit } = setup(['admin']);
    const res = await req('/api/media/settings', send('PUT', { mode: 'split', r2Percent: 25, actorId: 'spoofed' }));
    assert.equal(res.status, 200);
    const put = calls.find((c) => c.method === 'PUT')!;
    assert.deepEqual(put.body, { mode: 'split', r2Percent: 25, actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, MEDIA_SETTINGS_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].old_value), SETTINGS);
    assert.deepEqual(JSON.parse(rows[0].new_value), { ...SETTINGS, mode: 'split', r2Percent: 25 });
  });

  it('a failed settings write leaves no audit row; bad input never reaches api-videos', async () => {
    const failing = setup(['admin'], (path, method) => (method === 'PUT' ? { status: 503, json: { success: false, error: 'down' } } : ok(SETTINGS)));
    assert.equal((await failing.req('/api/media/settings', send('PUT', { mode: 'r2' }))).status, 503);
    assert.equal((await failing.audit()).length, 0);

    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/media/settings', send('PUT', { mode: 'everything' }))).status, 400);
    assert.equal((await req('/api/media/settings', send('PUT', {}))).status, 400);
    assert.equal(calls.length, 0);
  });
});

describe('parseSettingsInput', () => {
  it('keeps valid fields and refuses out-of-range ones', () => {
    assert.deepEqual(parseSettingsInput({ mode: 'r2', assign: 'view', transcode: false, r2Percent: 0 }), { ok: true, value: { mode: 'r2', assign: 'view', transcode: false, r2Percent: 0 } });
    assert.equal(parseSettingsInput({ r2Percent: 101 }).ok, false);
    assert.equal(parseSettingsInput({ r2Percent: 12.5 }).ok, false);
    assert.equal(parseSettingsInput({ assign: 'user' }).ok, false);
    assert.equal(parseSettingsInput({ transcode: 'yes' }).ok, false);
  });
});

describe('/api/media/providers (provider settings)', () => {
  const PROVIDERS = { ...DEFAULT_MEDIA_SETTINGS };
  const answer: Answer = (path, method, body) => {
    if (path === '/internal/media/providers') return ok(method === 'PUT' ? { settings: body.settings, problems: [] } : { settings: PROVIDERS, health: null, problems: [] });
    if (path === '/internal/media/health/check') return ok({ providers: {}, checkedAt: 'x' });
    return ok({});
  };

  it('a change is audited (old and new settings) and forwarded with the admin as the actor', async () => {
    const { req, calls, audit } = setup(['Admin'], answer);
    const next = { ...PROVIDERS, playback: { ...PROVIDERS.playback, order: ['r2', 'bunny'] } };
    const res = await req('/api/media/providers', send('PUT', { settings: next, actorId: 'spoofed' }));
    assert.equal(res.status, 200);
    const put = calls.find((c) => c.method === 'PUT')!;
    assert.equal(put.body.actorId, 'admin-1');
    assert.deepEqual(put.body.settings.playback.order, ['r2', 'bunny']);
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, MEDIA_SETTINGS_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].old_value).playback.order, ['bunny']);
    assert.deepEqual(JSON.parse(rows[0].new_value).playback.order, ['r2', 'bunny']);
  });

  it('unsafe settings are refused with their problems before reaching api-videos', async () => {
    const { req, calls } = setup(['Admin'], answer);
    const res = await req('/api/media/providers', send('PUT', { settings: { ...PROVIDERS, providers: { bunny: { enabled: false }, r2: { enabled: false } } } }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { problems: { problem: string }[] };
    assert.ok(body.problems.some((p) => p.problem === 'no_provider_enabled'));
    assert.equal(calls.length, 0);
    assert.equal((await req('/api/media/providers', send('PUT', { settings: 'r2' }))).status, 400);
  });

  it('api-videos refusing passes its problems through and leaves no audit row', async () => {
    const refusing: Answer = (path, method) =>
      method === 'PUT' ? { status: 400, json: { success: false, error: 'Settings refused', problems: [{ problem: 'ingest_not_playable' }] } } : answer(path, method, null);
    const { req, audit } = setup(['Admin'], refusing);
    const res = await req('/api/media/providers', send('PUT', { settings: PROVIDERS }));
    assert.equal(res.status, 400);
    assert.deepEqual(((await res.json()) as { problems: unknown }).problems, [{ problem: 'ingest_not_playable' }]);
    assert.equal((await audit()).length, 0);
  });

  it('health check is forwarded; moderators get neither route', async () => {
    const { req, calls } = setup(['Admin'], answer);
    assert.equal((await req('/api/media/health/check', { method: 'POST' })).status, 200);
    assert.equal(calls[0]!.path, '/internal/media/health/check');
    const mod = setup(['Moderator'], answer);
    assert.equal((await mod.req('/api/media/providers')).status, 403);
    assert.equal((await mod.req('/api/media/health/check', { method: 'POST' })).status, 403);
  });

  it('the Errors page "Check now" may call the health check', () => {
    assert.ok(SERVICE_RETRIES['api-videos']!.paths.includes('/internal/media/health/check'));
  });
});

describe('/api/media/videos/:id/override (per-video playback)', () => {
  const PATH = `/internal/media/videos/${ID}/override`;
  const answer: Answer = (path, method, body) => (path === PATH && method === 'PUT' ? ok({ override: body.override, media: null }) : ok({}));

  it('is audited per video and forwarded with the admin as the actor', async () => {
    const { req, calls, audit } = setup(['Admin'], answer);
    const res = await req(`/api/media/videos/${ID}/override`, send('PUT', { override: { order: ['r2', 'bunny'] }, actorId: 'spoofed' }));
    assert.equal(res.status, 200);
    assert.equal(calls[0]!.path, PATH);
    assert.equal(calls[0]!.body.actorId, 'admin-1');
    assert.deepEqual(calls[0]!.body.override, { order: ['r2', 'bunny'] });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${MEDIA_VIDEO_AUDIT_PREFIX}${ID}`);
    assert.equal(JSON.parse(rows[0].new_value).action, 'playback_override');
  });

  it('null clears; bad ids and bodies never reach api-videos; moderators are refused', async () => {
    const { req, calls } = setup(['Admin'], answer);
    assert.equal((await req(`/api/media/videos/${ID}/override`, send('PUT', { override: null }))).status, 200);
    assert.equal(calls[0]!.body.override, null);
    assert.equal((await req('/api/media/videos/bad!id/override', send('PUT', { override: null }))).status, 400);
    assert.equal((await req(`/api/media/videos/${ID}/override`, send('PUT', { override: ['r2'] }))).status, 400);
    assert.equal((await req(`/api/media/videos/${ID}/override`, send('PUT', {}))).status, 400);
    assert.equal(calls.length, 1);
    const mod = setup(['Moderator'], answer);
    assert.equal((await mod.req(`/api/media/videos/${ID}/override`, send('PUT', { override: null }))).status, 403);
  });

  it('an unplayable override passes the problem through and leaves no audit row', async () => {
    const refusing: Answer = () => ({ status: 400, json: { success: false, error: 'unplayable', problem: 'not_playable', problems: [{ problem: 'not_playable' }] } });
    const { req, audit } = setup(['Admin'], refusing);
    const res = await req(`/api/media/videos/${ID}/override`, send('PUT', { override: { order: ['r2'] } }));
    assert.equal(res.status, 400);
    assert.deepEqual(((await res.json()) as { problems: unknown }).problems, [{ problem: 'not_playable' }]);
    assert.equal((await audit()).length, 0);
  });
});
