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

/** Where one rung of a running transcode is (the admin Processing card's chips). */
export type R2RungState = 'pending' | 'encoding' | 'uploading' | 'done' | 'failed';

export const R2_RUNG_STATES: readonly R2RungState[] = ['pending', 'encoding', 'uploading', 'done', 'failed'];

/** One rung's state while a job runs. `progress` is 0..1 (encoding: the shared one-pass figure; uploading: bytes of this rung). */
export interface R2RungProgress {
	name: string;
	state: R2RungState;
	progress?: number;
}

/** Compact form for the admin live channel: [name, state, progress?]. */
export type R2RungTuple = [string, R2RungState] | [string, R2RungState, number];

const RUNG_NAME = /^[0-9]{2,4}p$/;
/** At most this many rungs travel on events and records (the ladder has four). */
export const MAX_RUNGS = 8;

/** Bounded, validated rung states (from the container, an event or a live message). */
export function sanitizeRungs(input: unknown): R2RungProgress[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const out: R2RungProgress[] = [];
	for (const raw of input.slice(0, MAX_RUNGS)) {
		const r = Array.isArray(raw) ? { name: raw[0], state: raw[1], progress: raw[2] } : (raw as Partial<R2RungProgress> | null);
		if (!r || typeof r.name !== 'string' || !RUNG_NAME.test(r.name) || !R2_RUNG_STATES.includes(r.state as R2RungState)) continue;
		const p = typeof r.progress === 'number' && Number.isFinite(r.progress) ? Math.round(Math.min(1, Math.max(0, r.progress)) * 1000) / 1000 : undefined;
		out.push({ name: r.name, state: r.state as R2RungState, ...(p !== undefined && (r.state === 'encoding' || r.state === 'uploading') ? { progress: p } : {}) });
	}
	return out;
}

/** Rungs as tuples for a live event, progress to two decimals: [['720p','uploading',0.4], …]. */
export function compactRungs(rungs: R2RungProgress[] | undefined): R2RungTuple[] | undefined {
	if (!rungs?.length) return undefined;
	return rungs.slice(0, MAX_RUNGS).map((r) => (typeof r.progress === 'number' ? [r.name, r.state, Math.round(r.progress * 100) / 100] : [r.name, r.state]));
}

/** Rung height from its name ("720p" → 720); NaN when the name carries none. */
export function rungHeight(name: string): number {
	const m = /(\d{2,4})p/i.exec(name);
	return m ? Number(m[1]) : Number.NaN;
}

/** Ascending by height (240p, 360p, … 1080p); names without a height last, in their order. */
export function sortByResolution<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
	return items
		.map((item, i) => ({ item, i, h: rungHeight(nameOf(item)) }))
		.sort((a, b) => (Number.isNaN(a.h) ? Infinity : a.h) - (Number.isNaN(b.h) ? Infinity : b.h) || a.i - b.i)
		.map((x) => x.item);
}

/** Every non-finished rung failed (the attempt stopped). */
export function failRungs(rungs: R2RungProgress[] | undefined): R2RungProgress[] | undefined {
	return rungs?.map((r) => (r.state === 'done' ? r : { name: r.name, state: 'failed' }));
}

/** Timings and sizes the container reports with a finished job. */
export interface TranscodeResult {
	rungs: MediaRung[];
	/** Objects written and their total size */
	objects: number;
	bytes: number;
	durationSeconds: number;
	source: { width: number; height: number; durationSeconds: number; bytes: number; codec?: string; hasAudio: boolean; /** Bunny file it was read from: original, play_1080p.mp4 … */ file?: string };
	timings: { downloadMs: number; transcodeMs: number; uploadMs: number; totalMs: number };
	thumbnail: string;
	preview?: string;
}

/** Where a transcode attempt was when it failed. */
export type TranscodeStage = 'start' | 'fetch_source' | 'probe' | 'encode' | 'stills' | 'upload' | 'container';

/** What we know about a failed attempt: stored on the record, shown on the Errors page and the admin badge. */
export interface TranscodeFailure {
	stage: TranscodeStage;
	/** e.g. the rungs being encoded: "360p,480p,720p,1080p" */
	stageDetail?: string;
	/** e.g. source_unavailable, container_stopped, "ffmpeg exited 1" */
	error: string;
	attempt: number;
	/** Attempt start → failure */
	elapsedMs: number;
	at: string;
	source?: { file?: string; bytes?: number };
	/** Container exit code and stop reason, when the container stopped */
	exitCode?: number;
	stopReason?: string;
	instanceId?: string;
	/** Last ≤ 20 FFmpeg stderr lines, tokens and URLs stripped */
	stderrTail?: string[];
}

/** Remove anything that could carry a credential: Bunny tokens, query strings, API keys, full URLs. */
export function scrubMediaText(text: string, max = 300): string {
	return text
		.replace(/bcdn_token=[^&/\s]+/gi, 'bcdn_token=…')
		.replace(/([?&](token|expires|token_path|sig|signature|key|X-API-Key)=)[^&\s]+/gi, '$1…')
		.replace(/(x-api-key|authorization|accesskey)\s*[:=]\s*\S+/gi, '$1: …')
		.replace(/https?:\/\/([^/\s]+)[^\s]*/gi, 'https://$1/…')
		.replace(/\/priv\/[^/\s]+\//g, '/priv/…/')
		.slice(0, max);
}

/** Bounded, scrubbed copy of a failure (what the record and the Errors page store). */
export function sanitizeFailure(f: TranscodeFailure): TranscodeFailure {
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
	return {
		stage: f.stage,
		...(f.stageDetail ? { stageDetail: scrubMediaText(f.stageDetail, 80) } : {}),
		error: scrubMediaText(String(f.error ?? 'failed'), 300),
		attempt: n(f.attempt) ?? 1,
		elapsedMs: Math.max(0, Math.round(n(f.elapsedMs) ?? 0)),
		at: String(f.at ?? new Date().toISOString()),
		...(f.source ? { source: { ...(f.source.file ? { file: scrubMediaText(f.source.file, 40) } : {}), ...(n(f.source.bytes) !== undefined ? { bytes: n(f.source.bytes) } : {}) } } : {}),
		...(n(f.exitCode) !== undefined ? { exitCode: n(f.exitCode) } : {}),
		...(f.stopReason ? { stopReason: scrubMediaText(f.stopReason, 120) } : {}),
		...(f.instanceId ? { instanceId: scrubMediaText(f.instanceId, 80) } : {}),
		...(Array.isArray(f.stderrTail) && f.stderrTail.length ? { stderrTail: f.stderrTail.slice(-20).map((l) => scrubMediaText(String(l), 240)) } : {}),
	};
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
	/** Per-rung state of the current attempt (all done once ready) */
	rungs?: R2RungProgress[];
	/** The latest failed attempt (kept after a later attempt succeeds, for the history) */
	failure?: TranscodeFailure;
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
	/** progress and failed: per-rung state */
	rungs?: R2RungProgress[];
	containerSeconds?: number;
	instanceType?: string;
	result?: TranscodeResult;
	error?: string;
	/** failed only: true when no retry will follow */
	final?: boolean;
	/** failed only: where and why */
	failure?: TranscodeFailure;
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

// ---------------------------------------------------------------------------
// Originals: the upload as received, kept in al-ummah-now-media-originals[-env]
// (docs/media-delivery/ORIGINALS.md). One object per TUS PATCH, keyed by offset.
// ---------------------------------------------------------------------------

export const ORIGINALS_PREFIX = 'src/';

export function originalPrefix(videoId: string): string {
	return `${ORIGINALS_PREFIX}${videoId}/`;
}
export function originalManifestKey(videoId: string): string {
	return `${originalPrefix(videoId)}manifest.json`;
}
export function originalPartKey(videoId: string, uploadId: string, offset: number): string {
	return `${originalPrefix(videoId)}${uploadId}/${String(Math.max(0, Math.floor(offset))).padStart(15, '0')}`;
}

export interface OriginalPart {
	key: string;
	offset: number;
	size: number;
}

export interface OriginalManifest {
	uploadId: string;
	size: number;
	parts: number;
	completedAt: string;
}

/** Parts of one upload id from a bucket listing (keys …/<uploadId>/<offset>). */
export function partsFromKeys(objects: { key: string; size: number }[], videoId: string, uploadId: string): OriginalPart[] {
	const prefix = `${originalPrefix(videoId)}${uploadId}/`;
	return objects
		.filter((o) => o.key.startsWith(prefix) && /^\d{15}$/.test(o.key.slice(prefix.length)))
		.map((o) => ({ key: o.key, offset: Number(o.key.slice(prefix.length)), size: o.size }))
		.sort((a, b) => a.offset - b.offset);
}

/** Do the parts cover [0, size) with no gap? Overlaps (a resumed PATCH) are fine. */
export function partsCover(parts: OriginalPart[], size: number): { complete: boolean; firstGapAt?: number } {
	let covered = 0;
	for (const p of parts) {
		if (p.offset > covered) return { complete: false, firstGapAt: covered };
		covered = Math.max(covered, p.offset + p.size);
		if (covered >= size) return { complete: true };
	}
	return size <= 0 ? { complete: true } : { complete: false, firstGapAt: covered };
}

/**
 * Which part byte ranges make up [start, end] (inclusive) of the original, in order,
 * each byte taken once (later parts only fill what earlier ones did not).
 */
export function planOriginalRange(parts: OriginalPart[], start: number, end: number): { key: string; from: number; to: number }[] {
	const out: { key: string; from: number; to: number }[] = [];
	let pos = start;
	for (const p of parts) {
		if (pos > end) break;
		const pEnd = p.offset + p.size - 1;
		if (pEnd < pos || p.offset > pos) {
			if (p.offset > pos) return out; // a gap: the caller treats the original as unusable
			continue;
		}
		const to = Math.min(pEnd, end);
		out.push({ key: p.key, from: pos - p.offset, to: to - p.offset });
		pos = to + 1;
	}
	return out;
}
