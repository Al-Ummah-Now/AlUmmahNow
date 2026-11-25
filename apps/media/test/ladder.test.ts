import { describe, it } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { bandwidthOf, displaySize, ffmpegArgs, ladderFor, MP4_FILE, mp4Args, mp4Rung, isNoFrameFailure, posterTime, progressSeconds, stillWithFallbacks, stillsArgs } from '../container/ladder.mjs';

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

describe('progressive MP4 (D-SEO-11)', () => {
	it('copies the 480p rung, else the best smaller one', () => {
		assert.equal(mp4Rung(ladderFor({ width: 1920, height: 1080 })).name, '480p');
		assert.equal(mp4Rung(ladderFor({ width: 1080, height: 1920 })).name, '480p');
		assert.equal(mp4Rung(ladderFor({ width: 640, height: 360 })).name, '360p');
		assert.equal(mp4Rung(ladderFor({ width: 321, height: 241 })).name, '360p');
		assert.equal(mp4Rung([]), null);
	});
	it('remuxes with stream copy and faststart, never re-encoding', () => {
		const args = mp4Args({ out: '/tmp/out', rung: '480p' });
		assert.deepEqual(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2), ['-i', '/tmp/out/480p/index.m3u8']);
		assert.ok(args.includes('copy'));
		assert.ok(!args.includes('libx264'));
		assert.deepEqual(args.slice(-3), ['-movflags', '+faststart', `/tmp/out/${MP4_FILE}`]);
	});
});

describe('stills of a short MPEG-TS clip (#1946)', () => {
	const seekOf = (args: string[]) => args[args.indexOf('-ss') + 1];
	it('keeps the input seek first and falls back to an output seek, then the first frame', () => {
		const s = stillsArgs({ input: 'i', out: 'o', durationSeconds: 5 });
		assert.ok(s.thumb.indexOf('-ss') < s.thumb.indexOf('-i'));
		const [after, first] = s.thumbFallbacks;
		assert.ok(after.indexOf('-i') < after.indexOf('-ss'), 'the output seek comes after -i');
		assert.equal(seekOf(after), '0.50');
		assert.ok(!first.includes('-ss'));
		assert.deepEqual([after.at(-1), first.at(-1)], ['o/thumb.jpg', 'o/thumb.jpg']);
		assert.deepEqual([s.thumbSmallFallbacks[0].at(-1), s.thumbSmallFallbacks[1].at(-1)], ['o/thumb_640.jpg', 'o/thumb_640.jpg']);
	});

	const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
	it('makes both posters from a real 5 s MPEG-TS clip that starts at 1.4 s or later', { skip: !haveFfmpeg && 'ffmpeg is not installed' }, () => {
		const dir = mkdtempSync(join(tmpdir(), 'stills-'));
		try {
			const input = join(dir, 'clip.ts');
			const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-output_ts_offset', '1.4', '-f', 'mpegts', input]);
			assert.equal(made.status, 0, String(made.stderr));
			const probe = JSON.parse(String(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', input]).stdout));
			assert.ok(Number(probe.format.start_time) > 1, `the clip starts at ${probe.format.start_time}`);
			const s = stillsArgs({ input, out: dir, durationSeconds: Number(probe.format.duration) });
			// Every way that is left after the input seek produces a poster
			for (const [name, args, file] of [['after', s.thumbFallbacks[0], 'thumb.jpg'], ['first', s.thumbFallbacks[1], 'thumb.jpg'], ['small after', s.thumbSmallFallbacks[0], 'thumb_640.jpg']] as const) {
				rmSync(join(dir, file), { force: true });
				const r = spawnSync('ffmpeg', args);
				assert.equal(r.status, 0, `${name}: ${String(r.stderr).slice(-300)}`);
				assert.ok(statSync(join(dir, file)).size > 0, name);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('stillWithFallbacks (#1946)', () => {
	const noFrame = () => Object.assign(new Error('ffmpeg exited 234'), { exitCode: 234, stderrTail: ['[vf#0:0] No filtered frames for output stream, trying to initialize anyway.', 'Conversion failed!'] });
	const other = (message: string, extra: object = {}) => Object.assign(new Error(message), extra);
	const ways = [['seek-before'], ['seek-after'], ['first-frame']];
	/** A runner that answers each call from the list: an Error is thrown, anything else is a success */
	const runner = (answers: Array<Error | 'ok'>) => {
		const calls: Array<{ args: string[]; timeoutMs: number | undefined }> = [];
		const run = async (_cmd: string, args: string[], _onLine: unknown, timeoutMs?: number) => {
			calls.push({ args, timeoutMs });
			const answer = answers[calls.length - 1];
			if (answer instanceof Error) throw answer;
			return '';
		};
		const logs: string[] = [];
		return { calls, logs, ctx: { run, log: (m: string) => logs.push(m), timeoutMs: 60_000 } };
	};

	it('recognises only a seek that left no frame', () => {
		assert.equal(isNoFrameFailure(noFrame()), true);
		assert.equal(isNoFrameFailure(other('x', { exitCode: 234, stderrTail: ['Nothing was written into output file, because at least one of its streams received no packets.'] })), true);
		assert.equal(isNoFrameFailure(other('x', { exitCode: 1, stderrTail: ['No space left on device'] })), false);
		assert.equal(isNoFrameFailure(other('spawn ffmpeg ENOENT')), false);
		assert.equal(isNoFrameFailure(other('ffmpeg timed out after 60000 ms', { timedOut: true })), false);
	});
	it('recovers: a seek with no frame is followed by the next way, and stops at the first that works', async () => {
		const { calls, logs, ctx } = runner([noFrame(), 'ok']);
		await stillWithFallbacks(ctx, ways[0], [ways[1], ways[2]]);
		assert.deepEqual(calls.map((c) => c.args), [ways[0], ways[1]]);
		assert.equal(logs.length, 1);
	});
	it('runs once and passes the per-attempt timeout when the first seek works', async () => {
		const { calls, ctx } = runner(['ok']);
		await stillWithFallbacks(ctx, ways[0], [ways[1], ways[2]]);
		assert.deepEqual(calls.map((c) => c.timeoutMs), [60_000]);
	});
	it('throws any other error at once with its own message, and never retries it', async () => {
		for (const error of [other('ffmpeg exited 1', { exitCode: 1, stderrTail: ['No space left on device'] }), other('ffmpeg timed out after 60000 ms', { timedOut: true }), other('spawn ffmpeg ENOENT')]) {
			const { calls, ctx } = runner([error, 'ok']);
			await assert.rejects(() => stillWithFallbacks(ctx, ways[0], [ways[1], ways[2]]), (e: Error) => e === error);
			assert.equal(calls.length, 1);
		}
	});
	it('after a no-frame failure an unrelated error from the next way is thrown as it is', async () => {
		const disk = other('ffmpeg exited 1', { exitCode: 1, stderrTail: ['No space left on device'] });
		const { calls, ctx } = runner([noFrame(), disk, 'ok']);
		await assert.rejects(() => stillWithFallbacks(ctx, ways[0], [ways[1], ways[2]]), (e: Error) => e === disk);
		assert.equal(calls.length, 2);
	});
	it('when all three ways find no frame it throws the last error after exactly three attempts', async () => {
		const last = noFrame();
		const { calls, ctx } = runner([noFrame(), noFrame(), last]);
		await assert.rejects(() => stillWithFallbacks(ctx, ways[0], [ways[1], ways[2]]), (e: Error) => e === last);
		assert.equal(calls.length, 3);
	});

	const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
	it('recovers on a real 5 s MPEG-TS clip with a runner that reports ffmpeg failures the way the container does', { skip: !haveFfmpeg && 'ffmpeg is not installed' }, async () => {
		const dir = mkdtempSync(join(tmpdir(), 'stills-run-'));
		try {
			const input = join(dir, 'clip.ts');
			const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-output_ts_offset', '1.4', '-f', 'mpegts', input]);
			assert.equal(made.status, 0, String(made.stderr));
			// The container's run(): a non-zero exit rejects with exitCode and the last stderr lines
			const run = (cmd: string, args: string[]) =>
				new Promise<string>((resolve, reject) => {
					const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
					let tail = '';
					p.stderr.on('data', (d) => (tail = (tail + d.toString()).slice(-4000)));
					p.on('close', (code) => (code === 0 ? resolve('') : reject(Object.assign(new Error(`${cmd} exited ${code}`), { exitCode: code, stderrTail: tail.split('\n').filter((l) => l.trim()).slice(-20) }))));
				});
			const s = stillsArgs({ input, out: dir, durationSeconds: 5 });
			await stillWithFallbacks({ run, log: () => undefined, timeoutMs: 60_000 }, s.thumb, s.thumbFallbacks);
			await stillWithFallbacks({ run, log: () => undefined, timeoutMs: 60_000 }, s.thumbSmall, s.thumbSmallFallbacks);
			assert.ok(statSync(join(dir, 'thumb.jpg')).size > 0 && statSync(join(dir, 'thumb_640.jpg')).size > 0);
			// A file that is not media is not a "no frame" case: it fails at once, with ffmpeg's own error
			const bad = stillsArgs({ input: join(dir, 'missing.ts'), out: dir, durationSeconds: 5 });
			await assert.rejects(() => stillWithFallbacks({ run, log: () => undefined, timeoutMs: 60_000 }, bad.thumb, bad.thumbFallbacks), (e: { exitCode?: number }) => typeof e.exitCode === 'number');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
