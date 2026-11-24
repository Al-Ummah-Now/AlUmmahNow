/**
 * Who may fetch a live session's media from the edge (lib/live/edge.ts): the stream's own state, read from its
 * record, decides for every way it can change (moderation, a suspension or ban, private, a deletion, a held
 * recording). Nothing writes a separate flag that could be missed.
 *
 *   public    anyone
 *   managers  only a URL signed for the people who manage the stream, or for the review of its recording
 *             (a private stream; a recording held or rejected by review, VR9)
 *   none      nobody: hidden, deleted, or the stream is gone
 *
 * A signed URL carries its token as a path segment, `/hls/<session>/<expiry>.<mac>/<file>`, so the relative URIs
 * of the playlists keep it. It opens what is `managers` and never what is `none`.
 */
import { isLiveVodWithheld } from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { logger } from '../logger';
import { purgeCdn } from '../media/r2-delivery';
import type { LiveEnv } from './providers';

export type LiveAccess = 'public' | 'managers' | 'none';

export function liveSessionAccess(stream: object | null | undefined, sessionId: string): LiveAccess {
	const s = stream as { isHidden?: unknown; isDeleted?: unknown; isPrivate?: unknown; sessionId?: unknown; liveAgainSessionId?: unknown; review?: { status?: string } } | null | undefined;
	if (!s || s.isHidden || s.isDeleted) return 'none';
	if (s.isPrivate) return 'managers';
	// Live again after a held recording: that session only (liveRecordingWithheld keeps the stream itself visible)
	if (isLiveVodWithheld(s.review) && !(s.sessionId === sessionId && s.liveAgainSessionId === sessionId)) return 'managers';
	return 'public';
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

/** What a manager's player gets: valid for this long to twice this long. */
export const MANAGER_URL_SECONDS = 12 * 3600;
/** A recording's review may wait in the transcode queue. */
export const REVIEW_URL_SECONDS = 24 * 3600;
const TOKEN = /^(\d{10})\.([0-9a-f]{40})$/;

async function mac(env: LiveEnv, sessionId: string, expires: number): Promise<string | null> {
	const secret = await getSecret(env.LIVE_INGEST_SECRET, 'LIVE_INGEST_SECRET');
	if (!secret) return null;
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	// Its own domain: an encoder's stream key is never a viewing token, and the other way round
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`live-view:v1|${sessionId}|${expires}`)));
	return Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A self-hosted live URL (`https://<live host>/hls/<session>/…`) with a viewing token; any other URL as it is. */
export async function signLiveUrl(env: LiveEnv, url: string | null, seconds = MANAGER_URL_SECONDS, now = Date.now()): Promise<string | null> {
	if (!url || !env.LIVE_PUBLIC_HOST) return url;
	const prefix = `https://${env.LIVE_PUBLIC_HOST}/hls/`;
	const rest = url.startsWith(prefix) ? url.slice(prefix.length) : '';
	const cut = rest.indexOf('/');
	if (cut <= 0) return url;
	const sessionId = rest.slice(0, cut);
	// The same URL for a whole window: the state is polled every 5 seconds, and a new URL would restart the player
	const expires = (Math.floor(now / 1000 / seconds) + 2) * seconds;
	const sig = await mac(env, sessionId, expires);
	return sig ? `${prefix}${sessionId}/${expires}.${sig}/${rest.slice(cut + 1)}` : url;
}

export const isViewToken = (segment: string | undefined): segment is string => !!segment && TOKEN.test(segment);

/** Constant-time check of a path's token. */
export async function verifyViewToken(env: LiveEnv, sessionId: string, token: string, now = Date.now()): Promise<boolean> {
	const m = TOKEN.exec(token);
	if (!m || Number(m[1]) * 1000 < now) return false;
	const expected = await mac(env, sessionId, Number(m[1]));
	if (!expected || expected.length !== m[2]!.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
	return diff === 0;
}

// ---------------------------------------------------------------------------
// The edge's lookup, and the cache after a change
// ---------------------------------------------------------------------------

/** How long one isolate uses what it read; a change is in force everywhere within it. */
export const ACCESS_TTL_MS = 5_000;
/** While the stores cannot be read, what was read last still holds this long (a blip must not stop a broadcast). */
export const ACCESS_STALE_MS = 30_000;

type Entry = { at: number; access: LiveAccess };
const entries = new Map<string, Entry>();
const reading = new Map<string, Promise<LiveAccess>>();
/** A session's stream never changes. */
const streamOf = new Map<string, string>();

/** For tests: every isolate starts empty. */
export function forgetLiveAccess(): void {
	entries.clear();
	reading.clear();
	streamOf.clear();
}

async function readAccess(env: LiveEnv, sessionId: string): Promise<LiveAccess> {
	const videos = (env as { videos?: R2Bucket }).videos;
	if (!env.SEARCH_DB || !videos) throw new Error('SEARCH_DB or videos is not bound');
	let streamId = streamOf.get(sessionId);
	if (!streamId) {
		streamId = (await env.SEARCH_DB.prepare('SELECT stream_id FROM live_sessions WHERE id = ?').bind(sessionId).first<{ stream_id: string }>())?.stream_id;
		if (!streamId) return 'none';
		if (streamOf.size > 1000) streamOf.delete(streamOf.keys().next().value!);
		streamOf.set(sessionId, streamId);
	}
	const object = await videos.get(`livestream:${streamId}`);
	return liveSessionAccess(object ? ((await object.json()) as object) : null, sessionId);
}

/** The session's access now. Throws when it cannot be read and nothing recent is known: the edge then refuses. */
export async function sessionAccess(env: LiveEnv, sessionId: string, now = Date.now()): Promise<LiveAccess> {
	const known = entries.get(sessionId);
	if (known && now - known.at < ACCESS_TTL_MS) return known.access;
	let pending = reading.get(sessionId);
	if (!pending) {
		pending = readAccess(env, sessionId).finally(() => reading.delete(sessionId));
		reading.set(sessionId, pending);
	}
	try {
		const access = await pending;
		if (entries.size > 1000) entries.delete(entries.keys().next().value!);
		entries.set(sessionId, { at: now, access });
		return access;
	} catch (error) {
		if (known && now - known.at < ACCESS_STALE_MS) return known.access;
		throw error;
	}
}

/**
 * A stream's record changed and it is not open to everyone (lib/search/sync.ts, every write and delete): what the
 * CDN keeps of its sessions goes. The edge refuses regardless; this removes the copies.
 */
export async function purgeClosedSessions(env: LiveEnv & { MEDIA_CDN_API_TOKEN?: unknown }, streamId: string, stream: object | null): Promise<void> {
	if (!env.SEARCH_DB || !env.LIVE_PUBLIC_HOST) return;
	try {
		const { results } = await env.SEARCH_DB
			.prepare("SELECT id FROM live_sessions WHERE stream_id = ? AND provider = 'selfhosted' AND first_segment_at IS NOT NULL ORDER BY created_at DESC LIMIT 90")
			.bind(streamId)
			.all<{ id: string }>();
		const closed = (results ?? []).filter((s) => liveSessionAccess(stream, s.id) !== 'public');
		if (!closed.length) return;
		const purged = await purgeCdn(env as never, { prefixes: closed.map((s) => `${env.LIVE_PUBLIC_HOST}/hls/${s.id}/`) });
		if (purged === 'failed') logger.warn('[LiveEdge] Cache purge failed; the edge refuses the session all the same', { streamId, sessions: closed.length });
	} catch (error) {
		logger.warn('[LiveEdge] Could not purge a closed stream', { streamId, error: error instanceof Error ? error.message : String(error) });
	}
}
