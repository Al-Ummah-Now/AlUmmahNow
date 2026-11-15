/**
 * admin-api /api/media/backfill/*: media:manage only, every change audited before it reaches api-videos,
 * bad input never forwarded, the admin as the actor, and the Errors page's Retry paths allowlisted.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import mediaRouter, { MEDIA_BACKFILL_AUDIT_PREFIX, MEDIA_BUNNY_RETIRE_AUDIT_PREFIX, MEDIA_SETTINGS_AUDIT_KEY, MEDIA_VIDEO_AUDIT_PREFIX } from '../src/routers/media.router';
import { SERVICE_RETRIES } from '../src/lib/errors-actions';
import { STEP_UP_ROUTES } from '../src/middleware/step-up-routes';
import { sqliteD1 } from './d1-sqlite';

const RUN = 'bf-20261114-abcdef12';
const VID = '912859ed-e618-4d04-8438-874a74a251dd';
const CH = 'c0ffee00-1111-2222-3333-444455556666';

type Answer = (path: string, method: string, body: any) => { status: number; json: unknown };
const ok = (result: unknown) => ({ status: 200, json: { success: true, result } });
const fine: Answer = (path) => (path === '/internal/media/providers' ? ok({ settings: { version: 2 } }) : ok({ run: { id: RUN } }));

function setup(roles: string[], answer: Answer = fine) {
  const calls: { path: string; method: string; body: any }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const method = init?.method ?? 'GET';
        calls.push({ path: url.pathname + url.search, method, body });
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
const BF = '/internal/media/backfill';

describe('/api/media/backfill runs', () => {
  it('moderators are refused before api-videos is called', async () => {
    const { req, calls } = setup(['Moderator']);
    assert.equal((await req('/api/media/backfill/runs')).status, 403);
    assert.equal((await req('/api/media/backfill/overview')).status, 403);
    assert.equal((await req('/api/media/backfill/runs', send('POST', { scope: { kind: 'all' } }))).status, 403);
    assert.equal((await req(`/api/media/backfill/runs/${RUN}/start`, send('POST', {}))).status, 403);
    assert.equal(calls.length, 0);
  });

  it('the overview is a read that passes through and audits nothing', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/overview')).status, 200);
    assert.deepEqual(calls.map((c) => c.path), [`${BF}/overview`]);
    assert.equal(audit.length, 0);
  });

  it('a new estimate is audited and carries the admin, not a spoofed actor', async () => {
    const { req, calls, audit } = setup(['Admin']);
    const res = await req('/api/media/backfill/runs', send('POST', { scope: { kind: 'channel', channelId: CH }, actorId: 'spoofed' }));
    assert.equal(res.status, 201);
    assert.equal(calls[0]!.path, `${BF}/runs`);
    assert.equal(calls[0]!.body.actorId, 'admin-1');
    assert.deepEqual(calls[0]!.body.scope, { kind: 'channel', channelId: CH });
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, `${MEDIA_BACKFILL_AUDIT_PREFIX}new`);
    assert.equal(rows[0].actor_id, 'admin-1');
  });

  it('reads pass through with their query; bad ids never leave admin-api', async () => {
    const { req, calls } = setup(['Admin']);
    assert.equal((await req(`/api/media/backfill/runs/${RUN}/items?state=failed&cursor=${VID}&evil=1`)).status, 200);
    assert.equal(calls[0]!.path, `${BF}/runs/${RUN}/items?state=failed&cursor=${VID}`);
    assert.equal((await req('/api/media/backfill/runs/bad!id')).status, 400);
    assert.equal((await req('/api/media/backfill/runs', send('POST', {}))).status, 400);
    assert.equal(calls.length, 1);
  });

  it('start, pause, cancel, retry-failed and settings are audited per run', async () => {
    const { req, calls, audit } = setup(['Super Admin']);
    for (const action of ['start', 'pause', 'cancel', 'retry-failed']) assert.equal((await req(`/api/media/backfill/runs/${RUN}/${action}`, send('POST', {}))).status, 200);
    assert.equal((await req(`/api/media/backfill/runs/${RUN}/settings`, send('PUT', { settings: { concurrency: 3, budgetUsd: 4.2 } }))).status, 200);
    assert.equal((await req(`/api/media/backfill/runs/${RUN}/explode`, send('POST', {}))).status, 404);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path}`),
      ['start', 'pause', 'cancel', 'retry-failed'].map((a) => `POST ${BF}/runs/${RUN}/${a}`).concat(`PUT ${BF}/runs/${RUN}/settings`),
    );
    const rows = await audit();
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r: any) => r.key === `${MEDIA_BACKFILL_AUDIT_PREFIX}${RUN}`));
    assert.deepEqual(JSON.parse(rows[4].new_value).settings, { concurrency: 3, budgetUsd: 4.2 });
  });

  it('a refused action (409) leaves no audit row', async () => {
    const { req, audit } = setup(['Admin'], () => ({ status: 409, json: { success: false, code: 'bad_state', error: 'Run is done' } }));
    const res = await req(`/api/media/backfill/runs/${RUN}/start`, send('POST', {}));
    assert.ok(res.status >= 400);
    assert.equal((await audit()).length, 0);
  });

  it('item Retry is audited and checks its ids', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/items/retry', send('POST', { runId: RUN, videoId: VID }))).status, 200);
    assert.deepEqual(calls[0]!.body, { runId: RUN, videoId: VID });
    assert.equal((await req('/api/media/backfill/items/retry', send('POST', { runId: RUN }))).status, 400);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse((await audit())[0].new_value).videoId, VID);
  });
});

describe('/api/media/backfill/flip (play R2 first)', () => {
  it('per video: one audit row per video', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'videos', videoIds: [VID, CH] }))).status, 200);
    assert.equal(calls[0]!.path, `${BF}/flip`);
    assert.equal(calls[0]!.body.actorId, 'admin-1');
    assert.deepEqual((await audit()).map((r: any) => r.key), [`${MEDIA_VIDEO_AUDIT_PREFIX}${VID}`, `${MEDIA_VIDEO_AUDIT_PREFIX}${CH}`]);
  });

  it('channel and global: audited under the delivery settings with the old settings', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'channel', channelId: CH }))).status, 200);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'global', undo: true }))).status, 200);
    assert.deepEqual(calls.map((c) => c.path), ['/internal/media/providers', `${BF}/flip`, '/internal/media/providers', `${BF}/flip`]);
    assert.equal(calls[3]!.body.undo, true);
    const rows = await audit();
    assert.ok(rows.every((r: any) => r.key === MEDIA_SETTINGS_AUDIT_KEY));
    assert.deepEqual(JSON.parse(rows[0].old_value), { version: 2 });
    assert.equal(JSON.parse(rows[1].new_value).action, 'r2_first_undo');
  });

  it('bad targets and ids are refused locally', async () => {
    const { req, calls } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'everything' }))).status, 400);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'videos', videoIds: [] }))).status, 400);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'videos', videoIds: ['x!'] }))).status, 400);
    assert.equal((await req('/api/media/backfill/flip', send('POST', { target: 'channel' }))).status, 400);
    assert.equal(calls.length, 0);
  });
});

describe('/api/media/backfill/libraries (retire Bunny)', () => {
  it('scheduling removals needs the typed library id and is audited', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/libraries/400189/removals', send('POST', { graceDays: 14 }))).status, 400);
    assert.equal((await req('/api/media/backfill/libraries/400189/removals', send('POST', { graceDays: 14, confirm: '498994' }))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await req('/api/media/backfill/libraries/400189/removals', send('POST', { graceDays: 14, confirm: '400189' }))).status, 200);
    assert.equal(calls[0]!.path, `${BF}/libraries/400189/removals`);
    assert.deepEqual(calls[0]!.body, { graceDays: 14, actorId: 'admin-1' });
    const rows = await audit();
    assert.equal(rows[0].key, `${MEDIA_BUNNY_RETIRE_AUDIT_PREFIX}400189`);
  });

  it('cancel and removal Retry are audited; a non-numeric library is refused', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/media/backfill/libraries/400189/removals/cancel', send('POST', {}))).status, 200);
    assert.equal((await req('/api/media/backfill/removals/retry', send('POST', { videoId: VID }))).status, 200);
    assert.equal((await req('/api/media/backfill/libraries/abc/removals')).status, 400);
    assert.equal(calls.length, 2);
    assert.deepEqual((await audit()).map((r: any) => r.key), [`${MEDIA_BUNNY_RETIRE_AUDIT_PREFIX}400189`, `${MEDIA_VIDEO_AUDIT_PREFIX}${VID}`]);
  });
});

describe('step-up', () => {
  it('retiring a Bunny library needs a recent sign-in (passkey rule), cancelling does not', () => {
    const paths = STEP_UP_ROUTES.map((r) => `${r.method} ${r.path}`);
    assert.ok(paths.includes('POST /api/media/backfill/libraries/:id/removals'));
    assert.ok(!paths.includes('POST /api/media/backfill/libraries/:id/removals/cancel'));
  });
});

describe('Errors page Retry', () => {
  it('allowlists the backfill item and Bunny removal retries', () => {
    const paths = SERVICE_RETRIES['api-videos']!.paths;
    assert.ok(paths.includes('/internal/media/backfill/items/retry'));
    assert.ok(paths.includes('/internal/media/backfill/removals/retry'));
  });
});
