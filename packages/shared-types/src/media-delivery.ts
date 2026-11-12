/**
 * Video delivery on R2 + the Cloudflare CDN, side by side with Bunny (epic #687,
 * docs/media-delivery/R2-DELIVERY-PLAN.md). Shared by api-videos (enqueues jobs,
 * signs private URLs, owns the video record) and apps/media (transcodes, serves
 * /priv/).
 *
 * Bucket layout:  {pub|priv}/<videoId>/<rev>/master.m3u8 …
 * Public URL:     https://<media host>/pub/<videoId>/<rev>/master.m3u8         (R2 custom domain + Cache Rule)
 * Private URL:    https://<media host>/priv/<exp>.<sig>/<videoId>/<rev>/master.m3u8  (Worker checks the token)
 *
 * The token sits in the path, like Bunny's directory token, so every relative
 * URL inside the playlists carries it.
 */

export type MediaAccess = 'pub' | 'priv';

export type R2RenditionStatus = 'queued' | 'transcoding' | 'ready' | 'failed';

/** One rung of the HLS ladder as written to R2. */
export interface MediaRung {
	name: string;
	width: number;
	height: number;
	/** Peak cap given to the encoder (bits/s) */
	maxrate: number;
	/** Measured average over the whole rendition (bits/s) */
	bandwidth?: number;
	bytes?: number;
	segments?: number;
}

/** Timings and sizes the container reports with a finished job. */
export interface TranscodeResult {
	rungs: MediaRung[];
	/** Objects written and their total size */
	objects: number;
	bytes: number;
	durationSeconds: number;
	source: { width: number; height: number; durationSeconds: number; bytes: number; codec?: string; hasAudio: boolean };
	timings: { downloadMs: number; transcodeMs: number; uploadMs: number; totalMs: number };
	thumbnail: string;
	preview?: string;
}

/** The R2 side of a video record (api-videos). `r2PlayUrl` is derived from it. */
export interface VideoR2State {
	status: R2RenditionStatus;
	jobId: string;
	rev: string;
	access: MediaAccess;
	attempts: number;
	queuedAt: string;
	startedAt?: string;
	readyAt?: string;
	failedAt?: string;
	error?: string;
	/** Seconds the container ran (all attempts), for cost per video-minute */
	containerSeconds?: number;
	instanceType?: string;
	result?: TranscodeResult;
	/** A visibility change is moving the objects to the other prefix */
	moving?: { to: MediaAccess; jobId: string; at: string };
	/** 0..1 while transcoding */
	progress?: number;
	/** A re-transcode: the rendition set that keeps playing until this one is ready (then deleted) */
	previous?: { rev: string; access: MediaAccess };
}

/** Message on the transcode queue (api-videos → apps/media). */
export interface TranscodeJobMessage {
	kind: 'transcode';
	videoId: string;
	jobId: string;
	rev: string;
	access: MediaAccess;
	/** Upload complete (or retry) time, for time-to-playable */
	queuedAt: string;
	reason: 'upload' | 'retry' | 'sweep' | 'backfill';
}

/** Event the media worker posts back to api-videos (service binding). */
export interface TranscodeJobEvent {
	videoId: string;
	jobId: string;
	type: 'started' | 'progress' | 'ready' | 'failed';
	at: string;
	attempt: number;
	/** 0..1 */
	progress?: number;
	containerSeconds?: number;
	instanceType?: string;
	result?: TranscodeResult;
	error?: string;
	/** failed only: true when no retry will follow */
	final?: boolean;
}

export const MEDIA_ACCESS_FOR = (visibility: { isPublic?: boolean; visibility?: string } | null | undefined): MediaAccess => {
	if (!visibility) return 'priv';
	if (visibility.visibility) return visibility.visibility === 'public' ? 'pub' : 'priv';
	return visibility.isPublic === false ? 'priv' : 'pub';
};

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_REV = /^[a-z0-9]{8,32}$/;

export function isMediaVideoId(id: string): boolean {
	return SAFE_ID.test(id);
}
export function isMediaRev(rev: string): boolean {
	return SAFE_REV.test(rev);
}

/** A new random rev (16 hex chars, 64 bits) for one transcode. */
export function newMediaRev(): string {
	let out = '';
	for (const b of crypto.getRandomValues(new Uint8Array(8))) out += b.toString(16).padStart(2, '0');
	return out;
}

/** R2 key prefix of one rendition set (no trailing slash). */
export function mediaPrefix(access: MediaAccess, videoId: string, rev: string): string {
	return `${access}/${videoId}/${rev}`;
}

/** Every key of a video, in both prefixes, starts with one of these. */
export function mediaVideoPrefixes(videoId: string): string[] {
	return [`pub/${videoId}/`, `priv/${videoId}/`];
}

export const MEDIA_MASTER = 'master.m3u8';
export const MEDIA_THUMBNAIL = 'thumb.jpg';
export const MEDIA_PREVIEW = 'preview.webp';
export const MEDIA_MANIFEST = 'manifest.json';

/** Signed URLs live 6 h, rounded up to the hour, so a URL is stable (cacheable) for an hour. */
export const MEDIA_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export function mediaTokenExpiry(nowSeconds: number = Math.floor(Date.now() / 1000)): number {
	return Math.ceil((nowSeconds + MEDIA_TOKEN_TTL_SECONDS) / 3600) * 3600;
}

function base64Url(bytes: ArrayBuffer): string {
	let binary = '';
	for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, data: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
	return base64Url(sig).slice(0, 32);
}

/** Path token for everything under priv/<videoId>/<rev>/ until `expires` (unix seconds). */
export async function mediaToken(key: string, videoId: string, rev: string, expires: number): Promise<string> {
	return `${expires}.${await hmac(key, `priv/${videoId}/${rev}/:${expires}`)}`;
}

/** Constant-time check of a path token; false when expired or malformed. */
export async function verifyMediaToken(key: string, token: string, videoId: string, rev: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
	const m = /^(\d{10})\.([A-Za-z0-9_-]{32})$/.exec(token);
	if (!m) return false;
	const expires = Number(m[1]);
	if (!(expires > nowSeconds) || expires > nowSeconds + MEDIA_TOKEN_TTL_SECONDS + 3600) return false;
	const want = await hmac(key, `priv/${videoId}/${rev}/:${expires}`);
	const got = m[2]!;
	let diff = 0;
	for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
	return diff === 0;
}

/** Play URL of a rendition set; private ones need the signing key. */
export async function mediaPlayUrl(
	host: string,
	access: MediaAccess,
	videoId: string,
	rev: string,
	file: string = MEDIA_MASTER,
	sign?: { key: string; expires?: number },
): Promise<string> {
	if (access === 'pub') return `https://${host}/pub/${videoId}/${rev}/${file}`;
	if (!sign?.key) throw new Error('A private media URL needs the signing key');
	const token = await mediaToken(sign.key, videoId, rev, sign.expires ?? mediaTokenExpiry());
	return `https://${host}/priv/${token}/${videoId}/${rev}/${file}`;
}

/** Parse /priv/<token>/<videoId>/<rev>/<rest…> (the Worker side). */
export function parsePrivatePath(pathname: string): { token: string; videoId: string; rev: string; rest: string } | null {
	const m = /^\/priv\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(pathname);
	if (!m) return null;
	const [, token, videoId, rev, rest] = m as unknown as [string, string, string, string, string];
	if (!isMediaVideoId(videoId) || !isMediaRev(rev)) return null;
	if (rest.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
	if (!/^[A-Za-z0-9_./-]{1,200}$/.test(rest)) return null;
	return { token, videoId, rev, rest };
}

/** Content type by file name, for R2 writes and the /priv/ edge. */
export function mediaContentType(name: string): string {
	const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	switch (ext) {
		case 'm3u8':
			return 'application/vnd.apple.mpegurl';
		case 'm4s':
			return 'video/iso.segment';
		case 'mp4':
			return 'video/mp4';
		case 'ts':
			return 'video/mp2t';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'json':
			return 'application/json';
		case 'vtt':
			return 'text/vtt';
		default:
			return 'application/octet-stream';
	}
}

/**
 * Cache lifetime by file. Nothing changes under one rev, but a video that turns
 * private is moved out of the public bucket: without a CDN purge token its
 * public copies would stay at the edge for their whole TTL, so the TTL is a day
 * (a day of R2 reads per colo per segment is still negligible).
 */
export function mediaCacheControl(name: string): string {
	if (name.endsWith('.m3u8')) return 'public, max-age=300';
	if (name.endsWith(MEDIA_MANIFEST)) return 'no-store';
	return 'public, max-age=86400';
}

// ---------------------------------------------------------------------------
// Delivery switch (admin setting per environment)
// ---------------------------------------------------------------------------

export type DeliveryMode = 'bunny' | 'r2' | 'split';
export type DeliveryAssign = 'video' | 'view';

export interface DeliverySettings {
	mode: DeliveryMode;
	/** split only: share of plays (or videos) from R2, 0..100 */
	r2Percent: number;
	assign: DeliveryAssign;
	/** Transcode new uploads to R2 (dual write); off stops new jobs only */
	transcode: boolean;
	updatedAt?: string;
	updatedBy?: string;
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { mode: 'bunny', r2Percent: 10, assign: 'video', transcode: true };

export function normaliseDeliverySettings(input: Partial<DeliverySettings> | null | undefined): DeliverySettings {
	const s = { ...DEFAULT_DELIVERY_SETTINGS, ...(input ?? {}) };
	const mode: DeliveryMode = s.mode === 'r2' || s.mode === 'split' ? s.mode : 'bunny';
	const assign: DeliveryAssign = s.assign === 'view' ? 'view' : 'video';
	const pct = Math.round(Number(s.r2Percent));
	return {
		mode,
		assign,
		r2Percent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : DEFAULT_DELIVERY_SETTINGS.r2Percent,
		transcode: s.transcode !== false,
		...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
		...(s.updatedBy ? { updatedBy: s.updatedBy } : {}),
	};
}

/** Stable bucket 0..99 for a key (FNV-1a), the same on server and client. */
export function deliveryBucket(key: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) % 100;
}

/**
 * Which source a play gets. `drawKey` is the video id (assign=video) or a
 * per-view random id (assign=view). Not ready on R2 → Bunny, always.
 */
export function pickDeliverySource(settings: DeliverySettings, r2Ready: boolean, drawKey: string): 'bunny' | 'r2' {
	if (!r2Ready || settings.mode === 'bunny') return 'bunny';
	if (settings.mode === 'r2') return 'r2';
	return deliveryBucket(drawKey) < settings.r2Percent ? 'r2' : 'bunny';
}
