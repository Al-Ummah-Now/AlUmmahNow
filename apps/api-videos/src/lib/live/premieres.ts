/**
 * Premieres (wiki E17 §5.4): a finished video shown to everyone at a set time, at the same position.
 *
 * The video carries one field, `premiereHold`, and shared-types isVideoReleased() is false while it is
 * there: that alone keeps it out of every list, search, playback, embed and the public media prefix.
 * Nothing else on the video changes, so cancelling is removing the field. The start time lives on the
 * stream record (R2 livestream:<id>, kind 'premiere'); scheduled publishing is not involved.
 *
 * Runs in api-videos only, and only on a bucket wrapped by withSearchSync (the write hooks move the
 * media and index the video and the stream). The scheduler Worker takes no part.
 */
import { isMadeForKids, type ContentFlagFields } from '@al-ummah/shared-types';
import { LIVE_METADATA_TABLE, isShort, isVideoOpenToAnyone, isVideoReady, isVideoRemoved, isOpenByLink, featureGate, tierAllowsLiveCapability, type PremiereHold, type VideoObject } from '@al-ummah/shared-types';
import { channelOwnerTier } from '../creatorTiers';
import { hasSuspensionHolds } from '../admin/frozen';
import { logger } from '../logger';
import { announceLiveStarted } from '../notification-events';
import { enqueueNotification } from '../notifications';
import { markPublished } from '../published';
import R2Repository, { NonVideoRepository } from '../r2Repo';
import { scheduleDateProblem } from '../videoSchedule';
import { streamKey, type LiveStreamRecord } from './streams';

/** A hold younger than this may belong to a premiere whose stream record is still being written. */
const STALE_AFTER_MS = 10 * 60_000;
/** How long a due premiere waits for its video to be ready, or for the switch, before it is cancelled. */
export const PREMIERE_GRACE_MS = 60 * 60_000;

export interface PremiereEnv {
	videos: R2Bucket;
	channels?: R2Bucket;
	SEARCH_DB?: D1Database;
	[binding: string]: unknown;
}

export type PremiereVideo = VideoObject & { premiereHold?: PremiereHold };
export type PremiereStream = LiveStreamRecord & {
	kind?: string;
	premiereVideoId?: string;
	durationSeconds?: number;
	scheduledStartTime?: string;
	isHidden?: boolean;
	cancelReason?: string;
	/** Subscribers were told (a start cut short before that is told again) */
	announcedAt?: string;
};

const videos = (env: PremiereEnv) => new R2Repository<PremiereVideo>(env.videos);
const streams = (env: PremiereEnv) => new NonVideoRepository<PremiereStream>(env.videos);

export const isPremiere = (stream: object | null | undefined): stream is PremiereStream => (stream as { kind?: unknown } | null | undefined)?.kind === 'premiere';

export type PremiereProblem = 'premiere_video_unsuitable' | 'premiere_video_not_ready' | 'premiere_video_already_open' | 'premiere_video_scheduled' | 'premiere_exists';

/** Why this video cannot become a premiere; checked again inside the write that holds it. */
export function premiereProblem(video: PremiereVideo): PremiereProblem | null {
	if (!video.channelId || isShort(video) || !(Number(video.duration) > 0)) return 'premiere_video_unsuitable';
	if (isVideoRemoved(video) || !isVideoReady(video)) return 'premiere_video_not_ready';
	if (isOpenByLink(video)) return 'premiere_video_already_open';
	// It has a scheduledPublishDate and an entry the scheduler would act on
	if (video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing') return 'premiere_video_scheduled';
	if (video.premiereHold) return 'premiere_exists';
	return null;
}

export function premiereTimeProblem(value: unknown, now: number): boolean {
	return typeof value !== 'string' || scheduleDateProblem(new Date(value), new Date(now)) !== null;
}

async function hold(env: PremiereEnv, videoId: string, ownerId: string, value: PremiereHold): Promise<{ video: PremiereVideo } | { problem: PremiereProblem | 'forbidden' | 'not_found' }> {
	const { data, rejected } = await videos(env).updateObjectOrReject<PremiereProblem | 'forbidden'>(videoId, (fresh) => {
		if (fresh.userId !== ownerId) return { reject: 'forbidden' };
		const problem = premiereProblem(fresh);
		if (problem) return { reject: problem };
		fresh.premiereHold = { ...value, ...(fresh.isDraft === true ? { draft: true } : {}) };
		fresh.dateModified = value.heldAt;
		return true;
	});
	if (!data) return { problem: 'not_found' };
	return rejected ? { problem: rejected } : { video: data };
}

/**
 * Takes this stream's hold off the video, which is then as it was: not public (only such a video is held)
 * and a draft if it was one. Written here, so a write that slipped past the guards while it was held cannot
 * open it when the premiere is cancelled.
 */
export async function releaseHold(env: PremiereEnv, videoId: string, streamId: string): Promise<void> {
	await videos(env).updateObject(videoId, (fresh) => {
		if (fresh.premiereHold?.streamId !== streamId) return false;
		const { draft } = fresh.premiereHold;
		delete fresh.premiereHold;
		fresh.isPublic = false;
		delete fresh.isUnlisted;
		if (draft) fresh.isDraft = true;
		return true;
	});
}

/**
 * Whether the video is held for a premiere that is really there. A hold whose stream is gone, over, or
 * shows another video is removed, so a lost record can never lock a video.
 */
export async function heldForPremiere(env: PremiereEnv, video: { id: string; premiereHold?: PremiereHold }, now = Date.now()): Promise<boolean> {
	const value = video.premiereHold;
	if (!value) return false;
	if (now - Date.parse(value.heldAt) < STALE_AFTER_MS) return true;
	const stream = await streams(env).getObject(streamKey(value.streamId));
	if (isPremiere(stream) && stream.premiereVideoId === video.id && (stream.status === 'scheduled' || stream.status === 'live')) return true;
	logger.warn('[Premiere] Stale hold removed', { videoId: video.id, streamId: value.streamId });
	await releaseHold(env, video.id, value.streamId);
	return false;
}

export interface NewPremiere {
	video: PremiereVideo;
	scheduledStartTime: string;
	actorId: string;
	fields: Record<string, unknown>;
}

/** Holds the video, then writes the stream; a failed second write takes the hold off again. */
export async function createPremiere(env: PremiereEnv, input: NewPremiere, now = Date.now()): Promise<{ stream: PremiereStream } | { problem: PremiereProblem | 'forbidden' | 'not_found' }> {
	const id = crypto.randomUUID();
	const at = new Date(now).toISOString();
	const held = await hold(env, input.video.id, input.video.userId, { streamId: id, heldAt: at, heldBy: input.actorId });
	if ('problem' in held) return held;
	const video = held.video;
	const stream = {
		title: video.title,
		description: video.description,
		tags: [],
		thumbnailUrl: video.thumbnailUrl,
		allowChat: true,
		...input.fields,
		id,
		kind: 'premiere',
		premiereVideoId: video.id,
		durationSeconds: Math.max(1, Math.round(Number(video.duration))),
		// The creator's word for it on the source platform: no chat, no replay, no reminders
		...(isMadeForKids(video as ContentFlagFields) ? { madeForKids: true } : {}),
		userId: video.userId,
		...(input.actorId !== video.userId ? { createdBy: input.actorId } : {}),
		channelId: video.channelId,
		status: 'scheduled',
		scheduledStartTime: new Date(input.scheduledStartTime).toISOString(),
		isPrivate: false,
		dateCreated: at,
		dateModified: at,
		currentViewers: 0,
		peakViewers: 0,
		views: 0,
		likes: [],
		dislikes: [],
		comments: [],
	} as unknown as PremiereStream;
	try {
		await streams(env).putObject(streamKey(id), stream);
	} catch (error) {
		await releaseHold(env, video.id, id).catch(() => undefined);
		throw error;
	}
	return { stream };
}

/** Its video was marked as made for kids while it waits: the premiere has no chat or reminders either (wiki E20 §5.5). */
export async function markPremiereMadeForKids(env: PremiereEnv, streamId: string): Promise<void> {
	await streams(env).updateObject(streamKey(streamId), (fresh) => {
		if (!isPremiere(fresh) || fresh.madeForKids === true) return false;
		fresh.madeForKids = true;
		return true;
	});
}

/** Shows another video instead, before the start. */
export async function swapPremiere(env: PremiereEnv, stream: PremiereStream, video: PremiereVideo, actorId: string, now = Date.now()): Promise<{ stream: PremiereStream } | { problem: PremiereProblem | 'forbidden' | 'not_found' | 'premiere_started' }> {
	const previous = stream.premiereVideoId;
	if (video.userId !== stream.userId || video.channelId !== stream.channelId) return { problem: 'forbidden' };
	const held = await hold(env, video.id, video.userId, { streamId: stream.id, heldAt: new Date(now).toISOString(), heldBy: actorId });
	if ('problem' in held) return held;
	let saved: { data: PremiereStream | null; rejected?: true };
	try {
		saved = await streams(env).updateObjectOrReject<true>(streamKey(stream.id), (fresh) => {
			if (fresh.status !== 'scheduled' || fresh.premiereVideoId !== previous) return { reject: true };
			fresh.premiereVideoId = video.id;
			fresh.durationSeconds = Math.max(1, Math.round(Number(held.video.duration)));
			if (isMadeForKids(held.video as ContentFlagFields)) fresh.madeForKids = true;
			fresh.dateModified = new Date(now).toISOString();
			return true;
		});
	} catch (error) {
		await releaseHold(env, video.id, stream.id).catch(() => undefined);
		throw error;
	}
	if (!saved.data || saved.rejected) {
		await releaseHold(env, video.id, stream.id);
		return { problem: 'premiere_started' };
	}
	if (previous) await releaseHold(env, previous, stream.id);
	return { stream: saved.data };
}

/** Cancels a premiere that has not started, then frees the video. 'started': the start won. */
export async function cancelPremiere(env: PremiereEnv, streamId: string, reason: 'owner' | 'video_unavailable' | 'missed', now = Date.now()): Promise<{ outcome: 'cancelled' | 'already' | 'started' | 'missing'; stream: PremiereStream | null }> {
	const { data, rejected } = await streams(env).updateObjectOrReject<'already' | 'started'>(streamKey(streamId), (fresh) => {
		if (fresh.status === 'cancelled') return { reject: 'already' };
		if (fresh.status !== 'scheduled' || !isPremiere(fresh)) return { reject: 'started' };
		fresh.status = 'cancelled';
		fresh.cancelReason = reason;
		fresh.dateModified = new Date(now).toISOString();
		return true;
	});
	if (!data) return { outcome: 'missing', stream: null };
	if (rejected === 'started') return { outcome: 'started', stream: data };
	// Also after an earlier cancel whose second step was lost
	if (data.premiereVideoId) await releaseHold(env, data.premiereVideoId, streamId);
	if (!rejected) {
		logger.info('[Premiere] Cancelled', { streamId, reason });
		// Not by its owner: they are told
		if (reason !== 'owner') {
			await enqueueNotification(env as never, {
				notificationId: crypto.randomUUID(),
				recipientUserId: data.userId,
				notificationKey: 'premiereCancelled',
				params: { streamTitle: data.title || '' },
				actionUrl: data.channelId ? `/studio/${data.channelId}/content/live` : `/live/${streamId}`,
				entityId: streamId,
				dedupeKey: `premiere-cancelled:${streamId}`,
				createdAt: now,
			});
		}
	}
	return { outcome: rejected ?? 'cancelled', stream: data };
}

/** The held video was removed: its premiere is off (lib/search/sync.ts, every write that removes a video). */
export async function onHeldVideoRemoved(env: PremiereEnv, video: { id?: string; premiereHold?: PremiereHold }): Promise<void> {
	if (video.premiereHold) await cancelPremiere(env, video.premiereHold.streamId, 'video_unavailable');
}

export type StartOutcome = 'started' | 'waiting' | 'cancelled' | 'not_due' | 'lost';

/** Whether a premiere's video can still be shown at all (the heads-up asks before it reminds anyone). */
export async function premiereStillPossible(env: PremiereEnv, stream: PremiereStream): Promise<boolean> {
	return (await readiness(env, stream)) !== 'never';
}

/** Whether a due premiere can start now: 'go', try again next minute, or never. */
async function readiness(env: PremiereEnv, stream: PremiereStream): Promise<'go' | 'wait' | 'never'> {
	const video = stream.premiereVideoId ? await videos(env).getObject(stream.premiereVideoId) : null;
	if (!video || isVideoRemoved(video) || video.channelId !== stream.channelId || (video as { review?: { status?: string } }).review?.status === 'rejected') return 'never';
	// Lost its hold, or held for another premiere
	if (video.premiereHold?.streamId !== stream.id) return 'never';
	if (!isVideoReady(video) || stream.isHidden || hasSuspensionHolds(stream as Record<string, unknown>)) return 'wait';
	if (!(await featureGate(env as never, 'livePremieres')).on) return 'wait';
	if (!tierAllowsLiveCapability(await channelOwnerTier(env.SEARCH_DB!, stream.userId), 'livePremieres')) return 'wait';
	return 'go';
}

/**
 * Starts a premiere. `early`: its owner starts it before the time. One conditional write on the stream
 * claims the start, so it happens once; freeing the video and telling people come after and may be
 * repeated (finishStart), so a crash in between is repaired by the next minute.
 */
export async function startPremiere(env: PremiereEnv, streamId: string, options: { early?: boolean; now?: number } = {}): Promise<StartOutcome> {
	const now = options.now ?? Date.now();
	const due = (s: PremiereStream) => options.early === true || Date.parse(s.scheduledStartTime ?? '') <= now;
	const stream = await streams(env).getObject(streamKey(streamId));
	if (!isPremiere(stream) || stream.status !== 'scheduled' || !due(stream)) return 'not_due';
	const ready = await readiness(env, stream);
	if (ready !== 'go') {
		if (ready === 'never') return (await cancelPremiere(env, streamId, 'video_unavailable', now)).outcome === 'cancelled' ? 'cancelled' : 'lost';
		if (!options.early && now - Date.parse(stream.scheduledStartTime ?? '') > PREMIERE_GRACE_MS) return (await cancelPremiere(env, streamId, 'missed', now)).outcome === 'cancelled' ? 'cancelled' : 'lost';
		return 'waiting';
	}
	const { data, rejected } = await streams(env).updateObjectOrReject<true>(streamKey(streamId), (fresh) => {
		// Cancelled, rescheduled, swapped or started meanwhile
		if (fresh.status !== 'scheduled' || fresh.premiereVideoId !== stream.premiereVideoId || !due(fresh)) return { reject: true };
		fresh.status = 'live';
		fresh.actualStartTime = new Date(now).toISOString();
		fresh.dateModified = fresh.actualStartTime;
		return true;
	});
	if (!data || rejected) return 'lost';
	await finishStart(env, data, now);
	return 'started';
}

/**
 * After the claim: the video is public, then subscribers hear of it, then that is noted on the stream. Each
 * step may be repeated (the processor and social posts de-duplicate per stream); until it is noted, every
 * tick does it again.
 */
async function finishStart(env: PremiereEnv, stream: PremiereStream, now: number): Promise<void> {
	const video = await videos(env).updateObject(stream.premiereVideoId!, (fresh) => {
		if (fresh.premiereHold?.streamId !== stream.id) return false;
		const before = { ...fresh };
		delete fresh.premiereHold;
		fresh.isPublic = true;
		delete fresh.isUnlisted;
		fresh.isDraft = false;
		fresh.dateModified = new Date(now).toISOString();
		markPublished(before as never, fresh as never, fresh.dateModified);
		return true;
	});
	// One notification per premiere: this one, and not "new video" too (the processor de-duplicates repeats)
	const announced = !stream.channelId || (await announceLiveStarted(env as never, { id: stream.id, channelId: stream.channelId, userId: stream.userId, title: stream.title, madeForKids: isMadeForKids(video as ContentFlagFields | null) || stream.madeForKids === true }).catch(() => false));
	if (!announced) {
		logger.warn('[Premiere] Not announced yet; the next minute tries again', { streamId: stream.id });
		return;
	}
	await streams(env).updateObject(streamKey(stream.id), (fresh) => {
		if (fresh.announcedAt) return false;
		fresh.announcedAt = new Date(now).toISOString();
		return true;
	});
	logger.info('[Premiere] Started', { streamId: stream.id, videoId: stream.premiereVideoId });
}

/** Ends a running premiere; the video stays as it is, and the page plays it like any other. */
export async function endPremiere(env: PremiereEnv, streamId: string, now = Date.now()): Promise<PremiereStream | null> {
	return streams(env).updateObject(streamKey(streamId), (fresh) => {
		if (!isPremiere(fresh) || fresh.status !== 'live') return false;
		fresh.status = 'ended';
		fresh.actualEndTime = new Date(now).toISOString();
		fresh.dateModified = fresh.actualEndTime;
		return true;
	});
}

/** One running premiere: finish a start that was cut short, end it when its time is up or its video is gone. */
async function tickRunning(env: PremiereEnv, streamId: string, now: number): Promise<'repaired' | 'ended' | null> {
	const stream = await streams(env).getObject(streamKey(streamId));
	if (!isPremiere(stream) || stream.status !== 'live') return null;
	const video = stream.premiereVideoId ? await videos(env).getObject(stream.premiereVideoId) : null;
	// Cut short after the claim: the video is still held, or nobody was told
	const unfinished = video?.premiereHold?.streamId === stream.id || (!stream.announcedAt && isVideoOpenToAnyone(video));
	if (video && unfinished && !isVideoRemoved(video)) {
		await finishStart(env, stream, now);
		return 'repaired';
	}
	const over = now >= Date.parse(stream.actualStartTime ?? '') + (stream.durationSeconds ?? 0) * 1000;
	if (!over && isVideoOpenToAnyone(video)) return null;
	await endPremiere(env, streamId, now);
	return 'ended';
}

/** Every minute (production) or 5 (QA, stage): due premieres start, running ones end. Each on its own: one failure stops no other. */
export async function runPremieres(env: PremiereEnv, now = Date.now()): Promise<{ started: number; ended: number; cancelled: number; failed: number }> {
	const out = { started: 0, ended: 0, cancelled: 0, failed: 0 };
	const db = env.SEARCH_DB;
	if (!db) return out;
	const ids = async (sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all<{ stream_id: string }>()).results ?? []).map((r) => r.stream_id);
	const [due, running] = await Promise.all([
		ids(`SELECT stream_id FROM ${LIVE_METADATA_TABLE} WHERE kind = 'premiere' AND status = 'scheduled' AND scheduled_start_at <= ? ORDER BY scheduled_start_at LIMIT 50`, now),
		ids(`SELECT stream_id FROM ${LIVE_METADATA_TABLE} WHERE kind = 'premiere' AND status = 'live' LIMIT 200`),
	]);
	const each = async (id: string, work: () => Promise<void>) => {
		try {
			await work();
		} catch (error) {
			out.failed++;
			logger.error('[Premiere] Tick failed; the next minute tries again', { streamId: id, error: error instanceof Error ? error.message : String(error) });
		}
	};
	for (const id of due) {
		await each(id, async () => {
			const outcome = await startPremiere(env, id, { now });
			if (outcome === 'started') out.started++;
			if (outcome === 'cancelled') out.cancelled++;
		});
	}
	for (const id of running) {
		await each(id, async () => {
			if ((await tickRunning(env, id, now)) === 'ended') out.ended++;
		});
	}
	return out;
}

/** The premiere each held video waits for, for its team's lists. Read by stream id; no time while unreadable. */
export async function premiereTimes(env: { SEARCH_DB?: D1Database }, list: ReadonlyArray<{ id: string; premiereHold?: PremiereHold } | null>): Promise<Map<string, { streamId: string; startsAt: string | null }>> {
	const held = list.flatMap((video) => (video?.premiereHold ? [{ id: video.id, streamId: video.premiereHold.streamId }] : []));
	const times = new Map<string, number>();
	if (env.SEARCH_DB && held.length) {
		try {
			for (let i = 0; i < held.length; i += 90) {
				const part = held.slice(i, i + 90);
				const { results } = await env.SEARCH_DB.prepare(`SELECT stream_id, scheduled_start_at FROM ${LIVE_METADATA_TABLE} WHERE stream_id IN (${part.map(() => '?').join(', ')})`)
					.bind(...part.map((v) => v.streamId))
					.all<{ stream_id: string; scheduled_start_at: number | null }>();
				for (const row of results ?? []) if (row.scheduled_start_at !== null) times.set(row.stream_id, row.scheduled_start_at);
			}
		} catch (error) {
			logger.warn('[Premiere] Times not read', { error: error instanceof Error ? error.message : String(error) });
		}
	}
	return new Map(held.map(({ id, streamId }) => [id, { streamId, startsAt: times.has(streamId) ? new Date(times.get(streamId)!).toISOString() : null }]));
}
