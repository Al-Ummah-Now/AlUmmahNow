import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanFill, parseScanCursor, scanCursorAfter } from '../src/lib/listFill';
import { VideosList } from '../src/endpoints/video/videoList';
import { ChannelVideosList } from '../src/endpoints/channel/channelVideosList';
import { ChannelShortsList } from '../src/endpoints/channel/channelShortsList';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * Public lists must fill their page (2026-11-11): stage returned
 * `GET /api/videos?limit=1` → `data: []` with a cursor every time, because the
 * list cut an R2 page of `limit` keys and filtered private, processing,
 * hidden, deleted and internal records afterwards. Channel tab fallbacks had
 * the same weakness (#694).
 */

const pad = (n: number) => String(n).padStart(4, '0');

/** `hidden` invisible items whose keys sort first, then `visible` listed ones. */
function items(hidden: number, visible: number) {
	const data: Record<string, { id: string; ok: boolean }> = {};
	for (let i = 0; i < hidden; i++) data[`a${pad(i)}`] = { id: `a${pad(i)}`, ok: false };
	for (let i = 0; i < visible; i++) data[`b${pad(i)}`] = { id: `b${pad(i)}`, ok: true };
	return data;
}

async function drain(bucket: MemoryBucket, limit: number, maxObjects?: number) {
	const pages: string[][] = [];
	let cursor: string | undefined;
	for (let guard = 0; guard < 1000; guard++) {
		const page = await scanFill<{ id: string; ok: boolean }>({
			bucket: bucket as never,
			cursor,
			limit,
			maxObjects,
			load: async (key) => bucket.read(key),
			isListed: (item): item is { id: string; ok: boolean } => !!item && item.ok,
			label: 'test',
		});
		pages.push(page.items.map((i) => i.id));
		if (!page.cursor) break;
		cursor = page.cursor;
	}
	return pages;
}

describe('scanFill', () => {
	for (const limit of [1, 24]) {
		for (const hidden of [0, 1, 23, 99, 100, 101, 250]) {
			it(`limit=${limit}, first ${hidden} invisible: full pages, no duplicates or gaps`, async () => {
				const visible = 60;
				const pages = await drain(new MemoryBucket(items(hidden, visible)), limit);
				const all = pages.flat();
				assert.deepEqual(all, Object.keys(items(0, visible)), 'every visible item once, in key order');
				for (const [i, page] of pages.entries()) {
					if (i < pages.length - 1) assert.equal(page.length, limit, `page ${i} is full`);
					else assert.ok(page.length > 0, 'no trailing empty page');
				}
			});
		}
	}

	it('returns no cursor when the page ends exactly at the last key', async () => {
		const bucket = new MemoryBucket(items(3, 1));
		const page = await scanFill({ bucket: bucket as never, limit: 1, load: async (k) => bucket.read(k), isListed: (i: any): i is any => !!i?.ok, label: 't' });
		assert.equal(page.items.length, 1);
		assert.equal(page.cursor, '');
	});

	it('stops at the read bound with a cursor and resumes from it', async () => {
		const bucket = new MemoryBucket(items(30, 2));
		const first = await scanFill({ bucket: bucket as never, limit: 1, maxObjects: 10, load: async (k) => bucket.read(k), isListed: (i: any): i is any => !!i?.ok, label: 't' });
		assert.deepEqual(first.items, []);
		assert.ok(first.cursor, 'bound hit: cursor to continue');
		assert.equal(first.budgetHit, true);
		assert.ok(first.scanned <= 10);
		const pages = await drain(bucket, 1, 10);
		assert.deepEqual(pages.flat(), ['b0000', 'b0001']);
	});

	it('accepts a legacy R2 cursor and ignores an index cursor', () => {
		assert.deepEqual(parseScanCursor('a0005'), { r2Cursor: 'a0005' });
		assert.deepEqual(parseScanCursor('idx:3'), {});
		assert.deepEqual(parseScanCursor(scanCursorAfter('livestream:x/é')), { startAfter: 'livestream:x/é' });
	});
});

type Page = { data: Array<{ id: string }>; cursor: string };

async function get(app: ReturnType<typeof buildApp>, url: string, env: unknown): Promise<Page> {
	const res = await app.request(url, {}, env as never);
	assert.equal(res.status, 200, url);
	return (await res.json()) as Page;
}

async function all(app: ReturnType<typeof buildApp>, base: string, env: unknown) {
	const pages: string[][] = [];
	let cursor = '';
	for (let guard = 0; guard < 200; guard++) {
		const sep = base.includes('?') ? '&' : '?';
		const page = await get(app, `${base}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''}`, env);
		pages.push(page.data.map((v) => v.id));
		if (!page.cursor) break;
		cursor = page.cursor;
	}
	return pages;
}

/** Newest-first keys: private, processing, hidden, deleted and an internal record before the public video. */
function homeBucket() {
	const data: Record<string, unknown> = {};
	const add = (id: string, o: Record<string, unknown>) => { data[id] = videoFixture({ id, ...o }); };
	for (let i = 0; i < 8; i++) add(`a-priv-${i}`, { isPublic: false });
	for (let i = 0; i < 8; i++) add(`b-proc-${i}`, { uploadStatus: 'processing' });
	add('c-hidden', { isHidden: true });
	add('d-deleted', { isDeleted: true });
	data['e-index:latest'] = { id: 'index:latest', videoIds: [] };
	add('f-public', { title: 'Public' });
	add('g-public', { title: 'Public 2' });
	return data;
}

describe('GET /api/videos fills the page (release regression)', () => {
	it('limit=1 returns exactly one public video when the first keys are not listed', async () => {
		const env = { videos: new MemoryBucket(homeBucket()), channels: new MemoryBucket() };
		const app = buildApp((r: any) => r.get('/api/videos', VideosList), null);
		const page = await get(app, '/api/videos?limit=1', env);
		assert.deepEqual(page.data.map((v) => v.id), ['f-public']);
		assert.ok(page.cursor, 'more to read');
		const rest = await all(app, '/api/videos?limit=1', env);
		assert.deepEqual(rest, [['f-public'], ['g-public']]);
	});

	it('limit=24 pages over 250 private videos without gaps', async () => {
		const data: Record<string, unknown> = {};
		for (let i = 0; i < 250; i++) data[`a${pad(i)}`] = videoFixture({ id: `a${pad(i)}`, isPublic: false });
		for (let i = 0; i < 30; i++) data[`b${pad(i)}`] = videoFixture({ id: `b${pad(i)}` });
		const env = { videos: new MemoryBucket(data), channels: new MemoryBucket() };
		const app = buildApp((r: any) => r.get('/api/videos', VideosList), null);
		const pages = await all(app, '/api/videos?limit=24', env);
		assert.equal(new Set(pages.flat()).size, 30);
		assert.equal(pages.flat().length, 30);
		assert.ok(pages.every((p) => p.length > 0), 'no empty page');
	});
});

describe('channel tab fallback scans fill the page (#694)', () => {
	const CH = 'ch-1';
	function bucket() {
		const data: Record<string, unknown> = {};
		for (let i = 0; i < 120; i++) data[`a${pad(i)}`] = videoFixture({ id: `a${pad(i)}`, channelId: 'other' });
		data['b-priv'] = videoFixture({ id: 'b-priv', channelId: CH, isPublic: false });
		for (let i = 0; i < 3; i++) data[`c${i}`] = videoFixture({ id: `c${i}`, channelId: CH, dateCreated: `2026-0${i + 1}-01T00:00:00.000Z` });
		data['d-short'] = videoFixture({ id: 'd-short', channelId: CH, format: 'short' });
		return data;
	}
	const env = () => ({ videos: new MemoryBucket(bucket()), channels: new MemoryBucket({ [CH]: { id: CH, userId: 'owner', name: 'Ch' } }) });

	it('channel videos: limit=1 pages reach every video, none empty with a cursor', async () => {
		const app = buildApp((r: any) => r.get('/api/channels/:id/videos', ChannelVideosList), null);
		const pages = await all(app, `/api/channels/${CH}/videos?limit=1`, env());
		// A final empty page without a cursor is the end of the list: the keys
		// after c2 (a short) are read only when the client asks for more
		assert.deepEqual(pages, [['c0'], ['c1'], ['c2'], []]);
	});

	it('channel shorts: the short beyond 120 other objects is found on the first page', async () => {
		const app = buildApp((r: any) => r.get('/api/channels/:id/shorts', ChannelShortsList), null);
		const pages = await all(app, `/api/channels/${CH}/shorts?limit=1`, env());
		assert.deepEqual(pages, [['d-short']]);
	});

	it('channel playlists and /api/playlists skip private playlists without empty pages', async () => {
		const playlists: Record<string, unknown> = {};
		const pl = (id: string, o: Record<string, unknown> = {}) => ({ id, name: id, channelId: CH, userId: 'owner', videoIds: [], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...o });
		for (let i = 0; i < 6; i++) playlists[`a${i}`] = pl(`a${i}`, { isPublic: false });
		playlists['b0'] = pl('b0');
		playlists['b1'] = pl('b1');
		const e = { ...env(), playlists: new MemoryBucket(playlists) };
		const app = buildApp((r: any) => {
			r.get('/api/channels/:id/playlists', ChannelPlaylistsList);
			r.get('/api/playlists', PlaylistsList);
		}, null);
		assert.deepEqual(await all(app, `/api/channels/${CH}/playlists?limit=1`, e), [['b0'], ['b1']]);
		assert.deepEqual(await all(app, '/api/playlists?limit=1', e), [['b0'], ['b1']]);
	});
});

describe('ownership index pages fill past stale rows', () => {
	it('limit=1 reads ahead and its cursor resumes after the last id used', async () => {
		const CH = 'ch-ix';
		const data: Record<string, unknown> = {};
		for (let i = 0; i < 8; i++) data[`v${i}`] = videoFixture({ id: `v${i}`, channelId: CH, dateCreated: `2026-01-0${i + 1}T00:00:00.000Z` });
		const env = { SEARCH_DB: new SqliteD1(), videos: new MemoryBucket(data), channels: new MemoryBucket({ [CH]: { id: CH, userId: 'owner', name: 'Ch' } }) };
		await runOwnershipPass(env as never, 'video', { maxPages: 10 });
		// The 6 newest became private after the index row was written (stale rows)
		for (let i = 2; i < 8; i++) await env.videos.put(`v${i}`, JSON.stringify(videoFixture({ id: `v${i}`, channelId: CH, isPublic: false })));
		const app = buildApp((r: any) => r.get('/api/channels/:id/videos', ChannelVideosList), null);
		const pages = await all(app, `/api/channels/${CH}/videos?limit=1`, env);
		assert.deepEqual(pages, [['v1'], ['v0']]);
	});
});
