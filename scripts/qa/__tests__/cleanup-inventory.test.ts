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
	mapUntil,
	parseState,
	pendingReads,
	prune,
	publicItems,
	shorten,
	stalled,
} from '../cleanup-inventory.ts';
import { RULES_FINGERPRINT } from '../e2e-leftovers.ts';

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
	buildInventory(w.state, w.listing, { schedule: new Map((keys.schedule ?? []).map((k) => [k, `e-${k}`])), tabs: new Map((keys.tabs ?? []).map((k) => [k, `e-${k}`])) }, { now: NOW, minAgeMs: 0 });
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
		assert.deepEqual(inventory(w).onChannel.get('c1'), { videos: ['v1'], playlists: ['p1'], posts: ['x'], sections: ['c1/s1'] });
		// The version each verdict is about
		for (const i of inventory(w).items.filter((x) => x.action === 'delete' && x.kind !== 'comment')) assert.equal(i.etag, `e-${i.key}`, i.kind);
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

	it('a channel waits until all that may be on one is read, and with it what is on it', () => {
		for (const [store, key] of [['videos', 'v2'], ['channels', 'c2'], ['playlists', 'p2'], ['posts', 'posts/c2/y.json'], ['sections', 'c2/s2']] as const) {
			const w = junkWorld();
			w.listing[store].set(key, 'new');
			forget(w.state, store, key);
			assert.equal(verdict(w, 'channel', 'c1'), 'wait', store);
			for (const [kind, id] of [['playlist', 'p1'], ['post', 'x'], ['section', 'c1/s1']]) assert.notEqual(verdict(w, kind, id), 'delete', `${store} ${kind}`);
			assert.equal(verdict(w, 'profile-ref', 'u1'), undefined);
		}
	});

	it('a channel with something that stays on it is left to a person', () => {
		const w = junkWorld();
		w.listing.posts.set('posts/c1/new.json', 'e');
		w.state.stores.posts['posts/c1/new.json'] = ['e', shorten('posts', { id: 'new', channelId: 'c1', content: 'x', createdAt: new Date(NOW).toISOString() })];
		const inv = buildInventory(w.state, w.listing, { schedule: new Map(), tabs: new Map() }, { now: NOW, minAgeMs: 3_600_000 });
		assert.equal(inv.items.find((i) => i.kind === 'channel' && i.id === 'c1')?.action, 'unsure');
		assert.equal(inv.items.find((i) => i.kind === 'post' && i.id === 'x')?.action, 'keep');
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
		w.state.stores.handles['channel-handles/gone'][1] = { channelId: 'c1', userId: 'u1' };
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
			{ store: 'videos', key: 'v1' },
			{ store: 'posts', key: 'posts/c1/y.json' },
			{ store: 'videos', key: 'v3' },
		]);
	});

	it('survives the file and starts afresh from anything else', () => {
		const { state } = junkWorld();
		const copy = () => JSON.parse(JSON.stringify(state));
		assert.deepEqual(parseState(JSON.stringify(state)), copy());
		const broken = (change: (s: ReturnType<typeof copy>) => void) => {
			const s = copy();
			change(s);
			return JSON.stringify(s);
		};
		for (const bad of [
			null, '', 'x', '{}', 'null', '[]',
			broken((s) => { s.version = '0'; }),
			broken((s) => { s.version = `1 ${RULES_FINGERPRINT}`; }),
			broken((s) => { s.stores = []; }),
			broken((s) => { s.stores.videos = []; }),
			broken((s) => { delete s.stores.posts; }),
			...['videos', 'channels', 'profiles', 'playlists', 'posts', 'sections', 'handles'].flatMap((store) =>
				[null, 'e', ['e'], [null, null], ['e', 'x'], ['e', []], ['e', { id: 1, channelId: 2, temp: 'x', kind: 3 }]].map((entry) => broken((s) => { s.stores[store].bad = entry; }))),
		]) {
			const parsed = parseState(bad);
			assert.deepEqual(parsed, emptyState(), String(bad).slice(0, 80));
			prune(parsed, junkWorld().listing);
		}
	});

	it('is read again under other rules', () => {
		assert.match(RULES_FINGERPRINT, /^[0-9a-f]{16}$/);
		assert.ok(emptyState().version.endsWith(RULES_FINGERPRINT));
	});

	it('holds no title, name, handle, text or address, and publishes less', () => {
		const SECRET = /secret/i;
		const raw = (id: string) => ({
			id, title: 'E2E Temp Secret title', name: 'E2E Secret name', handle: 'secret-handle', content: 'E2E Temp secret text', description: 'secret', email: `secret+${TEST}`, titleLocalized: { ar: 'secret' },
			userId: 'u9', channelId: 'c9', dateCreated: OLD, createdAt: OLD, comments: [{ id: 'm', text: 'ws probe 1', userId: 'u9', username: 'secret' }, { id: 'n', text: 'secret' }], channels: ['c9'],
		});
		const w = world({
			profiles: { u9: { ...raw('u9'), email: 'secret@example.com' }, u8: raw('u8') }, channels: { c9: raw('c9') }, videos: { v9: raw('v9') }, playlists: { p9: raw('p9') },
			posts: { 'posts/c9/x9.json': raw('x9') }, sections: { 'c9/s9': raw('s9') }, handles: { 'channel-handles/secret-handle': raw('h9') },
		});
		const { 'channel-handles/secret-handle': handle, ...otherHandles } = w.state.stores.handles;
		assert.deepEqual(otherHandles, {});
		assert.doesNotMatch(JSON.stringify(handle[1]), SECRET);
		assert.doesNotMatch(JSON.stringify({ ...w.state.stores, handles: {} }), SECRET);
		// A handle of a channel that is gone, and one nobody may be named for
		w.state.stores.handles['channel-handles/secret-handle'][1] = { channelId: 'gone', userId: 'u9' };
		const items = publicItems(inventory(w).items);
		assert.ok(items.some((i) => i.kind === 'handle'));
		assert.doesNotMatch(JSON.stringify(items), SECRET);
		assert.doesNotMatch(JSON.stringify(items), /@/);
		assert.ok(items.every((i) => (i.action as string) !== 'keep'));
	});

	it('keeps the probe comments of a video, by id', () => {
		const entry = shorten('videos', { id: 'v', comments: [{ id: 'a', text: 'ws probe 1', dateCreated: OLD }, { id: 'b', text: 'real', replies: [{ id: 'c', text: 'ws probe 2' }] }] });
		assert.deepEqual(entry?.junk, [{ id: 'a', created: OLD }, { id: 'c', created: undefined }]);
		assert.equal(shorten('videos', { title: 'no id' }), null);
		assert.equal(shorten('channels', null), null);
	});
});

describe('a bounded run', () => {
	it('starts nothing after the deadline and says what is left', async () => {
		let t = 0;
		const r = await mapUntil([1, 2, 3, 4, 5], 1, async () => ((t += 10), 'done' as const), { deadline: 25, now: () => t });
		assert.deepEqual(r, { done: 3, skipped: 0, failed: 0, left: 2 });
	});

	it('stops when the connection is gone, not on single failures', async () => {
		const single = await mapUntil([0, 1, 0, 1, 0, 1], 1, async (n) => (n === 1 ? 'done' : 'failed'), { deadline: Infinity, maxFailuresInRow: 2 });
		assert.deepEqual(single, { done: 3, skipped: 0, failed: 3, left: 0 });
		const gone = await mapUntil(Array(100).fill(0), 1, async () => 'failed', { deadline: Infinity, maxFailuresInRow: 5 });
		assert.deepEqual(gone, { done: 0, skipped: 0, failed: 5, left: 95 });
	});

	it('is red only when it got nowhere', () => {
		const run = { toRead: 0, read: 0, toDelete: 0, deleted: 0, skipped: 0 };
		assert.equal(stalled(run), null);
		assert.equal(stalled({ ...run, toRead: 1000, read: 1, toDelete: 10, deleted: 1 }), null);
		assert.equal(stalled({ ...run, toDelete: 3, skipped: 3 }), null);
		assert.match(stalled({ ...run, toRead: 5 })!, /none of 5 records/);
		assert.match(stalled({ ...run, toDelete: 3, skipped: 1 })!, /none of 3 leftovers/);
	});

	it('ends before the job is cancelled, with time for the setup', () => {
		const workflow = readFileSync(join(import.meta.dirname, '../../../.github/workflows/qa-cleanup.yml'), 'utf8');
		const limit = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1]);
		const order = Object.values(DEADLINES_MIN);
		assert.deepEqual(order, [...order].sort((a, b) => a - b));
		assert.ok(limit >= DEADLINES_MIN.reconcile + 15, `${limit} min`);
		// A scheduled run deletes nothing, and nothing but the inventory is uploaded
		assert.match(workflow, /MODE: \$\{\{ inputs\.mode \|\| 'dry-run' \}\}/);
		assert.deepEqual([...workflow.matchAll(/^ +path: (.+)$/gm)].map((m) => m[1]), ['${{ runner.temp }}/qa-cleanup.json']);
	});
});
