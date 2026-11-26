/**
 * R2 delivery beside Bunny (epic #687, docs/media-delivery/R2-DELIVERY-PLAN.md),
 * the api-videos side. apps/media transcodes; this module owns the record:
 *
 *   upload complete ─► enqueueTranscode ─► al-ummah-now-transcode[-env] ─► apps/media
 *   apps/media ─► POST /internal/media/events ─► applyJobEvent ─► video.r2
 *   apps/media ─► GET  /internal/media/source/:id ─► sourceUrl (Bunny "original", signed)
 *   any video write whose access changed ─► media-move message ─► moveMedia
 *   30-day purge / promote ─► purgeVideoMedia
 *
 * Bunny is never touched here: every Bunny path works exactly as before.
 */
import { r2ThumbnailPrefix } from '../thumbnail/store';
import { isR2FrameOf } from '../thumbnail/shape';
import { isStale as isPrebuiltStale } from './prebuilt';
import {
	PREBUILT_REJECTIONS,
	sanitizeStartup,
	type PrebuiltRejection,
	type PrebuiltUploadState,
	isVideoMediaPublic,
	isMediaRev,
	isMediaVideoId,
	shownR2,
	mediaFrameUrl,
	mediaPlayUrl,
	newMediaRev,
	publicMp4Path,
	publishAdminLive,
	publishAdminLiveFor,
	type AdminLiveEvent,
	reportNeedsAction,
	resolveNeedsAction,
	compactRungs,
	sanitizeFailure,
	sanitizeSourceFacts,
	isUploadIssueCode,
	type UploadIssueCode,
	SOURCE_SHA256,
	underHold,
	sourceVerdict,
	sanitizeRungs,
	scrubMediaText,
	MEDIA_MASTER,
	MEDIA_MAX_EDGE_TTL_SECONDS,
	MEDIA_THUMBNAIL,
	audioPackageMaster,
	type DeliverySettings,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type MediaAccess,
	type AudioPackageState,
	type AudioTrack,
	type R2Rendition,
	type RetiredR2Rendition,
	type Mp4JobEvent,
	sanitizeMp4,
	type TranscodeFailure,
	type TranscodeJobEvent,
	type TranscodeResult,
	type TranscodeSourceFacts,
	transcodeErrorReason,
	type TranscodeJobMessage,
	type VideoR2State,
	type VideoVisibilityFields,
	ingestTargets,
	type VideoMediaProviders,
} from '@al-ummah/shared-types';
import { queueReviewScan, reviewExtractionFor } from '../review/scan';
import { getSecret } from '../env-helpers';
import { markPublished } from '../published';
import { isSourceChangedError, bunnyCopyRefused, SOURCE_CHANGED, SOURCE_CHANGED_REASON, usableBunnyRef } from './source-changed';
import { enqueueBunnyDelete } from '../uploads/bunnyDelete';
import { fetchBunnyVideo } from '../processing/loop';
import { closeOriginal, deleteOriginal } from './originals';
import { clearMediaSettingsCache, readLegacyDeliverySettings, readMediaSettings, writeLegacyDeliverySettings } from './settings';
import { bunnyLibraryForVideo, type BunnyLibrariesEnv, type LibraryHints } from '../bunny/libraries';
import { logger } from '../logger';
import { transcodeCeilingOf } from '@al-ummah/shared-types';
import { effectiveTranscodes } from './transcode-limit';
import R2Repository from '../r2Repo';
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../bunny-signing';

type SecretLike = { get(): Promise<string> } | { text(): Promise<string> } | string;

export interface MediaEnv {
	videos: R2Bucket;
	/** Uploader's profile: E2E run accounts get no transcode (container time is not free) */
	profiles?: R2Bucket;
	global_settings?: R2Bucket;
	/** al-ummah-now-media[-env] (public renditions) */
	MEDIA?: R2Bucket;
	/** al-ummah-now-media-private[-env] */
	MEDIA_PRIVATE?: R2Bucket;
	/** al-ummah-now-transcode[-env]: jobs for apps/media. Unbound = no dual write. */
	TRANSCODE_QUEUE?: Queue;
	/** Carries media-move messages (same consumer as the processing loop) */
	PROCESSING_CHECK_QUEUE?: Queue;
	MEDIA_SIGN_KEY?: SecretLike;
	/** media.<env>.alummahnow.net */
	MEDIA_PUBLIC_HOST?: string;
	/** media_jobs, playback_qoe_daily, delivery_cost_daily (migrations/search/0020) */
	SEARCH_DB?: D1Database;
	/** Zone token with Cache Purge (optional): purges a video's public prefix when it goes private */
	MEDIA_CDN_API_TOKEN?: SecretLike;
	bunny_hostname?: string;
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: SecretLike;
	/** Legacy Bunny library (lib/bunny/libraries.ts) */
	BUNNY_LEGACY_LIBRARY_ID?: string;
	BUNNY_LEGACY_HOSTNAME?: string;
	BUNNY_LEGACY_STREAM_KEY?: SecretLike;
	BUNNY_LEGACY_TOKEN_KEY?: SecretLike;
	'bunny-stream-key'?: SecretLike;
	bunny_stream_library_id?: SecretLike;
}

/** Fields of a video record this module reads or writes. */
export interface MediaVideo extends VideoVisibilityFields {
	id: string;
	media?: VideoMediaProviders;
	audioPackage?: AudioPackageState;
	audioTracks?: AudioTrack[];
	r2?: VideoR2State;
	dateModified?: string;
	/** Bunny's first playable time (lib/processing/sync.ts) */
	playableAt?: string;
}

/** Mirror the record's R2 state into media_jobs (the comparison page reads it). Best effort. */
export async function recordJob(env: Pick<MediaEnv, 'SEARCH_DB'>, video: MediaVideo | null): Promise<void> {
	const r2 = video?.r2;
	if (!env.SEARCH_DB || !video || !r2) return;
	const res = r2.result;
	try {
		await env.SEARCH_DB.prepare(
			`INSERT INTO media_jobs (video_id, job_id, status, access, reason, attempts, queued_at, started_at, ready_at, failed_at, error,
			   duration_seconds, bytes, objects, rungs, container_seconds, instance_type, bunny_ready_at, updated_at,
			   start_cold, start_dispatch_ms, start_ready_ms, start_accept_ms, start_ffmpeg_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
			 ON CONFLICT (video_id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, access = excluded.access,
			   reason = COALESCE(excluded.reason, media_jobs.reason), attempts = excluded.attempts, queued_at = excluded.queued_at,
			   started_at = excluded.started_at, ready_at = excluded.ready_at, failed_at = excluded.failed_at, error = excluded.error,
			   duration_seconds = excluded.duration_seconds, bytes = excluded.bytes, objects = excluded.objects, rungs = excluded.rungs,
			   container_seconds = excluded.container_seconds, instance_type = excluded.instance_type,
			   bunny_ready_at = COALESCE(excluded.bunny_ready_at, media_jobs.bunny_ready_at), updated_at = excluded.updated_at,
			   start_cold = excluded.start_cold, start_dispatch_ms = excluded.start_dispatch_ms, start_ready_ms = excluded.start_ready_ms,
			   start_accept_ms = excluded.start_accept_ms, start_ffmpeg_ms = excluded.start_ffmpeg_ms,
			   source_facts = CASE WHEN media_jobs.job_id = excluded.job_id THEN media_jobs.source_facts END`,
		)
			.bind(
				video.id,
				r2.jobId,
				r2.status,
				r2.access,
				null,
				r2.attempts ?? 0,
				r2.queuedAt,
				r2.startedAt ?? null,
				r2.readyAt ?? null,
				r2.failedAt ?? null,
				r2.error ?? null,
				res?.durationSeconds ?? null,
				res?.bytes ?? null,
				res?.objects ?? null,
				res ? res.rungs.map((r) => r.name).join(',') : null,
				r2.containerSeconds ?? null,
				r2.instanceType ?? null,
				video.playableAt ?? null,
				new Date().toISOString(),
				r2.startup ? (r2.startup.cold ? 1 : 0) : null,
				r2.startup?.dispatchMs ?? null,
				r2.startup?.readyMs ?? null,
				r2.startup?.acceptMs ?? null,
				r2.startup?.ffmpegMs ?? null,
			)
			.run();
	} catch (error) {
		logger.warn('[Media] Could not record the job', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
	}
}

const MEDIA_RETIRE_KIND = 'media-retire';
export const MEDIA_MOVE_KIND = 'media-move';
export interface MediaMoveMessage {
	kind: typeof MEDIA_MOVE_KIND;
	videoId: string;
	moveId: string;
	to: MediaAccess;
	rev?: string;
	from?: MediaAccess;
}
export function isMediaMoveMessage(body: unknown): body is MediaMoveMessage {
	const b = body as Partial<MediaMoveMessage> | null;
	return !!b && b.kind === MEDIA_MOVE_KIND && typeof b.videoId === 'string' && (b.to === 'pub' || b.to === 'priv');
}

interface MediaRetireMessage {
	kind: typeof MEDIA_RETIRE_KIND;
	videoId: string;
	rev: string;
}

function isMediaRetireMessage(body: unknown): body is MediaRetireMessage {
	const b = body as Partial<MediaRetireMessage> | null;
	return b?.kind === MEDIA_RETIRE_KIND && typeof b.videoId === 'string' && isMediaVideoId(b.videoId) && typeof b.rev === 'string' && isMediaRev(b.rev);
}

export function isMediaRenditionMessage(body: unknown): body is MediaMoveMessage | MediaRetireMessage {
	return isMediaMoveMessage(body) || isMediaRetireMessage(body);
}

export { SETTINGS_KEY } from './settings';
const ZONE_ID = 'fada86a0f215bda23dbe19de7226b49f';

// ---------------------------------------------------------------------------
// Settings: provider settings (./settings.ts). These two keep the legacy delivery-switch shape for
// code and clients that only know it; they read and write the same object.
// ---------------------------------------------------------------------------

export function clearDeliverySettingsCache(): void {
	clearMediaSettingsCache();
}

export async function readDeliverySettings(env: Pick<MediaEnv, 'global_settings'>, fresh = false): Promise<DeliverySettings> {
	return readLegacyDeliverySettings(env, fresh);
}

export async function writeDeliverySettings(env: Pick<MediaEnv, 'global_settings'>, input: Partial<DeliverySettings>, actorId: string): Promise<DeliverySettings> {
	return writeLegacyDeliverySettings(env, input, actorId);
}

// ---------------------------------------------------------------------------
// Access: public renditions are served with no Worker, so only a video anyone
// may watch is public. Private, draft, hidden, deleted or not yet published → priv.
// The rule is the shared one (shared-types isVideoMediaPublic, #1241).
// ---------------------------------------------------------------------------

export function desiredAccess(video: VideoVisibilityFields): MediaAccess {
	return isVideoMediaPublic(video) ? 'pub' : 'priv';
}

function completedRenditions(r2: VideoR2State | undefined): R2Rendition[] {
	if (!r2) return [];
	const renditions = r2.previous ? [r2.previous] : [];
	if (r2.status === 'ready') renditions.push(r2);
	return renditions;
}

function renditionToMove(video: MediaVideo, to: MediaAccess): R2Rendition | undefined {
	return completedRenditions(video.r2).find((r) => r.access !== to &&
		!(r.moving?.to === to && Date.now() - Date.parse(r.moving.at) < 30 * 60 * 1000));
}

/** A completed rendition is under the wrong prefix and has no move to the right one. */
export function accessDrift(video: MediaVideo | null | undefined): MediaAccess | null {
	if (!video) return null;
	const to = desiredAccess(video);
	return renditionToMove(video, to) ? to : null;
}

/** The cutover and the start of the grace period are part of the same record write. */
function retirePrevious(video: MediaVideo): RetiredR2Rendition | undefined {
	const r2 = video.r2;
	if (!r2?.previous || r2.status !== 'ready' || r2.access !== desiredAccess(video)) return undefined;
	const { rev, access } = r2.previous;
	delete r2.previous;
	if (rev === r2.rev) return undefined;
	const retired = { rev, access, deleteAfter: Date.now() + (MEDIA_MAX_EDGE_TTL_SECONDS + 3600) * 1000 };
	(r2.retired ??= []).push(retired);
	return retired;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const repo = (env: MediaEnv) => new R2Repository<MediaVideo>(env.videos);

/**
 * Dual write: queue an R2 transcode for a video whose upload just completed
 * (or an admin retry). Never throws: the Bunny path must not notice.
 */
export async function enqueueTranscode(
	env: MediaEnv,
	videoId: string,
	reason: TranscodeJobMessage['reason'],
	opts: { force?: boolean; now?: Date; uploaderId?: string } = {},
): Promise<{ queued: boolean; why?: string; jobId?: string }> {
	try {
		if (!env.TRANSCODE_QUEUE) return { queued: false, why: 'transcode queue not bound' };
		// A new video names its providers (lib/media/ingest.ts): R2 transcodes exactly when it holds one.
		// Older rows follow the ingest settings (channel override included).
		const current = (await repo(env).getObject(videoId)) as (MediaVideo & { channelId?: string }) | null;
		if (!current) return { queued: false, why: 'video not found' };
		const wantsR2 = current.media ? !!current.media.providers.r2 : ingestTargets(await readMediaSettings(env), current.channelId).includes('r2');
		// Audio tracks (wiki AUN-MULTI-AUDIO MA4) play only from R2, so they ask for a rendition either way
		if (!wantsR2 && reason !== 'retry' && reason !== 'backfill' && reason !== 'audio') return { queued: false, why: 'R2 does not take this video' };
		// E2E run accounts skip R2 to spare the transcoder, unless R2 is the video's only copy
		const onlyCopy = !!current.media && !current.media.providers.bunny;
		if (reason === 'upload' && !onlyCopy && opts.uploaderId && (await isE2eUploader(env, opts.uploaderId))) return { queued: false, why: 'E2E run account' };
		const now = opts.now ?? new Date();
		// Pre-publication review (docs/specs/VIDEO-REVIEW.md §5): the same pass extracts frames and audio
		const review = reason === 'upload' ? await reviewExtractionFor(env as never) : undefined;
		let message: TranscodeJobMessage | null = null;
		let replacing = false;
		let why: string | undefined;
		await repo(env).updateObject(videoId, (video) => {
			message = null;
			replacing = false;
			why = undefined;
			const r2 = video.r2;
			if (r2 && !opts.force && (r2.status === 'queued' || r2.status === 'transcoding' || r2.status === 'ready')) {
				why = `already ${r2.status}`;
				return false;
			}
			if (r2?.status === 'ready' && r2.previous) {
				why = 'replacement is being moved';
				return false;
			}
			if (video.isDeleted) {
				why = 'video is deleted';
				return false;
			}
			const previous = r2?.status === 'ready'
				? { rev: r2.rev, access: r2.access, result: r2.result, readyAt: r2.readyAt, moving: r2.moving }
				: r2?.previous;
			const job: TranscodeJobMessage = {
				kind: 'transcode',
				videoId,
				jobId: crypto.randomUUID(),
				rev: newMediaRev(),
				access: desiredAccess(video),
				queuedAt: now.toISOString(),
				reason,
				...(review ? { review } : {}),
				...(SOURCE_SHA256.test((video as { sourceSha256?: string }).sourceSha256 ?? '') ? { sha256: (video as { sourceSha256?: string }).sourceSha256 } : {}),
			};
			// D11: renditions the creator pre-encoded in desktop Studio go with the first transcode, to verify
			const pre = (video as MediaVideo & { prebuilt?: PrebuiltUploadState }).prebuilt;
			if (reason === 'upload' && pre?.status === 'ready' && !isPrebuiltStale(pre, now.getTime())) {
				job.prebuilt = { stagingId: pre.stagingId, rungs: pre.rungs };
				(video as MediaVideo & { prebuilt?: PrebuiltUploadState }).prebuilt = { ...pre, status: 'queued' };
			}
			video.r2 = {
				status: 'queued',
				jobId: job.jobId,
				rev: job.rev,
				access: job.access,
				attempts: 0,
				queuedAt: job.queuedAt,
				...(previous ? { previous } : {}),
				...(r2?.retired?.length ? { retired: r2.retired } : {}),
			};
			if (previous) refreshR2Provider(video);
			message = job;
			replacing = !!previous;
			return true;
		});
		if (!message) return { queued: false, why: why ?? 'video not found' };
		const sent: TranscodeJobMessage = message;
		try {
			await env.TRANSCODE_QUEUE.send(sent);
		} catch (error) {
			if (replacing) await applyJobEvent(env, undefined, {
				type: 'failed', videoId, jobId: sent.jobId, at: new Date().toISOString(), attempt: 0, final: true, error: 'Could not queue the R2 transcode',
			});
			throw error;
		}
		await recordJob(env, await repo(env).getObject(videoId));
		return { queued: true, jobId: sent.jobId };
	} catch (error) {
		logger.error('[Media] Could not queue the R2 transcode', { videoId, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}

const E2E_RUN_EMAIL = /^e2e\+[^@]+@e2e\.alummahnow\.net$/;
/**
 * The one run account that is transcoded: the release gate for R2 delivery
 * (apps/web/e2e/release/media-delivery.spec.ts, #960) names its user …-media-gate.
 * One short clip per release run.
 */
const E2E_MEDIA_GATE_EMAIL = /^e2e\+[^@]+-media-gate@e2e\.alummahnow\.net$/;

async function isE2eUploader(env: MediaEnv, userId: string): Promise<boolean> {
	try {
		const profile = (await (await env.profiles?.get(userId))?.json<{ email?: string }>()) ?? null;
		if (typeof profile?.email !== 'string') return false;
		const email = profile.email.toLowerCase();
		// Same rule as lib/e2e/runUserSweep.ts (not imported: that module imports admin/service, which imports this one)
		return E2E_RUN_EMAIL.test(email) && !E2E_MEDIA_GATE_EMAIL.test(email);
	} catch {
		return false;
	}
}

const STAGE_LABELS: Record<string, string> = {
	start: 'starting',
	fetch_source: 'fetching the source',
	probe: 'reading the source',
	encode: 'encoding',
	stills: 'making thumbnails',
	upload: 'uploading to R2',
	container: 'container stopped',
};

/** What the container saw in the failed job's source (admin troubleshooting). Best effort. */
async function recordSourceFacts(env: Pick<MediaEnv, 'SEARCH_DB'>, ev: TranscodeJobEvent): Promise<void> {
	const facts = sanitizeSourceFacts(ev.sourceFacts);
	if (!facts || !env.SEARCH_DB) return;
	await env.SEARCH_DB.prepare('UPDATE media_jobs SET source_facts = ?3 WHERE video_id = ?1 AND job_id = ?2')
		.bind(ev.videoId, ev.jobId, JSON.stringify(facts))
		.run()
		.catch((error) => logger.warn('[Media] Could not record what the source is', { videoId: ev.videoId, error: error instanceof Error ? error.message : String(error) }));
}

/** What the file is, for its creator; nothing when it does hold a video (the failure is then ours to look at). */
function issueCodeOf(ev: TranscodeJobEvent): { code?: UploadIssueCode } {
	if (transcodeErrorReason(ev.error) === 'colour_unsupported') return { code: 'colour_unsupported' };
	const facts = sanitizeSourceFacts(ev.sourceFacts);
	const verdict = facts && sourceVerdict(facts);
	return isUploadIssueCode(verdict) ? { code: verdict } : {};
}

/** "audio_only; mov,mp4: audio aac, cover mjpeg; 812 s; zeros 0% at the start, 0% at the end" */
export function sourceFactsLine(f: Omit<TranscodeSourceFacts, 'sha256'>): string {
	const streams = f.streams ? f.streams.map((s) => `${s.kind} ${s.codec}`).join(', ') || 'no streams' : 'not readable by ffprobe';
	return `${sourceVerdict(f)}; ${f.format ?? f.container}: ${streams}${f.durationSeconds ? `; ${f.durationSeconds} s` : ''}; zeros ${f.zeroStartPercent}% at the start, ${f.zeroEndPercent}% at the end`;
}

/** Errors-page text for a final failure: one summary line, a details block (shown as the item's stack), and small keys. */
export function failureDetails(ev: Pick<TranscodeJobEvent, 'videoId' | 'jobId' | 'attempt' | 'error' | 'sourceFacts'>, f: TranscodeFailure | undefined): { summary: string; error: Error; extra: Record<string, string | number | boolean | null> } {
	const err = scrubMediaText(ev.error ?? 'failed', 200);
	const stage = f ? STAGE_LABELS[f.stage] ?? f.stage : 'unknown stage';
	const secs = f ? Math.round(f.elapsedMs / 1000) : null;
	const summary = `Failed while ${stage}${f?.stageDetail ? ` (${f.stageDetail})` : ''}: ${err} (attempt ${f?.attempt ?? ev.attempt}${secs !== null ? `, after ${secs} s` : ''})`;
	const mb = f?.source?.bytes !== undefined ? `${(f.source.bytes / 1048576).toFixed(1)} MB` : 'unknown size';
	const facts = sanitizeSourceFacts(ev.sourceFacts);
	const lines = [
		`stage: ${f?.stage ?? 'unknown'}${f?.stageDetail ? ` (${f.stageDetail})` : ''}`,
		`error: ${err}`,
		`attempt: ${f?.attempt ?? ev.attempt}`,
		`elapsed: ${secs ?? '?'} s`,
		`source: ${f?.source?.file ?? 'unknown'} (${mb})`,
		...(facts ? [`source is: ${sourceFactsLine(facts)}`] : []),
		...(f?.exitCode !== undefined ? [`exit code: ${f.exitCode}`] : []),
		...(f?.stopReason ? [`stop reason: ${f.stopReason}`] : []),
		...(f?.instanceId ? [`instance: ${f.instanceId}`] : []),
		`job: ${ev.jobId}`,
		...(f?.stderrTail?.length ? ['', 'ffmpeg (last lines):', ...f.stderrTail] : []),
	];
	const error = new Error(summary);
	error.name = 'R2TranscodeFailed';
	error.stack = lines.join('\n');
	return {
		summary,
		error,
		extra: {
			videoId: ev.videoId,
			jobId: ev.jobId,
			attempt: f?.attempt ?? ev.attempt,
			stage: f?.stage ?? null,
			elapsedS: secs,
			sourceFile: f?.source?.file ?? null,
			sourceMB: f?.source?.bytes !== undefined ? Math.round(f.source.bytes / 104857.6) / 10 : null,
			exitCode: f?.exitCode ?? null,
			sourceIs: facts ? sourceFactsLine(facts) : null,
			instanceId: f?.instanceId ? f.instanceId.slice(0, 64) : null,
		},
	};
}

const needsActionKey = (videoId: string) => `media-transcode:${videoId}`;

/** An event from apps/media. Events of an older job are ignored. */
/**
 * The stored form of a ready R2 rendition's frame: the public URL, or for a private one the /priv/
 * path with a placeholder token (the signing middleware signs it per response for the video's
 * owner object only; lib/bunny-signing.ts). Null when there is no ready rendition.
 */
export function storedR2Frame(host: string | undefined, video: MediaVideo): string | null {
	const r2 = shownR2(video);
	if (!host || !r2) return null;
	return r2.access === 'pub' ? `https://${host}/pub/${video.id}/${r2.rev}/${MEDIA_THUMBNAIL}` : `https://${host}/priv/-/${video.id}/${r2.rev}/${MEDIA_THUMBNAIL}`;
}

type SoleCopyVideo = MediaVideo & {
	thumbnailUrl?: string;
	thumbnailType?: string;
	thumbnailSizes?: Record<string, string>;
	thumbnailPending?: boolean;
	processingIssue?: { kind: string; reason?: string; at: string; code?: string };
	availableResolutions?: string[];
	width?: number;
	height?: number;
	duration?: number;
	publishedAt?: string;
};

/** R2 is the copy that decides the video's state: Bunny holds none, or Bunny's failed. */
export function r2DecidesState(video: { media?: VideoMediaProviders }): boolean {
	const m = video.media;
	return !!m?.providers.r2 && (!m.providers.bunny || m.providers.bunny.status === 'failed');
}

/** A copy of the video that plays: it is ready, an earlier rendition is kept, or a provider holds one. */
function hasReadyCopy(video: SoleCopyVideo): boolean {
	return video.uploadStatus === 'ready' || !!video.r2?.previous || Object.values(video.media?.providers ?? {}).some((p) => p?.status === 'ready');
}

/** The stored provider describes the available copy. Admin job views read r2.status directly. */
export function refreshR2Provider(video: MediaVideo): void {
	const ref = video.media?.providers.r2;
	const job = video.r2;
	if (!ref || !job) return;
	const shown = shownR2(video);
	ref.status = shown ? 'ready' : job.status === 'failed' || job.status === 'cancelled' ? 'failed' : 'processing';
	if (shown?.readyAt) ref.readyAt = shown.readyAt;
	else delete ref.readyAt;
	if (ref.status === 'failed' && job.error) ref.error = job.error;
	else delete ref.error;
}

/** Point a non-custom thumbnail that is (or should be) the R2 frame at the current rendition. */
function refreshR2Frame(video: SoleCopyVideo, host: string | undefined): void {
	if (video.thumbnailType === 'custom') return;
	const frame = storedR2Frame(host, video);
	if (!frame || video.thumbnailUrl === frame) return;
	const current = video.thumbnailUrl;
	const isR2Frame = !!current && isR2FrameOf(current, video.id, host);
	if (!current || isR2Frame || r2DecidesState(video)) {
		video.thumbnailUrl = frame;
		video.thumbnailType = 'auto';
		delete video.thumbnailSizes;
		delete video.thumbnailPending;
	}
}

/**
 * R2 decides the video's state and its rendition is ready: the video turns ready the way Bunny's
 * sync makes it ready (lib/processing/sync.ts). Mutates; true when it turned ready now.
 */
function readyFromR2(v: SoleCopyVideo, at: string, host: string | undefined): boolean {
	const result = shownR2(v)?.result ?? (v.r2?.status === 'ready' ? v.r2.result : undefined);
	if (!r2DecidesState(v) || !result) return false;
	refreshR2Frame(v, host);
	if (v.uploadStatus === 'ready') return false;
	const before = { ...v };
	v.uploadStatus = 'ready';
	v.playableAt ??= at;
	delete v.processingIssue;
	const src = result.source;
	if (src?.width) v.width = src.width;
	if (src?.height) v.height = src.height;
	const seconds = result.durationSeconds || src?.durationSeconds;
	if (seconds) v.duration = Math.round(seconds);
	v.availableResolutions = result.rungs.map((rung) => rung.name);
	markPublished(before as never, v as never, v.playableAt);
	return true;
}

/**
 * Bunny's copy just failed and R2's was already ready (Bunny's sync, lib/processing/loop.ts): the
 * video turns ready from R2 now. Idempotent; never throws.
 */
export async function promoteR2Copy(env: MediaEnv, videoId: string): Promise<boolean> {
	try {
		let turned = false;
		const saved = await repo(env).updateObject(videoId, (video) => {
			turned = readyFromR2(video as SoleCopyVideo, new Date().toISOString(), env.MEDIA_PUBLIC_HOST);
			return turned;
		});
		if (saved && turned) {
			const { announceAndRecordProcessingResult } = await import('../notification-events');
			await announceAndRecordProcessingResult(env as never, { ...(saved as object), id: videoId } as never, 'ready');
			logger.warn('[Media] Bunny failed; the video plays from R2', { videoId });
		}
		return turned;
	} catch (error) {
		logger.error('[Media] Could not make the video ready from R2', { videoId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** The container's word on pre-encoded renditions, kept only in the shape Studio reads (D11). */
export function withPrebuiltOutcome(result: TranscodeResult): TranscodeResult {
	const p = (result as { prebuilt?: { used?: unknown; reason?: unknown; rung?: unknown } }).prebuilt;
	const { prebuilt: _drop, ...rest } = result as TranscodeResult & { prebuilt?: unknown };
	if (!p || typeof p !== 'object') return rest as TranscodeResult;
	const reason = typeof p.reason === 'string' && (PREBUILT_REJECTIONS as readonly string[]).includes(p.reason) ? (p.reason as PrebuiltRejection) : undefined;
	const rung = typeof p.rung === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(p.rung) ? p.rung : undefined;
	return { ...rest, prebuilt: { used: p.used === true, ...(p.used === true ? {} : { reason: reason ?? 'error' }), ...(rung && p.used !== true ? { rung } : {}) } } as TranscodeResult;
}

export async function applyJobEvent(
	env: MediaEnv & ErrorReporterEnv,
	ctx: ExecutionContextLike | undefined,
	ev: TranscodeJobEvent,
): Promise<{ applied: boolean; why?: string }> {
	let why: string | undefined;
	let retired: RetiredR2Rendition | undefined;
	let transition: 'ready' | 'failed' | null = null;
	let droppedGuid: string | undefined;
	const saved = await repo(env).updateObject(ev.videoId, (video) => {
		why = undefined;
		transition = null;
		retired = undefined;
		droppedGuid = undefined;
		const r2 = video.r2;
		if (!r2 || r2.jobId !== ev.jobId) {
			why = 'stale job';
			return false;
		}
		if (r2.status === 'ready' || r2.status === 'cancelled' || (r2.status === 'failed' && ev.type !== 'ready')) {
			why = `already ${r2.status}`;
			return false;
		}
		r2.attempts = Math.max(r2.attempts ?? 0, ev.attempt ?? 1);
		if (ev.containerSeconds !== undefined) r2.containerSeconds = ev.containerSeconds;
		if (ev.instanceType) r2.instanceType = ev.instanceType;
		const rungs = sanitizeRungs(ev.rungs);
		if (ev.type === 'started') {
			r2.status = 'transcoding';
			r2.startedAt ??= ev.at;
			// How the attempt started (the container sends it again with FFmpeg's time)
			const startup = sanitizeStartup(ev.startup);
			if (startup) r2.startup = startup;
			// A new attempt (sent at launch, before the container's first progress): the last one's rung states no longer apply
			delete r2.rungs;
		} else if (ev.type === 'progress') {
			r2.status = 'transcoding';
			r2.progress = ev.progress;
			if (rungs) r2.rungs = rungs;
		} else if (ev.type === 'ready') {
			if (!ev.result) {
				why = 'ready without result';
				return false;
			}
			r2.status = 'ready';
			r2.readyAt = ev.at;
			r2.result = withPrebuiltOutcome(ev.result);
			r2.rungs = ev.result.rungs.map((r) => ({ name: r.name, state: 'done' as const }));
			delete r2.error;
			delete r2.progress;
			retired = retirePrevious(video);
			refreshR2Frame(video as SoleCopyVideo, env.MEDIA_PUBLIC_HOST);
			// R2 is the video's playable copy (docs/media-delivery/PROVIDERS.md §R2 only): it makes the
			// video ready the way Bunny's sync does (lib/processing/sync.ts planSync/applyPlan)
			if (readyFromR2(video as SoleCopyVideo, ev.at, env.MEDIA_PUBLIC_HOST)) transition = 'ready';
			// The file came again and plays: Bunny's copy of the other bytes goes (never under a hold)
			const refused = (video as SoleCopyVideo).media?.providers.bunny;
			if (refused && bunnyCopyRefused(video as SoleCopyVideo) && !underHold(video as never)) {
				droppedGuid = refused.ref;
				delete (video as SoleCopyVideo).media!.providers.bunny;
				Object.assign(video, { bunnyRemoved: { at: ev.at, guid: refused.ref, libraryId: refused.libraryId } });
			}
		} else if (ev.type === 'failed') {
			r2.error = scrubMediaText(ev.error ?? 'failed', 500);
			if (ev.failure) r2.failure = sanitizeFailure(ev.failure);
			if (rungs) r2.rungs = rungs;
			if (ev.final) {
				r2.status = 'failed';
				r2.failedAt = ev.at;
				// The only copy failed: the video failed (the uploader is told; Errors page has Retry)
				const v = video as SoleCopyVideo;
				if (isSourceChangedError(r2.error)) {
					// The kept original is not the file that was sent (source-changed.ts): a copy that plays keeps playing
					if (!hasReadyCopy(v)) {
						if (v.uploadStatus !== 'failed') transition = 'failed';
						v.uploadStatus = 'failed';
						v.processingIssue = { kind: 'needs_reupload', reason: SOURCE_CHANGED_REASON, at: ev.at, code: SOURCE_CHANGED };
						const bunny = v.media?.providers.bunny;
						if (bunny) Object.assign(bunny, { status: 'failed', error: SOURCE_CHANGED });
					}
				} else if (r2DecidesState(v) && !r2.previous && v.uploadStatus !== 'ready' && (v.uploadStatus !== 'failed' || v.processingIssue?.kind === 'encode_failed')) {
					// A retry that failed again: why it failed now (the uploader was told already)
					if (v.uploadStatus !== 'failed') transition = 'failed';
					v.uploadStatus = 'failed';
					v.processingIssue = { kind: 'encode_failed', reason: 'The video could not be processed', at: ev.at, ...issueCodeOf(ev) };
				}
			}
		}
		// D11: the job took the pre-encoded renditions (used or not); their staging is gone with it
		if (ev.type === 'ready' || (ev.type === 'failed' && ev.final)) delete (video as { prebuilt?: unknown }).prebuilt;
		refreshR2Provider(video);
		video.dateModified = new Date().toISOString();
		return true;
	});
	if (!saved) return { applied: false, why: 'video not found' };
	if (why) {
		if (why === 'already ready' && ev.type === 'ready') {
			await Promise.all((saved.r2?.retired ?? []).map((r) => queueRetiredRendition(env, saved, r)));
			await reconcileRenditions(env, saved);
		}
		return { applied: false, why };
	}
	if (transition) {
		// Same downstream path as Bunny's: uploader notification, subscriber fan-out (lib/notification-events.ts)
		const { announceAndRecordProcessingResult } = await import('../notification-events');
		await announceAndRecordProcessingResult(env as never, { ...(saved as object), id: ev.videoId } as never, transition);
	}
	// Live admin view (admin:media, docs/admin/LIVE_OPS.md): this job, then the transcoder figures
	pushMediaLive(env, ctx, saved);
	if (ev.type !== 'progress') await recordJob(env, saved);
	if (ev.type === 'failed') await recordSourceFacts(env, ev);

	if (ev.type === 'ready') {
		resolveNeedsAction(env, ctx, needsActionKey(ev.videoId));
		// The old revision stays available to clients holding URLs from before cutover.
		if (droppedGuid) await enqueueBunnyDelete(env.PROCESSING_CHECK_QUEUE, droppedGuid, 'source-changed-replaced');
		if (retired) await queueRetiredRendition(env, saved, retired);
		// Visibility changed while it transcoded: move it now
		const drift = accessDrift(saved);
		if (drift) await queueMediaMove(env, ev.videoId, drift);
		// Audio tracks (wiki AUN-MULTI-AUDIO): a new rendition gets its own demuxed package
		else {
			const { onRenditionReady } = await import('../audio-tracks/service');
			await onRenditionReady(env as never, ctx, saved as never).catch((error) => logger.warn('[Media] Could not queue the audio package', { videoId: ev.videoId, error: error instanceof Error ? error.message : String(error) }));
		}
		// Pre-publication review: the job extracted the review media (or tried to); a gated video is
		// always checked, partially when there is no manifest (it then waits for a person)
		const gated = (saved as { review?: { status?: string; scanQueuedAt?: string } }).review;
		const reviewMedia = ev.result?.review;
		if (reviewMedia || (gated?.status === 'checking' && !gated.scanQueuedAt)) {
			await queueReviewScan(env as never, ev.videoId, { trigger: 'upload', manifestKey: reviewMedia?.manifestKey });
		}
	}
	if (ev.type === 'failed' && ev.final) {
		const gated = (saved as { review?: { status?: string; scanQueuedAt?: string } }).review;
		if (gated?.status === 'checking' && !gated.scanQueuedAt) await queueReviewScan(env as never, ev.videoId, { trigger: 'upload' });
	}
	if (ev.type === 'failed' && ev.final) {
		const failure = ev.failure ? sanitizeFailure(ev.failure) : undefined;
		const details = failureDetails(ev, failure);
		const changed = isSourceChangedError(saved.r2?.error);
		reportNeedsAction('api-videos', env, ctx, {
			key: needsActionKey(ev.videoId),
			source: 'processing',
			title: changed
				? `${SOURCE_CHANGED_REASON}: ${(saved as SoleCopyVideo).uploadStatus === 'failed' ? 'import it again' : 'the copy that plays is kept'}`
				: saved.r2?.previous ? 'R2 re-encode failed (the previous copy is kept)'
					: r2DecidesState(saved as SoleCopyVideo) ? 'Video processing failed (R2 is its only copy)' : 'R2 transcode failed (Bunny unaffected)',
			message: details.summary,
			// The Errors page shows this as the item's details (expandable)
			error: details.error,
			itemType: 'video',
			itemId: ev.videoId,
			// The one place that says why and what to do
			itemUrl: `/delivery?video=${encodeURIComponent(ev.videoId)}#transcode-troubleshooting`,
			// The same bytes fail the same way
			...(!saved.r2?.previous && (changed || issueCodeOf(ev).code)
				? {}
				: { retry: { kind: 'service' as const, service: 'api-videos', path: '/internal/media/retry', body: { ids: [ev.videoId] } }, retryLabel: 'Transcode again' }),
			extra: details.extra,
		});
	}
	return { applied: true };
}

// ---------------------------------------------------------------------------
// Source and play URLs
// ---------------------------------------------------------------------------

const MP4_FALLBACKS = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

/**
 * Source files to try, best first (pure; tested). Bunny's kept original when Bunny
 * says it has one (`hasOriginal`), then its MP4 fallbacks at the resolutions Bunny
 * encoded, highest first; unknown resolutions: every standard one.
 *
 * Bunny's CDN answers 403 for /<id>/original even when the original exists and the
 * request is correctly signed (checked 2026-11-12 on QA pull zone 4943033 and
 * production library 400189: the same token serves playlist.m3u8 and
 * play_1080p.mp4). The original stays first so it is used as soon as Bunny serves
 * it; until then the highest MP4 (up to 1080p) is the source.
 */
export function sourceFiles(bunny: { hasOriginal?: boolean | null; availableResolutions?: string | null } | null): string[] {
	const listed = (bunny?.availableResolutions ?? '').split(',').map((r) => r.trim()).filter(Boolean);
	const mp4 = (listed.length ? MP4_FALLBACKS.filter((r) => listed.includes(r)) : MP4_FALLBACKS).map((r) => `play_${r}.mp4`);
	return bunny?.hasOriginal === false ? mp4 : ['original', ...mp4];
}

/**
 * Signed source URLs, best first (sourceFiles). Directory token in the path when the
 * library uses token auth (Bunny refuses the query-form token for these files).
 */
export async function sourceCandidates(env: MediaEnv, videoId: string, record?: LibraryHints | null): Promise<string[]> {
	// The video's own library (host and token key; lib/bunny/libraries.ts)
	// Bunny's id of the video; none when Bunny holds no copy (the original is then the only source)
	const guid = record ? usableBunnyRef({ id: videoId, ...record }) : videoId;
	if (!guid) return [];
	const library = await bunnyLibraryForVideo(env as BunnyLibrariesEnv, record);
	const host = library.host;
	if (!host) return [];
	let bunny: { hasOriginal?: boolean | null; availableResolutions?: string | null } | null = null;
	try {
		// In the video's own library
		bunny = (await fetchBunnyVideo(env as never, guid, record ?? undefined)) as never;
	} catch (error) {
		logger.warn('[Media] Bunny video lookup failed; trying every source', { videoId, error: error instanceof Error ? error.message : String(error) });
	}
	const files = sourceFiles(bunny);
	if (library.tokenKey) {
		const expires = tokenExpiry();
		const token = await bunnyDirectoryToken(library.tokenKey, guid, expires);
		return files.map((f) => signedBunnyUrl(host, guid, f, token, expires));
	}
	return files.map((f) => `https://${host}/${guid}/${f}`);
}

/** The first candidate (the original): kept for callers that want one URL. */
export async function sourceUrl(env: MediaEnv, videoId: string, record?: LibraryHints | null): Promise<string | null> {
	return (await sourceCandidates(env, videoId, record))[0] ?? null;
}

/** Playable R2 URLs of a ready video (private ones signed), or null. */
export async function r2Urls(env: MediaEnv, video: MediaVideo): Promise<{ playUrl: string; thumbnailUrl: string } | null> {
	const r2 = shownR2(video);
	if (!r2 || !env.MEDIA_PUBLIC_HOST) return null;
	const sign = r2.access === 'priv' ? { key: await getSecret(env.MEDIA_SIGN_KEY, 'MEDIA_SIGN_KEY') } : undefined;
	if (r2.access === 'priv' && !sign?.key) return null;
	// A video with extra audio tracks plays its demuxed package (wiki AUN-MULTI-AUDIO MA1, MA3)
	const master = audioPackageMaster(video) ?? MEDIA_MASTER;
	return {
		playUrl: await mediaPlayUrl(env.MEDIA_PUBLIC_HOST, r2.access, video.id, r2.rev, master, sign),
		// The frame alone: a file token (it may be shown where the playlist is not)
		thumbnailUrl: sign ? await mediaFrameUrl(env.MEDIA_PUBLIC_HOST, video.id, r2.rev, sign.key) : await mediaPlayUrl(env.MEDIA_PUBLIC_HOST, 'pub', video.id, r2.rev, MEDIA_THUMBNAIL),
	};
}

/**
 * The stable public MP4 of a public video (D-SEO-11): search engines' VideoObject contentUrl.
 * Only for a ready R2 rendition under pub/ whose transcode made the MP4 (a remux of the 480p rung);
 * never for private, unlisted or removed videos (their media is under priv/ or gone), never signed,
 * and stable for the rendition's rev (cached immutable by the CDN). Bunny-only videos: null.
 */
export function publicMp4Url(env: Pick<MediaEnv, 'MEDIA_PUBLIC_HOST'>, video: MediaVideo): string | null {
	const path = env.MEDIA_PUBLIC_HOST ? publicMp4Path(video) : null;
	return path ? `https://${env.MEDIA_PUBLIC_HOST}/${path}` : null;
}

/**
 * A remux-only job's end (apps/media, the public MP4 backfill #1182). The MP4 is recorded only on
 * the served rendition it was made from: same rev and access, with no MP4 already recorded.
 */
export async function applyMp4Event(env: Pick<MediaEnv, 'videos'>, ev: Mp4JobEvent): Promise<{ applied: boolean; why?: string }> {
	if (ev.type === 'failed') {
		logger.warn('[Media] MP4 remux failed', { videoId: ev.videoId, jobId: ev.jobId, rev: ev.rev, error: scrubMediaText(ev.error ?? 'failed', 300) });
		return { applied: false, why: 'failed' };
	}
	const mp4 = sanitizeMp4(ev.mp4);
	if (!mp4) return { applied: false, why: 'bad result' };
	let why: string | undefined;
	const saved = await repo(env as MediaEnv).updateObject(ev.videoId, (video) => {
		why = undefined;
		const r2 = shownR2(video);
		if (!r2?.result) {
			why = 'not ready';
			return false;
		}
		if (r2.rev !== ev.rev || r2.access !== ev.access) {
			why = 'stale rendition';
			return false;
		}
		if (r2.result.mp4) {
			why = 'already has an MP4';
			return false;
		}
		r2.result.mp4 = mp4;
		return true;
	});
	if (!saved) return { applied: false, why: 'video not found' };
	return why ? { applied: false, why } : { applied: true };
}

/**
 * The owner's view of the R2 side (GET /api/videos/:id/upload-status), without
 * container timings or costs. The release gate (apps/web/e2e/release/media-delivery.spec.ts)
 * waits on `status` and fetches `playUrl`, which is there whatever the delivery switch says.
 */
export interface OwnerR2View {
	/** A cancelled job reads as failed here (the public contract has no "cancelled") */
	status: Exclude<VideoR2State['status'], 'cancelled'>;
	access: MediaAccess;
	rev: string;
	attempts: number;
	queuedAt: string;
	startedAt?: string;
	readyAt?: string;
	failedAt?: string;
	error?: string;
	/** Rungs the transcode wrote (720p, 480p, ...) */
	renditions: string[];
	/** Master playlist of the served rendition, signed when private */
	playUrl?: string;
}

export async function ownerR2View(env: MediaEnv, video: MediaVideo | null | undefined): Promise<OwnerR2View | undefined> {
	const r2 = video?.r2;
	if (!video || !r2) return undefined;
	const shown = shownR2(video);
	let playUrl: string | undefined;
	try {
		playUrl = (await r2Urls(env, video))?.playUrl;
	} catch (error) {
		logger.warn('[Media] Could not build the R2 play URL', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
	}
	return {
		status: r2.status === 'cancelled' ? 'failed' : r2.status,
		access: shown?.access ?? r2.access,
		rev: shown?.rev ?? r2.rev,
		attempts: r2.attempts ?? 0,
		queuedAt: r2.queuedAt,
		...(r2.startedAt ? { startedAt: r2.startedAt } : {}),
		...(shown?.readyAt ? { readyAt: shown.readyAt } : {}),
		...(r2.failedAt ? { failedAt: r2.failedAt } : {}),
		...(r2.error ? { error: r2.error } : {}),
		renditions: shown?.result?.rungs.map((rung) => rung.name) ?? [],
		...(playUrl ? { playUrl } : {}),
	};
}

// ---------------------------------------------------------------------------
// Objects: delete, move, purge
// ---------------------------------------------------------------------------

function bucketOf(env: MediaEnv, access: MediaAccess): R2Bucket | undefined {
	return access === 'priv' ? env.MEDIA_PRIVATE : env.MEDIA;
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects) keys.push(o.key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return keys;
}

async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
	for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}

async function deleteRendition(env: MediaEnv, videoId: string, access: MediaAccess, rev: string): Promise<number> {
	const bucket = bucketOf(env, access);
	if (!bucket) throw new Error('media bucket is not bound');
	const keys = await listKeys(bucket, `${access}/${videoId}/${rev}/`);
	await deleteKeys(bucket, keys);
	if (access === 'pub') await purgeRenditionCdn(env, videoId, rev);
	return keys.length;
}

// Cloudflare Queues accepts a delay of at most 12 hours per message.
const MAX_RETIRE_QUEUE_DELAY = 12 * 60 * 60;
const PUBLIC_REVOCATION_PREFIX = 'ops/media/public-revocations/';
const PUBLIC_REVOCATION_CURSOR = 'ops/media/public-revocation-cursor';

async function queueRetiredRendition(env: MediaEnv, video: MediaVideo, rendition: RetiredR2Rendition, now = Date.now()): Promise<void> {
	const revoke = rendition.access === 'pub' && desiredAccess(video) === 'priv';
	const delay = revoke ? 0 : Math.ceil((rendition.deleteAfter - now) / 1000);
	const message: MediaRetireMessage = { kind: MEDIA_RETIRE_KIND, videoId: video.id, rev: rendition.rev };
	try {
		if (!env.PROCESSING_CHECK_QUEUE && revoke) throw new Error('processing check queue is not bound');
		await env.PROCESSING_CHECK_QUEUE?.send(message, { delaySeconds: Math.max(0, Math.min(MAX_RETIRE_QUEUE_DELAY, delay)) });
	} catch (error) {
		if (!revoke) throw error;
		logger.warn('[Media] Could not queue public rendition revocation; trying directly', { videoId: video.id, rev: rendition.rev });
		// Track the retry before touching the objects, independently of a video record that can be deleted.
		const pending = env.global_settings;
		const key = `${PUBLIC_REVOCATION_PREFIX}${message.videoId}/${message.rev}`;
		const saved = await pending?.put(key, '').catch(() => null);
		try {
			await revokeRetiredPublicRendition(env, message);
			if (saved) await pending?.delete(key);
		} catch (revocationError) {
			if (!saved) throw revocationError;
			logger.warn('[Media] Public rendition revocation will retry in the sweep', { videoId: video.id, rev: rendition.rev, error: String(revocationError) });
		}
	}
}

function isActiveRevision(video: MediaVideo, rev: string): boolean {
	return video.r2?.rev === rev || video.r2?.previous?.rev === rev;
}

async function retireRendition(env: MediaEnv, msg: MediaRetireMessage, now: number): Promise<void> {
	const video = await repo(env).getObject(msg.videoId);
	const retired = video?.r2?.retired?.find((r) => r.rev === msg.rev);
	if (!video || !retired || isActiveRevision(video, msg.rev)) return;
	const revoke = retired.access === 'pub' && desiredAccess(video) === 'priv';
	if (!revoke && now < retired.deleteAfter) {
		await queueRetiredRendition(env, video, retired, now);
		return;
	}
	await removeRetiredRendition(env, msg, retired.access);
}

/** An immediate revocation can outlive the video record. A restored video keeps its normal grace period. */
async function revokeRetiredPublicRendition(env: MediaEnv, msg: MediaRetireMessage): Promise<void> {
	const video = await repo(env).getObject(msg.videoId);
	if (video && (desiredAccess(video) === 'pub' || isActiveRevision(video, msg.rev))) return;
	await removeRetiredRendition(env, msg, 'pub');
}

async function removeRetiredRendition(env: MediaEnv, msg: MediaRetireMessage, access: MediaAccess): Promise<void> {
	await deleteRendition(env, msg.videoId, access, msg.rev);
	await repo(env).updateObject(msg.videoId, (fresh) => {
		const r2 = fresh.r2;
		if (!r2?.retired?.some((r) => r.rev === msg.rev)) return false;
		r2.retired = r2.retired.filter((r) => r.rev !== msg.rev);
		if (!r2.retired.length) delete r2.retired;
		return true;
	});
}

/** Retry public object deletion and CDN purge even during a queue outage. */
export async function sweepPublicRenditionRevocations(env: MediaEnv): Promise<void> {
	const pending = env.global_settings;
	if (!pending) return;
	const startAfter = await (await pending.get(PUBLIC_REVOCATION_CURSOR))?.text();
	const page = await pending.list({ prefix: PUBLIC_REVOCATION_PREFIX, startAfter, limit: 25 });
	for (const { key } of page.objects) {
		const [videoId, rev] = key.slice(PUBLIC_REVOCATION_PREFIX.length).split('/');
		const msg = { kind: MEDIA_RETIRE_KIND, videoId, rev };
		if (!isMediaRetireMessage(msg)) continue;
		try {
			await revokeRetiredPublicRendition(env, msg);
			await pending.delete(key);
		} catch (error) {
			logger.warn('[Media] Public rendition revocation still pending', { videoId, rev, error: String(error) });
		}
	}
	// Advance past failures so one broken revision cannot block subsequent pages.
	const last = page.objects.at(-1);
	if (page.truncated && last) await pending.put(PUBLIC_REVOCATION_CURSOR, last.key);
	else if (startAfter) await pending.delete(PUBLIC_REVOCATION_CURSOR);
}

/** A video's copies on the CDN (every rendition). `strict`: throws when the purge failed. */
export async function purgeVideoCdn(env: MediaEnv, videoId: string, opts: { strict?: boolean } = {}): Promise<void> {
	let status: number | null = null;
	const purged = await purgeCdnPrefix(env, `${videoId}/`, (s) => (status = s));
	if (opts.strict && purged === 'failed') throw new Error(cdnPurgeProblem(status));
}

/** What D1 holds of a video's R2 media: its original's row is closed, its backfill rows go (docs/media-delivery/BACKFILL.md). */
export async function forgetVideoMedia(env: MediaEnv, videoId: string): Promise<void> {
	await closeOriginal(env as never, videoId);
	const db = (env as { SEARCH_DB?: D1Database }).SEARCH_DB;
	if (!db) return;
	await db.batch(['media_r2_verified', 'media_bunny_removals', 'media_backfill_items'].map((table) => db.prepare(`DELETE FROM ${table} WHERE video_id = ?1`).bind(videoId)));
}

/** Every rendition of a video, both buckets, purged from the CDN; the original stays. Idempotent. */
export async function purgeVideoRenditions(env: MediaEnv, videoId: string, opts: { strict?: boolean } = {}): Promise<number> {
	let n = 0;
	for (const access of ['pub', 'priv'] as const) {
		const bucket = bucketOf(env, access);
		if (!bucket) continue;
		const keys = await listKeys(bucket, `${access}/${videoId}/`);
		await deleteKeys(bucket, keys);
		n += keys.length;
	}
	// The CSAM takedown purges even when nothing is left in R2: the CDN may still hold copies
	if (n || opts.strict) await purgeVideoCdn(env, videoId, opts);
	return n;
}

/** Every R2 object of a video, both buckets (the 30-day purge, promote, erase). Idempotent. */
export async function purgeVideoMedia(env: MediaEnv, videoId: string): Promise<number> {
	let n = await purgeVideoRenditions(env, videoId);
	// Custom thumbnails stored on R2 (lib/thumbnail/store.ts)
	if (env.MEDIA) {
		const thumbs = await listKeys(env.MEDIA, r2ThumbnailPrefix(videoId));
		await deleteKeys(env.MEDIA, thumbs);
		n += thumbs.length;
	}
	// The kept original (docs/media-delivery/ORIGINALS.md)
	n += await deleteOriginal(env as never, videoId);
	// Audio track files (wiki AUN-MULTI-AUDIO)
	const { purgeVideoAudio } = await import('../audio-tracks/service');
	n += await purgeVideoAudio(env as never, videoId);
	await forgetVideoMedia(env, videoId);
	return n;
}

export type CdnPurge = 'purged' | 'not_configured' | 'failed';

/** Told when a purge failed: Cloudflare's status, or null when it did not answer. */
export type PurgeFailed = (status: number | null) => void;

/** What to say, and do, about a purge that failed. A refusal is the token's: trying again does not help. */
export function cdnPurgeProblem(status: number | null): string {
	if (status === 401 || status === 403) {
		return `Cloudflare refused the cache purge (${status}): the token in the Secrets Store secret media-cdn-api-token may not purge the alummahnow.net zone. Give it the Cache Purge permission on that zone, or store one that has it, then Retry.`;
	}
	return `Cloudflare cache purge failed${status === null ? '' : ` (${status})`}`;
}

async function purgeRenditionCdn(env: MediaEnv, videoId: string, rev: string): Promise<void> {
	let status: number | null = null;
	if (await purgeCdnPrefix(env, `${videoId}/${rev}/`, (s) => (status = s)) === 'failed') throw new Error(cdnPurgeProblem(status));
}

/** Drops cached copies of pub/<rest> from the CDN when a zone token with Cache Purge is set. */
async function purgeCdnPrefix(env: MediaEnv, rest: string, onFailed?: PurgeFailed): Promise<CdnPurge> {
	if (!env.MEDIA_PUBLIC_HOST) return 'not_configured';
	return purgeCdn(env, { prefixes: [`${env.MEDIA_PUBLIC_HOST}/pub/${rest}`] }, onFailed);
}

/**
 * Cloudflare cache purge on the alummahnow.net zone (by URL or by prefix). Never throws:
 * 'not_configured' without a zone token, 'failed' when the API refused.
 */
export async function purgeCdn(env: Pick<MediaEnv, 'MEDIA_CDN_API_TOKEN'>, body: { files: string[] } | { prefixes: string[] }, onFailed?: PurgeFailed): Promise<CdnPurge> {
	if (!env.MEDIA_CDN_API_TOKEN) return 'not_configured';
	const list = 'files' in body ? body.files : body.prefixes;
	if (!list.length) return 'purged';
	try {
		const token = await getSecret(env.MEDIA_CDN_API_TOKEN, 'MEDIA_CDN_API_TOKEN');
		if (!token) return 'not_configured';
		// The API takes at most 30 URLs or prefixes per call
		for (let i = 0; i < list.length; i += 30) {
			const part = list.slice(i, i + 30);
			const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify('files' in body ? { files: part } : { prefixes: part }),
			});
			if (!res.ok) {
				logger.warn('[Media] CDN purge failed', { status: res.status, count: part.length });
				onFailed?.(res.status);
				return 'failed';
			}
		}
		return 'purged';
	} catch (error) {
		logger.warn('[Media] CDN purge failed', { error: error instanceof Error ? error.message : String(error) });
		onFailed?.(null);
		return 'failed';
	}
}

/** The same, for work that is not done until the CDN was told: throws, saying why and what to do. */
export async function purgeCdnOrThrow(env: Pick<MediaEnv, 'MEDIA_CDN_API_TOKEN'>, body: { files: string[] } | { prefixes: string[] }): Promise<Exclude<CdnPurge, 'failed'>> {
	let status: number | null = null;
	const purged = await purgeCdn(env, body, (s) => (status = s));
	if (purged === 'failed') throw new Error(cdnPurgeProblem(status));
	return purged;
}

/** Mark the move on the record and queue it (the processing-check queue carries it). */
export async function queueMediaMove(env: MediaEnv, videoId: string, to: MediaAccess): Promise<boolean> {
	if (!env.PROCESSING_CHECK_QUEUE) return false;
	const moveId = crypto.randomUUID();
	let message: MediaMoveMessage | undefined;
	await repo(env).updateObject(videoId, (video) => {
		message = undefined;
		if (desiredAccess(video) !== to) return false;
		const rendition = renditionToMove(video, to);
		if (!rendition) return false;
		rendition.moving = { to, jobId: moveId, at: new Date().toISOString() };
		message = { kind: MEDIA_MOVE_KIND, videoId, moveId, to, from: rendition.access, rev: rendition.rev };
		return true;
	});
	if (!message) return false;
	try {
		await env.PROCESSING_CHECK_QUEUE.send(message);
	} catch (error) {
		await repo(env).updateObject(videoId, (video) => {
			const rendition = completedRenditions(video.r2).find((r) => r.moving?.jobId === moveId);
			if (!rendition) return false;
			delete rendition.moving;
			return true;
		});
		throw error;
	}
	return true;
}

/** Copy a completed rendition, then switch its prefix and remove the old objects. */
export async function moveMedia(env: MediaEnv, msg: MediaMoveMessage): Promise<'moved' | 'stale' | 'nothing'> {
	const video = await repo(env).getObject(msg.videoId);
	if (!video?.r2) return 'nothing';
	const rendition = completedRenditions(video.r2).find((r) => r.moving?.jobId === msg.moveId);
	if (!rendition) {
		// Redelivery after the record switched: finish any cleanup that failed after the write.
		if (msg.rev && msg.from && msg.from !== msg.to && desiredAccess(video) === msg.to &&
			[...completedRenditions(video.r2), ...(video.r2.retired ?? [])].some((r) => r.rev === msg.rev && r.access === msg.to)) {
			await deleteRendition(env, msg.videoId, msg.from, msg.rev);
		}
		await Promise.all((video.r2.retired ?? []).map((r) => queueRetiredRendition(env, video, r)));
		await reconcileRenditions(env, video);
		return 'stale';
	}
	if (desiredAccess(video) !== msg.to || rendition.access === msg.to) return 'stale';
	const { access: from, rev } = rendition;
	const src = bucketOf(env, from);
	const dst = bucketOf(env, msg.to);
	if (!src || !dst) throw new Error('media buckets are not bound');
	const keys = await listKeys(src, `${from}/${msg.videoId}/${rev}/`);
	for (let i = 0; i < keys.length; i += 8) {
		await Promise.all(
			keys.slice(i, i + 8).map(async (key) => {
				const obj = await src.get(key);
				if (obj) await dst.put(`${msg.to}/${key.slice(from.length + 1)}`, obj.body, { httpMetadata: obj.httpMetadata });
			}),
		);
	}
	let switched = false;
	let retired: RetiredR2Rendition | undefined;
	const saved = await repo(env).updateObject(msg.videoId, (fresh) => {
		switched = false;
		retired = undefined;
		const target = completedRenditions(fresh.r2).find((r) => r.rev === rev && r.moving?.jobId === msg.moveId);
		if (!target || desiredAccess(fresh) !== msg.to) return false;
		target.access = msg.to;
		delete target.moving;
		const pkg = fresh.audioPackage;
		if (pkg?.rev === rev) pkg.access = msg.to;
		retired = retirePrevious(fresh);
		refreshR2Frame(fresh as SoleCopyVideo, env.MEDIA_PUBLIC_HOST);
		refreshR2Provider(fresh);
		switched = true;
		return true;
	});
	if (!switched) {
		// A duplicate or newer move may still need the destination we just wrote.
		const destinationClaimed = completedRenditions(saved?.r2).some((r) =>
			r.rev === rev && (r.access === msg.to || r.moving?.to === msg.to && !!saved && desiredAccess(saved) === msg.to));
		if (!destinationClaimed && !saved?.r2?.retired?.some((r) => r.rev === rev && r.access === msg.to)) {
			await deleteRendition(env, msg.videoId, msg.to, rev);
		}
		return 'stale';
	}
	// A subsequent visibility edit may need the source again.
	const fresh = await repo(env).getObject(msg.videoId);
	if (!fresh || desiredAccess(fresh) === msg.to || !completedRenditions(fresh.r2).some((r) => r.rev === rev)) {
		await deleteRendition(env, msg.videoId, from, rev);
	}
	if (saved) {
		if (retired) await queueRetiredRendition(env, saved, retired);
		await reconcileRenditions(env, fresh ?? saved);
		const shown = shownR2(saved);
		if (shown && shown === saved.r2) {
			const { onRenditionReady } = await import('../audio-tracks/service');
			await onRenditionReady(env as never, undefined, saved as never);
		}
	}
	return 'moved';
}

export async function handleMediaRenditionBatch(
	batch: { messages: readonly { body: unknown; attempts: number; ack(): void; retry(o?: { delaySeconds?: number }): void }[] },
	env: MediaEnv,
	now = Date.now(),
): Promise<void> {
	for (const msg of batch.messages) {
		try {
			if (isMediaMoveMessage(msg.body)) await moveMedia(env, msg.body);
			else if (isMediaRetireMessage(msg.body)) await retireRendition(env, msg.body, now);
			msg.ack();
		} catch (error) {
			logger.warn('[Media] Rendition maintenance failed; retrying', { error: error instanceof Error ? error.message : String(error) });
			msg.retry({ delaySeconds: Math.min(300, 30 * msg.attempts) });
		}
	}
}

// ---------------------------------------------------------------------------
// Sweep (cron, every 10 min): stuck jobs and missed moves
// ---------------------------------------------------------------------------

const STUCK_QUEUED_MS = 60 * 60 * 1000;
const STUCK_TRANSCODING_MS = 6 * 60 * 60 * 1000;

/**
 * `slotsFull`: the dispatcher is busy at the admin's range (transcodeSlotsFull), so a queued job is
 * waiting its turn (apps/media sends it again every minute), not stuck.
 */
export function sweepVerdict(video: MediaVideo, now: number, slotsFull = false): 'requeue' | 'move' | null {
	const r2 = video.r2;
	if (!r2 || video.isDeleted) return null;
	if (r2.status === 'queued' && !slotsFull && now - Date.parse(r2.queuedAt) > STUCK_QUEUED_MS) return 'requeue';
	if (r2.status === 'transcoding' && now - Date.parse(r2.startedAt ?? r2.queuedAt) > STUCK_TRANSCODING_MS) return 'requeue';
	if (accessDrift(video)) return 'move';
	return null;
}

/**
 * The Errors page item for a job the sweep found stuck and queued again: a stuck job means the
 * transcoder lost it (it should retry on its own), so a person should know. Same key as a failed
 * transcode, so the item resolves when the re-queued job is ready.
 */
export function stuckJobNotice(video: Pick<MediaVideo, 'id' | 'r2'>, now: number) {
	const r2 = video.r2!;
	const since = r2.status === 'transcoding' ? (r2.startedAt ?? r2.queuedAt) : r2.queuedAt;
	const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
	return {
		key: needsActionKey(video.id),
		source: 'processing' as const,
		title: `R2 transcode was stuck ${r2.status} (re-queued automatically)`,
		message: `Job ${r2.jobId} sat ${r2.status} for ${minutes} min without word from the transcoder; the sweep queued it again. Check the media Worker logs if this repeats.`,
		itemType: 'video' as const,
		itemId: video.id,
		itemUrl: `/videos/${video.id}`,
		retry: { kind: 'service' as const, service: 'api-videos', path: '/internal/media/retry', body: { ids: [video.id] } },
		retryLabel: 'Transcode again',
		extra: { status: r2.status, jobId: r2.jobId, minutes },
	};
}

type SweepCandidate = { video_id: string; job_id: string };

/** Bounded: looks at the supplied media_jobs candidates only. */
export async function sweepMedia(env: MediaEnv, jobs: SweepCandidate[], now = Date.now(), ctx?: ExecutionContextLike, slotsFull = false): Promise<{ requeued: number; moved: number }> {
	let requeued = 0;
	let moved = 0;
	for (const { video_id: id, job_id: jobId } of jobs.slice(0, 200)) {
		const video = await repo(env).getObject(id);
		if (!video || video.isDeleted) {
			// A newer job or an already-finished one may have replaced the candidate during the read.
			await env.SEARCH_DB?.prepare(
				`UPDATE media_jobs SET status = 'cancelled', error = 'cancelled', failed_at = ?3, updated_at = ?3
				 WHERE video_id = ?1 AND job_id = ?2 AND status IN ('queued', 'transcoding')`,
			)
				.bind(id, jobId, new Date(now).toISOString())
				.run();
			continue;
		}
		const verdict = sweepVerdict(video, now, slotsFull);
		if (verdict === 'requeue' && (await enqueueTranscode(env, id, 'sweep', { force: true })).queued) {
			requeued++;
			logger.warn('[MediaSweep] Stuck transcode queued again', { videoId: id, status: video.r2?.status, jobId: video.r2?.jobId });
			reportNeedsAction('api-videos', env as never, ctx, stuckJobNotice(video, now));
		}
		if (verdict === 'move') {
			const to = accessDrift(video);
			if (to && (await queueMediaMove(env, id, to))) moved++;
		}
	}
	return { requeued, moved };
}

async function reconcileRenditions(env: MediaEnv, video: MediaVideo): Promise<void> {
	const to = accessDrift(video);
	const revocations = desiredAccess(video) === 'priv' ? (video.r2?.retired ?? []).filter((r) => r.access === 'pub') : [];
	// Keep the write hook alive until revocation finishes, even if the move could not be queued.
	const results = await Promise.allSettled([
		to ? queueMediaMove(env, video.id, to) : undefined,
		...revocations.map((r) => queueRetiredRendition(env, video, r)),
	]);
	const failure = results.find((result) => result.status === 'rejected');
	if (failure) throw failure.reason;
}

/** Write hook: reconcile visibility and revoke retired public URLs on restriction. */
export async function onVideoWritten(env: MediaEnv, decoded: unknown): Promise<void> {
	const video = decoded as MediaVideo | null;
	if (!video?.r2) return;
	await reconcileRenditions(env, video).catch((error) =>
		logger.warn('[Media] Could not queue rendition maintenance', { videoId: video.id, error: error instanceof Error ? error.message : String(error) }),
	);
}

/** Cron: jobs stuck in queued/transcoding (from media_jobs), re-queued; bounded per run. */
export async function sweepMediaJobs(env: MediaEnv, now = Date.now(), ctx?: ExecutionContextLike): Promise<{ requeued: number; moved: number }> {
	if (!env.SEARCH_DB || !env.TRANSCODE_QUEUE) return { requeued: 0, moved: 0 };
	const { results } = await env.SEARCH_DB.prepare(
		`SELECT video_id, job_id FROM media_jobs WHERE (status = 'queued' AND queued_at < ?1) OR (status = 'transcoding' AND updated_at < ?2) ORDER BY updated_at LIMIT 50`,
	)
		.bind(new Date(now - STUCK_QUEUED_MS).toISOString(), new Date(now - STUCK_TRANSCODING_MS).toISOString())
		.all<SweepCandidate>();
	if (!results?.length) return { requeued: 0, moved: 0 };
	return sweepMedia(env, results, now, ctx, await transcodeSlotsFull(env, now));
}

/**
 * Whether the dispatcher is busy at the admin's range: at least `min` transcoding (media_jobs). Above
 * min it opens one slot per start or finish while jobs wait, so a queued job there is its turn coming.
 */
export async function transcodeSlotsFull(env: MediaEnv & { MEDIA_TRANSCODE_CEILING?: string }, now = Date.now()): Promise<boolean> {
	if (!env.SEARCH_DB) return false;
	const row = await env.SEARCH_DB.prepare(`SELECT COUNT(*) AS n FROM media_jobs WHERE status = 'transcoding'`).first<{ n: number }>();
	return (Number(row?.n) || 0) >= (await effectiveTranscodes(env, now)).min;
}

/**
 * Bunny finished encoding (processing loop, terminal 'ready'): its MP4 fallbacks now exist,
 * which is what the R2 transcode reads (Bunny's CDN never serves /original). A job that
 * failed or never started for lack of a source is queued again now. Never throws.
 */
export async function requeueAfterBunnyReady(env: MediaEnv, videoId: string): Promise<{ queued: boolean; why?: string }> {
	try {
		const video = await repo(env).getObject(videoId);
		const r2 = video?.r2;
		if (!video || !r2 || video.isDeleted) return { queued: false, why: 'no R2 job' };
		if (r2.status !== 'failed') return { queued: false, why: `R2 ${r2.status}` };
		return await enqueueTranscode(env, videoId, 'retry', { force: true });
	} catch (error) {
		logger.warn('[Media] Re-queue after Bunny ready failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}

// ---------------------------------------------------------------------------
// Live admin updates (topic 'media' on the admin WebSocket channel; docs/admin/LIVE_OPS.md).
// Small events only (the channel cuts anything over 2 KB): full failure details stay behind the API.
// ---------------------------------------------------------------------------

export interface MediaLiveEnv extends MediaEnv {
	WEBSOCKET_URL?: string;
	INTERNAL_API_KEY?: { get(): Promise<string> } | string;
	/** max_instances of the transcoder container: the ceiling of the admin's setting */
	MEDIA_TRANSCODE_CEILING?: string;
}

/** The job as the admin pages show it. */
export function mediaJobEvent(video: Pick<MediaVideo, 'id' | 'r2'>): AdminLiveEvent | null {
	const r2 = video.r2;
	if (!r2) return null;
	const f = r2.failure;
	return {
		kind: 'job',
		key: `job:${video.id}`,
		videoId: video.id,
		jobId: r2.jobId,
		status: r2.status,
		attempt: r2.attempts ?? 0,
		...(r2.progress !== undefined ? { progress: r2.progress } : {}),
		// [['360p','done'],['720p','uploading',0.4], …]: four rungs are ~120 characters
		...(r2.rungs?.length ? { rungs: compactRungs(r2.rungs) } : {}),
		...(f && r2.status !== 'ready' ? { failure: { stage: f.stage, error: f.error.slice(0, 120), attempt: f.attempt } } : {}),
		at: new Date().toISOString(),
	};
}

const LIVE_EVERY_MS = 5_000;
let lastLiveAt = 0;

/** Transcoding now / queued / the oldest wait, from media_jobs (one query). */
export async function mediaLiveEvent(env: MediaLiveEnv, now = Date.now()): Promise<AdminLiveEvent | null> {
	if (!env.SEARCH_DB) return null;
	const row = await env.SEARCH_DB.prepare(
		`SELECT SUM(status = 'transcoding') AS transcoding, SUM(status = 'queued') AS queued, MIN(CASE WHEN status = 'queued' THEN queued_at END) AS oldest FROM media_jobs`,
	).first<{ transcoding: number | null; queued: number | null; oldest: string | null }>();
	const range = await effectiveTranscodes(env, now);
	const ceiling = transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING);
	return {
		kind: 'live',
		key: 'live',
		transcoding: row?.transcoding ?? 0,
		queued: row?.queued ?? 0,
		rangeMin: range.min,
		rangeMax: range.max,
		...(ceiling ? { ceiling } : {}),
		...(row?.oldest ? { oldestQueuedAt: row.oldest } : {}),
		at: new Date(now).toISOString(),
	};
}

/** Publish a job change (and, at most every 5 s per isolate, the live figures). Never throws, never blocks. */
export function pushMediaLive(env: MediaLiveEnv, ctx: ExecutionContextLike | undefined, video: Pick<MediaVideo, 'id' | 'r2'> | null): void {
	if (!env.WEBSOCKET_URL) return;
	const work = (async () => {
		const events: AdminLiveEvent[] = [];
		const job = video ? mediaJobEvent(video) : null;
		// A video under a takedown: on admin:restricted, for super admins only
		if (job && (video as { csamTakedown?: unknown }).csamTakedown) await publishAdminLiveFor(env as never, 'media', true, job);
		else if (job) events.push(job);
		const now = Date.now();
		if (now - lastLiveAt >= LIVE_EVERY_MS) {
			lastLiveAt = now;
			const live = await mediaLiveEvent(env, now).catch(() => null);
			if (live) events.push(live);
		}
		if (events.length) await publishAdminLive(env as never, 'media', events);
	})().catch((error) => logger.warn('[Media] Live publish failed', { error: error instanceof Error ? error.message : String(error) }));
	if (ctx?.waitUntil) ctx.waitUntil(work);
}
