/**
 * On-demand transcription jobs (AUN-CAPTIONS §5.1; shared-types caption-jobs.ts).
 *
 * api-videos owns the job row (SEARCH_DB `caption_jobs`, migration 0033) and its
 * minutes (minutes.ts, hold id = job id). It sends the work on: the video
 * review's audio chunks when the review media still hold them, otherwise an
 * audio-only extraction by the media transcoder. The processor transcribes and
 * reports progress and the end through the /internal/captions routes, so this
 * module is the only writer of the row and of the minutes.
 */
import {
	CAPTION_JOB_ERRORS,
	CAPTION_JOB_STATUSES,
	CAPTION_MONTHLY_BUDGET_MAX_USD,
	CAPTION_TRANSLATE_MODELS,
	INLINE_TRANSLATE_DEFAULT_DAILY_ITEMS,
	MessageType,
	type CaptionDraft,
	type CaptionTranslatePayload,
	type TranslationProvider,
	captionDraftKey,
	captionMinutesFor,
	captionWorkPrefix,
	isCaptionJobActive,
	reportNeedsAction,
	resolveNeedsAction,
	type CaptionAudioJobMessage,
	type CaptionAudioReport,
	type CaptionJob,
	type CaptionJobError,
	type CaptionJobPayload,
	type CaptionJobStatus,
	type CaptionMinutesUsage,
	type CaptionTranslationSource,
	type SubtitleMetadata,
	captionCuesFromVtt,
	captionPublishedSourceKey,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type VideoObject,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { cancelMinutes, captionSubject, commitMinutes, readUsage, releaseMinutes, reserveMinutes } from './minutes';
import { overlaySwitch } from '../features/switches';

export const CAPTION_PROVIDER = 'workers-ai';
export const CAPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';
const SETTINGS_KEY = 'captions/settings.json';
/** Past the processor's whole retry window (backoff 1+2+4 min plus four ≤ 15-minute deliveries). */
export const POSTPROCESSING_STALE_MS = 90 * 60_000;

interface Bucket {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
	put?(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
	head?(key: string): Promise<unknown>;
	list?(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
	delete?(keys: string | string[]): Promise<void>;
}
interface QueueLike {
	send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown>;
}

export interface CaptionJobsEnv {
	SEARCH_DB?: unknown;
	MEDIA_PRIVATE?: Bucket;
	subtitles?: Bucket;
	global_settings?: Bucket;
	queue?: QueueLike;
	TRANSCODE_QUEUE?: QueueLike;
	ENVIRONMENT?: string;
	INTERNAL_API_KEY?: unknown;
	ERRORS_INGEST_URL?: string;
	/** DeepL API Pro key (Secrets Store `AI_KEY_DEEPL`, O2); unbound = DeepL is never used */
	AI_KEY_DEEPL?: unknown;
}

export class CaptionJobHttpError extends Error {
	constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
		super(code);
	}
}

const db = (env: CaptionJobsEnv) => {
	if (!env.SEARCH_DB) throw new CaptionJobHttpError(503, 'unavailable');
	return env.SEARCH_DB as D1Database;
};

/** Caption settings (admin-editable file in global_settings; defaults per environment, AUN-CAPTIONS O4). */
export interface CaptionSettings {
	monthlyBudgetUsd: number;
	model: string;
	/** Transcript translation (§5.7, §10): Workers AI models; DeepL only when an admin turned it on (O2) */
	translation: {
		enabled: boolean;
		model: string;
		fallbackModel: string;
		deepl: boolean;
		/** Target languages DeepL is used for; empty = every language it supports */
		deeplLanguages: string[];
	};
	/** Inline title/description translation (§5.8): free on every tier, fair use per day (O5), budget backstop */
	inline: {
		/** The admin kill switch */
		enabled: boolean;
		/** Texts one user may translate per UTC day (cache hits don't count) */
		dailyItems: number;
		/** The month's budget for inline and viewer-side translation; a day may spend 1/30 of it */
		monthlyBudgetUsd: number;
	};
	/** Viewer-side translated titles (§5.9, O6 / P4): an admin setting, on by default; the owner's answer is a toggle */
	viewerTitles: { enabled: boolean };
	/**
	 * Viewers download captions from the player (QF 2026-11-22 allows it). Off by default: the owner
	 * decided 2026-11-22 not to offer it yet; owners, caption editors and admins still download in Studio.
	 */
	viewerDownload: { enabled: boolean };
}

const MODEL_ID = /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

export function defaultCaptionSettings(env: Pick<CaptionJobsEnv, 'ENVIRONMENT'>): CaptionSettings {
	return {
		monthlyBudgetUsd: env.ENVIRONMENT === 'production' ? 100 : 5,
		model: CAPTION_MODEL,
		translation: { enabled: true, model: CAPTION_TRANSLATE_MODELS.primary, fallbackModel: CAPTION_TRANSLATE_MODELS.fallback, deepl: false, deeplLanguages: [] },
		inline: { enabled: true, dailyItems: INLINE_TRANSLATE_DEFAULT_DAILY_ITEMS, monthlyBudgetUsd: env.ENVIRONMENT === 'production' ? 20 : 2 },
		// P4/O6 pending the owner: on by default, labelled, each channel can opt out; the admin setting turns it off site-wide
		viewerTitles: { enabled: true },
		viewerDownload: { enabled: false },
	};
}

/** Cleans stored or submitted settings over `base`: unknown or invalid values keep `base`. */
export function cleanCaptionSettings(raw: unknown, base: CaptionSettings): CaptionSettings {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CaptionSettings> & { translation?: Partial<CaptionSettings['translation']> };
	const tr = (r.translation && typeof r.translation === 'object' ? r.translation : {}) as Partial<CaptionSettings['translation']>;
	const inl = (r.inline && typeof r.inline === 'object' ? r.inline : {}) as Partial<CaptionSettings['inline']>;
	const vt = (r.viewerTitles && typeof r.viewerTitles === 'object' ? r.viewerTitles : {}) as Partial<CaptionSettings['viewerTitles']>;
	const vd = (r.viewerDownload && typeof r.viewerDownload === 'object' ? r.viewerDownload : {}) as Partial<CaptionSettings['viewerDownload']>;
	return {
		monthlyBudgetUsd: typeof r.monthlyBudgetUsd === 'number' && r.monthlyBudgetUsd >= 0 && r.monthlyBudgetUsd <= CAPTION_MONTHLY_BUDGET_MAX_USD ? r.monthlyBudgetUsd : base.monthlyBudgetUsd,
		model: typeof r.model === 'string' && MODEL_ID.test(r.model) ? r.model : base.model,
		translation: {
			enabled: typeof tr.enabled === 'boolean' ? tr.enabled : base.translation.enabled,
			model: typeof tr.model === 'string' && MODEL_ID.test(tr.model) ? tr.model : base.translation.model,
			fallbackModel: typeof tr.fallbackModel === 'string' && MODEL_ID.test(tr.fallbackModel) ? tr.fallbackModel : base.translation.fallbackModel,
			deepl: typeof tr.deepl === 'boolean' ? tr.deepl : base.translation.deepl,
			deeplLanguages: Array.isArray(tr.deeplLanguages) ? [...new Set(tr.deeplLanguages.filter((l): l is string => typeof l === 'string' && LANG.test(l)).map((l) => l.toLowerCase()))].slice(0, 40) : base.translation.deeplLanguages,
		},
		inline: {
			enabled: typeof inl.enabled === 'boolean' ? inl.enabled : base.inline.enabled,
			dailyItems: Number.isInteger(inl.dailyItems) && (inl.dailyItems as number) >= 0 && (inl.dailyItems as number) <= 10_000 ? (inl.dailyItems as number) : base.inline.dailyItems,
			monthlyBudgetUsd: typeof inl.monthlyBudgetUsd === 'number' && inl.monthlyBudgetUsd >= 0 && inl.monthlyBudgetUsd <= 200 ? inl.monthlyBudgetUsd : base.inline.monthlyBudgetUsd,
		},
		viewerTitles: { enabled: typeof vt.enabled === 'boolean' ? vt.enabled : base.viewerTitles.enabled },
		viewerDownload: { enabled: typeof vd.enabled === 'boolean' ? vd.enabled : base.viewerDownload.enabled },
	};
}

export async function readCaptionSettings(env: CaptionJobsEnv, opts: { raw?: boolean } = {}): Promise<CaptionSettings> {
	const settings = await readStoredCaptionSettings(env);
	if (opts.raw) return settings;
	// The Features page switches decide the four `enabled` fields once set (lib/features/switches.ts)
	const [translation, inline, viewerTitles, viewerDownload] = await Promise.all([
		overlaySwitch(env, 'captionsTranslate', settings.translation.enabled),
		overlaySwitch(env, 'inlineTranslate', settings.inline.enabled),
		overlaySwitch(env, 'viewerTranslatedTitles', settings.viewerTitles.enabled),
		overlaySwitch(env, 'viewerCaptionDownload', settings.viewerDownload.enabled),
	]);
	return {
		...settings,
		translation: { ...settings.translation, enabled: translation },
		inline: { ...settings.inline, enabled: inline },
		viewerTitles: { ...settings.viewerTitles, enabled: viewerTitles },
		viewerDownload: { ...settings.viewerDownload, enabled: viewerDownload },
	};
}

async function readStoredCaptionSettings(env: CaptionJobsEnv): Promise<CaptionSettings> {
	const fallback = defaultCaptionSettings(env);
	try {
		const stored = await env.global_settings?.get(SETTINGS_KEY);
		if (!stored) return fallback;
		return cleanCaptionSettings(JSON.parse(await stored.text()), fallback);
	} catch (error) {
		logger.warn('[CaptionJobs] Settings unreadable; using defaults', { error: error instanceof Error ? error.message : String(error) });
		return fallback;
	}
}

/** Saves the admin's settings (admin-api audits the change). */
export async function writeCaptionSettings(env: CaptionJobsEnv & { global_settings?: Bucket & { put(key: string, value: string, opts?: unknown): Promise<unknown> } }, patch: unknown): Promise<CaptionSettings> {
	const next = cleanCaptionSettings(patch, await readCaptionSettings(env, { raw: true }));
	if (!env.global_settings) throw new CaptionJobHttpError(503, 'unavailable');
	await (env.global_settings as unknown as { put(key: string, value: string, opts?: unknown): Promise<unknown> }).put(SETTINGS_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
	return next;
}

/** The provider of a translate job: DeepL when an admin turned it on for the language and its key is bound. */
export function translationProviderFor(settings: CaptionSettings, language: string, deeplKeyBound: boolean): TranslationProvider {
	const t = settings.translation;
	if (!t.deepl || !deeplKeyBound) return 'workers-ai';
	return !t.deeplLanguages.length || t.deeplLanguages.includes(language.split('-')[0]!.toLowerCase()) ? 'deepl' : 'workers-ai';
}

interface JobRow {
	id: string;
	video_id: string;
	channel_id: string | null;
	subject_id: string;
	requested_by: string;
	kind: 'transcribe' | 'translate';
	language: string;
	source_language: string | null;
	source_version: number | null;
	/** translate: 'published' when the source is the published track (TA-20, search migration 0072); NULL = the draft */
	source_kind?: string | null;
	replace_draft: number;
	provider: string;
	model: string;
	status: CaptionJobStatus;
	progress_done: number | null;
	progress_total: number | null;
	minutes_reserved: number;
	minutes_charged: number | null;
	waived: number;
	error: string | null;
	audio_manifest_key: string | null;
	attempts: number;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
}

const toJob = (r: JobRow): CaptionJob => ({
	id: r.id,
	videoId: r.video_id,
	channelId: r.channel_id,
	subjectId: r.subject_id,
	requestedBy: r.requested_by,
	kind: r.kind === 'translate' ? 'translate' : 'transcribe',
	language: r.language,
	sourceLanguage: r.source_language ?? null,
	sourceVersion: r.source_version === null || r.source_version === undefined ? null : Number(r.source_version),
	source: r.kind === 'translate' ? (r.source_kind === 'published' ? 'published' : 'draft') : null,
	replace: Number(r.replace_draft) === 1,
	provider: r.provider,
	model: r.model,
	status: (CAPTION_JOB_STATUSES as readonly string[]).includes(r.status) ? r.status : 'failed',
	progress: r.progress_total ? { done: Number(r.progress_done ?? 0), total: Number(r.progress_total) } : null,
	minutesReserved: Number(r.minutes_reserved),
	minutesCharged: r.minutes_charged === null ? null : Number(r.minutes_charged),
	waived: Number(r.waived) === 1,
	error: r.error && (CAPTION_JOB_ERRORS as readonly string[]).includes(r.error) ? (r.error as CaptionJobError) : r.error ? 'failed' : null,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
	finishedAt: r.finished_at,
});

async function readRow(env: CaptionJobsEnv, jobId: string): Promise<JobRow | null> {
	return db(env).prepare('SELECT * FROM caption_jobs WHERE id = ?').bind(jobId).first<JobRow>();
}

export async function readJob(env: CaptionJobsEnv, jobId: string): Promise<CaptionJob | null> {
	const row = await readRow(env, jobId);
	return row ? toJob(row) : null;
}

export async function listJobs(env: CaptionJobsEnv, videoId: string, limit = 20): Promise<CaptionJob[]> {
	const rows = (await db(env).prepare('SELECT * FROM caption_jobs WHERE video_id = ? ORDER BY created_at DESC LIMIT ?').bind(videoId, limit).all<JobRow>()).results ?? [];
	return rows.map(toJob);
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The video review's audio manifest, while the review media still hold it. */
export async function reviewAudioManifest(env: CaptionJobsEnv, video: object): Promise<string | null> {
	const v = video as { review?: { manifestKey?: string } | null; r2?: { result?: { review?: { manifestKey?: string } | null } | null } | null };
	const key = v.review?.manifestKey ?? v.r2?.result?.review?.manifestKey;
	if (!key || !/^review\/.+manifest\.json$/.test(key) || !env.MEDIA_PRIVATE) return null;
	const found = env.MEDIA_PRIVATE.head ? await env.MEDIA_PRIVATE.head(key) : await env.MEDIA_PRIVATE.get(key);
	return found ? key : null;
}

const videoDurationSeconds = (video: VideoObject): number | null => {
	const d = video.duration ?? (video as { r2?: { result?: { source?: { durationSeconds?: number } } } }).r2?.result?.source?.durationSeconds;
	return typeof d === 'number' && d > 0 ? d : null;
};

function jobMessage(job: CaptionJob, manifestKey: string, prompt: string | undefined, settings: CaptionSettings, now: Date): { id: string; type: MessageType; payload: CaptionJobPayload; timestamp: number } {
	return {
		id: crypto.randomUUID(),
		type: MessageType.CaptionJob,
		payload: { jobId: job.id, videoId: job.videoId, language: job.language, replace: job.replace, requestedBy: job.requestedBy, audioManifestKey: manifestKey, nextChunk: 0, prompt, model: job.model, dailyBudgetUsd: Math.round((settings.monthlyBudgetUsd / 30) * 100) / 100, requestedAt: now.toISOString() },
		timestamp: now.getTime(),
	};
}

/** Deletes the job's extracted audio and partial transcript (never the review media). */
export async function clearJobWork(env: CaptionJobsEnv, jobId: string): Promise<void> {
	const bucket = env.MEDIA_PRIVATE;
	if (!bucket?.list || !bucket.delete) return;
	try {
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix: captionWorkPrefix(jobId), ...(cursor ? { cursor } : {}) });
			if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	} catch (error) {
		logger.warn('[CaptionJobs] Could not delete the job work', { jobId, error: error instanceof Error ? error.message : String(error) });
	}
}

async function setStatus(env: CaptionJobsEnv, jobId: string, fields: { status: CaptionJobStatus; audio?: string | null; error?: string | null; finished?: boolean }, now: Date): Promise<void> {
	await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = ?, audio_manifest_key = COALESCE(?, audio_manifest_key), error = ?, finished_at = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.bind(fields.status, fields.audio ?? null, fields.error ?? null, fields.finished ? now.toISOString() : null, now.toISOString(), jobId)
		.run();
}

/** Sends the job's audio work: the transcription when its audio exists, else the extraction. */
function translateMessage(job: CaptionJob, video: VideoObject, settings: CaptionSettings, now: Date): { id: string; type: MessageType; payload: CaptionTranslatePayload; timestamp: number } {
	return {
		id: crypto.randomUUID(),
		type: MessageType.CaptionTranslate,
		payload: {
			jobId: job.id,
			videoId: job.videoId,
			sourceLanguage: job.sourceLanguage!,
			sourceVersion: job.sourceVersion!,
			source: job.source === 'published' ? 'published' : 'draft',
			language: job.language,
			replace: job.replace,
			requestedBy: job.requestedBy,
			nextBatch: 0,
			provider: job.provider === 'deepl' ? 'deepl' : 'workers-ai',
			model: job.model,
			fallbackModel: settings.translation.fallbackModel,
			dailyBudgetUsd: Math.round((settings.monthlyBudgetUsd / 30) * 100) / 100,
			context: { ...(video.title ? { title: video.title.slice(0, 200) } : {}), ...(video.channelName ? { channel: String(video.channelName).slice(0, 120) } : {}) },
			requestedAt: now.toISOString(),
		},
		timestamp: now.getTime(),
	};
}

/**
 * A translate job from a published track (TA-20) works on a copy of it in its work prefix, so a
 * track replaced while the job runs changes nothing. `vtt` is the copy the request read; a Retry
 * (the work was cleared when the job failed) reads the track again.
 */
async function snapshotPublishedSource(env: CaptionJobsEnv, job: CaptionJob, vtt?: string): Promise<void> {
	const text = vtt ?? (await readPublishedSource(env, job.videoId, job.sourceLanguage!)).vtt;
	if (!env.MEDIA_PRIVATE?.put) throw new CaptionJobHttpError(503, 'queue_unavailable');
	await env.MEDIA_PRIVATE.put(captionPublishedSourceKey(job.id), text, { httpMetadata: { contentType: 'text/vtt' } });
}

async function dispatch(env: CaptionJobsEnv, job: CaptionJob, video: VideoObject, now: Date, publishedVtt?: string): Promise<CaptionJobStatus> {
	if (job.kind === 'translate') {
		if (!env.queue) throw new CaptionJobHttpError(503, 'queue_unavailable');
		if (job.source === 'published') await snapshotPublishedSource(env, job, publishedVtt);
		await env.queue.send(translateMessage(job, video, await readCaptionSettings(env), now));
		await setStatus(env, job.id, { status: 'queued' }, now);
		return 'queued';
	}
	const manifest = await reviewAudioManifest(env, video);
	if (manifest) {
		if (!env.queue) throw new CaptionJobHttpError(503, 'queue_unavailable');
		await env.queue.send(jobMessage(job, manifest, video.title?.slice(0, 200), await readCaptionSettings(env), now));
		await setStatus(env, job.id, { status: 'queued', audio: manifest }, now);
		return 'queued';
	}
	if (!env.TRANSCODE_QUEUE) throw new CaptionJobHttpError(503, 'queue_unavailable');
	const message: CaptionAudioJobMessage = { kind: 'caption_audio', jobId: job.id, videoId: job.videoId, out: captionWorkPrefix(job.id), queuedAt: now.toISOString() };
	await env.TRANSCODE_QUEUE.send(message);
	await setStatus(env, job.id, { status: 'extracting' }, now);
	return 'extracting';
}

export type RequestOutcome = { job: CaptionJob; existing: boolean } | { refused: 'upgrade_required'; usage: CaptionMinutesUsage; minutes: number };

/**
 * A creator asks for captions in the language spoken in `video` (access already
 * checked). The same request while a job is active returns that job.
 */
export async function requestCaptionJob(
	env: CaptionJobsEnv,
	input: { video: VideoObject; userId: string; roles?: readonly string[] | null; language: string; replace: boolean },
	now = new Date(),
): Promise<RequestOutcome> {
	const { video } = input;
	const settings = await readCaptionSettings(env);
	const key = await sha256(`${video.id}|transcribe|${input.language}|${CAPTION_PROVIDER}`);
	const active = await db(env)
		.prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')")
		.bind(key)
		.first<JobRow>();
	if (active) return { job: toJob(active), existing: true };

	if (video.uploadStatus && video.uploadStatus !== 'ready') throw new CaptionJobHttpError(409, 'video_not_ready');
	const duration = videoDurationSeconds(video);
	if (!duration) throw new CaptionJobHttpError(409, 'video_not_ready');
	if (!input.replace && (await env.subtitles?.get(captionDraftKey(video.id, input.language)))) throw new CaptionJobHttpError(409, 'draft_exists');

	const subject = await captionSubject(db(env), { userId: input.userId, roles: input.roles, channelOwnerId: video.userId });
	const minutes = captionMinutesFor(duration, 1);
	const jobId = crypto.randomUUID();
	const reserved = await reserveMinutes(db(env), subject, jobId, minutes, now);
	if ('usage' in reserved) return { refused: 'upgrade_required', usage: reserved.usage, minutes };

	const at = now.toISOString();
	const inserted = await db(env)
		.prepare(
			`INSERT OR IGNORE INTO caption_jobs (id, idempotency_key, video_id, channel_id, subject_id, requested_by, kind, language, replace_draft, provider, model, status, minutes_reserved, waived, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'transcribe', ?, ?, ?, ?, 'queued', ?, 0, 1, ?, ?)`,
		)
		.bind(jobId, key, video.id, video.channelId ?? null, subject.subjectId, input.userId, input.language, input.replace ? 1 : 0, CAPTION_PROVIDER, settings.model, minutes, at, at)
		.run();
	if ((inserted.meta?.changes ?? 0) === 0) {
		// A double click won the race: give these minutes back and answer with that job
		await releaseMinutes(db(env), jobId, now);
		const winner = await db(env).prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')").bind(key).first<JobRow>();
		if (winner) return { job: toJob(winner), existing: true };
		throw new CaptionJobHttpError(409, 'try_again');
	}
	const job = (await readJob(env, jobId))!;
	try {
		const status = await dispatch(env, job, video, now);
		return { job: { ...job, status }, existing: false };
	} catch (error) {
		await releaseMinutes(db(env), jobId, now);
		await setStatus(env, jobId, { status: 'failed', error: 'failed', finished: true }, now);
		logger.error('[CaptionJobs] Could not send the job', { jobId, videoId: video.id, error: error instanceof Error ? error.message : String(error) });
		throw error instanceof CaptionJobHttpError ? error : new CaptionJobHttpError(503, 'queue_unavailable');
	}
}

/**
 * A creator asks for a translation of a caption draft (§5.7; access already checked). The input is
 * the source draft as it is now (the creator's corrected text), recorded as `sourceVersion`; with no
 * draft in that language, its published track (TA-20, resolveTranslationSource). One
 * caption minute per video-minute per target language. Asking again while a job of the same
 * source and target runs returns that job.
 */
export async function requestTranslationJob(
	env: CaptionJobsEnv,
	input: {
		video: VideoObject;
		userId: string;
		roles?: readonly string[] | null;
		sourceLanguage: string;
		language: string;
		replace: boolean;
		/** The admin importer (wiki TOOLS-ADMIN TA-7): no caption minutes, like an admin's Retry; the platform budget still applies */
		waive?: boolean;
	},
	now = new Date(),
): Promise<RequestOutcome> {
	const { video } = input;
	if (input.sourceLanguage === input.language) throw new CaptionJobHttpError(400, 'same_language');
	const settings = await readCaptionSettings(env);
	if (!settings.translation.enabled) throw new CaptionJobHttpError(503, 'translation_paused');
	const source = await resolveTranslationSource(env, video.id, input.sourceLanguage);
	const provider = translationProviderFor(settings, input.language, !!env.AI_KEY_DEEPL);
	const key = await sha256(`${video.id}|translate|${input.language}|${provider}|${input.sourceLanguage}`);
	const active = await db(env)
		.prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')")
		.bind(key)
		.first<JobRow>();
	if (active) return { job: toJob(active), existing: true };

	// Charged on the video's own duration, like transcription (never on draft timestamps a creator can edit)
	if (video.uploadStatus && video.uploadStatus !== 'ready') throw new CaptionJobHttpError(409, 'video_not_ready');
	const duration = videoDurationSeconds(video);
	if (!duration) throw new CaptionJobHttpError(409, 'video_not_ready');
	if (!input.replace && (await env.subtitles?.get(captionDraftKey(video.id, input.language)))) throw new CaptionJobHttpError(409, 'draft_exists');

	// A waived job charges nobody, so it never resolves a tier: the requester (an admin) has no known roles
	// here, and the job is recorded against the channel owner
	const subject = input.waive ? null : await captionSubject(db(env), { userId: input.userId, roles: input.roles, channelOwnerId: video.userId });
	const subjectId = subject?.subjectId ?? video.userId ?? input.userId;
	const minutes = captionMinutesFor(duration, 1);
	const jobId = crypto.randomUUID();
	if (subject) {
		const reserved = await reserveMinutes(db(env), subject, jobId, minutes, now);
		if ('usage' in reserved) return { refused: 'upgrade_required', usage: reserved.usage, minutes };
	}

	const at = now.toISOString();
	const model = provider === 'deepl' ? 'deepl-pro' : settings.translation.model;
	const inserted = await db(env)
		.prepare(
			`INSERT OR IGNORE INTO caption_jobs (id, idempotency_key, video_id, channel_id, subject_id, requested_by, kind, language, source_language, source_version, source_kind, replace_draft, provider, model, status, minutes_reserved, waived, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'translate', ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, 1, ?, ?)`,
		)
		.bind(
			jobId,
			key,
			video.id,
			video.channelId ?? null,
			subjectId,
			input.userId,
			input.language,
			input.sourceLanguage,
			source.version,
			source.source === 'published' ? 'published' : null,
			input.replace ? 1 : 0,
			provider,
			model,
			minutes,
			input.waive ? 1 : 0,
			at,
			at,
		)
		.run();
	if ((inserted.meta?.changes ?? 0) === 0) {
		await releaseMinutes(db(env), jobId, now);
		const winner = await db(env).prepare("SELECT * FROM caption_jobs WHERE idempotency_key = ? AND status NOT IN ('ready', 'failed', 'cancelled')").bind(key).first<JobRow>();
		if (winner) return { job: toJob(winner), existing: true };
		throw new CaptionJobHttpError(409, 'try_again');
	}
	const job = (await readJob(env, jobId))!;
	logger.debug('[CaptionJobs] Translate job created', { jobId, videoId: video.id, from: input.sourceLanguage, to: input.language, source: source.source });
	try {
		const status = await dispatch(env, job, video, now, source.source === 'published' ? source.vtt : undefined);
		return { job: { ...job, status }, existing: false };
	} catch (error) {
		await releaseMinutes(db(env), jobId, now);
		await setStatus(env, jobId, { status: 'failed', error: 'failed', finished: true }, now);
		logger.error('[CaptionJobs] Could not send the translate job', { jobId, videoId: video.id, error: error instanceof Error ? error.message : String(error) });
		throw error instanceof CaptionJobHttpError ? error : new CaptionJobHttpError(503, 'queue_unavailable');
	}
}

/** What a translate job of `language` reads (TA-20); `version` is the draft's, or the published track's (1 when it has none). */
export type TranslationSource = { source: 'draft'; version: number } | { source: 'published'; version: number; vtt: string };

/**
 * The source of a translation of `language` (TA-20). The language's draft wins when it has cues (a
 * translated draft is 409 `source_is_translation`); otherwise its published track: an imported
 * sidecar or an uploaded file, or a track published from a draft since deleted (its Quran markers
 * become references again). 404 `source_missing` only when neither has anything to translate.
 */
export async function resolveTranslationSource(env: CaptionJobsEnv, videoId: string, language: string): Promise<TranslationSource> {
	const draft = await readJsonDraft(env, videoId, language);
	if (draft && draft.cues?.length) {
		if (draft.kind !== 'source') throw new CaptionJobHttpError(409, 'source_is_translation');
		return { source: 'draft', version: draft.version };
	}
	const published = await readPublishedSource(env, videoId, language);
	return { source: 'published', version: published.version, vtt: published.vtt };
}

/** The language's published track as stored (WebVTT, Quran as markers); 404 `source_missing`, 409 when it is a machine translation. */
async function readPublishedSource(env: CaptionJobsEnv, videoId: string, language: string): Promise<{ vtt: string; version: number }> {
	const meta = await env.subtitles?.get(`${videoId}/metadata.json`);
	let tracks: SubtitleMetadata['tracks'] = [];
	try {
		tracks = meta ? ((JSON.parse(await meta.text()) as SubtitleMetadata).tracks ?? []) : [];
	} catch {
		tracks = [];
	}
	const track = tracks.find((t) => t.language === language);
	if (!track || (track.status && track.status !== 'ready')) throw new CaptionJobHttpError(404, 'source_missing');
	if (track.machineTranslation) throw new CaptionJobHttpError(409, 'source_is_translation');
	const file = await env.subtitles?.get(`${videoId}/${language}.vtt`);
	const vtt = file ? await file.text() : '';
	if (!captionCuesFromVtt(vtt).length) throw new CaptionJobHttpError(404, 'source_missing');
	const version = Number.isInteger(track.version) && track.version! >= 1 ? track.version! : 1;
	return { vtt, version };
}

async function readJsonDraft(env: CaptionJobsEnv, videoId: string, language: string): Promise<CaptionDraft | null> {
	const obj = await env.subtitles?.get(captionDraftKey(videoId, language));
	if (!obj) return null;
	try {
		return JSON.parse(await obj.text()) as CaptionDraft;
	} catch {
		return null;
	}
}

export async function cancelJob(env: CaptionJobsEnv, videoId: string, jobId: string, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row || row.video_id !== videoId) throw new CaptionJobHttpError(404, 'job_not_found');
	if (!isCaptionJobActive(row.status)) return toJob(row);
	// Writing the draft: too late to cancel (the draft would be free). The processor's
	// `postprocessing` report and this update are both conditional, so exactly one wins. A job
	// stuck there (its processor gave up and could not report) may be cancelled once stale:
	// every processor retry reports `postprocessing` again before it writes, which keeps a live
	// job fresh and makes a retry after this cancel stop (409) before any draft is written.
	const staleBefore = new Date(now.getTime() - POSTPROCESSING_STALE_MS).toISOString();
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = 'cancelled', finished_at = ?, updated_at = ?
			 WHERE id = ? AND status NOT IN ('ready', 'failed', 'cancelled') AND (status != 'postprocessing' OR updated_at < ?)`,
		)
		.bind(now.toISOString(), now.toISOString(), jobId, staleBefore)
		.run();
	if ((changed.meta?.changes ?? 0) === 0) {
		const fresh = (await readRow(env, jobId))!;
		if (fresh.status === 'postprocessing') throw new CaptionJobHttpError(409, 'job_finishing');
		return toJob(fresh);
	}
	// It costs what it had transcribed (chunks done of the total) and the rest comes back; one
	// stuck writing its draft is our failure and comes back in full
	if (Number(row.waived) !== 1) {
		const hold = row.status === 'postprocessing' ? await releaseMinutes(db(env), jobId, now) : await cancelMinutes(db(env), jobId, minutesTranscribed(row), now);
		await db(env).prepare('UPDATE caption_jobs SET minutes_charged = ? WHERE id = ?').bind(hold?.charged ?? 0, jobId).run();
	}
	await clearJobWork(env, jobId);
	return (await readJob(env, jobId))!;
}

/** The part of the estimate a job had transcribed when it stopped. */
export function minutesTranscribed(row: Pick<JobRow, 'minutes_reserved' | 'progress_done' | 'progress_total'>): number {
	const total = Number(row.progress_total ?? 0);
	if (!total) return 0;
	const done = Math.min(total, Math.max(0, Number(row.progress_done ?? 0)));
	return Math.ceil((Number(row.minutes_reserved) * done) / total);
}

export async function minutesForVideo(env: CaptionJobsEnv, video: VideoObject, userId: string, roles?: readonly string[] | null, now = new Date()): Promise<CaptionMinutesUsage> {
	return readUsage(db(env), await captionSubject(db(env), { userId, roles, channelOwnerId: video.userId }), now);
}

// --- Internal: the media worker and the processor -------------------------------

type Ctx = ExecutionContextLike | undefined;

export const jobNeedsActionKey = (jobId: string) => `caption-job:${jobId}`;

function flagAdmin(env: CaptionJobsEnv, ctx: Ctx, job: CaptionJob, reason: string): void {
	reportNeedsAction('api-videos', env as ErrorReporterEnv, ctx, {
		key: jobNeedsActionKey(job.id),
		source: 'queue',
		title: 'Caption job failed',
		message: reason.slice(0, 500),
		itemType: 'video',
		itemId: job.videoId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: job.id } },
		retryLabel: 'Try again',
		extra: { language: job.language, jobId: job.id },
	});
}

/** The media worker extracted the job's audio (or gave up). */
export async function onAudioReport(env: CaptionJobsEnv, jobId: string, report: CaptionAudioReport, videoTitle: string | undefined, ctx: Ctx, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (row.status !== 'extracting') {
		// Cancelled (or retried) meanwhile: what the extraction wrote is not needed
		if (!isCaptionJobActive(row.status)) await clearJobWork(env, jobId);
		throw new CaptionJobHttpError(409, 'job_not_extracting');
	}
	const job = toJob(row);
	const failure = 'error' in report ? report.error : null;
	if ('manifestKey' in report && report.manifestKey === `${captionWorkPrefix(jobId)}manifest.json`) {
		if (!env.queue) throw new CaptionJobHttpError(503, 'queue_unavailable');
		await env.queue.send(jobMessage(job, report.manifestKey, videoTitle?.slice(0, 200), await readCaptionSettings(env), now));
		await setStatus(env, jobId, { status: 'queued', audio: report.manifestKey }, now);
		return (await readJob(env, jobId))!;
	}
	const reason = failure ?? 'unexpected manifest key';
	const done = await finishJob(env, jobId, { outcome: 'failed', error: 'audio_unavailable' }, ctx, now);
	// No audio track is the video's own state, not a fault
	if (!(failure && /no_audio/.test(failure))) flagAdmin(env, ctx, job, `Audio extraction failed: ${reason}`);
	return done;
}

/** The processor's progress; 409 once the job is no longer active (cancelled: the processor stops). */
export async function onProgress(env: CaptionJobsEnv, jobId: string, p: { status: CaptionJobStatus; done?: number; total?: number }, now = new Date()): Promise<boolean> {
	if (!['waiting_budget', 'transcribing', 'translating', 'postprocessing'].includes(p.status)) throw new CaptionJobHttpError(400, 'invalid_status');
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = ?, progress_done = COALESCE(?, progress_done), progress_total = COALESCE(?, progress_total), updated_at = ?
			 WHERE id = ? AND status NOT IN ('ready', 'failed', 'cancelled')
			   AND (status != 'postprocessing' OR ? = 'postprocessing')`,
		)
		.bind(p.status, p.done ?? null, p.total ?? null, now.toISOString(), jobId, p.status)
		.run();
	return (changed.meta?.changes ?? 0) > 0;
}

/** The end of a job: ready commits the minutes used, failed refunds them all. */
export async function finishJob(
	env: CaptionJobsEnv,
	jobId: string,
	end: { outcome: 'ready'; minutesUsed: number } | { outcome: 'failed'; error: CaptionJobError },
	ctx: Ctx,
	now = new Date(),
): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (!isCaptionJobActive(row.status)) {
		if (row.status === 'cancelled') throw new CaptionJobHttpError(409, 'job_cancelled');
		return toJob(row);
	}
	const at = now.toISOString();
	if (end.outcome === 'ready') {
		// A translation costs the video's minutes per language produced (the estimate it reserved)
		const used = row.kind === 'translate' ? Number(row.minutes_reserved) : end.minutesUsed;
		const hold = Number(row.waived) === 1 ? null : await commitMinutes(db(env), jobId, used, now);
		await db(env)
			.prepare("UPDATE caption_jobs SET status = 'ready', minutes_charged = ?, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
			.bind(hold?.charged ?? 0, at, at, jobId)
			.run();
		resolveNeedsAction(env as ErrorReporterEnv, ctx, [jobNeedsActionKey(jobId)]);
	} else {
		await releaseMinutes(db(env), jobId, now);
		await db(env)
			.prepare("UPDATE caption_jobs SET status = 'failed', minutes_charged = 0, error = ?, finished_at = ?, updated_at = ? WHERE id = ?")
			.bind(end.error, at, at, jobId)
			.run();
	}
	await clearJobWork(env, jobId);
	return (await readJob(env, jobId))!;
}

/**
 * The admin's Retry of a failed job (Errors page): runs it again free of
 * charge (a platform failure, AUN-CAPTIONS §6.2), unless a newer job of the
 * same video and language is already active.
 */
export async function retryJob(env: CaptionJobsEnv, jobId: string, video: VideoObject | null, now = new Date()): Promise<CaptionJob> {
	const row = await readRow(env, jobId);
	if (!row) throw new CaptionJobHttpError(404, 'job_not_found');
	if (row.status !== 'failed') return toJob(row);
	if (!video) throw new CaptionJobHttpError(409, 'video_gone');
	const at = now.toISOString();
	const changed = await db(env)
		.prepare(
			`UPDATE caption_jobs SET status = 'queued', waived = 1, error = NULL, finished_at = NULL, progress_done = NULL, progress_total = NULL, attempts = attempts + 1, updated_at = ?
			 WHERE id = ? AND status = 'failed'
			   AND NOT EXISTS (SELECT 1 FROM caption_jobs o WHERE o.idempotency_key = caption_jobs.idempotency_key AND o.id != caption_jobs.id AND o.status NOT IN ('ready', 'failed', 'cancelled'))`,
		)
		.bind(at, jobId)
		.run();
	if ((changed.meta?.changes ?? 0) === 0) throw new CaptionJobHttpError(409, 'newer_job_active');
	const job = (await readJob(env, jobId))!;
	try {
		await dispatch(env, job, video, now);
	} catch (error) {
		// A published source gone meanwhile fails the retry as source_missing (the creator's to fix)
		const missing = error instanceof CaptionJobHttpError && error.code === 'source_missing';
		await setStatus(env, jobId, { status: 'failed', error: missing ? 'source_missing' : 'failed', finished: true }, now);
		throw error;
	}
	return (await readJob(env, jobId))!;
}
