import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEADLINES_MIN,
	type Listing,
	STORES,
	type State,
	type Store,
	buildInventory,
	emptyState,
	keptEmail,
	mapUntil,
	parseState,
	pendingReads,
	prune,
	shorten,
	stalled,
} from '../cleanup-inventory.ts';

const OLD = '2026-01-01T00:00:00.000Z';
const NOW = Date.parse('2026-11-25T06:00:00Z');
const TEST = 'test-single-1794059336742@delivered.resend.dev';

/** A listing and a fully read state of these raw records (key → record). */
function world(records: Partial<Record<Store, Record<string, Record<string, unknown>>>>): { state: State; listing: Listing } {
	const state = emptyState();
	const listing = Object.fromEntries(STORES.map((s) => [s, new Map<string, string>()])) as Listing;
	for (const store of STORES) {
		for (const [key, raw] of Object.entries(records[store] ?? {})) {
			listing[store].set(key, `e-${key}`);
			(state.stores[store] as Record<string, unknown>)[key] = [`e-${key}`, shorten(store, raw)];
		}
	}
	return { state, listing };
}
const forget = (state: State, store: Store, key: string) => delete state.stores[store][key];
const inventory = (w: { state: State; listing: Listing }, keys: { schedule?: string[]; tabs?: string[] } = {}) =>
	buildInventory(w.state, w.listing, { schedule: keys.schedule ?? [], tabs: keys.tabs ?? [] }, { now: NOW, minAgeMs: 0 });
const verdict = (w: { state: State; listing: Listing }, kind: string, id: string, keys = {}) => inventory(w, keys).items.find((i) => i.kind === kind && i.id === id)?.action;

const junkWorld = () => world({
	profiles: { u1: { id: 'u1', email: TEST, channels: ['c1'] }, u2: { id: 'u2', email: 'someone@example.com' } },
	channels: { c1: { id: 'c1', name: 'E2E channel', userId: 'u1', email: TEST, dateCreated: OLD }, c2: { id: 'c2', name: 'Real', userId: 'u2', email: 'someone@example.com' } },
	videos: {
		v1: { id: 'v1', title: 'E2E Temp a', userId: 'u1', channelId: 'c1', dateCreated: OLD },
		v2: { id: 'v2', title: 'E2E Temp b', userId: 'u2', channelId: 'c2', dateCreated: OLD },
	},
	playlists: { p1: { id: 'p1', title: 'Mine', channelId: 'c1', userId: 'u1' } },
	posts: { 'posts/c1/x.json': { id: 'x', channelId: 'c1', content: 'Hello', createdAt: OLD } },
	sections: { 'c1/s1': { title: 'Mine' } },
	handles: { 'channel-handles/gone': { channelId: 'c9', userId: 'u1', handle: 'gone' } },
});

describe('a fully read QA', () => {
	it('decides as before: test leftovers go, other people’s content stays', () => {
		const w = junkWorld();
		assert.equal(verdict(w, 'video', 'v1'), 'delete');
		assert.equal(verdict(w, 'video', 'v2'), 'unsure');
		assert.equal(verdict(w, 'channel', 'c1'), 'delete');
		assert.equal(verdict(w, 'channel', 'c2'), 'keep');
		for (const [kind, id] of [['playlist', 'p1'], ['post', 'x'], ['section', 'c1/s1'], ['profile-ref', 'u1'], ['handle', 'channel-handles/gone']]) assert.equal(verdict(w, kind, id), 'delete', kind);
		assert.deepEqual(inventory(w).videosByChannel, new Map([['c1', ['v1']]]));
	});
});

describe('a partly read QA', () => {
	it('a video whose owner is not read yet waits, even with a test title', () => {
		const w = junkWorld();
		forget(w.state, 'profiles', 'u2');
		forget(w.state, 'channels', 'c2');
		assert.equal(verdict(w, 'video', 'v2'), 'wait');
		// The owner that was read is decided now: the backlog shrinks from the first run
		assert.equal(verdict(w, 'video', 'v1'), 'delete');
	});

	it('an owner without a profile is known once every channel was read', () => {
		const w = junkWorld();
		w.listing.profiles.delete('u1');
		forget(w.state, 'profiles', 'u1');
		assert.equal(verdict(w, 'video', 'v1'), 'delete');
		forget(w.state, 'channels', 'c2');
		assert.equal(verdict(w, 'video', 'v1'), 'wait');
	});

	it('a channel waits until every video is read, and with it its posts, sections and playlists', () => {
		const w = junkWorld();
		forget(w.state, 'videos', 'v2');
		assert.equal(verdict(w, 'channel', 'c1'), 'wait');
		for (const [kind, id] of [['playlist', 'p1'], ['post', 'x'], ['section', 'c1/s1']]) assert.equal(verdict(w, kind, id), 'keep', kind);
		assert.equal(verdict(w, 'profile-ref', 'u1'), undefined);
	});

	it('a schedule entry goes only when its video is not listed, read or not', () => {
		const w = junkWorld();
		forget(w.state, 'videos', 'v2');
		const keys = { schedule: ['2026-01-01/10/v2.json', '2026-01-01/10/nope.json'] };
		assert.equal(verdict(w, 'schedule-entry', keys.schedule[0], keys), 'keep');
		assert.equal(verdict(w, 'schedule-entry', keys.schedule[1], keys), 'delete');
	});

	it('a channel that is listed but not read is never taken for a deleted one', () => {
		const w = junkWorld();
		w.state.stores.handles['channel-handles/gone'][1] = { channelId: 'c1', userId: 'u1', handle: 'h' };
		forget(w.state, 'channels', 'c1');
		assert.equal(verdict(w, 'handle', 'channel-handles/gone'), undefined);
		assert.equal(verdict(w, 'tabs', 'channel-tabs/c1', { tabs: ['channel-tabs/c1'] }), undefined);
		assert.equal(verdict(w, 'profile-ref', 'u1'), undefined);
	});
});

describe('the state between runs', () => {
	it('reads only new and changed records, the stores taking turns', () => {
		const w = junkWorld();
		w.listing.videos.set('v1', 'changed').set('v3', 'new');
		w.listing.playlists.delete('p1');
		w.listing.posts.set('posts/c1/y.json', 'new');
		prune(w.state, w.listing);
		assert.deepEqual(Object.keys(w.state.stores.playlists), []);
		assert.deepEqual(pendingReads(w.state, w.listing), [
			{ store: 'videos', key: 'v1', etag: 'changed' },
			{ store: 'posts', key: 'posts/c1/y.json', etag: 'new' },
			{ store: 'videos', key: 'v3', etag: 'new' },
		]);
	});

	it('survives the file and starts afresh from anything else', () => {
		const { state } = junkWorld();
		assert.deepEqual(parseState(JSON.stringify(state)), JSON.parse(JSON.stringify(state)));
		for (const bad of [null, '', 'x', '{}', JSON.stringify({ ...state, version: '0' })]) assert.deepEqual(parseState(bad), emptyState());
	});

	it('keeps no address outside the test domains', () => {
		assert.equal(keptEmail('someone@example.com'), 'non-test');
		assert.equal(keptEmail('a@delivered.resend.dev.evil.com'), 'non-test');
		assert.equal(keptEmail(TEST), TEST);
		assert.equal(keptEmail(undefined), undefined);
		assert.doesNotMatch(JSON.stringify(junkWorld().state), /someone@example/);
	});

	it('keeps the probe comments and drops the rest of a video', () => {
		const entry = shorten('videos', { id: 'v', title: 't', description: 'long', comments: [{ id: 'a', text: 'ws probe 1', dateCreated: OLD }, { id: 'b', text: 'real', replies: [{ id: 'c', text: 'ws probe 2' }] }] });
		assert.deepEqual(entry?.junk?.map((c) => c.id), ['a', 'c']);
		assert.doesNotMatch(JSON.stringify(entry), /real|long/);
		assert.equal(shorten('videos', { title: 'no id' }), null);
		assert.equal(shorten('channels', null), null);
	});
});

describe('a bounded run', () => {
	it('starts nothing after the deadline and says what is left', async () => {
		let t = 0;
		const r = await mapUntil([1, 2, 3, 4, 5], 1, async () => ((t += 10), true), { deadline: 25, now: () => t });
		assert.deepEqual(r, { done: 3, failed: 0, left: 2 });
	});

	it('stops when the connection is gone, not on single failures', async () => {
		const single = await mapUntil([0, 1, 0, 1, 0, 1], 1, async (n) => n === 1, { deadline: Infinity, maxFailuresInRow: 2 });
		assert.deepEqual(single, { done: 3, failed: 3, left: 0 });
		const gone = await mapUntil(Array(100).fill(0), 1, async () => false, { deadline: Infinity, maxFailuresInRow: 5 });
		assert.deepEqual(gone, { done: 0, failed: 5, left: 95 });
	});

	it('is red only when it got nowhere', () => {
		assert.equal(stalled({ toRead: 1000, read: 1, toDelete: 10, deleted: 1 }), null);
		assert.equal(stalled({ toRead: 0, read: 0, toDelete: 0, deleted: 0 }), null);
		assert.match(stalled({ toRead: 5, read: 0, toDelete: 0, deleted: 0 })!, /none of 5 records/);
		assert.match(stalled({ toRead: 5, read: 5, toDelete: 3, deleted: 0 })!, /none of 3 leftovers/);
	});

	it('ends before the job is cancelled, with time for the setup', () => {
		const workflow = readFileSync(join(import.meta.dirname, '../../../.github/workflows/qa-cleanup.yml'), 'utf8');
		const limit = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1]);
		assert.ok(DEADLINES_MIN.list < DEADLINES_MIN.read && DEADLINES_MIN.read < DEADLINES_MIN.write && DEADLINES_MIN.write < DEADLINES_MIN.reconcile);
		assert.ok(limit >= DEADLINES_MIN.reconcile + 15, `${limit} min`);
	});
});
