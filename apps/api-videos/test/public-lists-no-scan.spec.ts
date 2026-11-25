/**
 * A public list reads the index whatever its state: with a row waiting for a repair (a big import always has
 * one), while the index is rebuilt, and never the bucket. Every record is checked when it is loaded, so a stale
 * row shows nothing. When D1 fails the list answers 503.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ownershipCompleteKey, ownershipDirtyKey } from '@al-ummah/shared-types';
import { VideosList } from '../src/endpoints/video/videoList';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { ChannelVideosList } from '../src/endpoints/channel/channelVideosList';
import { ChannelShortsList } from '../src/endpoints/channel/channelShortsList';
import { ChannelLiveList } from '../src/endpoints/channel/channelLiveList';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { ChannelAbout } from '../src/endpoints/channel/channelHandle';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { populateSection } from '../src/lib/channelSectionPopulator';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const CH = 'ch1';
const at = (day: number) => `2026-05-0${day}T00:00:00.000Z`;
const KINDS = ['video', 'playlist', 'stream', 'channel'] as const;

/** A bucket nobody may list. */
class NoList extends MemoryBucket {
	lists = 0;
	seeding = true;
	async list(...args: unknown[]) {
		if (!this.seeding) this.lists++;
		return (MemoryBucket.prototype as any).list.apply(this, args);
	}
}

async function setup() {
	const db = new SqliteD1();
	const v = (id: string, day: number, over: object = {}) => videoFixture({ id, title: `Talk ${id}`, channelId: CH, userId: 'owner', isPublic: true, uploadStatus: 'ready', duration: 900, width: 1920, height: 1080, dateCreated: at(day), ...over });
	const pl = (id: string, day: number, over: object = {}) => ({ id, title: id, channelId: CH, userId: 'owner', isPublic: true, videos: [], dateCreated: at(day), dateModified: at(day), ...over });
	const st = (id: string, day: number, over: object = {}) => ({ id, title: id, channelId: CH, userId: 'owner', status: 'live', isPrivate: false, dateCreated: at(day), ...over });
	const videos = new NoList({
		v1: v('v1', 1), v2: v('v2', 2), v3: v('v3', 3), gone: v('gone', 4), hidden: v('hidden', 5), made_private: v('made_private', 6), moved: v('moved', 7),
		s1: v('s1', 1, { format: 'short', duration: 30, width: 1080, height: 1920 }), l1: v('l1', 2, { isLive: true }),
		'livestream:st1': st('st1', 1), 'livestream:st2': st('st2', 2),
	});
	const playlists = new NoList({ p1: pl('p1', 1), p2: pl('p2', 2) });
	const channels = new NoList({ [CH]: { id: CH, userId: 'owner', name: 'Morning', handle: 'morning' }, ch2: { id: 'ch2', userId: 'other', name: 'Other', handle: 'other' } });
	const env: Record<string, any> = { SEARCH_DB: db, videos, playlists, channels, global_settings: new MemoryBucket(), profiles: new MemoryBucket(), ADMIN_JOBS_QUEUE: new MemoryQueue(), NOTIFICATIONS_DB: undefined };
	for (const kind of KINDS) await runOwnershipPass(env as never, kind, { maxPages: 10 });
	// The records changed and their rows did not: the rows that wait for a repair
	videos.store.delete('gone');
	const set = (id: string, over: object) => videos.store.set(id, JSON.stringify({ ...JSON.parse(videos.store.get(id)!), ...over }));
	set('hidden', { isHidden: true });
	set('made_private', { isPublic: false });
	set('moved', { channelId: 'ch2', isPublic: false });
	videos.store.set('livestream:st2', JSON.stringify(st('st2', 2, { isPrivate: true })));
	playlists.store.set('p2', JSON.stringify(pl('p2', 2, { isPublic: false })));
	for (const b of [videos, playlists, channels]) b.seeding = false;
	const mark = (key: string) => db.db.prepare("INSERT OR REPLACE INTO search_meta (key, value, updated_at) VALUES (?, '1', 1)").run(key);
	const app = buildApp((r) => {
		r.get('/api/videos', VideosList);
		r.get('/api/videos/search', VideoSearch);
		r.get('/api/channels/:id/videos', ChannelVideosList);
		r.get('/api/channels/:id/shorts', ChannelShortsList);
		r.get('/api/channels/:id/live', ChannelLiveList);
		r.get('/api/channels/:id/playlists', ChannelPlaylistsList);
		r.get('/api/channels/:id/about', ChannelAbout);
		r.get('/api/playlists', PlaylistsList);
		r.get('/api/live-streams', LiveStreamsList);
	}, null);
	const get = async (path: string) => {
		const res = await app.request(path, {}, env as never);
		return { status: res.status, retryAfter: res.headers.get('retry-after'), body: (await res.json()) as any };
	};
	return { db, env, get, mark, lists: () => [videos, playlists, channels].reduce((n, b) => n + b.lists, 0) };
}

const idsOf = (body: any): string[] => {
	const items = [body, body.result, body.data, body.result?.data].flatMap((x) => [x, x?.data, x?.items, x?.videos, x?.playlists, x?.streams]).find(Array.isArray) ?? [];
	return items.map((x: { id: string }) => x.id).sort();
};

const LISTS: Record<string, string[]> = {
	'/api/videos?limit=50': ['l1', 's1', 'v1', 'v2', 'v3'],
	[`/api/videos?limit=50&channelId=${CH}`]: ['l1', 's1', 'v1', 'v2', 'v3'],
	'/api/videos?limit=50&sort=title': ['l1', 's1', 'v1', 'v2', 'v3'],
	[`/api/videos/search?channelIds=${CH}&limit=50`]: ['l1', 's1', 'v1', 'v2', 'v3'],
	[`/api/channels/${CH}/videos?limit=50`]: ['v1', 'v2', 'v3'],
	[`/api/channels/${CH}/shorts?limit=50`]: ['s1'],
	[`/api/channels/${CH}/live?limit=50`]: ['l1'],
	[`/api/channels/${CH}/playlists?limit=50`]: ['p1'],
	'/api/playlists?limit=50': ['p1'],
	[`/api/playlists?channelId=${CH}&limit=50`]: ['p1'],
	'/api/live-streams?limit=50': ['st1'],
};

describe('public lists never read the bucket', () => {
	for (const [state, apply] of Object.entries({
		'a row waits for a repair': (t: Awaited<ReturnType<typeof setup>>) => KINDS.forEach((kind) => t.mark(ownershipDirtyKey(kind, 'x'))),
		'the index is rebuilt': (t: Awaited<ReturnType<typeof setup>>) => KINDS.forEach((kind) => t.db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey(kind))),
	})) {
		it(`${state}: the rows there are, each checked on its record`, async () => {
			const t = await setup();
			apply(t);
			for (const [path, ids] of Object.entries(LISTS)) {
				const r = await t.get(path);
				assert.equal(r.status, 200, `${path} ${JSON.stringify(r.body)}`);
				assert.deepEqual(idsOf(r.body), ids, path);
			}
			const about = await t.get(`/api/channels/${CH}/about`);
			assert.deepEqual([about.status, about.body.result.statsPartial], [200, true]);
			for (const type of ['recent_uploads', 'popular_uploads', 'created_playlists', 'live_streams']) {
				const s = await populateSection({ id: type, channelId: CH, type, title: type, position: 0, isVisible: true } as never, t.env);
				assert.notEqual(s.emptyHint, 'loadFailed', type);
				assert.equal(s.isEmpty, false, type);
			}
			assert.equal(t.lists(), 0, 'no bucket was listed');
			// The repair is queued
			for (let i = 0; i < 50 && !t.db.db.prepare("SELECT 1 FROM search_meta WHERE key = 'ownership:heal-queued:video'").get(); i++) await new Promise((done) => setTimeout(done, 5));
			for (const kind of ['video', 'playlist', 'stream']) assert.ok(t.db.db.prepare('SELECT 1 FROM search_meta WHERE key = ?').get(`ownership:heal-queued:${kind}`), kind);
		});
	}

	it('D1 fails: 503 with when to try again, not the bucket', async () => {
		const t = await setup();
		t.env.SEARCH_DB = { prepare: () => { throw new Error('D1_ERROR'); }, batch: async () => { throw new Error('D1_ERROR'); } };
		for (const path of [...Object.keys(LISTS), `/api/channels/${CH}/about`]) {
			const r = await t.get(path);
			assert.deepEqual([r.status, r.retryAfter], [503, '5'], `${path} ${JSON.stringify(r.body)}`);
			assert.doesNotMatch(JSON.stringify(r.body), /D1_ERROR/);
		}
		const s = await populateSection({ id: 'x', channelId: CH, type: 'recent_uploads', title: 'x', position: 0, isVisible: true } as never, t.env);
		assert.equal(s.emptyHint, 'loadFailed');
		assert.equal(t.lists(), 0);
	});

	it("a cursor of an older build's scan ends the list", async () => {
		const t = await setup();
		for (const path of Object.keys(LISTS).filter((p) => !p.includes('search') && !p.includes('sort=title'))) {
			for (const cursor of ['sa:djE', 'ks:nonsense']) {
				const r = await t.get(`${path}&cursor=${cursor}`);
				assert.deepEqual([r.status, idsOf(r.body)], [200, []], `${path} ${cursor}`);
			}
		}
		assert.equal(t.lists(), 0);
	});
});
