/**
 * Live provider adapters. Both expose the same lifecycle (provision → start →
 * status → stop with a VOD) so the API, Studio and the watch page never branch
 * on the provider.
 *
 * - bunny: Bunny Stream Live (closed preview; /library/{id}/live/* API, RTMP
 *   ingest). Available only when the library has preview access: a 403 from
 *   the live API marks it unavailable for 10 minutes, and the router sends new
 *   streams to the other provider (reason rerouted_unavailable).
 * - selfhosted: HTTPS HLS push to the live edge (lib/live/edge.ts), segments in
 *   R2 (LIVE_MEDIA), played from the live host through the edge cache.
 *   RTMP/SRT need Cloudflare Spectrum → Workers `connect()` (private beta);
 *   see REPORT.md.
 */
import type { LiveIngest, LiveProviderId } from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { logger } from '../logger';

export interface LiveEnv {
	SEARCH_DB?: D1Database;
	LIVE_MEDIA?: R2Bucket;
	/** HMAC secret for self-hosted stream keys (Secrets Store). */
	LIVE_INGEST_SECRET?: { get(): Promise<string> } | string;
	/** Live edge host, e.g. live.qa.alummahnow.net */
	LIVE_PUBLIC_HOST?: string;
	/** Bunny RTMP ingest server (from the library's Live tab). */
	BUNNY_LIVE_INGEST_URL?: string;
	/** "false" turns the Bunny adapter off in this environment whatever the API says. */
	BUNNY_LIVE_ENABLED?: string;
	bunny_hostname?: string;
	'bunny-stream-key'?: unknown;
	bunny_stream_library_id?: unknown;
	ENVIRONMENT?: string;
}

export interface ProvisionInput {
	streamId: string;
	sessionId: string;
	title: string;
	lowLatency: boolean;
	recordVod: boolean;
}

export interface Provisioned {
	providerRef: string;
	playbackUrl: string;
}

export interface ProviderStatus {
	receiving: boolean;
	bitrateKbps: number | null;
	/** Provider-reported viewers (Bunny); null when the edge counts them. */
	viewers: number | null;
	viewerSeconds: number | null;
	startedAt: number | null;
	raw?: unknown;
}

export interface SessionRef {
	id: string;
	provider_ref: string | null;
	key_version: number;
	low_latency: number;
}

export interface LiveProviderAdapter {
	id: LiveProviderId;
	available(env: LiveEnv): Promise<boolean>;
	provision(env: LiveEnv, input: ProvisionInput): Promise<Provisioned>;
	ingest(env: LiveEnv, session: SessionRef): Promise<LiveIngest>;
	start(env: LiveEnv, session: SessionRef): Promise<void>;
	status(env: LiveEnv, session: SessionRef): Promise<ProviderStatus | null>;
	/** Stops ingest; returns the VOD URL when the provider makes one asynchronously (null otherwise). */
	stop(env: LiveEnv, session: SessionRef): Promise<{ vodUrl: string | null }>;
	/** Bunny: is the recording playable yet? */
	vodReady?(env: LiveEnv, session: SessionRef): Promise<boolean>;
}

export class LiveProviderError extends Error {
	constructor(readonly provider: LiveProviderId, readonly code: string, message = code) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Self-hosted
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
	let s = '';
	for (const b of sig.slice(0, 24)) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function ingestSecret(env: LiveEnv): Promise<string> {
	const s = await getSecret(env.LIVE_INGEST_SECRET, 'LIVE_INGEST_SECRET');
	if (!s) throw new LiveProviderError('selfhosted', 'not_configured', 'LIVE_INGEST_SECRET is not set');
	return s;
}

/** Stream key for a session: `<version>.<hmac>`; a new version revokes the old key. */
export async function selfHostedKey(env: LiveEnv, sessionId: string, version: number): Promise<string> {
	return `${version}.${await hmac(await ingestSecret(env), `${sessionId}:${version}`)}`;
}

/** Constant-time check of a presented key against the session's current version. */
export async function verifySelfHostedKey(env: LiveEnv, sessionId: string, version: number, presented: string): Promise<boolean> {
	const expected = await selfHostedKey(env, sessionId, version);
	if (presented.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
	return diff === 0;
}

const liveHost = (env: LiveEnv) => {
	if (!env.LIVE_PUBLIC_HOST) throw new LiveProviderError('selfhosted', 'not_configured', 'LIVE_PUBLIC_HOST is not set');
	return env.LIVE_PUBLIC_HOST;
};

/**
 * The encoder command for a self-hosted session: a 3-rung ladder (1080p is
 * left to Studio desktop's hardware encoder), fMP4 HLS segments PUT to the
 * edge, PROGRAM-DATE-TIME for latency measurement, epoch numbering so a
 * reconnect never overwrites earlier segments.
 */
export function selfHostedFfmpeg(ingestBase: string, lowLatency: boolean): string {
	const seg = lowLatency ? 1 : 2;
	const gop = 30 * seg;
	return [
		'ffmpeg -re -i INPUT',
		'-filter_complex "[0:v]split=3[a][b][c];[a]scale=-2:720[v720];[b]scale=-2:480[v480];[c]scale=-2:360[v360]"',
		`-map "[v720]" -map "[v480]" -map "[v360]" -map 0:a -map 0:a -map 0:a`,
		`-c:v libx264 -preset veryfast -tune zerolatency -profile:v main -r 30 -g ${gop} -keyint_min ${gop} -sc_threshold 0`,
		'-b:v:0 2800k -maxrate:v:0 3000k -bufsize:v:0 3000k -b:v:1 1200k -maxrate:v:1 1300k -bufsize:v:1 1300k -b:v:2 700k -maxrate:v:2 750k -bufsize:v:2 750k',
		'-c:a aac -b:a 128k -ac 2 -ar 48000',
		`-f hls -hls_time ${seg} -hls_list_size ${lowLatency ? 4 : 6} -hls_segment_type fmp4 -hls_flags independent_segments+program_date_time`,
		'-hls_start_number_source epoch -method PUT -http_persistent 1 -master_pl_name master.m3u8',
		'-var_stream_map "v:0,a:0,name:720 v:1,a:1,name:480 v:2,a:2,name:360"',
		`-hls_fmp4_init_filename init.mp4 -hls_segment_filename "${ingestBase}/%v/seg_%d.m4s" "${ingestBase}/%v/index.m3u8"`,
	].join(' \\\n  ');
}

export const selfHostedAdapter: LiveProviderAdapter = {
	id: 'selfhosted',
	async available(env) {
		return !!(env.LIVE_MEDIA && env.LIVE_PUBLIC_HOST && env.LIVE_INGEST_SECRET && env.SEARCH_DB);
	},
	async provision(env, input) {
		const host = liveHost(env);
		return { providerRef: input.sessionId, playbackUrl: `https://${host}/hls/${input.sessionId}/master.m3u8` };
	},
	async ingest(env, session) {
		const host = liveHost(env);
		const key = await selfHostedKey(env, session.id, session.key_version);
		const base = `https://${host}/ingest/${session.id}/${key}`;
		return {
			protocol: 'https-hls',
			url: `https://${host}/ingest/${session.id}`,
			streamKey: key,
			ffmpegExample: selfHostedFfmpeg(base, !!session.low_latency),
		};
	},
	async start() {
		// Starts when the first segment arrives at the edge (lib/live/edge.ts).
	},
	async status() {
		// The edge records arrivals on the session row; the caller reads it there.
		return null;
	},
	async stop() {
		// The edge finalizes the VOD (lib/live/finalize.ts) synchronously.
		return { vodUrl: null };
	},
};

// ---------------------------------------------------------------------------
// Bunny Stream Live
// ---------------------------------------------------------------------------

const BUNNY_API = 'https://video.bunnycdn.com';
const AVAILABILITY_TTL_MS = 10 * 60_000;
let bunnyAvailability: { at: number; ok: boolean; lib: string } | null = null;

export function forgetBunnyAvailability(): void {
	bunnyAvailability = null;
}

async function bunnyCreds(env: LiveEnv): Promise<{ key: string; lib: string }> {
	const key = await getSecret(env['bunny-stream-key'], 'bunny-stream-key');
	const lib = await getSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
	if (!key || !lib) throw new LiveProviderError('bunny', 'not_configured', 'Bunny Stream key or library id missing');
	return { key, lib };
}

async function bunnyCall<T>(env: LiveEnv, method: string, path: string, body?: unknown): Promise<T> {
	const { key, lib } = await bunnyCreds(env);
	const res = await fetch(`${BUNNY_API}/library/${lib}${path}`, {
		method,
		headers: { AccessKey: key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (res.status === 401 || res.status === 403) {
		bunnyAvailability = { at: Date.now(), ok: false, lib };
		throw new LiveProviderError('bunny', 'forbidden', `Bunny live API ${method} ${path.split('/').slice(0, 3).join('/')}: ${res.status}`);
	}
	if (!res.ok) throw new LiveProviderError('bunny', `http_${res.status}`, `Bunny live API ${method}: ${res.status}`);
	const text = await res.text();
	return (text ? JSON.parse(text) : {}) as T;
}

interface BunnyLiveStream {
	guid: string;
	streamKey?: string;
	playbackUrlHls?: string;
	status?: number;
	startedAt?: string | null;
	endedAt?: string | null;
	peakConcurrentViewers?: number;
	totalViewerSeconds?: number;
	rtmpUrl?: string;
	ingestUrl?: string;
	ingestRegion?: string;
}

/** Bunny live status codes observed as "publishing" (the API documents 0–7 without names). */
const BUNNY_PUBLISHING = new Set([2, 3]);

export const bunnyAdapter: LiveProviderAdapter = {
	id: 'bunny',
	async available(env) {
		if (env.BUNNY_LIVE_ENABLED === 'false') return false;
		let creds: { key: string; lib: string };
		try {
			creds = await bunnyCreds(env);
		} catch {
			return false;
		}
		const now = Date.now();
		if (bunnyAvailability && bunnyAvailability.lib === creds.lib && now - bunnyAvailability.at < AVAILABILITY_TTL_MS) return bunnyAvailability.ok;
		let ok = false;
		try {
			const res = await fetch(`${BUNNY_API}/library/${creds.lib}/live?page=1&itemsPerPage=1`, { headers: { AccessKey: creds.key, accept: 'application/json' } });
			ok = res.ok;
			if (!ok) logger.debug('[Live] Bunny live API not available', { status: res.status });
		} catch (error) {
			logger.warn('[Live] Bunny live availability check failed', { error: error instanceof Error ? error.message : String(error) });
		}
		bunnyAvailability = { at: now, ok, lib: creds.lib };
		return ok;
	},
	async provision(env, input) {
		const created = await bunnyCall<BunnyLiveStream>(env, 'POST', '/live', {
			title: input.title.slice(0, 200),
			recordVod: input.recordVod,
			dvrEnabled: false,
		});
		if (!created?.guid) throw new LiveProviderError('bunny', 'bad_response', 'Bunny live create returned no guid');
		return { providerRef: created.guid, playbackUrl: created.playbackUrlHls || bunnyHls(env, created.guid) };
	},
	async ingest(env, session) {
		const live = await bunnyCall<BunnyLiveStream>(env, 'GET', `/live/${session.provider_ref}`);
		const server = live.rtmpUrl || live.ingestUrl || env.BUNNY_LIVE_INGEST_URL || '';
		if (!server) throw new LiveProviderError('bunny', 'not_configured', 'BUNNY_LIVE_INGEST_URL is not set');
		const key = live.streamKey ?? '';
		return {
			protocol: 'rtmp',
			url: server,
			streamKey: key,
			ffmpegExample: [
				'ffmpeg -re -i INPUT',
				'-c:v libx264 -preset veryfast -tune zerolatency -profile:v main -r 30 -g 60 -keyint_min 60 -sc_threshold 0 -b:v 4500k -maxrate 4500k -bufsize 9000k',
				'-c:a aac -b:a 128k -ar 48000',
				`-f flv "${server.replace(/\/$/, '')}/${key}"`,
			].join(' \\\n  '),
		};
	},
	async start(env, session) {
		await bunnyCall(env, 'PUT', `/live/${session.provider_ref}/start`);
	},
	async status(env, session) {
		const live = await bunnyCall<BunnyLiveStream>(env, 'GET', `/live/${session.provider_ref}`);
		let bitrate: number | null = null;
		try {
			const b = await bunnyCall<{ bitrate?: number; currentBitrate?: number }>(env, 'GET', `/live/${session.provider_ref}/current-bitrate`);
			const v = b.currentBitrate ?? b.bitrate;
			bitrate = typeof v === 'number' ? Math.round(v > 100_000 ? v / 1000 : v) : null;
		} catch {
			bitrate = null;
		}
		return {
			receiving: BUNNY_PUBLISHING.has(live.status ?? -1) || (bitrate ?? 0) > 0,
			bitrateKbps: bitrate,
			viewers: live.peakConcurrentViewers ?? null,
			viewerSeconds: live.totalViewerSeconds ?? null,
			startedAt: live.startedAt ? Date.parse(live.startedAt) : null,
			raw: { status: live.status, ingestRegion: live.ingestRegion },
		};
	},
	async stop(env, session) {
		await bunnyCall(env, 'PUT', `/live/${session.provider_ref}/stop`);
		// recordVod: the stream becomes a regular library video with the same guid.
		return { vodUrl: bunnyHls(env, session.provider_ref ?? '') };
	},
	async vodReady(env, session) {
		const { key, lib } = await bunnyCreds(env);
		const res = await fetch(`${BUNNY_API}/library/${lib}/videos/${session.provider_ref}`, { headers: { AccessKey: key, accept: 'application/json' } });
		if (!res.ok) return false;
		const v = (await res.json()) as { status?: number };
		return v.status === 4; // 4 = finished (Bunny VOD status)
	},
};

const bunnyHls = (env: LiveEnv, guid: string) => `https://${env.bunny_hostname ?? 'video.bunnycdn.com'}/${guid}/playlist.m3u8`;

export const LIVE_ADAPTERS: Record<LiveProviderId, LiveProviderAdapter> = { bunny: bunnyAdapter, selfhosted: selfHostedAdapter };
