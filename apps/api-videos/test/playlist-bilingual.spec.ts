/**
 * Bilingual playlist names and descriptions (titleLocalized /
 * descriptionLocalized, 'en' and 'ar'): the shared helpers, create, update,
 * list, fetch, the manage view, the search document and the admin list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localizedPlaylistText, normalizePlaylistLocalized, projectPlaylist, buildIndexText } from '@al-ummah/shared-types';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { PlaylistManageItems } from '../src/endpoints/playlist/playlistBulk';
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX } from '../src/lib/playlists';
import { listPlaylists } from '../src/lib/admin/service';

const OWNER = 'owner';

function playlist(id: string, overrides: Record<string, unknown> = {}) {
	return { id, userId: OWNER, channelId: 'ch', title: `Playlist ${id}`, videos: ['v1'], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides };
}

function setup(playlists: Record<string, unknown> = { pl: playlist('pl') }) {
	const bucket = new MemoryBucket();
	for (const [k, v] of Object.entries(playlists)) bucket.store.set(k, JSON.stringify(v));
	return {
		playlists: bucket,
		videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch' }) }),
		channels: new MemoryBucket({ ch: { id: 'ch', name: 'Channel', userId: OWNER, email: 'owner@test.local', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } }),
		queue: new MemoryQueue(),
	};
}

const ROUTES = (r: any) => {
	r.get('/api/playlists', PlaylistsList);
	r.post('/api/playlists', PlaylistCreate);
	r.get('/api/playlists/:id', PlaylistFetch);
	r.patch('/api/playlists/:id', PlaylistUpdate);
	r.get('/api/playlists/:id/items', PlaylistManageItems);
};

async function call(env: unknown, userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, env as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const create = (env: unknown, body: unknown) => call(env, OWNER, 'POST', '/api/playlists', body, { channelId: 'ch' });
const update = (env: unknown, body: unknown, id = 'pl') => call(env, OWNER, 'PATCH', `/api/playlists/${id}`, body, { channelId: 'ch' });
const stored = (env: ReturnType<typeof setup>, id: string) => env.playlists.read(id) as Record<string, unknown>;

describe('shared helpers', () => {
	it('localizedPlaylistText: the language\'s own value, else the original', () => {
		assert.equal(localizedPlaylistText('Lessons', { en: 'Lessons EN', ar: 'دروس' }, 'ar'), 'دروس');
		assert.equal(localizedPlaylistText('Lessons', { en: 'Lessons EN', ar: 'دروس' }, 'en'), 'Lessons EN');
		assert.equal(localizedPlaylistText('Lessons', { en: 'Lessons EN' }, 'ar'), 'Lessons');
		assert.equal(localizedPlaylistText('Lessons', { ar: '   ' }, 'ar'), 'Lessons');
		assert.equal(localizedPlaylistText('Lessons', undefined, 'ar'), 'Lessons');
		assert.equal(localizedPlaylistText(null, null, 'en'), '');
		assert.equal(localizedPlaylistText(undefined, { ar: 'دروس' }, 'en'), '');
	});

	it('normalizePlaylistLocalized keeps en/ar only, trims, cuts, drops empties', () => {
		assert.deepEqual(normalizePlaylistLocalized({ en: '  Hi  ', ar: ' مرحبا ', fr: 'Salut', ur: 'x' }, 10), { en: 'Hi', ar: 'مرحبا' });
		assert.deepEqual(normalizePlaylistLocalized({ en: 'abcdefghijkl' }, 5), { en: 'abcde' });
		assert.deepEqual(normalizePlaylistLocalized({ en: '', ar: '  ' }, 5), undefined);
		assert.deepEqual(normalizePlaylistLocalized({}, 5), undefined);
		assert.deepEqual(normalizePlaylistLocalized({ en: 3 as unknown as string, ar: 'ok' }, 5), { ar: 'ok' });
		assert.equal(normalizePlaylistLocalized(undefined, 5), undefined);
		assert.equal(normalizePlaylistLocalized(null, 5), undefined);
	});
});

describe('POST /api/playlists (bilingual)', () => {
	it('stores both languages and keeps the given title', async () => {
		const env = setup({});
		const res = await create(env, { title: 'Original', titleLocalized: { en: ' Lessons ', ar: ' دروس ', fr: 'Leçons' }, descriptionLocalized: { en: 'About', ar: 'نبذة' } });
		assert.equal(res.status, 200);
		const view = res.body.result.playlist;
		assert.equal(view.title, 'Original');
		assert.deepEqual(view.titleLocalized, { en: 'Lessons', ar: 'دروس' });
		assert.deepEqual(view.descriptionLocalized, { en: 'About', ar: 'نبذة' });
		assert.equal(view.description, 'About');
		const saved = stored(env, view.id);
		assert.deepEqual(saved.titleLocalized, { en: 'Lessons', ar: 'دروس' });
		assert.equal(saved.title, 'Original');
	});

	it('title defaults to the English name, else the Arabic one', async () => {
		const env = setup({});
		const en = await create(env, { titleLocalized: { en: 'Lessons', ar: 'دروس' } });
		assert.equal(en.status, 200);
		assert.equal(en.body.result.playlist.title, 'Lessons');
		const ar = await create(env, { titleLocalized: { ar: 'دروس' }, descriptionLocalized: { ar: 'نبذة' } });
		assert.equal(ar.status, 200);
		assert.equal(ar.body.result.playlist.title, 'دروس');
		assert.equal(ar.body.result.playlist.description, 'نبذة');
	});

	it('still 400 without any name; unknown keys and blanks do not count', async () => {
		const env = setup({});
		assert.equal((await create(env, {})).status, 400);
		assert.equal((await create(env, { title: '  ', titleLocalized: { en: ' ', fr: 'Leçons' } })).status, 400);
		assert.equal(env.playlists.store.size, 0);
	});

	it('an empty map is not stored; long values are cut to the limits', async () => {
		const env = setup({});
		const plain = await create(env, { title: 'Plain', titleLocalized: { en: '' }, descriptionLocalized: {} });
		assert.equal(plain.body.result.playlist.titleLocalized, undefined);
		const saved = stored(env, plain.body.result.playlist.id);
		assert.equal('titleLocalized' in saved, false);
		assert.equal('descriptionLocalized' in saved, false);

		const long = await create(env, { titleLocalized: { en: 'x'.repeat(PLAYLIST_TITLE_MAX + 20) }, descriptionLocalized: { ar: 'ع'.repeat(PLAYLIST_DESCRIPTION_MAX + 5) } });
		const view = long.body.result.playlist;
		assert.equal(view.titleLocalized.en.length, PLAYLIST_TITLE_MAX);
		assert.equal(view.title.length, PLAYLIST_TITLE_MAX);
		assert.equal(view.descriptionLocalized.ar.length, PLAYLIST_DESCRIPTION_MAX);
	});
});

describe('PATCH /api/playlists/:id (bilingual)', () => {
	it('a sent map replaces the stored one and sets title to en || ar', async () => {
		const env = setup({ pl: playlist('pl', { title: 'Old', titleLocalized: { en: 'Old', ar: 'قديم' } }) });
		const res = await update(env, { titleLocalized: { ar: 'جديد' } });
		assert.equal(res.status, 200);
		assert.deepEqual(stored(env, 'pl').titleLocalized, { ar: 'جديد' });
		assert.equal(stored(env, 'pl').title, 'جديد');
		assert.deepEqual(res.body.result.playlist.titleLocalized, { ar: 'جديد' });

		await update(env, { titleLocalized: { en: 'New', ar: 'جديد' } });
		assert.equal(stored(env, 'pl').title, 'New');
	});

	it('a sent title wins over the localized names', async () => {
		const env = setup();
		await update(env, { title: '  Chosen  ', titleLocalized: { en: 'English', ar: 'عربي' } });
		assert.equal(stored(env, 'pl').title, 'Chosen');
		assert.deepEqual(stored(env, 'pl').titleLocalized, { en: 'English', ar: 'عربي' });
	});

	it('{} clears the map and keeps the title; not sending it leaves it unchanged', async () => {
		const env = setup({ pl: playlist('pl', { title: 'Keep', titleLocalized: { en: 'Keep', ar: 'إبقاء' }, descriptionLocalized: { en: 'D', ar: 'و' } }) });
		await update(env, { isPublic: false });
		assert.deepEqual(stored(env, 'pl').titleLocalized, { en: 'Keep', ar: 'إبقاء' });
		assert.deepEqual(stored(env, 'pl').descriptionLocalized, { en: 'D', ar: 'و' });

		await update(env, { titleLocalized: {}, descriptionLocalized: { fr: 'x', en: '  ' } });
		const saved = stored(env, 'pl');
		assert.equal('titleLocalized' in saved, false);
		assert.equal('descriptionLocalized' in saved, false);
		assert.equal(saved.title, 'Keep');
	});

	it('description follows the same rule', async () => {
		const env = setup({ pl: playlist('pl', { description: 'Existing' }) });
		await update(env, { descriptionLocalized: { ar: 'نبذة' } });
		assert.equal(stored(env, 'pl').description, 'نبذة');
		await update(env, { description: 'Given', descriptionLocalized: { en: 'About', ar: 'نبذة' } });
		assert.equal(stored(env, 'pl').description, 'Given');
		await update(env, { descriptionLocalized: {} });
		assert.equal(stored(env, 'pl').description, 'Given');
	});
});

describe('reads carry both languages', () => {
	const seeded = () => setup({ pl: playlist('pl', { title: 'Lessons', titleLocalized: { en: 'Lessons', ar: 'دروس' }, descriptionLocalized: { ar: 'نبذة' } }), old: playlist('old', { title: 'Old one' }) });

	it('list, fetch (signed out too) and the manage view', async () => {
		const env = seeded();
		const list = await call(env, null, 'GET', '/api/playlists?channelId=ch');
		assert.equal(list.status, 200);
		const row = list.body.data.find((p: { id: string }) => p.id === 'pl');
		assert.deepEqual(row.titleLocalized, { en: 'Lessons', ar: 'دروس' });
		assert.deepEqual(row.descriptionLocalized, { ar: 'نبذة' });
		const old = list.body.data.find((p: { id: string }) => p.id === 'old');
		assert.equal(old.titleLocalized, undefined);
		// The fallback: a playlist without the language's value shows its title
		assert.equal(localizedPlaylistText(old.title, old.titleLocalized, 'ar'), 'Old one');

		const fetched = await call(env, null, 'GET', '/api/playlists/pl');
		assert.equal(fetched.status, 200);
		// The fetch answers the playlist itself
		assert.deepEqual(fetched.body.titleLocalized, { en: 'Lessons', ar: 'دروس' });
		assert.deepEqual(fetched.body.descriptionLocalized, { ar: 'نبذة' });

		const items = await call(env, OWNER, 'GET', '/api/playlists/pl/items');
		assert.equal(items.status, 200);
		assert.deepEqual(items.body.result.playlist.titleLocalized, { en: 'Lessons', ar: 'دروس' });
		assert.deepEqual(items.body.result.playlist.descriptionLocalized, { ar: 'نبذة' });
	});

	it('the search document indexes and carries both names', () => {
		const row = projectPlaylist(playlist('pl', { title: 'Lessons', titleLocalized: { en: 'Lessons', ar: 'دروس السيرة' }, description: 'About', descriptionLocalized: { ar: 'نبذة عن السيرة' } }))!;
		assert.ok(row);
		assert.deepEqual(row.payload.titleLocalized, { en: 'Lessons', ar: 'دروس السيرة' });
		assert.deepEqual(row.payload.descriptionLocalized, { ar: 'نبذة عن السيرة' });
		for (const token of buildIndexText('دروس السيرة').split(' ')) assert.ok(row.titleText.split(' ').includes(token), token);
		for (const token of buildIndexText('نبذة').split(' ')) assert.ok(row.bodyText.split(' ').includes(token), token);

		const plain = projectPlaylist(playlist('old', { title: 'Old one' }))!;
		assert.equal(plain.payload.titleLocalized, undefined);
		assert.equal(plain.payload.name, 'Old one');
	});

	it('the admin list matches either language and returns the names', async () => {
		const env = seeded();
		const byArabic = await listPlaylists(env as never, { q: 'دروس' });
		assert.deepEqual(byArabic.items.map((p) => p.id), ['pl']);
		assert.deepEqual(byArabic.items[0].titleLocalized, { en: 'Lessons', ar: 'دروس' });
		const byDescription = await listPlaylists(env as never, { q: 'نبذة' });
		assert.deepEqual(byDescription.items.map((p) => p.id), ['pl']);
		const all = await listPlaylists(env as never, {});
		assert.equal(all.items.find((p) => p.id === 'old')?.titleLocalized, undefined);
	});
});
