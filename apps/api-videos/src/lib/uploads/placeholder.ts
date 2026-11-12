/**
 * Shared pieces of the upload initiate endpoints (single and batch) around
 * the idempotent claim (initiateOnce.ts): can a bound video take the upload
 * again, what changes on the record when it does, and the TUS proxy session
 * handed back for it (at Bunny's current offset when Bunny still holds bytes).
 */

import { logger } from '../logger';
import { fetchBunnyVideo, ProcessingEnv } from '../processing/loop';
import { bunnyLibraries, pickLibrary, type BunnyLibrariesEnv, type LibraryHints } from '../bunny/libraries';
import { bunnyPhase } from '../processing/sync';
import { generateTUSConfig, createTusProxySession, TUS_PROXY_SESSION_TTL_SECONDS } from '../bunny/tus';
import { buildTusUploadId, type VideoTusUpload } from '../../endpoints/video/tus/tusProxy';
import type { ReuseVerdict } from './initiateOnce';

export interface PlaceholderRecord {
	id: string;
	userId?: string;
	uploadedBy?: string;
	channelId?: string;
	uploadStatus?: string;
	isDeleted?: boolean;
	abandoned?: unknown;
	fileSize?: number;
	tusUpload?: VideoTusUpload;
	processingIssue?: { kind: string; reason?: string; at: string };
	[key: string]: unknown;
}

/**
 * Can the video a fingerprint claim points at take this upload again?
 * Reuse only an unfinished, not deleted video of the same uploader and channel
 * whose Bunny video still exists and has not received its bytes (Created, or
 * UploadFailed which accepts a new upload). Throws on a transient Bunny/R2
 * failure, so the endpoint answers "retry" instead of creating a duplicate.
 */
export async function checkReusable(
	env: Pick<ProcessingEnv, 'videos' | 'bunny-stream-key' | 'bunny_stream_library_id'>,
	videoId: string,
	/** The record's owner (the channel owner for a member's upload) and, for a member, the uploader (lib/channelAccess.ts uploadIdentity) */
	who: { ownerId: string; uploadedBy?: string; channelId: string },
): Promise<ReuseVerdict> {
	const object = await env.videos.get(videoId);
	if (!object) return { kind: 'replace', why: 'deleted' };
	const video = await object.json<PlaceholderRecord>();
	if (video.userId !== who.ownerId || video.channelId !== who.channelId || (video.uploadedBy || undefined) !== (who.uploadedBy || undefined)) {
		return { kind: 'replace', why: 'different owner' };
	}
	if (video.isDeleted || video.abandoned) return { kind: 'replace', why: 'abandoned' };
	if (video.uploadStatus === 'ready' || video.uploadStatus === 'processing') return { kind: 'replace', why: 'finished' };
	// New uploads go to the primary library: an unfinished video left in another
	// (legacy) library is not resumed there (lib/bunny/libraries.ts)
	const libraries = await bunnyLibraries(env as BunnyLibrariesEnv);
	if (pickLibrary(libraries, video as LibraryHints)?.libraryId !== libraries[0].libraryId) return { kind: 'replace', why: 'other library' };
	const bunny = await fetchBunnyVideo(env as ProcessingEnv, videoId, video as LibraryHints);
	if (!bunny) return { kind: 'replace', why: 'deleted at Bunny' };
	const phase = bunnyPhase(bunny);
	if (phase === 'ready' || phase === 'encoding') return { kind: 'replace', why: 'finished at Bunny' };
	if (bunny.status === 5) return { kind: 'replace', why: 'encode failed at Bunny' };
	return { kind: 'reuse' };
}

/**
 * Record changes when an unfinished video is reused: the latest metadata the
 * uploader entered, back to `uploading` (a flagged "never reached Bunny"
 * video is being uploaded again), and when it happened. `false` (no write)
 * when the video finished meanwhile.
 */
export function reuseFields(
	fresh: PlaceholderRecord,
	metadata: Record<string, unknown>,
	nowIso: string,
): Record<string, unknown> | false {
	if (fresh.uploadStatus === 'ready' || fresh.uploadStatus === 'processing' || fresh.isDeleted || fresh.abandoned) return false;
	const fields: Record<string, unknown> = { ...metadata, uploadStatus: 'uploading', dateModified: nowIso, lastInitiateAt: nowIso };
	if (fresh.processingIssue?.kind === 'needs_reupload') fields.processingIssue = undefined;
	return fields;
}

export interface IssuedSession {
	tusSessionId: string;
	/** Proxy upload id of the upload Bunny may still hold: resume at its offset */
	tusUploadId?: string;
	expiresAt: string;
	chunkSize: number;
	resumable: boolean;
}

/** A new TUS proxy session for `video` (and, when reused, its earlier upload). */
export async function issueTusSession(
	kv: KVNamespace,
	opts: { libraryId: number; bunnyKey: string; userId: string; channelId: string; videoId: string; video?: PlaceholderRecord | null },
): Promise<IssuedSession> {
	const tusConfig = await generateTUSConfig(opts.libraryId, opts.bunnyKey, opts.videoId, 1);
	const tusSessionId = await createTusProxySession(kv, {
		videoId: opts.videoId,
		userId: opts.userId,
		channelId: opts.channelId,
		tusConfig,
	});
	const durable = opts.video?.tusUpload;
	// Same file (the fingerprint includes its size), so the earlier Bunny upload
	// is resumable at its offset; a different size would be a different claim.
	const tusUploadId =
		durable?.sessionId && durable.bunnyUploadUrl && (!opts.video?.fileSize || durable.fileSize === opts.video.fileSize)
			? buildTusUploadId(durable.sessionId, opts.videoId)
			: undefined;
	if (opts.video && !tusUploadId) logger.info('[UploadInitiate] Reused video has no resumable upload; starting it from byte 0', { videoId: opts.videoId });
	return {
		tusSessionId,
		...(tusUploadId ? { tusUploadId } : {}),
		expiresAt: new Date(Date.now() + TUS_PROXY_SESSION_TTL_SECONDS * 1000).toISOString(),
		chunkSize: tusConfig.chunkSize,
		resumable: tusConfig.resumable,
	};
}
