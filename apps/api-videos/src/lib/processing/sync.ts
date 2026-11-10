/**
 * Bunny → video record sync (2026-11-10 incident).
 *
 * One decision function shared by every path that learns about Bunny's
 * encode state: the per-video processing-check loop (loop.ts), the safety-net
 * sweep, the uploader's status poll and the admin "Sync from Bunny" action.
 * Pure: no I/O, so the state machine is unit tested (test/processing-sync.spec.ts).
 *
 * Bunny video status (lib/bunny/schema.json): 0 Created (no bytes yet),
 * 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error,
 * 6 UploadFailed, 7 Transcribing (playable), 8+ JIT states (playable).
 */

export interface BunnyVideoState {
	guid?: string;
	status?: number;
	encodeProgress?: number;
	availableResolutions?: string | null;
	length?: number;
	storageSize?: number;
	width?: number;
	height?: number;
	thumbnailFileName?: string | null;
	transcodingMessages?: { message?: string; value?: string; level?: number }[] | null;
}

export interface SyncableVideo {
	id: string;
	dateCreated?: string;
	uploadStatus?: 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed';
	playUrl?: string;
	thumbnailUrl?: string;
	thumbnailType?: 'auto' | 'custom';
	availableResolutions?: string[];
	duration?: number;
	fileSize?: number;
	width?: number;
	height?: number;
	/** Bunny's auto thumbnail does not exist yet: clients show the placeholder */
	thumbnailPending?: boolean;
	processingIssue?: { kind: 'encode_failed' | 'needs_reupload' | 'stalled'; reason?: string; at: string };
}

/**
 * `playable`: Bunny is still encoding (status 1-3) but at least one resolution
 * is done, so the playlist plays. Bunny encodes the low resolutions first, so
 * this is minutes (often seconds) before `ready` (status 4, every resolution).
 */
export type BunnyPhase = 'awaiting_upload' | 'encoding' | 'playable' | 'ready' | 'failed' | 'missing';

export type SyncOutcome =
	/** Encoded: record is (now) ready with resolutions, duration and URLs */
	| 'ready'
	/** Watchable (record ready) but Bunny is still adding resolutions or the
	 *  thumbnail does not exist yet: keep checking until Finished */
	| 'playable'
	/** Bunny reported an encode / upload failure */
	| 'failed'
	/** Bytes never arrived (or the Bunny video is gone): the owner must upload again */
	| 'needs_reupload'
	/** Still encoding after the stall limit */
	| 'stalled'
	/** Not finished yet: check again later */
	| 'pending';

export interface SyncOptions {
	/** CDN host of the Bunny library the record's video lives in */
	host: string;
	now: Date;
	/** No bytes at Bunny this long after the record was created → needs re-upload */
	uploadTimeoutMs?: number;
	/** Still encoding this long after the loop started → stalled */
	stallAfterMs?: number;
	/** When the current check loop started (stall clock); defaults to dateCreated */
	loopStartedAt?: string;
	/** Bunny's auto thumbnail answered (true) / 404'd (false); undefined: not checked */
	thumbnailExists?: boolean;
}

export interface SyncPlan {
	outcome: SyncOutcome;
	phase: BunnyPhase;
	/** Fields to set on the record; empty when it is already correct */
	patch: Partial<SyncableVideo>;
	/** Fields to remove from the record */
	unset: (keyof SyncableVideo)[];
	reason?: string;
	/** True when the record's uploadStatus changes to ready or failed */
	terminalTransition: 'ready' | 'failed' | null;
}

export const DEFAULT_UPLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_STALL_AFTER_MS = 6 * 60 * 60 * 1000;

const BUNNY_CDN_HOST = /^https:\/\/vz-[a-z0-9-]+\.b-cdn\.net\//i;

export function bunnyPhase(bunny: BunnyVideoState | null): BunnyPhase {
	if (!bunny) return 'missing';
	const status = bunny.status ?? -1;
	if (status === 4 || status >= 7) return 'ready';
	if (status === 5 || status === 6) return 'failed';
	if (status === 0) return 'awaiting_upload';
	return parseResolutions(bunny.availableResolutions).length > 0 ? 'playable' : 'encoding';
}

/**
 * What the owner's upload-status endpoint reports for a Bunny state (same
 * mapping as the check loop): playable counts as ready.
 */
export function uploadStatusView(phase: BunnyPhase, bunny: BunnyVideoState | null): {
	status: 'uploading' | 'processing' | 'ready' | 'failed';
	progress: number;
	message: string;
} {
	const encode = bunny?.encodeProgress ?? 0;
	switch (phase) {
		case 'awaiting_upload':
			return { status: 'uploading', progress: Math.max(10, encode), message: 'Video upload queued' };
		case 'encoding':
			return { status: 'processing', progress: Math.max(25, encode), message: 'Video is being encoded' };
		case 'playable':
			return { status: 'ready', progress: Math.max(50, encode), message: 'Video is ready; more resolutions are on the way' };
		case 'ready':
			return { status: 'ready', progress: 100, message: 'Video is ready' };
		default:
			return { status: 'failed', progress: 0, message: 'Video processing failed' };
	}
}

function parseResolutions(value: string | null | undefined): string[] {
	return (value || '')
		.split(',')
		.map((r) => r.trim())
		.filter((r) => r.length > 0);
}

function failureReason(bunny: BunnyVideoState): string {
	const messages = (bunny.transcodingMessages || [])
		.map((m) => [m.message, m.value].filter(Boolean).join(': '))
		.filter((m) => m.length > 0);
	const base = bunny.status === 6 ? 'Bunny upload failed' : 'Bunny encoding failed';
	return messages.length ? `${base}: ${messages.slice(0, 3).join('; ')}` : base;
}

/**
 * The canonical URL of a file next to the video's playlist on `host`, when
 * `current` is missing or is a Bunny Stream URL of this video on another host
 * (wrong library, the incident). Custom thumbnails (image storage) are kept.
 */
function canonicalUrl(current: string | undefined, host: string, id: string, file: string): string | undefined {
	const wanted = `https://${host}/${id}/${file}`;
	if (!current) return wanted;
	if (current === wanted) return undefined;
	if (BUNNY_CDN_HOST.test(current) && current.includes(`/${id}/`)) {
		// Same video on a different Bunny host: move it to the library's host
		const path = current.replace(BUNNY_CDN_HOST, '');
		return `https://${host}/${path}`;
	}
	return undefined;
}

function sameList(a: string[] | undefined, b: string[]): boolean {
	const x = [...(a ?? [])].sort();
	const y = [...b].sort();
	return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Decide what the record should look like given Bunny's state. */
export function planSync(video: SyncableVideo, bunny: BunnyVideoState | null, opts: SyncOptions): SyncPlan {
	const phase = bunnyPhase(bunny);
	const now = opts.now.getTime();
	const at = opts.now.toISOString();
	const patch: Partial<SyncableVideo> = {};
	const unset: (keyof SyncableVideo)[] = [];
	const created = Date.parse(video.dateCreated || '') || now;
	const loopStarted = Date.parse(opts.loopStartedAt || '') || created;

	const setStatus = (status: SyncableVideo['uploadStatus']) => {
		if (video.uploadStatus !== status) patch.uploadStatus = status;
	};
	const setIssue = (kind: NonNullable<SyncableVideo['processingIssue']>['kind'], reason: string) => {
		if (video.processingIssue?.kind !== kind || video.processingIssue?.reason !== reason) {
			patch.processingIssue = { kind, reason, at };
		}
	};
	const clearIssue = () => {
		if (video.processingIssue) unset.push('processingIssue');
	};
	const finish = (outcome: SyncOutcome, reason?: string): SyncPlan => {
		const terminal =
			patch.uploadStatus === 'ready' ? 'ready' : patch.uploadStatus === 'failed' ? 'failed' : null;
		return { outcome, phase, patch, unset, reason, terminalTransition: terminal };
	};

	if ((phase === 'ready' || phase === 'playable') && bunny) {
		// Playable at the first encoded resolution: ready now (announced once,
		// by the status change); later checks only add resolutions
		setStatus('ready');
		clearIssue();
		const resolutions = parseResolutions(bunny.availableResolutions);
		if (resolutions.length && !sameList(video.availableResolutions, resolutions)) patch.availableResolutions = resolutions;
		if (bunny.length && video.duration !== bunny.length) patch.duration = bunny.length;
		if (bunny.storageSize && video.fileSize !== bunny.storageSize) patch.fileSize = bunny.storageSize;
		// Dimensions decide what is a short (<= 180 s and height >= width)
		if (bunny.width && video.width !== bunny.width) patch.width = bunny.width;
		if (bunny.height && video.height !== bunny.height) patch.height = bunny.height;
		const playUrl = canonicalUrl(video.playUrl, opts.host, video.id, 'playlist.m3u8');
		if (playUrl) patch.playUrl = playUrl;
		if (video.thumbnailType !== 'custom') {
			const thumb = canonicalUrl(video.thumbnailUrl, opts.host, video.id, bunny.thumbnailFileName || 'thumbnail.jpg');
			if (thumb) patch.thumbnailUrl = thumb;
			if (opts.thumbnailExists === false && !video.thumbnailPending) patch.thumbnailPending = true;
			if (opts.thumbnailExists === true && video.thumbnailPending) unset.push('thumbnailPending');
		}
		const thumbnailMissing = video.thumbnailType !== 'custom' && opts.thumbnailExists === false;
		if (phase === 'playable' || thumbnailMissing) {
			// Stop after the stall limit even if Bunny never reports Finished: it plays
			const stallAfter = opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;
			if (now - loopStarted >= stallAfter) return finish('ready');
			return finish('playable');
		}
		return finish('ready');
	}

	if (phase === 'failed' && bunny) {
		const reason = failureReason(bunny);
		setStatus('failed');
		setIssue(bunny.status === 6 ? 'needs_reupload' : 'encode_failed', reason);
		return finish(bunny.status === 6 ? 'needs_reupload' : 'failed', reason);
	}

	if (phase === 'missing') {
		const reason = 'Video not found at Bunny';
		setStatus('failed');
		setIssue('needs_reupload', reason);
		return finish('needs_reupload', reason);
	}

	if (phase === 'awaiting_upload') {
		const timeout = opts.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
		if (now - created >= timeout) {
			const reason = 'Upload never reached Bunny';
			setStatus('failed');
			setIssue('needs_reupload', reason);
			return finish('needs_reupload', reason);
		}
		return finish('pending');
	}

	// encoding
	if (video.uploadStatus !== 'processing' && video.uploadStatus !== 'ready') setStatus('processing');
	const stallAfter = opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;
	if (now - loopStarted >= stallAfter) {
		const reason = `Still encoding at Bunny (status ${bunny?.status}, ${bunny?.encodeProgress ?? 0}%)`;
		setIssue('stalled', reason);
		return finish('stalled', reason);
	}
	return finish('pending');
}

/** Apply a plan to a record in place. Returns true when anything changed. */
export function applyPlan<T extends SyncableVideo>(video: T, plan: SyncPlan): boolean {
	let changed = false;
	for (const [key, value] of Object.entries(plan.patch)) {
		(video as Record<string, unknown>)[key] = value;
		changed = true;
	}
	for (const key of plan.unset) {
		if (key in video) {
			delete (video as Record<string, unknown>)[key];
			changed = true;
		}
	}
	return changed;
}

/**
 * Delay before the next check: 15 s, 15 s, 30 s, 1 m, 2 m, then every 5 m.
 * Measured on QA (3 min 1080p clip): Bunny's first resolution was playable
 * 24 s after the upload and every resolution done at 49 s, so the first
 * checks are close together.
 */
export const CHECK_BACKOFF_SECONDS = [15, 15, 30, 60, 120, 300] as const;

export function nextCheckDelaySeconds(attempt: number): number {
	const index = Math.max(0, Math.min(attempt, CHECK_BACKOFF_SECONDS.length - 1));
	return CHECK_BACKOFF_SECONDS[index];
}

/** Hard cap on checks per loop (~6 h at the 5-minute cadence). */
export const MAX_CHECK_ATTEMPTS = 80;
