import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ENCODE_LADDER } from '@al-ummah/shared-types';
import { colourOf, colourPlan, cubePath, cubeText, hasHdrData, hlgToNits, pqToNits, SDR_END, SDR_TAGS, toneMap, toSdrFilters } from '../container/colour.mjs';
import { renditionColour } from '../container/prebuilt.mjs';

const stream = (o: Record<string, unknown>) => ({ codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, ...o });
const tags = (matrix: string, primaries: string, transfer: string, range = 'tv') => ({ color_space: matrix, color_primaries: primaries, color_transfer: transfer, color_range: range });
const planOf = (o: Record<string, unknown>) => colourPlan(colourOf(stream(o))) as any;
const HLG = { codec_name: 'hevc', pix_fmt: 'yuv420p10le', ...tags('bt2020nc', 'bt2020', 'arib-std-b67') };
const PQ = { codec_name: 'hevc', pix_fmt: 'yuv420p10le', ...tags('bt2020nc', 'bt2020', 'smpte2084') };
const dovi = (profile: number, compatible: number) => ({ side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: profile, dv_bl_signal_compatibility_id: compatible }] });

describe('colourPlan', () => {
	it('leaves SDR BT.709, tagged or not, alone', () => {
		assert.equal(planOf(tags('bt709', 'bt709', 'bt709')).kind, 'as_is');
		assert.equal(planOf({}).kind, 'as_is');
		assert.equal(planOf({ color_space: 'unknown', color_primaries: 'reserved', color_range: 'tv' }).kind, 'as_is');
		assert.equal(planOf({ codec_name: 'vp9', width: 640, height: 360 }).kind, 'as_is', 'untagged small WebM is BT.709, as browsers show it');
		assert.equal(planOf({ ...tags('bt709', 'bt709', 'iec61966-2-1') }).kind, 'as_is');
		assert.equal(planOf({ ...tags('bt709', 'smpte170m', 'bt709') }).kind, 'as_is');
	});
	it('tone maps HLG and PQ in any codec and depth', () => {
		for (const o of [HLG, { ...HLG, codec_name: 'vp9' }, { ...HLG, codec_name: 'av1' }, { ...HLG, pix_fmt: 'yuv420p', codec_name: 'h264' }]) assert.equal(planOf(o).kind, 'hlg');
		assert.equal(planOf(PQ).kind, 'pq');
		assert.equal(planOf({ ...HLG, color_space: 'unknown', color_primaries: 'unknown' }).kind, 'hlg');
		assert.equal(planOf({ ...HLG, color_range: 'pc' }).full, true);
	});
	it('reads Dolby Vision by its base layer and refuses a profile without one (profile 5)', () => {
		assert.equal(planOf({ ...HLG, ...dovi(8, 4) }).kind, 'hlg');
		assert.equal(planOf({ ...PQ, ...dovi(8, 1) }).kind, 'pq');
		assert.equal(planOf({ codec_name: 'hevc', ...dovi(8, 4) }).kind, 'hlg', 'untagged base layer');
		assert.equal(planOf({ ...tags('bt709', 'bt709', 'bt709'), ...dovi(8, 2) }).kind, 'as_is', 'SDR base layer');
		assert.deepEqual(planOf({ codec_name: 'hevc', ...dovi(5, 0) }), { kind: 'unsupported', reason: 'dolby_vision_5' });
		assert.deepEqual(planOf({ ...PQ, color_space: 'ictcp' }), { kind: 'unsupported', reason: 'colour_unsupported' });
	});
	it('converts SDR in another matrix, range or gamut', () => {
		assert.deepEqual(planOf(tags('smpte170m', 'smpte170m', 'smpte170m')), { kind: 'convert', matrix: 'smpte170m', primaries: 'smpte170m', full: false, rgb: false });
		assert.deepEqual(planOf({ pix_fmt: 'yuvj420p', ...tags('bt709', 'bt709', 'bt709', 'pc') }), { kind: 'convert', matrix: 'bt709', primaries: 'bt709', full: true, rgb: false });
		assert.equal(planOf({ pix_fmt: 'yuvj420p' }).kind, 'convert', 'yuvj says full range');
		assert.equal(planOf({ pix_fmt: 'yuv420p10le', ...tags('bt2020nc', 'bt2020', 'bt2020-10') }).primaries, 'bt2020');
		assert.equal(planOf({ pix_fmt: 'yuv420p10le', ...tags('bt709', 'smpte432', 'bt709') }).kind, 'convert', 'Display P3');
		assert.equal(planOf({ pix_fmt: 'gbrp' }).rgb, true);
		assert.equal(planOf({ codec_name: 'mpeg4', width: 720, height: 480 }).matrix, 'smpte170m', 'an untagged old camera file is BT.601');
		assert.equal(planOf({ codec_name: 'mpeg4', width: 1280, height: 720 }).kind, 'as_is');
		assert.equal(planOf({ codec_name: 'mpeg2video', width: 576, height: 720, }).kind, 'convert', 'portrait SD too');
	});
});

describe('tone mapping', () => {
	it('keeps a neutral exactly neutral, black black, and never clips below the peak', () => {
		for (const kind of ['hlg', 'pq'] as const) {
			let last = -1;
			for (let i = 0; i <= 100; i++) {
				const [r, g, b] = toneMap(kind, [i / 100, i / 100, i / 100]);
				assert.ok(r === g && g === b);
				assert.ok(r >= last && r <= 1, `${kind} ${i}`);
				// White clothes keep their folds: every step up to 800 cd/m² still gets brighter
				const nits = (kind === 'hlg' ? hlgToNits : pqToNits)([i / 100, i / 100, i / 100])[0];
				if (i > 0 && nits > 0.01 && nits < 800) assert.ok(r > last, `${kind} ${i} is as bright as the step below`);
				last = r;
			}
			assert.deepEqual(toneMap(kind, [0, 0, 0]), [0, 0, 0]);
		}
	});
	it('puts HLG where BT.2446 A does and PQ where Apple does', () => {
		const code = (kind: 'hlg' | 'pq', v: number) => Math.round(toneMap(kind, [v, v, v])[0] * 255);
		assert.ok(Math.abs(code('hlg', 0.75) - 175) <= 1, `HLG reference white ${code('hlg', 0.75)}`);
		assert.ok(Math.abs(code('hlg', 1) - 255) <= 1);
		assert.ok(Math.abs(code('pq', 0.5807) - 232) <= 1, `PQ reference white ${code('pq', 0.5807)}`);
		assert.ok(code('pq', 1) === 255);
	});
	it('keeps the hue of skin and wood (a BT.709 colour carried in PQ comes back as itself)', () => {
		const M = [[0.6274039, 0.3292830, 0.0433131], [0.0690973, 0.9195404, 0.0113623], [0.0163914, 0.0880133, 0.8955953]];
		const pq = (n: number) => {
			const y = Math.pow(n / 10000, 0.1593017578125);
			return Math.pow((0.8359375 + 18.8515625 * y) / (1 + 18.6875 * y), 78.84375);
		};
		for (const c of [[115, 82, 68], [198, 134, 96], [141, 85, 54], [180, 130, 70], [98, 122, 157]]) {
			const lin = c.map((v) => Math.pow(v / 255, 2.4) * 203);
			const back = toneMap('pq', M.map((m) => pq(m[0] * lin[0] + m[1] * lin[1] + m[2] * lin[2]))).map((v: number) => v * 255);
			back.forEach((v: number, i: number) => assert.ok(Math.abs(v - c[i]) < 2.5, `${c} came back ${back.map(Math.round)}`));
		}
	});
	it('writes the same .cube bytes everywhere; ENCODE_LADDER.colour carries their SHA-256 for the importer', () => {
		for (const kind of ['hlg', 'pq'] as const) assert.equal(createHash('sha256').update(cubeText(kind)).digest('hex'), ENCODE_LADDER.colour.cubes[kind], kind);
		assert.equal(ENCODE_LADDER.colour.output, 'bt709');
		assert.equal(ENCODE_LADDER.colour.range, 'tv');
	});
});

describe('toSdrFilters', () => {
	it('adds nothing for a source that is BT.709 already', () => assert.equal(toSdrFilters(planOf({})), ''));
	it('tone maps through the cube, at the top rung, with every tag and no HDR metadata', () => {
		const f = toSdrFilters(planOf(HLG), { cube: 'hlg.cube', size: { width: 1280, height: 720 } });
		assert.match(f, /^scale=w=1280:h=720:[^,]*in_color_matrix=bt2020:in_range=tv,format=gbrp16le,lut3d=file=hlg\.cube:interp=tetrahedral,scale=[^,]*out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=/);
		assert.ok(f.endsWith(SDR_TAGS));
		for (const t of ['MASTERING_DISPLAY_METADATA', 'CONTENT_LIGHT_LEVEL', 'DYNAMIC_HDR_PLUS']) assert.ok(SDR_END.includes(t));
		assert.ok(SDR_END.endsWith(SDR_TAGS));
	});
	it('never takes an HDR source without its cube, nor a path that would need escaping', () => {
		assert.throws(() => toSdrFilters(planOf(PQ)));
		assert.throws(() => cubePath("C:\\a'b.cube"));
	});
	it('says the source matrix, primaries and range when it converts', () => {
		assert.match(toSdrFilters(planOf(tags('bt470bg', 'bt470bg', 'bt470bg', 'pc'))), /^scale=w=trunc\(iw\/2\)\*2:h=trunc\(ih\/2\)\*2:[^,]*,colorspace=ispace=bt470bg:iprimaries=bt470bg:itrc=bt709:irange=pc:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p,setparams/);
	});
});

describe('renditionColour (what a computer encoded)', () => {
	const c = (o: Record<string, unknown>) => ({ ...colourOf(stream(o)), hdrData: false });
	const asIs = planOf({});
	const hlg = planOf(HLG);
	it('refuses HDR tags or metadata on a rung, whatever the source', () => {
		for (const plan of [asIs, hlg, undefined]) {
			assert.equal(renditionColour(c(tags('bt2020nc', 'bt2020', 'arib-std-b67')), plan), 'hdr');
			assert.equal(renditionColour(c(tags('bt2020nc', 'bt2020', 'smpte2084')), plan), 'hdr');
			assert.equal(renditionColour(c(tags('bt2020nc', 'bt2020', 'bt2020-10')), plan), 'hdr');
			assert.equal(renditionColour(c({ ...tags('bt709', 'bt709', 'arib-std-b67') }), plan), 'hdr');
			assert.equal(renditionColour({ ...c(tags('bt709', 'bt709', 'bt709')), hdrData: true }, plan), 'hdr');
		}
	});
	it('takes tagged SDR BT.709 for any source, and an untagged rung only for a BT.709 source', () => {
		for (const plan of [asIs, hlg]) assert.equal(renditionColour(c(tags('bt709', 'bt709', 'bt709')), plan), null);
		assert.equal(renditionColour(c({}), asIs), null);
		assert.equal(renditionColour(undefined, undefined), null);
		assert.equal(renditionColour(c({}), hlg), 'colour');
		assert.equal(renditionColour(c({}), planOf(tags('smpte170m', 'smpte170m', 'smpte170m'))), 'colour');
		assert.equal(renditionColour(c(tags('smpte170m', 'smpte170m', 'smpte170m')), asIs), 'colour');
		assert.equal(renditionColour(c(tags('bt709', 'bt709', 'bt709', 'pc')), asIs), 'colour');
		assert.equal(renditionColour(c(tags('bt709', 'smpte432', 'bt709')), asIs), 'colour');
	});
	it('sees HDR metadata in a stream or a frame', () => {
		assert.ok(hasHdrData({ side_data_list: [{ side_data_type: 'Mastering display metadata' }] }));
		assert.ok(hasHdrData({ side_data_list: [{ side_data_type: 'Content light level metadata' }] }));
		assert.ok(hasHdrData(stream(dovi(8, 4))));
		assert.ok(!hasHdrData({ side_data_list: [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }] }));
		assert.ok(!hasHdrData({}));
	});
});
