/**
 * Live sessions: assignment with failover, start, end and the VOD, and the
 * state Studio and the watch page poll. Provider-neutral: callers never branch
 * on the provider (lib/live/providers.ts holds the differences).
 */
import {
	assignLiveProvider,
	otherLiveProvider,
	type LiveAssignment,
	type LiveIngest,
	type LiveProviderId,
	type LiveProviderUsage,
	type LiveRefusalCode,
	type LiveRoutingSettings,
	type LiveStreamState,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { LIVE_ADAPTERS, LiveProviderError, type LiveEnv } from './providers';
import {
	insertSession,
	nextAssignSeq,
	readChannelOverride,
	readLiveRouting,
	readSession,
	readUsage,
	recordEvent,
	updateSession,
	type LiveSessionRow,
} from './store';
import { finalizeSelfHosted } from './finalize';

export class LiveRefusedError extends Error {
	constructor(readonly code: LiveRefusalCode, readonly reasons: unknown) {
		super(code);
	}
}

const db = (env: LiveEnv) => {
	if (!env.SEARCH_DB) throw new LiveProviderError('selfhosted', 'not_configured', 'SEARCH_DB is not bound');
	return env.SEARCH_DB;
};

export async function providerUsage(env: LiveEnv, settings: LiveRoutingSettings, now = Date.now()): Promise<Record<LiveProviderId, LiveProviderUsage>> {
	const [usage, bunny, selfhosted] = await Promise.all([
		readUsage(db(env), settings, now),
		LIVE_ADAPTERS.bunny.available(env),
		LIVE_ADAPTERS.selfhosted.available(env),
	]);
	return { bunny: { ...usage.bunny, available: bunny }, selfhosted: { ...usage.selfhosted, available: selfhosted } };
}

export interface NewSession {
	session: LiveSessionRow;
	assignment: LiveAssignment;
}

/**
 * Assigns a provider and provisions a session for a stream. When the provider
 * fails to provision and fallback is on, the other provider (if it may take
 * streams) is tried and the failover recorded on the session and in events.
 */
export async function provisionSession(
	env: LiveEnv,
	stream: { id: string; title: string; channelId?: string | null; providerMove?: LiveProviderId | null; isTest?: boolean },
	now = Date.now(),
): Promise<NewSession> {
	const d1 = db(env);
	const settings = await readLiveRouting(d1, now);
	const [usage, override, seq] = await Promise.all([
		providerUsage(env, settings, now),
		readChannelOverride(d1, stream.channelId),
		nextAssignSeq(d1),
	]);
	const result = assignLiveProvider({ settings, usage, channelOverride: override, streamMove: stream.providerMove ?? null, seq, now: new Date(now).toISOString() });
	if ('code' in result) {
		logger.warn('[Live] No provider may take a new stream', { streamId: stream.id, code: result.code, reasons: result.reasons });
		throw new LiveRefusedError(result.code, result.reasons);
	}
	const assignment = result.assignment;
	const lowLatency = settings.selfhosted.lowLatency;
	const tryProvision = async (provider: LiveProviderId) => {
		const sessionId = crypto.randomUUID();
		const provisioned = await LIVE_ADAPTERS[provider].provision(env, {
			streamId: stream.id,
			sessionId,
			title: stream.title,
			lowLatency,
			recordVod: provider === 'selfhosted' ? settings.selfhosted.recordVod : true,
		});
		return { sessionId, provisioned };
	};
	let provider = assignment.provider;
	let made: Awaited<ReturnType<typeof tryProvision>>;
	try {
		made = await tryProvision(provider);
	} catch (error) {
		const code = error instanceof LiveProviderError ? error.code : 'error';
		const other = otherLiveProvider(provider);
		const otherOk = settings.fallback && settings.providers[other].enabled && !settings.providers[other].draining && usage[other].available;
		logger.warn('[Live] Provider failed to provision', { streamId: stream.id, provider, code, fallback: otherOk ? other : null });
		if (!otherOk) throw error;
		made = await tryProvision(other);
		assignment.failover = { from: provider, error: code };
		assignment.reason = 'failover';
		provider = other;
		assignment.provider = other;
	}
	const session = {
		id: made.sessionId,
		stream_id: stream.id,
		channel_id: stream.channelId ?? null,
		provider,
		provider_ref: made.provisioned.providerRef,
		reason: assignment.reason,
		preferred: assignment.preferred,
		seq: assignment.seq,
		failover_from: assignment.failover?.from ?? null,
		failover_error: assignment.failover?.error ?? null,
		low_latency: lowLatency && provider === 'selfhosted' ? 1 : 0,
		is_test: stream.isTest ? 1 : 0,
		created_at: now,
		playback_url: made.provisioned.playbackUrl,
	};
	await insertSession(d1, session);
	await recordEvent(d1, { sessionId: session.id, provider, kind: 'assigned', at: now, detail: assignment });
	if (assignment.failover) await recordEvent(d1, { sessionId: session.id, provider, kind: 'failover', at: now, detail: assignment.failover });
	return { session: (await readSession(d1, session.id))!, assignment };
}

/** Owner: the encoder settings of a session. */
export async function sessionIngest(env: LiveEnv, session: LiveSessionRow): Promise<LiveIngest> {
	return LIVE_ADAPTERS[session.provider].ingest(env, session);
}

/**
 * Owner pressed "Go live": tells the provider to accept ingest. A Bunny start
 * failure with fallback on re-provisions the stream on self-hosted (the
 * encoder settings change; Studio shows the new ones).
 */
export async function startSession(env: LiveEnv, session: LiveSessionRow, stream: { id: string; title: string; channelId?: string | null }, now = Date.now()): Promise<LiveSessionRow> {
	const d1 = db(env);
	try {
		await LIVE_ADAPTERS[session.provider].start(env, session);
		await updateSession(d1, session.id, { start_requested_at: now }, ['provisioned', 'live']);
		return (await readSession(d1, session.id))!;
	} catch (error) {
		const code = error instanceof LiveProviderError ? error.code : 'error';
		await recordEvent(d1, { sessionId: session.id, provider: session.provider, kind: 'start_failed', at: now, detail: { code } });
		const settings = await readLiveRouting(d1, now);
		if (!settings.fallback) throw error;
		await updateSession(d1, session.id, { status: 'failed', error: code, ended_at: now, end_reason: 'start_failed' });
		const next = await provisionSession(env, { ...stream, providerMove: otherLiveProvider(session.provider) }, now);
		await d1
			.prepare("UPDATE live_sessions SET reason = 'failover', failover_from = ?, failover_error = ? WHERE id = ?")
			.bind(session.provider, code, next.session.id)
			.run();
		await recordEvent(d1, { sessionId: next.session.id, provider: next.session.provider, kind: 'failover', at: now, detail: { from: session.provider, error: code, stage: 'start' } });
		await LIVE_ADAPTERS[next.session.provider].start(env, next.session);
		await updateSession(d1, next.session.id, { start_requested_at: now });
		return (await readSession(d1, next.session.id))!;
	}
}

/** Ends a session (owner, idle timeout or admin). Idempotent. */
export async function endSession(env: LiveEnv, session: LiveSessionRow, reason: string, now = Date.now()): Promise<LiveSessionRow> {
	const d1 = db(env);
	if (session.status === 'ended' || session.status === 'failed') return session;
	const claimed = await updateSession(d1, session.id, { status: 'ended', ended_at: now, end_reason: reason }, ['provisioned', 'live']);
	if (!claimed) return (await readSession(d1, session.id))!;
	await recordEvent(d1, { sessionId: session.id, provider: session.provider, kind: 'ended', at: now, detail: { reason } });
	try {
		if (session.provider === 'selfhosted') {
			const settings = await readLiveRouting(d1, now);
			await finalizeSelfHosted(env, session, { recordVod: settings.selfhosted.recordVod, now });
		} else {
			const out = await LIVE_ADAPTERS.bunny.stop(env, session);
			if (out.vodUrl) await updateSession(d1, session.id, { vod_url: out.vodUrl });
		}
	} catch (error) {
		const code = error instanceof LiveProviderError ? error.code : error instanceof Error ? error.message.slice(0, 200) : 'error';
		logger.error('[Live] Ending the session at the provider failed', { sessionId: session.id, provider: session.provider, code });
		await updateSession(d1, session.id, { error: code });
		await recordEvent(d1, { sessionId: session.id, provider: session.provider, kind: 'error', at: now, detail: { stage: 'stop', code } });
	}
	return (await readSession(d1, session.id))!;
}

const RECEIVING_WINDOW_MS = 15_000;

/**
 * Bunny sessions: poll the provider (connect time, bitrate, viewers) and mark
 * the session live when it publishes; record VOD readiness after the end.
 * Called by the state endpoint (throttled per session) and the minute cron.
 */
export async function refreshBunnySession(env: LiveEnv, session: LiveSessionRow, now = Date.now()): Promise<LiveSessionRow> {
	const d1 = db(env);
	try {
		if (session.status === 'ended' && !session.vod_ready_at && LIVE_ADAPTERS.bunny.vodReady) {
			if (await LIVE_ADAPTERS.bunny.vodReady(env, session)) {
				await updateSession(d1, session.id, { vod_ready_at: now });
				await recordEvent(d1, { sessionId: session.id, provider: 'bunny', kind: 'vod_ready', at: now, value: now - (session.ended_at ?? now) });
			}
			return (await readSession(d1, session.id))!;
		}
		if (session.status !== 'provisioned' && session.status !== 'live') return session;
		const st = await LIVE_ADAPTERS.bunny.status(env, session);
		if (!st) return session;
		const set: Partial<LiveSessionRow> = {};
		if (st.receiving) {
			if (!session.ingest_connected_at) set.ingest_connected_at = st.startedAt ?? now;
			if (!session.first_segment_at) set.first_segment_at = now;
			set.last_segment_at = now;
			if (session.status === 'provisioned') set.status = 'live';
		}
		if (st.viewers != null) set.peak_viewers = Math.max(session.peak_viewers, st.viewers);
		if (st.viewerSeconds != null) set.viewer_seconds = st.viewerSeconds;
		if (Object.keys(set).length) await updateSession(d1, session.id, set);
		if (st.bitrateKbps != null) await recordEvent(d1, { sessionId: session.id, provider: 'bunny', kind: 'bitrate', at: now, value: st.bitrateKbps });
	} catch (error) {
		logger.warn('[Live] Bunny status poll failed', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) });
	}
	return (await readSession(d1, session.id))!;
}

export function sessionState(stream: { id: string; status: string }, session: LiveSessionRow | null, now = Date.now()): LiveStreamState {
	return {
		streamId: stream.id,
		sessionId: session?.id ?? null,
		status: (stream.status as LiveStreamState['status']) ?? 'scheduled',
		sessionStatus: session?.status ?? null,
		receiving: !!session && session.status === 'live' && !!session.last_segment_at && now - session.last_segment_at < RECEIVING_WINDOW_MS,
		playbackUrl: session && (session.status === 'live' || session.status === 'provisioned') ? session.playback_url : null,
		vodUrl: session?.vod_ready_at ? session.vod_url : null,
		startedAt: session?.first_segment_at ? new Date(session.first_segment_at).toISOString() : null,
		endedAt: session?.ended_at ? new Date(session.ended_at).toISOString() : null,
		bitrateKbps: null,
	};
}

/**
 * Minute cron: end self-hosted sessions whose encoder went quiet (idle
 * timeout) and poll live Bunny sessions. Bounded per run.
 */
export async function sweepLiveSessions(env: LiveEnv, now = Date.now()): Promise<{ idleEnded: number; bunnyPolled: number }> {
	if (!env.SEARCH_DB) return { idleEnded: 0, bunnyPolled: 0 };
	const d1 = env.SEARCH_DB;
	const settings = await readLiveRouting(d1, now);
	const idleBefore = now - settings.selfhosted.idleTimeoutSec * 1000;
	// Never-connected sessions are kept 6 h (a creator may set up the encoder well before going live).
	const { results: idle } = await d1
		.prepare(
			"SELECT * FROM live_sessions WHERE provider = 'selfhosted' AND ((status = 'live' AND last_segment_at < ?) OR (status = 'provisioned' AND created_at < ?)) LIMIT 20",
		)
		.bind(idleBefore, now - 6 * 3_600_000)
		.all<LiveSessionRow>();
	let idleEnded = 0;
	for (const s of idle ?? []) {
		await endSession(env, s, s.status === 'live' ? 'idle_timeout' : 'never_started', now);
		await onSessionEnded?.(env, s);
		idleEnded++;
	}
	const { results: bunny } = await d1
		.prepare("SELECT * FROM live_sessions WHERE provider = 'bunny' AND (status IN ('provisioned', 'live') OR (status = 'ended' AND vod_ready_at IS NULL AND ended_at > ?)) ORDER BY created_at DESC LIMIT 20")
		.bind(now - 6 * 3_600_000)
		.all<LiveSessionRow>();
	for (const s of bunny ?? []) await refreshBunnySession(env, s, now);
	return { idleEnded, bunnyPolled: (bunny ?? []).length };
}

/** Hook set by the API layer so an idle end also ends the stream record (lib/live/streams.ts). */
let onSessionEnded: ((env: LiveEnv, session: LiveSessionRow) => Promise<void>) | null = null;
export function setOnSessionEnded(fn: typeof onSessionEnded): void {
	onSessionEnded = fn;
}
