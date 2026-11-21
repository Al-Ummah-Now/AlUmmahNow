/**
 * Which views count toward Trending and Popular, the anonymous viewer key, and the
 * privacy rule for personal recommendations (wiki E07 "Discovery ranking").
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankExclusion, resetSaltCache, viewerKey, SALT_KEY_PREFIX } from '../src/lib/ranking/viewer';
import { personalOrder, rankPersonal } from '../src/lib/ranking/personal';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const request = (ip: string | null, ua = 'Firefox') =>
	new Request('https://videos.test/api/videos/v1/view', { method: 'POST', headers: { ...(ip ? { 'cf-connecting-ip': ip } : {}), 'user-agent': ua } });

describe('views that count', () => {
	it('the owner, staff, test accounts, bots and autoplay never count', () => {
		assert.equal(rankExclusion({ userId: 'u1', videoOwnerId: 'u1' }), 'owner');
		assert.equal(rankExclusion({ userId: 'u2', roles: ['super_admin'], videoOwnerId: 'u1' }), 'staff');
		assert.equal(rankExclusion({ userId: 'u3', email: 'e2e+1-1-a@e2e.alummahnow.net' }), 'test_account');
		assert.equal(rankExclusion({ userId: 'u4', email: 'test-x-1@delivered.resend.dev' }), 'test_account');
		assert.equal(rankExclusion({ device: 'bot' }), 'bot');
		assert.equal(rankExclusion({ userId: 'u5', autoplay: true }), 'autoplay');
		assert.equal(rankExclusion({ userId: 'u6', roles: ['user'], videoOwnerId: 'u1' }), null);
		assert.equal(rankExclusion({}), null);
	});
});

describe('viewer keys', () => {
	beforeEach(() => resetSaltCache());

	it('members by id; anonymous visitors by a salted hash that changes every day', async () => {
		const db = new SqliteD1();
		assert.equal(await viewerKey(db as never, request('1.2.3.4'), 'user-1', NOW), 'u:user-1');
		const a = await viewerKey(db as never, request('1.2.3.4'), null, NOW);
		const again = await viewerKey(db as never, request('1.2.3.4'), null, NOW + 60_000);
		const other = await viewerKey(db as never, request('5.6.7.8'), null, NOW);
		assert.match(a!, /^a:[0-9a-f]{16}$/);
		assert.equal(a, again);
		assert.notEqual(a, other);
		resetSaltCache();
		const tomorrow = await viewerKey(db as never, request('1.2.3.4'), null, NOW + DAY);
		assert.notEqual(a, tomorrow);
		// The address itself is never stored: only the day's salt
		const meta = db.db.prepare("SELECT key, value FROM search_meta WHERE key LIKE 'discovery:salt:%'").all() as Array<{ key: string; value: string }>;
		assert.equal(meta.length, 2);
		assert.ok(meta.every((m) => m.key.startsWith(SALT_KEY_PREFIX) && !m.value.includes('1.2.3.4')));
	});

	it('an anonymous request without an address is not counted', async () => {
		assert.equal(await viewerKey(new SqliteD1() as never, request(null), null, NOW), null);
	});
});

describe('personal recommendations', () => {
	it('a paused watch history means nothing personal', async () => {
		const profiles = new MemoryBucket({ u1: { id: 'u1', watchHistoryPaused: true } });
		const order = await personalOrder({ SEARCH_DB: new SqliteD1(), profiles: profiles as never, watch_history: new MemoryBucket() as never }, 'u1', ['v1', 'v2'], NOW);
		assert.equal(order, null);
	});

	it('no history and no subscriptions: the site list stays as it is', async () => {
		const profiles = new MemoryBucket({ u1: { id: 'u1' } });
		const order = await personalOrder({ SEARCH_DB: new SqliteD1(), profiles: profiles as never, watch_history: new MemoryBucket() as never }, 'u1', ['v1'], NOW);
		assert.equal(order, null);
	});

	it('subscribed channels rise, watched videos leave, channels are mixed', () => {
		const v = (id: string, channelId: string) => ({ id, channelId, title: id, tags: [], category: 'general', dateCreated: new Date(NOW).toISOString() }) as any;
		const candidates = [v('a1', 'A'), v('a2', 'A'), v('a3', 'A'), v('b1', 'B'), v('c1', 'C'), v('w1', 'C')];
		const order = rankPersonal({
			candidates,
			seeds: [],
			subscribed: new Set(['B']),
			sitePosition: new Map(['a1', 'a2', 'a3', 'c1', 'w1', 'b1'].map((id, i) => [id, i + 1])),
			watched: new Set(['w1']),
			now: NOW,
			limit: 10,
		}).map((o) => o.id);
		assert.equal(order[0], 'b1');
		assert.ok(!order.includes('w1'));
		// Not three A videos in a row at the top
		assert.notDeepEqual(order.slice(1, 4), ['a1', 'a2', 'a3']);
	});
});
