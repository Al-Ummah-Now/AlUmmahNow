/**
 * /api/media/transcode-limit (concurrent R2 transcodes range, Video providers → Cloudflare R2 settings): moderators read,
 * admins change it, every change audited (old and new value) before api-videos is called and dropped
 * when it fails; Undo is audited too.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { TRANSCODE_LIMIT_AUDIT_KEY } from '@al-ummah/shared-types';
import mediaRouter, { mediaPermissionFor, parseTranscodeLimitInput } from '../src/routers/media.router';
import { hasPermission } from '../src/lib/roles';
import { sqliteD1 } from './d1-sqlite';

const VIEW = { min: 4, max: 4, effective: { min: 4, max: 4 }, ceiling: 10, isDefault: true, updatedAt: null, updatedBy: null, slotUsdPerHour: 0.4, slotUsdPerMonth: 288.75, maxUsdPerHour: 1.6 };

function setup(roles: string[], putStatus = 200) {
  const calls: { path: string; method: string; body: any }[] = [];
  let stored = { ...VIEW };
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname + url.search, method, body });
        if (url.pathname === '/internal/media/transcode-limit' && method === 'PUT') {
          if (putStatus !== 200) return new Response(JSON.stringify({ success: false, code: 'above_ceiling', error: 'refused' }), { status: putStatus });
          stored = { ...stored, min: body.min, max: body.max, effective: { min: body.min, max: body.max }, isDefault: false, updatedBy: body.actorId };
          return new Response(JSON.stringify({ success: true, result: stored }));
        }
        if (url.pathname === '/internal/media/transcode-limit') return new Response(JSON.stringify({ success: true, result: stored }));
        return new Response(JSON.stringify({ success: true, result: { live: { transcoding: 1 } } }));
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

const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('who may see and change it', () => {
  it('media:read is every admin role; media:manage admins only', () => {
    assert.equal(hasPermission(['Moderator'], 'media:read'), true);
    assert.equal(hasPermission(['Admin'], 'media:read'), true);
    assert.equal(hasPermission([], 'media:read'), false);
  });
  it('only the limit and the live figures are readable with media:read', () => {
    const q = (v?: string) => () => v;
    assert.equal(mediaPermissionFor('GET', '/api/media/transcode-limit', q()), 'media:read');
    assert.equal(mediaPermissionFor('GET', '/api/media/summary', q('live')), 'media:read');
    assert.equal(mediaPermissionFor('GET', '/api/media/summary', q()), 'media:manage');
    assert.equal(mediaPermissionFor('PUT', '/api/media/transcode-limit', q()), 'media:manage');
    assert.equal(mediaPermissionFor('GET', '/api/media/jobs', q()), 'media:manage');
  });
  it('a moderator reads the limit and the live figures, and cannot change it', async () => {
    const { req, calls, audit } = setup(['Moderator']);
    assert.equal((await req('/api/media/transcode-limit')).status, 200);
    assert.equal((await req('/api/media/summary?only=live')).status, 200);
    assert.equal((await req('/api/media/summary')).status, 403);
    assert.equal((await req('/api/media/transcode-limit', put({ min: 2, max: 6 }))).status, 403);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    assert.equal((await audit()).length, 0);
  });
});

describe('changing it', () => {
  it('an admin change is forwarded with the actor and audited with the old and new value', async () => {
    const { req, calls, audit } = setup(['Admin']);
    const res = await req('/api/media/transcode-limit', put({ min: 2, max: 6 }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).result.max, 6);
    assert.deepEqual(calls.find((c) => c.method === 'PUT')!.body, { min: 2, max: 6, actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, TRANSCODE_LIMIT_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].old_value), { min: 4, max: 4, isDefault: true });
    assert.deepEqual(JSON.parse(rows[0].new_value), { min: 2, max: 6 });
    assert.equal(rows[0].actor_id, 'admin-1');
  });
  it('Undo is a change back, audited as an undo', async () => {
    const { req, audit } = setup(['Admin']);
    await req('/api/media/transcode-limit', put({ min: 2, max: 6 }));
    assert.equal((await req('/api/media/transcode-limit', put({ min: 4, max: 4, undo: true }))).status, 200);
    const rows = await audit();
    const undo = rows.map((r: any) => JSON.parse(r.new_value)).find((v: any) => v.undo);
    assert.deepEqual(undo, { min: 4, max: 4, undo: true });
  });
  it('bad input is refused before api-videos; a refusal there leaves no audit row', async () => {
    const { req, calls } = setup(['Admin']);
    for (const bad of [{}, { min: 0, max: 4 }, { min: 2.5, max: 4 }, { min: 2, max: '4' }, { min: 5, max: 4 }, { min: 2, max: 4, undo: 'yes' }]) {
      assert.equal((await req('/api/media/transcode-limit', put(bad))).status, 400, JSON.stringify(bad));
    }
    const named = (await (await req('/api/media/transcode-limit', put({ min: 5, max: 4 }))).json()) as { field: string };
    assert.equal(named.field, 'min');
    assert.equal(calls.length, 0);
    const refused = setup(['Admin'], 400);
    assert.equal((await refused.req('/api/media/transcode-limit', put({ min: 2, max: 99 }))).status, 400);
    assert.equal((await refused.audit()).length, 0);
  });
  it('parses input', () => {
    assert.deepEqual(parseTranscodeLimitInput({ min: 2, max: 3 }), { ok: true, min: 2, max: 3, undo: false });
    assert.equal(parseTranscodeLimitInput(null).ok, false);
  });
});
