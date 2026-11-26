import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionQuranMarker, type SubtitleTrack } from '@al-ummah/shared-types';
import { publishedCaptionSources } from '../src/lib/captions/sources';

const track: SubtitleTrack = {
	id: 'track', language: 'ar', label: 'العربية', kind: 'subtitles', version: 1,
	uploadedBy: 'owner', uploadedAt: '2026-11-23', fileSize: 100, format: 'vtt',
	url: '/api/videos/v1/subtitles/ar', status: 'ready',
};
const metadata = (customMetadata: Record<string, string>) => ({ customMetadata }) as R2Object;

test('indexed tracks need no storage binding and ordinary legacy tracks need only HEAD', async () => {
	assert.deepEqual(await publishedCaptionSources(undefined, 'v1', [{ ...track, hasQuranText: true }]), ['quranFoundation']);
	assert.equal(await publishedCaptionSources(undefined, 'v1', [track]), undefined);
	const reads: string[] = [];
	const bucket = {
		async head(key: string) {
			reads.push(`head:${key}`);
			return metadata({});
		},
		async get(key: string) {
			reads.push(`get:${key}`);
			return null;
		},
	};
	assert.equal(await publishedCaptionSources(bucket, 'v1', [track]), undefined);
	assert.deepEqual(reads, ['head:v1/ar.vtt']);
});

test('legacy markers are inspected for text and storage failures omit attribution', async () => {
	const marked = metadata({ quran: '1' });
	for (const mode of ['reference', 'text'] as const) {
		const body = { ...marked, text: async () => captionQuranMarker('112:1:1-112:1:4', mode) } as R2ObjectBody;
		const bucket = { head: async () => marked, get: async () => body };
		assert.deepEqual(await publishedCaptionSources(bucket, 'v1', [track]), mode === 'text' ? ['quranFoundation'] : undefined);
	}

	const unavailable = async () => { throw new Error('R2 unavailable'); };
	assert.equal(await publishedCaptionSources({ head: unavailable, get: unavailable }, 'v1', [track]), undefined);
	assert.equal(await publishedCaptionSources({ head: async () => marked, get: unavailable }, 'v1', [track]), undefined);
});
