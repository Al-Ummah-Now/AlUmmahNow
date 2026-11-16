/**
 * Multiple audio tracks per video (wiki AUN-MULTI-AUDIO). The track list and the package state live
 * on the video record (`audioTracks`, `audioPackage`); the work runs in apps/media:
 *
 *   Studio → addTrack → (chunks into MEDIA_ORIGINALS audio/<videoId>/<trackId>/<uploadId>/…) → completeUpload
 *     → TRANSCODE_QUEUE audio_track → media normalises track.m4a (+ review audio) → onTrackPrepared
 *     → review (MA8, the uploads' state machine on the track) → queueAudioPackage
 *     → TRANSCODE_QUEUE audio_package → media writes a/… and master_a<n>.m3u8 → onPackageReport
 *
 * A package belongs to one rendition (rev + access): a re-transcode rebuilds it (onRenditionReady),
 * a visibility move carries it (the objects move with the prefix). Jobs that give up flag the admin
 * Errors page with a Retry (/internal/audio-tracks/retry).
 */
import {
	AUDIO_TRACKS_HARD_MAX,
	AUDIO_TRACK_MAX_BYTES,
	AUDIO_TRACK_MAX_CHUNK_BYTES,
	ORIGINAL_AUDIO_TRACK_ID,
	audioMasterFile,
	audioTrackPartKey,
	audioTrackPrefix,
	audioTrackReviewPrefix,
	audioTrackState,
	countedAudioTracks,
	defaultAudioTrackLabel,
	isAudibleTrack,
	isAudioMasterFile,
	isAudioTrackId,
	isAudioTrackLanguage,
	newAudioTrackId,
	reportNeedsAction,
	resolveNeedsAction,
	sanitizeDetectedStreams,
	scansInMode,
	validateAudioTrackInput,
	type AudioPackageJobMessage,
	type AudioPackageReport,
	type AudioPackageState,
	type AudioProbeJobMessage,
	type AudioProbeReport,
	type AudioTrack,
	type AudioTrackInput,
	type AudioTrackJobMessage,
	type AudioTrackLanguage,
	type AudioTrackReport,
	type AudioTrackState,
	type DetectedAudioStream,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type VideoObject,
	type VideoR2State,
	FEATURE_OFF_CODE,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { isSuperAdmin, resolveCreator } from '../creatorTiers';
import { reviewGateFor, type ReviewGateEnv } from '../review/gate';

type Queue = { send(message: unknown): Promise<unknown> };

export interface AudioTracksEnv extends ReviewGateEnv, ErrorReporterEnv {
	videos: R2Bucket;
	SEARCH_DB?: D1Database;
	/** Uploaded parts and the normalised track.m4a (private) */
	MEDIA_ORIGINALS?: R2Bucket;
	MEDIA?: R2Bucket;
	MEDIA_PRIVATE?: R2Bucket;
	TRANSCODE_QUEUE?: Queue;
	MODERATION_QUEUE?: Queue;
	MEDIA_PUBLIC_HOST?: string;
	MEDIA_CDN_API_TOKEN?: unknown;
}

export class AudioTrackError extends Error {
	constructor(
		readonly status: 400 | 402 | 403 | 404 | 409 | 413 | 503,
		readonly code: string,
		message = code,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
	}
}

type Video = VideoObject & { r2?: VideoR2State; audioTracks?: AudioTrack[]; audioPackage?: AudioPackageState };

const repo = (env: Pick<AudioTracksEnv, 'videos'>) => new R2Repository<Video>(env.videos);
const tracksOf = (v: Video): AudioTrack[] => (Array.isArray(v.audioTracks) ? (v.audioTracks as AudioTrack[]) : []);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SAFE_UPLOAD = /^[A-Za-z0-9-]{8,64}$/;

export const trackNeedsActionKey = (videoId: string, trackId: string) => `audio-track:${videoId}:${trackId}`;
export const packageNeedsActionKey = (videoId: string) => `audio-package:${videoId}`;

/** The video's length in seconds (the track is padded or cut to it), or 0 when unknown. */
export function videoSeconds(video: Pick<Video, 'duration' | 'r2'>): number {
	const fromR2 = video.r2?.result?.durationSeconds ?? video.r2?.result?.source?.durationSeconds;
	const n = Number(video.duration) || Number(fromR2) || 0;
	return n > 0 ? n : 0;
}

/** The original's track, made from the video when the first extra track is added. */
export function originalTrack(video: Pick<Video, 'language'>, now: string, language?: AudioTrackLanguage): AudioTrack {
	const lang: AudioTrackLanguage = language ?? (isAudioTrackLanguage(video.language) ? video.language : 'ar');
	return {
		id: ORIGINAL_AUDIO_TRACK_ID,
		language: lang,
		label: defaultAudioTrackLabel(lang),
		kind: 'original',
		isDefault: true,
		status: 'ready',
		source: { type: 'original' },
		createdAt: now,
		updatedAt: now,
	};
}

/** Exactly one default: the one just picked, else the current one, else the original. Mutates. */
export function settleDefault(tracks: AudioTrack[], picked?: string): void {
	const chosen = (picked && tracks.find((t) => t.id === picked)) || tracks.find((t) => t.isDefault) || tracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID) || tracks[0];
	for (const t of tracks) t.isDefault = t === chosen;
}

/** How many extra tracks the video's channel owner may add (MA9). Throws when D1 cannot answer. */
export async function trackAllowance(env: AudioTracksEnv, video: Pick<Video, 'userId'>, userId: string, roles?: readonly string[] | null): Promise<{ limit: number; unlimited: boolean; via: 'tier' | 'super_admin' | 'none' }> {
	if (!env.SEARCH_DB) return isSuperAdmin(roles) ? { limit: AUDIO_TRACKS_HARD_MAX, unlimited: true, via: 'super_admin' } : { limit: 0, unlimited: false, via: 'none' };
	const resolved = await resolveCreator(env.SEARCH_DB, { userId, roles, channelOwnerId: video.userId });
	if (resolved.via === 'super_admin' || resolved.tier?.unlimited) return { limit: AUDIO_TRACKS_HARD_MAX, unlimited: true, via: resolved.via };
	const limit = Math.min(AUDIO_TRACKS_HARD_MAX, Math.max(0, resolved.tier?.audioTracksPerVideo ?? 0));
	return { limit, unlimited: false, via: resolved.via };
}

// ---------------------------------------------------------------------------
// Studio view
// ---------------------------------------------------------------------------

export interface StudioAudioTrack {
	id: string;
	language: string;
	label: string;
	kind: AudioTrack['kind'];
	isDefault: boolean;
	state: AudioTrackState;
	source: 'original' | 'upload' | 'source_stream';
	fileName?: string;
	/** Upload progress: bytes stored so far (state uploading) */
	uploadedBytes?: number;
	bytes?: number;
	durationSeconds?: number;
	/** Rejected: the reviewer's reason code */
	reasonCode?: string;
	error?: string;
	createdAt: string;
}

export function studioTrack(t: AudioTrack, uploadedBytes?: number): StudioAudioTrack {
	const src = t.source;
	return {
		id: t.id,
		language: t.language,
		label: t.label,
		kind: t.kind,
		isDefault: t.isDefault,
		state: audioTrackState(t),
		source: src.type,
		...(src.type === 'upload' && src.fileName ? { fileName: src.fileName } : {}),
		...(src.type === 'upload' ? { bytes: src.bytes } : {}),
		...(uploadedBytes !== undefined ? { uploadedBytes } : {}),
		...(t.durationSeconds ? { durationSeconds: t.durationSeconds } : {}),
		...(t.review?.status === 'rejected' && t.review.reasonCode ? { reasonCode: t.review.reasonCode } : {}),
		...(t.status === 'failed' && t.error ? { error: t.error } : {}),
		createdAt: t.createdAt,
	};
}

/** Whether viewers hear the package now, and whether a newer one is being written. */
export function packageView(video: Video): { status: 'none' | 'building' | 'ready' | 'failed'; playing: boolean } {
	const pkg = video.audioPackage;
	if (!pkg) return { status: 'none', playing: false };
	const playing = !!pkg.master && video.r2?.status === 'ready' && video.r2.rev === pkg.rev && video.r2.access === pkg.access;
	return { status: pkg.status === 'queued' || pkg.status === 'building' ? 'building' : pkg.status, playing };
}

export async function studioView(env: AudioTracksEnv, video: Video, userId: string, roles?: readonly string[] | null) {
	const tracks = tracksOf(video);
	const allowance = await trackAllowance(env, video, userId, roles);
	const uploading = tracks.filter((t) => t.status === 'uploading' && t.source.type === 'upload');
	const progress = new Map<string, number>();
	await Promise.all(
		uploading.map(async (t) => {
			const src = t.source as Extract<AudioTrack['source'], { type: 'upload' }>;
			progress.set(t.id, await storedBytes(env, video.id, t.id, src.uploadId).catch(() => 0));
		}),
	);
	return {
		tracks: tracks.map((t) => studioTrack(t, progress.get(t.id))),
		package: packageView(video),
		limit: { allowed: allowance.limit, used: countedAudioTracks(tracks), unlimited: allowance.unlimited },
		detected: video.audioDetected?.streams ?? null,
		detecting: !!video.audioDetected?.jobId && !video.audioDetected.at,
		ready: video.uploadStatus === 'ready' && videoSeconds(video) > 0,
	};
}

// ---------------------------------------------------------------------------
// Add, upload, complete
// ---------------------------------------------------------------------------

export type NewTrackSource = { type: 'upload'; bytes: number; fileName?: string; contentType?: string } | { type: 'source_stream'; streamIndex: number };

export interface AddTrackInput extends AudioTrackInput {
	source: NewTrackSource;
	/** The original's language, when the first extra track creates its row */
	originalLanguage?: unknown;
}

const EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus|mp4|webm)$/i;

export async function addTrack(
	env: AudioTracksEnv,
	ctx: ExecutionContextLike | undefined,
	input: { video: Video; userId: string; roles?: readonly string[] | null; body: AddTrackInput },
	now = new Date(),
): Promise<{ track: AudioTrack; uploadId?: string }> {
	const { video, userId, roles, body } = input;
	const checked = validateAudioTrackInput(body, false);
	const allowance = await trackAllowance(env, video, userId, roles);
	// No extra tracks in the owner's tier, or the jobs are not bound here: the feature is hidden (404 feature_off),
	// whatever state the video or the request is in, so it is checked first
	if (allowance.limit <= 0 || !env.TRANSCODE_QUEUE || !env.MEDIA_ORIGINALS) throw new AudioTrackError(404, FEATURE_OFF_CODE, 'Audio tracks are off for this video');
	if (!checked.ok) throw new AudioTrackError(400, 'invalid_track', (checked as { error: string }).error);
	if (video.uploadStatus !== 'ready' || videoSeconds(video) <= 0) throw new AudioTrackError(409, 'video_not_ready', 'The video must finish processing first');
	const src = body.source;
	if (src?.type === 'upload') {
		if (!Number.isInteger(src.bytes) || src.bytes <= 0) throw new AudioTrackError(400, 'invalid_track', 'bytes is required');
		if (src.bytes > AUDIO_TRACK_MAX_BYTES) throw new AudioTrackError(413, 'file_too_large', 'Audio files can be up to 2 GB');
		if (src.fileName !== undefined && (typeof src.fileName !== 'string' || !EXT.test(src.fileName))) throw new AudioTrackError(400, 'unsupported_file', 'Use an mp3, m4a, aac, wav, flac, ogg or opus file');
		if (!env.MEDIA_ORIGINALS) throw new AudioTrackError(503, 'storage_unavailable');
	} else if (src?.type === 'source_stream') {
		const streams = video.audioDetected?.streams ?? [];
		if (!Number.isInteger(src.streamIndex) || !streams.some((s) => s.index === src.streamIndex)) throw new AudioTrackError(400, 'unknown_stream', 'Pick one of the tracks found in the video file');
	} else {
		throw new AudioTrackError(400, 'invalid_track', 'source must be an upload or a track of the video file');
	}
	const originalLanguage = body.originalLanguage === undefined ? undefined : isAudioTrackLanguage(body.originalLanguage) ? body.originalLanguage : null;
	if (originalLanguage === null) throw new AudioTrackError(400, 'invalid_track', 'originalLanguage must be a track language');

	const at = now.toISOString();
	const trackId = newAudioTrackId();
	const uploadId = src.type === 'upload' ? crypto.randomUUID() : undefined;
	let refusal: AudioTrackError | null = null;
	let created: AudioTrack | null = null;
	const saved = await repo(env).updateObject(video.id, (fresh) => {
		refusal = null;
		created = null;
		const tracks = [...tracksOf(fresh)];
		const used = countedAudioTracks(tracks);
		if (used + 1 > allowance.limit) {
			refusal = new AudioTrackError(402, 'upgrade_required', 'The limit of audio tracks on this video is reached', { limit: allowance.limit, used });
			return false;
		}
		if (!tracks.some((t) => t.id === ORIGINAL_AUDIO_TRACK_ID)) tracks.unshift(originalTrack(fresh, at, originalLanguage));
		else if (originalLanguage) {
			const orig = tracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID)!;
			orig.language = originalLanguage;
		}
		const language = checked.value.language!;
		const kind = checked.value.kind!;
		if (kind === 'original') {
			refusal = new AudioTrackError(400, 'invalid_track', 'The video already has its original audio; pick dub, commentary or description');
			return false;
		}
		if (tracks.some((t) => t.language === language && t.kind === kind && t.status !== 'failed' && t.review?.status !== 'rejected')) {
			refusal = new AudioTrackError(409, 'duplicate_track', 'This video already has a track of that language and kind');
			return false;
		}
		const track: AudioTrack = {
			id: trackId,
			language,
			label: checked.value.label ?? defaultAudioTrackLabel(language),
			kind,
			isDefault: checked.value.isDefault === true,
			status: src.type === 'upload' ? 'uploading' : 'processing',
			source:
				src.type === 'upload'
					? { type: 'upload', uploadId: uploadId!, bytes: src.bytes, ...(src.fileName ? { fileName: src.fileName.slice(-120) } : {}), ...(typeof src.contentType === 'string' ? { contentType: src.contentType.slice(0, 60) } : {}) }
					: { type: 'source_stream', streamIndex: src.streamIndex },
			createdAt: at,
			createdBy: userId,
			updatedAt: at,
		};
		tracks.push(track);
		// The default moves only once the new track can be heard (onTrackPrepared / review)
		const wantsDefault = track.isDefault;
		track.isDefault = false;
		if (wantsDefault) (track as AudioTrack & { pendingDefault?: boolean }).pendingDefault = true;
		settleDefault(tracks);
		fresh.audioTracks = tracks;
		fresh.dateModified = at;
		created = track;
		return true;
	});
	if (refusal) throw refusal;
	if (!saved || !created) throw new AudioTrackError(404, 'video_not_found');
	const track = created as AudioTrack;
	logger.info('[AudioTracks] Track added', { videoId: video.id, trackId, source: src.type, language: track.language, kind: track.kind });
	await ensureRendition(env, saved);
	if (src.type === 'source_stream') await queueTrackJob(env, ctx, video.id, trackId, now);
	return { track, uploadId };
}

/** Bytes stored from 0 without a gap for this upload. */
export async function storedBytes(env: Pick<AudioTracksEnv, 'MEDIA_ORIGINALS'>, videoId: string, trackId: string, uploadId: string): Promise<number> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return 0;
	const parts = await listParts(bucket, videoId, trackId, uploadId);
	let covered = 0;
	for (const p of parts) {
		if (p.offset > covered) break;
		covered = Math.max(covered, p.offset + p.size);
	}
	return covered;
}

async function listParts(bucket: R2Bucket, videoId: string, trackId: string, uploadId: string): Promise<{ key: string; offset: number; size: number }[]> {
	const prefix = `${audioTrackPrefix(videoId, trackId)}${uploadId}/`;
	const out: { key: string; offset: number; size: number }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects) {
			const offset = Number(o.key.slice(prefix.length));
			if (Number.isInteger(offset) && offset >= 0) out.push({ key: o.key, offset, size: o.size });
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out.sort((a, b) => a.offset - b.offset);
}

function uploadingTrack(video: Video, trackId: string): AudioTrack & { source: Extract<AudioTrack['source'], { type: 'upload' }> } {
	const t = tracksOf(video).find((x) => x.id === trackId);
	if (!t) throw new AudioTrackError(404, 'track_not_found');
	if (t.source.type !== 'upload' || t.status !== 'uploading') throw new AudioTrackError(409, 'not_uploading', 'This track is not waiting for its file');
	return t as never;
}

/**
 * One chunk of the file at `offset`. Chunks arrive in order: `offset` must be where the stored bytes
 * end (or earlier, to resend a chunk). Returns the bytes stored now.
 */
export async function writeChunk(env: AudioTracksEnv, video: Video, trackId: string, offset: number, length: number, body: ReadableStream<Uint8Array>): Promise<number> {
	const t = uploadingTrack(video, trackId);
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) throw new AudioTrackError(503, 'storage_unavailable');
	if (!Number.isInteger(offset) || offset < 0) throw new AudioTrackError(400, 'invalid_offset');
	if (!Number.isInteger(length) || length <= 0 || length > AUDIO_TRACK_MAX_CHUNK_BYTES) throw new AudioTrackError(413, 'chunk_too_large', 'Send at most 10 MB per chunk');
	if (offset + length > t.source.bytes) throw new AudioTrackError(400, 'past_the_end', 'The chunk goes past the file size given when the track was added');
	const covered = await storedBytes(env, video.id, trackId, t.source.uploadId);
	if (offset > covered) throw new AudioTrackError(409, 'offset_mismatch', 'Resume from the stored offset', { offset: covered });
	const fixed = new FixedLengthStream(length);
	const piped = body.pipeTo(fixed.writable);
	await bucket.put(audioTrackPartKey(video.id, trackId, t.source.uploadId, offset), fixed.readable, { httpMetadata: { contentType: 'application/octet-stream' } });
	await piped;
	return Math.max(covered, offset + length);
}

/** The file is whole: the normalising job is queued. */
export async function completeUpload(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, video: Video, trackId: string, now = new Date()): Promise<AudioTrack> {
	const t = uploadingTrack(video, trackId);
	const covered = await storedBytes(env, video.id, trackId, t.source.uploadId);
	if (covered !== t.source.bytes) throw new AudioTrackError(409, 'upload_incomplete', 'Part of the file is missing', { offset: covered });
	const saved = await repo(env).updateObject(video.id, (fresh) => {
		const track = tracksOf(fresh).find((x) => x.id === trackId);
		if (!track || track.status !== 'uploading') return false;
		track.status = 'processing';
		track.updatedAt = now.toISOString();
		fresh.dateModified = track.updatedAt;
		return true;
	});
	if (!saved) throw new AudioTrackError(404, 'video_not_found');
	return queueTrackJob(env, ctx, video.id, trackId, now);
}

/** Queue (or re-queue) the normalising job of a track. */
export async function queueTrackJob(env: AudioTracksEnv, _ctx: ExecutionContextLike | undefined, videoId: string, trackId: string, now = new Date()): Promise<AudioTrack> {
	if (!env.TRANSCODE_QUEUE) throw new AudioTrackError(503, 'jobs_unavailable');
	const review = scansInMode((await reviewGateFor(env, {})).mode);
	let message: AudioTrackJobMessage | null = null;
	let result: AudioTrack | null = null;
	await repo(env).updateObject(videoId, (fresh) => {
		message = null;
		const track = tracksOf(fresh).find((x) => x.id === trackId);
		if (!track || track.id === ORIGINAL_AUDIO_TRACK_ID) return false;
		const seconds = videoSeconds(fresh);
		if (seconds <= 0) return false;
		const jobId = crypto.randomUUID();
		const source: AudioTrackJobMessage['source'] =
			track.source.type === 'upload' ? { type: 'upload', uploadId: track.source.uploadId, bytes: track.source.bytes } : track.source.type === 'source_stream' ? { type: 'source_stream', streamIndex: track.source.streamIndex } : (null as never);
		if (!source) return false;
		track.status = 'processing';
		track.jobId = jobId;
		track.attempts = 0;
		delete track.error;
		track.updatedAt = now.toISOString();
		fresh.dateModified = track.updatedAt;
		message = {
			kind: 'audio_track',
			videoId,
			trackId,
			jobId,
			source,
			durationSeconds: Math.round(seconds * 1000) / 1000,
			...(review ? { reviewPrefix: audioTrackReviewPrefix(videoId, trackId, jobId) } : {}),
			queuedAt: now.toISOString(),
		};
		result = track;
		return true;
	});
	if (!message || !result) throw new AudioTrackError(404, 'track_not_found');
	await env.TRANSCODE_QUEUE.send(message);
	logger.info('[AudioTracks] Track job queued', { videoId, trackId, jobId: (message as AudioTrackJobMessage).jobId });
	return result;
}

/** A track needs the video's R2 rendition (MA4): queue one when there is none. Never throws. */
export async function ensureRendition(env: AudioTracksEnv, video: Video): Promise<void> {
	const s = video.r2?.status;
	if (s === 'ready' || s === 'queued' || s === 'transcoding') return;
	try {
		const { enqueueTranscode } = await import('../media/r2-delivery');
		const out = await enqueueTranscode(env as never, video.id, 'audio', { force: s === 'failed' });
		logger.info('[AudioTracks] R2 rendition requested for audio tracks', { videoId: video.id, queued: out.queued, why: out.why });
	} catch (error) {
		logger.warn('[AudioTracks] Could not request the R2 rendition', { videoId: video.id, error: errorText(error) });
	}
}

// ---------------------------------------------------------------------------
// Edit and delete
// ---------------------------------------------------------------------------

export async function updateTrack(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, video: Video, trackId: string, body: AudioTrackInput, now = new Date()): Promise<AudioTrack> {
	const checked = validateAudioTrackInput(body, true);
	if (!checked.ok) throw new AudioTrackError(400, 'invalid_track', (checked as { error: string }).error);
	const v = checked.value;
	let refusal: AudioTrackError | null = null;
	let updated: AudioTrack | null = null;
	let repackage = false;
	let labelChanged = false;
	const saved = await repo(env).updateObject(video.id, (fresh) => {
		refusal = null;
		updated = null;
		repackage = false;
		labelChanged = false;
		const tracks = tracksOf(fresh);
		const track = tracks.find((t) => t.id === trackId);
		if (!track) {
			refusal = new AudioTrackError(404, 'track_not_found');
			return false;
		}
		if (track.id === ORIGINAL_AUDIO_TRACK_ID && v.kind && v.kind !== 'original') {
			refusal = new AudioTrackError(400, 'invalid_track', 'The original audio stays the original');
			return false;
		}
		if (track.id !== ORIGINAL_AUDIO_TRACK_ID && v.kind === 'original') {
			refusal = new AudioTrackError(400, 'invalid_track', 'Only the video’s own audio is the original');
			return false;
		}
		const language = v.language ?? track.language;
		const kind = v.kind ?? track.kind;
		if (tracks.some((t) => t.id !== track.id && t.language === language && t.kind === kind && t.status !== 'failed' && t.review?.status !== 'rejected')) {
			refusal = new AudioTrackError(409, 'duplicate_track', 'This video already has a track of that language and kind');
			return false;
		}
		const before = JSON.stringify([track.language, track.label, track.kind, tracks.map((t) => t.isDefault)]);
		if (v.language) {
			// A label that was the old language's name follows the language
			if (track.label === defaultAudioTrackLabel(track.language) && !v.label) track.label = defaultAudioTrackLabel(v.language);
			track.language = v.language;
		}
		const labelBefore = track.label;
		if (v.label) track.label = v.label;
		labelChanged = track.label !== labelBefore;
		// Renamed while its first check runs: flagged in this same write, so no outcome can slip in
		// between (recheckPendingLabel checks the name once the check has ended)
		if (labelChanged && track.review?.status === 'checking') (track as AudioTrack & { labelCheckPending?: boolean }).labelCheckPending = true;
		if (v.kind) track.kind = v.kind;
		if (v.isDefault === true) {
			if (isAudibleTrack(track)) settleDefault(tracks, track.id);
			else (track as AudioTrack & { pendingDefault?: boolean }).pendingDefault = true;
		}
		const after = JSON.stringify([track.language, track.label, track.kind, tracks.map((t) => t.isDefault)]);
		track.updatedAt = now.toISOString();
		fresh.dateModified = track.updatedAt;
		repackage = before !== after && audibleExtras(tracks).length > 0;
		updated = track;
		return true;
	});
	if (refusal) throw refusal;
	if (!updated || !saved) throw new AudioTrackError(404, 'video_not_found');
	if (labelChanged) await recheckTrackLabel(env, saved as Video, updated, now);
	if (repackage) await queueAudioPackage(env, ctx, video.id, now);
	return updated;
}

/**
 * A cleared track's new name is checked again as text, like an edited video title (VIDEO-REVIEW §2):
 * it stays audible meanwhile, and an NSFW or escalation hit pulls it back to a person, which takes
 * it out of the package. Never throws.
 */
async function recheckTrackLabel(env: AudioTracksEnv, video: Video, track: AudioTrack, now: Date): Promise<void> {
	try {
		const gate = await reviewGateFor(env, video, now);
		if (!scansInMode(gate.mode)) return;
		const { queueAudioTrackScan } = await import('../review/audio-track');
		const r = track.review;
		// Still checking: the scan in flight read the old name. A text-only result must never finish
		// that check, so the name is checked once the check has ended (applyAudioTrackOutcome), when
		// a hit can only pull the track back. A track waiting for a person shows the reviewer its
		// current name; a rejected one is not heard.
		if ((track as AudioTrack & { labelCheckPending?: boolean }).labelCheckPending) {
			// The check may have ended since the save: settle it now (otherwise its outcome does)
			const { recheckPendingLabel } = await import('../review/audio-track');
			await recheckPendingLabel(env as never, video.id, track.id);
		} else if (r && (r.status === 'approved' || r.status === 'post_review') && gate.mode !== 'shadow') {
			await queueAudioTrackScan(env as never, video, track, { reviewId: r.reviewId, mode: gate.mode as 'enforce' | 'enforce_nsfw', trigger: 'metadata_edit', now });
		} else if (track.reviewShadow && gate.mode === 'shadow') {
			await queueAudioTrackScan(env as never, video, track, { reviewId: track.reviewShadow.reviewId, mode: 'shadow', trigger: 'metadata_edit', now });
		}
	} catch (error) {
		logger.error('[AudioTracks] Could not re-check a track name', { videoId: video.id, trackId: track.id, error: errorText(error) });
	}
}

/**
 * Stop serving one track of the current package at once (rejected, pulled back or deleted): its
 * audio folder goes, so a saved master URL cannot reach it, and playback falls back to the plain
 * master (packagedAudioTracks) until the rebuild without it is recorded. Best effort.
 */
export async function withdrawPackagedTrack(env: AudioTracksEnv, videoId: string, trackId: string): Promise<void> {
	if (!isAudioTrackId(trackId) || trackId === ORIGINAL_AUDIO_TRACK_ID) return;
	try {
		const video = await repo(env).getObject(videoId);
		const pkg = video?.audioPackage;
		if (!pkg?.trackIds?.includes(trackId)) return;
		const bucket = bucketFor(env, pkg.access);
		if (!bucket) return;
		await deletePrefix(bucket, `${pkg.access}/${videoId}/${pkg.rev}/a/${trackId}/`);
	} catch (error) {
		logger.warn('[AudioTracks] Could not withdraw a packaged track', { videoId, trackId, error: errorText(error) });
	}
}

export async function deleteTrack(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, video: Video, trackId: string, now = new Date()): Promise<void> {
	if (trackId === ORIGINAL_AUDIO_TRACK_ID) throw new AudioTrackError(400, 'cannot_delete_original', 'The original audio cannot be deleted');
	let removed: AudioTrack | null = null;
	await repo(env).updateObject(video.id, (fresh) => {
		removed = null;
		const tracks = tracksOf(fresh);
		const i = tracks.findIndex((t) => t.id === trackId);
		if (i < 0) return false;
		removed = tracks[i]!;
		tracks.splice(i, 1);
		settleDefault(tracks);
		// The original alone is no track list
		fresh.audioTracks = tracks.length > 1 ? tracks : [];
		fresh.dateModified = now.toISOString();
		return true;
	});
	if (!removed) throw new AudioTrackError(404, 'track_not_found');
	logger.info('[AudioTracks] Track deleted', { videoId: video.id, trackId });
	resolveNeedsAction(env, ctx, trackNeedsActionKey(video.id, trackId));
	await deletePrefix(env.MEDIA_ORIGINALS, audioTrackPrefix(video.id, trackId)).catch((error) => logger.warn('[AudioTracks] Could not delete a track file', { videoId: video.id, trackId, error: errorText(error) }));
	await withdrawPackagedTrack(env, video.id, trackId);
	await queueAudioPackage(env, ctx, video.id, now);
}

async function deletePrefix(bucket: R2Bucket | undefined, prefix: string): Promise<number> {
	if (!bucket) return 0;
	let n = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		if (page.objects.length) {
			await bucket.delete(page.objects.map((o) => o.key));
			n += page.objects.length;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return n;
}

/** Every audio track file of a video (video purge, erase). */
export async function purgeVideoAudio(env: Pick<AudioTracksEnv, 'MEDIA_ORIGINALS'>, videoId: string): Promise<number> {
	return deletePrefix(env.MEDIA_ORIGINALS, `audio/${videoId}/`);
}

// ---------------------------------------------------------------------------
// Job reports
// ---------------------------------------------------------------------------

const audibleExtras = (tracks: AudioTrack[]) => tracks.filter((t) => t.id !== ORIGINAL_AUDIO_TRACK_ID && isAudibleTrack(t));

/** The track job ended (apps/media). */
export async function onTrackPrepared(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, videoId: string, trackId: string, report: AudioTrackReport, now = new Date()): Promise<{ applied: boolean; why?: string }> {
	const gate = report.ok ? await reviewGateFor(env, (await repo(env).getObject(videoId)) ?? {}, now) : null;
	let why: string | undefined;
	let scan: { reviewId: string; mode: 'shadow' | 'enforce' | 'enforce_nsfw' } | null = null;
	let audible = false;
	let video: Video | null = null;
	const saved = await repo(env).updateObject(videoId, (fresh) => {
		why = undefined;
		scan = null;
		audible = false;
		const track = tracksOf(fresh).find((t) => t.id === trackId);
		if (!track || track.jobId !== report.jobId) {
			why = 'stale job';
			return false;
		}
		if (track.status !== 'processing') {
			why = `already ${track.status}`;
			return false;
		}
		const at = now.toISOString();
		track.updatedAt = at;
		fresh.dateModified = at;
		if (!report.ok) {
			track.status = 'failed';
			track.error = (report as { retryable: boolean }).retryable ? 'processing_failed' : 'unreadable_file';
			return true;
		}
		track.status = 'ready';
		track.durationSeconds = report.durationSeconds;
		delete track.review;
		delete track.reviewShadow;
		if (gate && scansInMode(gate.mode)) {
			const reviewId = crypto.randomUUID();
			if (gate.state) {
				track.review = { ...gate.state, reviewId, ...(report.reviewManifestKey ? { manifestKey: report.reviewManifestKey } : {}) };
				scan = { reviewId, mode: gate.mode as 'enforce' | 'enforce_nsfw' };
			} else {
				track.reviewShadow = { reviewId, queuedAt: at };
				scan = { reviewId, mode: 'shadow' };
			}
		}
		audible = isAudibleTrack(track);
		if (audible && (track as AudioTrack & { pendingDefault?: boolean }).pendingDefault) {
			delete (track as AudioTrack & { pendingDefault?: boolean }).pendingDefault;
			settleDefault(tracksOf(fresh), track.id);
		}
		return true;
	});
	video = saved;
	if (!saved) return { applied: false, why: 'video not found' };
	if (why) return { applied: false, why };
	const track = tracksOf(saved).find((t) => t.id === trackId)!;
	if (!report.ok) {
		logger.error('[AudioTracks] Track job gave up', { videoId, trackId, jobId: report.jobId, error: (report as { error: string }).error });
		reportNeedsAction('api-videos', env, ctx, {
			key: trackNeedsActionKey(videoId, trackId),
			source: 'processing',
			title: 'Audio track processing failed',
			message: `${track.label} (${track.language}): ${(report as { error: string }).error}`.slice(0, 500),
			itemType: 'video',
			itemId: videoId,
			itemUrl: `/videos/${videoId}`,
			retry: { kind: 'service', service: 'api-videos', path: '/internal/audio-tracks/retry', body: { videoId, trackId } },
			retryLabel: 'Process again',
			extra: { trackId, language: track.language, retryable: (report as { retryable: boolean }).retryable },
		});
		return { applied: true };
	}
	resolveNeedsAction(env, ctx, trackNeedsActionKey(videoId, trackId));
	if (scan) {
		const { queueAudioTrackScan } = await import('../review/audio-track');
		const s = scan as { reviewId: string; mode: 'shadow' | 'enforce' | 'enforce_nsfw' };
		await queueAudioTrackScan(env as never, video!, track, { reviewId: s.reviewId, mode: s.mode, manifestKey: report.reviewManifestKey, now });
	}
	if (audible) await queueAudioPackage(env, ctx, videoId, now);
	return { applied: true };
}

/**
 * Queue a package build for the video's current tracks, or drop the package when no extra track is
 * audible. Waits for the R2 rendition (onRenditionReady calls this again). Never throws.
 */
export async function queueAudioPackage(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, videoId: string, now = new Date()): Promise<{ queued: boolean; why?: string }> {
	try {
		let message: AudioPackageJobMessage | null = null;
		let drop: AudioPackageState | null = null;
		let why: string | undefined;
		await repo(env).updateObject(videoId, (fresh) => {
			message = null;
			drop = null;
			why = undefined;
			const tracks = tracksOf(fresh);
			const extras = audibleExtras(tracks);
			if (!extras.length) {
				if (!fresh.audioPackage) {
					why = 'no extra tracks';
					return false;
				}
				drop = fresh.audioPackage;
				delete fresh.audioPackage;
				fresh.dateModified = now.toISOString();
				return true;
			}
			const r2 = fresh.r2;
			if (!r2 || r2.status !== 'ready' || !r2.result?.rungs?.length) {
				why = 'waiting for the R2 rendition';
				return false;
			}
			const orig = tracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID) ?? originalTrack(fresh, now.toISOString());
			const prev = fresh.audioPackage;
			const sameRendition = prev && prev.rev === r2.rev && prev.access === r2.access;
			const version = (prev?.version ?? 0) + 1;
			const jobId = crypto.randomUUID();
			const list = [orig, ...extras];
			fresh.audioPackage = {
				status: 'queued',
				jobId,
				rev: r2.rev,
				access: r2.access,
				version,
				// The last ready master keeps playing until this one is recorded (same rendition only)
				...(sameRendition && prev?.master ? { master: prev.master, trackIds: prev.trackIds } : {}),
				queuedAt: now.toISOString(),
				attempts: 0,
			};
			fresh.dateModified = now.toISOString();
			message = {
				kind: 'audio_package',
				videoId,
				jobId,
				rev: r2.rev,
				access: r2.access,
				version,
				rungs: r2.result.rungs.map((r) => r.name),
				tracks: list.map((t) => ({ id: t.id, language: t.language, label: t.label, kind: t.kind, isDefault: t.isDefault })),
				queuedAt: now.toISOString(),
			};
			return true;
		});
		if (drop) {
			await removePackageFiles(env, videoId, drop, null);
			logger.info('[AudioTracks] Package dropped: no extra tracks left', { videoId });
			return { queued: false, why: 'dropped' };
		}
		if (!message) return { queued: false, why };
		if (!env.TRANSCODE_QUEUE) return { queued: false, why: 'transcode queue not bound' };
		await env.TRANSCODE_QUEUE.send(message);
		const m = message as AudioPackageJobMessage;
		logger.info('[AudioTracks] Package job queued', { videoId, jobId: m.jobId, version: m.version, tracks: m.tracks.length });
		return { queued: true };
	} catch (error) {
		logger.error('[AudioTracks] Could not queue the package', { videoId, error: errorText(error) });
		reportNeedsAction('api-videos', env, ctx, {
			key: packageNeedsActionKey(videoId),
			source: 'processing',
			title: 'Audio tracks could not be packaged',
			message: errorText(error).slice(0, 500),
			itemType: 'video',
			itemId: videoId,
			itemUrl: `/videos/${videoId}`,
			retry: { kind: 'service', service: 'api-videos', path: '/internal/audio-tracks/retry', body: { videoId } },
			retryLabel: 'Package again',
		});
		return { queued: false, why: 'error' };
	}
}

function bucketFor(env: AudioTracksEnv, access: 'pub' | 'priv'): R2Bucket | undefined {
	return access === 'priv' ? env.MEDIA_PRIVATE : env.MEDIA;
}

/**
 * Remove a package's files that the current package no longer uses: the old master, and the audio
 * folders of tracks that left (all of a/ when `keep` is null). Best effort.
 */
async function removePackageFiles(env: AudioTracksEnv, videoId: string, old: Pick<AudioPackageState, 'rev' | 'access' | 'master' | 'trackIds'>, keep: Pick<AudioPackageState, 'rev' | 'access' | 'master' | 'trackIds'> | null): Promise<void> {
	const bucket = bucketFor(env, old.access);
	if (!bucket) return;
	const base = `${old.access}/${videoId}/${old.rev}/`;
	try {
		const sameRendition = keep && keep.rev === old.rev && keep.access === old.access;
		if (old.master && isAudioMasterFile(old.master) && (!sameRendition || keep!.master !== old.master)) await bucket.delete(`${base}${old.master}`);
		if (!sameRendition) {
			// The rendition itself is deleted by its own lifecycle when the rev changed; a dropped package clears a/
			if (!keep) await deletePrefix(bucket, `${base}a/`);
			return;
		}
		const left = (old.trackIds ?? []).filter((id) => id !== ORIGINAL_AUDIO_TRACK_ID && !(keep!.trackIds ?? []).includes(id));
		for (const id of left) if (isAudioTrackId(id)) await deletePrefix(bucket, `${base}a/${id}/`);
	} catch (error) {
		logger.warn('[AudioTracks] Could not remove old package files', { videoId, error: errorText(error) });
	}
}

/** The package job ended (apps/media). Recorded only on the rendition it was written for. */
export async function onPackageReport(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, videoId: string, report: AudioPackageReport, now = new Date()): Promise<{ applied: boolean; why?: string }> {
	let why: string | undefined;
	let replaced: AudioPackageState | null = null;
	let requeue = false;
	const saved = await repo(env).updateObject(videoId, (fresh) => {
		why = undefined;
		replaced = null;
		requeue = false;
		const pkg = fresh.audioPackage;
		if (!pkg || pkg.jobId !== report.jobId) {
			why = 'stale job';
			return false;
		}
		const r2 = fresh.r2;
		if (!r2 || r2.rev !== report.rev || r2.access !== report.access || pkg.rev !== report.rev || pkg.access !== report.access) {
			// The rendition moved or was replaced while the job ran: build again for the current one
			why = 'stale rendition';
			requeue = true;
			return false;
		}
		const at = now.toISOString();
		if (!report.ok) {
			pkg.status = 'failed';
			pkg.failedAt = at;
			pkg.error = (report as { error: string }).error.slice(0, 300);
			fresh.dateModified = at;
			return true;
		}
		if (!isAudioMasterFile(report.master)) {
			why = 'bad master name';
			return false;
		}
		replaced = pkg.master ? { ...pkg } : null;
		pkg.status = 'ready';
		pkg.master = report.master;
		pkg.trackIds = report.trackIds.filter((id) => isAudioTrackId(id));
		pkg.readyAt = at;
		delete pkg.error;
		delete pkg.failedAt;
		fresh.dateModified = at;
		return true;
	});
	if (requeue) {
		await queueAudioPackage(env, ctx, videoId, now);
		return { applied: false, why };
	}
	if (!saved) return { applied: false, why: 'video not found' };
	if (why) return { applied: false, why };
	if (!report.ok) {
		logger.error('[AudioTracks] Package job gave up', { videoId, jobId: report.jobId, error: (report as { error: string }).error });
		reportNeedsAction('api-videos', env, ctx, {
			key: packageNeedsActionKey(videoId),
			source: 'processing',
			title: 'Audio tracks could not be packaged',
			message: (report as { error: string }).error.slice(0, 500),
			itemType: 'video',
			itemId: videoId,
			itemUrl: `/videos/${videoId}`,
			retry: { kind: 'service', service: 'api-videos', path: '/internal/audio-tracks/retry', body: { videoId } },
			retryLabel: 'Package again',
		});
		return { applied: true };
	}
	resolveNeedsAction(env, ctx, packageNeedsActionKey(videoId));
	if (replaced) await removePackageFiles(env, videoId, replaced, saved.audioPackage!);
	logger.info('[AudioTracks] Package ready', { videoId, master: report.master, tracks: report.trackIds.length });
	return { applied: true };
}

/** A rendition just became ready (new rev): rebuild the package for it. Never throws. */
export async function onRenditionReady(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, video: Video): Promise<void> {
	if (!audibleExtras(tracksOf(video)).length) return;
	const pkg = video.audioPackage;
	if (pkg && video.r2 && pkg.rev === video.r2.rev && pkg.access === video.r2.access && (pkg.status === 'ready' || pkg.status === 'queued' || pkg.status === 'building')) return;
	await queueAudioPackage(env, ctx, video.id);
}

/** The admin Errors page's Retry: a failed track (trackId) or the package. */
export async function retryAudio(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, videoId: string, trackId?: string): Promise<{ retried: 'track' | 'package' | 'nothing' }> {
	const video = await repo(env).getObject(videoId);
	if (!video) return { retried: 'nothing' };
	if (trackId) {
		const t = tracksOf(video).find((x) => x.id === trackId);
		if (!t || t.status !== 'failed') return { retried: 'nothing' };
		await queueTrackJob(env, ctx, videoId, trackId);
		return { retried: 'track' };
	}
	const out = await queueAudioPackage(env, ctx, videoId);
	return { retried: out.queued ? 'package' : 'nothing' };
}

/** Studio's "Try again" on a failed track. */
export async function retryTrack(env: AudioTracksEnv, ctx: ExecutionContextLike | undefined, video: Video, trackId: string): Promise<AudioTrack> {
	const t = tracksOf(video).find((x) => x.id === trackId);
	if (!t) throw new AudioTrackError(404, 'track_not_found');
	if (t.status !== 'failed') throw new AudioTrackError(409, 'not_failed');
	if (t.source.type === 'upload' && (await storedBytes(env, video.id, trackId, t.source.uploadId)) !== t.source.bytes) throw new AudioTrackError(409, 'upload_incomplete', 'Upload the file again');
	resolveNeedsAction(env, ctx, trackNeedsActionKey(video.id, trackId));
	return queueTrackJob(env, ctx, video.id, trackId);
}

// ---------------------------------------------------------------------------
// Detect tracks in the video's own file
// ---------------------------------------------------------------------------

export async function requestProbe(env: AudioTracksEnv, video: Video, now = new Date()): Promise<{ queued: boolean }> {
	if (!env.TRANSCODE_QUEUE) throw new AudioTrackError(503, 'jobs_unavailable');
	const jobId = crypto.randomUUID();
	const saved = await repo(env).updateObject(video.id, (fresh) => {
		fresh.audioDetected = { streams: fresh.audioDetected?.streams ?? [], at: '', jobId };
		return true;
	});
	if (!saved) throw new AudioTrackError(404, 'video_not_found');
	const msg: AudioProbeJobMessage = { kind: 'audio_probe', videoId: video.id, jobId, queuedAt: now.toISOString() };
	await env.TRANSCODE_QUEUE.send(msg);
	return { queued: true };
}

export async function onProbeReport(env: AudioTracksEnv, videoId: string, report: AudioProbeReport, now = new Date()): Promise<{ applied: boolean; streams?: DetectedAudioStream[] }> {
	let streams: DetectedAudioStream[] = [];
	const saved = await repo(env).updateObject(videoId, (fresh) => {
		if (fresh.audioDetected?.jobId !== report.jobId) return false;
		streams = report.ok ? sanitizeDetectedStreams(report.streams) : fresh.audioDetected?.streams ?? [];
		fresh.audioDetected = { streams, at: now.toISOString() };
		return true;
	});
	if (!saved || saved.audioDetected?.at === '') return { applied: false };
	if (!report.ok) logger.warn('[AudioTracks] Could not read the audio streams of the video file', { videoId, error: (report as { error: string }).error.slice(0, 300) });
	return { applied: true, streams };
}

/** Validates the upload id of a chunk request path. */
export const isUploadId = (id: string) => SAFE_UPLOAD.test(id);
