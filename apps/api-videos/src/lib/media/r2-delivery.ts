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
import {
	DEFAULT_DELIVERY_SETTINGS,
	mediaPlayUrl,
	newMediaRev,
	normaliseDeliverySettings,
	publishAdminLive,
	type AdminLiveEvent,
	reportNeedsAction,
	resolveNeedsAction,
	compactRungs,
	sanitizeFailure,
	sanitizeRungs,
	scrubMediaText,
	MEDIA_MASTER,
	MEDIA_THUMBNAIL,
	type DeliverySettings,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type MediaAccess,
	type TranscodeFailure,
	type TranscodeJobEvent,
	type TranscodeJobMessage,
	type VideoR2State,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { fetchBunnyVideo } from '../processing/loop';
import { deleteOriginal } from './originals';
import { bunnyLibraryForVideo, type BunnyLibrariesEnv, type LibraryHints } from '../bunny/libraries';
import { logger } from '../logger';
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
export interface MediaVideo {
	id: string;
	isPublic?: boolean;
	isDraft?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	scheduledPublishStatus?: string;
	uploadStatus?: string;
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
			   duration_seconds, bytes, objects, rungs, container_seconds, instance_type, bunny_ready_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
			 ON CONFLICT (video_id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, access = excluded.access,
			   reason = COALESCE(excluded.reason, media_jobs.reason), attempts = excluded.attempts, queued_at = excluded.queued_at,
			   started_at = excluded.started_at, ready_at = excluded.ready_at, failed_at = excluded.failed_at, error = excluded.error,
			   duration_seconds = excluded.duration_seconds, bytes = excluded.bytes, objects = excluded.objects, rungs = excluded.rungs,
			   container_seconds = excluded.container_seconds, instance_type = excluded.instance_type,
			   bunny_ready_at = COALESCE(excluded.bunny_ready_at, media_jobs.bunny_ready_at), updated_at = excluded.updated_at`,
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
			)
			.run();
	} catch (error) {
		logger.warn('[Media] Could not record the job', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
	}
}

export const MEDIA_MOVE_KIND = 'media-move';
export interface MediaMoveMessage {
	kind: typeof MEDIA_MOVE_KIND;
	videoId: string;
	moveId: string;
	to: MediaAccess;
}
export function isMediaMoveMessage(body: unknown): body is MediaMoveMessage {
	const b = body as Partial<MediaMoveMessage> | null;
	return !!b && b.kind === MEDIA_MOVE_KIND && typeof b.videoId === 'string' && (b.to === 'pub' || b.to === 'priv');
}

export const SETTINGS_KEY = 'ops/media-delivery.json';
const ZONE_ID = 'fada86a0f215bda23dbe19de7226b49f';

// ---------------------------------------------------------------------------
// Settings (admin, per environment): global_settings/ops/media-delivery.json
// ---------------------------------------------------------------------------

let settingsCache: { at: number; value: DeliverySettings } | null = null;
const SETTINGS_TTL_MS = 30_000;

export function clearDeliverySettingsCache(): void {
	settingsCache = null;
}

export async function readDeliverySettings(env: Pick<MediaEnv, 'global_settings'>, fresh = false): Promise<DeliverySettings> {
	if (!fresh && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
	let value = DEFAULT_DELIVERY_SETTINGS;
	try {
		const obj = await env.global_settings?.get(SETTINGS_KEY);
		if (obj) value = normaliseDeliverySettings(await obj.json<Partial<DeliverySettings>>());
	} catch (error) {
		logger.warn('[Media] Could not read delivery settings; using defaults', { error: error instanceof Error ? error.message : String(error) });
	}
	settingsCache = { at: Date.now(), value };
	return value;
}

export async function writeDeliverySettings(env: Pick<MediaEnv, 'global_settings'>, input: Partial<DeliverySettings>, actorId: string): Promise<DeliverySettings> {
	if (!env.global_settings) throw new Error('global_settings is not bound');
	const value = normaliseDeliverySettings({ ...(await readDeliverySettings(env, true)), ...input, updatedAt: new Date().toISOString(), updatedBy: actorId });
	await env.global_settings.put(SETTINGS_KEY, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
	settingsCache = { at: Date.now(), value };
	return value;
}

// ---------------------------------------------------------------------------
// Access: public renditions are served with no Worker, so only a video anyone
// may watch is public. Private, draft, hidden, deleted or not yet published → priv.
// ---------------------------------------------------------------------------

export function desiredAccess(video: Pick<MediaVideo, 'isPublic' | 'isDraft' | 'isHidden' | 'isDeleted' | 'scheduledPublishStatus'>): MediaAccess {
	if (video.isPublic === false || video.isDraft || video.isHidden || video.isDeleted) return 'priv';
	if (video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing') return 'priv';
	return 'pub';
}

/** A ready rendition set sits under the wrong prefix and no move is running. */
export function accessDrift(video: MediaVideo | null | undefined): MediaAccess | null {
	const r2 = video?.r2;
	if (!video || !r2 || r2.status !== 'ready') return null;
	const want = desiredAccess(video);
	if (want === r2.access) return null;
	if (r2.moving && r2.moving.to === want && Date.now() - Date.parse(r2.moving.at) < 30 * 60 * 1000) return null;
	return want;
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
		const settings = await readDeliverySettings(env);
		if (!settings.transcode && reason !== 'retry') return { queued: false, why: 'transcoding is off' };
		if (reason === 'upload' && opts.uploaderId && (await isE2eUploader(env, opts.uploaderId))) return { queued: false, why: 'E2E run account' };
		const now = opts.now ?? new Date();
		let message: TranscodeJobMessage | null = null;
		let why: string | undefined;
		await repo(env).updateObject(videoId, (video) => {
			message = null;
			why = undefined;
			const r2 = video.r2;
			if (r2 && !opts.force && (r2.status === 'queued' || r2.status === 'transcoding' || r2.status === 'ready')) {
				why = `already ${r2.status}`;
				return false;
			}
			const job: TranscodeJobMessage = {
				kind: 'transcode',
				videoId,
				jobId: crypto.randomUUID(),
				rev: newMediaRev(),
				access: desiredAccess(video),
				queuedAt: now.toISOString(),
				reason,
			};
			video.r2 = {
				status: 'queued',
				jobId: job.jobId,
				rev: job.rev,
				access: job.access,
				attempts: 0,
				queuedAt: job.queuedAt,
				// A rendition that was ready keeps playing until the new one is (its keys stay)
				...(r2?.status === 'ready' && r2.result ? { previous: { rev: r2.rev, access: r2.access } } : {}),
			};
			message = job;
			return true;
		});
		if (!message) return { queued: false, why: why ?? 'video not found' };
		const sent: TranscodeJobMessage = message;
		await env.TRANSCODE_QUEUE.send(sent);
		await recordJob(env, await repo(env).getObject(videoId));
		return { queued: true, jobId: sent.jobId };
	} catch (error) {
		logger.error('[Media] Could not queue the R2 transcode', { videoId, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}

const E2E_RUN_EMAIL = /^e2e\+[^@]+@e2e\.alummahnow\.net$/;

async function isE2eUploader(env: MediaEnv, userId: string): Promise<boolean> {
	try {
		const profile = (await (await env.profiles?.get(userId))?.json<{ email?: string }>()) ?? null;
		// Same rule as lib/e2e/runUserSweep.ts (not imported: that module imports admin/service, which imports this one)
		return typeof profile?.email === 'string' && E2E_RUN_EMAIL.test(profile.email.toLowerCase());
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

/** Errors-page text for a final failure: one summary line, a details block (shown as the item's stack), and small keys. */
export function failureDetails(ev: Pick<TranscodeJobEvent, 'videoId' | 'jobId' | 'attempt' | 'error'>, f: TranscodeFailure | undefined): { summary: string; error: Error; extra: Record<string, string | number | boolean | null> } {
	const err = scrubMediaText(ev.error ?? 'failed', 200);
	const stage = f ? STAGE_LABELS[f.stage] ?? f.stage : 'unknown stage';
	const secs = f ? Math.round(f.elapsedMs / 1000) : null;
	const summary = `Failed while ${stage}${f?.stageDetail ? ` (${f.stageDetail})` : ''}: ${err} (attempt ${f?.attempt ?? ev.attempt}${secs !== null ? `, after ${secs} s` : ''})`;
	const mb = f?.source?.bytes !== undefined ? `${(f.source.bytes / 1048576).toFixed(1)} MB` : 'unknown size';
	const lines = [
		`stage: ${f?.stage ?? 'unknown'}${f?.stageDetail ? ` (${f.stageDetail})` : ''}`,
		`error: ${err}`,
		`attempt: ${f?.attempt ?? ev.attempt}`,
		`elapsed: ${secs ?? '?'} s`,
		`source: ${f?.source?.file ?? 'unknown'} (${mb})`,
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
			instanceId: f?.instanceId ? f.instanceId.slice(0, 64) : null,
		},
	};
}

const needsActionKey = (videoId: string) => `media-transcode:${videoId}`;

/** An event from apps/media. Events of an older job are ignored. */
export async function applyJobEvent(
	env: MediaEnv & ErrorReporterEnv,
	ctx: ExecutionContextLike | undefined,
	ev: TranscodeJobEvent,
): Promise<{ applied: boolean; why?: string }> {
	let why: string | undefined;
	let previous: { rev: string; access: MediaAccess } | undefined;
	const saved = await repo(env).updateObject(ev.videoId, (video) => {
		why = undefined;
		const r2 = video.r2;
		if (!r2 || r2.jobId !== ev.jobId) {
			why = 'stale job';
			return false;
		}
		if (r2.status === 'ready' || (r2.status === 'failed' && ev.type !== 'ready')) {
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
			r2.result = ev.result;
			r2.rungs = ev.result.rungs.map((r) => ({ name: r.name, state: 'done' as const }));
			delete r2.error;
			delete r2.progress;
			previous = r2.previous;
			delete r2.previous;
		} else if (ev.type === 'failed') {
			r2.error = scrubMediaText(ev.error ?? 'failed', 500);
			if (ev.failure) r2.failure = sanitizeFailure(ev.failure);
			if (rungs) r2.rungs = rungs;
			if (ev.final) {
				r2.status = 'failed';
				r2.failedAt = ev.at;
			}
		}
		video.dateModified = new Date().toISOString();
		return true;
	});
	if (!saved) return { applied: false, why: 'video not found' };
	if (why) return { applied: false, why };
	// Live admin view (admin:media, docs/admin/LIVE_OPS.md): this job, then the transcoder figures
	pushMediaLive(env, ctx, saved);
	if (ev.type !== 'progress') await recordJob(env, saved);

	if (ev.type === 'ready') {
		resolveNeedsAction(env, ctx, needsActionKey(ev.videoId));
		// A re-transcode replaced an older rendition set: remove it
		if (previous && previous.rev !== saved.r2?.rev) await deleteRendition(env, ev.videoId, previous.access, previous.rev).catch(() => undefined);
		// Visibility changed while it transcoded: move it now
		const drift = accessDrift(saved);
		if (drift) await queueMediaMove(env, ev.videoId, drift);
	}
	if (ev.type === 'failed' && ev.final) {
		const failure = ev.failure ? sanitizeFailure(ev.failure) : undefined;
		const details = failureDetails(ev, failure);
		reportNeedsAction('api-videos', env, ctx, {
			key: needsActionKey(ev.videoId),
			source: 'processing',
			title: 'R2 transcode failed (Bunny unaffected)',
			message: details.summary,
			// The Errors page shows this as the item's details (expandable)
			error: details.error,
			itemType: 'video',
			itemId: ev.videoId,
			itemUrl: `/videos/${ev.videoId}`,
			retry: { kind: 'service', service: 'api-videos', path: '/internal/media/retry', body: { ids: [ev.videoId] } },
			retryLabel: 'Transcode again',
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
	const library = await bunnyLibraryForVideo(env as BunnyLibrariesEnv, record);
	const host = library.host;
	if (!host) return [];
	let bunny: { hasOriginal?: boolean | null; availableResolutions?: string | null } | null = null;
	try {
		// In the video's own library
		bunny = (await fetchBunnyVideo(env as never, videoId, record ?? undefined)) as never;
	} catch (error) {
		logger.warn('[Media] Bunny video lookup failed; trying every source', { videoId, error: error instanceof Error ? error.message : String(error) });
	}
	const files = sourceFiles(bunny);
	if (library.tokenKey) {
		const expires = tokenExpiry();
		const token = await bunnyDirectoryToken(library.tokenKey, videoId, expires);
		return files.map((f) => signedBunnyUrl(host, videoId, f, token, expires));
	}
	return files.map((f) => `https://${host}/${videoId}/${f}`);
}

/** The first candidate (the original): kept for callers that want one URL. */
export async function sourceUrl(env: MediaEnv, videoId: string, record?: LibraryHints | null): Promise<string | null> {
	return (await sourceCandidates(env, videoId, record))[0] ?? null;
}

/** Playable R2 URLs of a ready video (private ones signed), or null. */
export async function r2Urls(env: MediaEnv, video: Pick<MediaVideo, 'id' | 'r2'>): Promise<{ playUrl: string; thumbnailUrl: string } | null> {
	const r2 = video.r2;
	if (!r2 || r2.status !== 'ready' || !env.MEDIA_PUBLIC_HOST) return null;
	const sign = r2.access === 'priv' ? { key: await getSecret(env.MEDIA_SIGN_KEY, 'MEDIA_SIGN_KEY') } : undefined;
	if (r2.access === 'priv' && !sign?.key) return null;
	return {
		playUrl: await mediaPlayUrl(env.MEDIA_PUBLIC_HOST, r2.access, video.id, r2.rev, MEDIA_MASTER, sign),
		thumbnailUrl: await mediaPlayUrl(env.MEDIA_PUBLIC_HOST, r2.access, video.id, r2.rev, MEDIA_THUMBNAIL, sign),
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
	if (!bucket) return 0;
	const keys = await listKeys(bucket, `${access}/${videoId}/${rev}/`);
	await deleteKeys(bucket, keys);
	if (access === 'pub') await purgeCdnPrefix(env, `${videoId}/${rev}/`);
	return keys.length;
}

/** Every R2 object of a video, both buckets (the 30-day purge, promote, erase). Idempotent. */
export async function purgeVideoMedia(env: MediaEnv, videoId: string): Promise<number> {
	let n = 0;
	for (const access of ['pub', 'priv'] as const) {
		const bucket = bucketOf(env, access);
		if (!bucket) continue;
		const keys = await listKeys(bucket, `${access}/${videoId}/`);
		await deleteKeys(bucket, keys);
		n += keys.length;
	}
	if (n) await purgeCdnPrefix(env, `${videoId}/`);
	// The kept original (docs/media-delivery/ORIGINALS.md)
	n += await deleteOriginal(env as never, videoId);
	return n;
}

/** Drops cached copies of pub/<rest> from the CDN when a zone token with Cache Purge is set. */
async function purgeCdnPrefix(env: MediaEnv, rest: string): Promise<void> {
	if (!env.MEDIA_CDN_API_TOKEN || !env.MEDIA_PUBLIC_HOST) return;
	try {
		const token = await getSecret(env.MEDIA_CDN_API_TOKEN, 'MEDIA_CDN_API_TOKEN');
		if (!token) return;
		const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ prefixes: [`${env.MEDIA_PUBLIC_HOST}/pub/${rest}`] }),
		});
		if (!res.ok) logger.warn('[Media] CDN purge failed', { status: res.status, rest });
	} catch (error) {
		logger.warn('[Media] CDN purge failed', { rest, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Mark the move on the record and queue it (the processing-check queue carries it). */
export async function queueMediaMove(env: MediaEnv, videoId: string, to: MediaAccess): Promise<boolean> {
	if (!env.PROCESSING_CHECK_QUEUE) return false;
	const moveId = crypto.randomUUID();
	let marked = false;
	await repo(env).updateObject(videoId, (video) => {
		marked = false;
		if (accessDrift(video) !== to) return false;
		video.r2!.moving = { to, jobId: moveId, at: new Date().toISOString() };
		marked = true;
		return true;
	});
	if (!marked) return false;
	await env.PROCESSING_CHECK_QUEUE.send({ kind: MEDIA_MOVE_KIND, videoId, moveId, to } satisfies MediaMoveMessage);
	return true;
}

/**
 * Copy a ready rendition set to the other bucket, switch the record, then
 * delete the old copies (and purge them from the CDN). Players keep using
 * the old URLs until the record switches. Throws on transient errors (the
 * queue retries).
 */
export async function moveMedia(env: MediaEnv, msg: MediaMoveMessage): Promise<'moved' | 'stale' | 'nothing'> {
	const video = await repo(env).getObject(msg.videoId);
	const r2 = video?.r2;
	if (!video || !r2 || r2.status !== 'ready') return 'nothing';
	if (r2.moving?.jobId !== msg.moveId) return 'stale';
	const from = r2.access;
	if (from === msg.to) return 'nothing';
	const src = bucketOf(env, from);
	const dst = bucketOf(env, msg.to);
	if (!src || !dst) throw new Error('media buckets are not bound');
	const fromPrefix = `${from}/${msg.videoId}/${r2.rev}/`;
	const keys = await listKeys(src, fromPrefix);
	for (let i = 0; i < keys.length; i += 8) {
		await Promise.all(
			keys.slice(i, i + 8).map(async (key) => {
				const obj = await src.get(key);
				if (!obj) return;
				await dst.put(`${msg.to}/${key.slice(from.length + 1)}`, obj.body, { httpMetadata: obj.httpMetadata });
			}),
		);
	}
	let switched = false;
	await repo(env).updateObject(msg.videoId, (fresh) => {
		switched = false;
		if (!fresh.r2 || fresh.r2.rev !== r2.rev || fresh.r2.moving?.jobId !== msg.moveId) return false;
		fresh.r2.access = msg.to;
		delete fresh.r2.moving;
		switched = true;
		return true;
	});
	if (!switched) {
		// Superseded meanwhile: drop the copy we made
		await deleteKeys(dst, keys.map((k) => `${msg.to}/${k.slice(from.length + 1)}`));
		return 'stale';
	}
	await deleteKeys(src, keys);
	if (from === 'pub') await purgeCdnPrefix(env, `${msg.videoId}/${r2.rev}/`);
	return 'moved';
}

export async function handleMediaMoveBatch(batch: { messages: readonly { body: unknown; attempts: number; ack(): void; retry(o?: { delaySeconds?: number }): void }[] }, env: MediaEnv): Promise<void> {
	for (const msg of batch.messages) {
		if (!isMediaMoveMessage(msg.body)) {
			msg.ack();
			continue;
		}
		try {
			await moveMedia(env, msg.body);
			msg.ack();
		} catch (error) {
			logger.warn('[Media] Move failed; retrying', { videoId: msg.body.videoId, error: error instanceof Error ? error.message : String(error) });
			msg.retry({ delaySeconds: Math.min(300, 30 * msg.attempts) });
		}
	}
}

// ---------------------------------------------------------------------------
// Sweep (cron, every 10 min): stuck jobs and missed moves
// ---------------------------------------------------------------------------

const STUCK_QUEUED_MS = 60 * 60 * 1000;
const STUCK_TRANSCODING_MS = 6 * 60 * 60 * 1000;

export function sweepVerdict(video: MediaVideo, now: number): 'requeue' | 'move' | null {
	const r2 = video.r2;
	if (!r2 || video.isDeleted) return null;
	if (r2.status === 'queued' && now - Date.parse(r2.queuedAt) > STUCK_QUEUED_MS) return 'requeue';
	if (r2.status === 'transcoding' && now - Date.parse(r2.startedAt ?? r2.queuedAt) > STUCK_TRANSCODING_MS) return 'requeue';
	if (accessDrift(video)) return 'move';
	return null;
}

/** Bounded: looks at the given candidates only (the caller lists them from the ownership index). */
export async function sweepMedia(env: MediaEnv, ids: string[], now = Date.now()): Promise<{ requeued: number; moved: number }> {
	let requeued = 0;
	let moved = 0;
	for (const id of ids.slice(0, 200)) {
		const video = await repo(env).getObject(id);
		if (!video) continue;
		const verdict = sweepVerdict(video, now);
		if (verdict === 'requeue' && (await enqueueTranscode(env, id, 'sweep', { force: true })).queued) requeued++;
		if (verdict === 'move') {
			const to = accessDrift(video);
			if (to && (await queueMediaMove(env, id, to))) moved++;
		}
	}
	return { requeued, moved };
}

/** Write hook (search-sync wrapper): a ready rendition under the wrong prefix gets a move. */
export async function onVideoWritten(env: MediaEnv, decoded: unknown): Promise<void> {
	const video = decoded as MediaVideo | null;
	const to = accessDrift(video);
	if (!video || !to) return;
	await queueMediaMove(env, video.id, to).catch((error) =>
		logger.warn('[Media] Could not queue a move', { videoId: video.id, error: error instanceof Error ? error.message : String(error) }),
	);
}

/** Cron: jobs stuck in queued/transcoding (from media_jobs), re-queued; bounded per run. */
export async function sweepMediaJobs(env: MediaEnv, now = Date.now()): Promise<{ requeued: number; moved: number }> {
	if (!env.SEARCH_DB || !env.TRANSCODE_QUEUE) return { requeued: 0, moved: 0 };
	const { results } = await env.SEARCH_DB.prepare(
		`SELECT video_id FROM media_jobs WHERE (status = 'queued' AND queued_at < ?1) OR (status = 'transcoding' AND updated_at < ?2) ORDER BY updated_at LIMIT 50`,
	)
		.bind(new Date(now - STUCK_QUEUED_MS).toISOString(), new Date(now - STUCK_TRANSCODING_MS).toISOString())
		.all<{ video_id: string }>();
	return sweepMedia(env, (results ?? []).map((r) => r.video_id), now);
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
	/** max_instances of the transcoder container */
	MEDIA_MAX_TRANSCODES?: string;
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
	const max = Number(env.MEDIA_MAX_TRANSCODES);
	return {
		kind: 'live',
		key: 'live',
		transcoding: row?.transcoding ?? 0,
		queued: row?.queued ?? 0,
		...(Number.isFinite(max) && max > 0 ? { maxTranscodes: max } : {}),
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
		if (job) events.push(job);
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
