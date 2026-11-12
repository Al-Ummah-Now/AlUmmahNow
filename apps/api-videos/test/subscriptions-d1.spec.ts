/**
 * Channel subscriptions in D1 (lib/subscription-store.ts, SCALABILITY-AUDIT
 * AV-4/AV-5/AV-6). Subscribers no longer read-modify-write the channel JSON:
 * each subscription is a row and the count moves with it in one transaction,
 * so any number of parallel subscribers add up exactly. Legacy R2 arrays are
 * imported once per channel (marker row) without losing or double counting
 * anything that happens meanwhile.
 *
 * Runs the real endpoints and SQL against node:sqlite (batches are
 * transactions, like D1) and an R2 fake that honours `onlyIf`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionCreate } from '../src/endpoints/channel/SubscriptionCreate';
import { SubscriptionDelete } from '../src/endpoints/channel/SubscriptionDelete';
import { SubscriptionStatus } from '../src/endpoints/channel/SubscriptionStatus';
import { SubscriptionsList } from '../src/endpoints/channel/SubscriptionsList';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import {
	importLegacySubscriptions,
	eraseUserSubscriptions,
	exportUserSubscriptions,
	subscribedChannelIds,
	subscriberCounts,
} from '../src/lib/subscription-store';
import { importPendingSubscriptions } from '../src/lib/subscription-import';
import { ensureChannelCollection } from '../src/lib/channelCollection';
import { OperationBudget } from '../src/lib/privacy/scan';
import R2Repository from '../src/lib/r2Repo';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, userId: `owner-of-${id}`, email: 'o@test.local', name: `Channel ${id}`, isMain: true,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [],
		...overrides,
	};
}

function env(channels: MemoryBucket, profiles = new MemoryBucket()) {
	return { channels, profiles, videos: new MemoryBucket(), channel_tabs: new MemoryBucket(), queue: new MemoryQueue(), NOTIFICATIONS_DB: createSqliteD1() };
}

function routes(r: any) {
	r.get('/api/channels/:id', ChannelFetch);
	r.put('/api/channels/:id', ChannelUpdate);
	r.post('/api/channels/:id/subscriptions', SubscriptionCreate);
	r.delete('/api/channels/:id/subscriptions', SubscriptionDelete);
	r.get('/api/channels/:id/subscriptions/status', SubscriptionStatus);
	r.get('/api/profile/subscriptions', SubscriptionsList);
}

const as = (userId: string) => buildApp(routes, { userId });
/** The subscriber's own channel (`<user>-ch`): subscribing as anyone else's is refused. */
async function ownChannel(e: any, user: string) {
	if (!(await e.channels.get(`${user}-ch`))) await e.channels.put(`${user}-ch`, JSON.stringify(channel(`${user}-ch`, { userId: user })));
}
const subscribeAs = async (e: any, user: string, target = 'target') =>
	(await ownChannel(e, user), as(user)).request(`/api/channels/${target}/subscriptions`, { method: 'POST', headers: { channelId: `${user}-ch` } }, e);
const unsubscribeAs = (e: any, user: string, target = 'target') =>
	as(user).request(`/api/channels/${target}/subscriptions`, { method: 'DELETE', headers: { channelId: `${user}-ch` } }, e);

const count = (e: any, id = 'target') => e.NOTIFICATIONS_DB.rows('SELECT subscribers FROM channel_subscriber_counts WHERE channel_id = ?', id)[0]?.subscribers;
const rows = (e: any, id = 'target') => e.NOTIFICATIONS_DB.rows('SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel_id = ?', id)[0].n;

describe('subscriptions in D1: parallel subscribers', () => {
	it('200 people subscribing at the same moment are all counted', async () => {
		const e = env(new SlowBucket({ target: channel('target') }));
		const N = 200;
		const statuses = await Promise.all(Array.from({ length: N }, (_, i) => subscribeAs(e, `u${i}`).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 201), 'every subscribe created a subscription');
		assert.equal(rows(e), N);
		assert.equal(count(e), N, 'the count is exact');
		assert.equal(e.NOTIFICATIONS_DB.rows('SELECT COUNT(*) AS n FROM channel_subscribers WHERE channel_id = ?', 'target')[0].n, N, 'every subscriber gets a bell row');
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.Subscribe).length, N, 'one Subscribe event each');
	});

	it('subscribes, unsubscribes and repeats in parallel end at the exact state', async () => {
		const e = env(new SlowBucket({ target: channel('target') }));
		// u0..u59 subscribed first
		for (let i = 0; i < 60; i++) await subscribeAs(e, `u${i}`);
		await Promise.all([
			// u0..u29 leave (twice each), u60..u99 join (twice each), u30..u59 subscribe again (no-op)
			...Array.from({ length: 30 }, (_, i) => unsubscribeAs(e, `u${i}`)),
			...Array.from({ length: 30 }, (_, i) => unsubscribeAs(e, `u${i}`)),
			...Array.from({ length: 40 }, (_, i) => subscribeAs(e, `u${60 + i}`)),
			...Array.from({ length: 40 }, (_, i) => subscribeAs(e, `u${60 + i}`)),
			...Array.from({ length: 30 }, (_, i) => subscribeAs(e, `u${30 + i}`)),
		]);
		assert.equal(rows(e), 70);
		assert.equal(count(e), 70);
		const status = await (await as('u0').request('/api/channels/target/subscriptions/status', { headers: { channelId: 'u0-ch' } }, e)).json() as any;
		assert.deepEqual(status.result, { channelId: 'target', isSubscribed: false, subscriberCount: 70 });
		const joined = await (await as('u99').request('/api/channels/target/subscriptions/status', { headers: { channelId: 'u99-ch' } }, e)).json() as any;
		assert.equal(joined.result.isSubscribed, true);
	});

	it('owner edits during a subscribe burst neither lose subscribers nor get reverted', async () => {
		const channels = new SlowBucket({ target: channel('target', { userId: 'owner' }) });
		const e = env(channels);
		await Promise.all([
			...Array.from({ length: 50 }, (_, i) => subscribeAs(e, `u${i}`)),
			as('owner').request('/api/channels/target', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }) }, e),
		]);
		assert.equal(count(e), 50);
		assert.equal(channels.read('target').name, 'Renamed');
		const view = await (await buildApp(routes).request('/api/channels/target', {}, e)).json() as any;
		assert.equal(view.subscriptionsCount, 50, 'the public view counts from D1');
	});
});

describe('legacy R2 subscriptions: imported once, nothing lost meanwhile', () => {
	const legacy = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, userId: `old${i}`, channelId: `old${i}-ch`, dateCreated: '2025-06-01T00:00:00.000Z' }));

	it('reads the legacy array until the channel is imported', async () => {
		const e = env(new MemoryBucket({ target: channel('target', { subscriptions: legacy(7) }) }));
		const counts = await subscriberCounts(e.NOTIFICATIONS_DB as any, [channel('target', { subscriptions: legacy(7) }) as any]);
		assert.equal(counts.get('target'), 7);
		const status = await (await as('old3').request('/api/channels/target/subscriptions/status', { headers: { channelId: 'old3-ch' } }, e)).json() as any;
		assert.deepEqual(status.result, { channelId: 'target', isSubscribed: true, subscriberCount: 7 });
	});

	it('parallel subscribes, unsubscribes of legacy subscribers and imports end exact', async () => {
		const stored = channel('target', { subscriptions: legacy(10) });
		const e = env(new SlowBucket({ target: stored }));
		await Promise.all([
			...Array.from({ length: 25 }, (_, i) => subscribeAs(e, `new${i}`)),
			...Array.from({ length: 4 }, (_, i) => unsubscribeAs(e, `old${i}`)),
			...Array.from({ length: 5 }, () => importLegacySubscriptions(e.NOTIFICATIONS_DB as any, stored)),
		]);
		assert.equal(rows(e), 10 + 25 - 4);
		assert.equal(count(e), 31);
		assert.equal(e.NOTIFICATIONS_DB.rows('SELECT COUNT(*) AS n FROM channel_subscription_imports')[0].n, 1, 'one import marker');
		// The frozen R2 array is ignored from now on
		const counts = await subscriberCounts(e.NOTIFICATIONS_DB as any, [stored as any]);
		assert.equal(counts.get('target'), 31);
	});

	it('user-side lists: D1 rows plus profile entries of channels not imported yet', async () => {
		const e = env(
			new MemoryBucket({ a: channel('a', { subscriptions: [{ id: 'x', userId: 'me', channelId: 'me-ch' }] }), b: channel('b'), c: channel('c') }),
			new MemoryBucket({ me: { id: 'me', subscribedTo: ['a', 'c'] } }),
		);
		// c was imported (and the user unsubscribed there): its stale profile entry no longer counts
		await importLegacySubscriptions(e.NOTIFICATIONS_DB as any, channel('c') as any);
		await subscribeAs(e, 'me', 'b');
		assert.deepEqual(await subscribedChannelIds(e.NOTIFICATIONS_DB as any, 'me', ['a', 'c']), ['a', 'b']);
		const list = await (await as('me').request('/api/profile/subscriptions', {}, e)).json() as any;
		assert.deepEqual(list.data.map((ch: any) => ch.id), ['a', 'b']);
		assert.equal(list.total, 2);
	});

	it('the hourly import walks every channel within its budget and resumes where it stopped', async () => {
		const initial: Record<string, unknown> = {};
		for (let i = 0; i < 250; i++) initial[`ch${String(i).padStart(3, '0')}`] = channel(`ch${i}`, { subscriptions: legacy(i % 3) });
		const e = env(new MemoryBucket(initial));
		let runs = 0;
		let completed = false;
		while (!completed && runs < 20) {
			runs++;
			const result = await importPendingSubscriptions(e as any, new OperationBudget(100));
			completed = result.passCompleted;
		}
		assert.ok(completed, 'a pass completed');
		assert.ok(runs > 1, 'the work was spread over several budgeted runs');
		assert.equal(e.NOTIFICATIONS_DB.rows('SELECT COUNT(*) AS n FROM channel_subscription_imports')[0].n, 250, 'every channel imported once');
		const expected = Array.from({ length: 250 }, (_, i) => i % 3).reduce((a, b) => a + b, 0);
		assert.equal(e.NOTIFICATIONS_DB.rows('SELECT SUM(subscribers) AS n FROM channel_subscriber_counts')[0].n, expected);
		assert.equal(e.NOTIFICATIONS_DB.rows('SELECT passes, cursor FROM channel_subscription_import_state')[0].passes, 1);
	});
});

describe('subscriber identity and privacy', () => {
	it('subscribing as a channel the caller does not own is refused', async () => {
		const e = env(new MemoryBucket({ target: channel('target'), victim: channel('victim', { userId: 'victim' }) }));
		const res = await as('mallory').request('/api/channels/target/subscriptions', { method: 'POST', headers: { channelId: 'victim' } }, e);
		assert.equal(res.status, 403);
		const ghost = await as('mallory').request('/api/channels/target/subscriptions', { method: 'POST', headers: { channelId: 'no-such-channel' } }, e);
		assert.equal(ghost.status, 403);
		assert.equal(rows(e), 0);
		assert.equal(e.queue.messages.length, 0);
	});

	it('unsubscribing someone else\'s subscription changes nothing', async () => {
		const e = env(new MemoryBucket({ target: channel('target') }));
		await subscribeAs(e, 'alice');
		const res = await as('mallory').request('/api/channels/target/subscriptions', { method: 'DELETE', headers: { channelId: 'alice-ch' } }, e);
		assert.notEqual(res.status, 500);
		assert.equal(rows(e), 1);
		assert.equal(count(e), 1);
	});

	it('the export lists D1 subscriptions; erasure removes them and their counts exactly once', async () => {
		const e = env(new MemoryBucket({ a: channel('a'), b: channel('b') }));
		await Promise.all([subscribeAs(e, 'me', 'a'), subscribeAs(e, 'me', 'b'), subscribeAs(e, 'other', 'a')]);
		const exported = await exportUserSubscriptions(e.NOTIFICATIONS_DB as any, 'me');
		assert.deepEqual(exported.map((s) => s.subscribedToChannelId).sort(), ['a', 'b']);
		assert.ok(exported.every((s) => s.channelId === 'me-ch' && s.userId === 'me'));
		// The api-videos erasure and the processor's run the same derived statements: twice is harmless
		const [first, second] = await Promise.all([
			eraseUserSubscriptions(e.NOTIFICATIONS_DB as any, 'me'),
			eraseUserSubscriptions(e.NOTIFICATIONS_DB as any, 'me'),
		]);
		assert.equal(first + second, 2);
		assert.equal(await eraseUserSubscriptions(e.NOTIFICATIONS_DB as any, 'me'), 0);
		assert.equal(count(e, 'a'), 1, 'the other subscriber still counts');
		assert.equal(count(e, 'b'), 0);
		assert.deepEqual(await exportUserSubscriptions(e.NOTIFICATIONS_DB as any, 'me'), []);
	});
});

describe('channel JSON writers (AV-5)', () => {
	it('parallel first uploads keep exactly one Bunny collection', async () => {
		const channels = new SlowBucket({ ch: channel('ch') });
		const created: string[] = [];
		const deleted: string[] = [];
		const bunny = {
			createCollection: async () => {
				const guid = `col-${created.length}`;
				created.push(guid);
				return { guid };
			},
			deleteCollection: async (_lib: number, id: string) => {
				deleted.push(id);
			},
		};
		const results = await Promise.all(Array.from({ length: 20 }, () =>
			ensureChannelCollection(new R2Repository<any>(channels as any), bunny, 1, 'ch', 'Channel')));
		const kept = channels.read('ch').bunnyCollections?.['1'];
		assert.ok(kept);
		assert.ok(results.every((id) => id === kept), 'every upload uses the stored collection');
		assert.equal(deleted.length, 19, 'the other collections were removed');
		assert.ok(!deleted.includes(kept));
	});
});
