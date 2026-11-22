import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListWatchHistory } from '../src/endpoints/watch-history/list';
import { matchesSearch, normaliseSearchText, searchWords } from '../src/lib/watch-history-search';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/** "Search watch history" on the history page: GET /api/watch-history?q= */
function entry(videoId: string, title: string, at: string, channelName = 'Seerah Stories') {
	return {
		id: `me:${videoId}`, userId: 'me', videoId, videoTitle: title, videoDuration: 600, channelId: '', channelName,
		firstWatchedAt: at, lastWatchedAt: at, watchCount: 1, progress: 60, completed: false, percentageWatched: 10,
	};
}

function env() {
	return {
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', title: 'The migration to Madinah', titleLocalized: { en: 'The migration to Madinah', ar: 'الهجرة إلى المدينة' } }),
			v2: videoFixture({ id: 'v2', title: 'Wudu for beginners' }),
			v3: videoFixture({ id: 'v3', title: 'Day of Arafah, step by step', titleLocalized: { ar: 'يوم عرفة خطوة بخطوة' } }),
		}),
		watch_history: new MemoryBucket({
			'me:v1': entry('v1', 'The migration to Madinah', '2026-11-22T10:00:00.000Z'),
			'me:v2': entry('v2', 'Wudu for beginners', '2026-11-21T10:00:00.000Z', 'Fiqh Made Simple'),
			'me:v3': entry('v3', 'Day of Arafah, step by step', '2026-11-20T10:00:00.000Z', 'Hajj Guide'),
			'other:v2': { ...entry('v2', 'Wudu for beginners', '2026-11-22T10:00:00.000Z'), id: 'other:v2', userId: 'other' },
		}),
		channels: new MemoryBucket(),
		profiles: new MemoryBucket(),
	};
}

const app = () => buildApp((r: any) => r.get('/api/watch-history', ListWatchHistory), { userId: 'me' });
const ids = async (q: string) => {
	const res = await app().request(`/api/watch-history?q=${encodeURIComponent(q)}`, {}, env());
	assert.equal(res.status, 200, await res.clone().text());
	return (await res.json()) as { entries: Array<{ videoId: string }>; total: number; searched: number };
};

describe('watch history search', () => {
	it('finds by the title in another language, newest first', async () => {
		const body = await ids('الهجرة');
		assert.deepEqual(body.entries.map((e) => e.videoId), ['v1']);
		assert.equal(body.total, 1);
		assert.equal(body.searched, 3);
	});

	it('ignores case, diacritics and alef forms, and needs every word', async () => {
		assert.deepEqual((await ids('MADINAH migration')).entries.map((e) => e.videoId), ['v1']);
		assert.deepEqual((await ids('يَوْم عرفه')).entries.map((e) => e.videoId), ['v3']);
		assert.deepEqual((await ids('madinah wudu')).entries, []);
	});

	it('finds by channel name, and only the viewer\'s own entries', async () => {
		assert.deepEqual((await ids('fiqh')).entries.map((e) => e.videoId), ['v2']);
	});

	it('without q lists everything as before', async () => {
		const res = await app().request('/api/watch-history', {}, env());
		const body = (await res.json()) as { entries: unknown[]; total: number; searched?: number };
		assert.equal(body.total, 3);
		assert.equal(body.searched, undefined);
	});

	it('normalises Arabic and Latin text', () => {
		assert.equal(normaliseSearchText('  أَحكامُ  الصلاة '), 'احكام الصلاه');
		assert.deepEqual(searchWords('  '), []);
		assert.equal(matchesSearch({ videoTitle: 'X', channelNameLocalized: { ar: 'دليل الحاج' } }, ['الحاج']), true);
	});
});
