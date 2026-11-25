/**
 * What the container saw in a source file, recorded with a failed job (videos admin → Delivery →
 * Transcode troubleshooting): the container kind, the streams and their codecs, the share of zero bytes
 * in the first and last MB, and the SHA-256 of the whole file. Tells an audio file from one that was
 * damaged or half written. No names, no tags and no media.
 */
import { createHash } from 'node:crypto';

const EDGE = 1024 * 1024;
const MAX_STREAMS = 12;

/** The container the file's first bytes say it is. */
export function containerKind(head) {
	const ascii = (from, to) => head.subarray(from, to).toString('latin1');
	if (head.length < 12) return 'too_short';
	if (head.subarray(0, 12).every((b) => b === 0)) return 'zeros';
	if (ascii(4, 8) === 'ftyp') return 'mp4';
	if (head.readUInt32BE(0) === 0x1a45dfa3) return 'matroska';
	if (ascii(0, 4) === 'RIFF') return ascii(8, 12) === 'WAVE' ? 'wav' : 'avi';
	if (ascii(0, 4) === 'OggS') return 'ogg';
	if (ascii(0, 4) === 'fLaC') return 'flac';
	if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'mp3_aac';
	if (head[0] === 0x47) return 'mpegts';
	return 'unknown';
}

/** ffprobe's JSON as { format, streams, durationSeconds }; a cover picture is not a video. */
export function streamFacts(json) {
	const kinds = { video: 'video', audio: 'audio', subtitle: 'subtitle' };
	return {
		...(json.format?.format_name ? { format: String(json.format.format_name).slice(0, 40) } : {}),
		streams: (json.streams || []).slice(0, MAX_STREAMS).map((s) => ({ kind: s.disposition?.attached_pic ? 'cover' : kinds[s.codec_type] ?? 'other', codec: String(s.codec_name ?? 'unknown').slice(0, 24) })),
		...(Number(json.format?.duration) > 0 ? { durationSeconds: Math.round(Number(json.format.duration)) } : {}),
	};
}

const zeroPercent = (buf) => {
	let zeros = 0;
	for (const b of buf) if (b === 0) zeros++;
	return buf.length ? Math.round((1000 * zeros) / buf.length) / 10 : 0;
};

/** Our kept original is not the file the importer read. Bunny's copies are other files: never compared. */
export const sourceChanged = (expected, sourceFile, actual) => !!expected && sourceFile === 'original' && expected !== actual;

/** Reads the file's chunks in order as they are downloaded. */
export class SourceFacts {
	#hash = createHash('sha256');
	#head = Buffer.alloc(0);
	#tail = Buffer.alloc(0);

	update(chunk) {
		this.#hash.update(chunk);
		if (this.#head.length < EDGE) this.#head = Buffer.concat([this.#head, chunk.subarray(0, EDGE - this.#head.length)]);
		// Copies: a view would keep the whole 64 MB chunk in memory
		this.#tail = chunk.length >= EDGE ? Buffer.from(chunk.subarray(chunk.length - EDGE)) : Buffer.concat([this.#tail, chunk]).subarray(-EDGE);
	}

	/** Once, after the last chunk. */
	finish(bytes) {
		return { bytes, container: containerKind(this.#head), zeroStartPercent: zeroPercent(this.#head), zeroEndPercent: zeroPercent(this.#tail), sha256: this.#hash.digest('hex') };
	}
}
