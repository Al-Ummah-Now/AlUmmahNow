/**
 * Live recording review (VR9, AlUmmahNow#1295): the media worker reads one variant of the
 * recording's HLS VOD, only under its directory, and writes review media under review/<stream>/<rev>/.
 * Pure: no container, no ffmpeg.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLiveReviewJobMessage } from '@al-ummah/shared-types';
import { reviewVariant } from '../container/review.mjs';
import { liveReviewPrefix, liveReviewQueueAction, liveVodSource, liveVodTarget } from '../src/jobs';

const SID = '11111111-2222-4333-8444-555555555555';
const BUNNY = 'https://vz-test.b-cdn.net/bcdn_token=abc_-&expires=1763000000&token_path=%2Faaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee%2F/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/playlist.m3u8';

describe('the recording the container may read', () => {
	it('self-hosted: the session directory and vod.m3u8', () => {
		assert.deepEqual(liveVodSource('https://live.qa.alummahnow.net/hls/sess-1/vod.m3u8'), { base: 'https://live.qa.alummahnow.net/hls/sess-1/', file: 'vod.m3u8' });
	});

	it('Bunny: the signed token path is kept verbatim, so relative segments stay signed', () => {
		const s = liveVodSource(BUNNY)!;
		assert.equal(s.file, 'playlist.m3u8');
		assert.ok(s.base.includes('token_path=%2Faaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee%2F/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/'));
		assert.equal(liveVodTarget(s.base, '720p/video.m3u8'), `${s.base}720p/video.m3u8`);
	});

	it('refuses anything but an https playlist', () => {
		for (const bad of ['http://x.example/a/vod.m3u8', 'https://u:p@x.example/a/vod.m3u8', 'https://x.example/a/video.mp4', 'not a url', 'https://x.example/a/v d.m3u8']) assert.equal(liveVodSource(bad), null, bad);
	});

	it('vod.internal serves only relative paths under the recording', () => {
		const base = 'https://live.qa.alummahnow.net/hls/sess-1/';
		assert.equal(liveVodTarget(base, '720/vod.m3u8'), `${base}720/vod.m3u8`);
		assert.equal(liveVodTarget(base, '720/seg_00001.m4s?x=1'), `${base}720/seg_00001.m4s?x=1`);
		for (const bad of ['', '../sess-2/vod.m3u8', '720/../../x', '/etc/passwd', 'https://evil.example/x', '//evil.example/x', 'a\\b', 'file:x']) assert.equal(liveVodTarget(base, bad), null, bad);
	});

	it('review media go under review/<streamId>/<rev>/', () => {
		assert.equal(liveReviewPrefix(SID, 'abcdef0123456789'), `review/${SID}/abcdef0123456789/`);
	});
});

describe('one variant of the master', () => {
	const master = [
		'#EXTM3U',
		'#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
		'720/vod.m3u8',
		'#EXT-X-STREAM-INF:BANDWIDTH=850000,RESOLUTION=640x360',
		'360/vod.m3u8',
		'#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480',
		'480/vod.m3u8',
		'',
	].join('\n');

	it('the smallest at least 360 px tall', () => assert.equal(reviewVariant(master), '360/vod.m3u8'));
	it('else the tallest there is', () => {
		assert.equal(reviewVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240\nmid.m3u8\n'), 'mid.m3u8');
	});
	it('a media playlist is read as is', () => assert.equal(reviewVariant('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg_1.m4s\n#EXT-X-ENDLIST\n'), null));
	it('Bunny masters (no RESOLUTION on some lines) still pick one', () => {
		assert.equal(reviewVariant('#EXTM3U\r\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1000000\r\nvideo.m3u8\r\n'), 'video.m3u8');
	});
});

describe('the queue', () => {
	it('busy waits, a passing failure retries, a final or fatal one gives up (api-videos then checks without frames)', () => {
		assert.deepEqual(liveReviewQueueAction({ outcome: 'ready' }, 1), { ack: true, giveUp: false });
		assert.equal(liveReviewQueueAction({ outcome: 'busy' }, 1).ack, false);
		assert.equal(liveReviewQueueAction({ outcome: 'failed' }, 1).ack, false);
		assert.deepEqual(liveReviewQueueAction({ outcome: 'failed', fatal: true }, 1), { ack: true, giveUp: true });
		assert.deepEqual(liveReviewQueueAction({ outcome: 'failed' }, 3), { ack: true, giveUp: true });
	});

	it('the job guard (shared-types) refuses unsafe ids and non-https recordings', () => {
		const job = { kind: 'live_review', streamId: SID, reviewId: 'r1', rev: 'abcdef0123456789', vodUrl: 'https://live.qa.alummahnow.net/hls/s/vod.m3u8', review: { maxFrames: 1200 }, queuedAt: 'x' };
		assert.ok(isLiveReviewJobMessage(job));
		assert.ok(isLiveReviewJobMessage({ ...job, vodUrl: BUNNY }));
		for (const bad of [{ streamId: '../x' }, { rev: 'ABC' }, { vodUrl: 'http://x/vod.m3u8' }, { vodUrl: 'https://x/a.mp4' }, { kind: 'transcode' }]) assert.equal(isLiveReviewJobMessage({ ...job, ...bad }), false, JSON.stringify(bad));
	});
});
