// Renditions encoded on the creator's computer (D11: desktop Studio's optional pre-encode).
//
// The server never trusts them: the container checks every rung against the ladder it would have
// encoded itself for this source (ladder.mjs), checks each playlist and file, decodes every segment,
// checks the frames and audio match the source, and only then uploads them. Anything off → the normal server encode runs instead, in the same attempt.
// Master and media playlists are always written here, never taken from the upload.
//
// Pure (unit-tested in apps/media/test/prebuilt.test.ts); server.mjs does the I/O and ffprobe.

import { isHdrColour, WIDE } from './colour.mjs';
import { GOP_SECONDS, SEGMENT_SECONDS, playlistFiles } from './ladder.mjs';

/** A segment may run this much past SEGMENT_SECONDS (keyframes land on GOP boundaries). */
export const SEGMENT_SLACK_SECONDS = 1;
/** A rung's peak segment bitrate may reach this multiple of its maxrate (VBV allows short bursts). */
export const PEAK_FACTOR = 1.5;
/** Rendition and source durations may differ by this much (or 1%, whichever is larger). */
export const DURATION_SLACK_SECONDS = 1;
/** Segments decoded end to end per rung: first, middle and last. */

/** The only tags an uploaded media playlist may carry; anything else is rejected, never passed on. */
const ALLOWED_TAGS = new Set(['#EXTM3U', '#EXT-X-VERSION', '#EXT-X-TARGETDURATION', '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-PLAYLIST-TYPE', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MAP', '#EXTINF', '#EXT-X-ENDLIST']);

/**
 * Parse a media playlist we can accept: VOD, fMP4 with one EXT-X-MAP, EXTINF per segment, and no
 * tag outside ALLOWED_TAGS. The upload is only read: what gets published is mediaPlaylist(), written here.
 * @param {string} text
 * @returns {{ ok: true, init: string, segments: { file: string, seconds: number }[], targetDuration: number } | { ok: false, reason: string }}
 */
export function parseMediaPlaylist(text) {
	const files = playlistFiles(text);
	if (!files) return { ok: false, reason: 'playlist_names' };
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines[0] !== '#EXTM3U') return { ok: false, reason: 'playlist_header' };
	if (lines.some((l) => l.startsWith('#') && !ALLOWED_TAGS.has(l.split(':')[0]))) return { ok: false, reason: 'playlist_features' };
	if (lines.filter((l) => l === '#EXT-X-ENDLIST').length !== 1 || lines.at(-1) !== '#EXT-X-ENDLIST') return { ok: false, reason: 'playlist_not_vod' };
	const type = lines.find((l) => l.startsWith('#EXT-X-PLAYLIST-TYPE:'));
	if (type && type !== '#EXT-X-PLAYLIST-TYPE:VOD') return { ok: false, reason: 'playlist_not_vod' };
	const maps = lines.filter((l) => l.startsWith('#EXT-X-MAP:'));
	if (maps.length !== 1) return { ok: false, reason: 'playlist_init' };
	const init = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(maps[0])?.[1];
	const target = Number(/^#EXT-X-TARGETDURATION:(\d+)$/.exec(lines.find((l) => l.startsWith('#EXT-X-TARGETDURATION:')) || '')?.[1]);
	const segments = [];
	let pending = null;
	for (const l of lines) {
		if (l.startsWith('#EXTINF:')) {
			const inf = /^#EXTINF:([0-9]+(?:\.[0-9]+)?),?$/.exec(l);
			if (!inf || pending !== null) return { ok: false, reason: 'playlist_extinf' };
			pending = Number(inf[1]);
			continue;
		}
		if (l.startsWith('#')) continue;
		if (pending === null || !Number.isFinite(pending) || pending <= 0) return { ok: false, reason: 'playlist_extinf' };
		segments.push({ file: l, seconds: pending });
		pending = null;
	}
	if (pending !== null) return { ok: false, reason: 'playlist_extinf' };
	if (!init || segments.length === 0) return { ok: false, reason: 'playlist_empty' };
	if (new Set(segments.map((s) => s.file)).size !== segments.length || segments.some((s) => s.file === init)) return { ok: false, reason: 'playlist_duplicates' };
	return { ok: true, init, segments, targetDuration: Number.isFinite(target) ? target : 0 };
}

/**
 * The media playlist we publish for a verified rung, written from the parsed upload (the uploaded
 * text itself is never published).
 * @param {{ init: string, segments: { file: string, seconds: number }[] }} pl
 */
export function mediaPlaylist(pl) {
	const target = Math.ceil(Math.max(...pl.segments.map((s) => s.seconds)));
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS', `#EXT-X-MAP:URI="${pl.init}"`];
	for (const s of pl.segments) lines.push(`#EXTINF:${s.seconds.toFixed(6)},`, s.file);
	lines.push('#EXT-X-ENDLIST');
	return `${lines.join('\n')}\n`;
}

// ---- Same content as the source -------------------------------------------------------------
//
// Well-formed renditions are not enough: they must show and sound like the source the server
// probed (review and stills also run on the published rung, server.mjs). Frames are compared as
// tiny grey thumbnails at evenly spaced times, audio as a loudness envelope.

/** Frames compared per rung: one at a random instant inside each of this many equal stretches. */
export const MATCH_FRAMES = 24;
/** Thumbnail size the frames are scaled to before comparing (grey, 1 byte per pixel). */
export const MATCH_FRAME_SIZE = { width: 32, height: 18 };
/**
 * Filters of one compared frame. `sdr` (the source's toSdrFilters) runs at full size: averaging HLG or PQ
 * signals into thumbnails first gives another picture than the rung's. `from` skips to an instant before
 * any of it, for a decode from the start.
 * @param {{ sdr?: string, from?: number }} [o]
 */
export function matchFilters({ sdr = '', from } = {}) {
	const { width, height } = MATCH_FRAME_SIZE;
	return [from === undefined ? '' : `trim=start=${from}`, sdr, `scale=${width}:${height}:flags=area`, 'format=gray'].filter(Boolean).join(',');
}

/** Mean absolute pixel difference (0–255) a re-encode stays under; a different picture does not. */
export const FRAME_DIFF_MEDIAN_MAX = 12;
export const FRAME_DIFF_MAX = 48;
/** Audio envelope: windows of this many ms, and the correlation a re-encode keeps. */
export const ENVELOPE_WINDOW_MS = 100;
export const ENVELOPE_RATE = 2000;
export const ENVELOPE_CORRELATION_MIN = 0.8;

/**
 * Times (s) frames are compared at: stratified random, one unpredictable instant in each of `n`
 * equal stretches, so no part of the video goes unchecked and no gap can be planned around.
 * @param {number} durationSeconds
 * @param {number} [n]
 * @param {() => number} [random] uniform in [0, 1), injectable for tests
 */
export function matchTimes(durationSeconds, n = MATCH_FRAMES, random = Math.random) {
	if (!(durationSeconds > 0)) return [];
	const stretch = durationSeconds / n;
	// Stay clear of the last half second: a rendition may end a few frames before the source
	const last = durationSeconds > 1 ? durationSeconds - 0.5 : durationSeconds / 2;
	return Array.from({ length: n }, (_, i) => Number(Math.min(last, (i + 0.05 + random() * 0.9) * stretch).toFixed(3))).filter((t) => t >= 0);
}

/** Mean absolute difference of two equal-size grey frames (Uint8Array / Buffer). */
export function frameDistance(a, b) {
	if (!a || !b || a.length !== b.length || a.length === 0) return 255;
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length;
}

/** RMS per window from signed 16-bit little-endian mono PCM. */
export function envelope(pcm, rate = ENVELOPE_RATE, windowMs = ENVELOPE_WINDOW_MS) {
	const per = Math.max(1, Math.round((rate * windowMs) / 1000));
	const samples = Math.floor(pcm.length / 2);
	const out = [];
	for (let start = 0; start + per <= samples; start += per) {
		let sq = 0;
		for (let i = start; i < start + per; i++) {
			const v = pcm.readInt16LE(i * 2) / 32768;
			sq += v * v;
		}
		out.push(Math.sqrt(sq / per));
	}
	return out;
}

/** Pearson correlation over the common length; null when either side is (near) constant. */
export function correlation(a, b) {
	const n = Math.min(a.length, b.length);
	if (n < 2) return null;
	let ma = 0;
	let mb = 0;
	for (let i = 0; i < n; i++) {
		ma += a[i];
		mb += b[i];
	}
	ma /= n;
	mb /= n;
	let cov = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < n; i++) {
		cov += (a[i] - ma) * (b[i] - mb);
		va += (a[i] - ma) ** 2;
		vb += (b[i] - mb) ** 2;
	}
	if (va < 1e-9 || vb < 1e-9) return null;
	return cov / Math.sqrt(va * vb);
}

/** Envelope with less relative variation than this is steady sound: levels are compared, not shape. */
export const FLAT_CV = 0.05;
/** Encoder delay tolerated when lining up envelopes, in windows each way. */
export const ENVELOPE_MAX_LAG = 3;

function stats(x) {
	const mean = x.reduce((n, v) => n + v, 0) / Math.max(1, x.length);
	const std = Math.sqrt(x.reduce((n, v) => n + (v - mean) ** 2, 0) / Math.max(1, x.length));
	return { mean, std };
}

/** The best correlation with the rendition shifted up to `maxLag` windows either way. */
export function bestCorrelation(a, b, maxLag = ENVELOPE_MAX_LAG) {
	let best = null;
	for (let lag = -maxLag; lag <= maxLag; lag++) {
		const r = lag >= 0 ? correlation(a.slice(lag), b) : correlation(a, b.slice(-lag));
		if (r !== null && (best === null || r > best)) best = r;
	}
	return best;
}

/**
 * Do the renditions carry the source's content?
 * @param {{ frameDistances: number[], sourceEnvelope?: number[] | null, renditionEnvelope?: number[] | null }} o
 * @returns {{ ok: true } | { ok: false, reason: 'content_mismatch' | 'audio_mismatch' }}
 */
export function contentMatches(o) {
	const d = [...o.frameDistances].sort((x, y) => x - y);
	if (d.length === 0) return { ok: false, reason: 'content_mismatch' };
	const median = d[Math.floor((d.length - 1) / 2)];
	if (median > FRAME_DIFF_MEDIAN_MAX || d[d.length - 1] > FRAME_DIFF_MAX) return { ok: false, reason: 'content_mismatch' };
	if (o.sourceEnvelope) {
		const src = o.sourceEnvelope;
		const ren = o.renditionEnvelope ?? [];
		if (Math.abs(src.length - ren.length) > Math.max(10, src.length * 0.02)) return { ok: false, reason: 'audio_mismatch' };
		const a = stats(src);
		const b = stats(ren);
		if (a.std <= FLAT_CV * a.mean + 1e-4) {
			// Steady sound (a tone, hum, music bed) or silence: the shape says nothing, the level must match
			if (b.std > Math.max(FLAT_CV * 4 * b.mean, 0.01) || Math.abs(a.mean - b.mean) > Math.max(0.02, a.mean * 0.15)) return { ok: false, reason: 'audio_mismatch' };
		} else {
			const r = bestCorrelation(src, ren);
			if (r === null || r < ENVELOPE_CORRELATION_MIN) return { ok: false, reason: 'audio_mismatch' };
		}
	}
	return { ok: true };
}

/**
 * What is wrong with an uploaded rung's colour, or null. Published rungs are SDR BT.709 and never carry
 * HDR tags (importers have encoded an HDR source to 8 bits with its tags kept, which browsers on HDR
 * screens blow out). A rung without tags is taken only for a source that is BT.709 itself.
 * @param {(import('./colour.mjs').Colour & { hdrData?: boolean }) | undefined} c
 * @param {import('./colour.mjs').SdrPlan | undefined} plan of the source
 * @returns {'hdr' | 'colour' | null}
 */
export function renditionColour(c, plan) {
	if (c && (c.hdrData || isHdrColour(c))) return 'hdr';
	const untouched = !plan || plan.kind === 'as_is';
	if (!c || !c.matrix) return c?.full || (c?.primaries && WIDE.includes(c.primaries)) || !untouched ? 'colour' : null;
	if (c.matrix !== 'bt709' || c.full || (c.primaries && WIDE.includes(c.primaries))) return 'colour';
	return null;
}

/**
 * Check what the creator uploaded against the ladder for this source.
 * @param {{
 *   ladder: { name: string, width: number, height: number, maxrate: number, audio: number }[],
 *   source: { durationSeconds: number, hasAudio: boolean, plan?: import('./colour.mjs').SdrPlan },
 *   rungs: {
 *     name: string,
 *     playlist: ReturnType<typeof parseMediaPlaylist>,
 *     sizes: Record<string, number>,
 *     probe: { video?: { codec: string, width: number, height: number, pixFmt: string, profile?: string, level?: number, keyframeSeconds?: number[], colour?: import('./colour.mjs').Colour & { hdrData?: boolean } }, audio?: { codec: string, channels: number } } | null,
 *   }[],
 * }} o
 * @returns {{ ok: true } | { ok: false, reason: string, rung?: string }}
 */
export function verifyRenditions(o) {
	const expected = o.ladder.map((r) => r.name).sort();
	const got = o.rungs.map((r) => r.name).sort();
	if (expected.join(',') !== got.join(',')) return { ok: false, reason: 'rungs_mismatch' };
	const slack = Math.max(DURATION_SLACK_SECONDS, o.source.durationSeconds * 0.01);
	for (const rung of o.rungs) {
		const want = o.ladder.find((r) => r.name === rung.name);
		const fail = (reason) => ({ ok: false, reason, rung: rung.name });
		if (!rung.playlist.ok) return fail(rung.playlist.reason);
		const pl = rung.playlist;
		for (const f of [pl.init, ...pl.segments.map((s) => s.file)]) if (!(rung.sizes[f] > 0)) return fail('file_missing');
		const v = rung.probe?.video;
		if (!v) return fail('no_video');
		if (v.codec !== 'h264') return fail('video_codec');
		if (v.pixFmt !== 'yuv420p') return fail('pixel_format');
		const colour = renditionColour(v.colour, o.source.plan);
		if (colour) return fail(colour);
		if (v.width !== want.width || v.height !== want.height) return fail('size');
		if (o.source.hasAudio) {
			const a = rung.probe?.audio;
			if (!a || a.codec !== 'aac' || a.channels !== 2) return fail('audio');
		} else if (rung.probe?.audio) {
			// A silent source has silent renditions: an added sound track is never accepted
			return fail('audio');
		}
		const longest = Math.max(...pl.segments.map((s) => s.seconds));
		if (longest > SEGMENT_SECONDS + SEGMENT_SLACK_SECONDS) return fail('segment_length');
		const total = pl.segments.reduce((n, s) => n + s.seconds, 0);
		if (Math.abs(total - o.source.durationSeconds) > slack) return fail('duration');
		// Each segment starts on a keyframe (fMP4 segments are independent) and the GOP is short enough to seek
		if (v.keyframeSeconds && v.keyframeSeconds.length > 1) {
			const gaps = v.keyframeSeconds.slice(1).map((t, i) => t - v.keyframeSeconds[i]);
			if (Math.max(...gaps) > GOP_SECONDS * 2 + 0.05) return fail('keyframes');
		}
		// Peak bitrate: the largest segment over its duration (audio included in the rung's budget)
		const peak = Math.max(...pl.segments.map((s) => (rung.sizes[s.file] * 8) / s.seconds));
		if (peak > (want.maxrate + want.audio) * PEAK_FACTOR) return fail('bitrate');
	}
	return { ok: true };
}

/** RFC 6381 codec string of an H.264 stream from ffprobe's profile name and level. */
export function avcCodec(profile, level) {
	const p = { Baseline: '42', 'Constrained Baseline': '42', Main: '4d', High: '64' }[profile] ?? '64';
	const c = profile === 'Constrained Baseline' ? 'e0' : '00';
	const l = Math.max(10, Math.min(62, Number(level) || 40)).toString(16).padStart(2, '0');
	return `avc1.${p}${c}${l}`;
}

/**
 * Our own master playlist over verified rungs, lowest first, like FFmpeg's.
 * @param {{ name: string, width: number, height: number, bandwidth: number, codecs: string }[]} rungs
 */
export function masterPlaylist(rungs) {
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
	for (const r of [...rungs].sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))) {
		lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${Math.round(r.bandwidth)},RESOLUTION=${r.width}x${r.height},CODECS="${r.codecs}"`, `${r.name}/index.m3u8`);
	}
	return `${lines.join('\n')}\n`;
}

/** Staged files the container may fetch: <rung>/<file> with a safe name, no nesting. */
export function stagedPathAllowed(rel, rungNames) {
	const m = /^([A-Za-z0-9_-]{1,16})\/([A-Za-z0-9._-]{1,64})$/.exec(rel);
	return !!m && rungNames.includes(m[1]) && m[2] !== '.' && m[2] !== '..';
}
