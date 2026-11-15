/**
 * Transcript search (AUN-CAPTIONS §5.10): passages of published caption tracks in SEARCH_DB, found
 * by the search with where they start; on the real FTS5 schema (node:sqlite).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	MessageType,
	PASSAGE_MAX_CHARS,
	captionQuranMarker,
	syncSearchDocument,
	syncTranscriptTrack,
	transcriptPassages,
	transcriptTrackForKey,
} from '@al-ummah/shared-types';
import { searchIndex } from '../src/lib/search/query';
import { wrapSubtitles } from '../src/lib/search/sync';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

const vtt = (...cues: Array<[string, string, string]>) => ['WEBVTT', '', ...cues.flatMap(([from, to, text]) => [`${from} --> ${to}`, text, ''])].join('\n');

async function seed(db: SqliteD1) {
	await syncSearchDocument(db, 'video', 'v-pub', videoFixture({ id: 'v-pub', title: 'Friday reminder', channelId: 'ch-1' }), { now: NOW });
	await syncSearchDocument(db, 'video', 'v-priv', videoFixture({ id: 'v-priv', title: 'Draft talk', channelId: 'ch-1', isPublic: false }), { now: NOW });
	await syncSearchDocument(db, 'video', 'v-other', videoFixture({ id: 'v-other', title: 'Another talk', channelId: 'ch-2' }), { now: NOW });
}

describe('transcript passages', () => {
	it('joins cues into passages with their start time, speech only', () => {
		const file = vtt(
			['00:00:01.000', '00:00:03.000', 'Patience is <b>light</b>'],
			['00:00:03.000', '00:00:05.000', 'as the Prophet said'],
			['00:00:05.000', '00:00:09.000', captionQuranMarker('2:153', 'text')],
			['00:00:40.000', '00:00:42.000', 'Tom &amp; Jerry'],
		);
		assert.deepEqual(transcriptPassages(file), [
			{ startMs: 1000, text: 'Patience is light as the Prophet said' },
			{ startMs: 40000, text: 'Tom & Jerry' },
		]);
	});

	it('ends a passage when it is long enough', () => {
		const long = 'word '.repeat(40).trim();
		const passages = transcriptPassages(vtt(['00:00:00.000', '00:00:02.000', long], ['00:00:02.000', '00:00:04.000', 'next']));
		assert.equal(passages.length, 2);
		assert.ok(passages[0]!.text.length >= PASSAGE_MAX_CHARS);
		assert.deepEqual(passages[1], { startMs: 2000, text: 'next' });
	});

	it('reads hour timestamps, cue ids, NOTE blocks and CRLF files', () => {
		const file = 'WEBVTT\r\n\r\nNOTE made by hand\r\n\r\ncue-1\r\n01:02:03.500 --> 01:02:05.000 align:start\r\nلا إله إلا الله\r\n';
		assert.deepEqual(transcriptPassages(file), [{ startMs: 3723500, text: 'لا إله إلا الله' }]);
	});

	it('knows a published track key from drafts and other keys', () => {
		assert.deepEqual(transcriptTrackForKey('v1/en.vtt'), { videoId: 'v1', language: 'en' });
		assert.deepEqual(transcriptTrackForKey('v1/pt-BR.vtt'), { videoId: 'v1', language: 'pt-BR' });
		assert.equal(transcriptTrackForKey('v1/drafts/en.json'), null);
		assert.equal(transcriptTrackForKey('v1/metadata.json'), null);
		assert.equal(transcriptTrackForKey('../v1/en.vtt'), null);
	});
});

describe('transcript search', () => {
	it('finds where a visible video says it, one passage per video, and never a private one', async () => {
		const db = new SqliteD1();
		await seed(db);
		const said = vtt(['00:00:01.000', '00:00:03.000', 'Welcome everyone'], ['00:01:10.000', '00:01:14.000', 'Seek help through patience and prayer']);
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 1 }, said);
		await syncTranscriptTrack(db, { videoId: 'v-priv', language: 'en', version: 1 }, said);

		const result = await searchIndex(db, { q: 'patience prayer' }, { now: NOW });
		assert.equal(result.transcripts?.length, 1);
		assert.deepEqual(
			{ id: result.transcripts![0]!.videoId, at: result.transcripts![0]!.startMs, text: result.transcripts![0]!.text, title: result.transcripts![0]!.video.title },
			{ id: 'v-pub', at: 70000, text: 'Seek help through patience and prayer', title: 'Friday reminder' },
		);
		// The title-and-description results are unchanged by captions
		assert.equal(result.results.length, 0);
	});

	it('matches Arabic the way the rest of search does (tashkeel and alef forms folded)', async () => {
		const db = new SqliteD1();
		await seed(db);
		await syncTranscriptTrack(db, { videoId: 'v-other', language: 'ar', version: 1 }, vtt(['00:00:05.000', '00:00:08.000', 'إِنَّ اللَّهَ مَعَ الصَّابِرِينَ']));
		const result = await searchIndex(db, { q: 'الصابرين' }, { now: NOW });
		assert.equal(result.transcripts?.[0]?.videoId, 'v-other');
		assert.equal(result.transcripts?.[0]?.language, 'ar');
	});

	it('keeps to the search filters and the first page', async () => {
		const db = new SqliteD1();
		await seed(db);
		const file = vtt(['00:00:02.000', '00:00:04.000', 'the night prayer']);
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 1 }, file);
		await syncTranscriptTrack(db, { videoId: 'v-other', language: 'en', version: 1 }, file);
		assert.deepEqual((await searchIndex(db, { q: 'night prayer', channelId: 'ch-2' }, { now: NOW })).transcripts?.map((m) => m.videoId), ['v-other']);
		assert.equal((await searchIndex(db, { q: 'night prayer', type: 'channel' }, { now: NOW })).transcripts, undefined);
		assert.equal((await searchIndex(db, { q: 'night prayer', cursor: 'o20' }, { now: NOW })).transcripts, undefined);
		assert.equal((await searchIndex(db, { type: 'video' }, { now: NOW })).transcripts, undefined);
	});

	it('replaces a republished track, drops a deleted one, ignores an older message', async () => {
		const db = new SqliteD1();
		await seed(db);
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 10 }, vtt(['00:00:01.000', '00:00:02.000', 'first wording']));
		assert.equal(await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 20 }, vtt(['00:00:03.000', '00:00:04.000', 'second wording'])), 'indexed');
		assert.equal((await searchIndex(db, { q: 'first wording' }, { now: NOW })).transcripts?.length, 0);
		assert.equal((await searchIndex(db, { q: 'second wording' }, { now: NOW })).transcripts?.[0]?.startMs, 3000);

		assert.equal(await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 15 }, vtt(['00:00:01.000', '00:00:02.000', 'stale wording'])), 'stale');
		assert.equal((await searchIndex(db, { q: 'stale wording' }, { now: NOW })).transcripts?.length, 0);

		assert.equal(await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 30 }, null), 'removed');
		assert.equal((await searchIndex(db, { q: 'second wording' }, { now: NOW })).transcripts?.length, 0);
		assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM search_transcripts_fts').get() as { n: number }).n, 0);
	});

	it('removes every passage of a deleted video with its search row', async () => {
		const db = new SqliteD1();
		await seed(db);
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 1 }, vtt(['00:00:01.000', '00:00:02.000', 'gone soon']));
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'ar', version: 1 }, vtt(['00:00:01.000', '00:00:02.000', 'قريبا']));
		await syncSearchDocument(db, 'video', 'v-pub', null, { now: NOW + 1 });
		assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM search_transcripts WHERE video_id = 'v-pub'").get() as { n: number }).n, 0);
		assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM search_transcripts_fts').get() as { n: number }).n, 0);
	});

	it('indexes a long track in several batches', async () => {
		const db = new SqliteD1();
		await seed(db);
		const cues = Array.from({ length: 400 }, (_, i): [string, string, string] => {
			const s = i * 31;
			const stamp = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}.000`;
			return [stamp(s), stamp(s + 2), i === 399 ? 'the very last words' : `passage number ${i}`];
		});
		await syncTranscriptTrack(db, { videoId: 'v-pub', language: 'en', version: 1 }, vtt(...cues));
		assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM search_transcripts WHERE video_id = 'v-pub'").get() as { n: number }).n, 400);
		assert.equal((await searchIndex(db, { q: 'very last words' }, { now: NOW })).transcripts?.[0]?.startMs, 399 * 31 * 1000);
	});
});

describe('published tracks queue an index update', () => {
	it('sends one message per track put or delete, none for drafts', async () => {
		const sent: Array<{ type: number; payload: { videoId: string; language: string; version: number } }> = [];
		const waits: Promise<unknown>[] = [];
		const bucket = wrapSubtitles(new MemoryBucket() as unknown as R2Bucket, { send: async (m) => void sent.push(m as never) }, (p) => waits.push(p));
		await bucket.put('v1/en.vtt', 'WEBVTT');
		await bucket.put('v1/drafts/en.json', '{}');
		await bucket.put('v1/metadata.json', '{}');
		await bucket.delete(['v1/en.vtt', 'v1/ar.vtt']);
		await Promise.all(waits);
		assert.deepEqual(sent.map((m) => [m.type, m.payload.videoId, m.payload.language]), [
			[MessageType.TranscriptIndexSync, 'v1', 'en'],
			[MessageType.TranscriptIndexSync, 'v1', 'en'],
			[MessageType.TranscriptIndexSync, 'v1', 'ar'],
		]);
		assert.ok(sent.every((m) => Number.isFinite(m.payload.version)));
	});

	it('keeps the write when the queue send fails', async () => {
		const waits: Promise<unknown>[] = [];
		const inner = new MemoryBucket();
		const bucket = wrapSubtitles(inner as unknown as R2Bucket, { send: async () => Promise.reject(new Error('queue down')) }, (p) => waits.push(p));
		await bucket.put('v1/en.vtt', 'WEBVTT');
		await Promise.all(waits);
		assert.ok(await inner.get('v1/en.vtt'));
	});
});
