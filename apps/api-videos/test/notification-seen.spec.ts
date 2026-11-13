/**
 * Bell badge = unseen (new since the menu was last opened), separate from read state, and the
 * platform setting for what opening the menu does (2026-11-13).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	NotificationsList,
	NotificationsMarkAllRead,
	NotificationsMarkRead,
	NotificationsMarkSeen,
	NotificationsMarkUnread,
	NotificationsUnreadCount,
	NotificationsDelete,
} from '../src/endpoints/notifications/notifications';
import { createNotificationsInternalRouter } from '../src/endpoints/notifications/notificationsInternal';
import { clearNotificationPlatformSettingsCache, countState, markSeen, NOTIFICATION_SETTINGS_KEY } from '../src/lib/notifications';
import { normaliseNotificationPlatformSettings } from '@al-ummah/shared-types';
import { MemoryBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function routes(r: any) {
	r.get('/api/notifications', NotificationsList);
	r.get('/api/notifications/unread-count', NotificationsUnreadCount);
	r.post('/api/notifications/seen', NotificationsMarkSeen);
	r.post('/api/notifications/read', NotificationsMarkRead);
	r.post('/api/notifications/unread', NotificationsMarkUnread);
	r.post('/api/notifications/read-all', NotificationsMarkAllRead);
	r.delete('/api/notifications/:id', NotificationsDelete);
}

function env(menuOpen?: 'seen' | 'read') {
	const db = createSqliteD1();
	const now = Date.now();
	const insert = db.raw.prepare(
		"INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, created_at) VALUES (?, ?, 'comments', 'comment', 'newComment', '{}', ?)",
	);
	insert.run('n1', 'me', now - 3000);
	insert.run('n2', 'me', now - 2000);
	insert.run('n3', 'me', now - 1000);
	insert.run('other', 'someone', now - 1000);
	const global_settings = new MemoryBucket(menuOpen ? { [NOTIFICATION_SETTINGS_KEY]: { menuOpen } } : {});
	return { NOTIFICATIONS_DB: db, global_settings } as any;
}

const get = async (app: any, path: string, e: any) => ((await (await app.request(path, {}, e)).json()) as any).result;
const post = async (app: any, path: string, body: unknown, e: any) => ((await (await app.request(path, json(body), e)).json()) as any).result;

describe('notification badge (unseen) vs read', () => {
	beforeEach(() => clearNotificationPlatformSettingsCache());

	it('counts unseen as unread notifications newer than the last menu open', async () => {
		const e = env();
		const db = e.NOTIFICATIONS_DB;
		assert.deepEqual(await countState(db, 'me'), { unreadCount: 3, unseenCount: 3 });
		await markSeen(db, 'me', Date.now() - 1500);
		assert.deepEqual(await countState(db, 'me'), { unreadCount: 3, unseenCount: 1 });
		// Never moves back in time (a slow request from another tab)
		await markSeen(db, 'me', 0);
		assert.deepEqual(await countState(db, 'me'), { unreadCount: 3, unseenCount: 1 });
		assert.deepEqual(await countState(db, 'someone'), { unreadCount: 1, unseenCount: 1 });
	});

	it('mode seen (default): opening the menu clears the badge and leaves everything unread', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const before = await get(app, '/api/notifications/unread-count', e);
		assert.deepEqual(before, { unreadCount: 3, unseenCount: 3, menuOpen: 'seen' });
		const seen = await post(app, '/api/notifications/seen', { ids: ['n3', 'n2'] }, e);
		assert.equal(seen.menuOpen, 'seen');
		assert.deepEqual(seen.readIds, []);
		assert.equal(seen.unseenCount, 0);
		assert.equal(seen.unreadCount, 3);
		const list = await get(app, '/api/notifications', e);
		assert.equal(list.unseenCount, 0);
		assert.ok(list.items.every((n: any) => n.isRead === false));
		// Idempotent
		assert.equal((await post(app, '/api/notifications/seen', {}, e)).unseenCount, 0);
		// "Mark all as read" is still what reads them
		await post(app, '/api/notifications/read-all', {}, e);
		assert.deepEqual(await get(app, '/api/notifications/unread-count', e), { unreadCount: 0, unseenCount: 0, menuOpen: 'seen' });
	});

	it('mode read: opening the menu also marks the shown notifications read, only mine', async () => {
		const e = env('read');
		const app = buildApp(routes, { userId: 'me' });
		const seen = await post(app, '/api/notifications/seen', { ids: ['n3', 'n2', 'other'] }, e);
		assert.equal(seen.menuOpen, 'read');
		assert.equal(seen.unseenCount, 0);
		assert.equal(seen.unreadCount, 1);
		assert.deepEqual(
			e.NOTIFICATIONS_DB.rows("SELECT id, is_read FROM notifications ORDER BY id"),
			[{ id: 'n1', is_read: 0 }, { id: 'n2', is_read: 1 }, { id: 'n3', is_read: 1 }, { id: 'other', is_read: 0 }],
		);
	});

	it('a new notification after the open brings the badge back', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		await post(app, '/api/notifications/seen', {}, e);
		e.NOTIFICATIONS_DB.raw
			.prepare("INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, created_at) VALUES ('n4', 'me', 'comments', 'comment', 'newComment', '{}', ?)")
			.run(Date.now() + 5000);
		assert.deepEqual(await get(app, '/api/notifications/unread-count', e), { unreadCount: 4, unseenCount: 1, menuOpen: 'seen' });
	});

	it('marks read and unread per notification; unread again does not come back on the badge', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		await post(app, '/api/notifications/seen', {}, e);
		const read = await post(app, '/api/notifications/read', { ids: ['n1'] }, e);
		assert.deepEqual([read.updated, read.unreadCount, read.unseenCount], [1, 2, 0]);
		const unread = await post(app, '/api/notifications/unread', { ids: ['n1', 'other'] }, e);
		assert.deepEqual([unread.updated, unread.unreadCount, unread.unseenCount], [1, 3, 0]);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows("SELECT is_read, read_at FROM notifications WHERE id = 'n1'"), [{ is_read: 0, read_at: null }]);
		assert.equal((await app.request('/api/notifications/unread', json({ ids: [] }), e)).status, 400);
	});

	it('pushes notifications_state to the user channel on every change', async () => {
		const sent: any[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: string, init: any) => {
			sent.push(JSON.parse(init.body));
			return new Response('{}');
		}) as any;
		try {
			const e = { ...env(), WEBSOCKET_URL: 'http://ws.test', INTERNAL_API_KEY: 'k' };
			const app = buildApp(routes, { userId: 'me' });
			await post(app, '/api/notifications/seen', {}, e);
			await post(app, '/api/notifications/read', { ids: ['n1'] }, e);
			await new Promise((r) => setTimeout(r, 20));
			assert.equal(sent.length, 2);
			assert.equal(sent[0].channel, 'user:me');
			assert.equal(sent[0].message.data.type, 'notifications_state');
			assert.equal(sent[0].message.data.unseenCount, 0);
			assert.ok(sent[0].message.data.seenAt);
			assert.deepEqual(sent[1].message.data.readIds, ['n1']);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe('platform setting: what opening the notification menu does', () => {
	beforeEach(() => clearNotificationPlatformSettingsCache());

	it('normalises stored values to a valid mode (default seen)', () => {
		assert.equal(normaliseNotificationPlatformSettings(null).menuOpen, 'seen');
		assert.equal(normaliseNotificationPlatformSettings({ menuOpen: 'loud' }).menuOpen, 'seen');
		assert.equal(normaliseNotificationPlatformSettings({ menuOpen: 'read' }).menuOpen, 'read');
	});

	it('internal GET/PUT: needs an actor and a known mode, then clients see it', async () => {
		const e = env();
		const internal = createNotificationsInternalRouter();
		const put = (body: unknown) => internal.request('/settings', { ...json(body), method: 'PUT' }, e);
		assert.equal((await put({ menuOpen: 'read' })).status, 400);
		assert.equal((await put({ menuOpen: 'loud', actorId: 'admin1' })).status, 400);
		const saved = ((await (await put({ menuOpen: 'read', actorId: 'admin1' })).json()) as any).result;
		assert.equal(saved.menuOpen, 'read');
		assert.equal(saved.updatedBy, 'admin1');
		const read = ((await (await internal.request('/settings', {}, e)).json()) as any).result;
		assert.equal(read.menuOpen, 'read');
		const app = buildApp(routes, { userId: 'me' });
		assert.equal((await get(app, '/api/notifications/unread-count', e)).menuOpen, 'read');
	});
});
