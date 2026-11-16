/**
 * The admin audit log (/api/audit, issue #711) and names (/api/names, issue #745): the merged
 * feed over site_settings_log and admin_audit_log on real SQLite with the migrations, its
 * filters and keyset paging, and the router's permission and naming.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { sqliteD1 } from './d1-sqlite';
import { cleanAuditQuery, describeKey, readAuditActions, readAuditFeed } from '../src/lib/audit/feed';
import { cleanNamesRequest, idsOfFeed } from '../src/lib/audit/names';
import { auditRouter, namesRouter } from '../src/routers/audit.router';

const at = (minute: number) => `2026-11-10T10:${String(minute).padStart(2, '0')}:00.000Z`;

async function seeded() {
  const db = sqliteD1();
  const content = (id: string, key: string, value: unknown, actor: string, minute: number, old: unknown = null) =>
    db.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, key, old === null ? null : typeof old === 'string' ? old : JSON.stringify(old), typeof value === 'string' ? value : JSON.stringify(value), actor, at(minute)).run();
  const admin = (id: string, action: string, type: string, target: string, actor: string, minute: number) =>
    db.prepare('INSERT INTO admin_audit_log (id, actor_id, actor_email, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, actor, `${actor}@example.com`, action, type, target, JSON.stringify({ reason: 'x' }), at(minute)).run();
  await content('c1', 'content:video:vid_1', { action: 'hide', details: { channelId: 'ch_1' } }, 'usr_a', 1);
  await content('c2', 'trash:video:vid_1', { action: 'deleted', reason: 'spam' }, 'usr_b', 2);
  await content('c3', 'site.theme', 'nahas', 'usr_a', 3, 'fawanees');
  await content('c4', 'content:user:usr_x', { action: 'invite.created' }, 'usr_a', 4);
  await content('c5', 'processing:video:vid_2', { action: 'retry', details: {} }, 'usr_b', 5);
  await admin('a1', 'auth_request.ban', 'user', 'usr_x', 'usr_b', 6);
  await admin('a2', 'invite.created', 'user', 'usr_x', 'usr_a', 7);
  await admin('a3', 'status.incident.created', 'incident', 'inc_1', 'usr_a', 8);
  return db;
}

describe('audit feed', () => {
  it('merges both tables newest first and leaves out the duplicate invite rows', async () => {
    const { items, next } = await readAuditFeed(await seeded(), cleanAuditQuery({}));
    assert.deepEqual(items.map((e) => e.id), ['admin:a3', 'admin:a1', 'content:c5', 'content:c4', 'content:c3', 'content:c2', 'content:c1']);
    assert.equal(next, null);
    const theme = items.find((e) => e.id === 'content:c3')!;
    assert.deepEqual([theme.area, theme.action, theme.setting, theme.details, theme.previous], ['themes', 'changed', 'site.theme', { value: 'nahas' }, { value: 'fawanees' }]);
    const hide = items.find((e) => e.id === 'content:c1')!;
    assert.deepEqual([hide.area, hide.action, hide.target, hide.details], ['content', 'hide', { kind: 'video', id: 'vid_1' }, { channelId: 'ch_1' }]);
    assert.deepEqual(items.find((e) => e.id === 'content:c2')!.details, { reason: 'spam' });
    assert.equal(items.find((e) => e.id === 'admin:a1')!.actorEmail, 'usr_b@example.com');
  });

  it('filters by actor, item, area, action and date', async () => {
    const db = await seeded();
    const ids = async (q: Record<string, string>) => (await readAuditFeed(db, cleanAuditQuery(q))).items.map((e) => e.id);
    assert.deepEqual(await ids({ actorId: 'usr_b' }), ['admin:a1', 'content:c5', 'content:c2']);
    assert.deepEqual(await ids({ itemKind: 'video', itemId: 'vid_1' }), ['content:c2', 'content:c1']);
    assert.deepEqual(await ids({ itemKind: 'user', itemId: 'usr_x' }), ['admin:a1', 'content:c4']);
    assert.deepEqual(await ids({ area: 'trash' }), ['content:c2']);
    assert.deepEqual(await ids({ area: 'auth' }), ['admin:a1']);
    assert.deepEqual(await ids({ area: 'themes' }), ['content:c3']);
    assert.deepEqual(await ids({ action: 'hide' }), ['content:c1']);
    assert.deepEqual(await ids({ action: 'changed' }), ['content:c3']);
    assert.deepEqual(await ids({ from: at(2), to: at(5) }), ['content:c5', 'content:c4', 'content:c3', 'content:c2']);
    assert.deepEqual(await ids({ from: '2026-11-11' }), []);
    // An item id without its kind is ignored, not an error
    assert.equal((await ids({ itemId: 'vid_1' })).length, 7);
  });

  it('pages with a keyset cursor across both tables without gaps or repeats', async () => {
    const db = await seeded();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAuditFeed(db, cleanAuditQuery({ limit: '2', ...(cursor ? { cursor } : {}) }));
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((e) => e.id));
      cursor = page.next ?? undefined;
    } while (cursor);
    assert.deepEqual(seen, ['admin:a3', 'admin:a1', 'content:c5', 'content:c4', 'content:c3', 'content:c2', 'content:c1']);
  });

  it('lists the recorded actions with their areas', async () => {
    const actions = await readAuditActions(await seeded());
    const byAction = Object.fromEntries(actions.map((a) => [a.action, a.area]));
    assert.equal(byAction.hide, 'content');
    assert.equal(byAction.deleted, 'trash');
    assert.equal(byAction.changed, 'themes');
    assert.equal(byAction['auth_request.ban'], 'auth');
    assert.equal(byAction['status.incident.created'], 'status');
  });

  it('maps keys to areas and items', () => {
    assert.deepEqual(describeKey('content:live-stream:ls_1'), { area: 'live', target: { kind: 'live-stream', id: 'ls_1' }, setting: null });
    assert.deepEqual(describeKey('content:site:ch_1'), { area: 'sites', target: { kind: 'channel', id: 'ch_1' }, setting: null });
    assert.deepEqual(describeKey('uploads:stale:vid_1'), { area: 'uploads', target: { kind: 'video', id: 'vid_1' }, setting: null });
    assert.deepEqual(describeKey('ops:threshold:d1'), { area: 'operations', target: null, setting: 'ops:threshold:d1' });
    assert.deepEqual(describeKey('notifications:menu-open').area, 'settings');
  });

  it('cleans the query: unknown kinds and areas dropped, limit clamped', () => {
    const q = cleanAuditQuery({ itemKind: 'nope', itemId: 'x', area: 'nope', limit: '5000' });
    assert.equal(q.itemKind, undefined);
    assert.equal(q.itemId, undefined);
    assert.equal(q.area, undefined);
    assert.equal(q.limit, 100);
  });

  it('collects the ids a page mentions, and cleans a names request', async () => {
    const { items } = await readAuditFeed(await seeded(), cleanAuditQuery({}));
    const ids = cleanNamesRequest(idsOfFeed(items));
    assert.deepEqual(ids.users.sort(), ['usr_a', 'usr_b', 'usr_x']);
    assert.deepEqual(ids.items.map((i) => `${i.kind}:${i.id}`).sort(), ['channel:ch_1', 'video:vid_1', 'video:vid_2']);
    const cleaned = cleanNamesRequest({ users: ['usr_1', 'system:trash-cleanup', 5, 'usr_1'], items: [{ kind: 'user', id: 'usr_2' }, { kind: 'bogus', id: 'x' }, { kind: 'video', id: 'v' }] });
    assert.deepEqual(cleaned, { users: ['usr_1', 'usr_2'], items: [{ kind: 'video', id: 'v' }] });
  });
});

describe('audit router', () => {
  function appFor(db: D1Database) {
    const calls: unknown[] = [];
    const VIDEOS = {
      async fetch(_url: string, init: RequestInit = {}) {
        const body = JSON.parse(String(init.body)) as { items: { type: string; id: string }[]; users: string[] };
        calls.push(body);
        const result = {
          items: body.items.map((i) => ({ type: i.type, id: i.id, found: true, title: `Title ${i.id}`, parentId: null, channelId: null, channelName: null, ownerId: null, isHidden: false, isDeleted: false })),
          users: body.users.map((id) => ({ id, found: true, displayName: `Name ${id}`, userName: id, email: `${id}@example.com`, isBanned: false })),
        };
        return new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
      },
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      const roles = c.req.header('x-test-roles') ?? '';
      c.set('auth' as never, { userId: 'usr_a', roles: roles ? roles.split(',') : [] } as never);
      await next();
    });
    app.route('/api/audit', auditRouter);
    app.route('/api/names', namesRouter);
    const env = { REPORTS_DB: db, VIDEOS, INTERNAL_API_KEY: 'k' };
    return { calls, request: (path: string, roles = 'admin', init: RequestInit = {}) => app.request(path, { ...init, headers: { 'x-test-roles': roles, 'content-type': 'application/json' } }, env) };
  }

  it('needs audit:read: moderators get 403, admins a named page', async () => {
    const { request } = appFor(await seeded());
    assert.equal((await request('/api/audit', 'moderator')).status, 403);
    assert.equal((await request('/api/audit/actions', 'moderator')).status, 403);
    const res = await request('/api/audit?actorId=usr_b');
    assert.equal(res.status, 200);
    const { result: data } = (await res.json()) as { result: { items: { id: string }[]; names: { users: Record<string, { name: string; email: string }>; items: Record<string, { title: string }> } } };
    assert.deepEqual(data.items.map((e) => e.id), ['admin:a1', 'content:c5', 'content:c2']);
    assert.deepEqual([data.names.users.usr_b.name, data.names.users.usr_b.email], ['Name usr_b', 'usr_b@example.com']);
    assert.equal(data.names.items['video:vid_1'].title, 'Title vid_1');
  });

  it('names ids for every admin role', async () => {
    const { request, calls } = appFor(await seeded());
    const res = await request('/api/names', 'moderator', { method: 'POST', body: JSON.stringify({ users: ['usr_q'], items: [{ kind: 'channel', id: 'ch_9' }] }) });
    assert.equal(res.status, 200);
    const { result: data } = (await res.json()) as { result: { users: Record<string, { name: string }>; items: Record<string, { title: string }> } };
    assert.equal(data.users.usr_q.name, 'Name usr_q');
    assert.equal((data.users.usr_q as { email?: string | null }).email, null, 'moderators get no email');
    assert.equal(data.items['channel:ch_9'].title, 'Title ch_9');
    assert.equal(calls.length, 1);
    const asAdmin = (await (await request('/api/names', 'admin', { method: 'POST', body: JSON.stringify({ users: ['usr_q'] }) })).json()) as { result: { users: Record<string, { email: string | null }> } };
    assert.equal(asAdmin.result.users.usr_q.email, 'usr_q@example.com');
  });
});

describe('the Payments area', () => {
  it('holds provider, price, tax, subscription and refund rows and a user\'s comps; Content no longer does', async () => {
    const db = sqliteD1();
    const at2 = (m: number) => `2026-11-10T10:${String(m).padStart(2, '0')}:00.000Z`;
    const row = (id: string, key: string, value: unknown, m: number) =>
      db.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, key, null, JSON.stringify(value), 'usr_a', at2(m)).run();
    await row('p1', 'content:billing-provider:paddle', { action: 'update', details: { enabled: true } }, 1);
    await row('p2', 'content:user:usr_c', { action: 'billing-comp', details: { tierId: 'creator' } }, 2);
    await row('p3', 'content:billing-price:creator:month:USD', { action: 'save', details: {} }, 3);
    await row('c1', 'content:video:vid_1', { action: 'hide' }, 4);
    const ids = async (area: string) => (await readAuditFeed(db, cleanAuditQuery({ area }))).items.map((e) => e.id);
    assert.deepEqual(await ids('payments'), ['content:p3', 'content:p2', 'content:p1']);
    assert.deepEqual(await ids('content'), ['content:c1']);
    const comp = (await readAuditFeed(db, cleanAuditQuery({}))).items.find((e) => e.id === 'content:p2')!;
    assert.deepEqual([comp.area, comp.target], ['payments', { kind: 'user', id: 'usr_c' }]);
    assert.equal(describeKey('content:billing-provider:paddle').area, 'payments');
  });
});
