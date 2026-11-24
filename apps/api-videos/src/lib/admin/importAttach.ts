/**
 * Admin Tools import sidecars (wiki TOOLS-ADMIN TA-6): the files the importer found next to a video
 * file — captions (.vtt, .srt, .sbv), chapters (.chapters.txt), a custom thumbnail — plus a playlist
 * and a publish date from its metadata, put on the video once it exists.
 *
 *   stageImportSidecars   validates, keeps the payload in global_settings (admin-import/sidecars/…),
 *                         and queues the admin job 'import.attach' (lib/admin/jobs.ts: retry with
 *                         backoff, DLQ, Jobs page with Retry)
 *   runImportAttach       the job. Captions and the playlist go on at once; chapters, the thumbnail
 *                         and the schedule wait until the video is processed (they need its length,
 *                         its size, a finished video), checking again every few minutes for up to
 *                         12 hours. Each part is done once (the job's params remember what is done).
 *                         A sidecar that cannot be used (wrong shape, bad chapter lines, a date in the
 *                         past) is skipped with a warning in the job's result; a failure that may
 *                         pass (a store down) throws, so the job retries and, at the end, flags the
 *                         admin's Errors page with Retry.
 *
 * Same rules as the owner's own edits: a thumbnail must have the video's shape and never replaces a
 * custom one already set; captions go through the subtitle store (converted to WebVTT).
 */
import type { AdminJob, VideoObject } from '@al-ummah/shared-types';
import { reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { patchVideo } from '../videoWrites';
import { storeSubtitleTrack } from '../subtitles/store';
import { parseChapters } from '../chapters/parser';
import { storeCustomThumbnail } from '../thumbnail/store';
import { checkThumbnailShape, imageSize, resolveVideoSize } from '../thumbnail/shape';
import { fetchBunnyVideo } from '../processing/loop';
import { bunnyRef } from '../media/providers';
import { addVideosNow, type PlaylistEnv } from '../playlistBulk';
import { applySchedule, announceSchedule, scheduleDateProblem } from '../videoSchedule';
import { createJob, type JobEnv, type JobOutcome } from './jobs';
import { logger } from '../logger';

export const IMPORT_ATTACH_JOB_KIND = 'import.attach' as const;
export const SIDECAR_PREFIX = 'admin-import/sidecars/';
/** Wait between checks while the video is processed, and how long to wait at most. */
export const ATTACH_WAIT_SECONDS = 300;
export const ATTACH_MAX_WAITS = 144;

export const MAX_CAPTION_TRACKS = 20;
export const MAX_CAPTION_CHARS = 2 * 1024 * 1024;
export const MAX_CHAPTERS_CHARS = 64 * 1024;
export const MAX_THUMBNAIL_BYTES = 6 * 1024 * 1024;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export interface ImportSidecars {
	captions?: Array<{ language: string; label?: string; content: string; isDefault?: boolean }>;
	/** Chapter lines as in a description ("0:00 Intro") */
	chapters?: string;
	/** base64 image (jpeg, png or webp) */
	thumbnail?: { data: string; mimeType: string };
	playlistId?: string;
	/** ISO date: the video is published then (it must be private until then) */
	publishAt?: string;
}

type Part = 'captions' | 'playlist' | 'chapters' | 'thumbnail' | 'schedule';

interface AttachParams {
	videoId: string;
	key: string;
	/** What came with the file (the Imports view shows each part's state); absent on older jobs */
	sent?: Part[];
	done: Part[];
	waits: number;
	warnings: string[];
}

export interface AttachEnv extends JobEnv, PlaylistEnv {
	videos: R2Bucket;
	subtitles: R2Bucket;
	global_settings: R2Bucket;
	Audience?: string;
	[binding: string]: unknown;
}

/** Validates the sidecars; the error names the first problem. */
export function validateSidecars(input: unknown): { ok: true; value: ImportSidecars } | { ok: false; error: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'A JSON object is required' };
	const b = input as Record<string, unknown>;
	const value: ImportSidecars = {};
	if (b.captions !== undefined) {
		if (!Array.isArray(b.captions) || b.captions.length > MAX_CAPTION_TRACKS) return { ok: false, error: `captions must be a list of at most ${MAX_CAPTION_TRACKS} tracks` };
		const seen = new Set<string>();
		value.captions = [];
		for (const raw of b.captions as Array<Record<string, unknown>>) {
			const language = typeof raw?.language === 'string' ? raw.language : '';
			if (!LANGUAGE.test(language)) return { ok: false, error: 'each caption track needs a language code (e.g. ar, en)' };
			if (seen.has(language)) return { ok: false, error: `two caption tracks for ${language}` };
			seen.add(language);
			if (typeof raw.content !== 'string' || !raw.content.trim() || raw.content.length > MAX_CAPTION_CHARS) return { ok: false, error: `the ${language} captions are empty or too large` };
			value.captions.push({
				language,
				content: raw.content,
				...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim().slice(0, 80) } : {}),
				...(raw.isDefault === true ? { isDefault: true } : {}),
			});
		}
	}
	if (b.chapters !== undefined) {
		if (typeof b.chapters !== 'string' || !b.chapters.trim() || b.chapters.length > MAX_CHAPTERS_CHARS) return { ok: false, error: 'chapters must be the chapter lines as text' };
		value.chapters = b.chapters;
	}
	if (b.thumbnail !== undefined) {
		const t = b.thumbnail as Record<string, unknown> | null;
		if (!t || typeof t.data !== 'string' || !/^image\/(jpeg|png|webp)$/.test(String(t.mimeType))) return { ok: false, error: 'thumbnail must be { data: base64, mimeType: image/jpeg|png|webp }' };
		if (t.data.length > Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3) + 4) return { ok: false, error: 'the thumbnail is larger than 6 MB' };
		value.thumbnail = { data: t.data, mimeType: String(t.mimeType) };
	}
	if (b.playlistId !== undefined) {
		if (typeof b.playlistId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(b.playlistId)) return { ok: false, error: 'playlistId is not valid' };
		value.playlistId = b.playlistId;
	}
	if (b.publishAt !== undefined) {
		if (typeof b.publishAt !== 'string' || Number.isNaN(Date.parse(b.publishAt))) return { ok: false, error: 'publishAt must be an ISO date' };
		value.publishAt = new Date(b.publishAt).toISOString();
	}
	if (!Object.keys(value).length) return { ok: false, error: 'Nothing to attach' };
	return { ok: true, value };
}

/** Keeps the sidecars and queues the job that puts them on the video. */
export async function stageImportSidecars(env: AttachEnv, videoId: string, sidecars: ImportSidecars, actorId: string): Promise<{ jobId: string; status: string }> {
	const key = `${SIDECAR_PREFIX}${videoId}/${crypto.randomUUID()}.json`;
	await env.global_settings.put(key, JSON.stringify(sidecars), { httpMetadata: { contentType: 'application/json' } });
	const params: AttachParams = { videoId, key, sent: sentParts(sidecars), done: [], waits: 0, warnings: [] };
	const job = await createJob(env, { kind: IMPORT_ATTACH_JOB_KIND, targetKind: 'video', targetId: videoId, params: params as unknown as Record<string, unknown>, actorId });
	return { jobId: job.id, status: job.status };
}

/** The parts a file's sidecars carry, in the order the job puts them on. */
export function sentParts(sidecars: ImportSidecars): Part[] {
	const parts: Part[] = [];
	if (sidecars.captions?.length) parts.push('captions');
	if (sidecars.playlistId) parts.push('playlist');
	if (sidecars.chapters) parts.push('chapters');
	if (sidecars.thumbnail) parts.push('thumbnail');
	if (sidecars.publishAt) parts.push('schedule');
	return parts;
}

export const attachNeedsActionKey = (jobId: string) => `import-attach:${jobId}`;

const base64Bytes = (data: string): Uint8Array => {
	const binary = atob(data.replace(/^data:[^,]*,/, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

/** The job: one pass over what is left; waits for processing where a part needs a finished video. */
export async function runImportAttach(env: AttachEnv, job: AdminJob): Promise<JobOutcome> {
	const params = job.params as unknown as AttachParams;
	if (!params?.videoId || !params.key) throw new Error('import.attach: missing videoId or key');
	const done = new Set<Part>(params.done ?? []);
	const warnings = [...(params.warnings ?? [])];
	const repo = new R2Repository<VideoObject>(env.videos);
	const video = await repo.getObject(params.videoId);
	const result = () => ({ videoId: params.videoId, done: [...done], warnings });
	if (!video || video.isDeleted) {
		await env.global_settings.delete(params.key).catch(() => undefined);
		return { done: true, result: { ...result(), skipped: 'video_deleted' } };
	}
	const object = await env.global_settings.get(params.key);
	if (!object) {
		// Already finished by an earlier delivery (the payload is removed last)
		return { done: true, result: result() };
	}
	const sidecars = (await object.json()) as ImportSidecars;
	const ownerId = video.userId as string;

	// Parts that do not need a processed video
	if (sidecars.captions?.length && !done.has('captions')) {
		const apiBaseUrl = String(env.Audience ?? '').replace(/\/$/, '');
		for (const track of sidecars.captions) {
			const stored = await storeSubtitleTrack(env, { id: video.id as string, userId: ownerId }, { file: track.content, language: track.language, label: track.label, isDefault: track.isDefault, userId: job.actorId, apiBaseUrl });
			if (stored.status !== 'ok') return { done: true, result: { ...result(), skipped: 'video_deleted' } };
		}
		done.add('captions');
	}
	if (sidecars.playlistId && !done.has('playlist')) {
		// Only a playlist of the video's own channel (addVideosNow checks the videos, not the playlist)
		const playlist = await new R2Repository<{ channelId?: string | null; isDeleted?: boolean }>(env.playlists).getObject(sidecars.playlistId);
		if (!playlist || playlist.isDeleted) warnings.push('playlist_missing');
		else if (!video.channelId || playlist.channelId !== video.channelId) warnings.push('playlist_other_channel');
		else {
			const outcome = await addVideosNow(env, sidecars.playlistId, video.channelId as string, [video.id as string]);
			if (outcome.missing) warnings.push('playlist_missing');
			else if (outcome.notInChannel) warnings.push('playlist_other_channel');
			else if (outcome.overLimit) warnings.push('playlist_full');
		}
		done.add('playlist');
	}

	const later: Part[] = [];
	if (sidecars.chapters && !done.has('chapters')) later.push('chapters');
	if (sidecars.thumbnail && !done.has('thumbnail')) later.push('thumbnail');
	if (sidecars.publishAt && !done.has('schedule')) later.push('schedule');
	if (later.length) {
		const status = (video as { uploadStatus?: string }).uploadStatus;
		if (status === 'failed') throw new Error('The video failed to process, so its chapters, thumbnail and schedule cannot be added');
		if (status !== 'ready') {
			if ((params.waits ?? 0) >= ATTACH_MAX_WAITS) throw new Error('The video is still not processed after 12 hours');
			logger.debug('[ImportAttach] Waiting for processing', { jobId: job.id, videoId: video.id, waits: params.waits });
			const waiting: AttachParams = { ...params, done: [...done], warnings, waits: (params.waits ?? 0) + 1 };
			return { done: false, params: waiting as unknown as Record<string, unknown>, result: result(), delaySeconds: ATTACH_WAIT_SECONDS };
		}
	}

	if (later.includes('chapters')) {
		const parsed = parseChapters(sidecars.chapters!, Number((video as { duration?: number }).duration) || 0);
		if (parsed.success && parsed.chapters.length) {
			const saved = await patchVideo(repo, video.id as string, { chapters: { chapters: parsed.chapters, source: 'manual', parsedAt: new Date().toISOString(), version: 1 }, hasChapters: true } as Partial<VideoObject>, { ownerId });
			if (saved.status !== 'ok') return { done: true, result: { ...result(), skipped: 'video_deleted' } };
		} else {
			warnings.push('chapters_invalid');
		}
		done.add('chapters');
	}

	if (later.includes('thumbnail')) {
		const fresh = (await repo.getObject(video.id as string)) ?? video;
		if ((fresh as { thumbnailType?: string }).thumbnailType === 'custom') {
			warnings.push('thumbnail_kept_existing');
		} else {
			const bytes = base64Bytes(sidecars.thumbnail!.data);
			const bunnyId = bunnyRef(fresh as never);
			const size = await resolveVideoSize(fresh as never, async () => (bunnyId ? fetchBunnyVideo(env as never, bunnyId, fresh as never) : null));
			const dims = imageSize(bytes);
			if (!dims || bytes.length > MAX_THUMBNAIL_BYTES) warnings.push('thumbnail_unreadable');
			else if (!checkThumbnailShape(dims, size).ok) warnings.push('thumbnail_shape');
			else {
				const mime = sidecars.thumbnail!.mimeType;
				const stored = await storeCustomThumbnail(env as never, video.id as string, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
					type: mime,
					extension: mime.endsWith('png') ? 'png' : mime.endsWith('webp') ? 'webp' : 'jpg',
				});
				await patchVideo(
					repo,
					video.id as string,
					(current) => {
						if (current.isDeleted || (current as { thumbnailType?: string }).thumbnailType === 'custom') return false;
						return { thumbnailUrl: stored.thumbnailUrl, thumbnailType: 'custom' as const, thumbnailSizes: stored.thumbnailSizes, dateModified: new Date().toISOString() } as Partial<VideoObject>;
					},
					{ ownerId },
				);
			}
		}
		done.add('thumbnail');
	}

	if (later.includes('schedule')) {
		const date = new Date(sidecars.publishAt!);
		const now = new Date();
		const problem = scheduleDateProblem(date, now);
		if (problem) warnings.push(`schedule_${problem}`);
		else {
			const saved = await patchVideo(
				repo,
				video.id as string,
				(current) => {
					if (current.isDeleted || current.isPublic || (current as { scheduledPublishStatus?: string }).scheduledPublishStatus || (current as { premiereHold?: unknown }).premiereHold) return false;
					applySchedule(current, { date, timezone: 'UTC', userId: job.actorId, now });
					return {};
				},
				{ ownerId },
			);
			if (saved.status === 'ok' && saved.changed) await announceSchedule(env as never, saved.video as VideoObject, { date, timezone: 'UTC', notifyOnPublish: true, userId: job.actorId });
			else if (saved.status === 'ok') warnings.push('schedule_not_private');
		}
		done.add('schedule');
	}

	await env.global_settings.delete(params.key).catch((error) => logger.warn('[ImportAttach] Could not remove the staged sidecars', { key: params.key, error: String(error) }));
	resolveNeedsAction(env as unknown as ErrorReporterEnv, undefined, attachNeedsActionKey(job.id));
	logger.info('[ImportAttach] Sidecars attached', { jobId: job.id, videoId: video.id, done: [...done], warnings });
	return { done: true, result: result() };
}

/** The job failed for good: an Errors page item with Retry (admin-api lib/errors-actions.ts). */
export async function onImportAttachFailed(env: AttachEnv, job: AdminJob, error: string): Promise<void> {
	reportNeedsAction('api-videos', env as unknown as ErrorReporterEnv, undefined, {
		key: attachNeedsActionKey(job.id),
		source: 'queue',
		title: 'Imported file: captions, chapters or thumbnail not added',
		message: error.slice(0, 500),
		itemType: 'video',
		itemId: job.targetId,
		// The file in the videos admin's Imports view (it finds the batch page by the video)
		itemUrl: `/imports?video=${encodeURIComponent(job.targetId)}`,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/admin/import/attach/retry', body: { jobId: job.id } },
		retryLabel: 'Try again',
		extra: { jobId: job.id, videoId: job.targetId },
	});
}
