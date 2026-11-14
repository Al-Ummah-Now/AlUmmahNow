import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildFtsQuery,
	buildIndexText,
	detectTextLanguage,
	normalizeArabic,
	normalizeSearchText,
	projectChannel,
	projectPlaylist,
	projectPost,
	projectVideo,
	stripArabicArticle,
	syncSearchDocument,
	tokenizeSearchText,
} from '@al-ummah/shared-types';
import { SearchGet } from '../src/endpoints/search/searchGet';
import { ExploreGet } from '../src/endpoints/search/exploreGet';
import { SearchBackfillPost } from '../src/endpoints/search/searchBackfill';
import { SearchSuggestionsGet } from '../src/endpoints/discovery/discovery';
import { decodeCursor, initialSuggestionsFromIndex, searchIndex, suggestFromIndex } from '../src/lib/search/query';
import { searchIdForKey, withSearchSync } from '../src/lib/search/sync';
import { backfillSearchPage, reconcileSearchIndex } from '../src/lib/search/backfill';
import { activeSeasonalRails, SEASONAL_CONFIG_KEY } from '../src/lib/search/explore';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('Arabic normalisation', () => {
	it('strips tashkeel, tatweel and Quranic marks', () => {
		assert.equal(normalizeArabic('بِسْمِ اللَّهِ الرَّحْمَٰنِ'), 'بسم الله الرحمن');
		assert.equal(normalizeArabic('محمـــد'), 'محمد');
		assert.equal(normalizeArabic('الْحَمْدُ'), 'الحمد');
	});

	it('unifies alef forms, alef maqsura and taa marbuta', () => {
		assert.equal(normalizeArabic('أحمد إسلام آمن ٱلله'), 'احمد اسلام امن الله');
		assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
		assert.equal(normalizeArabic('الصلاة'), 'الصلاه');
	});

	it('normalises hamza carriers and drops standalone hamza', () => {
		assert.equal(normalizeArabic('مؤمن'), 'مومن');
		assert.equal(normalizeArabic('رئيس'), 'رييس');
		assert.equal(normalizeArabic('سماء'), 'سما');
	});

	it('folds Eastern Arabic and Persian digits to Western digits', () => {
		assert.equal(normalizeArabic('سورة ٢٥٥ و ۱۲'), 'سوره 255 و 12');
	});

	it('folds Arabic presentation forms and Farsi letters', () => {
		assert.equal(normalizeArabic('ﻻ'), 'لا');
		assert.equal(normalizeArabic('کتاب ی'), 'كتاب ي');
	});

	it('lower-cases, removes accents, punctuation and invisible characters', () => {
		assert.equal(normalizeSearchText('  Qur’an — TAFSÎR!  Café‏ '), 'qur an tafsir cafe');
		assert.equal(normalizeSearchText('ما هو الإسلام؟'), 'ما هو الاسلام');
		assert.equal(normalizeSearchText(null), '');
	});

	it('makes spelling variants identical', () => {
		const variants = ['الصَّلَاة', 'الصلاة', 'الصلاه', 'الصـلاة'];
		const normalised = new Set(variants.map(normalizeSearchText));
		assert.equal(normalised.size, 1);
		assert.equal(normalizeSearchText('إِسْلَام'), normalizeSearchText('اسلام'));
		assert.equal(normalizeSearchText('قرآن'), normalizeSearchText('قران'));
	});

	it('strips the definite article but keeps exceptions and short words', () => {
		assert.equal(stripArabicArticle('الحديث'), 'حديث');
		assert.equal(stripArabicArticle('والحديث'), 'حديث');
		assert.equal(stripArabicArticle('للصلاه'), 'صلاه');
		assert.equal(stripArabicArticle('الله'), 'الله');
		assert.equal(stripArabicArticle('الم'), 'الم');
		assert.equal(stripArabicArticle('hadith'), 'hadith');
	});

	it('indexes both article forms', () => {
		assert.deepEqual(buildIndexText('شرح الحديث').split(' '), ['شرح', 'الحديث', 'حديث']);
		assert.deepEqual(tokenizeSearchText('Seerah, part 2'), ['seerah', 'part', '2']);
	});

	it('builds safe FTS5 prefix queries', () => {
		assert.equal(buildFtsQuery('tafsir juz'), '"tafsir"* AND "juz"*');
		assert.equal(buildFtsQuery('tafsir juz', { mode: 'any' }), '"tafsir"* OR "juz"*');
		assert.equal(buildFtsQuery('الحديث'), '("الحديث"* OR "حديث"*)');
		assert.equal(buildFtsQuery('a" OR b NEAR(c)'), '"a"* AND "or"* AND "b"* AND "near"* AND "c"*');
		assert.equal(buildFtsQuery('fiqh', { column: 'title' }), 'title : ("fiqh"*)');
		assert.equal(buildFtsQuery('  ?! '), null);
	});

	it('detects the script of untagged text', () => {
		assert.equal(detectTextLanguage('درس في الفقه'), 'ar');
		assert.equal(detectTextLanguage('Lesson on fiqh'), 'en');
		assert.equal(detectTextLanguage('123'), undefined);
	});
});

describe('search document projection', () => {
	it('indexes only public, ready, published videos', () => {
		assert.ok(projectVideo(videoFixture()));
		assert.equal(projectVideo(videoFixture({ isPublic: false })), null);
		assert.equal(projectVideo(videoFixture({ isHidden: true })), null);
		assert.equal(projectVideo(videoFixture({ isDeleted: true })), null);
		assert.equal(projectVideo(videoFixture({ markedForDeletion: true })), null);
		assert.equal(projectVideo(videoFixture({ uploadStatus: 'processing' })), null);
		assert.equal(projectVideo(videoFixture({ scheduledPublishStatus: 'scheduled' })), null);
		assert.equal(projectVideo({ id: 'index:recent-videos', title: 'x' }), null);
	});

	it('carries the public MP4 key for the sitemap only for a ready pub/ rendition with an MP4 (#1200)', () => {
		const mp4 = { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 1000 };
		const r2 = (over: object = {}) => ({ status: 'ready', jobId: 'j', rev: 'e29db4ad6918a943', access: 'pub', attempts: 1, queuedAt: 'x', result: { mp4 }, ...over });
		const path = (video: object) => projectVideo(videoFixture(video))?.payload.mp4Path;
		const id = videoFixture().id;
		assert.equal(path({ r2: r2() }), `pub/${id}/e29db4ad6918a943/video.mp4`);
		assert.equal(path({ r2: r2({ access: 'priv' }) }), undefined);
		assert.equal(path({ r2: r2({ status: 'transcoding' }) }), undefined);
		assert.equal(path({ r2: r2({ result: {} }) }), undefined);
		assert.equal(path({ r2: r2({ rev: '../x' }) }), undefined);
		assert.equal(path({ r2: r2({ result: { mp4: { ...mp4, file: '../../x.mp4' } } }) }), undefined);
		assert.equal(path({}), undefined);
		// Unlisted and private videos have no search row at all
		assert.equal(projectVideo(videoFixture({ isPublic: false, r2: r2() })), null);
	});

	it('includes localized titles, tags and bilingual category labels in the text', () => {
		const row = projectVideo(videoFixture({
			title: 'Tafsir of Surah Al-Fatiha',
			titleLocalized: { ar: 'تفسير سورة الفاتحة' },
			tags: ['Quran'],
			category: 'quran_tafsir',
			duration: 600,
			views: 999,
		}))!;
		assert.match(row.titleText, /تفسير سوره الفاتحه/);
		assert.match(row.titleText, /tafsir/);
		assert.match(row.bodyText, /quran/);
		assert.match(row.bodyText, /تفسير القران/);
		assert.equal(row.language, 'en');
		assert.equal(row.duration, 600);
		assert.ok(row.popularity > 0);
	});

	it('a deleted channel keeps only its id in the index: no name, description or handle', async () => {
		const db = new SqliteD1();
		const channel = { id: 'ch-gone', name: 'Seerah by Someone', description: 'Created by someone@example.com', handle: 'someone', dateCreated: new Date().toISOString() };
		await syncSearchDocument(db as never, 'channel', 'ch-gone', channel, { version: 1 });
		await syncSearchDocument(db as never, 'channel', 'ch-gone', { ...channel, isHidden: true }, { version: 2 });
		const hidden = db.db.prepare("SELECT visible, payload FROM search_channels WHERE id = 'ch-gone'").get() as { visible: number; payload: string };
		assert.equal(hidden.visible, 0);
		assert.match(hidden.payload, /Seerah by Someone/, 'a hidden channel keeps its row as it was (restorable)');
		await syncSearchDocument(db as never, 'channel', 'ch-gone', null, { version: 3 });
		const row = db.db.prepare("SELECT * FROM search_channels WHERE id = 'ch-gone'").get() as Record<string, unknown>;
		assert.equal(row.visible, 0, 'the hidden row stays, so the channel\'s content stays excluded');
		assert.equal(row.payload, '{}');
		assert.ok(!JSON.stringify(row).includes('Someone') && !JSON.stringify(row).includes('someone'), JSON.stringify(row));
	});

	it('keeps non-public channels as hidden rows', () => {
		assert.equal(projectChannel({ id: 'c', name: 'C' })!.visible, true);
		assert.equal(projectChannel({ id: 'c', name: 'C', isPrivate: true })!.visible, false);
		assert.equal(projectChannel({ id: 'c', name: 'C', isHidden: true })!.visible, false);
	});

	it('indexes only public non-empty non-system playlists', () => {
		const base = { id: 'p', name: 'Seerah', isPublic: true, videos: ['v1'] };
		assert.ok(projectPlaylist(base));
		assert.equal(projectPlaylist({ ...base, isPublic: false }), null);
		assert.equal(projectPlaylist({ ...base, isPublic: undefined }), null);
		assert.equal(projectPlaylist({ ...base, videos: [] }), null);
		assert.equal(projectPlaylist({ ...base, isSystem: true }), null);
		assert.equal(projectPlaylist({ ...base, systemType: 'watch_later' }), null);
	});

	it('indexes only published public posts with text', () => {
		const base = { id: 'post1', channelId: 'c1', content: 'Jumuah reminder', status: 'published', visibility: 'public' };
		assert.ok(projectPost(base));
		assert.equal(projectPost({ ...base, status: 'scheduled' }), null);
		assert.equal(projectPost({ ...base, visibility: 'subscribers' }), null);
		assert.equal(projectPost({ ...base, isDeleted: true }), null);
		assert.equal(projectPost({ ...base, content: '' }), null);
		assert.ok(projectPost({ ...base, content: '', type: 'poll', poll: { question: 'Best time?', options: [{ text: 'Fajr' }] } }));
	});
});

function seededDb() {
	return new SqliteD1();
}

async function seed(db: SqliteD1) {
	const channels = [
		{ id: 'ch-ar', name: 'قناة الحديث', nameLocalized: { en: 'Hadith Channel' }, isVerified: true, subscribers: ['a', 'b', 'c'], dateCreated: new Date(NOW - 2 * DAY).toISOString() },
		{ id: 'ch-en', name: 'Seerah Studies', description: 'Life of the Prophet', dateCreated: new Date(NOW - 10 * DAY).toISOString() },
		{ id: 'ch-private', name: 'Private Tafsir', isPrivate: true, dateCreated: new Date(NOW - DAY).toISOString() },
	];
	const videos = [
		videoFixture({ id: 'v-salah', title: 'أحكام الصَّلاة', channelId: 'ch-ar', category: 'fiqh', duration: 120, views: 50, dateCreated: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }),
		videoFixture({ id: 'v-hadith', title: 'شرح الأحاديث النبوية', channelId: 'ch-ar', category: 'hadith_studies', duration: 1800, views: 500, language: 'ar', dateCreated: new Date(NOW - 3 * DAY).toISOString() }),
		videoFixture({ id: 'v-seerah', title: 'Seerah part 1: Makkah', channelId: 'ch-en', category: 'islamic_history', duration: 900, views: 10, dateCreated: new Date(NOW - 40 * DAY).toISOString() }),
		videoFixture({ id: 'v-seerah2', title: 'Seerah part 2: Madinah', channelId: 'ch-en', category: 'islamic_history', duration: 950, views: 5000, dateCreated: new Date(NOW - 20 * DAY).toISOString() }),
		videoFixture({ id: 'v-hidden-channel', title: 'Tafsir hidden', channelId: 'ch-private', duration: 60 }),
	];
	for (const c of channels) await syncSearchDocument(db, 'channel', c.id, c, { now: NOW });
	for (const v of videos) await syncSearchDocument(db, 'video', v.id, v, { now: NOW });
	await syncSearchDocument(db, 'playlist', 'pl-seerah', { id: 'pl-seerah', name: 'Complete Seerah', isPublic: true, videos: ['v-seerah', 'v-seerah2'], channelId: 'ch-en', dateCreated: new Date(NOW - DAY).toISOString() }, { now: NOW });
	await syncSearchDocument(db, 'post', 'post-1', { id: 'post-1', channelId: 'ch-en', content: 'New Seerah lesson tonight', status: 'published', visibility: 'public', likes: 3, createdAt: new Date(NOW - DAY).toISOString() }, { now: NOW });
}

const ids = (r: { results: Array<{ id: string }> }) => r.results.map(x => x.id);

describe('searchIndex (D1 FTS5)', () => {
	it('matches Arabic spelling variants in both directions', async () => {
		const db = seededDb();
		await seed(db);
		for (const q of ['الصلاة', 'الصلاه', 'صلاة', 'أحكام', 'احكام الصلاه']) {
			assert.deepEqual(ids(await searchIndex(db, { q, type: 'video' }, { now: NOW })), ['v-salah'], q);
		}
		assert.deepEqual(ids(await searchIndex(db, { q: 'احاديث', type: 'video' }, { now: NOW })), ['v-hadith']);
		assert.deepEqual(ids(await searchIndex(db, { q: 'الحديث', type: 'channel' }, { now: NOW })), ['ch-ar']);
		assert.deepEqual(ids(await searchIndex(db, { q: 'hadith channel', type: 'channel' }, { now: NOW })), ['ch-ar']);
	});

	it('matches word prefixes and ranks by relevance plus popularity', async () => {
		const db = seededDb();
		await seed(db);
		const result = await searchIndex(db, { q: 'seer', type: 'video' }, { now: NOW });
		assert.deepEqual(ids(result), ['v-seerah2', 'v-seerah']);
	});

	it('returns multiple result types and hides content of non-public channels', async () => {
		const db = seededDb();
		await seed(db);
		const all = await searchIndex(db, { q: 'seerah' }, { now: NOW });
		assert.deepEqual(new Set(all.results.map(r => r.type)), new Set(['video', 'channel', 'playlist', 'post']));
		assert.equal((await searchIndex(db, { q: 'tafsir' }, { now: NOW })).results.length, 0);
	});

	it('applies duration, date, language, category, verified and channel filters', async () => {
		const db = seededDb();
		await seed(db);
		assert.deepEqual(ids(await searchIndex(db, { type: 'video', duration: 'short' }, { now: NOW })), ['v-salah']);
		assert.deepEqual(ids(await searchIndex(db, { type: 'video', duration: 'long' }, { now: NOW })), ['v-hadith']);
		assert.deepEqual(ids(await searchIndex(db, { type: 'video', date: 'today' }, { now: NOW })), ['v-salah']);
		assert.deepEqual(ids(await searchIndex(db, { type: 'video', date: 'month', language: 'en' }, { now: NOW })), ['v-seerah2']);
		assert.deepEqual(ids(await searchIndex(db, { category: 'hadith_studies' }, { now: NOW })), ['v-hadith']);
		assert.deepEqual(new Set(ids(await searchIndex(db, { verified: true, type: 'video' }, { now: NOW }))), new Set(['v-salah', 'v-hadith']));
		assert.deepEqual(new Set(ids(await searchIndex(db, { q: 'seerah', channelId: 'ch-en' }, { now: NOW }))), new Set(['v-seerah', 'v-seerah2', 'pl-seerah', 'post-1']));
	});

	it('filters Shorts and videos by the shared rule (format=short|video)', async () => {
		const db = seededDb();
		await seed(db);
		await syncSearchDocument(db, 'video', 'v-short', videoFixture({ id: 'v-short', title: 'Dua reminder', channelId: 'ch-en', duration: 45, width: 1080, height: 1920 }), { now: NOW });
		await syncSearchDocument(db, 'video', 'v-square', videoFixture({ id: 'v-square', title: 'Square clip', channelId: 'ch-en', duration: 180, width: 1080, height: 1080 }), { now: NOW });
		await syncSearchDocument(db, 'video', 'v-forced', videoFixture({ id: 'v-forced', title: 'Long but a Short', channelId: 'ch-en', duration: 900, format: 'short' }), { now: NOW });
		assert.deepEqual(new Set(ids(await searchIndex(db, { format: 'short' }, { now: NOW }))), new Set(['v-short', 'v-square', 'v-forced']));
		const videos = new Set(ids(await searchIndex(db, { format: 'video' }, { now: NOW })));
		assert.ok(videos.has('v-salah'), 'a 2-minute video with unknown shape is a video');
		assert.ok(!videos.has('v-short') && !videos.has('v-forced'));
		assert.ok(![...videos].some(id => !id.startsWith('v-')), 'the format filter returns videos only');
		// The flag also rides in the payload for the web
		const hit = (await searchIndex(db, { format: 'short', q: 'dua' }, { now: NOW })).results[0] as any;
		assert.equal(hit.video.isShort, true);
	});

	it('sorts by date or popularity and pages with a cursor', async () => {
		const db = seededDb();
		await seed(db);
		assert.deepEqual(ids(await searchIndex(db, { type: 'channel', sort: 'date' }, { now: NOW })), ['ch-ar', 'ch-en']);
		const first = await searchIndex(db, { type: 'video', sort: 'popular', limit: 2 }, { now: NOW });
		assert.deepEqual(ids(first), ['v-seerah2', 'v-hadith']);
		assert.equal(first.hasMore, true);
		const second = await searchIndex(db, { type: 'video', sort: 'popular', limit: 2, cursor: first.nextCursor! }, { now: NOW });
		assert.deepEqual(ids(second), ['v-salah', 'v-seerah']);
		assert.equal(second.hasMore, false);
		assert.equal(decodeCursor('o999999'), 0);
		assert.equal(decodeCursor('garbage'), 0);
	});

	it('relaxes to any word when no result has every word', async () => {
		const db = seededDb();
		await seed(db);
		const result = await searchIndex(db, { q: 'seerah zzzzz', type: 'video' }, { now: NOW });
		assert.equal(result.relaxed, true);
		assert.equal(result.results.length, 2);
	});

	it('suggests channels, videos and categories', async () => {
		const db = seededDb();
		await seed(db);
		const suggestions = await suggestFromIndex(db, 'seer', 5);
		assert.equal(suggestions[0].type, 'channel');
		assert.ok(suggestions.some(s => s.type === 'video' && s.text.startsWith('Seerah part')));
		const fiqh = await suggestFromIndex(db, 'فق', 5);
		assert.ok(fiqh.some(s => s.type === 'category' && s.metadata?.category === 'fiqh'));
	});

	it('suggests requested types with ids, thumbnails and subtitles, grouped and capped', async () => {
		const db = seededDb();
		await seed(db);
		const all = await suggestFromIndex(db, 'seer', 8, { types: ['video', 'channel', 'playlist'], now: NOW });
		assert.deepEqual([...new Set(all.map(s => s.type))], ['channel', 'video', 'playlist']);
		const playlist = all.find(s => s.type === 'playlist')!;
		assert.equal(playlist.id, 'pl-seerah');
		assert.equal(playlist.subtitle, 'Seerah Studies');
		const video = all.find(s => s.type === 'video')!;
		assert.equal(video.subtitle, 'Seerah Studies');
		assert.ok(video.id?.startsWith('v-seerah'));
		const only = await suggestFromIndex(db, 'seer', 8, { types: ['playlist'], now: NOW });
		assert.deepEqual(only.map(s => s.id), ['pl-seerah']);
		const capped = await suggestFromIndex(db, 'seer', 2, { types: ['video', 'channel', 'playlist'], now: NOW });
		assert.equal(capped.length, 2);
		assert.ok(capped.some(s => s.type === 'video'), 'videos keep at least one slot');
	});

	it('limits suggestions to one channel and never suggests hidden content', async () => {
		const db = seededDb();
		await seed(db);
		const inChannel = await suggestFromIndex(db, 'seer', 8, { types: ['video', 'channel', 'playlist', 'category'], channelId: 'ch-ar', now: NOW });
		assert.deepEqual(inChannel, []);
		const own = await suggestFromIndex(db, 'seer', 8, { types: ['video', 'playlist'], channelId: 'ch-en', now: NOW });
		assert.ok(own.length >= 2 && own.every(s => s.type === 'video' || s.type === 'playlist'));
		assert.deepEqual(await suggestFromIndex(db, 'tafsir', 8, { types: ['video', 'channel', 'playlist'], now: NOW }), []);
	});

	it('initial suggestions (empty query): a channel\'s newest videos and playlists, most viewed channels, paged', async () => {
		const db = seededDb();
		await seed(db);
		// The channel's newest first; hidden channels' content never shows
		const videos = await initialSuggestionsFromIndex(db, 5, { types: ['video'], channelId: 'ch-en', now: NOW });
		assert.deepEqual(videos.map(s => s.id), ['v-seerah2', 'v-seerah']);
		const page2 = await initialSuggestionsFromIndex(db, 1, { types: ['video'], channelId: 'ch-en', offset: 1, now: NOW });
		assert.deepEqual(page2.map(s => s.id), ['v-seerah']);
		const playlists = await initialSuggestionsFromIndex(db, 5, { types: ['playlist'], channelId: 'ch-en', now: NOW });
		assert.deepEqual(playlists.map(s => s.id), ['pl-seerah']);
		assert.equal(playlists[0].subtitle, 'Seerah Studies');
		// Channels: visible ones only, with handle/subtitle like typed suggestions
		const channels = await initialSuggestionsFromIndex(db, 10, { types: ['channel'], now: NOW });
		assert.ok(channels.length >= 2 && channels.every(s => s.type === 'channel' && s.id !== 'ch-private'));
		// Newest public videos without a channel, never a hidden channel's
		const recent = await initialSuggestionsFromIndex(db, 10, { types: ['video'], now: NOW });
		assert.equal(recent[0].id, 'v-salah');
		assert.ok(!recent.some(s => s.id === 'v-hidden-channel'));
	});

	it('GET /api/search/suggestions with an empty q returns the first page (offset pages)', async () => {
		const db = seededDb();
		await seed(db);
		const routes = buildApp(r => r.get('/api/search/suggestions', SearchSuggestionsGet));
		const env = { SEARCH_DB: db, videos: new MemoryBucket(), channels: new MemoryBucket() } as any;
		const first = await (await routes.request('/api/search/suggestions?q=&types=video&channelId=ch-en&limit=1', {}, env)).json() as any[];
		assert.deepEqual(first.map(s => s.id), ['v-seerah2']);
		const next = await (await routes.request('/api/search/suggestions?types=video&channelId=ch-en&limit=1&offset=1', {}, env)).json() as any[];
		assert.deepEqual(next.map(s => s.id), ['v-seerah']);
		// No index: nothing rather than a scan
		const none = await (await routes.request('/api/search/suggestions?q=&types=video', {}, { ...env, SEARCH_DB: undefined })).json() as any[];
		assert.deepEqual(none, []);
	});

	it('suggests a channel by its localized name and @handle', async () => {
		const db = seededDb();
		await seed(db);
		await syncSearchDocument(db, 'channel', 'ch-handle', { id: 'ch-handle', name: 'Fiqh Daily', handle: 'fiqhdaily', dateCreated: new Date(NOW).toISOString() }, { now: NOW });
		const [byHandle] = await suggestFromIndex(db, 'fiqhd', 5, { types: ['channel'], now: NOW });
		assert.equal(byHandle.id, 'ch-handle');
		assert.equal(byHandle.handle, 'fiqhdaily');
		assert.equal(byHandle.subtitle, '@fiqhdaily');
		const [localized] = await suggestFromIndex(db, 'hadith ch', 5, { types: ['channel'], now: NOW });
		assert.equal(localized.text, 'Hadith Channel', 'the localized name that matched is shown');
		assert.equal(localized.verified, true);
	});
});

describe('search index sync on R2 writes', () => {
	function syncEnv() {
		const db = new SqliteD1();
		const pending: Promise<unknown>[] = [];
		const raw = { SEARCH_DB: db, videos: new MemoryBucket(), channels: new MemoryBucket(), playlists: new MemoryBucket(), community_posts: new MemoryBucket() };
		const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
		return { db, raw, env, flush: () => Promise.all(pending) };
	}

	it('maps keys to entity ids and ignores internal records', () => {
		assert.equal(searchIdForKey('video', 'abc'), 'abc');
		assert.equal(searchIdForKey('video', 'index:recent-videos'), null);
		assert.equal(searchIdForKey('post', 'posts/ch1/p1.json'), 'p1');
		assert.equal(searchIdForKey('post', 'posts/ch1/index.json'), null);
		assert.equal(searchIdForKey('post', 'likes/p1/u1.json'), null);
		assert.equal(searchIdForKey('channel', 'subscriptions/x'), null);
	});

	it('indexes on create, updates on edit and removes on visibility change and delete', async () => {
		const { db, env, flush } = syncEnv();
		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Fiqh of fasting' })));
		await flush();
		assert.deepEqual(ids(await searchIndex(db, { q: 'fasting' })), ['v1']);

		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Fiqh of zakat' })));
		await flush();
		assert.equal((await searchIndex(db, { q: 'fasting' })).results.length, 0);
		assert.deepEqual(ids(await searchIndex(db, { q: 'zakat' })), ['v1']);

		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Fiqh of zakat', isPublic: false })));
		await flush();
		assert.equal(db.count('search_videos'), 0);

		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Fiqh of zakat' })));
		await flush();
		assert.equal(db.count('search_videos_fts'), 1);
		await env.videos.delete('v1');
		await flush();
		assert.equal(db.count('search_videos'), 0);
		assert.equal(db.count('search_videos_fts'), 0);
	});

	it('removes moderated content and hides a channel’s content when the channel is hidden', async () => {
		const { db, env, flush } = syncEnv();
		await env.channels.put('c1', JSON.stringify({ id: 'c1', name: 'Nasheeds' }));
		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Tala al badru', channelId: 'c1' })));
		await flush();
		assert.equal((await searchIndex(db, { q: 'tala' })).results.length, 1);
		await env.channels.put('c1', JSON.stringify({ id: 'c1', name: 'Nasheeds', isHidden: true }));
		await flush();
		assert.equal((await searchIndex(db, { q: 'tala' })).results.length, 0);
		assert.equal((await searchIndex(db, { q: 'nasheeds' })).results.length, 0);
	});

	it('indexes community posts and ignores likes/comments records', async () => {
		const { db, env, flush } = syncEnv();
		await env.community_posts.put('posts/c1/p1.json', JSON.stringify({ id: 'p1', channelId: 'c1', content: 'Ramadan timetable', status: 'published', visibility: 'public' }));
		await env.community_posts.put('likes/p1/u1.json', JSON.stringify({ id: 'like' }));
		await flush();
		assert.deepEqual(ids(await searchIndex(db, { q: 'ramadan' })), ['p1']);
		assert.equal(db.count('search_posts'), 1);
	});

	it('skips writes when indexed content did not change', async () => {
		const { db, env, flush } = syncEnv();
		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Aqeedah 101' })));
		await flush();
		const before = db.queries;
		await env.videos.put('v1', JSON.stringify(videoFixture({ title: 'Aqeedah 101', dateModified: '2026-02-02T00:00:00.000Z' })));
		await flush();
		// The ownership upsert, the search lookup, recording the newer version (PR-8), the
		// admin comment signature read and the privacy footprint signature read (comments and
		// reactions unchanged): no index rewrite
		assert.equal(db.queries - before, 5, 'no search row, full-text, comment or footprint rewrite');
	});

	it('returns env untouched without SEARCH_DB', () => {
		const raw = { videos: new MemoryBucket() };
		assert.equal(withSearchSync(raw, { waitUntil: () => undefined }), raw);
	});
});

describe('backfill and reconciliation', () => {
	it('backfills page by page and prunes rows for deleted objects', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket({
			a: videoFixture({ id: 'a', title: 'Alpha' }),
			b: videoFixture({ id: 'b', title: 'Beta' }),
			c: videoFixture({ id: 'c', title: 'Gamma', isPublic: false }),
			'index:recent-videos': { id: 'index:recent-videos', items: [] },
		});
		const env = { SEARCH_DB: db, videos };
		const first = await backfillSearchPage(env, 'video', { limit: 2 });
		assert.equal(first.done, false);
		const second = await backfillSearchPage(env, 'video', { limit: 2, cursor: first.nextCursor });
		assert.equal(second.done, true);
		assert.equal(first.indexed + second.indexed, 2);
		assert.equal(db.count('search_videos'), 2);

		await syncSearchDocument(db, 'video', 'gone', videoFixture({ id: 'gone', title: 'Stale' }), { now: NOW - 10 * DAY });
		const summary = await reconcileSearchIndex(env, { pagesPerEntity: 5, now: NOW });
		assert.equal(summary.video.pruned, true);
		assert.equal((await searchIndex(db, { q: 'stale' })).results.length, 0);
		assert.equal(db.count('search_videos'), 2);
	});
});

describe('search endpoints', () => {
	async function app() {
		const db = new SqliteD1();
		await seed(db);
		const settings = new MemoryBucket({
			[SEASONAL_CONFIG_KEY]: [
				{ id: 'ramadan', title: { en: 'Ramadan', ar: 'رمضان' }, startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString(), category: 'fiqh' },
				{ id: 'past', title: { en: 'Past', ar: 'سابق' }, startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z', category: 'fiqh' },
			],
		});
		const routes = buildApp(r => {
			r.get('/api/search', SearchGet);
			r.get('/api/explore', ExploreGet);
			r.get('/api/search/suggestions', SearchSuggestionsGet);
			r.post('/internal/search/backfill', SearchBackfillPost);
		});
		return { routes, env: { SEARCH_DB: db, global_settings: settings, videos: new MemoryBucket(), channels: new MemoryBucket() } };
	}

	it('GET /api/search returns ranked multi-type results', async () => {
		const { routes, env } = await app();
		const res = await routes.request('/api/search?q=seerah&limit=10', {}, env);
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		assert.equal(body.success, true);
		assert.equal(body.type, 'all');
		assert.ok(body.results.some((r: any) => r.type === 'playlist' && r.playlist.name === 'Complete Seerah'));
		const video = body.results.find((r: any) => r.type === 'video');
		assert.equal(video.channel.name, 'Seerah Studies');
	});

	it('GET /api/search validates input', async () => {
		const { routes, env } = await app();
		assert.equal((await routes.request('/api/search', {}, env)).status, 400);
		assert.equal((await routes.request('/api/search?type=bogus&q=x', {}, env)).status, 400);
		assert.equal((await routes.request('/api/search?q=x', {}, { ...env, SEARCH_DB: undefined })).status, 503);
		const verified = await (await routes.request('/api/search?verified=true&type=video', {}, env)).json() as any;
		assert.equal(verified.results.length, 2);
	});

	it('GET /api/explore returns categories, new channels and only active seasonal rails', async () => {
		const { routes, env } = await app();
		const body = await (await routes.request('/api/explore', {}, env)).json() as any;
		assert.equal(body.categories.find((c: any) => c.value === 'islamic_history').count, 2);
		// Never an empty tile (owner decision): every category listed has a video
		assert.ok(body.categories.length > 0);
		assert.ok(body.categories.every((c: any) => c.count > 0), JSON.stringify(body.categories));
		assert.deepEqual(body.newChannels.map((c: any) => c.id), ['ch-ar', 'ch-en']);
		assert.deepEqual(body.seasonal.map((s: any) => s.id), ['ramadan']);
		assert.deepEqual(body.seasonal[0].videos.map((v: any) => v.id), ['v-salah']);
	});

	it('GET /api/search/suggestions uses the index', async () => {
		const { routes, env } = await app();
		const body = await (await routes.request('/api/search/suggestions?q=%D8%A7%D9%84%D8%B5%D9%84%D8%A7%D9%87', {}, env)).json() as any;
		assert.equal(body[0].text, 'أحكام الصَّلاة');
	});

	it('GET /api/search/suggestions filters by types and channel, fills old rows\' handles, and rate limits', async () => {
		const { routes, env } = await app();
		const playlists = await (await routes.request('/api/search/suggestions?q=seer&types=playlist,bogus', {}, env)).json() as any;
		assert.deepEqual(playlists.map((s: any) => s.type), ['playlist']);
		const scoped = await (await routes.request('/api/search/suggestions?q=seer&types=video&channelId=ch-ar', {}, env)).json() as any;
		assert.deepEqual(scoped, []);

		const channels = new MemoryBucket({ 'ch-en': { id: 'ch-en', name: 'Seerah Studies', handle: 'seerah' } });
		const withHandle = await (await routes.request('/api/search/suggestions?q=seer&types=channel', {}, { ...env, channels })).json() as any;
		assert.equal(withHandle[0].handle, 'seerah');
		assert.equal(withHandle[0].subtitle, '@seerah');

		let calls = 0;
		const SUGGEST_LIMITER = { limit: async () => ({ success: ++calls <= 1 }) };
		assert.equal((await routes.request('/api/search/suggestions?q=seer', {}, { ...env, SUGGEST_LIMITER })).status, 200);
		const limited = await routes.request('/api/search/suggestions?q=seer', {}, { ...env, SUGGEST_LIMITER });
		assert.equal(limited.status, 429);
		assert.equal(limited.headers.get('Retry-After'), '60');
	});

	it('activeSeasonalRails ignores invalid, disabled and out-of-window rails', () => {
		const rails = activeSeasonalRails({ rails: [
			{ id: 'a', title: { en: 'A', ar: 'أ' }, startsAt: '2026-11-01', endsAt: '2026-12-01', query: 'x' },
			{ id: 'b', title: { en: 'B', ar: 'ب' }, startsAt: '2026-11-01', endsAt: '2026-12-01', query: 'x', enabled: false },
			{ id: 'c', title: { en: 'C' }, startsAt: '2026-11-01', endsAt: '2026-12-01', query: 'x' },
			{ id: 'd', title: { en: 'D', ar: 'د' }, startsAt: '2026-11-01', endsAt: '2026-12-01' },
		] }, NOW);
		assert.deepEqual(rails.map(r => r.id), ['a']);
	});
});
