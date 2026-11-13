/**
 * Live stream records (R2 `livestream:{id}` in the videos bucket) and their
 * sessions: the API layer over lib/live/service.ts.
 *
 * The record carries the provider-neutral fields every client reads
 * (`provider`, `sessionId`, `playbackUrl`) and, for the owner only, the
 * encoder settings. `providerMove` (set by an admin) applies to the next
 * session; a session that is live is never moved.
 */
import type { LiveProviderId } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { announceLiveStarted } from '../notification-events';
import type { LiveEnv } from './providers';
import { currentBitrateKbps, endSession, provisionSession, refreshBunnySession, sessionIngest, sessionState, startSession, setOnSessionEnded } from './service';
import { readSession, type LiveSessionRow } from './store';
import { setOnVodReady } from './vod-ready';
import { startLiveVodReview, type LiveReviewEnv } from '../review/live';

export interface LiveStreamRecord {
	id: string;
	title: string;
	userId: string;
	channelId?: string | null;
	status: 'scheduled' | 'live' | 'ended' | 'cancelled';
	actualStartTime?: string;
	actualEndTime?: string;
	dateModified?: string;
	provider?: LiveProviderId;
	sessionId?: string | null;
	playbackUrl?: string | null;
	vodUrl?: string | null;
	providerMove?: LiveProviderId | null;
	isTest?: boolean;
	rtmpUrl?: string;
	streamKey?: string;
	streamUrl?: string;
	[k: string]: unknown;
}

export type StreamsEnv = LiveEnv & { videos: R2Bucket; channels?: R2Bucket; queue?: Queue; NOTIFICATIONS_DB?: D1Database };

const repo = (env: StreamsEnv) => new R2Repository<LiveStreamRecord>(env.videos);
export const streamKey = (id: string) => `livestream:${id}`;

export async function readStream(env: StreamsEnv, id: string): Promise<LiveStreamRecord | null> {
	return repo(env).getObject(streamKey(id));
}

/** Provisions the stream's first (or next) session and stores it on the record. */
export async function attachSession(env: StreamsEnv, stream: LiveStreamRecord, now = Date.now()): Promise<{ stream: LiveStreamRecord; session: LiveSessionRow }> {
	const { session } = await provisionSession(env, { id: stream.id, title: stream.title, userId: stream.userId, channelId: stream.channelId, providerMove: stream.providerMove ?? null, isTest: stream.isTest }, now);
	const updated = await repo(env).updateObject(streamKey(stream.id), (fresh) => {
		fresh.provider = session.provider;
		fresh.sessionId = session.id;
		fresh.playbackUrl = session.playback_url;
		fresh.providerMove = null;
		fresh.dateModified = new Date(now).toISOString();
		// Old clients read rtmpUrl/streamKey; the Go live page reads /ingest.
		delete fresh.rtmpUrl;
		delete fresh.streamKey;
		delete fresh.streamUrl;
	});
	return { stream: updated ?? stream, session };
}

/** The stream's current session, provisioning one when it has none or its last one is over. */
export async function currentSession(env: StreamsEnv, stream: LiveStreamRecord, opts: { provision: boolean; now?: number }): Promise<{ stream: LiveStreamRecord; session: LiveSessionRow | null }> {
	const now = opts.now ?? Date.now();
	const existing = stream.sessionId && env.SEARCH_DB ? await readSession(env.SEARCH_DB, stream.sessionId) : null;
	const reusable = existing && (existing.status === 'provisioned' || existing.status === 'live');
	// A pending admin move replaces a session that has not started yet.
	const moved = existing && existing.status === 'provisioned' && stream.providerMove && stream.providerMove !== existing.provider;
	if (reusable && !moved) return { stream, session: existing };
	if (!opts.provision) return { stream, session: existing };
	if (moved) await endSession(env, existing!, 'moved', now);
	return attachSession(env, stream, now);
}

export async function streamIngest(env: StreamsEnv, stream: LiveStreamRecord) {
	const { stream: s, session } = await currentSession(env, stream, { provision: stream.status !== 'ended' && stream.status !== 'cancelled' });
	if (!session) return { stream: s, session: null, ingest: null };
	return { stream: s, session, ingest: await sessionIngest(env, session) };
}

export async function streamStart(env: StreamsEnv, stream: LiveStreamRecord, now = Date.now()) {
	const { stream: s, session } = await currentSession(env, { ...stream, status: 'scheduled' }, { provision: true, now });
	const started = await startSession(env, session!, s, now);
	let record = s;
	if (started.id !== session!.id) {
		record = (await repo(env).updateObject(streamKey(stream.id), (fresh) => {
			fresh.provider = started.provider;
			fresh.sessionId = started.id;
			fresh.playbackUrl = started.playback_url;
		})) ?? s;
	}
	if (record.status === 'ended' || record.status === 'cancelled') {
		record = (await repo(env).updateObject(streamKey(stream.id), (fresh) => {
			fresh.status = 'scheduled';
			delete fresh.actualEndTime;
		})) ?? record;
	}
	return { stream: record, session: started, ingest: await sessionIngest(env, started) };
}

export async function streamEnd(env: StreamsEnv, stream: LiveStreamRecord, reason: string, now = Date.now()) {
	const session = stream.sessionId && env.SEARCH_DB ? await readSession(env.SEARCH_DB, stream.sessionId) : null;
	const ended = session ? await endSession(env, session, reason, now) : null;
	const record = await markStreamEnded(env, stream.id, ended, now);
	return { stream: record ?? stream, session: ended };
}

const lastPoll = new Map<string, number>();

/** Public/owner state; polls Bunny at most every 5 s per session per isolate. */
export async function streamState(env: StreamsEnv, stream: LiveStreamRecord, now = Date.now()) {
	let session = stream.sessionId && env.SEARCH_DB ? await readSession(env.SEARCH_DB, stream.sessionId) : null;
	if (session?.provider === 'bunny' && (session.status === 'provisioned' || session.status === 'live' || (session.status === 'ended' && !session.vod_ready_at))) {
		if (now - (lastPoll.get(session.id) ?? 0) > 5_000) {
			lastPoll.set(session.id, now);
			const before = session.status;
			session = await refreshBunnySession(env, session, now);
			if (before !== 'live' && session.status === 'live') await markStreamLive(env, stream.id, now);
		}
	}
	const fresh = session && session.status === 'live' && stream.status !== 'live' ? { ...stream, status: 'live' as const } : stream;
	const bitrate = session && env.SEARCH_DB ? await currentBitrateKbps(env.SEARCH_DB, session, now).catch(() => null) : null;
	return sessionState(fresh, session, now, bitrate);
}

/** First segment / Bunny publishing: the stream is live (once), subscribers are told. */
export async function markStreamLive(env: StreamsEnv, streamId: string, now = Date.now()): Promise<void> {
	let became = false;
	const updated = await repo(env).updateObject(streamKey(streamId), (fresh) => {
		if (fresh.status === 'live') return false;
		fresh.status = 'live';
		fresh.actualStartTime ??= new Date(now).toISOString();
		fresh.dateModified = new Date(now).toISOString();
		became = true;
		return true;
	});
	if (became && updated) {
		await announceLiveStarted(env as never, { id: streamId, channelId: updated.channelId ?? undefined, userId: updated.userId, title: updated.title }).catch((e) =>
			logger.warn('[Live] Live-started announcement failed', { streamId, error: String(e) }),
		);
	}
}

export async function markStreamEnded(env: StreamsEnv, streamId: string, session: LiveSessionRow | null, now = Date.now()): Promise<LiveStreamRecord | null> {
	return repo(env).updateObject(streamKey(streamId), (fresh) => {
		if (session && fresh.sessionId && fresh.sessionId !== session.id) return false;
		fresh.status = 'ended';
		fresh.actualEndTime ??= new Date(now).toISOString();
		fresh.dateModified = new Date(now).toISOString();
		if (session?.vod_url) fresh.vodUrl = session.vod_url;
		return true;
	});
}

/**
 * Owner deletes a stream: a session still open (provisioned or live) is ended
 * first, so the provider stops ingest and the comparison keeps its rows; then
 * the record goes.
 */
export async function deleteStream(env: StreamsEnv, stream: LiveStreamRecord, now = Date.now()): Promise<void> {
	const session = stream.sessionId && env.SEARCH_DB ? await readSession(env.SEARCH_DB, stream.sessionId) : null;
	if (session && (session.status === 'provisioned' || session.status === 'live')) await endSession(env, session, 'deleted', now);
	await repo(env).deleteObject(streamKey(stream.id));
}

/** Wires idle ends (cron) to the stream record. */
export function registerLiveStreamHooks(): void {
	setOnSessionEnded(async (env, session) => {
		const ended = env.SEARCH_DB ? await readSession(env.SEARCH_DB, session.id) : session;
		await markStreamEnded(env as StreamsEnv, session.stream_id, ended);
	});
	// The recording is checked after the stream (VR9): never before it airs
	setOnVodReady(async (env, session) => {
		await startLiveVodReview(env as unknown as LiveReviewEnv, session.stream_id, session);
	});
}
