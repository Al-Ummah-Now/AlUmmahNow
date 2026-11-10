/**
 * The admin autocomplete (/api/suggest) through the real router: which role may
 * read which kind, the api-videos list each content kind is read from, the
 * mapping to suggestions, exact-id-first ordering and the lookup by id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import suggestRouter from '../src/routers/suggest.router';

interface Call { path: string; search: URLSearchParams; actor: string | null }

function fakeVideos(items: Record<string, unknown[]>, status = 200) {
  const calls: Call[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const path = url.pathname.replace('/internal/admin', '');
      calls.push({ path, search: url.searchParams, actor: new Headers(init.headers).get('X-Admin-Actor') });
      if (status !== 200) return new Response(JSON.stringify({ success: false, code: 'boom', error: 'api-videos failed' }), { status });
      const result = { items: items[path] ?? [], total: (items[path] ?? []).length, page: 1, pageSize: 8, indexComplete: true };
      return new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
    },
  };
  return { fetcher, calls };
}

/** Just enough D1 for the contact and error-group reads. */
function fakeDb() {
  const contact = { id: 'msg_1', status: 'new', topic: 'other', name: 'Aisha', email: 'a@example.com', message: 'Hello   there', created_at: '2026-11-01T00:00:00Z' };
  const group = { id: 'grp_1', app: 'web', name: 'TypeError', message: 'x is undefined', route: '/watch', status: 'open' };
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    async first() {
      if (sql.includes('COUNT')) return { n: 1, total: 1 };
      if (sql.includes('contact_messages')) return contact;
      if (sql.includes('error_groups')) return group;
      return null;
    },
    async all() {
      if (sql.includes('COUNT(*) AS total')) return { results: [{ total: 1 }] };
      if (sql.includes('contact_messages')) return { results: [contact] };
      if (sql.includes('error_groups')) return { results: [{ ...group, open_actions: 0 }] };
      return { results: [] };
    },
  });
  return { prepare: (sql: string) => statement(sql), batch: async (statements: { all(): Promise<unknown> }[]) => Promise.all(statements.map((st) => st.all())) } as unknown as D1Database;
}

function appFor(env: Record<string, unknown>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: 'admin-1', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/suggest', suggestRouter);
  return async (path: string, roles = 'admin') => {
    const res = await app.request(path, { headers: { 'x-test-roles': roles } }, { INTERNAL_API_KEY: 'k', REPORTS_DB: fakeDb(), ...env });
    return { status: res.status, body: (await res.json()) as { success: boolean; code?: string; result: { items?: Record<string, unknown>[]; item?: Record<string, unknown> | null } } };
  };
}

const channel = (id: string, name: string, handle: string | null = null) => ({ id, name, handle, ownerEmail: 'o@example.com', avatarUrl: `https://img/${id}.jpg` });

describe('suggest endpoints', () => {
  it('reads channels from the api-videos channel list with q and a small page, as the admin', async () => {
    const { fetcher, calls } = fakeVideos({ '/channels': [channel('ch_1', 'Mostafa Elbadry', 'mostafa')] });
    const { status, body } = await appFor({ VIDEOS: fetcher })('/api/suggest/channel?q=most');
    assert.equal(status, 200);
    assert.deepEqual(body.result.items, [{ kind: 'channel', id: 'ch_1', label: 'Mostafa Elbadry', secondary: '@mostafa', imageUrl: 'https://img/ch_1.jpg' }]);
    assert.equal(calls[0].path, '/channels');
    assert.equal(calls[0].search.get('q'), 'most');
    assert.equal(calls[0].search.get('pageSize'), '8');
    assert.equal(calls[0].actor, 'admin-1');
  });

  it('maps users with handle and email, videos with channel and thumbnail, comments with their video', async () => {
    const { fetcher } = fakeVideos({
      '/users': [{ id: 'usr_1', displayName: 'Omar', userName: 'omar', email: 'omar@example.com', avatarUrl: null }],
      '/videos': [{ id: 'v_1', title: 'Tafsir', channelId: 'ch_1', channelName: 'Mostafa', thumbnailUrl: 'https://t/v_1.jpg' }],
      '/comments': [{ id: 'c_1', videoId: 'v_1', videoTitle: 'Tafsir', text: 'Great', userId: 'usr_1' }],
    });
    const call = appFor({ VIDEOS: fetcher });
    assert.deepEqual((await call('/api/suggest/user?q=om')).body.result.items?.[0], { kind: 'user', id: 'usr_1', label: 'Omar', secondary: '@omar · omar@example.com', imageUrl: null });
    assert.deepEqual((await call('/api/suggest/video?q=taf')).body.result.items?.[0], { kind: 'video', id: 'v_1', label: 'Tafsir', secondary: 'Mostafa', imageUrl: 'https://t/v_1.jpg', parentId: 'ch_1' });
    assert.deepEqual((await call('/api/suggest/comment?q=gre')).body.result.items?.[0], { kind: 'comment', id: 'c_1', label: 'Great', secondary: 'Tafsir', imageUrl: null, parentId: 'v_1' });
  });

  it('puts an exact id match first', async () => {
    const { fetcher } = fakeVideos({ '/channels': [channel('ch_2', 'Other ch_1 fan'), channel('ch_1', 'Mostafa')] });
    const { body } = await appFor({ VIDEOS: fetcher })('/api/suggest/channel?q=ch_1');
    assert.deepEqual(body.result.items?.map((i) => i.id), ['ch_1', 'ch_2']);
  });

  it('answers an empty query with no suggestions and no api-videos call', async () => {
    const { fetcher, calls } = fakeVideos({});
    const { status, body } = await appFor({ VIDEOS: fetcher })('/api/suggest/video?q=%20%20');
    assert.equal(status, 200);
    assert.deepEqual(body.result.items, []);
    assert.equal(calls.length, 0);
  });

  it('refuses an unknown kind', async () => {
    const { status, body } = await appFor({})('/api/suggest/secrets?q=a');
    assert.equal(status, 404);
    assert.equal(body.code, 'unknown_kind');
  });

  it('lets a moderator search content but not the contact inbox or the error groups', async () => {
    const { fetcher } = fakeVideos({ '/videos': [] });
    const call = appFor({ VIDEOS: fetcher });
    assert.equal((await call('/api/suggest/video?q=a', 'moderator')).status, 200);
    for (const kind of ['contact', 'error']) {
      const res = await call(`/api/suggest/${kind}?q=a`, 'moderator');
      assert.equal(res.status, 403, kind);
      assert.equal(res.body.code, 'forbidden');
      assert.equal((await call(`/api/suggest/${kind}/x`, 'moderator')).status, 403, `${kind} by id`);
    }
  });

  it('suggests contact messages and error groups to an admin, text flattened', async () => {
    const call = appFor({});
    assert.deepEqual((await call('/api/suggest/contact?q=ai')).body.result.items?.[0], { kind: 'contact', id: 'msg_1', label: 'Aisha', secondary: 'a@example.com · Hello there', imageUrl: null });
    assert.deepEqual((await call('/api/suggest/error?q=undef')).body.result.items?.[0], { kind: 'error', id: 'grp_1', label: 'x is undefined', secondary: 'web · TypeError · /watch', imageUrl: null });
  });

  it('resolves one item by id for the chip of an active filter, null when nothing has that id', async () => {
    const { fetcher, calls } = fakeVideos({ '/channels': [channel('ch_10', 'Ten'), channel('ch_1', 'One')] });
    const call = appFor({ VIDEOS: fetcher });
    assert.equal((await call('/api/suggest/channel/ch_1')).body.result.item?.label, 'One');
    assert.equal(calls[0].search.get('q'), 'ch_1');
    assert.equal((await call('/api/suggest/channel/ch_404')).body.result.item, null);
    assert.equal((await call('/api/suggest/contact/msg_1')).body.result.item?.label, 'Aisha');
  });

  it('passes an api-videos failure on with its status', async () => {
    const { fetcher } = fakeVideos({}, 503);
    const { status, body } = await appFor({ VIDEOS: fetcher })('/api/suggest/user?q=a');
    assert.equal(status, 503);
    assert.equal(body.code, 'boom');
  });
});
