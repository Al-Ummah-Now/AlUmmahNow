import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bandwidthOf, displaySize, ffmpegArgs, ladderFor, posterTime, progressSeconds, stillsArgs } from '../container/ladder.mjs';

describe('ladderFor', () => {
	it('gives a 1080p landscape source all four rungs at 16:9', () => {
		const rungs = ladderFor({ width: 1920, height: 1080 });
		assert.deepEqual(rungs.map((r: { name: string }) => r.name), ['360p', '480p', '720p', '1080p']);
		assert.deepEqual(rungs.map((r: { width: number; height: number }) => [r.width, r.height]), [[640, 360], [854, 480], [1280, 720], [1920, 1080]]);
	});
	it('never goes above the source', () => {
		assert.deepEqual(ladderFor({ width: 1280, height: 720 }).map((r: { name: string }) => r.name), ['360p', '480p', '720p']);
	});
	it('names portrait (Shorts) rungs by the short side', () => {
		const rungs = ladderFor({ width: 1080, height: 1920 });
		assert.deepEqual(rungs.map((r: { width: number; height: number }) => [r.width, r.height]), [[360, 640], [480, 854], [720, 1280], [1080, 1920]]);
	});
	it('tolerates a few pixels short of a rung', () => {
		assert.equal(ladderFor({ width: 1916, height: 1076 }).length, 4);
	});
	it('keeps one even-sized rung for a tiny source', () => {
		const [r, ...rest] = ladderFor({ width: 321, height: 241 });
		assert.equal(rest.length, 0);
		assert.equal(r.height % 2, 0);
		assert.equal(r.width % 2, 0);
		assert.ok(r.height <= 241);
	});
	it('rejects a source without a size', () => {
		assert.throws(() => ladderFor({ width: 0, height: 0 }));
	});
});

describe('displaySize', () => {
	it('swaps width and height for a 90° phone recording', () => {
		assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: -90 }), { width: 1080, height: 1920 });
		assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 180 }), { width: 1920, height: 1080 });
	});
});

describe('ffmpegArgs', () => {
	const rungs = ladderFor({ width: 1280, height: 720 });
	it('maps one video and one audio stream per rung into fMP4 HLS with a master playlist', () => {
		const args: string[] = ffmpegArgs({ input: '/w/src', out: '/w/out', rungs, hasAudio: true, fps: 25 });
		assert.equal(args.filter((a) => a === '-map').length, 6);
		assert.ok(args.includes('fmp4'));
		assert.equal(args[args.indexOf('-var_stream_map') + 1], 'v:0,a:0,name:360p v:1,a:1,name:480p v:2,a:2,name:720p');
		assert.equal(args[args.indexOf('-master_pl_name') + 1], 'master.m3u8');
		assert.equal(args.at(-1), '/w/out/%v/index.m3u8');
		assert.ok(!args.includes('-r:v:0'), '25 fps is kept');
	});
	it('drops audio maps for a silent source and caps 60 fps at 30', () => {
		const args: string[] = ffmpegArgs({ input: 'i', out: 'o', rungs, hasAudio: false, fps: 59.94 });
		assert.equal(args.filter((a) => a === '-map').length, 3);
		assert.equal(args[args.indexOf('-var_stream_map') + 1], 'v:0,name:360p v:1,name:480p v:2,name:720p');
		assert.equal(args[args.indexOf('-r:v:0') + 1], '30');
	});
	it('forces a keyframe every 2 s so 6 s segments cut cleanly', () => {
		const args: string[] = ffmpegArgs({ input: 'i', out: 'o', rungs, hasAudio: true });
		assert.equal(args[args.indexOf('-force_key_frames') + 1], 'expr:gte(t,n_forced*2)');
		assert.equal(args[args.indexOf('-hls_time') + 1], '6');
	});
});

describe('stills and progress', () => {
	it('takes the poster 10% in, at most 30 s', () => {
		assert.equal(posterTime(60), 6);
		assert.equal(posterTime(3600), 30);
		assert.equal(posterTime(0), 0);
	});
	it('starts the preview so 4 s fit in a short clip', () => {
		const s = stillsArgs({ input: 'i', out: 'o', durationSeconds: 5 });
		assert.equal(s.preview[s.preview.indexOf('-ss') + 1], '0.50');
		assert.equal(s.thumb.at(-1), 'o/thumb.jpg');
	});
	it('reads ffmpeg progress lines', () => {
		assert.equal(progressSeconds('out_time_us=12500000'), 12.5);
		assert.equal(progressSeconds('out_time_ms=2000000'), 2);
		assert.equal(progressSeconds('frame=10'), null);
	});
	it('computes bandwidth', () => {
		assert.equal(bandwidthOf(1_000_000, 8), 1_000_000);
		assert.equal(bandwidthOf(5, 0), 0);
	});
});
