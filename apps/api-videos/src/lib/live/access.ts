/**
 * Who may fetch a live session's media from the edge (lib/live/edge.ts): the stream's own state, read from its
 * record, decides for every way it can change (moderation, a suspension or ban, private, a deletion, a held
 * recording). Nothing writes a separate flag that could be missed.
 *
 *   public    anyone
 *   managers  only a URL signed for the people who manage the stream (a private stream; a recording held or
 *             rejected by review, VR9)
 *   none      nobody: hidden, deleted, or the stream is gone
 *
 * A review of the recording has URLs of its own (moderators, the extraction worker). They open the recording in any
 * of these states while that review is open, and nothing else does. A trust and safety takedown ends them: its
 * evidence is read from the stores, by super admins.
 *
 * A signed URL carries its token as a path segment, `/hls/<session>/<token>/<file>`, so the relative URIs of the
 * playlists keep it. The two kinds have their own scope and their own MAC domain: `m.<expiry>.<mac>` and
 * `r.<expiry>.<mac>`, the second bound to the review.
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

/** The reviews of a stream's recording that are open: its own until it is approved, and a shadow check. */
export function openReviewIds(stream: object | null | undefined): string[] {
	const s = stream as { review?: { status?: string; reviewId?: string }; reviewShadow?: { reviewId?: string }; csamTakedown?: unknown } | null | undefined;
	if (!s || s.csamTakedown) return [];
	const own = s.review && s.review.status !== 'approved' ? s.review.reviewId : undefined;
	return [own, s.reviewShadow?.reviewId].filter((id): id is string => typeof id === 'string' && !!id);
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

/** What a manager's player gets: valid for this long to twice this long. */
export const MANAGER_URL_SECONDS = 12 * 3600;
/** A recording's review may wait in the transcode queue. */
export const REVIEW_URL_SECONDS = 24 * 3600;
const TOKEN = /^([mr])\.(\d{10})\.([0-9a-f]{40})$/;

type Scope = { kind: 'm' } | { kind: 'r'; reviewId: string };

async function mac(env: LiveEnv, sessionId: string, expires: number, scope: Scope): Promise<string | null> {
	const secret = await getSecret(env.LIVE_INGEST_SECRET, 'LIVE_INGEST_SECRET');
	if (!secret) return null;
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	// Domains of their own: a stream key, a manager's token and a review's token are never each other
	const text = scope.kind === 'm' ? `live-view:v1|${sessionId}|${expires}` : `live-review:v1|${scope.reviewId}|${sessionId}|${expires}`;
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
	return Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(env: LiveEnv, url: string | null, scope: Scope, seconds: number, now: number): Promise<string | null> {
	if (!url || !env.LIVE_PUBLIC_HOST) return url;
	const prefix = `https://${env.LIVE_PUBLIC_HOST}/hls/`;
	const rest = url.startsWith(prefix) ? url.slice(prefix.length) : '';
	const cut = rest.indexOf('/');
	if (cut <= 0) return url;
	const sessionId = rest.slice(0, cut);
	// The same URL for a whole window: the state is polled every 5 seconds, and a new URL would restart the player
	const expires = (Math.floor(now / 1000 / seconds) + 2) * seconds;
	const sig = await mac(env, sessionId, expires, scope);
	return sig ? `${prefix}${sessionId}/${scope.kind}.${expires}.${sig}/${rest.slice(cut + 1)}` : url;
}

/** A self-hosted live URL (`https://<live host>/hls/<session>/…`) for the stream's managers; any other URL as it is. */
export const signManagerUrl = (env: LiveEnv, url: string | null, now = Date.now()) => sign(env, url, { kind: 'm' }, MANAGER_URL_SECONDS, now);

/** The same for one review of the recording. */
export const signReviewUrl = (env: LiveEnv, url: string | null, reviewId: string, now = Date.now()) => sign(env, url, { kind: 'r', reviewId }, REVIEW_URL_SECONDS, now);

export const isViewToken = (segment: string | undefined): segment is string => !!segment && TOKEN.test(segment);

function same(a: string | null, b: string): boolean {
	if (!a || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Whether a request may have the session's media: the state, and the token in its path (checked in constant time). */
export async function mayFetch(env: LiveEnv, sessionId: string, state: SessionState, token: string | null, now = Date.now()): Promise<boolean> {
	if (state.access === 'public') return true;
	const m = token ? TOKEN.exec(token) : null;
	if (!m || Number(m[2]) * 1000 < now) return false;
	const expires = Number(m[2]);
	if (m[1] === 'm') return state.access === 'managers' && same(await mac(env, sessionId, expires, { kind: 'm' }), m[3]!);
	for (const reviewId of state.reviewIds) if (same(await mac(env, sessionId, expires, { kind: 'r', reviewId }), m[3]!)) return true;
	return false;
}

// ---------------------------------------------------------------------------
// The edge's lookup, and the cache after a change
// ---------------------------------------------------------------------------

/** How long one isolate uses what it read; a change is in force everywhere within it. */
export const ACCESS_TTL_MS = 5_000;
/** While the stores cannot be read, what was read last still holds this long (a blip must not stop a broadcast). */
export const ACCESS_STALE_MS = 30_000;

export interface SessionState {
	access: LiveAccess;
	/** Open reviews of the stream's recording */
	reviewIds: string[];
}

const CLOSED: SessionState = { access: 'none', reviewIds: [] };
type Entry = { at: number; state: SessionState };
const entries = new Map<string, Entry>();
const reading = new Map<string, Promise<SessionState>>();
/** A session's stream never changes. */
const streamOf = new Map<string, string>();

/** For tests: every isolate starts empty. */
export function forgetLiveAccess(): void {
	entries.clear();
	reading.clear();
	streamOf.clear();
}

async function readState(env: LiveEnv, sessionId: string): Promise<SessionState> {
	const videos = (env as { videos?: R2Bucket }).videos;
	if (!env.SEARCH_DB || !videos) throw new Error('SEARCH_DB or videos is not bound');
	let streamId = streamOf.get(sessionId);
	if (!streamId) {
		streamId = (await env.SEARCH_DB.prepare('SELECT stream_id FROM live_sessions WHERE id = ?').bind(sessionId).first<{ stream_id: string }>())?.stream_id;
		if (!streamId) return CLOSED;
		if (streamOf.size > 1000) streamOf.delete(streamOf.keys().next().value!);
		streamOf.set(sessionId, streamId);
	}
	const object = await videos.get(`livestream:${streamId}`);
	const stream = object ? ((await object.json()) as object) : null;
	return { access: liveSessionAccess(stream, sessionId), reviewIds: openReviewIds(stream) };
}

/** The session's state now. Throws when it cannot be read and nothing recent is known: the edge then refuses. */
export async function sessionState(env: LiveEnv, sessionId: string, now = Date.now()): Promise<SessionState> {
	const known = entries.get(sessionId);
	if (known && now - known.at < ACCESS_TTL_MS) return known.state;
	let pending = reading.get(sessionId);
	if (!pending) {
		pending = readState(env, sessionId).finally(() => reading.delete(sessionId));
		reading.set(sessionId, pending);
	}
	try {
		const state = await pending;
		if (entries.size > 1000) entries.delete(entries.keys().next().value!);
		entries.set(sessionId, { at: now, state });
		return state;
	} catch (error) {
		if (known && now - known.at < ACCESS_STALE_MS) return known.state;
		throw error;
	}
}

/** Purge calls of one change at most (30 prefixes each). */
const PURGE_SESSIONS = 90;
const RANK: Record<LiveAccess, number> = { none: 0, managers: 1, public: 2 };

/** What the stream's row says of it, before a write (lib/search/sync.ts); null when there is no row or it cannot be read. */
export async function indexedAccess(db: unknown, streamId: string): Promise<LiveAccess | null> {
	const row = await (db as D1Database)
		.prepare('SELECT visibility, recording_withheld FROM live_stream_metadata WHERE stream_id = ?')
		.bind(streamId)
		.first<{ visibility: string; recording_withheld: number }>()
		.catch(() => null);
	if (!row) return null;
	if (row.visibility === 'hidden' || row.visibility === 'deleted') return 'none';
	return row.visibility === 'private' || row.recording_withheld === 1 ? 'managers' : 'public';
}

/**
 * A stream's record was written or deleted. When fewer people may watch it than before, what the CDN keeps of its
 * sessions goes; a write that leaves that as it was (a title, a count) costs nothing. The edge refuses regardless.
 */
export async function purgeWhenClosed(env: LiveEnv & { MEDIA_CDN_API_TOKEN?: unknown }, streamId: string, before: LiveAccess | null, stream: object | null): Promise<void> {
	if (!env.SEARCH_DB || !env.LIVE_PUBLIC_HOST) return;
	const current = liveSessionAccess(stream, (stream as { sessionId?: string } | null)?.sessionId ?? '');
	if (RANK[current] >= RANK[before ?? 'public']) return;
	try {
		const { results } = await env.SEARCH_DB
			.prepare("SELECT id FROM live_sessions WHERE stream_id = ? AND provider = 'selfhosted' AND first_segment_at IS NOT NULL ORDER BY created_at DESC LIMIT ?")
			.bind(streamId, PURGE_SESSIONS)
			.all<{ id: string }>();
		if (!results?.length) return;
		const purged = await purgeCdn(env as never, { prefixes: results.map((s) => `${env.LIVE_PUBLIC_HOST}/hls/${s.id}/`) });
		if (purged === 'failed') logger.warn('[LiveEdge] Cache purge failed; the edge refuses the sessions all the same', { streamId, sessions: results.length });
	} catch (error) {
		logger.warn('[LiveEdge] Could not purge a closed stream', { streamId, error: error instanceof Error ? error.message : String(error) });
	}
}
