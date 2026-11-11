/**
 * The self-hosted live edge, served by this worker on the live host
 * (LIVE_PUBLIC_HOST, e.g. live.qa.alummahnow.net):
 *
 *   PUT  /ingest/{sessionId}/{key}/master.m3u8            encoder → R2
 *   PUT  /ingest/{sessionId}/{key}/{rendition}/index.m3u8 (indexes the segments)
 *   PUT  /ingest/{sessionId}/{key}/{rendition}/init.mp4 | seg_{n}.m4s
 *   GET  /hls/{sessionId}/...                              R2 → edge cache → players
 *   GET  /time                                             server clock (latency harness)
 *
 * Keys are HMACs of the session id and key version (lib/live/providers.ts), so
 * a segment PUT needs no lookup beyond the session's status (cached 5 s).
 * Segments are immutable (cached a year at the edge); playlists 1 s, so many
 * viewers polling one playlist cost one R2 read per second per colo.
 * Delivery counters (requests, bytes, cache hits, R2 reads) are summed per
 * isolate and flushed to the session row every 30 s: cost units without a
 * write per request.
 */
import { logger } from '../logger';
import { verifySelfHostedKey, type LiveEnv } from './providers';
import { addSessionCounters, readSession, recordEvent, updateSession, type LiveSessionRow } from './store';

const SESSION_TTL_MS = 5_000;
const FLUSH_MS = 30_000;
const MAX_SEGMENT = 25 * 1024 * 1024;
const MAX_PLAYLIST = 256 * 1024;
const RENDITION = /^[a-z0-9_]{1,16}$/;
const SEGMENT = /^seg_\d{1,20}\.(m4s|ts|mp4)$/;
const INIT = /^init(_\d{1,3})?\.mp4$/;
const UUID = /^[0-9a-f-]{36}$/;

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, HEAD, OPTIONS',
	'access-control-allow-headers': 'range',
	'access-control-expose-headers': 'content-length, age, cf-cache-status, x-live-cache',
	'timing-allow-origin': '*',
};

type SessionInfo = Pick<LiveSessionRow, 'id' | 'provider' | 'status' | 'key_version' | 'stream_id' | 'channel_id' | 'first_segment_at' | 'ingest_connected_at' | 'last_segment_at' | 'segments'>;
const sessions = new Map<string, { at: number; s: SessionInfo | null }>();

async function sessionInfo(db: D1Database, id: string, now: number, fresh = false): Promise<SessionInfo | null> {
	const hit = sessions.get(id);
	if (!fresh && hit && now - hit.at < SESSION_TTL_MS) return hit.s;
	const s = await readSession(db, id);
	sessions.set(id, { at: now, s });
	if (sessions.size > 500) sessions.delete(sessions.keys().next().value!);
	return s;
}

type Counters = { edge_requests: number; delivered_bytes: number; cache_hits: number; r2_reads: number; ingest_bytes: number; r2_writes: number };
const counters = new Map<string, Counters>();
let lastFlush = Date.now();

function count(sessionId: string, add: Partial<Counters>): void {
	const c = counters.get(sessionId) ?? { edge_requests: 0, delivered_bytes: 0, cache_hits: 0, r2_reads: 0, ingest_bytes: 0, r2_writes: 0 };
	for (const [k, v] of Object.entries(add)) c[k as keyof Counters] += v ?? 0;
	counters.set(sessionId, c);
}

/** Writes the summed counters (all sessions) when 30 s have passed, or when forced. */
export async function flushEdgeCounters(db: D1Database, force = false, now = Date.now()): Promise<void> {
	if (!force && now - lastFlush < FLUSH_MS) return;
	lastFlush = now;
	const batch = [...counters.entries()];
	counters.clear();
	for (const [id, c] of batch) {
		try {
			await addSessionCounters(db, id, c);
		} catch (error) {
			logger.warn('[LiveEdge] Counter flush failed', { sessionId: id, error: error instanceof Error ? error.message : String(error) });
		}
	}
}

/** Segment sizes seen at ingest, by session/rendition/uri, for the segment index. */
const segmentBytes = new Map<string, number>();

export interface EdgeHooks {
	/** The session's first segment arrived: mark the stream live (lib/live/streams.ts). */
	onLive(env: LiveEnv, session: SessionInfo): Promise<void>;
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });

export function isLiveHost(env: LiveEnv, host: string | null): boolean {
	return !!env.LIVE_PUBLIC_HOST && !!host && host.toLowerCase() === env.LIVE_PUBLIC_HOST.toLowerCase();
}

export async function handleLiveEdge(request: Request, env: LiveEnv, ctx: ExecutionContext, hooks: EdgeHooks): Promise<Response> {
	const url = new URL(request.url);
	const parts = url.pathname.split('/').filter(Boolean);
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
	if (parts[0] === 'time' && parts.length === 1) return Response.json({ now: Date.now() }, { headers: { ...CORS, 'cache-control': 'no-store' } });
	if (!env.SEARCH_DB || !env.LIVE_MEDIA) return text(503, 'Live edge not configured');
	if (parts[0] === 'hls') return deliver(request, env, ctx, parts.slice(1));
	if (parts[0] === 'ingest') return ingest(request, env, ctx, parts.slice(1), hooks);
	return text(404, 'Not found');
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

async function ingest(request: Request, env: LiveEnv, ctx: ExecutionContext, parts: string[], hooks: EdgeHooks): Promise<Response> {
	const db = env.SEARCH_DB!;
	const now = Date.now();
	const [sessionId, key, ...rest] = parts;
	if (!sessionId || !UUID.test(sessionId) || !key || !rest.length) return text(404, 'Not found');
	const method = request.method;
	if (method !== 'PUT' && method !== 'POST' && method !== 'DELETE') return text(405, 'Method not allowed');
	const session = await sessionInfo(db, sessionId, now);
	if (!session || session.provider !== 'selfhosted') return text(404, 'Unknown session');
	if (!(await verifySelfHostedKey(env, sessionId, session.key_version, key))) return text(403, 'Bad stream key');
	if (session.status !== 'provisioned' && session.status !== 'live') return text(410, 'Session ended');
	// ffmpeg deletes old segments when asked to; we keep them for the VOD.
	if (method === 'DELETE') return new Response(null, { status: 204 });

	const path = rest.join('/');
	let kind: 'master' | 'media' | 'init' | 'segment';
	let rendition = '';
	if (rest.length === 1 && rest[0] === 'master.m3u8') kind = 'master';
	else if (rest.length === 1 && INIT.test(rest[0])) kind = 'init';
	else if (rest.length === 2 && RENDITION.test(rest[0])) {
		rendition = rest[0];
		if (rest[1] === 'index.m3u8') kind = 'media';
		else if (INIT.test(rest[1])) kind = 'init';
		else if (SEGMENT.test(rest[1])) kind = 'segment';
		else return text(400, 'Unexpected file name');
	} else return text(400, 'Unexpected path');

	const body = await request.arrayBuffer();
	const limit = kind === 'segment' || kind === 'init' ? MAX_SEGMENT : MAX_PLAYLIST;
	if (body.byteLength > limit) return text(413, 'Too large');
	const isPlaylist = kind === 'master' || kind === 'media';
	await env.LIVE_MEDIA!.put(`live/${sessionId}/${path}`, body, {
		httpMetadata: {
			contentType: isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp4',
			cacheControl: isPlaylist ? 'public, max-age=1' : 'public, max-age=31536000, immutable',
		},
	});
	count(sessionId, { ingest_bytes: body.byteLength, r2_writes: 1 });
	if (kind === 'segment') {
		segmentBytes.set(`${sessionId}/${rendition}/${rest[1]}`, body.byteLength);
		if (segmentBytes.size > 5000) segmentBytes.delete(segmentBytes.keys().next().value!);
	}
	if (!session.ingest_connected_at) {
		session.ingest_connected_at = now;
		ctx.waitUntil(
			(async () => {
				if (await updateSession(db, sessionId, { ingest_connected_at: now }, ['provisioned', 'live'])) {
					await recordEvent(db, { sessionId, provider: 'selfhosted', kind: 'ingest_connected', at: now });
				}
			})().catch((e) => logger.warn('[LiveEdge] Connect record failed', { sessionId, error: String(e) })),
		);
	}
	if (kind === 'media') {
		try {
			await indexMediaPlaylist(env, ctx, session, rendition, new TextDecoder().decode(body), now, hooks);
		} catch (error) {
			logger.error('[LiveEdge] Playlist indexing failed', { sessionId, rendition, error: error instanceof Error ? error.message : String(error) });
		}
	}
	ctx.waitUntil(flushEdgeCounters(db).catch(() => undefined));
	return new Response(null, { status: 201, headers: { 'cache-control': 'no-store' } });
}

export interface ParsedSegment {
	seq: number;
	uri: string;
	duration: number;
}

/** Media playlist → its segments with their media sequence numbers. */
export function parseMediaPlaylist(playlist: string): { segments: ParsedSegment[]; targetDuration: number } {
	let mediaSeq = 0;
	let targetDuration = 2;
	let pending: number | null = null;
	const segments: ParsedSegment[] = [];
	for (const raw of playlist.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSeq = parseInt(line.slice(22), 10) || 0;
		else if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = parseFloat(line.slice(22)) || targetDuration;
		else if (line.startsWith('#EXTINF:')) pending = parseFloat(line.slice(8)) || 0;
		else if (!line.startsWith('#') && pending !== null) {
			const m = /seg_(\d+)\./.exec(line);
			segments.push({ seq: m ? Number(m[1]) : mediaSeq + segments.length, uri: line.split('/').pop()!, duration: pending });
			pending = null;
		}
	}
	return { segments, targetDuration };
}

async function indexMediaPlaylist(env: LiveEnv, ctx: ExecutionContext, session: SessionInfo, rendition: string, playlist: string, now: number, hooks: EdgeHooks): Promise<void> {
	const db = env.SEARCH_DB!;
	const { segments, targetDuration } = parseMediaPlaylist(playlist);
	if (!segments.length) return;
	const stmt = db.prepare('INSERT OR IGNORE INTO live_segments (session_id, rendition, seq, uri, duration, bytes, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
	await db.batch(segments.map((s) => stmt.bind(session.id, rendition, s.seq, s.uri, s.duration, segmentBytes.get(`${session.id}/${rendition}/${s.uri}`) ?? 0, now)));
	// One rendition drives the session clock (the first one the encoder lists), so a reconnect is counted once.
	const fresh = await sessionInfo(db, session.id, now, true);
	if (!fresh) return;
	const gapLimit = Math.max(6_000, targetDuration * 3_000);
	const set: Partial<LiveSessionRow> = { last_segment_at: now };
	if (!fresh.first_segment_at) {
		set.first_segment_at = now;
		set.status = 'live';
	} else if (fresh.last_segment_at && now - fresh.last_segment_at > gapLimit) {
		const gap = now - fresh.last_segment_at;
		await db.prepare('UPDATE live_sessions SET reconnects = reconnects + 1 WHERE id = ?').bind(session.id).run();
		await recordEvent(db, { sessionId: session.id, provider: 'selfhosted', kind: 'reconnect', at: now, value: gap, detail: { rendition } });
	}
	await updateSession(db, session.id, set, ['provisioned', 'live']);
	sessions.set(session.id, { at: now, s: { ...fresh, ...set } as SessionInfo });
	if (set.status === 'live') {
		await recordEvent(db, { sessionId: session.id, provider: 'selfhosted', kind: 'first_segment', at: now, value: fresh.ingest_connected_at ? now - fresh.ingest_connected_at : null });
		ctx.waitUntil(hooks.onLive(env, { ...fresh, ...set } as SessionInfo).catch((e) => logger.warn('[LiveEdge] onLive failed', { sessionId: session.id, error: String(e) })));
	}
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliver(request: Request, env: LiveEnv, ctx: ExecutionContext, parts: string[]): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
	const [sessionId, ...rest] = parts;
	if (!sessionId || !UUID.test(sessionId) || !rest.length || rest.length > 2) return text(404, 'Not found');
	const file = rest[rest.length - 1];
	if (rest.length === 2 && !RENDITION.test(rest[0])) return text(404, 'Not found');
	if (!/\.(m3u8|m4s|mp4|ts)$/.test(file)) return text(404, 'Not found');
	const url = new URL(request.url);
	const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
	const cache = (caches as unknown as { default: Cache }).default;
	let response = await cache.match(cacheKey);
	let hit = true;
	if (!response) {
		hit = false;
		const object = await env.LIVE_MEDIA!.get(`live/${sessionId}/${rest.join('/')}`);
		count(sessionId, { r2_reads: 1 });
		if (!object) {
			ctx.waitUntil(flushEdgeCounters(env.SEARCH_DB!).catch(() => undefined));
			return new Response('Not found', { status: 404, headers: { ...CORS, 'cache-control': 'public, max-age=1' } });
		}
		const headers = new Headers(CORS);
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		headers.set('content-length', String(object.size));
		response = new Response(object.body, { headers });
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
	}
	const size = Number(response.headers.get('content-length') ?? 0);
	count(sessionId, { edge_requests: 1, delivered_bytes: request.method === 'HEAD' ? 0 : size, cache_hits: hit ? 1 : 0 });
	ctx.waitUntil(flushEdgeCounters(env.SEARCH_DB!).catch(() => undefined));
	const out = new Response(request.method === 'HEAD' ? null : response.body, response);
	out.headers.set('x-live-cache', hit ? 'HIT' : 'MISS');
	return out;
}
