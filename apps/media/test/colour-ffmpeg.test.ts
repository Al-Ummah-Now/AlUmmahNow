/**
 * The colours viewers get, measured: clips of known colours (HLG, PQ, SDR in every tagging) go through
 * the real ffmpeg arguments, and every rung, the MP4, the thumbnails and the preview are decoded and
 * compared with the colours they must show. Runs in CI with Ubuntu's ffmpeg and in the container image
 * (deploy.yml), where the production ffmpeg is. Only Node built-ins and ../container, so the image can run it.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colourOf, colourPlan, cubeText, hasHdrData, toneMap } from '../container/colour.mjs';
import { ffmpegArgs, ladderFor, mp4Args, stillsArgs } from '../container/ladder.mjs';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const have = spawnSync(FFMPEG, ['-version']).status === 0;
const inCi = !!process.env.CI;
const encoders = have ? String(spawnSync(FFMPEG, ['-hide_banner', '-encoders']).stdout) : '';
if (inCi) assert.ok(have && encoders.includes('libx265') && encoders.includes('libwebp'), 'CI must have ffmpeg with libx264, libx265 and libwebp');

const W = 1280;
const H = 720;
const COLS = 8;
/** BT.709 signal (gamma 2.4) of each patch; neutrals first. */
const PATCHES: number[][] = [[0, 0, 0], [32, 32, 32], [64, 64, 64], [128, 128, 128], [160, 160, 160], [192, 192, 192], [224, 224, 224], [255, 255, 255], [115, 82, 68], [198, 134, 96], [241, 194, 160], [141, 85, 54], [98, 122, 157], [180, 130, 70], [87, 108, 67], [160, 60, 60]];
const ROWS = PATCHES.length / COLS;

type Space = { kr: number; kg: number; kb: number };
const BT709: Space = { kr: 0.2126, kg: 0.7152, kb: 0.0722 };
const BT601: Space = { kr: 0.299, kg: 0.587, kb: 0.114 };
const BT2020: Space = { kr: 0.2627, kg: 0.678, kb: 0.0593 };

/** One raw planar 4:2:0 frame of the patches (each patch's RGB signal 0–1). */
function frame(signal: number[][], s: Space, depth: 8 | 10, full = false): Buffer {
	const bytes = depth === 8 ? 1 : 2;
	const scale = 2 ** (depth - 8);
	const max = 2 ** depth - 1;
	const plane = (w: number, h: number, at: (p: number[]) => number) => {
		const b = Buffer.alloc(w * h * bytes);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const v = Math.max(0, Math.min(max, Math.round(at(signal[Math.floor((y * ROWS) / h) * COLS + Math.floor((x * COLS) / w)]!))));
				if (bytes === 1) b[y * w + x] = v;
				else b.writeUInt16LE(v, (y * w + x) * 2);
			}
		}
		return b;
	};
	const luma = (p: number[]) => s.kr * p[0]! + s.kg * p[1]! + s.kb * p[2]!;
	const y = (p: number[]) => (full ? luma(p) * max : (luma(p) * 219 + 16) * scale);
	const c = (d: number, k: number) => (full ? (d / (2 * (1 - k))) * max + (max + 1) / 2 : ((d / (2 * (1 - k))) * 224 + 128) * scale);
	return Buffer.concat([plane(W, H, y), plane(W / 2, H / 2, (p) => c(p[2]! - luma(p), s.kb)), plane(W / 2, H / 2, (p) => c(p[0]! - luma(p), s.kr))]);
}

const TO_2020 = [[0.627403896, 0.329283038, 0.043313066], [0.069097289, 0.91954040, 0.011362316], [0.016391439, 0.088013308, 0.895595253]];
const nits = (p: number[]) => {
	const lin = p.map((v) => Math.pow(v / 255, 2.4) * 203);
	return TO_2020.map((m) => m[0]! * lin[0]! + m[1]! * lin[1]! + m[2]! * lin[2]!);
};
function hlg(p: number[]): number[] {
	const n = nits(p).map((v) => v / 1000);
	const y = BT2020.kr * n[0]! + BT2020.kg * n[1]! + BT2020.kb * n[2]!;
	return n.map((v) => {
		const e = y > 0 ? v * Math.pow(y, -0.2 / 1.2) : 0;
		return e <= 1 / 12 ? Math.sqrt(3 * e) : 0.17883277 * Math.log(12 * e - 0.28466892) + 0.55991073;
	});
}
function pq(p: number[]): number[] {
	return nits(p).map((n) => {
		const y = Math.pow(n / 10000, 0.1593017578125);
		return Math.pow((0.8359375 + 18.8515625 * y) / (1 + 18.6875 * y), 78.84375);
	});
}
const sdr = (p: number[]) => p.map((v) => v / 255);

let dir = '';
const run = (cmd: string, args: string[], input?: Buffer) => {
	const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 28 });
	assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${String(r.stderr).slice(-1500)}`);
	return r.stdout as Buffer;
};
const probe = (file: string, extra: string[] = []) => JSON.parse(String(run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-print_format', 'json', '-show_streams', ...extra, file])));

interface Clip {
	name: string;
	signal: (p: number[]) => number[];
	space: Space;
	depth: 8 | 10;
	full?: boolean;
	codec: string[];
	tags?: [string, string, string, string];
	kind: string;
	/** The colours viewers must get, 0–255 */
	want: (p: number[]) => number[];
	file?: string;
}
const x265 = (params: string) => ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', `log-level=error:crf=4:${params}`];
const x264 = ['-c:v', 'libx264', '-crf', '4', '-preset', 'ultrafast'];
const HLG_TAGS: Clip['tags'] = ['bt2020', 'arib-std-b67', 'bt2020nc', 'tv'];
const mapped = (kind: 'hlg' | 'pq', signal: (p: number[]) => number[]) => (p: number[]) => toneMap(kind, signal(p)).map((v: number) => v * 255);
const CLIPS: Clip[] = [
	{ name: 'hlg', signal: hlg, space: BT2020, depth: 10, codec: x265('repeat-headers=1'), tags: HLG_TAGS, kind: 'hlg', want: mapped('hlg', hlg) },
	{ name: 'hlg-vp9', file: 'hlg.webm', signal: hlg, space: BT2020, depth: 10, codec: ['-c:v', 'libvpx-vp9', '-profile:v', '2', '-pix_fmt', 'yuv420p10le', '-crf', '4', '-b:v', '0', '-cpu-used', '8'], tags: HLG_TAGS, kind: 'hlg', want: mapped('hlg', hlg) },
	// What an old importer sent: an 8-bit H.264 that still says HLG
	{ name: 'hlg-8bit', signal: hlg, space: BT2020, depth: 8, codec: [...x264, '-pix_fmt', 'yuv420p'], tags: HLG_TAGS, kind: 'hlg', want: mapped('hlg', hlg) },
	{ name: 'pq-hdr10', signal: pq, space: BT2020, depth: 10, codec: x265('hdr10=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400'), tags: ['bt2020', 'smpte2084', 'bt2020nc', 'tv'], kind: 'pq', want: mapped('pq', pq) },
	{ name: 'sdr-709', signal: sdr, space: BT709, depth: 8, codec: [...x264, '-pix_fmt', 'yuv420p'], tags: ['bt709', 'bt709', 'bt709', 'tv'], kind: 'as_is', want: (p) => p },
	{ name: 'sdr-untagged', signal: sdr, space: BT709, depth: 8, codec: [...x264, '-pix_fmt', 'yuv420p'], kind: 'as_is', want: (p) => p },
	{ name: 'sdr-10bit', signal: sdr, space: BT709, depth: 10, codec: x265('repeat-headers=1'), tags: ['bt709', 'bt709', 'bt709', 'tv'], kind: 'as_is', want: (p) => p },
	{ name: 'sdr-full', signal: sdr, space: BT709, depth: 8, full: true, codec: [...x264, '-pix_fmt', 'yuvj420p'], tags: ['bt709', 'bt709', 'bt709', 'pc'], kind: 'convert', want: (p) => p },
	{ name: 'sdr-601', signal: sdr, space: BT601, depth: 8, codec: [...x264, '-pix_fmt', 'yuv420p'], tags: ['bt709', 'bt709', 'smpte170m', 'tv'], kind: 'convert', want: (p) => p },
];

/** The middle of each patch, decoded through `vf` to RGB. */
function patches(file: string, vf: string): number[][] {
	const b = run(FFMPEG, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `${vf},scale=${COLS * 8}:${ROWS * 8}:flags=area,format=rgb24`, '-f', 'rawvideo', 'pipe:1']);
	return PATCHES.map((_, i) => {
		const x = (i % COLS) * 8 + 4;
		const y = Math.floor(i / COLS) * 8 + 4;
		const o = (y * COLS * 8 + x) * 3;
		return [b[o]!, b[o + 1]!, b[o + 2]!];
	});
}
const VIDEO = 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=rgb24';
const STILL = (range: string) => `scale=in_color_matrix=bt601:in_range=${range}:out_range=pc:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=rgb24`;

function assertColours(got: number[][], want: (p: number[]) => number[], slack: number, what: string) {
	PATCHES.forEach((p, i) => {
		const w = want(p);
		got[i]!.forEach((v, k) => assert.ok(Math.abs(v - w[k]!) <= slack, `${what}: ${p} should be ${w.map(Math.round)}, is ${got[i]}`));
		// Greys stay grey
		if (i < COLS) assert.ok(Math.max(...got[i]!) - Math.min(...got[i]!) <= 2, `${what}: grey ${p} is ${got[i]}`);
	});
}

describe('the colours viewers get (real ffmpeg)', { skip: !have && 'ffmpeg is not installed' }, () => {
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'aun-colour-'));
		for (const k of ['hlg', 'pq'] as const) writeFileSync(join(dir, `${k}.cube`), cubeText(k));
	});
	after(() => rmSync(dir, { recursive: true, force: true }));

	for (const c of CLIPS) {
		it(`${c.name}: every rung, the MP4, the stills are SDR BT.709 in the right colours`, { skip: c.codec.includes('libx265') && !encoders.includes('libx265') && 'no libx265' }, () => {
			const src = join(dir, c.file ?? `${c.name}.mp4`);
			const [prim, trc, matrix, range] = c.tags ?? [];
			const tagArgs = c.tags ? ['-vf', `setparams=color_primaries=${prim}:color_trc=${trc}:colorspace=${matrix}:range=${range}`, '-color_primaries', prim!, '-color_trc', trc!, '-colorspace', matrix!, '-color_range', range!] : [];
			const one = frame(PATCHES.map(c.signal), c.space, c.depth, c.full);
			run(FFMPEG, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', c.depth === 10 ? 'yuv420p10le' : c.full ? 'yuvj420p' : 'yuv420p', '-s', `${W}x${H}`, '-r', '25', '-i', '-', ...c.codec, ...tagArgs, src], Buffer.concat(Array(30).fill(one)));
			const colour = colourOf(probe(src).streams[0]);
			const plan = colourPlan(colour) as any;
			assert.equal(plan.kind, c.kind, JSON.stringify(colour));
			const cube = plan.kind === 'hlg' || plan.kind === 'pq' ? join(dir, `${plan.kind}.cube`) : undefined;
			const out = join(dir, `${c.name}-out`);
			const rungs = ladderFor({ width: W, height: H });
			for (const r of rungs) mkdirSync(join(out, r.name), { recursive: true });
			run(FFMPEG, ffmpegArgs({ input: src, out, rungs, hasAudio: false, fps: 25, plan, cube }));
			run(FFMPEG, mp4Args({ out, rung: '480p' }));
			const files = [...rungs.map((r) => join(out, r.name, 'index.m3u8')), join(out, 'video.mp4')];
			for (const f of files) {
				const j = probe(f, ['-show_frames', '-read_intervals', '%+#1']);
				const v = j.streams[0];
				assert.deepEqual([v.pix_fmt, v.color_range, v.color_space, v.color_transfer, v.color_primaries], ['yuv420p', 'tv', 'bt709', 'bt709', 'bt709'], f);
				assert.ok(![v, ...j.frames].some((x: unknown) => hasHdrData(x)), `${f} carries HDR metadata`);
				assertColours(patches(f, VIDEO), c.want, 4, `${c.name} ${f.slice(out.length)}`);
			}
			const stills = stillsArgs({ input: src, out, durationSeconds: 1.2, plan, cube });
			run(FFMPEG, stills.thumb);
			run(FFMPEG, stills.thumbSmall);
			assertColours(patches(join(out, 'thumb.jpg'), STILL('pc')), c.want, 6, `${c.name} thumb.jpg`);
			assertColours(patches(join(out, 'thumb_640.jpg'), STILL('pc')), c.want, 6, `${c.name} thumb_640.jpg`);
			if (encoders.includes('libwebp')) {
				run(FFMPEG, stills.preview);
				assert.ok(existsSync(join(out, 'preview.webp')));
			}
		});
	}

	it('never changes a pixel of an SDR BT.709 source', () => {
		const src = join(dir, 'plain.mp4');
		run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-t', '1', ...x264, '-pix_fmt', 'yuv420p', '-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', src]);
		const plan = colourPlan(colourOf(probe(src).streams[0])) as any;
		const rungs = ladderFor({ width: 1280, height: 720 });
		const graph = (args: string[]) => args[args.indexOf('-filter_complex') + 1]!;
		const now = graph(ffmpegArgs({ input: src, out: dir, rungs, hasAudio: false, fps: 25, plan }));
		// What the server encoded before it tagged anything
		const before = `[0:v]split=3[v0][v1][v2];${rungs.map((r, i) => `[v${i}]scale=w=${r.width}:h=${r.height}:flags=bicubic,format=yuv420p[v${i}o]`).join(';')}`;
		const md5 = (g: string) => String(run(FFMPEG, ['-v', 'error', '-i', src, '-filter_complex', g, ...rungs.flatMap((_, i) => ['-map', `[v${i}o]`]), '-f', 'framemd5', '-']));
		const sums = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').at(-1)!.trim());
		assert.equal(sums(md5(now)).length, 75);
		assert.deepEqual(sums(md5(now)), sums(md5(before)));
	});
});
