/**
 * /api/processing/*: permission, audit-first (dropped when api-videos fails),
 * dry-run preview vs apply, forwarding to api-videos over the VIDEOS binding.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import processingRouter, { PROCESSING_AUDIT_PREFIX } from '../src/routers/processing.router';
import { sqliteD1 } from './d1-sqlite';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';

function setup(roles: string[], answer: (path: string, body: any) => { status: number; json: unknown } = () => ({ status: 200, json: { success: true, result: { ok: true } } })) {
  const calls: { path: string; method: string; body: any; key: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname + url.search, method: init?.method ?? 'GET', body, key: new Headers(init?.headers).get('X-API-Key') });
        const r = answer(url.pathname, body);
        return new Response(JSON.stringify(r.json), { status: r.status });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/processing', processingRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, new_value, actor_id FROM site_settings_log').all<any>()).results ?? [];
  return { req, calls, audit };
}

const post = (json: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/processing', () => {
  it('needs videos:processing (moderators are refused)', async () => {
    const { req, calls } = setup(['moderator']);
    assert.equal((await req('/api/processing/videos')).status, 403);
    assert.equal(calls.length, 0);
  });

  it('lists stuck videos through the VIDEOS binding with the internal key and Bunny status', async () => {
    const { req, calls } = setup(['Admin']);
    const res = await req('/api/processing/videos?status=stuck');
    assert.equal(res.status, 200);
    assert.equal(calls[0].path, '/internal/processing/videos?status=stuck&bunny=1');
    assert.equal(calls[0].key, 'k');
  });

  it('sync dry run previews without an audit row; apply is audited', async () => {
    const { req, calls, audit } = setup(['super_admin']);
    await req('/api/processing/sync', post({ ids: [ID] }));
    assert.deepEqual(calls[0].body, { ids: [ID], dryRun: true });
    assert.equal((await audit()).length, 0);

    await req('/api/processing/sync', post({ ids: [ID], dryRun: false }));
    assert.deepEqual(calls[1].body, { ids: [ID], dryRun: false });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${PROCESSING_AUDIT_PREFIX}${ID}`);
    assert.equal(JSON.parse(rows[0].new_value).action, 'sync_from_bunny');
    assert.equal(rows[0].actor_id, 'admin-1');
  });

  it('a failed action leaves no audit row and passes the error on', async () => {
    const { req, audit } = setup(['admin'], () => ({ status: 500, json: { success: false, error: 'boom' } }));
    const res = await req('/api/processing/retry', post({ ids: [ID] }));
    assert.equal(res.status, 500);
    assert.equal((await audit()).length, 0);
  });

  it('mark failed records the reason; bad ids are refused', async () => {
    const { req, calls, audit } = setup(['admin']);
    await req('/api/processing/mark-failed', post({ ids: [ID], reason: 'Bytes incomplete' }));
    assert.deepEqual(calls[0].body, { ids: [ID], reason: 'Bytes incomplete' });
    assert.deepEqual(JSON.parse((await audit())[0].new_value), { action: 'mark_failed', details: { reason: 'Bytes incomplete' } });
    assert.equal((await req('/api/processing/retry', post({ ids: ['../etc'] }))).status, 400);
    assert.equal((await req('/api/processing/retry', post({ ids: [] }))).status, 400);
  });

  it('audit lists actions newest first, per video', async () => {
    const { req } = setup(['admin']);
    await req('/api/processing/retry', post({ ids: [ID] }));
    const res = (await (await req(`/api/processing/audit?videoId=${ID}`)).json()) as any;
    assert.equal(res.result.entries[0].action, 'retry_processing');
    assert.equal(res.result.entries[0].videoId, ID);
  });
  it('thumbnail check: dry run is unaudited, applying is audited under one key', async () => {
    const { req, calls, audit } = setup(['admin']);
    const dry = await req('/api/processing/thumbnails', post({}));
    assert.equal(dry.status, 202);
    assert.equal(calls[0].path, '/internal/processing/thumbnails');
    assert.deepEqual(calls[0].body, { dryRun: true, actorId: 'admin-1' });
    assert.equal((await audit()).length, 0);

    await req('/api/processing/thumbnails', post({ dryRun: false, ids: [ID] }));
    assert.deepEqual(calls[1].body, { dryRun: false, actorId: 'admin-1', ids: [ID] });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${PROCESSING_AUDIT_PREFIX}thumbnail-repair`);
    assert.equal(JSON.parse(rows[0].new_value).action, 'repair_thumbnails');
    assert.equal((await req('/api/processing/thumbnails', post({ ids: ['../x'] }))).status, 400);
  });

  it('thumbnail runs list and retry go through to api-videos; moderators are refused', async () => {
    const { req, calls, audit } = setup(['admin']);
    assert.equal((await req('/api/processing/thumbnails')).status, 200);
    assert.equal(calls[0].path, '/internal/processing/thumbnails');
    const job = '0b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    assert.equal((await req(`/api/processing/thumbnails/${job}/retry`, { method: 'POST' })).status, 200);
    assert.equal(calls[1].path, `/internal/processing/thumbnails/${job}/retry`);
    assert.equal(JSON.parse((await audit())[0].new_value).action, 'retry_thumbnail_repair');
    assert.equal((await req('/api/processing/thumbnails/nope/retry', { method: 'POST' })).status, 400);
    const mod = setup(['moderator']);
    assert.equal((await mod.req('/api/processing/thumbnails', post({}))).status, 403);
  });

  it('index rebuild is audited and goes through to api-videos; bad kinds and moderators are refused', async () => {
    const { req, calls, audit } = setup(['admin']);
    const res = await req('/api/processing/index-rebuild', post({ kind: 'video' }));
    assert.equal(res.status, 202);
    assert.equal(calls[0].path, '/internal/processing/index-rebuild');
    assert.deepEqual(calls[0].body, { kind: 'video', actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${PROCESSING_AUDIT_PREFIX}ownership-index`);
    assert.equal(JSON.parse(rows[0].new_value).action, 'rebuild_ownership_index');
    assert.equal((await req('/api/processing/index-rebuild', post({ kind: 'posts' }))).status, 400);
    assert.equal(calls.length, 1);
    const mod = setup(['moderator']);
    assert.equal((await mod.req('/api/processing/index-rebuild', post({ kind: 'video' }))).status, 403);
  });

  it('a search table rebuild goes through with its search:<entity> kind', async () => {
    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/processing/index-rebuild', post({ kind: 'search:playlist' }))).status, 202);
    assert.deepEqual(calls[0].body, { kind: 'search:playlist', actorId: 'admin-1' });
    assert.equal((await req('/api/processing/index-rebuild', post({ kind: 'search:profile' }))).status, 400);
  });

  it('index repair retry (one or all) is audited and goes through; bad targets and moderators are refused', async () => {
    const { req, calls, audit } = setup(['admin']);
    assert.equal((await req('/api/processing/index-repairs/retry', post({ entity: 'video', id: 'abc12345' }))).status, 200);
    assert.equal(calls[0].path, '/internal/processing/index-repairs/retry');
    assert.deepEqual(calls[0].body, { entity: 'video', id: 'abc12345' });
    assert.equal((await req('/api/processing/index-repairs/retry', post({}))).status, 200);
    assert.deepEqual(calls[1].body, {});
    const rows = await audit();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].key, `${PROCESSING_AUDIT_PREFIX}index-repairs`);
    assert.equal(JSON.parse(rows[0].new_value).action, 'retry_index_repairs');
    assert.equal((await req('/api/processing/index-repairs/retry', post({ entity: 'comment', id: 'x' }))).status, 400);
    assert.equal((await req('/api/processing/index-repairs/retry', post({ entity: 'video' }))).status, 400);
    assert.equal(calls.length, 2);
    const mod = setup(['moderator']);
    assert.equal((await mod.req('/api/processing/index-repairs/retry', post({}))).status, 403);
  });
});
