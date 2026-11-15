/**
 * Move from YouTube (wiki AUN-YT-IMPORT), the shared pure parts: the Takeout
 * zip index reader, videos.csv, matching files to videos, visibility and
 * metadata mapping, the link-back CSV.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	bestThumbnail,
	importVisibility,
	isImportableCaptionTrack,
	isVideoFileName,
	isVideosCsv,
	linkBackCsv,
	matchTakeoutFiles,
	normalizeTitle,
	openEntryStream,
	parseCsv,
	parseIsoDuration,
	parseTakeoutVideosCsv,
	pickLocalizations,
	readZipIndex,
	ytPrivacyToVisibility,
	ZipFormatError,
	type TakeoutFile,
} from '@al-ummah/shared-types';
import { buildZip } from './zip-fixture';

const readerOf = (bytes: Uint8Array) => {
	let reads = 0;
	return {
		get reads() {
			return reads;
		},
		read: async (start: number, end: number) => {
			reads++;
			return bytes.slice(start, end);
		},
		slice: (start: number, end: number) => new Blob([bytes.slice(start, end)]).stream() as ReadableStream<Uint8Array>,
	};
};

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
	return new Response(stream).text();
}

describe('Takeout zip index', () => {
	const video = 'x'.repeat(5000) + 'END';
	for (const zip64 of [false, true]) {
		it(`lists entries and streams stored and deflated data${zip64 ? ' (zip64)' : ''}`, async () => {
			const bytes = buildZip(
				[
					{ name: 'Takeout/YouTube and YouTube Music/videos/محاضرة الفجر.mp4', data: video, method: 8 },
					{ name: 'Takeout/YouTube and YouTube Music/videos/Talk (1).mp4', data: 'stored-bytes', method: 0 },
					{ name: 'Takeout/YouTube and YouTube Music/video metadata/videos.csv', data: 'Video ID,Video Title (Original)\n' },
				],
				{ zip64 },
			);
			const r = readerOf(bytes);
			const entries = await readZipIndex(r.read, bytes.length);
			assert.equal(entries.length, 3);
			assert.ok(r.reads <= 3, 'the index costs at most three reads');
			assert.equal(entries[0]!.name, 'Takeout/YouTube and YouTube Music/videos/محاضرة الفجر.mp4');
			assert.equal(entries[0]!.size, video.length);
			assert.equal(entries[0]!.method, 8);
			assert.equal(await text(await openEntryStream(r.read, r.slice, entries[0]!)), video);
			assert.equal(await text(await openEntryStream(r.read, r.slice, entries[1]!)), 'stored-bytes');
			assert.ok(isVideoFileName(entries[0]!.name) && isVideoFileName(entries[1]!.name) && !isVideoFileName(entries[2]!.name));
			assert.ok(isVideosCsv(entries[2]!.name));
		});
	}

	it('refuses what is not a zip, and a cut-off download', async () => {
		const junk = new TextEncoder().encode('not a zip at all, just some bytes '.repeat(10));
		await assert.rejects(readZipIndex(readerOf(junk).read, junk.length), (e: unknown) => e instanceof ZipFormatError && e.code === 'not_zip');
		const whole = buildZip([{ name: 'a.mp4', data: 'abc' }]);
		// A download cut off part-way has no end record
		const half = whole.slice(0, Math.floor(whole.length / 2));
		await assert.rejects(readZipIndex(readerOf(half).read, half.length), (e: unknown) => e instanceof ZipFormatError && e.code === 'not_zip');
		// An end record pointing past the file's end
		const lying = whole.slice();
		new DataView(lying.buffer).setUint32(lying.length - 6, lying.length + 100, true);
		await assert.rejects(readZipIndex(readerOf(lying).read, lying.length), (e: unknown) => e instanceof ZipFormatError && e.code === 'truncated');
	});

	it('refuses an encrypted entry', async () => {
		const bytes = buildZip([{ name: 'a.mp4', data: 'abc', method: 0 }]);
		const r = readerOf(bytes);
		const [entry] = await readZipIndex(r.read, bytes.length);
		await assert.rejects(openEntryStream(r.read, r.slice, { ...entry!, encrypted: true }), (e: unknown) => e instanceof ZipFormatError && e.code === 'encrypted');
	});
});

describe('videos.csv', () => {
	it('parses quoted fields, doubled quotes, CRLF and a BOM', () => {
		assert.deepEqual(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\n'), [
			['a', 'b, c', 'say "hi"'],
			['1', '2', '3'],
		]);
		assert.deepEqual(parseCsv('a,"line\nbreak"\n'), [['a', 'line\nbreak']]);
	});

	it('reads ids and titles by column name, in any order', () => {
		const csv = 'Channel ID,Video Title (Original),Approx Duration (ms),Video ID\nUC1,"Talk, part 1",61000,abcdefghijk\nUC1,Bad id,1,short\n';
		assert.deepEqual(parseTakeoutVideosCsv(csv), [{ videoId: 'abcdefghijk', title: 'Talk, part 1', durationMs: 61000 }]);
		assert.deepEqual(parseTakeoutVideosCsv('Title,Something\nA,B\n'), []);
	});
});

describe('matching files to videos', () => {
	const file = (fileName: string, zipName = 'takeout-001.zip'): TakeoutFile => ({ key: `${zipName}/${fileName}`, zipName, entryName: `Takeout/YouTube/videos/${fileName}`, fileName, size: 10 });

	it('normalizes what Takeout file names keep', () => {
		assert.equal(normalizeTitle('Tafsir: Al-Fatiha? (Part 1).mp4'), normalizeTitle('Tafsir Al-Fatiha (Part 1)'));
		assert.equal(normalizeTitle('Talk (1).mp4'), 'talk');
		assert.equal(normalizeTitle('دَرْسُ الفجر'), normalizeTitle('درس الفجر'));
	});

	it('matches by the id in the name, then by videos.csv, then by title; never guesses a shared title', () => {
		const items = [
			{ id: 'i1', ytVideoId: 'AAAAAAAAAAA', title: 'Opening talk' },
			{ id: 'i2', ytVideoId: 'BBBBBBBBBBB', title: 'Renamed on YouTube since' },
			{ id: 'i3', ytVideoId: 'CCCCCCCCCCC', title: 'Q&A: Part 2?' },
			{ id: 'i4', ytVideoId: 'DDDDDDDDDDD', title: 'Same' },
			{ id: 'i5', ytVideoId: 'EEEEEEEEEEE', title: 'Same' },
			{ id: 'i6', ytVideoId: 'FFFFFFFFFFF', title: 'No file for me' },
		];
		const files = [file('Opening talk [AAAAAAAAAAA].mp4'), file('Old title.mov', 'takeout-002.zip'), file('QA Part 2.mp4'), file('Same.mp4'), file('Same (1).mp4')];
		const csv = [{ videoId: 'BBBBBBBBBBB', title: 'Old title', durationMs: null }];
		const m = matchTakeoutFiles(items, files, csv);
		assert.deepEqual(m.get('i1'), { file: files[0], by: 'id' });
		assert.deepEqual(m.get('i2'), { file: files[1], by: 'id' });
		assert.deepEqual(m.get('i3'), { file: files[2], by: 'title' });
		assert.equal(m.has('i4'), false);
		assert.equal(m.has('i5'), false);
		assert.equal(m.has('i6'), false);
	});

	it('never gives one file to two videos', () => {
		const items = [
			{ id: 'i1', ytVideoId: 'AAAAAAAAAAA', title: 'Talk' },
			{ id: 'i2', ytVideoId: 'BBBBBBBBBBB', title: 'Other' },
		];
		const files = [file('Talk.mp4')];
		const m = matchTakeoutFiles(items, files, [{ videoId: 'BBBBBBBBBBB', title: 'Talk', durationMs: null }]);
		assert.equal(m.size, 1);
	});
});

describe('mapping', () => {
	const now = new Date('2026-11-14T00:00:00Z');

	it('maps visibility, scheduled videos and "everything private"', () => {
		assert.equal(ytPrivacyToVisibility('public'), 'public');
		assert.equal(ytPrivacyToVisibility('unlisted'), 'unlisted');
		assert.equal(ytPrivacyToVisibility('private'), 'private');
		assert.equal(ytPrivacyToVisibility(undefined), 'private');
		assert.deepEqual(importVisibility({ ytVisibility: 'unlisted', publishAt: null }, 'keep', now), { visibility: 'unlisted', scheduleAt: null });
		assert.deepEqual(importVisibility({ ytVisibility: 'private', publishAt: '2026-12-01T10:00:00Z' }, 'keep', now), { visibility: 'private', scheduleAt: '2026-12-01T10:00:00.000Z' });
		assert.deepEqual(importVisibility({ ytVisibility: 'private', publishAt: '2026-01-01T10:00:00Z' }, 'keep', now), { visibility: 'private', scheduleAt: null });
		assert.deepEqual(importVisibility({ ytVisibility: 'public', publishAt: null }, 'private', now), { visibility: 'private', scheduleAt: null });
	});

	it('reads durations, thumbnails, localizations and caption tracks', () => {
		assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
		assert.equal(parseIsoDuration('P1DT1S'), 86401);
		assert.equal(parseIsoDuration('PT45S'), 45);
		assert.equal(parseIsoDuration('P'), null);
		assert.equal(parseIsoDuration('garbage'), null);
		assert.equal(bestThumbnail({ high: { url: 'https://i.ytimg.com/h.jpg' }, maxres: { url: 'https://i.ytimg.com/m.jpg' } }), 'https://i.ytimg.com/m.jpg');
		assert.equal(bestThumbnail({ default: { url: 'http://insecure' } }), null);
		assert.deepEqual(pickLocalizations({ 'ar-EG': { title: 'عنوان' }, en: { title: 'T', description: 'D' }, fr: { title: 'F' } }), {
			titleLocalized: { ar: 'عنوان', en: 'T' },
			descriptionLocalized: { en: 'D' },
		});
		assert.equal(isImportableCaptionTrack({ language: 'ar', trackKind: 'standard' }), true);
		assert.equal(isImportableCaptionTrack({ language: 'en', trackKind: 'ASR' }), false);
		assert.equal(isImportableCaptionTrack({ language: 'en', isDraft: true }), false);
	});

	it('builds the link-back CSV', () => {
		assert.equal(
			linkBackCsv([{ ytVideoId: 'AAAAAAAAAAA', url: 'https://alummahnow.link/v/x', title: 'A, "quoted" title' }]),
			'youtube_video_id,youtube_url,al_ummah_now_url,title\r\nAAAAAAAAAAA,https://www.youtube.com/watch?v=AAAAAAAAAAA,https://alummahnow.link/v/x,"A, ""quoted"" title"\r\n',
		);
	});
});
