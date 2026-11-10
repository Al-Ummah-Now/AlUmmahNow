/**
 * The Short vs video rule (packages/shared-types/src/video-format.ts).
 * Owner decision 2026-11-09: a Short is <= 3 min AND vertical or square
 * (height >= width); the uploader's "Upload as Short / as video" wins.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyVideoFormat,
	isShort,
	needsFormatData,
	projectOwnership,
	projectVideo,
	SHORT_MAX_SECONDS,
} from '@al-ummah/shared-types';
import { isHighlightVideo } from '../src/lib/notification-events';
import { transformVideoToView } from '../src/lib/transformations';
import { videoFixture } from './helpers';

const VERTICAL = { width: 1080, height: 1920 };
const SQUARE = { width: 1080, height: 1080 };
const LANDSCAPE = { width: 1920, height: 1080 };

describe('isShort: duration boundaries', () => {
	it('is three minutes, inclusive', () => {
		assert.equal(SHORT_MAX_SECONDS, 180);
		assert.equal(isShort({ duration: 179, ...VERTICAL }), true, '179 s');
		assert.equal(isShort({ duration: 180, ...VERTICAL }), true, '180 s');
		assert.equal(isShort({ duration: 181, ...VERTICAL }), false, '181 s');
		assert.equal(isShort({ duration: 180.4, ...VERTICAL }), false, 'a fraction over is over');
		assert.equal(isShort({ duration: 1, ...VERTICAL }), true);
	});
});

describe('isShort: shape', () => {
	it('vertical (1080x1920) and square (1080x1080) are Shorts; landscape (1920x1080) is not', () => {
		assert.equal(isShort({ duration: 60, ...VERTICAL }), true);
		assert.equal(isShort({ duration: 60, ...SQUARE }), true);
		assert.equal(isShort({ duration: 60, ...LANDSCAPE }), false);
		assert.equal(isShort({ duration: 120, width: 1081, height: 1080 }), false, 'one pixel wider is landscape');
	});

	it('a long vertical video is a video', () => {
		assert.equal(isShort({ duration: 600, ...VERTICAL }), false);
		assert.deepEqual(classifyVideoFormat({ duration: 600, ...VERTICAL }), { format: 'video', source: 'auto' });
	});
});

describe('isShort: missing data', () => {
	it('missing dimensions: a video until processing stores them', () => {
		assert.equal(isShort({ duration: 30 }), false);
		assert.deepEqual(classifyVideoFormat({ duration: 30 }), { format: 'video', source: 'unknown', missing: ['dimensions'] });
		assert.equal(needsFormatData({ duration: 30 }), true);
		assert.equal(isShort({ duration: 30, width: 1080 }), false, 'height missing');
		assert.equal(isShort({ duration: 30, width: 0, height: 0 }), false, 'zero is missing');
	});

	it('missing duration: a video until processing stores it', () => {
		assert.equal(isShort({ ...VERTICAL }), false);
		assert.deepEqual(classifyVideoFormat({ ...VERTICAL }), { format: 'video', source: 'unknown', missing: ['duration'] });
		assert.deepEqual(classifyVideoFormat({}).missing, ['duration', 'dimensions']);
		assert.equal(isShort(null), false);
		assert.equal(isShort(undefined), false);
	});

	it('what is already decided needs no more data', () => {
		assert.equal(needsFormatData({ duration: 600 }), false, 'longer than 3 min: a video whatever the shape');
		assert.equal(needsFormatData({ ...LANDSCAPE }), false, 'landscape: a video whatever the length');
		assert.equal(needsFormatData({ format: 'short' }), false, 'uploader chose');
		assert.equal(needsFormatData({ isLive: true }), false);
	});
});

describe('isShort: uploader override', () => {
	it('"Upload as Short" and "Upload as video" win over detection', () => {
		assert.equal(isShort({ duration: 900, ...LANDSCAPE, format: 'short' }), true);
		assert.equal(isShort({ duration: 30, ...VERTICAL, format: 'video' }), false);
		assert.equal(isShort({ format: 'short' }), true, 'even before processing');
		assert.deepEqual(classifyVideoFormat({ duration: 30, ...VERTICAL, format: 'video' }), { format: 'video', source: 'override' });
	});

	it('anything else is detection', () => {
		assert.equal(isShort({ duration: 30, ...VERTICAL, format: 'auto' }), true);
		assert.equal(isShort({ duration: 30, ...VERTICAL, format: 'mp4' }), true, 'legacy container strings are not overrides');
	});

	it('live streams are never Shorts', () => {
		assert.equal(isShort({ duration: 30, ...VERTICAL, isLive: true }), false);
		assert.equal(isShort({ isLive: true, format: 'short' }), false);
	});
});

describe('one rule everywhere', () => {
	const cases = [
		{ v: { duration: 120, ...VERTICAL }, short: true },
		{ v: { duration: 120, ...LANDSCAPE }, short: false },
		{ v: { duration: 120, ...LANDSCAPE, format: 'short' as const }, short: true },
		{ v: { duration: 120 }, short: false },
	];
	it('ownership rows, search rows, notifications and the API view agree', () => {
		for (const { v, short } of cases) {
			const video = videoFixture({ id: 'v1', title: 'T', channelId: 'c1', ...v });
			assert.equal(projectOwnership('video', 'v1', video)?.isShort, short, JSON.stringify(v));
			assert.equal(projectVideo(video)?.isShort, short, JSON.stringify(v));
			assert.equal(projectVideo(video)?.payload.isShort, short);
			assert.equal(isHighlightVideo(video), !short);
			assert.equal(transformVideoToView(video as never).isShort, short);
		}
		assert.equal(projectOwnership('channel', 'c1', { id: 'c1', name: 'C' })?.isShort, false);
	});
});
