// Renditions encoded on the creator's computer (D11: desktop Studio's optional pre-encode).
//
// The server never trusts them: the container checks every rung against the ladder it would have
// encoded itself for this source (ladder.mjs), checks each playlist and file, decodes samples, and
// only then uploads them. Anything off → the normal server encode runs instead, in the same attempt.
// The master playlist is always written here, never taken from the upload.
//
// Pure (unit-tested in apps/media/test/prebuilt.test.ts); server.mjs does the I/O and ffprobe.

import { GOP_SECONDS, SEGMENT_SECONDS, playlistFiles } from './ladder.mjs';

/** A segment may run this much past SEGMENT_SECONDS (keyframes land on GOP boundaries). */
export const SEGMENT_SLACK_SECONDS = 1;
/** A rung's peak segment bitrate may reach this multiple of its maxrate (VBV allows short bursts). */
export const PEAK_FACTOR = 1.5;
/** Rendition and source durations may differ by this much (or 1%, whichever is larger). */
export const DURATION_SLACK_SECONDS = 1;
/** Segments decoded end to end per rung: first, middle and last. */
export const DECODE_SAMPLES = 3;

/**
 * Parse a media playlist we can accept: VOD, fMP4 with one EXT-X-MAP, EXTINF per segment.
 * @param {string} text
 * @returns {{ ok: true, init: string, segments: { file: string, seconds: number }[], targetDuration: number } | { ok: false, reason: string }}
 */
export function parseMediaPlaylist(text) {
	const files = playlistFiles(text);
	if (!files) return { ok: false, reason: 'playlist_names' };
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines[0] !== '#EXTM3U') return { ok: false, reason: 'playlist_header' };
	if (!lines.includes('#EXT-X-ENDLIST')) return { ok: false, reason: 'playlist_not_vod' };
	if (lines.some((l) => l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-BYTERANGE') || l.startsWith('#EXT-X-DISCONTINUITY'))) return { ok: false, reason: 'playlist_features' };
	const maps = lines.filter((l) => l.startsWith('#EXT-X-MAP:'));
	if (maps.length !== 1) return { ok: false, reason: 'playlist_init' };
	const init = /URI="([^"]+)"/.exec(maps[0])?.[1];
	const target = Number(/^#EXT-X-TARGETDURATION:(\d+)/.exec(lines.find((l) => l.startsWith('#EXT-X-TARGETDURATION:')) || '')?.[1]);
	const segments = [];
	let pending = null;
	for (const l of lines) {
		const inf = /^#EXTINF:([0-9.]+)/.exec(l);
		if (inf) {
			pending = Number(inf[1]);
			continue;
		}
		if (l.startsWith('#')) continue;
		if (pending === null || !Number.isFinite(pending) || pending <= 0) return { ok: false, reason: 'playlist_extinf' };
		segments.push({ file: l, seconds: pending });
		pending = null;
	}
	if (!init || segments.length === 0) return { ok: false, reason: 'playlist_empty' };
	if (new Set(segments.map((s) => s.file)).size !== segments.length || segments.some((s) => s.file === init)) return { ok: false, reason: 'playlist_duplicates' };
	return { ok: true, init, segments, targetDuration: Number.isFinite(target) ? target : 0 };
}

/**
 * Check what the creator uploaded against the ladder for this source.
 * @param {{
 *   ladder: { name: string, width: number, height: number, maxrate: number, audio: number }[],
 *   source: { durationSeconds: number, hasAudio: boolean },
 *   rungs: {
 *     name: string,
 *     playlist: ReturnType<typeof parseMediaPlaylist>,
 *     sizes: Record<string, number>,
 *     probe: { video?: { codec: string, width: number, height: number, pixFmt: string, profile?: string, level?: number, keyframeSeconds?: number[] }, audio?: { codec: string, channels: number } } | null,
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
		if (v.width !== want.width || v.height !== want.height) return fail('size');
		if (o.source.hasAudio) {
			const a = rung.probe?.audio;
			if (!a || a.codec !== 'aac' || a.channels !== 2) return fail('audio');
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

/** Segments decoded end to end: first, middle and last (fewer for short rungs). */
export function decodeSamples(segments) {
	if (segments.length <= DECODE_SAMPLES) return segments.map((s) => s.file);
	return [...new Set([0, Math.floor(segments.length / 2), segments.length - 1])].map((i) => segments[i].file);
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
