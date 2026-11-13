// HLS ladder and FFmpeg arguments (pure; unit-tested in apps/media/test/ladder.test.ts).
//
// Rungs are named by the short side, so a Short (portrait) gets 360x640 …
// 1080x1920 and a landscape video 640x360 … 1920x1080. Never above the source.

/** Short side → peak bitrate cap (bits/s). CRF 23 keeps lectures well under it. */
export const RUNGS = [
	{ name: '360p', short: 360, maxrate: 800_000, audio: 96_000 },
	{ name: '480p', short: 480, maxrate: 1_400_000, audio: 128_000 },
	{ name: '720p', short: 720, maxrate: 2_800_000, audio: 128_000 },
	{ name: '1080p', short: 1080, maxrate: 5_000_000, audio: 128_000 },
];

export const SEGMENT_SECONDS = 6;
export const GOP_SECONDS = 2;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const evenDown = (n) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Display size from ffprobe's stream (coded size + rotation side data).
 * @param {{ width: number, height: number, rotation?: number }} s
 */
export function displaySize(s) {
	const r = Math.abs(Number(s.rotation) || 0) % 180;
	return r === 90 ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/**
 * The ladder for a source of this display size.
 * @param {{ width: number, height: number }} src
 */
export function ladderFor(src) {
	if (!(src.width > 0 && src.height > 0)) throw new Error('Source has no video size');
	const portrait = src.height > src.width;
	const short = Math.min(src.width, src.height);
	const aspect = src.width / src.height;
	// Tolerate a few pixels (e.g. 1916x1076 is still "1080p")
	let rungs = RUNGS.filter((r) => r.short <= short + 8);
	if (rungs.length === 0) rungs = [{ ...RUNGS[0], short: evenDown(short) }];
	return rungs.map((r) => {
		const s = Math.min(r.short, evenDown(short));
		const width = portrait ? s : even(s * aspect);
		const height = portrait ? even(s / aspect) : s;
		return { name: r.name, width, height, maxrate: r.maxrate, audio: r.audio };
	});
}

/**
 * FFmpeg arguments for one pass: decode once, split, scale per rung, fMP4 HLS
 * with a master playlist. Output: <out>/<rung>/index.m3u8, init.mp4, seg_00001.m4s …
 * @param {{ input: string, out: string, rungs: ReturnType<typeof ladderFor>, hasAudio: boolean, fps?: number, preset?: string }} o
 */
export function ffmpegArgs(o) {
	const n = o.rungs.length;
	const split = `[0:v]split=${n}${o.rungs.map((_, i) => `[v${i}]`).join('')}`;
	const scales = o.rungs.map((r, i) => `[v${i}]scale=w=${r.width}:h=${r.height}:flags=bicubic,format=yuv420p[v${i}o]`);
	const args = ['-hide_banner', '-nostdin', '-y', '-i', o.input, '-filter_complex', [split, ...scales].join(';')];
	// Cap at 30 fps above 30 (lectures; halves the work for 60 fps phone video)
	const fps = o.fps && o.fps > 31 ? 30 : undefined;
	o.rungs.forEach((r, i) => {
		args.push('-map', `[v${i}o]`);
		args.push(`-c:v:${i}`, 'libx264', `-profile:v:${i}`, r.height >= 720 || r.width >= 1280 ? 'high' : 'main');
		args.push(`-crf:v:${i}`, '23', `-maxrate:v:${i}`, String(r.maxrate), `-bufsize:v:${i}`, String(r.maxrate * 2));
		if (fps) args.push(`-r:v:${i}`, String(fps));
	});
	if (o.hasAudio) {
		o.rungs.forEach((r, i) => {
			args.push('-map', 'a:0');
			args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, String(r.audio), `-ac:a:${i}`, '2');
		});
	}
	args.push(
		'-preset', o.preset || 'veryfast',
		'-sc_threshold', '0',
		'-force_key_frames', `expr:gte(t,n_forced*${GOP_SECONDS})`,
		'-f', 'hls',
		'-hls_time', String(SEGMENT_SECONDS),
		'-hls_playlist_type', 'vod',
		'-hls_segment_type', 'fmp4',
		'-hls_fmp4_init_filename', 'init.mp4',
		'-hls_flags', 'independent_segments',
		'-hls_segment_filename', `${o.out}/%v/seg_%05d.m4s`,
		'-master_pl_name', 'master.m3u8',
		'-var_stream_map', o.rungs.map((r, i) => (o.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(' '),
		'-progress', 'pipe:1',
		'-stats_period', '5',
		`${o.out}/%v/index.m3u8`,
	);
	return args;
}

/** The progressive MP4's file name (D-SEO-11: search engines' contentUrl for public videos). */
export const MP4_FILE = 'video.mp4';

/**
 * The rung the progressive MP4 copies: 480p (good enough to index and preview, about 0.45 GB an hour),
 * else the highest rung below it for a smaller source.
 * @param {{ name: string, width: number, height: number }[]} rungs
 */
export function mp4Rung(rungs) {
	const order = ['480p', '360p'];
	for (const name of order) {
		const r = rungs.find((x) => x.name === name);
		if (r) return r;
	}
	return rungs[0] ?? null;
}

/**
 * FFmpeg arguments that remux a rung's fMP4 HLS (init.mp4 + segments) into one progressive MP4,
 * moov first (+faststart). Stream copy: no second encode.
 * @param {{ out: string, rung: string }} o
 */
export function mp4Args(o) {
	return ['-hide_banner', '-nostdin', '-y', '-allowed_extensions', 'ALL', '-i', `${o.out}/${o.rung}/index.m3u8`, '-map', '0', '-c', 'copy', '-movflags', '+faststart', `${o.out}/${MP4_FILE}`];
}

/**
 * Files a rung's media playlist needs beside it (the EXT-X-MAP init, then every segment), or null
 * when the playlist is not one of ours: any name outside [A-Za-z0-9._-] (a path, a URL) is refused.
 * @param {string} playlist
 * @returns {string[] | null}
 */
export function playlistFiles(playlist) {
	const files = [];
	for (const raw of playlist.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const map = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(line);
		const name = map ? map[1] : line.startsWith('#') ? null : line;
		if (name === null) continue;
		if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name === '.' || name === '..') return null;
		if (!files.includes(name)) files.push(name);
	}
	return files.length > 1 ? files : null;
}

/** Where the poster frame is taken: 10% in, at most 30 s, at least 0. */
export function posterTime(durationSeconds) {
	if (!(durationSeconds > 0)) return 0;
	return Math.min(30, Math.max(0, durationSeconds * 0.1));
}

/** Poster (1280 and 640 wide) and a 4 s animated preview (320 wide). */
export function stillsArgs(o) {
	const t = posterTime(o.durationSeconds).toFixed(2);
	const pt = Math.min(posterTime(o.durationSeconds), Math.max(0, o.durationSeconds - 4)).toFixed(2);
	return {
		thumb: ['-hide_banner', '-nostdin', '-y', '-ss', t, '-i', o.input, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', `${o.out}/thumb.jpg`],
		thumbSmall: ['-hide_banner', '-nostdin', '-y', '-ss', t, '-i', o.input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', `${o.out}/thumb_640.jpg`],
		preview: ['-hide_banner', '-nostdin', '-y', '-ss', pt, '-t', '4', '-i', o.input, '-an', '-vf', "fps=8,scale='min(320,iw)':-2", '-loop', '0', '-c:v', 'libwebp', '-quality', '60', `${o.out}/preview.webp`],
	};
}

/** Parse ffmpeg `-progress` lines; returns seconds encoded so far or null. */
export function progressSeconds(line) {
	const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
	return m ? Number(m[1]) / 1e6 : null;
}

/** Bandwidth (bits/s) of a rendition from its bytes and duration. */
export function bandwidthOf(bytes, durationSeconds) {
	return durationSeconds > 0 ? Math.round((bytes * 8) / durationSeconds) : 0;
}
