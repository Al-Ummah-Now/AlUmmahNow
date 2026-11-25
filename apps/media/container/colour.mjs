// Colour of what we publish (pure; unit-tested in apps/media/test/colour.test.ts and, with a real
// ffmpeg, colour-ffmpeg.test.ts).
//
// Every rendition, MP4, thumbnail and preview is plain SDR: BT.709, limited range, and says so in its
// tags. Whatever the source is. An HDR source (HLG from phones, PQ/HDR10, Dolby Vision over either) is
// tone mapped. Publishing it untouched in 8 bits with its HDR tags made a browser on an HDR screen
// light it up until whites clipped, and on an SDR screen show it dim and greenish.
//
// The importer (AlUmmahNowTools, ToolsCore/Import/Colour.cs) does exactly the same: the rules here are
// repeated there, and both tone map through the same two .cube files (cubeText below writes them;
// ENCODE_LADDER.colour in shared-types carries their SHA-256, and each repo checks its own).
//
// Why .cube files and ffmpeg's lut3d, not zscale + tonemap: lut3d is in every ffmpeg build (Homebrew's
// has no zscale), it gives the same pixels everywhere, and zscale applies HLG's system gamma to each
// channel on its own, which turned (214,126,44) into (204,108,9) in our measurements.

const M709 = [
	[0.4123907993, 0.3575843394, 0.1804807884],
	[0.2126390059, 0.7151686788, 0.0721923154],
	[0.0193308187, 0.1191947798, 0.9505321522],
];
/** Linear BT.2020 → linear BT.709 (D65 both). */
const BT2020_TO_709 = [
	[1.6604910021, -0.5876411388, -0.0728498633],
	[-0.1245504745, 1.1328998971, -0.0083494226],
	[-0.0181507634, -0.1005788980, 1.1187296614],
];
const LUMA_2020 = [0.2627, 0.678, 0.0593];
const LUMA_709 = M709[1];
/** HDR reference white (BT.2408), cd/m². */
const REFERENCE_WHITE = 203;

const dot = (m, v) => m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
const mul = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** HLG signal (0–1) → display light in cd/m² on the nominal 1000 cd/m² screen (BT.2100, system gamma 1.2 on luminance). */
export function hlgToNits(rgb) {
	const scene = rgb.map((v) => (v <= 0.5 ? (v * v) / 3 : (Math.exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12));
	const y = dot(LUMA_2020, scene);
	const gain = y > 0 ? 1000 * Math.pow(y, 0.2) : 0;
	return scene.map((e) => e * gain);
}

/** PQ signal (0–1) → cd/m² (SMPTE ST 2084). */
export function pqToNits(rgb) {
	return rgb.map((v) => {
		const p = Math.pow(v, 1 / 78.84375);
		return 10000 * Math.pow(Math.max(p - 0.8359375, 0) / (18.8515625 - 18.6875 * p), 1 / 0.1593017578125);
	});
}

/**
 * HLG luminance (cd/m²) → SDR signal 0–1: ITU-R BT.2446 method A, 1000 → 100 cd/m². Chosen as the
 * standard's curve: one YouTube SDR frame (2026-11-25) lies between it (a little brighter) and Apple's
 * HLG conversion (about as much darker), far from the other curves tried. One frame's average decides no more.
 */
function bt2446a(nits) {
	const y = Math.pow(Math.min(nits / 1000, 1), 1 / 2.4);
	const rho = 1 + 32 * Math.pow(0.1, 1 / 2.4);
	const p = Math.log(1 + (rho - 1) * y) / Math.log(rho);
	const c = p <= 0.7399 ? 1.077 * p : p < 0.9909 ? -1.151 * p * p + 2.7811 * p - 0.6302 : 0.5 * p + 0.5;
	const rhoSdr = 1 + 32 * Math.pow(0.01, 1 / 2.4);
	return (Math.pow(rhoSdr, c) - 1) / (rhoSdr - 1);
}

/** PQ luminance → SDR signal: exact below 0.75 of reference white's signal, then a soft shoulder (within 2/255 of Apple's). */
function pqCurve(nits) {
	const v = Math.pow(nits / REFERENCE_WHITE, 1 / 2.4);
	const knee = 0.75;
	return v <= knee ? v : knee + (1 - knee) * (1 - Math.exp(-(v - knee) / (1 - knee)));
}

// Oklab (Björn Ottosson): hue-true chroma changes
const OK1 = [
	[0.4122214708, 0.5363325363, 0.0514459929],
	[0.2119034982, 0.6806995451, 0.1073969566],
	[0.0883024619, 0.2817188376, 0.6299787005],
];
const OK2 = [
	[0.2104542553, 0.793617785, -0.0040720468],
	[1.9779984951, -2.428592205, 0.4505937099],
	[0.0259040371, 0.7827717662, -0.808675766],
];
const toOklab = (rgb) => mul(OK2, mul(OK1, rgb).map((v) => Math.cbrt(v)));
function fromOklab(lab) {
	const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
	const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
	const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
	return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Into the BT.709 gamut by lowering chroma only (hue and lightness kept). */
function intoGamut(rgb) {
	if (inGamut(rgb)) return rgb;
	const lab = toOklab(rgb);
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (inGamut(fromOklab([lab[0], lab[1] * mid, lab[2] * mid]))) lo = mid;
		else hi = mid;
	}
	return fromOklab([lab[0], lab[1] * lo, lab[2] * lo]);
}

/**
 * One BT.2020 HDR colour (signal 0–1) as SDR BT.709 (signal 0–1, gamma 2.4).
 * The curve runs on luminance, so hue stays; HLG gains a tenth of chroma, which both YouTube's and
 * Apple's conversions do (a darker picture looks less colourful).
 * @param {'hlg' | 'pq'} kind
 * @param {number[]} signal
 */
export function toneMap(kind, signal) {
	const nits = kind === 'hlg' ? hlgToNits(signal) : pqToNits(signal);
	const [r, g, b] = signal;
	const y = dot(LUMA_2020, nits);
	if (!(y > 0)) return [0, 0, 0];
	const v = kind === 'hlg' ? bt2446a(y) : pqCurve(y);
	const target = Math.pow(v, 2.4);
	// A neutral stays exactly neutral
	if (r === g && g === b) return [v, v, v];
	let rgb = mul(BT2020_TO_709, nits.map((n) => (n * target) / y));
	if (kind === 'hlg') {
		const lab = toOklab(rgb);
		const vivid = fromOklab([lab[0], lab[1] * 1.1, lab[2] * 1.1]);
		const luma = dot(LUMA_709, vivid);
		rgb = luma > 0 ? vivid.map((c) => (c * target) / luma) : rgb;
	}
	return intoGamut(rgb).map((c) => Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.4));
}

export const CUBE_SIZE = 33;

/** The .cube file ffmpeg's lut3d reads (red fastest). The same bytes on every machine: tests pin the SHA-256. */
export function cubeText(kind, size = CUBE_SIZE) {
	const lines = [`TITLE "${kind === 'hlg' ? 'HLG' : 'PQ'} BT.2020 to SDR BT.709"`, `LUT_3D_SIZE ${size}`];
	const at = (i) => i / (size - 1);
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) lines.push(toneMap(kind, [at(r), at(g), at(b)]).map((v) => v.toFixed(5)).join(' '));
		}
	}
	return `${lines.join('\n')}\n`;
}

// ---- What a source is, and the filters that make it SDR BT.709 --------------------------------

/** YUV matrices ffmpeg's colorspace filter reads (anything else known is refused, unknown is guessed). */
const MATRICES = ['bt709', 'fcc', 'bt470bg', 'smpte170m', 'smpte240m', 'bt2020nc', 'ycgco'];
const PRIMARIES = ['bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'film', 'bt2020', 'smpte428', 'smpte431', 'smpte432', 'ebu3213'];
/** Wider than BT.709: their colours move when the primaries are ignored. */
export const WIDE = ['bt2020', 'smpte431', 'smpte432', 'smpte428', 'film'];
/** An untagged standard-definition file of these is BT.601 (cameras, DVDs); every other untagged file is BT.709, as browsers show it. */
const BT601_CODECS = ['mpeg1video', 'mpeg2video', 'mpeg4', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'h263', 'h263p', 'flv1', 'wmv1', 'wmv2', 'wmv3', 'vc1', 'dvvideo', 'mjpeg', 'vp6', 'vp6f', 'rv30', 'rv40', 'svq1', 'svq3', 'cinepak', 'indeo5', 'theora'];
const known = (v) => (typeof v === 'string' && v !== 'unknown' && v !== 'unspecified' && v !== 'reserved' ? v : null);

/**
 * ffprobe's video stream as its colour facts.
 * @param {any} v a stream of `ffprobe -show_streams`
 * @returns {Colour}
 */
export function colourOf(v) {
	const dovi = (v.side_data_list || []).find((d) => d.dv_profile !== undefined);
	return {
		matrix: known(v.color_space),
		primaries: known(v.color_primaries),
		transfer: known(v.color_transfer),
		full: v.color_range === 'pc' || /^yuvj/.test(v.pix_fmt || ''),
		rgb: /^(rgb|bgr|gbr|argb|abgr|pal8|0rgb|0bgr|xv30|x2rgb|x2bgr)/.test(v.pix_fmt || ''),
		codec: v.codec_name || '',
		width: Number(v.width) || 0,
		height: Number(v.height) || 0,
		...(dovi ? { dolbyVision: { profile: Number(dovi.dv_profile), compatible: Number(dovi.dv_bl_signal_compatibility_id) || 0 } } : {}),
	};
}

/** Tagged as HDR, or in an HDR container's colours: never published. */
export function isHdrColour(c) {
	return c.transfer === 'arib-std-b67' || c.transfer === 'smpte2084' || (c.matrix || '').startsWith('bt2020') || c.primaries === 'bt2020' || !!c.dolbyVision;
}

/** An ffprobe stream or frame that carries HDR metadata (mastering display, light level, HDR10+, Dolby Vision). */
export const hasHdrData = (x) => (x?.side_data_list || []).some((d) => /mastering display|content light|hdr|dovi|dolby/i.test(String(d.side_data_type ?? '')));

/** @typedef {{ matrix: string | null, primaries: string | null, transfer: string | null, full: boolean, rgb: boolean, codec: string, width: number, height: number, dolbyVision?: { profile: number, compatible: number } }} Colour */
/** @typedef {{ kind: 'as_is' | 'convert' | 'hlg' | 'pq', matrix: string, primaries: string, full: boolean, rgb: boolean }} SdrPlan */

/**
 * How a source becomes SDR BT.709.
 * - `as_is`: it already is (or is untagged and shown as such): its pixels are not touched, only tagged
 * - `convert`: SDR in another matrix, range or gamut
 * - `hlg` / `pq`: HDR, tone mapped
 * - `unsupported`: nothing we have shows it right (Dolby Vision without a base layer a plain player can
 *   show, i.e. profile 5; ICtCp). The job fails with `reason` rather than publishing green and purple.
 * @param {Colour} c
 * @returns {SdrPlan | { kind: 'unsupported', reason: 'dolby_vision_5' | 'colour_unsupported' }}
 */
export function colourPlan(c) {
	const dv = c.dolbyVision;
	if (dv && dv.compatible === 0) return { kind: 'unsupported', reason: 'dolby_vision_5' };
	const hdr = c.transfer === 'arib-std-b67' ? 'hlg' : c.transfer === 'smpte2084' ? 'pq' : !c.transfer && dv ? (dv.compatible === 4 ? 'hlg' : dv.compatible === 1 || dv.compatible === 6 ? 'pq' : null) : null;
	const matrix = c.matrix === 'bt470m' ? 'fcc' : c.matrix;
	if (!c.rgb && matrix && matrix !== 'gbr' && !MATRICES.includes(matrix) && matrix !== 'bt2020c') return { kind: 'unsupported', reason: 'colour_unsupported' };
	if (hdr) return { kind: hdr, matrix: matrix === 'bt709' ? 'bt709' : 'bt2020', primaries: 'bt2020', full: c.full, rgb: c.rgb };
	const sd = Math.max(c.width, c.height) < 1280 && Math.min(c.width, c.height) <= 576;
	const m = matrix === 'bt2020c' ? 'bt2020nc' : !matrix || matrix === 'gbr' ? (sd && BT601_CODECS.includes(c.codec) ? 'smpte170m' : 'bt709') : matrix;
	const p = c.primaries && PRIMARIES.includes(c.primaries) ? c.primaries : m === 'bt2020nc' ? 'bt2020' : 'bt709';
	const touch = c.rgb || c.full || m !== 'bt709' || WIDE.includes(p);
	return { kind: touch ? 'convert' : 'as_is', matrix: m, primaries: p, full: c.full, rgb: c.rgb };
}

/** 4:2:0 and the colorspace filter need even sizes. */
const EVEN = 'w=trunc(iw/2)*2:h=trunc(ih/2)*2';
const FINE = 'flags=bicubic+accurate_rnd+full_chroma_int';
/** Every frame says what it is; the encoder writes it (H.264 VUI) and the muxer too (colr). */
export const SDR_TAGS = 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
/**
 * No HDR metadata on an SDR rung: mastering display, light level and HDR10+, also from a source that is
 * SDR and carries it all the same. By name, so closed captions stay (names every ffmpeg in use knows;
 * H.264 encoders write no Dolby Vision).
 */
export const DROP_HDR_DATA = ['MASTERING_DISPLAY_METADATA', 'CONTENT_LIGHT_LEVEL', 'DYNAMIC_HDR_PLUS'].map((t) => `sidedata=mode=delete:type=${t}`).join(',');
/** The last filters of every rung. */
export const SDR_END = `${DROP_HDR_DATA},${SDR_TAGS}`;

/** A .cube path that needs no escaping inside a filter graph (the importer runs ffmpeg in the file's folder and passes its name). */
export function cubePath(p) {
	if (!/^[A-Za-z0-9_./-]+$/.test(p)) throw new Error(`cube path needs escaping: ${p}`);
	return p;
}

/**
 * Filters (joined with commas) that turn the decoded source into SDR BT.709 limited 4:2:0, or '' when it
 * already is. HDR is scaled to `size` first, so a 4K source costs no more than its top rung.
 * @param {SdrPlan} plan
 * @param {{ cube?: string, size?: { width: number | string, height: number | string } }} o `cube`: the plan's .cube file
 */
export function toSdrFilters(plan, o = {}) {
	if (plan.kind === 'hlg' || plan.kind === 'pq') {
		if (!o.cube) throw new Error('no cube for an HDR source');
		const size = o.size ? `w=${o.size.width}:h=${o.size.height}:` : `${EVEN}:`;
		const from = plan.rgb ? '' : `:in_color_matrix=${plan.matrix}:in_range=${plan.full ? 'pc' : 'tv'}`;
		return [`scale=${size}${FINE}${from}`, 'format=gbrp16le', `lut3d=file=${cubePath(o.cube)}:interp=tetrahedral`, `scale=${FINE}:out_color_matrix=bt709:out_range=tv`, 'format=yuv420p', SDR_TAGS].join(',');
	}
	if (plan.kind === 'convert') {
		const colorspace = (from, full) => `colorspace=ispace=${from}:iprimaries=${plan.primaries}:itrc=bt709:irange=${full ? 'pc' : 'tv'}:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p`;
		if (plan.rgb && WIDE.includes(plan.primaries)) return [`scale=${EVEN}:${FINE}:out_color_matrix=bt709:out_range=tv`, 'format=yuv444p', colorspace('bt709', false), SDR_TAGS].join(',');
		if (plan.rgb) return [`scale=${EVEN}:${FINE}:out_color_matrix=bt709:out_range=tv`, 'format=yuv420p', SDR_TAGS].join(',');
		// The colorspace filter takes even sizes only (this scale is a no-op for them)
		return [`scale=${EVEN}:${FINE}`, colorspace(plan.matrix, plan.full), SDR_TAGS].join(',');
	}
	return '';
}

/** A still from SDR BT.709: JPEG and WebP viewers read BT.601, so without this greens and skin shift. */
export const toJpegFilters = `scale=${FINE}:in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc,format=yuvj420p`;
export const toWebpFilters = `scale=${FINE}:in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=tv,format=yuv420p`;
