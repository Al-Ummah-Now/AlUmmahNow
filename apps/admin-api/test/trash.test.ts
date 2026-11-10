/**
 * Soft delete of contact messages, custom themes and creator tiers (lib/trash.ts):
 * the /api/trash router (who may list, restore and queue for permanent deletion),
 * the hourly cleanup (the only hard delete), and the shared 30-day helpers.
 * Real migrations on node:sqlite, an in-memory R2 and a fake api-videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { cleanTrashReason, isTrashPurgeDue, purgeAfter, purgeCutoff, trashDaysLeft, type TrashItem } from '@al-ummah/shared-types';
import trashRouter from '../src/routers/trash.router';
import { canManageTrash, isHourlyTick, runTrashCleanup } from '../src/lib/trash';
import { insertContactMessage, softDeleteContactMessage } from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

const DAY = 86_400_000;
const NOW = new Date('2026-12-20T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

class MemoryR2 {
  objects = new Map<string, string>();
  async put(key: string, value: string) { this.objects.set(key, value); }
  async get(key: string) { const v = this.objects.get(key); return v === undefined ? null : { body: v, text: async () => v }; }
  async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k); }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 1 })), truncated: false }; }
}

/** api-videos' /internal/admin/creator-tiers/* as the trash code calls it. */
function fakeVideos() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const deleted = [{ id: 'small', name: 'Small', deletedAt: ago(3).toISOString(), deletedBy: 'admin-1', reason: null, purgeRequestedAt: null, purgeRequestedBy: null }];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const path = new URL(input).pathname.replace('/internal/admin', '');
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init.method ?? 'GET', path, body });
      let result: unknown = {};
      if (path === '/creator-tiers/deleted') result = { items: deleted };
      else if (path === '/creator-tiers/purge') result = { purged: ['old-tier'], failed: [{ id: 'held', error: 'held by users or restored' }] };
      else if (path.endsWith('/restore') || path.endsWith('/purge-request')) result = { id: 'small' };
      return new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
    },
  };
  return { fetcher, calls };
}

async function setup() {
  const db = sqliteD1();
  const bucket = new MemoryR2();
  const videos = fakeVideos();
  const env = { REPORTS_DB: db, theme_packages: bucket, VIDEOS: videos.fetcher, INTERNAL_API_KEY: 'k' };
  const roomy = { perIpHour: 99, perIpDay: 99, perUserHour: 99, perUserDay: 99 };
  const message = (id: string) =>
    insertContactMessage(db, { id, topic: 'general', name: 'Amina', email: 'amina@example.org', message: 'A question about playlists', locale: 'en', pageUrl: null, userId: null, userAgent: null, ipHash: 'h', now: ago(60) }, roomy);
  const theme = async (id: string, deletedAt: Date | null, purgeRequested = false) => {
    await db.prepare("INSERT INTO theme_packages (id, name_en, name_ar, draft_updated_by, draft_updated_at, created_by, created_at) VALUES (?, ?, 'ثيم', 'a', 'x', 'a', 'x')").bind(id, `Theme ${id}`).run();
    await db.prepare("INSERT INTO theme_package_versions (theme_id, version, size_bytes, published_by, published_at) VALUES (?, '1.0.0', 1, 'a', 'x')").bind(id).run();
    await bucket.put(`themes/${id}/draft/theme.json`, '{}');
    await bucket.put(`themes/${id}/1.0.0/theme.css`, '');
    if (deletedAt) await db.prepare('UPDATE theme_packages SET deleted_at = ?, deleted_by = ?, purge_requested_at = ? WHERE id = ?').bind(deletedAt.toISOString(), 'admin-1', purgeRequested ? NOW.toISOString() : null, id).run();
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: c.req.header('x-user') ?? 'admin-2', roles: (c.req.header('x-roles') ?? 'Admin').split(',') } as never);
    await next();
  });
  app.route('/api/trash', trashRouter as never);
  const call = (path: string, init: RequestInit & { roles?: string } = {}) => app.request(path, { ...init, headers: { 'x-roles': init.roles ?? 'Admin' } }, env);
  const count = async (sql: string, ...args: unknown[]) => Number((await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0);
  return { db, bucket, env, videos, message, theme, call, count };
}

describe('shared 30-day helpers', () => {
  it('computes the purge date, the days left and when an item is due', () => {
    assert.equal(purgeAfter('2026-11-10T00:00:00.000Z'), '2026-12-10T00:00:00.000Z');
    assert.equal(purgeCutoff(NOW), '2026-11-20T12:00:00.000Z');
    assert.equal(trashDaysLeft(ago(1).toISOString(), NOW), 29);
    assert.equal(trashDaysLeft(ago(31).toISOString(), NOW), 0);
    assert.equal(isTrashPurgeDue({ deletedAt: ago(29).toISOString(), purgeRequestedAt: null }, NOW), false);
    assert.equal(isTrashPurgeDue({ deletedAt: ago(30).toISOString(), purgeRequestedAt: null }, NOW), true);
    assert.equal(isTrashPurgeDue({ deletedAt: ago(1).toISOString(), purgeRequestedAt: NOW.toISOString() }, NOW), true);
    assert.equal(isTrashPurgeDue({ deletedAt: null, purgeRequestedAt: NOW.toISOString() }, NOW), false, 'a live item is never purged');
    assert.equal(cleanTrashReason('  spam  '), 'spam');
    assert.equal(cleanTrashReason('   '), null);
    assert.equal(cleanTrashReason(42), null);
    assert.equal(cleanTrashReason('x'.repeat(900))?.length, 500);
  });

  it('runs the cleanup on the top-of-the-hour tick of the 5-minute cron only', () => {
    assert.equal(isHourlyTick(Date.parse('2026-12-20T13:00:00Z')), true);
    assert.equal(isHourlyTick(Date.parse('2026-12-20T13:04:59Z')), true);
    assert.equal(isHourlyTick(Date.parse('2026-12-20T13:05:00Z')), false);
    assert.equal(isHourlyTick(Date.parse('2026-12-20T13:55:00Z')), false);
  });
});

describe('/api/trash', () => {
  it('is for admins and super admins; moderators are refused for every kind', async () => {
    const { call } = await setup();
    for (const kind of ['contact-message', 'theme', 'creator-tier']) {
      assert.equal(canManageTrash(['Moderator'], kind as never), false);
      assert.equal(canManageTrash(['Admin'], kind as never), true);
      assert.equal(canManageTrash(['Super Admin'], kind as never), true);
      assert.equal((await call(`/api/trash/${kind}`, { roles: 'Moderator' })).status, 403);
      assert.equal((await call(`/api/trash/${kind}/x/restore`, { method: 'POST', roles: 'Moderator' })).status, 403);
      assert.equal((await call(`/api/trash/${kind}/x/purge`, { method: 'POST', roles: 'Moderator' })).status, 403);
    }
    assert.equal((await call('/api/trash/videos')).status, 400);
  });

  it('lists deleted contact messages and themes with who, when, why and the purge date; restores; queues', async () => {
    const { call, db, message, theme, count } = await setup();
    await message('m1');
    await message('m2');
    await softDeleteContactMessage(db, 'm1', { actorId: 'admin-1', reason: 'spam', now: ago(2) });
    await theme('old', ago(5));
    await theme('live', null);

    const contact = (await (await call('/api/trash/contact-message')).json()) as { result: { items: TrashItem[] } };
    assert.deepEqual(contact.result.items.map((i) => [i.id, i.deletedBy, i.reason, i.purgeAfter]), [['m1', 'admin-1', 'spam', purgeAfter(ago(2).toISOString())]]);
    const themes = (await (await call('/api/trash/theme')).json()) as { result: { items: TrashItem[] } };
    assert.deepEqual(themes.result.items.map((i) => [i.id, i.title, i.titleAr]), [['old', 'Theme old', 'ثيم']]);

    // Promote: queued (audited), nothing deleted
    assert.equal((await call('/api/trash/contact-message/m1/purge', { method: 'POST' })).status, 200);
    assert.equal((await call('/api/trash/contact-message/m2/purge', { method: 'POST' })).status, 404, 'a live message cannot be queued');
    assert.equal(await count('SELECT COUNT(*) AS n FROM contact_messages WHERE id = ?', 'm1'), 1);
    const queued = (await (await call('/api/trash/contact-message')).json()) as { result: { items: TrashItem[] } };
    assert.equal(queued.result.items[0].purgeRequestedBy, 'admin-2');

    // Restore, even after queuing, until the cleanup has run
    assert.equal((await call('/api/trash/contact-message/m1/restore', { method: 'POST' })).status, 200);
    assert.equal((await call('/api/trash/contact-message/m1/restore', { method: 'POST' })).status, 404);
    assert.equal((await call('/api/trash/theme/old/restore', { method: 'POST' })).status, 200);
    assert.equal(await count('SELECT COUNT(*) AS n FROM theme_packages WHERE deleted_at IS NULL'), 2);
    const audit = await db.prepare("SELECT key, new_value, actor_id FROM site_settings_log WHERE key LIKE 'trash:%' ORDER BY rowid").all<{ key: string; new_value: string; actor_id: string }>();
    assert.deepEqual(audit.results.map((r) => [r.key, JSON.parse(r.new_value).action, r.actor_id]), [
      ['trash:contact-message:m1', 'purge-request', 'admin-2'],
      ['trash:contact-message:m1', 'restore', 'admin-2'],
      ['trash:theme:old', 'restore', 'admin-2'],
    ]);
  });

  it('passes creator tier actions to api-videos with the acting admin', async () => {
    const { call, videos } = await setup();
    const listed = (await (await call('/api/trash/creator-tier')).json()) as { result: { items: TrashItem[] } };
    assert.deepEqual(listed.result.items.map((i) => [i.kind, i.id, i.title]), [['creator-tier', 'small', 'Small']]);
    assert.equal((await call('/api/trash/creator-tier/small/restore', { method: 'POST' })).status, 200);
    assert.equal((await call('/api/trash/creator-tier/small/purge', { method: 'POST' })).status, 200);
    assert.deepEqual(videos.calls.map((c) => `${c.method} ${c.path}`), ['GET /creator-tiers/deleted', 'POST /creator-tiers/small/restore', 'POST /creator-tiers/small/purge-request']);
  });
});

describe('cleanup (the only hard delete)', () => {
  it('purges what is 30+ days old or queued, leaves the rest restorable, and is idempotent', async () => {
    const { db, bucket, env, videos, message, theme, count } = await setup();
    await message('old');
    await message('recent');
    await message('queued');
    await message('live');
    await softDeleteContactMessage(db, 'old', { actorId: 'a', reason: null, now: ago(31) });
    await softDeleteContactMessage(db, 'recent', { actorId: 'a', reason: null, now: ago(29) });
    await softDeleteContactMessage(db, 'queued', { actorId: 'a', reason: null, now: ago(1) });
    await db.prepare("UPDATE contact_messages SET purge_requested_at = ? WHERE id = 'queued'").bind(NOW.toISOString()).run();
    await db.prepare("INSERT INTO contact_notes (id, message_id, kind, body, author_id, created_at) VALUES ('n1', 'old', 'note', 'x', 'a', 'x')").run();
    await theme('gone', ago(40));
    await theme('soon', ago(1), true);
    await theme('kept', ago(10));
    await theme('live', null);

    const result = await runTrashCleanup(env as never, NOW);
    assert.deepEqual(result, {
      'contact-message': { purged: 2, failed: 0 },
      theme: { purged: 2, failed: 0 },
      'creator-tier': { purged: 1, failed: 1 },
    });
    assert.deepEqual((await db.prepare('SELECT id FROM contact_messages ORDER BY id').all<{ id: string }>()).results.map((r) => r.id), ['live', 'recent']);
    assert.equal(await count('SELECT COUNT(*) AS n FROM contact_notes'), 0);
    assert.deepEqual((await db.prepare('SELECT id FROM theme_packages ORDER BY id').all<{ id: string }>()).results.map((r) => r.id), ['kept', 'live']);
    assert.deepEqual([...bucket.objects.keys()].map((k) => k.split('/')[1]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['kept', 'live']);
    assert.equal(await count("SELECT COUNT(*) AS n FROM theme_package_versions WHERE theme_id IN ('gone', 'soon')"), 0);
    const tierCall = videos.calls.find((c) => c.path === '/creator-tiers/purge');
    assert.deepEqual(tierCall?.body, { cutoff: purgeCutoff(NOW), limit: 50 });
    const purges = await db.prepare("SELECT key FROM site_settings_log WHERE new_value = '{\"action\":\"purge\"}' ORDER BY key").all<{ key: string }>();
    assert.deepEqual(purges.results.map((r) => r.key), ['trash:contact-message:old', 'trash:contact-message:queued', 'trash:creator-tier:old-tier', 'trash:theme:gone', 'trash:theme:soon']);

    const again = await runTrashCleanup(env as never, NOW);
    assert.deepEqual([again['contact-message'], again.theme], [{ purged: 0, failed: 0 }, { purged: 0, failed: 0 }]);
  });

  it('never purges the site theme, and a theme whose purge started can no longer be restored', async () => {
    const { db, env, theme, call } = await setup();
    await theme('active', ago(40));
    await db.prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('site.theme', 'active@1.0.0', 'a', 'x')").run();
    const result = await runTrashCleanup(env as never, NOW);
    assert.deepEqual(result.theme, { purged: 0, failed: 1 });
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM theme_packages WHERE id = 'active'").first<{ n: number }>())?.n), 1);

    await theme('half', ago(2));
    await db.prepare("UPDATE theme_packages SET purge_started_at = ? WHERE id = 'half'").bind(NOW.toISOString()).run();
    assert.equal((await call('/api/trash/theme/half/restore', { method: 'POST' })).status, 409);
    // The next run finishes an interrupted purge
    await db.prepare("DELETE FROM site_settings WHERE key = 'site.theme'").run();
    const next = await runTrashCleanup(env as never, NOW);
    assert.equal(next.theme.purged, 2);
  });

  it('keeps going when one kind fails', async () => {
    const { env, message, db } = await setup();
    await message('old');
    await softDeleteContactMessage(db, 'old', { actorId: 'a', reason: null, now: ago(31) });
    const broken = { ...env, VIDEOS: { fetch: async () => new Response('down', { status: 503 }) } };
    const result = await runTrashCleanup(broken as never, NOW);
    assert.deepEqual(result['contact-message'], { purged: 1, failed: 0 });
    assert.deepEqual(result['creator-tier'], { purged: 0, failed: 1 });
  });
});
