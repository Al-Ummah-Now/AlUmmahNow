/**
 * /api/discovery (wiki E07 "Discovery ranking"): admins pin videos and channels into the ranked
 * lists, keep them off, order the home page rails and rank now; moderators only read. Every change
 * is audited (and the audit row dropped when the change fails), and a pin or exclusion queues a
 * ranking run on api-videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import router, { homeRailsView, parseTarget } from '../src/routers/discovery.router';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  };
  const statement = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (exec(sql, args).results[0] as unknown) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => statement(sql), batch: async (list: any[]) => list.map((s) => s._exec()) };
}

function setup(roles: string[]) {
  const search = searchD1();
  search.raw.exec(`INSERT INTO search_videos (id, channel_id, payload) VALUES ('vid-1', 'ch-1', '{"title":"Tafsir of Al-Fatiha","titleLocalized":{"ar":"تفسير الفاتحة"},"thumbnailUrl":"https://img/1.jpg"}')`);
  search.raw.exec(`INSERT INTO search_channels (id, payload) VALUES ('ch-1', '{"name":"Sheikh Channel","avatarUrl":"https://img/c.jpg"}')`);
  search.raw.exec(`INSERT INTO content_ownership (kind, id, owner_id, handle) VALUES ('channel', 'ch-1', 'u1', 'SheikhChannel')`);
  const reports = sqliteD1();
  const calls: string[] = [];
  const env = {
    SEARCH_DB: search,
    REPORTS_DB: reports,
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const path = new URL(input).pathname;
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path === '/internal/discovery/status') return Response.json({ success: true, result: { lastRun: null, jobs: [], rails: [] } });
        if (path === '/internal/discovery/rank') return Response.json({ success: true, result: { job: { id: 'j1' }, existing: false } }, { status: 202 });
        return Response.json({ success: true, result: { rail: 'top', scope: '', meta: null, items: [] } });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/discovery', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const send = (method: string, json?: unknown): RequestInit => ({ method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }) });
  const audit = async () =>
    ((await reports.prepare("SELECT key, new_value FROM site_settings_log WHERE key LIKE 'content:discovery:%' ORDER BY created_at, rowid").all<any>()).results ?? []).map((r: any) => ({ key: r.key, action: JSON.parse(r.new_value).action }));
  const state = async () => ((await (await req('/api/discovery')).json()) as any).result;
  return { req, send, audit, state, search, calls };
}

describe('/api/discovery', () => {
  it('moderators read everything and change nothing', async () => {
    const { req, send, state, audit } = setup(['moderator']);
    const s = await state();
    assert.equal(s.canManage, false);
    assert.deepEqual(s.homeRails.map((r: any) => r.rail), ['featured', 'trending', 'new', 'popular', 'categories']);
    for (const [path, init] of [
      ['/api/discovery/pins', send('POST', { rail: 'featured', kind: 'video', target: 'vid-1', position: 1 })],
      ['/api/discovery/exclusions', send('POST', { kind: 'video', target: 'vid-1' })],
      ['/api/discovery/home-rails', send('PUT', { rails: [] })],
      ['/api/discovery/run', send('POST', {})],
    ] as const) {
      assert.equal((await req(path, init)).status, 403, path);
    }
    assert.deepEqual(await audit(), []);
  });

  it('an admin pins a video: stored, named, audited, and a ranking run is queued', async () => {
    const { req, send, state, audit, calls } = setup(['admin']);
    const res = await req('/api/discovery/pins', send('POST', { rail: 'featured', kind: 'video', target: 'vid-1', position: 2, note: 'Ramadan' }));
    assert.equal(res.status, 201, await res.clone().text());
    const { pin, ranking } = ((await res.json()) as any).result;
    assert.equal(ranking, true);
    assert.equal(pin.title, 'Tafsir of Al-Fatiha');
    assert.equal(pin.titleLocalized.ar, 'تفسير الفاتحة');
    assert.equal(pin.state, 'active');
    assert.deepEqual(await audit(), [{ key: 'content:discovery:video:vid-1', action: 'discovery.pin' }]);
    assert.ok(calls.includes('POST /internal/discovery/rank'));
    assert.equal((await state()).pins.length, 1);
    // The same place twice is refused
    assert.equal((await req('/api/discovery/pins', send('POST', { rail: 'featured', kind: 'video', target: 'vid-1', position: 1 }))).status, 409);
  });

  it('a channel is found by its picker id or @handle; unknown targets and bad input are refused without an audit row', async () => {
    const { req, send, audit } = setup(['admin']);
    assert.equal((await req('/api/discovery/pins', send('POST', { rail: 'category:fiqh', kind: 'channel', target: '@sheikhchannel', position: 1 }))).status, 201);
    assert.equal((await req('/api/discovery/pins', send('POST', { rail: 'trending', kind: 'video', target: 'nope', position: 1 }))).status, 404);
    assert.equal((await req('/api/discovery/pins', send('POST', { rail: 'sideways', kind: 'video', target: 'vid-1', position: 1 }))).status, 400);
    assert.equal((await req('/api/discovery/pins', send('POST', { rail: 'trending', kind: 'video', target: 'vid-1', position: 99 }))).status, 400);
    const window = await req('/api/discovery/pins', send('POST', { rail: 'trending', kind: 'video', target: 'vid-1', position: 1, startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }));
    assert.equal(window.status, 400);
    assert.equal(((await window.json()) as any).code, 'invalid_window');
    assert.deepEqual((await audit()).map((a) => a.key), ['content:discovery:channel:ch-1']);
  });

  it('edits and removes a pin; the removed pin comes back for Undo', async () => {
    const { req, send, audit } = setup(['admin']);
    const created = ((await (await req('/api/discovery/pins', send('POST', { rail: 'new', kind: 'video', target: 'vid-1', position: 1 }))).json()) as any).result.pin;
    const edited = ((await (await req(`/api/discovery/pins/${created.id}`, send('PATCH', { position: 3, startsAt: '2030-01-01T00:00:00Z' }))).json()) as any).result;
    assert.equal(edited.changed, true);
    assert.equal(edited.pin.position, 3);
    assert.equal(edited.pin.state, 'scheduled');
    const removed = ((await (await req(`/api/discovery/pins/${created.id}`, send('DELETE'))).json()) as any).result.pin;
    assert.equal(removed.rail, 'new');
    assert.equal((await req(`/api/discovery/pins/${created.id}`, send('DELETE'))).status, 404);
    assert.deepEqual((await audit()).map((a) => a.action), ['discovery.pin', 'discovery.pin-edit', 'discovery.unpin']);
  });

  it('keeps a channel off the lists and allows it again', async () => {
    const { req, send, state, audit, search } = setup(['admin']);
    const res = await req('/api/discovery/exclusions', send('POST', { kind: 'channel', target: 'ch-1', reason: 'Demo content' }));
    assert.equal(res.status, 201);
    assert.equal(search.raw.prepare('SELECT COUNT(*) AS n FROM discovery_exclusions').get()!.n, 1);
    assert.equal((await state()).exclusions[0].title, 'Sheikh Channel');
    assert.equal((await req('/api/discovery/exclusions', send('POST', { kind: 'channel', target: 'ch-1' }))).status, 409);
    assert.equal((await req('/api/discovery/exclusions/channel/ch-1', send('DELETE'))).status, 200);
    assert.deepEqual((await audit()).map((a) => a.action), ['discovery.exclude', 'discovery.include']);
  });

  it('orders and switches the home rails, keeps at least one, audits only real changes', async () => {
    const { req, send, state, audit } = setup(['super_admin']);
    const order = [
      { rail: 'new', enabled: true },
      { rail: 'featured', enabled: true },
      { rail: 'trending', enabled: false },
      { rail: 'popular', enabled: true },
      { rail: 'categories', enabled: true },
    ];
    const first = ((await (await req('/api/discovery/home-rails', send('PUT', { rails: order }))).json()) as any).result;
    assert.equal(first.changed, true);
    assert.deepEqual((await state()).homeRails, order);
    const again = ((await (await req('/api/discovery/home-rails', send('PUT', { rails: order }))).json()) as any).result;
    assert.equal(again.changed, false);
    assert.equal((await req('/api/discovery/home-rails', send('PUT', { rails: order.map((r) => ({ ...r, enabled: false })) }))).status, 400);
    assert.equal((await req('/api/discovery/home-rails', send('PUT', { rails: order.slice(1) }))).status, 400);
    assert.deepEqual((await audit()).map((a) => a.key), ['content:discovery:home']);
  });

  it('rank now and preview go to api-videos; history lists the changes newest first', async () => {
    const { req, send, calls } = setup(['admin']);
    assert.equal((await req('/api/discovery/run', send('POST', {}))).status, 202);
    assert.equal((await req('/api/discovery/preview?rail=top&scope=lang:ar')).status, 200);
    assert.ok(calls.includes('GET /internal/discovery/preview'));
    assert.equal((await req('/api/discovery/preview?rail=nope')).status, 400);
    await req('/api/discovery/pins', send('POST', { rail: 'featured', kind: 'video', target: 'vid-1', position: 1 }));
    await req('/api/discovery/exclusions', send('POST', { kind: 'channel', target: 'ch-1' }));
    const { entries } = ((await (await req('/api/discovery/history')).json()) as any).result;
    assert.deepEqual(entries.map((e: any) => e.action), ['discovery.exclude', 'discovery.pin']);
    assert.equal(entries[1].title, 'Tafsir of Al-Fatiha');
  });
});

describe('discovery helpers', () => {
  it('parseTarget reads ids, links and handles', () => {
    assert.deepEqual(parseTarget('video', 'abc_123'), { id: 'abc_123' });
    assert.deepEqual(parseTarget('video', 'https://alummahnow.net/en/video/abc?t=3'), { id: 'abc' });
    assert.deepEqual(parseTarget('channel', 'https://alummahnow.net/ar/channel/ch-9'), { id: 'ch-9' });
    assert.deepEqual(parseTarget('channel', '@Someone'), { handle: 'someone' });
    assert.equal(parseTarget('video', '@someone'), null);
    assert.equal(parseTarget('video', 'not an id!'), null);
  });

  it('homeRailsView keeps the stored order and adds rails it does not know yet', () => {
    assert.deepEqual(homeRailsView([{ rail: 'popular', enabled: 0 }, { rail: 'gone', enabled: 1 }]).map((r) => `${r.rail}:${r.enabled}`), [
      'popular:false',
      'featured:true',
      'trending:true',
      'new:true',
      'categories:true',
    ]);
  });
});
