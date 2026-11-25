import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { WatchLaterAdd, WatchLaterList, WatchLaterRemove, WatchLaterReorder, WatchLaterStatus } from '../src/endpoints/library/watchLater';
import { LikedVideosList, SavedPostAdd, SavedPostRemove, SavedPostStatus, SavedPostsList } from '../src/endpoints/library/liked';
import { LibraryBackfill, collectLikeRows } from '../src/endpoints/library/backfill';
import {
	ChannelBellGet,
	ChannelBellUpdate,
	NotificationQuietHoursGet,
	NotificationQuietHoursUpdateRoute,
	NotificationSettingsGet,
	NotificationSettingsUpdate,
	NotificationsDelete,
	NotificationsList,
	NotificationsMarkAllRead,
	NotificationsMarkRead,
	NotificationsUnreadCount,
} from '../src/endpoints/notifications/notifications';
import { LikeCreate } from '../src/endpoints/video/videoLikeCreate';
import { LikeDelete } from '../src/endpoints/video/videoLikeDelete';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { notifyUser } from '../src/lib/websocket-notify';
import { announceLiveStarted, announceNewVideo, isAnnounceable, isHighlightVideo } from '../src/lib/notification-events';
import { addToWatchLater, newWatchLater, pageIds, WATCH_LATER_MAX_ITEMS } from '../src/lib/library';
import { decodeCursor, encodeCursor } from '../src/lib/notifications';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

function env(overrides: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket(),
		channels: new MemoryBucket(),
		profiles: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
		...overrides,
	} as any;
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function libraryRoutes(r: any) {
	r.get('/api/library/watch-later', WatchLaterList);
	r.post('/api/library/watch-later', WatchLaterAdd);
	r.put('/api/library/watch-later/order', WatchLaterReorder);
	r.get('/api/library/watch-later/:videoId', WatchLaterStatus);
	r.delete('/api/library/watch-later/:videoId', WatchLaterRemove);
	r.get('/api/library/liked', LikedVideosList);
	r.get('/api/library/saved-posts', SavedPostsList);
	r.post('/api/library/saved-posts', SavedPostAdd);
	r.get('/api/library/saved-posts/:postId', SavedPostStatus);
	r.delete('/api/library/saved-posts/:postId', SavedPostRemove);
	r.post('/api/videos/:id/likes', LikeCreate);
	r.delete('/api/videos/:id/likes', LikeDelete);
	r.get('/api/playlists', PlaylistsList);
	r.post('/internal/library/backfill', LibraryBackfill);
}

function notificationRoutes(r: any) {
	r.get('/api/notifications', NotificationsList);
	r.get('/api/notifications/unread-count', NotificationsUnreadCount);
	r.post('/api/notifications/read', NotificationsMarkRead);
	r.post('/api/notifications/read-all', NotificationsMarkAllRead);
	r.get('/api/notifications/settings', NotificationSettingsGet);
	r.put('/api/notifications/settings', NotificationSettingsUpdate);
	r.get('/api/notifications/quiet-hours', NotificationQuietHoursGet);
	r.put('/api/notifications/quiet-hours', NotificationQuietHoursUpdateRoute);
	r.get('/api/notifications/channels/:channelId/bell', ChannelBellGet);
	r.put('/api/notifications/channels/:channelId/bell', ChannelBellUpdate);
	r.delete('/api/notifications/:id', NotificationsDelete);
}

describe('library helpers', () => {
	it('adds newest first, idempotently, up to the limit', () => {
		const wl = newWatchLater('u1');
		assert.equal(wl.id, 'watch-later-u1');
		assert.equal(wl.isPublic, false);
		assert.deepEqual(addToWatchLater(wl, 'a'), { added: true, full: false });
		assert.deepEqual(addToWatchLater(wl, 'b'), { added: true, full: false });
		assert.deepEqual(addToWatchLater(wl, 'a'), { added: false, full: false });
		assert.deepEqual(wl.videos, ['b', 'a']);
		wl.videos = Array.from({ length: WATCH_LATER_MAX_ITEMS }, (_, i) => `v${i}`);
		assert.deepEqual(addToWatchLater(wl, 'new'), { added: false, full: true });
	});

	it('pages ids with an offset cursor and round-trips keyset cursors', () => {
		assert.deepEqual(pageIds(['a', 'b', 'c'], 2, null), { ids: ['a', 'b'], nextCursor: '2' });
		assert.deepEqual(pageIds(['a', 'b', 'c'], 2, '2'), { ids: ['c'], nextCursor: null });
		assert.deepEqual(decodeCursor(encodeCursor(5, 'x:y')), { createdAt: 5, id: 'x:y' });
		assert.equal(decodeCursor('garbage'), null);
	});
});

describe('Watch later API', () => {
	it('requires authentication', async () => {
		const app = buildApp(libraryRoutes, null);
		const res = await app.request('/api/library/watch-later', {}, env());
		assert.equal(res.status, 401);
	});

	it('adds, lists, reports status, reorders and removes idempotently', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ id: 'v1' }), v2: videoFixture({ id: 'v2', title: 'Two' }) }) });
		const app = buildApp(libraryRoutes, { userId: 'me' });

		for (const id of ['v1', 'v2', 'v2']) {
			const res = await app.request('/api/library/watch-later', json({ videoId: id }), e);
			assert.equal(res.status, 200);
		}
		const stored = e.playlists.read('watch-later-me');
		assert.deepEqual(stored.videos, ['v2', 'v1']);
		assert.equal(stored.systemType, 'watch_later');
		assert.equal(stored.isPublic, false);

		const list = (await (await app.request('/api/library/watch-later?limit=1', {}, e)).json()) as any;
		assert.equal(list.result.total, 2);
		assert.deepEqual(list.result.items.map((v: any) => v.id), ['v2']);
		assert.equal(list.result.nextCursor, '1');

		const status = (await (await app.request('/api/library/watch-later/v1', {}, e)).json()) as any;
		assert.equal(status.result.saved, true);

		const bad = await app.request('/api/library/watch-later/order', { ...json({ videoIds: ['v1'] }), method: 'PUT' }, e);
		assert.equal(bad.status, 400);
		const ok = await app.request('/api/library/watch-later/order', { ...json({ videoIds: ['v1', 'v2'] }), method: 'PUT' }, e);
		assert.equal(ok.status, 200);
		assert.deepEqual(e.playlists.read('watch-later-me').videos, ['v1', 'v2']);

		for (let i = 0; i < 2; i++) {
			const res = await app.request('/api/library/watch-later/v1', { method: 'DELETE' }, e);
			assert.equal(res.status, 200);
		}
		assert.deepEqual(e.playlists.read('watch-later-me').videos, ['v2']);
	});

	it('refuses videos the user cannot view and hides Watch later from playlist listings', async () => {
		const e = env({
			videos: new MemoryBucket({ priv: videoFixture({ id: 'priv', isPublic: false, userId: 'someone' }), v1: videoFixture({ id: 'v1' }) }),
			playlists: new MemoryBucket({ p1: { id: 'p1', title: 'Mine', userId: 'me', channelId: 'ch', videos: [], isPublic: true, dateCreated: 'x', dateModified: 'x' } }),
		});
		const app = buildApp(libraryRoutes, { userId: 'me' });
		assert.equal((await app.request('/api/library/watch-later', json({ videoId: 'priv' }), e)).status, 404);
		await app.request('/api/library/watch-later', json({ videoId: 'v1' }), e);
		const listing = (await (await app.request('/api/playlists?limit=10', {}, e)).json()) as any;
		assert.deepEqual(listing.data.map((p: any) => p.id), ['p1']);
	});
});

describe('Liked videos index', () => {
	it('is maintained on like/unlike and lists newest first without scanning videos', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ id: 'v1' }), v2: videoFixture({ id: 'v2' }) }) });
		const app = buildApp(libraryRoutes, { userId: 'me' });
		await app.request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		await app.request('/api/videos/v2/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		// make v2 the most recent like deterministically
		e.NOTIFICATIONS_DB.raw.prepare("UPDATE liked_videos SET liked_at = 1 WHERE video_id = 'v1'").run();

		const before = e.videos.calls;
		const page = (await (await app.request('/api/library/liked', {}, e)).json()) as any;
		assert.deepEqual(page.result.items.map((v: any) => v.id), ['v2', 'v1']);
		assert.equal(page.result.total, 2);
		assert.equal(e.videos.calls - before, 2, 'only the listed videos are read');

		await app.request('/api/videos/v1/likes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		// unlike again is a no-op, not a crash
		assert.equal((await app.request('/api/videos/v1/likes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e)).status, 200);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows('SELECT video_id FROM liked_videos'), [{ video_id: 'v2' }]);
	});

	it('prunes index rows of deleted videos', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', isDeleted: true }) }) });
		e.NOTIFICATIONS_DB.raw.prepare("INSERT INTO liked_videos VALUES ('me', 'v1', 1), ('me', 'gone', 2)").run();
		const app = buildApp(libraryRoutes, { userId: 'me' });
		const page = (await (await app.request('/api/library/liked', {}, e)).json()) as any;
		assert.deepEqual(page.result.items, []);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows('SELECT * FROM liked_videos'), []);
	});

	it('returns 503 when the index is not bound', async () => {
		const app = buildApp(libraryRoutes, { userId: 'me' });
		assert.equal((await app.request('/api/library/liked', {}, env({ NOTIFICATIONS_DB: undefined }))).status, 503);
	});

	it('backfills likes and subscriptions idempotently', async () => {
		const e = env({
			videos: new MemoryBucket({
				v1: videoFixture({ id: 'v1', likes: [{ userId: 'a', dateCreated: '2026-01-02T00:00:00Z' }, { userId: 'a' }, { userId: 'b' }] }),
				'index:recent-videos': { id: 'index:recent-videos', likes: [{ userId: 'x' }] },
			}),
			channels: new MemoryBucket({ ch1: { id: 'ch1', subscriptions: [{ userId: 'a', channelId: 'ca' }, { userId: 'a', channelId: 'cb' }] } }),
		});
		const app = buildApp(libraryRoutes, null);
		for (let i = 0; i < 2; i++) {
			const res = (await (await app.request('/internal/library/backfill', json({ target: 'likes' }), e)).json()) as any;
			assert.equal(res.result.nextCursor, null);
			assert.equal(res.result.inserted, i === 0 ? 2 : 0);
		}
		for (let i = 0; i < 2; i++) {
			const subs = (await (await app.request('/internal/library/backfill', json({ target: 'subscriptions' }), e)).json()) as any;
			assert.equal(subs.result.inserted, i === 0 ? 1 : 0, 'each channel is imported once');
		}
		assert.deepEqual(e.NOTIFICATIONS_DB.rows('SELECT channel_id, user_id, bell FROM channel_subscribers'), [{ channel_id: 'ch1', user_id: 'a', bell: 'highlights' }]);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows('SELECT subscriber_channel_id FROM channel_subscriptions ORDER BY 1'), [{ subscriber_channel_id: 'ca' }, { subscriber_channel_id: 'cb' }]);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows('SELECT subscribers FROM channel_subscriber_counts'), [{ subscribers: 2 }]);
		assert.deepEqual(collectLikeRows({ id: 'v', isDeleted: true, likes: [{ userId: 'a' }] }, 0), []);
	});
});

describe('Saved posts', () => {
	it('saves, lists, reports status and unsaves idempotently', async () => {
		const e = env({ community_posts: new MemoryBucket({ 'posts/ch1/p1.json': { id: 'p1', channelId: 'ch1', content: 'hi', status: 'published' } }) });
		const app = buildApp(libraryRoutes, { userId: 'me' });
		assert.equal((await app.request('/api/library/saved-posts', json({ postId: 'nope', channelId: 'ch1' }), e)).status, 404);
		for (let i = 0; i < 2; i++) assert.equal((await app.request('/api/library/saved-posts', json({ postId: 'p1', channelId: 'ch1' }), e)).status, 200);
		const list = (await (await app.request('/api/library/saved-posts', {}, e)).json()) as any;
		assert.deepEqual(list.result.items.map((p: any) => p.id), ['p1']);
		assert.equal(((await (await app.request('/api/library/saved-posts/p1', {}, e)).json()) as any).result.saved, true);
		await app.request('/api/library/saved-posts/p1', { method: 'DELETE' }, e);
		assert.equal(((await (await app.request('/api/library/saved-posts/p1', {}, e)).json()) as any).result.saved, false);
	});
});

describe('Notifications API', () => {
	function seed(db: ReturnType<typeof createSqliteD1>) {
		const insert = db.raw.prepare(
			"INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, created_at) VALUES (?, ?, 'comments', 'comment', 'newComment', '{\"videoTitle\":\"T\"}', ?)",
		);
		insert.run('n1', 'me', 1000);
		insert.run('n2', 'me', 2000);
		insert.run('n3', 'me', 3000);
		insert.run('other', 'someone', 4000);
	}

	it('lists my notifications newest first with a cursor and unread count', async () => {
		const e = env();
		seed(e.NOTIFICATIONS_DB);
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const first = (await (await app.request('/api/notifications?limit=2', {}, e)).json()) as any;
		assert.deepEqual(first.result.items.map((n: any) => n.id), ['n3', 'n2']);
		assert.equal(first.result.unreadCount, 3);
		assert.deepEqual(first.result.items[0].params, { videoTitle: 'T' });
		assert.equal(first.result.items[0].isRead, false);
		const second = (await (await app.request(`/api/notifications?limit=2&cursor=${encodeURIComponent(first.result.nextCursor)}`, {}, e)).json()) as any;
		assert.deepEqual(second.result.items.map((n: any) => n.id), ['n1']);
		assert.equal(second.result.nextCursor, null);
	});

	it('marks read, marks all read and deletes only my own rows', async () => {
		const e = env();
		seed(e.NOTIFICATIONS_DB);
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const read = (await (await app.request('/api/notifications/read', json({ ids: ['n1', 'other'] }), e)).json()) as any;
		assert.equal(read.result.updated, 1);
		assert.equal(read.result.unreadCount, 2);
		assert.equal(((await (await app.request('/api/notifications/unread-count', {}, e)).json()) as any).result.unreadCount, 2);
		await app.request('/api/notifications/read-all', { method: 'POST' }, e);
		assert.equal(((await (await app.request('/api/notifications/unread-count', {}, e)).json()) as any).result.unreadCount, 0);
		assert.equal((await app.request('/api/notifications/other', { method: 'DELETE' }, e)).status, 404);
		assert.equal((await app.request('/api/notifications/n1', { method: 'DELETE' }, e)).status, 200);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows("SELECT is_read FROM notifications WHERE user_id = 'someone'"), [{ is_read: 0 }]);
	});

	it('reads and updates per-category settings', async () => {
		const e = env();
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const defaults = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.equal(defaults.result.settings.comments, true);
		const res = await app.request('/api/notifications/settings', { ...json({ settings: { comments: false } }), method: 'PUT' }, e);
		const body = (await res.json()) as any;
		assert.equal(body.result.settings.comments, false);
		assert.equal(body.result.settings.replies, true);
	});

	it('keeps account notices always on: reported on, not settable, a stray row ignored', async () => {
		const e = env();
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const defaults = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.equal(defaults.result.settings.account, true);
		assert.deepEqual(defaults.result.alwaysOn, ['account']);
		const res = await app.request('/api/notifications/settings', { ...json({ settings: { account: false, uploads: false } }), method: 'PUT' }, e);
		const body = (await res.json()) as any;
		assert.equal(body.result.settings.account, true);
		assert.equal(body.result.settings.uploads, false);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows("SELECT category FROM notification_settings WHERE user_id = 'me'"), [{ category: 'uploads' }]);
		e.NOTIFICATIONS_DB.raw.prepare("INSERT INTO notification_settings VALUES ('me', 'account', 0, 0)").run();
		const after = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.equal(after.result.settings.account, true);
	});

	it('reads and updates the email preferences (account email default on, language not picked)', async () => {
		const e = env();
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const defaults = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.deepEqual(defaults.result.email, { account: true, locale: null });
		const put = (email: unknown) => app.request('/api/notifications/settings', { ...json({ email }), method: 'PUT' }, e);
		assert.deepEqual(((await (await put({ account: false })).json()) as any).result.email, { account: false, locale: null });
		assert.deepEqual(((await (await put({ locale: 'ar' })).json()) as any).result.email, { account: false, locale: 'ar' });
		assert.equal((await put({ locale: 'fr' })).status, 400);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows("SELECT account_email, email_locale FROM notification_email_prefs WHERE user_id = 'me'"), [{ account_email: 0, email_locale: 'ar' }]);
	});

	it('gates quiet hours behind the quietHours switch and ignores quietHours fields on PUT /settings when off (E22-D6)', async () => {
		const searchDb = new SqliteD1();
		const e = env({ SEARCH_DB: searchDb });
		forgetFeatureSwitches();
		const app = buildApp(notificationRoutes, { userId: 'me' });

		// Switch off by default: dedicated routes answer 404 feature_off; /settings omits quietHours and ignores it on PUT
		const getOff = await app.request('/api/notifications/quiet-hours', {}, e);
		assert.equal(getOff.status, 404);
		assert.equal(((await getOff.json()) as any).code, 'feature_off');
		const putOff = await app.request('/api/notifications/quiet-hours', { ...json({ enabled: true }), method: 'PUT' }, e);
		assert.equal(putOff.status, 404);

		const settingsOff = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.equal('quietHours' in settingsOff.result, false);

		// Even an invalid quietHours payload is completely ignored while quietHours switch is OFF (no 400, other settings save)
		const saveInvalidWhileOff = await app.request(
			'/api/notifications/settings',
			{
				...json({
					settings: { comments: false },
					email: { locale: 'ar' },
					quietHours: { enabled: true, timezone: 'Invalid/Zone', startMinute: 500, endMinute: 500 },
				}),
				method: 'PUT',
			},
			e,
		);
		assert.equal(saveInvalidWhileOff.status, 200);
		const savedWhileOffBody = (await saveInvalidWhileOff.json()) as any;
		assert.equal(savedWhileOffBody.result.settings.comments, false);
		assert.equal(savedWhileOffBody.result.email.locale, 'ar');
		assert.equal('quietHours' in savedWhileOffBody.result, false);
		assert.deepEqual(e.NOTIFICATIONS_DB.rows("SELECT user_id FROM notification_quiet_hours WHERE user_id = 'me'"), []);

		// Turn switch ON: dedicated routes and /settings both read & update quiet hours
		await writeFeatureSwitch(e, { key: 'quietHours', enabled: true, expectedVersion: 0, actorId: 'usr_admin', currentStored: false });
		forgetFeatureSwitches();

		const defaults = (await (await app.request('/api/notifications/settings', {}, e)).json()) as any;
		assert.deepEqual(defaults.result.quietHours, {
			enabled: false,
			timezone: 'UTC',
			startMinute: 1320,
			endMinute: 360,
			prayerQuietEnabled: false,
			prayerWindows: [],
			prayerWindowsUpdatedAt: null,
		});

		const put = (quietHours: unknown, headers: Record<string, string> = {}) =>
			app.request('/api/notifications/quiet-hours', {
				method: 'PUT',
				headers: { 'content-type': 'application/json', ...headers },
				body: JSON.stringify(quietHours),
			}, e);

		const saved = ((await (await put({
			enabled: true,
			timezone: 'Asia/Riyadh',
			startMinute: 1350,
			endMinute: 360,
			prayerQuietEnabled: true,
			prayerWindows: [{ startMinute: 310, endMinute: 335 }, { startMinute: 730, endMinute: 760 }],
		})).json()) as any).result;
		assert.equal(saved.enabled, true);
		assert.equal(saved.timezone, 'Asia/Riyadh');
		assert.equal(saved.startMinute, 1350);
		assert.equal(saved.endMinute, 360);
		assert.equal(saved.prayerQuietEnabled, true);
		assert.deepEqual(saved.prayerWindows, [{ startMinute: 310, endMinute: 335 }, { startMinute: 730, endMinute: 760 }]);
		assert.equal(typeof saved.prayerWindowsUpdatedAt, 'number');

		const directGet = ((await (await app.request('/api/notifications/quiet-hours', {}, e)).json()) as any).result;
		assert.equal(directGet.enabled, true);
		assert.equal(directGet.prayerWindowsUpdatedAt, saved.prayerWindowsUpdatedAt);

		// Atomic PUT /settings validation when switch is ON: invalid quietHours returns 400 WITHOUT writing settings or email
		const atomicBadTz = await app.request(
			'/api/notifications/settings',
			{
				...json({
					settings: { replies: false },
					email: { account: false },
					quietHours: { timezone: 'Not/AZone' },
				}),
				method: 'PUT',
			},
			e,
		);
		assert.equal(atomicBadTz.status, 400);
		const atomicEqualMinutes = await app.request(
			'/api/notifications/settings',
			{
				...json({
					settings: { replies: false },
					email: { account: false },
					quietHours: { startMinute: 360 },
				}),
				method: 'PUT',
			},
			e,
		);
		assert.equal(atomicEqualMinutes.status, 400);
		const afterRejectedSaves = ((await (await app.request('/api/notifications/settings', {}, e)).json()) as any).result;
		assert.equal(afterRejectedSaves.settings.replies, true, 'replies was not half-applied on 400');
		assert.equal(afterRejectedSaves.email.account, true, 'email.account was not half-applied on 400');

		// Uses the user's saved profile timezone instead of defaulting to UTC when available
		const tzEnv = env({
			SEARCH_DB: searchDb,
			profiles: new MemoryBucket({ tzUser: { id: 'tzUser', timezone: 'Asia/Dubai' } }),
		});
		const tzApp = buildApp(notificationRoutes, { userId: 'tzUser' });
		const tzDefaults = ((await (await tzApp.request('/api/notifications/quiet-hours', {}, tzEnv)).json()) as any).result;
		assert.equal(tzDefaults.timezone, 'Asia/Dubai');
		const tzEnabled = ((
			await (
				await tzApp.request('/api/notifications/quiet-hours', { ...json({ enabled: true }), method: 'PUT' }, tzEnv)
			).json()
		) as any).result;
		assert.equal(tzEnabled.enabled, true);
		assert.equal(tzEnabled.timezone, 'Asia/Dubai');

		// Rejects invalid IANA zone, equal start/end minutes, or > 5 prayer windows
		assert.equal((await put({ timezone: 'Not/AZone' })).status, 400);
		assert.equal((await put({ startMinute: 500, endMinute: 500 })).status, 400);
		assert.equal((await put({ startMinute: 360 })).status, 400, 'matches stored endMinute 360');
		assert.equal(
			(await put({
				prayerWindows: Array.from({ length: 6 }, (_, i) => ({ startMinute: i * 60, endMinute: i * 60 + 20 })),
			})).status,
			400,
		);
		forgetFeatureSwitches();
	});

	it('manages the per-channel bell for subscribed channels only', async () => {
		const e = env({ channels: new MemoryBucket({ ch1: { id: 'ch1', subscriptions: [{ userId: 'me', channelId: 'mine' }] }, ch2: { id: 'ch2', subscriptions: [] } }) });
		const app = buildApp(notificationRoutes, { userId: 'me' });
		const initial = (await (await app.request('/api/notifications/channels/ch1/bell', {}, e)).json()) as any;
		assert.deepEqual(initial.result, { channelId: 'ch1', bell: 'highlights', subscribed: true });

		const put = (bell: string, ch = 'ch1') => app.request(`/api/notifications/channels/${ch}/bell`, { ...json({ bell }), method: 'PUT' }, e);
		assert.equal((await put('all')).status, 200);
		assert.equal(((await (await app.request('/api/notifications/channels/ch1/bell', {}, e)).json()) as any).result.bell, 'all');
		assert.equal((await put('none', 'ch2')).status, 409);
		assert.equal((await put('none', 'missing')).status, 404);
		assert.equal((await put('loud')).status, 400);
	});
});

describe('notification producers', () => {
	it('notifyUser queues the notification for persistence with the same id', async () => {
		const e = env();
		await notifyUser(e, 'owner', { notificationType: 'comment', notificationKey: 'newComment', params: { videoTitle: 'T' }, actionUrl: '/video/v1' });
		assert.equal(e.queue.messages.length, 1);
		const msg = e.queue.messages[0];
		assert.equal(msg.type, MessageType.NotificationCreate);
		assert.equal(msg.payload.recipientUserId, 'owner');
		assert.equal(msg.payload.notificationKey, 'newComment');
		assert.equal(msg.payload.realtimeSent, false);
	});

	it('notifyUser sends names on one line without direction controls, in realtime and to the queue, for any kind', async (t) => {
		const realFetch = globalThis.fetch;
		const pushed: any[] = [];
		t.after(() => void (globalThis.fetch = realFetch));
		globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
			pushed.push(JSON.parse(String(init.body)).message.data.params);
			return new Response('{}');
		}) as unknown as typeof fetch;
		const e = { ...env(), WEBSOCKET_URL: 'https://ws.test', INTERNAL_API_KEY: 'k' };
		await notifyUser(e, 'owner', { notificationType: 'subscription', notificationKey: 'newSubscriber', params: { channelName: '\u202eCorner\u2069\nx' } });
		await notifyUser(e, 'owner', { notificationType: 'comment', notificationKey: 'commentReply', params: { actorName: 'Amina\u2067', videoTitle: 'A\u2029B' } });
		const said = [{ channelName: 'Corner x' }, { actorName: 'Amina', videoTitle: 'A B' }];
		assert.deepEqual(pushed, said);
		assert.deepEqual(e.queue.messages.map((m: any) => m.payload.params), said);
	});

	it('notifyUser skips a disabled category entirely', async () => {
		const e = env();
		e.NOTIFICATIONS_DB.raw.prepare("INSERT INTO notification_settings VALUES ('owner', 'subscribers', 0, 0)").run();
		await notifyUser(e, 'owner', { notificationType: 'subscription', notificationKey: 'newSubscriber' });
		assert.equal(e.queue.messages.length, 0);
	});

	it('only announces ready, public, unscheduled videos and marks shorts as non-highlights', async () => {
		assert.equal(isAnnounceable({ id: 'v', channelId: 'c', uploadStatus: 'ready' }), true);
		assert.equal(isAnnounceable({ id: 'v', channelId: 'c', isPublic: false }), false);
		assert.equal(isAnnounceable({ id: 'v', channelId: 'c', uploadStatus: 'processing' }), false);
		assert.equal(isAnnounceable({ id: 'v', channelId: 'c', scheduledPublishStatus: 'scheduled' }), false);
		assert.equal(isHighlightVideo({ duration: 45, width: 1080, height: 1920 }), false);
		assert.equal(isHighlightVideo({ duration: 45, width: 1920, height: 1080 }), true, 'landscape clips are highlights');
		assert.equal(isHighlightVideo({ duration: 45 }), true, 'unknown shape: a video until detected');
		assert.equal(isHighlightVideo({ duration: 600, format: 'short' }), false, 'the uploader chose Short');
		assert.equal(isHighlightVideo({ duration: 600 }), true);
		assert.equal(isHighlightVideo({}), true);

		const e = env({ channels: new MemoryBucket({ c: { id: 'c', name: 'Chan' } }) });
		assert.equal(await announceNewVideo(e, { id: 'v', channelId: 'c', userId: 'owner', title: 'Hi', duration: 30, width: 720, height: 1280, uploadStatus: 'ready' }), true);
		await announceLiveStarted(e, { id: 'l1', channelId: 'c', userId: 'owner', title: 'Live' });
		const [video, live] = e.queue.messages;
		assert.equal(video.type, MessageType.NotificationFanout);
		assert.deepEqual(video.payload.params, { channelName: 'Chan', videoTitle: 'Hi' });
		assert.equal(video.payload.isHighlight, false);
		assert.equal(live.payload.kind, 'live_started');
		assert.equal(live.payload.isHighlight, true);
	});
});
