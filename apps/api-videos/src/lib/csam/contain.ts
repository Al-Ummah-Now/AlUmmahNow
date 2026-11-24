/**
 * Taking a CSAM match down (docs/specs/CSAM-RESPONSE.md §3–§5).
 *
 * 1. hideNow (the intake request, synchronous): the item stops being shown on every surface at
 *    once (a `csam` hold on the video, the post or comment deleted from view, the avatar or cover
 *    field cleared, the live stream ended and held), the matched URL is purged from the CDN, and a private video's media move starts.
 *    Nothing is deleted yet: the data is still needed for the evidence copy.
 * 2. Job `csam.contain` (admin-jobs queue, resumable, retry with backoff, DLQ):
 *      plan          snapshots of the records, the files to keep
 *      copy-public   the files viewers could fetch (matched file, thumbnails, images), encrypted
 *      purge-public  every rendition and image file deleted, CDN purged
 *      copy-source   the original upload (or Bunny's best file), encrypted, in 96 MiB steps
 *      purge         the item itself: record, original, Bunny Stream, side records, index rows
 *      ban           the uploader banned on videos (sessions and the Auth account: admin-api)
 *    The last failed attempt flags the admin (Errors page, `csam-contain:<caseId>`, Retry).
 *
 * Never restorable: none of this goes through admin_deletions (which an admin can undo), and
 * the `csam` hold is lifted by nothing.
 */
import {
	ADMIN_JOB_MAX_RETRIES,
	applySuspensionHold,
	CSAM_HOLD,
	reportNeedsAction,
	resolveNeedsAction,
	type AdminJob,
	type CsamEvidenceFile,
	type CsamResolution,
	type ErrorReporterEnv,
	type SuspendableRecord,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import Queue, { MessageType } from '../queue';
import { createJob, getJob, type JobOutcome } from '../admin/jobs';
import { banUser, purgeVideoForCsam, type AdminServiceEnv } from '../admin/service';
import { readBan } from '../admin/bans';
import { accessDrift, purgeCdn, purgeVideoRenditions, queueMediaMove, type CdnPurge, type MediaEnv } from '../media/r2-delivery';
import { deleteOriginal } from '../media/originals';
import { evidenceKeys } from './crypto';
import { copyStep, planEvidence, writeManifest, type CopyState, type EvidenceEnv, type PlannedFile } from './evidence';
import { forgetImageOwner } from './imageOwners';
import { deleteImageFile } from '../media/imageFiles';
import { findStoredComment, type StoredComment } from '../comments';
import { locatePostComment } from '../channelComments/moderation';
import { indexPostComment } from '../channelComments/index';
import { swapPinnedPointer } from '../community-comments';
import { bumpPostComments, postChannelId } from '../community-posts';
import { moderateLive } from '../admin/liveModeration';
import { streamKey } from '../live/streams';
import { deleteBunny, deleteSessionMedia, forgetRemovedRecordings, recordingFiles, recordingInstruction, recordingParts, storedRecordings, type RecordingEnv, type StoredRecording } from './recordings';

export type ContainEnv = AdminServiceEnv & EvidenceEnv & Partial<MediaEnv> & ErrorReporterEnv & Record<string, unknown>;

/** The actor every CSAM action is recorded under (the admin's id is in admin-api's audit log). */
export const CSAM_ACTOR = 'csam-response';
export const IMAGES_HOST = 'images.alummahnow.net';

type Row = Record<string, any>;
const repo = <T = Row>(bucket: R2Bucket) => new R2Repository<T>(bucket);
const now = () => new Date().toISOString();
const postKey = (channelId: string, postId: string) => `posts/${channelId}/${postId}.json`;
const postIndexKey = (channelId: string) => `posts/${channelId}/index.json`;
const imagePathOfUrl = (url: unknown): string | null => {
	if (typeof url !== 'string') return null;
	try {
		const u = new URL(url);
		return /^images\.alummahnow\.(?:net|org)$/.test(u.hostname) ? decodeURIComponent(u.pathname) : null;
	} catch {
		return null;
	}
};
const imageUrlOf = (path: string) => `https://${IMAGES_HOST}${path.split('/').map(encodeURIComponent).join('/')}`;

export const CONTAIN_PHASES = ['plan', 'copy-public', 'purge-public', 'copy-source', 'purge', 'ban'] as const;
export type ContainPhase = (typeof CONTAIN_PHASES)[number];

export interface ContainParams {
	caseId: string;
	matchedUrl: string;
	resolution: CsamResolution;
	phase: ContainPhase;
	createdAt: string;
	files?: Array<PlannedFile & { stage: 'public' | 'source' }>;
	/** Index into files of the file being copied */
	file?: number;
	copy?: CopyState;
	copied?: CsamEvidenceFile[];
	missing?: Array<{ name: string; source: string; reason: string }>;
	/** What each purge step did (shown on the case) */
	purge?: Record<string, string | number>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** Checks a resolution before anything acts on it (it names R2 keys). */
export function validResolution(r: CsamResolution): boolean {
	const ids = [r.videoId, r.channelId ?? undefined, r.postId, r.commentId, r.commentParentId, r.streamId, r.uploaderId ?? undefined].filter((v) => v !== undefined);
	if (ids.some((v) => typeof v !== 'string' || !SAFE_ID.test(v))) return false;
	if (r.imagePath !== undefined && (typeof r.imagePath !== 'string' || !r.imagePath.startsWith('/') || r.imagePath.includes('..') || r.imagePath.length > 1024)) return false;
	if ((r.kind === 'video' || r.kind === 'video_thumbnail') && !r.videoId) return false;
	if (r.kind === 'channel_image' && (!r.channelId || !r.imageField)) return false;
	if (r.kind === 'profile_image' && (!r.uploaderId || !r.imageField)) return false;
	if (r.kind === 'post_image' && !r.channelId) return false;
	// A comment or a stream never carries a video or a post: those would be taken down with it
	if (r.kind === 'comment' && (!r.commentId || !r.commentParentId || (r.commentOn !== 'video' && r.commentOn !== 'post') || r.videoId || r.postId || r.imagePath)) return false;
	if (r.kind === 'live_stream' && (!r.streamId || r.videoId || r.postId || r.imagePath)) return false;
	if (r.kind !== 'comment' && (r.commentId || r.commentParentId)) return false;
	return true;
}

// ---------------------------------------------------------------------------
// 1. Hide at once
// ---------------------------------------------------------------------------

export interface HideResult {
	hidden: boolean;
	cdn: CdnPurge;
}

/** The takedown mark every touched record carries (and the snapshot shows). */
const mark = (caseId: string, extra: Record<string, unknown> = {}) => ({ caseId, at: now(), ...extra });

/** Stops the item being shown anywhere, without deleting anything the evidence copy needs. Idempotent. */
export async function hideNow(env: ContainEnv, caseId: string, matchedUrl: string, r: CsamResolution): Promise<HideResult> {
	let hidden = false;
	const queue = new Queue(env.queue as never);
	if (r.videoId) {
		const saved = await repo(env.videos).updateObject(r.videoId, (video) => {
			const changed = applySuspensionHold(video as SuspendableRecord, CSAM_HOLD);
			if (video.csamTakedown) return changed;
			video.csamTakedown = mark(caseId);
			video.dateModified = now();
			return true;
		});
		hidden = !!saved;
		if (saved) {
			await queue.send(MessageType.VideoEdit, { videoId: r.videoId, userId: saved.userId, channelId: saved.channelId, action: 'deleted' }).catch(() => undefined);
			// Public renditions are served with no Worker: start the move to the private bucket now
			if (accessDrift(saved as never) === 'priv') await queueMediaMove(env as unknown as MediaEnv, r.videoId, 'priv').catch(() => false);
		}
	}
	if (r.kind === 'post_image' && r.channelId && r.postId) {
		const saved = await repo(env.community_posts).updateObject(postKey(r.channelId, r.postId), (post) => {
			if (post.csamTakedown) return false;
			post.csamTakedown = mark(caseId, { previousStatus: post.status ?? 'published' });
			post.status = 'deleted';
			post.updatedAt = now();
			return true;
		});
		hidden = !!saved || hidden;
		await removeFromPostIndex(env, r.channelId, r.postId);
		if (saved) await queue.send(MessageType.CommunityPostDeleted, { postId: r.postId, channelId: r.channelId, actor: { userId: CSAM_ACTOR }, reason: 'admin' }).catch(() => undefined);
	}
	if ((r.kind === 'channel_image' || r.kind === 'profile_image') && r.imageField) {
		const bucket = r.kind === 'channel_image' ? env.channels : env.profiles;
		const key = r.kind === 'channel_image' ? r.channelId! : r.uploaderId!;
		const saved = await repo(bucket).updateObject(key, (record) => {
			const current = record[r.imageField!];
			const pending = record.pendingImages?.[r.imageField!]?.url;
			// Clear the field only when it still shows the matched image (or the path is unknown)
			const shows = (url: unknown) => !r.imagePath || imagePathOfUrl(url) === r.imagePath;
			let changed = false;
			const removed: Record<string, unknown> = {};
			if (current && shows(current)) {
				removed[r.imageField!] = current;
				record[r.imageField!] = null;
				changed = true;
			}
			if (pending && shows(pending)) {
				removed[`pending.${r.imageField}`] = pending;
				delete record.pendingImages[r.imageField!];
				changed = true;
			}
			if (!changed) return false;
			record.csamTakedown = [...(Array.isArray(record.csamTakedown) ? record.csamTakedown : []), mark(caseId, { removed })];
			record.dateModified = now();
			return true;
		});
		hidden = !!saved || hidden;
		if (saved) {
			const type = r.kind === 'channel_image' ? MessageType.ChannelUpdate : MessageType.ProfileUpdate;
			await queue.send(type, r.kind === 'channel_image' ? { channelId: key, userId: saved.userId, timestamp: now() } : { userId: key, timestamp: now() }).catch(() => undefined);
		}
	}
	if (r.kind === 'comment') hidden = (await hideComment(env, caseId, r)) || hidden;
	if (r.kind === 'live_stream' && r.streamId) hidden = (await hideStream(env, caseId, r.streamId)) || hidden;
	// A bare image (no record shows it any more): nothing to hide; the file goes in purge-public
	const urls = [matchedUrl, ...(r.imagePath ? [imageUrlOf(r.imagePath)] : [])].filter((u) => /^https?:\/\//.test(u));
	const cdn = await purgeCdn(env as never, { files: [...new Set(urls)] });
	return { hidden, cdn };
}

type MarkedComment = StoredComment & { csamTakedown?: unknown; content?: string; deletedAt?: string; adminDeletion?: unknown };

/** The stored comment as a takedown leaves it: gone for everyone, its replies untouched (other people wrote them). */
function takeCommentDown(comment: MarkedComment, caseId: string): boolean {
	if (comment.csamTakedown) return false;
	// An earlier removal (by its channel, or by an admin) could be undone: the takedown replaces it
	const { removedBy, removedAt, removedByUserId, adminDeletion } = comment;
	comment.csamTakedown = mark(caseId, removedBy || adminDeletion ? { previous: { removedBy, removedAt, removedByUserId, adminDeletion } } : {});
	delete comment.removedBy;
	delete comment.removedAt;
	delete comment.removedByUserId;
	delete comment.adminDeletion;
	comment.isDeleted = true;
	comment.isPinned = false;
	return true;
}

/** Hides the comment alone. The video or post it is on keeps everything else. */
async function hideComment(env: ContainEnv, caseId: string, r: CsamResolution): Promise<boolean> {
	const commentId = r.commentId!;
	const parentId = r.commentParentId!;
	const queue = new Queue(env.queue as never);
	if (r.commentOn === 'video') {
		let found = false;
		await repo(env.videos).updateObject(parentId, (video) => {
			const comment = findStoredComment(video.comments as MarkedComment[], commentId)?.comment;
			found = !!comment;
			return !!comment && takeCommentDown(comment, caseId);
		});
		if (found) await queue.send(MessageType.CommentDelete, { commentId, videoId: parentId, reason: 'admin' } as never).catch(() => undefined);
		return found;
	}
	const located = await locatePostComment(env.community_posts, parentId, commentId);
	if (!located) return false;
	let changed = false;
	const saved = await repo<MarkedComment>(env.community_posts).updateObject(located.key, (comment) => {
		const wasLive = !comment.deletedAt && comment.isDeleted !== true && comment.status !== 'held' && comment.isHidden !== true;
		changed = takeCommentDown(comment, caseId) && wasLive;
		if (comment.csamTakedown) comment.deletedAt ??= now();
		return true;
	});
	const channelId = saved ? await postChannelId({ community_posts: env.community_posts, SEARCH_DB: env.SEARCH_DB }, parentId) : null;
	if (saved && channelId) {
		if (changed) await bumpPostComments(env.community_posts, postKey(channelId, parentId), -1);
		await indexPostComment(env as never, undefined, parentId, channelId, saved as never);
	}
	await swapPinnedPointer(env.community_posts, parentId, (current) => (current === commentId ? '' : false)).catch(() => undefined);
	return !!saved;
}

/** Ends the stream and hides it for good (the hold no restore lifts). Marked first: ending it must not remove what was streamed. */
async function hideStream(env: ContainEnv, caseId: string, streamId: string): Promise<boolean> {
	const saved = await repo(env.videos).updateObject(streamKey(streamId), (stream) => {
		const changed = applySuspensionHold(stream as SuspendableRecord, CSAM_HOLD);
		if (stream.csamTakedown) return changed;
		stream.csamTakedown = mark(caseId);
		return true;
	});
	if (!saved) return false;
	// The reason is read by the stream's owner and by moderators, so it never says why
	await moderateLive(env as never, { entityType: 'livestream', entityId: streamId, action: 'removed', notes: `Trust and safety action (ref ${caseId})`, actorId: CSAM_ACTOR });
	return true;
}

/** The evidence files that were kept, by name. */
const keptFiles = (p: ContainParams) => new Map((p.copied ?? []).map((f) => [f.name, f]));

/** A recording's planned copies. */
const plannedFor = (p: ContainParams, r: StoredRecording) =>
	(p.files ?? []).filter((f) => (f.source.type === 'live' && f.source.sessionId === r.sessionId) || (f.source.type === 'bunny_live' && f.source.guid === r.guid));

/** Whether a whole copy of the recording is in the store (or there was nothing to copy). What was streamed after the copy is not in it. */
async function recordingKept(env: ContainEnv, p: ContainParams, r: StoredRecording): Promise<boolean> {
	// A session with no segment holds playlists only: nothing was streamed
	if (r.provider === 'selfhosted' && !r.rendition) return true;
	const kept = keptFiles(p);
	for (const f of plannedFor(p, r)) {
		const file = kept.get(f.name);
		if (!file) continue;
		if (f.source.type !== 'live') return true;
		const parts = await recordingParts(env as RecordingEnv, f.source.sessionId, f.source.rendition);
		// Fewer bytes than were kept: its removal has begun
		if (parts.reduce((n, part) => n + part.size, 0) <= file.bytes) return true;
	}
	return false;
}

/** Copies of recordings of one case: a stream that keeps growing ends with a person. */
const MAX_RECORDING_FILES = 250;

/** Pages of 1000 objects one step deletes at most. */
const PURGE_PAGES = 200;

/**
 * Removes the recordings whose copies are in the store, one provider at a time (self-hosted ones with the public
 * files). `more`: there is more to remove than one step does.
 */
async function purgeRecordings(env: ContainEnv, p: ContainParams, provider: StoredRecording['provider']): Promise<{ removed: number; more: boolean }> {
	const streamId = p.resolution.streamId!;
	const left: StoredRecording[] = [];
	let removed = 0;
	let pages = PURGE_PAGES;
	let more = false;
	for (const r of await storedRecordings(env as RecordingEnv, streamId)) {
		if (more || r.provider !== provider || !(await recordingKept(env, p, r))) {
			left.push(r);
			continue;
		}
		if (provider === 'selfhosted') {
			const out = await deleteSessionMedia(env as RecordingEnv, r.sessionId, pages);
			pages -= out.pages;
			if (!out.done || pages <= 0) more = true;
			if (!out.done) {
				left.push(r);
				continue;
			}
		} else await deleteBunny(env as RecordingEnv, r.guid!);
		removed++;
	}
	await forgetRemovedRecordings(env as RecordingEnv, streamId, left);
	const host = (env as { LIVE_PUBLIC_HOST?: string }).LIVE_PUBLIC_HOST;
	if (provider === 'selfhosted' && host) {
		const { results } = await env.SEARCH_DB!.prepare("SELECT id FROM live_sessions WHERE stream_id = ? AND provider = 'selfhosted' LIMIT 200").bind(streamId).all<{ id: string }>();
		if (results?.length && (await purgeCdn(env as never, { prefixes: results.map((s) => `${host}/hls/${s.id}/`) })) === 'failed') throw new Error('Cloudflare cache purge failed');
	}
	return { removed, more };
}

async function removeFromPostIndex(env: ContainEnv, channelId: string, postId: string): Promise<void> {
	await repo<{ postIds?: string[]; lastUpdated?: string }>(env.community_posts)
		.updateObject(postIndexKey(channelId), (index) => {
			if (!Array.isArray(index.postIds) || !index.postIds.includes(postId)) return false;
			index.postIds = index.postIds.filter((id) => id !== postId);
			index.lastUpdated = now();
			return true;
		})
		.catch(() => null);
}

/** Hides the item and queues the job. The case id is admin-api's. */
export async function startContainment(env: ContainEnv, input: { caseId: string; matchedUrl: string; resolution: CsamResolution; actorId: string }): Promise<{ hide: HideResult; job: AdminJob }> {
	const { caseId, matchedUrl, resolution } = input;
	const hide = await hideNow(env, caseId, matchedUrl, resolution);
	const ofUser = resolution.kind === 'profile_image' || resolution.kind === 'comment';
	const targetKind = resolution.videoId ? 'video' : ofUser ? 'user' : 'channel';
	const targetId = resolution.videoId ?? (ofUser ? resolution.uploaderId : resolution.channelId) ?? caseId;
	const params: ContainParams = { caseId, matchedUrl, resolution, phase: 'plan', createdAt: now() };
	const job = await createJob(env, { kind: 'csam.contain', targetKind, targetId, actorId: input.actorId, params: params as unknown as Record<string, unknown> });
	return { hide, job };
}

// ---------------------------------------------------------------------------
// 2. The job
// ---------------------------------------------------------------------------

/** Deletes one stored image (lib/media/imageFiles.ts); a file already gone counts as done. */
const deleteStoredImage = (env: ContainEnv, path: string) => deleteImageFile(env, path);

/** Bunny's own edge (images are pulled through it): purged when an account API key is set. */
async function purgeBunnyEdge(env: ContainEnv, urls: string[]): Promise<CdnPurge> {
	const key = env.BUNNY_API_KEY ? await getSecret(env.BUNNY_API_KEY as never, 'BUNNY_API_KEY').catch(() => '') : '';
	if (!key) return 'not_configured';
	for (const url of urls) {
		const res = await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(url)}&async=false`, { method: 'POST', headers: { AccessKey: key } });
		if (!res.ok) return 'failed';
	}
	return 'purged';
}

/** A path that is one plain file under the prefix (no dot segments, no encoded separators). */
const under = (path: string, prefix: string) => path.startsWith(prefix) && !path.slice(prefix.length).split('/').some((p) => !p || p === '.' || p === '..' || p.includes('\\'));

/**
 * Every image file of the item that goes with it: the matched file, and the files the item itself
 * stored. A post's other images go only when they are in that channel's own upload folder, and a
 * video's custom thumbnail only from its own folder: a record can name another account's file
 * (a pasted URL), and that file is not ours to delete.
 */
async function imagePathsOf(env: ContainEnv, r: CsamResolution): Promise<string[]> {
	const paths = new Set<string>();
	if (r.imagePath) paths.add(r.imagePath);
	if (r.kind === 'post_image' && r.channelId && r.postId) {
		const object = await env.community_posts.get(postKey(r.channelId, r.postId));
		const post = object ? ((await object.json().catch(() => null)) as { images?: Array<{ url?: string }> } | null) : null;
		for (const image of post?.images ?? []) {
			const path = imagePathOfUrl(image.url);
			if (path && under(path, `/community-posts/${r.channelId}/`)) paths.add(path);
		}
	}
	if (r.videoId) {
		const object = await env.videos.get(r.videoId);
		const video = object ? ((await object.json().catch(() => null)) as Row | null) : null;
		const path = imagePathOfUrl(video?.thumbnailUrl);
		if (path && under(path, `/thumbnails/${r.videoId}/`)) paths.add(path);
	}
	return [...paths];
}

const fileStages = (files: PlannedFile[]) =>
	files
		.map((f) => ({ ...f, stage: (f.source.type === 'original' || f.source.type === 'bunny' || f.source.type === 'bunny_live' ? 'source' : 'public') as 'public' | 'source' }))
		.sort((a, b) => (a.stage === b.stage ? 0 : a.stage === 'public' ? -1 : 1));

/**
 * A recording that could not be copied counts as missing only when it is not stored any more (a person kept and
 * removed it). While it is, the step fails and is tried again, and nothing after it runs.
 */
async function recordingMustBeGone(env: ContainEnv, p: ContainParams, file: PlannedFile): Promise<void> {
	const { source } = file;
	if (source.type !== 'live' && source.type !== 'bunny_live') return;
	const stored = (await storedRecordings(env as RecordingEnv, p.resolution.streamId!)).find((r) => (source.type === 'live' ? r.sessionId === source.sessionId : r.guid === source.guid));
	if (stored) throw new Error(`Nobody can reach the stream. ${recordingInstruction(stored, false)}`);
}

async function copyPhase(env: ContainEnv, p: ContainParams, stage: 'public' | 'source', next: ContainPhase): Promise<ContainParams> {
	const keys = await evidenceKeys(env);
	const files = p.files ?? [];
	// Done already: a recording found later adds files to a plan that was carried out (banUploader)
	const done = new Set([...(p.copied ?? []), ...(p.missing ?? [])].map((f) => f.name));
	let index = p.file ?? 0;
	while (index < files.length && (files[index]!.stage !== stage || done.has(files[index]!.name))) index++;
	if (index >= files.length || files[index]!.stage !== stage) return { ...p, phase: next, file: index, copy: undefined };
	const step = await copyStep(env, keys, p.caseId, files[index]!, p.copy ?? { file: index, parts: [], chunk: 0, chunkSha256: [], bytes: 0 });
	if (step.status === 'copying') return { ...p, file: index, copy: step.state };
	if (step.missing) await recordingMustBeGone(env, p, files[index]!);
	const copied = [...(p.copied ?? []), ...(step.file ? [step.file] : [])];
	const missing = [...(p.missing ?? []), ...(step.missing ? [step.missing] : [])];
	// The manifest follows every finished file, so a later failure still leaves a readable case
	await writeManifest(env, keys, { v: 1, caseId: p.caseId, matchedUrl: p.matchedUrl, resolution: p.resolution, files: copied, missing, createdAt: p.createdAt });
	return { ...p, file: index + 1, copy: undefined, copied, missing };
}

async function purgePublic(env: ContainEnv, p: ContainParams): Promise<ContainParams> {
	const r = p.resolution;
	const purge: Record<string, string | number> = { ...(p.purge ?? {}) };
	if (r.videoId) purge.renditions = await purgeVideoRenditions(env as unknown as MediaEnv, r.videoId, { strict: true });
	const paths = await imagePathsOf(env, r);
	let deleted = 0;
	for (const path of paths) if ((await deleteStoredImage(env, path)) === 'deleted') deleted++;
	purge.images = deleted;
	if (r.kind === 'live_stream') {
		const recordings = await purgeRecordings(env, p, 'selfhosted');
		purge.recordings = Number(purge.recordings ?? 0) + recordings.removed;
		if (recordings.more) return { ...p, purge };
	}
	const urls = paths.map(imageUrlOf);
	const cdn = await purgeCdn(env as never, { files: urls });
	if (cdn === 'failed') throw new Error('Cloudflare cache purge failed');
	purge.cdn = cdn;
	purge.bunnyEdge = await purgeBunnyEdge(env, urls);
	if (purge.bunnyEdge === 'failed') throw new Error('Bunny edge purge failed');
	for (const path of paths) await forgetImageOwner(env.SEARCH_DB, path);
	return { ...p, phase: 'copy-source', file: 0, purge };
}

async function purgeItem(env: ContainEnv, p: ContainParams): Promise<ContainParams> {
	const r = p.resolution;
	const purge: Record<string, string | number> = { ...(p.purge ?? {}) };
	if (r.videoId) {
		// The channel is kept in the job before the record goes, so a retry still finds what lists the video
		const video = (await (await env.videos.get(r.videoId))?.json()) as Row | null | undefined;
		if (video?.channelId && video.channelId !== r.channelId) return { ...p, resolution: { ...r, channelId: video.channelId } };
		await purgeVideoForCsam(env, r.videoId, r.channelId ?? null);
		purge.originals = await deleteOriginal(env as never, r.videoId);
		purge.video = 'deleted';
	}
	if (r.kind === 'post_image' && r.channelId && r.postId) {
		await removeFromPostIndex(env, r.channelId, r.postId);
		await env.community_posts.delete(postKey(r.channelId, r.postId));
		purge.post = 'deleted';
	}
	if (r.kind === 'live_stream') purge.bunnyRecordings = Number(purge.bunnyRecordings ?? 0) + (await purgeRecordings(env, p, 'bunny')).removed;
	if (r.kind === 'comment') purge.comment = (await eraseCommentText(env, p.caseId, r)) ? 'deleted' : 'gone';
	return { ...p, phase: 'ban', purge };
}

/** What the comment said, after the evidence kept it. The replies of other people stay. */
async function eraseCommentText(env: ContainEnv, caseId: string, r: CsamResolution): Promise<boolean> {
	const erase = (comment: MarkedComment) => {
		takeCommentDown(comment, caseId);
		comment.text = '';
		if (comment.content !== undefined) comment.content = '';
	};
	if (r.commentOn === 'video') {
		let found = false;
		await repo(env.videos).updateObject(r.commentParentId!, (video) => {
			const comment = findStoredComment(video.comments as MarkedComment[], r.commentId!)?.comment;
			found = !!comment;
			if (comment) erase(comment);
			return found;
		});
		return found;
	}
	const located = await locatePostComment(env.community_posts, r.commentParentId!, r.commentId!);
	if (!located) return false;
	return !!(await repo<MarkedComment>(env.community_posts).updateObject(located.key, (comment) => {
		erase(comment);
		return true;
	}));
}

/** The last step. `again`: a recording turned up that is not kept yet (it goes back to the copy). */
async function banUploader(env: ContainEnv, p: ContainParams): Promise<{ result: Record<string, unknown> } | { again: ContainParams }> {
	const uploaderId = p.resolution.uploaderId;
	let ban = 'no_uploader';
	if (uploaderId) {
		if (await readBan(env.SEARCH_DB!, uploaderId)) ban = 'already_banned';
		else {
			await banUser(env, uploaderId, CSAM_ACTOR, `CSAM match (case ${p.caseId})`);
			ban = 'banned';
		}
	}
	const keys = await evidenceKeys(env);
	if (p.resolution.kind === 'live_stream') for (const provider of ['selfhosted', 'bunny'] as const) if ((await purgeRecordings(env, p, provider)).more) return { again: { ...p } };
	const left = p.resolution.kind === 'live_stream' ? await storedRecordings(env as RecordingEnv, p.resolution.streamId!) : [];
	const unkept: StoredRecording[] = [];
	for (const r of left) if (!(await recordingKept(env, p, r))) unkept.push(r);
	// Only there since the plan (Bunny makes the library video later; a last segment came in), or the copy is not whole
	const isDone = new Set([...(p.copied ?? []), ...(p.missing ?? [])].map((f) => f.name));
	const planned = (p.files ?? []).filter((f) => f.source.type === 'live' || f.source.type === 'bunny_live').length;
	const late = unkept.filter((r) => plannedFor(p, r).every((f) => isDone.has(f.name)));
	if (late.length && planned + late.length <= MAX_RECORDING_FILES) {
		return { again: { ...p, phase: 'copy-public', file: 0, copy: undefined, files: fileStages([...(p.files ?? []), ...recordingFiles(late, planned)]) } };
	}
	const missing = [
		...(p.missing ?? []).filter((m) => !m.name.startsWith('06-live-recording') || !left.length),
		...unkept.map((r, i) => ({ name: `live-recording-${i + 1}`, source: r.guid ? `bunny/${r.guid}` : `LIVE_MEDIA/live/${r.sessionId}/`, reason: recordingInstruction(r, false) })),
	];
	await writeManifest(env, keys, {
		v: 1,
		caseId: p.caseId,
		matchedUrl: p.matchedUrl,
		resolution: p.resolution,
		files: p.copied ?? [],
		missing,
		createdAt: p.createdAt,
		...(left.length ? {} : { completedAt: now() }),
	});
	// Hidden, held and off the CDN already; what is still stored needs another run or a person, and the case says which
	if (left.length) throw new Error(`Nobody can reach the stream, and ${left.length} recording(s) are still stored. ${left.map((r) => recordingInstruction(r, !unkept.includes(r))).join(' ')}`);
	return { result: { caseId: p.caseId, files: (p.copied ?? []).length, missing: (p.missing ?? []).length, purge: p.purge ?? {}, ban } };
}

/** One delivery of job csam.contain: one phase step, then the next step is queued. */
export async function runContainStep(env: ContainEnv, job: AdminJob): Promise<JobOutcome> {
	const p = job.params as unknown as ContainParams;
	const needsActionKey = `csam-contain:${p.caseId}`;
	try {
		if (!validResolution(p.resolution)) throw new Error('invalid resolution');
		let next: ContainParams;
		switch (p.phase) {
			case 'plan': {
				const keys = await evidenceKeys(env);
				const { files, snapshots } = await planEvidence(env, keys, p.caseId, p.matchedUrl, p.resolution);
				await writeManifest(env, keys, { v: 1, caseId: p.caseId, matchedUrl: p.matchedUrl, resolution: p.resolution, files: snapshots, missing: [], createdAt: p.createdAt });
				next = { ...p, phase: 'copy-public', files: fileStages(files), file: 0, copied: snapshots, missing: [] };
				break;
			}
			case 'copy-public':
				next = await copyPhase(env, p, 'public', 'purge-public');
				break;
			case 'purge-public':
				next = await purgePublic(env, p);
				break;
			case 'copy-source':
				next = await copyPhase(env, p, 'source', 'purge');
				break;
			case 'purge':
				next = await purgeItem(env, p);
				break;
			case 'ban': {
				const out = await banUploader(env, p);
				if ('again' in out) {
					next = out.again;
					break;
				}
				resolveNeedsAction(env, undefined, needsActionKey);
				return { done: true, result: out.result };
			}
			default:
				throw new Error(`unknown phase ${String(p.phase)}`);
		}
		return { done: false, params: next as unknown as Record<string, unknown>, result: { phase: next.phase, copied: (next.copied ?? []).length } };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.error('[CSAM] Containment step failed', { caseId: p.caseId, phase: p.phase, attempt: job.attempts, error: reason });
		// The queue's last attempt: the admin must see it (the job's own failure only reaches the logs)
		if (job.attempts > ADMIN_JOB_MAX_RETRIES) {
			reportNeedsAction('api-videos', env, undefined, {
				key: needsActionKey,
				source: 'admin-job',
				title: 'CSAM takedown did not finish',
				message: `Case ${p.caseId}: the "${p.phase}" step failed after every retry (${reason}). The item is hidden; Retry on the case page finishes the takedown.`,
				itemType: 'csam-case',
				itemId: p.caseId,
				// Retry lives on the case page (super admins only, audited), not on the Errors page
				itemUrl: `/moderation/csam/${p.caseId}`,
			});
		}
		throw error;
	}
}

/** The newest csam.contain job of a case (one per case; a retry reuses it). */
export async function containJobOf(env: ContainEnv, caseId: string): Promise<AdminJob | null> {
	const row = await env.SEARCH_DB!
		.prepare(`SELECT id FROM admin_jobs WHERE kind = 'csam.contain' AND json_extract(params, '$.caseId') = ? ORDER BY created_at DESC LIMIT 1`)
		.bind(caseId)
		.first<{ id: string }>();
	return row ? getJob(env, row.id) : null;
}
