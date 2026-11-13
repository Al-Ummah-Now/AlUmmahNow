/** Review media extraction helpers (docs/specs/VIDEO-REVIEW.md §5). Pure: no ffmpeg here. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_CHUNK_SECONDS, audioArgs, frameInterval, frameTimes, framesArgs, manifestFor, thinFrames } from '../container/review.mjs';

describe('frame interval (VR4)', () => {
	it('2 s for a normal video', () => assert.deepEqual(frameInterval(30 * 60, { frameIntervalSeconds: 2, maxFrames: 1200 }), { interval: 2, capped: false }));
	it('widened for a long one so the cap holds, leaving room for scene cuts', () => {
		const r = frameInterval(3 * 3600, { frameIntervalSeconds: 2, maxFrames: 1200 });
		assert.equal(r.capped, true);
		assert.ok((3 * 3600) / r.interval <= 960 + 1);
	});
});

describe('ffmpeg arguments', () => {
	it('frames: dedupe, interval + scene cuts, ≤ 512 px, times printed', () => {
		const args = framesArgs({ input: 'src', out: 'out', interval: 2, sceneThreshold: 0.3 });
		const vf = args[args.indexOf('-vf') + 1];
		assert.match(vf, /^mpdecimate/);
		assert.match(vf, /gte\(t-prev_selected_t\\,2\)/);
		assert.match(vf, /gt\(scene\\,0\.3\)/);
		assert.match(vf, /showinfo$/);
		assert.equal(args.at(-1), 'out/%06d.jpg');
	});
	it('audio: 16 kHz mono chunks of 10 minutes', () => {
		const args = audioArgs({ input: 'src', out: 'out' });
		assert.deepEqual(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 4), ['-ac', '1', '-ar', '16000']);
		assert.equal(args[args.indexOf('-segment_time') + 1], String(AUDIO_CHUNK_SECONDS));
	});
});

describe('frame times and the manifest', () => {
	it('parses showinfo pts_time', () => {
		const lines = ['[Parsed_showinfo_3 @ 0x1] n:   0 pts:      0 pts_time:0       duration', 'noise', '[Parsed_showinfo_3 @ 0x1] n:   1 pts: 512 pts_time:2.04 duration'];
		assert.deepEqual(frameTimes(lines), [0, 2040]);
	});
	it('thins evenly to the cap', () => {
		assert.equal(thinFrames(Array.from({ length: 1500 }, (_, i) => i), 1200).length, 1200);
		assert.deepEqual(thinFrames([1, 2, 3], 10), [1, 2, 3]);
	});
	it('builds keys under the review prefix with audio chunk times', () => {
		const m = manifestFor({ videoId: 'v', rev: 'r', prefix: 'review/v/r/', durationSeconds: 900, frames: [{ file: '000001.jpg', atMs: 0 }], audioCount: 2, capped: false, now: 'x' });
		assert.equal(m.frames[0].key, 'review/v/r/frames/000001.jpg');
		assert.deepEqual(m.audio.map((a: { startMs: number; endMs: number }) => [a.startMs, a.endMs]), [[0, 600_000], [600_000, 900_000]]);
	});
});
