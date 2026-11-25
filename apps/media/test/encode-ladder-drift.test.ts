/**
 * The admin import app encodes on the admin's computer with the settings admin-api serves from
 * shared-types (ENCODE_LADDER, wiki TOOLS-ADMIN TA-12). They must be exactly what this container
 * encodes and checks, or every locally encoded rung would be refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENCODE_LADDER } from '@al-ummah/shared-types';
import { createHash } from 'node:crypto';
import { colourPlan, cubeText } from '../container/colour.mjs';
import { RUNGS, SEGMENT_SECONDS, GOP_SECONDS, ffmpegArgs, ladderFor } from '../container/ladder.mjs';

describe('ENCODE_LADDER matches the container', () => {
	it('has the same rungs, segment and GOP lengths', () => {
		assert.deepEqual(ENCODE_LADDER.rungs, RUNGS);
		assert.equal(ENCODE_LADDER.segmentSeconds, SEGMENT_SECONDS);
		assert.equal(ENCODE_LADDER.gopSeconds, GOP_SECONDS);
	});

	it('describes the same codec settings the ffmpeg arguments use', () => {
		const rungs = ladderFor({ width: 1920, height: 1080 });
		const args = ffmpegArgs({ input: 'in.mp4', out: 'out', rungs, hasAudio: true, fps: 60 }).join(' ');
		const v = ENCODE_LADDER.video;
		assert.match(args, /-c:v:0 libx264/);
		assert.match(args, new RegExp(`-crf:v:0 ${v.crf}`));
		assert.match(args, new RegExp(`-bufsize:v:0 ${rungs[0].maxrate * v.bufsizeFactor}`));
		assert.match(args, new RegExp(`format=${v.pixelFormat}`));
		assert.match(args, new RegExp(`flags=${v.scaler}`));
		assert.match(args, new RegExp(`-r:v:0 ${v.fpsCap.fps}`));
		assert.match(args, /-profile:v:0 main/);
		assert.match(args, /-profile:v:2 high/);
		assert.match(args, new RegExp(`-c:a:0 ${ENCODE_LADDER.audio.codec}`));
		assert.match(args, new RegExp(`-ac:a:0 ${ENCODE_LADDER.audio.channels}`));
		const h = ENCODE_LADDER.hls;
		assert.match(args, new RegExp(`-hls_segment_type ${h.segmentType}`));
		assert.match(args, new RegExp(`-hls_playlist_type ${h.playlistType}`));
		assert.match(args, new RegExp(`-hls_fmp4_init_filename ${h.init}`));
		assert.match(args, new RegExp(`-master_pl_name ${h.master}`));
		assert.ok(args.includes(`%v/${h.segment}`));
		assert.ok(args.includes(`%v/${h.rungPlaylist}`));
	});

	it('tags every rung as ENCODE_LADDER.colour says, and tone maps through its tables', () => {
		const c = ENCODE_LADDER.colour;
		assert.equal(c.version, 1);
		for (const kind of ['hlg', 'pq'] as const) assert.equal(createHash('sha256').update(cubeText(kind)).digest('hex'), c.cubes[kind]);
		const rungs = ladderFor({ width: 1280, height: 720 });
		const tags = `setparams=range=${c.range}:color_primaries=${c.output}:color_trc=${c.output}:colorspace=${c.output}`;
		const hlg = colourPlan({ matrix: 'bt2020nc', primaries: 'bt2020', transfer: 'arib-std-b67', full: false, rgb: false, codec: 'hevc', width: 1280, height: 720 }) as never;
		for (const plan of [undefined, hlg]) {
			const args: string[] = ffmpegArgs({ input: 'i', out: 'o', rungs, hasAudio: false, plan, cube: 'hlg.cube' });
			const graph = args[args.indexOf('-filter_complex') + 1]!;
			for (const i of rungs.keys()) assert.ok(graph.includes(`${tags}[v${i}o]`), graph);
			assert.equal(graph.includes('lut3d=file=hlg.cube'), plan !== undefined);
		}
	});

	it('keeps the 60 fps cap boundary and the short-side tolerance', () => {
		const at31 = ffmpegArgs({ input: 'i', out: 'o', rungs: ladderFor({ width: 640, height: 360 }), hasAudio: false, fps: ENCODE_LADDER.video.fpsCap.aboveFps }).join(' ');
		assert.doesNotMatch(at31, /-r:v:0/);
		const tol = ENCODE_LADDER.shortSideTolerance;
		assert.equal(ladderFor({ width: 1920 - tol * 2, height: 1080 - tol }).at(-1)?.name, '1080p');
		assert.equal(ladderFor({ width: 1920, height: 1080 - tol - 2 }).at(-1)?.name, '720p');
	});
});
