/**
 * Taking a CSAM match down (docs/specs/CSAM-RESPONSE.md §3–§5).
 *
 * 1. hideNow (the intake request, synchronous): the item stops being shown on every surface at
 *    once (a `csam` hold on the video, the post deleted from view, the avatar or cover field
 *    cleared), the matched URL is purged from the CDN, and a private video's media move starts.
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
	const ids = [r.videoId, r.channelId ?? undefined, r.postId, r.uploaderId ?? undefined].filter((v) => v !== undefined);
	if (ids.some((v) => typeof v !== 'string' || !SAFE_ID.test(v))) return false;
	if (r.imagePath !== undefined && (typeof r.imagePath !== 'string' || !r.imagePath.startsWith('/') || r.imagePath.includes('..') || r.imagePath.length > 1024)) return false;
	if ((r.kind === 'video' || r.kind === 'video_thumbnail') && !r.videoId) return false;
	if (r.kind === 'channel_image' && (!r.channelId || !r.imageField)) return false;
	if (r.kind === 'profile_image' && (!r.uploaderId || !r.imageField)) return false;
	if (r.kind === 'post_image' && !r.channelId) return false;
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
	// A bare image (no record shows it any more): nothing to hide; the file goes in purge-public
	const urls = [matchedUrl, ...(r.imagePath ? [imageUrlOf(r.imagePath)] : [])].filter((u) => /^https?:\/\//.test(u));
	const cdn = await purgeCdn(env as never, { files: [...new Set(urls)] });
	return { hidden, cdn };
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
	const targetKind = resolution.videoId ? 'video' : resolution.kind === 'profile_image' ? 'user' : 'channel';
	const targetId = resolution.videoId ?? (resolution.kind === 'profile_image' ? resolution.uploaderId : resolution.channelId) ?? caseId;
	const params: ContainParams = { caseId, matchedUrl, resolution, phase: 'plan', createdAt: now() };
	const job = await createJob(env, { kind: 'csam.contain', targetKind, targetId, actorId: input.actorId, params: params as unknown as Record<string, unknown> });
	return { hide, job };
}

// ---------------------------------------------------------------------------
// 2. The job
// ---------------------------------------------------------------------------

async function deleteStoredImage(env: ContainEnv, path: string): Promise<'deleted' | 'gone'> {
	const key = env.image_storage_key ? await getSecret(env.image_storage_key, 'image_storage_key') : '';
	if (!key || !env.ZONE) throw new Error('Image storage is not configured');
	const res = await fetch(`https://storage.bunnycdn.com/${env.ZONE}${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { AccessKey: key } });
	if (res.status === 404) return 'gone';
	if (!res.ok) throw new Error(`Image storage delete answered ${res.status}`);
	return 'deleted';
}

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

/** Every image path the item shows (all of them go: a post with one matched image goes whole). */
async function imagePathsOf(env: ContainEnv, r: CsamResolution): Promise<string[]> {
	const paths = new Set<string>();
	if (r.imagePath) paths.add(r.imagePath);
	if (r.kind === 'post_image' && r.channelId && r.postId) {
		const object = await env.community_posts.get(postKey(r.channelId, r.postId));
		const post = object ? ((await object.json().catch(() => null)) as { images?: Array<{ url?: string }> } | null) : null;
		for (const image of post?.images ?? []) {
			const path = imagePathOfUrl(image.url);
			if (path) paths.add(path);
		}
	}
	if (r.videoId) {
		const object = await env.videos.get(r.videoId);
		const video = object ? ((await object.json().catch(() => null)) as Row | null) : null;
		const path = imagePathOfUrl(video?.thumbnailUrl);
		if (path?.startsWith('/thumbnails/')) paths.add(path);
	}
	return [...paths];
}

const fileStages = (files: PlannedFile[]) =>
	files
		.map((f) => ({ ...f, stage: (f.source.type === 'original' || f.source.type === 'bunny' ? 'source' : 'public') as 'public' | 'source' }))
		.sort((a, b) => (a.stage === b.stage ? 0 : a.stage === 'public' ? -1 : 1));

async function copyPhase(env: ContainEnv, p: ContainParams, stage: 'public' | 'source', next: ContainPhase): Promise<ContainParams> {
	const keys = await evidenceKeys(env);
	const files = p.files ?? [];
	let index = p.file ?? 0;
	while (index < files.length && files[index]!.stage !== stage) index++;
	if (index >= files.length || files[index]!.stage !== stage) return { ...p, phase: next, file: index, copy: undefined };
	const step = await copyStep(env, keys, p.caseId, files[index]!, p.copy ?? { file: index, parts: [], chunk: 0, chunkSha256: [], bytes: 0 });
	if (step.status === 'copying') return { ...p, file: index, copy: step.state };
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
		await purgeVideoForCsam(env, r.videoId);
		purge.originals = await deleteOriginal(env as never, r.videoId);
		purge.video = 'deleted';
	}
	if (r.kind === 'post_image' && r.channelId && r.postId) {
		await removeFromPostIndex(env, r.channelId, r.postId);
		await env.community_posts.delete(postKey(r.channelId, r.postId));
		purge.post = 'deleted';
	}
	return { ...p, phase: 'ban', purge };
}

async function banUploader(env: ContainEnv, p: ContainParams): Promise<{ result: Record<string, unknown> }> {
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
	await writeManifest(env, keys, {
		v: 1,
		caseId: p.caseId,
		matchedUrl: p.matchedUrl,
		resolution: p.resolution,
		files: p.copied ?? [],
		missing: p.missing ?? [],
		createdAt: p.createdAt,
		completedAt: now(),
	});
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
				const { result } = await banUploader(env, p);
				resolveNeedsAction(env, undefined, needsActionKey);
				return { done: true, result };
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
				message: `Case ${p.caseId}: the "${p.phase}" step failed after every retry (${reason}). The item is hidden; Retry finishes the takedown.`,
				itemType: 'csam-case',
				itemId: p.caseId,
				itemUrl: `/moderation/csam/${p.caseId}`,
				retry: { kind: 'service', service: 'api-videos', path: '/internal/csam/retry', body: { caseId: p.caseId } },
				retryLabel: 'Retry takedown',
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
