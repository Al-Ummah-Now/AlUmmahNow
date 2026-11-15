/**
 * /api/youtube-import/* (Move from YouTube settings, wiki AUN-YT-IMPORT):
 * media:manage permission, forwarding to api-videos' /internal/youtube-import,
 * the audit row written first and dropped when api-videos fails, validation,
 * and the Errors page's Retry path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import youtubeImportRouter, { YOUTUBE_IMPORT_SECRET_AUDIT_KEY, YOUTUBE_IMPORT_SETTINGS_AUDIT_KEY, parseYoutubeImportSettings } from '../src/routers/youtubeImport.router';
import { SERVICE_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const VIEW = { enabled: false, clientId: '', updatedAt: null, updatedBy: null, secretPresent: true, redirectUri: 'https://videos.api.qa.alummahnow.net/api/youtube-import/oauth/callback', scopes: [], ready: false };

function setup(roles: string[], failPut = false) {
  const calls: { path: string; method: string; body: any }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname, method, body });
        if (method === 'PUT' && failPut) return new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 });
        const result =
          method !== 'PUT'
            ? VIEW
            : url.pathname.endsWith('/client-secret')
              ? { ...VIEW, secretPresent: true, secretSource: 'admin', secretUpdatedAt: '2026-11-15T00:00:00Z', secretUpdatedBy: body.actorId }
              : { ...VIEW, enabled: body.enabled ?? VIEW.enabled, clientId: body.clientId ?? VIEW.clientId };
        return new Response(JSON.stringify({ success: true, result }), { status: 200 });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/youtube-import', youtubeImportRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log').all<any>()).results ?? [];
  return { req, calls, audit };
}

const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/youtube-import/settings', () => {
  it('refuses moderators before calling api-videos', async () => {
    const { req, calls } = setup(['Moderator']);
    assert.equal((await req('/api/youtube-import/settings')).status, 403);
    assert.equal((await req('/api/youtube-import/settings', put({ enabled: true }))).status, 403);
    assert.equal(calls.length, 0);
  });

  it('reads the view, never a secret', async () => {
    const { req, calls } = setup(['Admin']);
    const res = await req('/api/youtube-import/settings');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: Record<string, unknown> };
    assert.equal(body.result.secretPresent, true);
    assert.equal('secret' in body.result, false);
    assert.equal(calls[0].path, '/internal/youtube-import/settings');
  });

  it('changes and audits old and new value with the actor', async () => {
    const { req, calls, audit } = setup(['Super Admin']);
    const res = await req('/api/youtube-import/settings', put({ enabled: true, clientId: CLIENT_ID }));
    assert.equal(res.status, 200);
    const sent = calls.find((c) => c.method === 'PUT')!;
    assert.deepEqual(sent.body, { enabled: true, clientId: CLIENT_ID, actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, YOUTUBE_IMPORT_SETTINGS_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].old_value), { enabled: false, clientId: '' });
    assert.deepEqual(JSON.parse(rows[0].new_value), { enabled: true, clientId: CLIENT_ID });
    assert.equal(rows[0].actor_id, 'admin-1');
  });

  it('drops the audit row when api-videos fails', async () => {
    const { req, audit } = setup(['Admin'], true);
    const res = await req('/api/youtube-import/settings', put({ enabled: true }));
    assert.equal(res.status, 500);
    assert.equal((await audit()).length, 0);
  });

  it('validates the change', () => {
    assert.deepEqual(parseYoutubeImportSettings({ enabled: true }), { ok: true, value: { enabled: true } });
    assert.deepEqual(parseYoutubeImportSettings({ clientId: '' }), { ok: true, value: { clientId: '' } });
    assert.equal(parseYoutubeImportSettings({ enabled: 'yes' }).ok, false);
    assert.equal(parseYoutubeImportSettings({ clientId: 'not-a-client' }).ok, false);
    assert.equal(parseYoutubeImportSettings({}).ok, false);
    assert.equal(parseYoutubeImportSettings(null).ok, false);
  });

  it('lets the Errors page retry a step that gave up', () => {
    assert.ok(SERVICE_RETRIES['api-videos']!.paths.includes('/internal/youtube-import/retry'));
  });
});

describe('/api/youtube-import/client-secret', () => {
  const SECRET = 'test-only-abcdefghijklmnopqrstuvwxyz12';

  it('refuses moderators before calling api-videos', async () => {
    const { req, calls, audit } = setup(['Moderator']);
    assert.equal((await req('/api/youtube-import/client-secret', put({ value: SECRET }))).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await audit()).length, 0);
  });

  it('forwards the value once, audits only present/missing, and never returns it', async () => {
    const { req, calls, audit } = setup(['Admin']);
    const res = await req('/api/youtube-import/client-secret', put({ value: SECRET }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes(SECRET), false, 'the response never carries the secret');
    assert.equal(JSON.parse(text).result.secretSource, 'admin');
    const sent = calls.find((c) => c.method === 'PUT')!;
    assert.equal(sent.path, '/internal/youtube-import/client-secret');
    assert.deepEqual(sent.body, { value: SECRET, actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, YOUTUBE_IMPORT_SECRET_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].old_value), { secret: 'present', source: null });
    assert.deepEqual(JSON.parse(rows[0].new_value), { secret: 'replaced', source: 'admin' });
    assert.equal(JSON.stringify(rows).includes(SECRET), false, 'the audit log never holds the secret');
  });

  it('refuses a value that cannot be a client secret, without auditing or calling api-videos', async () => {
    const { req, calls, audit } = setup(['Admin']);
    for (const value of ['short', 'has spaces in the middle of it', 'unset', 42, '']) {
      assert.equal((await req('/api/youtube-import/client-secret', put({ value }))).status, 400);
    }
    assert.equal((await req('/api/youtube-import/client-secret', put(null))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await audit()).length, 0);
  });

  it('drops the audit row when api-videos fails', async () => {
    const { req, audit } = setup(['Admin'], true);
    assert.equal((await req('/api/youtube-import/client-secret', put({ value: SECRET }))).status, 500);
    assert.equal((await audit()).length, 0);
  });
});
