// Multiple audio tracks (AlUmmahNow wiki AUN-MULTI-AUDIO). Pure helpers, unit-tested in
// test/audio-tracks.test.ts; server.mjs runs them.
//
// A video with extra tracks plays a demuxed package of its ready rendition (MA1/MA2):
//   <prefix>/a/v/<rung>/…   video only, stream copy of the rung
//   <prefix>/a/orig/…       the original audio, stream copy of the top rung's audio
//   <prefix>/a/<trackId>/…  each extra track, stream copy of its normalised track.m4a
//   <prefix>/master_a<n>.m3u8
// Measured 2026-11-14 (VHS 3.17): alternate audio beside muxed rungs never switched; a fully
// demuxed package switches in under a second both ways, so the original is its own rendition too.

import { SEGMENT_SECONDS } from './ladder.mjs';

/** Normalised track bitrate (the rendition's own audio is 128k from 480p up). */
export const TRACK_BITRATE = 128_000;
export const TRACK_FILE = 'track.m4a';

/**
 * Normalise one audio stream to the video's length (MA5): pad with silence or cut, stereo 48 kHz
 * AAC 128k, moov first. `stream` is the audio stream index in the input (0 for an uploaded file).
 * @param {{ input: string, out: string, stream?: number, durationSeconds: number }} o
 */
export function normaliseArgs(o) {
	const d = Math.max(0.1, Number(o.durationSeconds) || 0);
	return [
		'-hide_banner', '-nostdin', '-y', '-i', o.input,
		'-map', `0:a:${Math.max(0, Number(o.stream) || 0)}`,
		'-vn', '-sn', '-dn',
		'-af', 'apad', '-t', d.toFixed(3),
		'-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', String(TRACK_BITRATE),
		'-movflags', '+faststart',
		o.out,
	];
}

/** fMP4 HLS of one stream copy, 6 s segments (the ladder's), playlist last in `<dir>/index.m3u8`. */
function hlsOut(dir) {
	return [
		'-f', 'hls',
		'-hls_time', String(SEGMENT_SECONDS),
		'-hls_playlist_type', 'vod',
		'-hls_segment_type', 'fmp4',
		'-hls_fmp4_init_filename', 'init.mp4',
		'-hls_flags', 'independent_segments',
		'-hls_segment_filename', `${dir}/seg_%05d.m4s`,
		`${dir}/index.m3u8`,
	];
}

/**
 * Split one rung of the rendition (its local HLS copy) into a video-only rendition and, when
 * `audioDir` is given, an audio-only one. Stream copy: no encode, the segment boundaries stay on
 * the rung's forced key frames.
 * @param {{ input: string, videoDir: string, audioDir?: string }} o
 */
export function splitRungArgs(o) {
	const args = ['-hide_banner', '-nostdin', '-y', '-allowed_extensions', 'ALL', '-i', o.input];
	args.push('-map', '0:v:0', '-c', 'copy', ...hlsOut(o.videoDir));
	if (o.audioDir) args.push('-map', '0:a:0', '-c', 'copy', ...hlsOut(o.audioDir));
	return args;
}

/** A normalised track as an audio-only rendition (stream copy). */
export function trackHlsArgs(o) {
	return ['-hide_banner', '-nostdin', '-y', '-i', o.input, '-map', '0:a:0', '-c', 'copy', ...hlsOut(o.dir)];
}

/**
 * Attribute list of an #EXT-X-STREAM-INF / #EXT-X-MEDIA line (quoted values may hold commas).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseAttributes(text) {
	/** @type {Record<string, string>} */
	const out = {};
	const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
	let m;
	while ((m = re.exec(text))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
	return out;
}

/**
 * The rendition master's variants: rung name (the URI's folder), attributes. Only our own layout
 * (`<rung>/index.m3u8`) is accepted.
 * @returns {{ rung: string, attrs: Record<string, string> }[]}
 */
export function masterVariants(text) {
	const lines = String(text).split(/\r?\n/).map((l) => l.trim());
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
		const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
		const m = /^([0-9]{2,4}p)\/index\.m3u8$/.exec(uri || '');
		if (!m) continue;
		out.push({ rung: m[1], attrs: parseAttributes(lines[i].slice('#EXT-X-STREAM-INF:'.length)) });
	}
	return out;
}

/** The video codec of a variant's CODECS (its audio codec goes: audio is a rendition now). */
export function videoCodecs(codecs) {
	const list = String(codecs || '').split(',').map((c) => c.trim()).filter(Boolean);
	const video = list.filter((c) => !/^mp4a\./.test(c));
	return video.length ? video.join(',') : 'avc1.640028';
}

const quoted = (s) => String(s).replace(/["\r\n]/g, '').trim();

/** Names must be unique in a group (RFC 8216 §4.3.4.1): a repeated label gets its kind, then a number. */
export function uniqueNames(tracks) {
	const seen = new Set();
	return tracks.map((t) => {
		let name = quoted(t.label) || t.language;
		if (seen.has(name)) name = `${name} (${t.kind})`;
		let n = 2;
		const base = name;
		while (seen.has(name)) name = `${base} ${n++}`;
		seen.add(name);
		return name;
	});
}

/**
 * The package master (MA3): every track an EXT-X-MEDIA rendition in group "aud", one DEFAULT=YES
 * (the creator's default, else the first), audio description marked for assistive selection, and
 * every rung pointing at its video-only copy with AUDIO="aud".
 * @param {{ variants: { rung: string, attrs: Record<string, string> }[], tracks: { id: string, language: string, label: string, kind: string, isDefault: boolean }[], audioBandwidth?: number }} o
 */
export function packageMaster(o) {
	if (!o.tracks.length) throw new Error('no tracks');
	if (!o.variants.length) throw new Error('no variants');
	const names = uniqueNames(o.tracks);
	const defaultIndex = Math.max(0, o.tracks.findIndex((t) => t.isDefault));
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
	o.tracks.forEach((t, i) => {
		const attrs = [
			'TYPE=AUDIO',
			'GROUP-ID="aud"',
			`NAME="${names[i]}"`,
			`LANGUAGE="${quoted(t.language)}"`,
			`DEFAULT=${i === defaultIndex ? 'YES' : 'NO'}`,
			// Audio description is chosen on purpose, never picked automatically by language
			`AUTOSELECT=${t.kind === 'description' ? 'NO' : 'YES'}`,
			...(t.kind === 'description' ? ['CHARACTERISTICS="public.accessibility.describes-video"'] : []),
			'CHANNELS="2"',
			`URI="a/${t.id}/index.m3u8"`,
		];
		lines.push(`#EXT-X-MEDIA:${attrs.join(',')}`);
	});
	const audio = o.audioBandwidth ?? TRACK_BITRATE;
	for (const v of o.variants) {
		const a = v.attrs;
		const bw = (Number(a.BANDWIDTH) || 0) + audio;
		const parts = [`BANDWIDTH=${bw}`];
		if (a['AVERAGE-BANDWIDTH']) parts.push(`AVERAGE-BANDWIDTH=${(Number(a['AVERAGE-BANDWIDTH']) || 0) + audio}`);
		if (a.RESOLUTION) parts.push(`RESOLUTION=${a.RESOLUTION}`);
		if (a['FRAME-RATE']) parts.push(`FRAME-RATE=${a['FRAME-RATE']}`);
		parts.push(`CODECS="${videoCodecs(a.CODECS)},mp4a.40.2"`);
		parts.push('AUDIO="aud"');
		lines.push(`#EXT-X-STREAM-INF:${parts.join(',')}`);
		lines.push(`a/v/${v.rung}/index.m3u8`);
	}
	return lines.join('\n') + '\n';
}

/** Audio streams of an ffprobe result, indexed among audio streams (ffmpeg `0:a:<index>`). */
export function audioStreams(probe) {
	const streams = Array.isArray(probe?.streams) ? probe.streams : [];
	return streams
		.filter((s) => s && s.codec_type === 'audio')
		.map((s, index) => ({
			index,
			...(s.tags?.language && s.tags.language !== 'und' ? { language: String(s.tags.language).slice(0, 8) } : {}),
			...(s.tags?.title || s.tags?.handler_name ? { title: String(s.tags.title || s.tags.handler_name).slice(0, 80) } : {}),
			...(Number.isInteger(s.channels) ? { channels: s.channels } : {}),
			...(s.codec_name ? { codec: String(s.codec_name).slice(0, 20) } : {}),
		}));
}

/**
 * Upload order of one rendition folder: init and segments first, the playlist last, so a playlist
 * that exists always has its files (the next package build skips a folder whose playlist exists).
 * @param {string[]} files names in the folder
 */
export function folderUploadOrder(files) {
	const media = files.filter((f) => f !== 'index.m3u8').sort();
	return files.includes('index.m3u8') ? [...media, 'index.m3u8'] : media;
}
