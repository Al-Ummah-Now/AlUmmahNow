/**
 * Members subscribe without a channel (owner request 2026-11-13): with no
 * active channel (no channelId header) the subscription is the member's own,
 * stored as subscriber key `user:<userId>` in channel_subscriptions; with a
 * channel active it is that channel's, as before. Status, counts, the feed,
 * the subscriptions list, the bell, the subscribed_channels section, privacy
 * export/erase and analytics all see both kinds, each identity once.
 *
 * Real endpoints and SQL against node:sqlite (D1 batches are transactions).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionCreate } from '../src/endpoints/channel/SubscriptionCreate';
import { SubscriptionDelete } from '../src/endpoints/channel/SubscriptionDelete';
import { SubscriptionStatus } from '../src/endpoints/channel/SubscriptionStatus';
import { SubscriptionsList } from '../src/endpoints/channel/SubscriptionsList';
import { SubscriptionFeed } from '../src/endpoints/channel/SubscriptionFeed';
import {
	changeSubscription,
	eraseUserSubscriptions,
	exportUserSubscriptions,
	isMemberSubscribedTo,
	subscribedChannelIds,
	subscriberDailyStats,
	userSubscriberKey,
} from '../src/lib/subscription-store';
import { attachSubscriberStats, buildDailySeries, buildSummary } from '../src/lib/analytics';
import { footprintsOf } from '../src/lib/privacy/footprints';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, userId: `owner-of-${id}`, email: 'o@test.local', name: `Channel ${id}`, isMain: true,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [],
		...overrides,
	};
}

function env(withDb = true) {
	return {
		channels: new MemoryBucket({
			target: channel('target', { userId: 'creator', name: 'Target' }),
			other: channel('other', { userId: 'creator2', name: 'Other' }),
			'me-ch': channel('me-ch', { userId: 'me', name: 'My channel' }),
			'creator-ch': channel('creator-ch', { userId: 'creator', name: 'Creator 2nd' }),
		}),
		profiles: new MemoryBucket({ viewer: { id: 'viewer' }, me: { id: 'me' } }),
		videos: new MemoryBucket({
			t1: videoFixture({ id: 't1', userId: 'creator', channelId: 'target', dateCreated: '2026-02-01T00:00:00Z' }),
			t2: videoFixture({ id: 't2', userId: 'creator', channelId: 'target', dateCreated: '2026-02-03T00:00:00Z' }),
			o1: videoFixture({ id: 'o1', userId: 'creator2', channelId: 'other', dateCreated: '2026-02-04T00:00:00Z' }),
		}),
		channel_tabs: new MemoryBucket(),
		queue: new MemoryQueue(),
		...(withDb ? { NOTIFICATIONS_DB: createSqliteD1() } : {}),
	} as any;
}

function routes(r: any) {
	r.post('/api/channels/:id/subscriptions', SubscriptionCreate);
	r.delete('/api/channels/:id/subscriptions', SubscriptionDelete);
	r.get('/api/channels/:id/subscriptions/status', SubscriptionStatus);
	r.get('/api/profile/subscriptions', SubscriptionsList);
	r.get('/api/profile/subscriptions/feed', SubscriptionFeed);
}

const as = (userId: string) => buildApp(routes, { userId });
const hdr = (channelId?: string) => (channelId ? { channelId } : {});
const call = async (e: any, user: string, method: string, path: string, channelId?: string) => {
	const res = await as(user).request(path, { method, headers: hdr(channelId) }, e);
	return { status: res.status, body: (await res.json()) as any };
};
const subscribe = (e: any, user: string, target = 'target', channelId?: string) => call(e, user, 'POST', `/api/channels/${target}/subscriptions`, channelId);
const unsubscribe = (e: any, user: string, target = 'target', channelId?: string) => call(e, user, 'DELETE', `/api/channels/${target}/subscriptions`, channelId);
const status = async (e: any, user: string, target = 'target', channelId?: string) =>
	(await call(e, user, 'GET', `/api/channels/${target}/subscriptions/status`, channelId)).body.result;
const count = (e: any, id = 'target') => e.NOTIFICATIONS_DB.rows('SELECT subscribers FROM channel_subscriber_counts WHERE channel_id = ?', id)[0]?.subscribers;
const bell = (e: any, user: string, id = 'target') => e.NOTIFICATIONS_DB.rows('SELECT COUNT(*) AS n FROM channel_subscribers WHERE channel_id = ? AND user_id = ?', id, user)[0].n;

describe('a member without a channel subscribes as themselves', () => {
	it('subscribe → status, count, bell row and a Subscribe event for the owner', async () => {
		const e = env();
		assert.deepEqual(await status(e, 'viewer'), { channelId: 'target', isSubscribed: false, subscriberCount: 0 });

		const created = await subscribe(e, 'viewer');
		assert.equal(created.status, 201);
		assert.deepEqual(created.body.result, { channelId: 'target', isSubscribed: true, subscriberCount: 1 });
		assert.deepEqual(
			e.NOTIFICATIONS_DB.rows('SELECT subscriber_channel_id, user_id FROM channel_subscriptions WHERE channel_id = ?', 'target'),
			[{ subscriber_channel_id: userSubscriberKey('viewer'), user_id: 'viewer' }],
		);
		assert.equal(bell(e, 'viewer'), 1, 'the member gets the new-video bell row');
		const event = e.queue.messages.find((m: any) => m.type === MessageType.Subscribe);
		assert.equal(event.payload.targetChannelId, 'target');
		assert.equal(event.payload.userId, 'viewer');
		assert.equal(event.payload.subscriberChannelId, null);
		assert.equal(event.payload.subscriberType, 'user');

		assert.deepEqual(await status(e, 'viewer'), { channelId: 'target', isSubscribed: true, subscriberCount: 1 });
		assert.equal((await status(e, 'stranger')).isSubscribed, false);
	});

	it('subscribing again is a no-op (200, counted once)', async () => {
		const e = env();
		await subscribe(e, 'viewer');
		const again = await subscribe(e, 'viewer');
		assert.equal(again.status, 200);
		assert.equal(again.body.result.subscriberCount, 1);
		assert.equal(count(e), 1);
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.Subscribe).length, 1);
	});

	it('unsubscribe removes it, the count and the bell row; again is harmless', async () => {
		const e = env();
		await subscribe(e, 'viewer');
		const removed = await unsubscribe(e, 'viewer');
		assert.equal(removed.status, 200);
		assert.deepEqual(removed.body.result, { channelId: 'target', isSubscribed: false, subscriberCount: 0 });
		assert.equal(count(e), 0);
		assert.equal(bell(e, 'viewer'), 0);
		const event = e.queue.messages.find((m: any) => m.type === MessageType.Unsubscribe);
		assert.equal(event.payload.subscriberType, 'user');
		assert.equal((await unsubscribe(e, 'viewer')).status, 200);
		assert.equal(count(e), 0, 'never below zero');
	});

	it('the feed shows the subscribed channel\'s videos and the list shows the channel', async () => {
		const e = env();
		const empty = await call(e, 'viewer', 'GET', '/api/profile/subscriptions/feed?limit=10');
		assert.deepEqual(empty.body.data, []);
		await subscribe(e, 'viewer');
		const feed = await call(e, 'viewer', 'GET', '/api/profile/subscriptions/feed?limit=10');
		assert.equal(feed.status, 200);
		assert.deepEqual(feed.body.data.map((v: any) => v.id), ['t2', 't1'], 'newest first, only the subscribed channel');
		const list = await call(e, 'viewer', 'GET', '/api/profile/subscriptions');
		assert.equal(list.status, 200);
		assert.deepEqual(list.body.data.map((c: any) => c.id), ['target']);
		assert.equal(list.body.total, 1);

		await unsubscribe(e, 'viewer');
		assert.deepEqual((await call(e, 'viewer', 'GET', '/api/profile/subscriptions/feed?limit=10')).body.data, []);
		assert.equal((await call(e, 'viewer', 'GET', '/api/profile/subscriptions')).body.total, 0);
	});

	it('a member cannot subscribe to their own channel as themselves', async () => {
		const e = env();
		const res = await subscribe(e, 'creator');
		assert.equal(res.status, 400);
		assert.equal(count(e) ?? 0, 0);
	});

	it('works without D1 too (local dev): legacy array entry under the user key, profile index', async () => {
		const e = env(false);
		const created = await subscribe(e, 'viewer');
		assert.equal(created.status, 201);
		assert.deepEqual(e.channels.read('target').subscriptions.map((s: any) => s.channelId), [userSubscriberKey('viewer')]);
		assert.deepEqual(e.profiles.read('viewer').subscribedTo, ['target']);
		assert.equal((await status(e, 'viewer')).isSubscribed, true);
		await unsubscribe(e, 'viewer');
		assert.deepEqual(e.channels.read('target').subscriptions, []);
		assert.deepEqual(e.profiles.read('viewer').subscribedTo, []);
	});
});

describe('member and channel subscriptions side by side', () => {
	it('each identity counts once; status follows the active identity; the bell stays while either remains', async () => {
		const e = env();
		assert.equal((await subscribe(e, 'me', 'target', 'me-ch')).status, 201);
		assert.equal((await subscribe(e, 'me')).status, 201);
		assert.equal(count(e), 2, 'two identities subscribe: the member and their channel');
		assert.equal((await subscribe(e, 'viewer')).body.result.subscriberCount, 3);

		assert.equal((await status(e, 'me', 'target', 'me-ch')).isSubscribed, true);
		assert.equal((await status(e, 'me')).isSubscribed, true);

		// The member's own subscription goes; their channel's stays
		const removed = await unsubscribe(e, 'me');
		assert.equal(removed.body.result.subscriberCount, 2);
		assert.equal((await status(e, 'me')).isSubscribed, false);
		assert.equal((await status(e, 'me', 'target', 'me-ch')).isSubscribed, true);
		assert.equal(bell(e, 'me'), 1, 'still subscribed through the channel');
		assert.equal(await isMemberSubscribedTo(e.NOTIFICATIONS_DB, { id: 'target' }, 'me'), true);
		assert.deepEqual(await subscribedChannelIds(e.NOTIFICATIONS_DB, 'me', []), ['target'], 'the list shows the channel once');

		await unsubscribe(e, 'me', 'target', 'me-ch');
		assert.equal(bell(e, 'me'), 0);
		assert.equal(await isMemberSubscribedTo(e.NOTIFICATIONS_DB, { id: 'target' }, 'me'), false);
		assert.equal(count(e), 1);
	});

	it('a member subscribed both ways sees each channel once in the list and feed', async () => {
		const e = env();
		await subscribe(e, 'me', 'target', 'me-ch');
		await subscribe(e, 'me');
		await subscribe(e, 'me', 'other');
		const list = await call(e, 'me', 'GET', '/api/profile/subscriptions');
		assert.deepEqual(list.body.data.map((c: any) => c.id), ['target', 'other']);
		const feed = await call(e, 'me', 'GET', '/api/profile/subscriptions/feed?limit=10');
		assert.deepEqual(feed.body.data.map((v: any) => v.id), ['o1', 't2', 't1']);
	});

	it('scope=all (the subscriptions page) removes the member from the channel under every identity', async () => {
		for (const withDb of [true, false]) {
			const e = env(withDb);
			await subscribe(e, 'me', 'target', 'me-ch');
			await subscribe(e, 'me');
			await subscribe(e, 'viewer');
			const res = await call(e, 'me', 'DELETE', '/api/channels/target/subscriptions?scope=all');
			assert.equal(res.status, 200);
			assert.deepEqual(res.body.result, { channelId: 'target', isSubscribed: false, subscriberCount: 1 }, `withDb=${withDb}`);
			assert.equal((await call(e, 'me', 'GET', '/api/profile/subscriptions')).body.total, 0);
			assert.equal((await status(e, 'viewer')).isSubscribed, true, 'other members are untouched');
			assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.Unsubscribe).length, 2);
			if (withDb) assert.equal(bell(e, 'me'), 0);
			// Nothing left: still 200 with the count
			assert.equal((await call(e, 'me', 'DELETE', '/api/channels/target/subscriptions?scope=all')).body.result.subscriberCount, 1);
		}
	});

	it('still refuses subscribing as someone else\'s channel', async () => {
		const e = env();
		assert.equal((await subscribe(e, 'viewer', 'target', 'me-ch')).status, 403);
	});
});

describe('privacy and analytics see member subscriptions', () => {
	it('export marks the member\'s own subscription; erase removes it and the counts', async () => {
		const e = env();
		await subscribe(e, 'me');
		await subscribe(e, 'me', 'other', 'me-ch');
		await subscribe(e, 'viewer');
		const exported = await exportUserSubscriptions(e.NOTIFICATIONS_DB, 'me');
		assert.deepEqual(
			exported.map((s) => [s.subscribedToChannelId, s.channelId, s.subscribedAs]).sort(),
			[['other', 'me-ch', 'channel'], ['target', null, 'member']],
		);
		assert.equal(await eraseUserSubscriptions(e.NOTIFICATIONS_DB, 'me'), 2);
		assert.equal(count(e), 1, 'the other member still counts');
		assert.equal(count(e, 'other'), 0);
		assert.deepEqual(await exportUserSubscriptions(e.NOTIFICATIONS_DB, 'me'), []);
	});

	it('a legacy array entry under the user key names the member in the channel footprint', () => {
		const [fp] = footprintsOf('channels', 'target', { subscriptions: [{ userId: 'viewer', channelId: userSubscriberKey('viewer') }] });
		assert.deepEqual(fp.userIds, ['viewer']);
	});

	it('analytics count new subscribers per day and the total, both kinds', async () => {
		const e = env();
		await changeSubscription(e, { id: 'target' }, { userId: 'viewer' }, 'add');
		await changeSubscription(e, { id: 'target' }, { userId: 'me', channelId: 'me-ch' }, 'add');
		const now = Date.now();
		const today = new Date(now).toISOString().slice(0, 10);
		const stats = await subscriberDailyStats(e.NOTIFICATIONS_DB, [{ id: 'target' }], now - 86_400_000, now + 86_400_000);
		assert.deepEqual(stats.get('target'), { byDay: { [today]: 2 }, total: 2 });

		const range = { from: new Date(now - 6 * 86_400_000), to: new Date(now) };
		const channels = await attachSubscriberStats(e, [{ id: 'target', userId: 'creator' }], range);
		const series = buildDailySeries(range, [], channels, []);
		assert.equal(series.find((d) => d.date === today)?.subscribers, 2);
		assert.equal(buildSummary([], channels).totalSubscribers, 2);
	});
});
