// Review media for pre-publication review (AlUmmahNow docs/specs/VIDEO-REVIEW.md §5): frames and
// audio extracted in the transcode pass, uploaded under MEDIA_PRIVATE review/<videoId>/<rev>/.
// Pure helpers (tested in test/review-extract.test.ts); server.mjs runs them.

/** Audio chunks of at most 10 minutes (the AUN-CAPTIONS format, Whisper's sweet spot). */
export const AUDIO_CHUNK_SECONDS = 600;

/**
 * The frame interval actually used: the asked one, widened when the video is long enough that
 * the interval alone would pass the cap (VR4: 2 s + scene cuts, capped at 1,200, then wider).
 */
export function frameInterval(durationSeconds, opts) {
	const wanted = Math.max(0.5, Number(opts.frameIntervalSeconds) || 2);
	const max = Math.max(10, Number(opts.maxFrames) || 1200);
	if (!(durationSeconds > 0)) return { interval: wanted, capped: false };
	const needed = durationSeconds / wanted;
	// Leave a fifth of the cap for scene cuts
	if (needed <= max * 0.8) return { interval: wanted, capped: false };
	return { interval: Math.ceil((durationSeconds / (max * 0.8)) * 10) / 10, capped: true };
}

/**
 * One ffmpeg pass: drop near-duplicate frames (mpdecimate), then keep a frame every `interval`
 * seconds and every scene cut, scaled to ≤ 512 px on the long side; showinfo prints each kept
 * frame's time (parsed by frameTimes()).
 */
export function framesArgs(o) {
	const scene = Math.min(0.9, Math.max(0.05, Number(o.sceneThreshold) || 0.3));
	const select = `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${o.interval})+gt(scene\\,${scene})'`;
	const scale = "scale='if(gt(iw\\,ih)\\,min(512\\,iw)\\,-2)':'if(gt(iw\\,ih)\\,-2\\,min(512\\,ih))'";
	return ['-hide_banner', '-nostdin', '-y', '-i', o.input, '-an', '-vf', `mpdecimate=hi=768:lo=320:frac=0.33,${select},${scale},showinfo`, '-fps_mode', 'vfr', '-q:v', '5', `${o.out}/%06d.jpg`];
}

/** Frame times (ms) from showinfo's stderr lines, in output order. */
export function frameTimes(lines) {
	const out = [];
	for (const line of lines) {
		const m = /Parsed_showinfo.*?\bpts_time:\s*([0-9.]+)/.exec(line);
		if (m) out.push(Math.round(Number(m[1]) * 1000));
	}
	return out;
}

/** 16 kHz mono MP3 chunks of ≤ 10 minutes. */
export function audioArgs(o) {
	return ['-hide_banner', '-nostdin', '-y', '-i', o.input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'segment', '-segment_time', String(AUDIO_CHUNK_SECONDS), '-reset_timestamps', '1', `${o.out}/%03d.mp3`];
}

/** Keep at most `max` frames, evenly (scene cuts past the cap are thinned like the rest). */
export function thinFrames(frames, max) {
	if (frames.length <= max) return frames;
	const step = frames.length / max;
	return Array.from({ length: max }, (_, i) => frames[Math.floor(i * step)]);
}

/** The manifest (shared-types ReviewMediaManifest). */
export function manifestFor({ videoId, rev, prefix, durationSeconds, frames, audioCount, capped, now }) {
	const durationMs = Math.round(durationSeconds * 1000);
	return {
		videoId,
		rev,
		durationMs,
		frames: frames.map((f) => ({ key: `${prefix}frames/${f.file}`, atMs: f.atMs, sceneCut: false })),
		audio: Array.from({ length: audioCount }, (_, i) => ({
			key: `${prefix}audio/${String(i).padStart(3, '0')}.mp3`,
			startMs: i * AUDIO_CHUNK_SECONDS * 1000,
			endMs: Math.min(durationMs, (i + 1) * AUDIO_CHUNK_SECONDS * 1000),
		})),
		capped,
		createdAt: now,
	};
}
