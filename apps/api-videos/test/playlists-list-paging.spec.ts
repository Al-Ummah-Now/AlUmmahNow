/**
 * "Save to playlist" and the other playlist pickers asked for 50 or 100 of a
 * channel's (or a user's personal) playlists and never saw the rest: the
 * channelId and mine lists ignored the cursor. They now page (the cursor is
 * the offset of the next page) and take `q` to find a playlist by name.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, buildApp } from './helpers';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';

const ME = 'viewer';
const CH = 'creator-ch';
const COUNT = 150;

const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();

function env() {
	const playlists: Record<string, unknown> = {};
	for (let i = 1; i <= COUNT; i++) {
		// Newest first: #1 is the newest
		const at = stamp(COUNT - i);
		playlists[`mine-${i}`] = { id: `mine-${i}`, title: `Mine ${i}`, name: `Mine ${i}`, userId: ME, channelId: '', isPublic: i % 2 === 0, videos: [], dateCreated: at, dateModified: at };
		playlists[`ch-${i}`] = { id: `ch-${i}`, title: `Series ${i}`, name: `Series ${i}`, ...(i === 150 ? { titleLocalized: { en: 'Series 150', ar: 'سلسلة الفقه' } } : {}), userId: 'creator', channelId: CH, isPublic: true, videos: [], dateCreated: at, dateModified: at };
	}
	return {
		playlists: new MemoryBucket(playlists),
		channels: new MemoryBucket({ [CH]: { id: CH, userId: 'creator', name: 'Creator', isMain: true, dateCreated: stamp(0), dateModified: stamp(0) } }),
	} as any;
}

async function list(e: any, user: string | null, query: string) {
	const res = await buildApp((r: any) => r.get('/api/playlists', PlaylistsList), user ? { userId: user } : null).request(`/api/playlists?${query}`, {}, e);
	return { status: res.status, body: await res.json() as any };
}

async function all(e: any, user: string, base: string) {
	const ids: string[] = [];
	let cursor = '';
	for (let guard = 0; guard < 20; guard++) {
		const { body } = await list(e, user, `${base}&limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
		ids.push(...body.data.map((p: any) => p.id));
		if (!body.cursor) break;
		cursor = body.cursor;
	}
	return ids;
}

describe('playlist lists page past the first page', () => {
	it('mine=true: follows the cursor to every personal playlist, newest first, no repeats', async () => {
		const e = env();
		const first = await list(e, ME, 'mine=true&limit=50');
		assert.equal(first.body.data.length, 50);
		assert.equal(first.body.data[0].id, 'mine-1');
		assert.ok(first.body.cursor, 'a cursor for the next page');
		const ids = await all(e, ME, 'mine=true');
		assert.equal(ids.length, COUNT);
		assert.equal(new Set(ids).size, COUNT);
		assert.equal(ids[149], 'mine-150');
	});

	it('channelId: follows the cursor to every playlist of the channel', async () => {
		const e = env();
		const ids = await all(e, 'creator', `channelId=${CH}`);
		assert.equal(ids.length, COUNT);
		assert.ok(ids.includes('ch-150'));
	});

	it('the last page has no cursor', async () => {
		const e = env();
		const { body } = await list(e, ME, 'mine=true&limit=50&cursor=100');
		assert.equal(body.data.length, 50);
		assert.equal(body.cursor, '');
	});
});

describe('playlist lists search with q', () => {
	it('mine=true&q finds playlist #150 by its name, case-insensitive', async () => {
		const e = env();
		const { body } = await list(e, ME, 'mine=true&limit=20&q=mine%20150');
		assert.deepEqual(body.data.map((p: any) => p.id), ['mine-150']);
	});

	it('channelId&q matches a translated title too', async () => {
		const e = env();
		const { body } = await list(e, 'creator', `channelId=${CH}&limit=20&q=${encodeURIComponent('الفقه')}`);
		assert.deepEqual(body.data.map((p: any) => p.id), ['ch-150']);
	});

	it('q results page with the cursor as well', async () => {
		const e = env();
		// "Series 1", "Series 10".."19", "Series 100".."150": 62 matches for "series 1"
		const ids = await all(e, 'creator', `channelId=${CH}&q=series%201`);
		assert.equal(ids.length, 62);
		assert.ok(ids.includes('ch-150'));
	});

	it('mine still needs a signed-in user', async () => {
		const e = env();
		const res = await list(e, null, 'mine=true&q=mine');
		assert.equal(res.status, 401);
	});
});
