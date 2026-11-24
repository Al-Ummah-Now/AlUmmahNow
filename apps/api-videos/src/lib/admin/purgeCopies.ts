/**
 * The copies a purge erases besides the record itself (issues #699, #700, #814; transcription
 * spec §9.2). Where each copy of a video lives, and who erases it:
 *
 * | Copy                                             | Erased by                                   |
 * |--------------------------------------------------|---------------------------------------------|
 * | R2 record (`videos`)                             | purgeVideo                                  |
 * | Bunny Stream video                               | purgeVideo                                  |
 * | R2 renditions, R2 custom thumbnails, original    | purgeVideoMedia (lib/media/r2-delivery.ts)  |
 * | Subtitles, drafts, metadata (`subtitles/{id}/`)  | deleteVideoSideRecords (#814)               |
 * | Upload marker, playlist-add records, schedule    | deleteVideoSideRecords                      |
 * | Bunny Storage custom thumbnails                  | eraseVideoImages (here)                     |
 * | Caption jobs + their work files                  | eraseCaptionJobs (here)                     |
 * | Channel sections and the channel's playlists     | dropVideoReferences (here)                  |
 * | Notifications, likes                             | purgeVideo (NOTIFICATIONS_DB)               |
 * | Search rows                                      | the VideoDelete message (search sync)       |
 * | Chapters                                         | inside the record                           |
 *
 * Another account's playlist or watch history may still list the id. Those lists hold only the
 * id (no copy of the video), every reader drops an id that no longer resolves, and the API
 * answers 410 for it (D-SEO-4).
 *
 * Images: only files the item stored itself are deleted, from its own folder
 * (`/thumbnails/{videoId}/`, `/community-posts/{channelId}/`). A record can name another account's file (a pasted URL) or a shared legacy image, and
 * that file is not ours to delete. Every step is idempotent: a file or row already gone is done.
 */
import { channelPlaylistIds } from '../channelPlaylists';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { cancelJob, clearJobWork, CaptionJobHttpError, type CaptionJobsEnv } from '../captions/jobs';
import { deleteImageFiles, fileUnder, imagePathOfUrl, imageStorageConfigured, listImageFolder, type ImageFilesEnv } from '../media/imageFiles';

type Row = Record<string, any>;

/** The folder where a video's custom thumbnails are stored on Bunny (lib/thumbnail/store.ts). */
export const videoThumbnailFolder = (videoId: string) => `/thumbnails/${videoId}/`;
/** The folder where a channel's post images are stored on Bunny (endpoints/community/upload-*.ts). */
export const postImageFolder = (channelId: string) => `/community-posts/${channelId}/`;

/**
 * Image paths a video record names that belong to the video: files in its own folder only. A
 * record can name any URL (another video's thumbnail, a pasted or legacy image), so a file
 * outside the folder is never the purge's to delete. Admin uploads go to the folder too
 * (lib/admin/images.ts); ones from before that stay where they are.
 */
export function ownedVideoImagePaths(videoId: string, record: Row | null | undefined): string[] {
	if (!record) return [];
	const urls: unknown[] = [record.thumbnailUrl, record.previousThumbnailUrl, record.customThumbnailUrl];
	if (record.thumbnailSizes && typeof record.thumbnailSizes === 'object') urls.push(...Object.values(record.thumbnailSizes as object));
	const paths = new Set<string>();
	for (const url of urls) {
		const path = imagePathOfUrl(url);
		if (path && fileUnder(path, videoThumbnailFolder(videoId))) paths.add(path);
	}
	return [...paths];
}

/**
 * A video's custom thumbnails on Bunny Storage: every file in its folder (each upload had its own
 * path, so earlier ones are there too, admin uploads included). Returns how many were
 * deleted. No-op where image storage is not configured (local runs).
 */
export async function eraseVideoImages(env: ImageFilesEnv, videoId: string, record: Row | null | undefined): Promise<number> {
	if (!imageStorageConfigured(env)) return 0;
	const paths = [...(await listImageFolder(env, videoThumbnailFolder(videoId))), ...ownedVideoImagePaths(videoId, record)];
	return deleteImageFiles(env, paths);
}

/** Every image URL anywhere in a post that is a file in its channel's own upload folder. */
export function ownedPostImagePaths(post: Row | null | undefined, channelId: string): string[] {
	const paths = new Set<string>();
	const folder = postImageFolder(channelId);
	const walk = (node: unknown, depth: number): void => {
		if (depth > 6 || node == null) return;
		if (typeof node === 'string') {
			const path = imagePathOfUrl(node);
			if (path && fileUnder(path, folder)) paths.add(path);
		} else if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1);
		} else if (typeof node === 'object') {
			for (const value of Object.values(node as object)) walk(value, depth + 1);
		}
	};
	walk(post, 0);
	return [...paths];
}

/** A deleted post's images (uploads, GIFs, link preview images). Returns how many were deleted. */
export async function erasePostImages(env: ImageFilesEnv, post: Row | null | undefined, channelId: string): Promise<number> {
	if (!imageStorageConfigured(env)) return 0;
	const paths = ownedPostImagePaths(post, channelId);
	return paths.length ? deleteImageFiles(env, paths) : 0;
}

/** Every post image of a purged channel (its whole upload folder). Returns how many were deleted. */
export async function eraseChannelPostImages(env: ImageFilesEnv, channelId: string): Promise<number> {
	if (!imageStorageConfigured(env)) return 0;
	return deleteImageFiles(env, await listImageFolder(env, postImageFolder(channelId)));
}

/**
 * A video's caption jobs (SEARCH_DB `caption_jobs`) and their work files (`captions-work/{jobId}/`).
 * An active job is cancelled first, which settles its minutes; one writing its draft (409
 * `job_finishing`) makes the step throw so the purge retries after it finished, and so does work that
 * could not be deleted. `limit`: at most so many jobs; returns how many it took.
 */
export async function eraseCaptionJobs(env: CaptionJobsEnv, videoId: string, opts: { limit?: number } = {}): Promise<number> {
	const db = env.SEARCH_DB as D1Database | undefined;
	if (!db) return 0;
	const rows = (await db.prepare('SELECT id, status FROM caption_jobs WHERE video_id = ? LIMIT ?').bind(videoId, opts.limit ?? -1).all<{ id: string; status: string }>()).results ?? [];
	for (const row of rows) {
		if (!['ready', 'failed', 'cancelled'].includes(row.status)) {
			try {
				await cancelJob(env, videoId, row.id);
			} catch (error) {
				if (error instanceof CaptionJobHttpError && error.code === 'job_not_found') continue;
				throw error;
			}
		}
		// The row is how the work is found: it goes only once the work is gone
		await clearJobWork(env, row.id, { strict: true });
		await db.prepare('DELETE FROM caption_jobs WHERE id = ?').bind(row.id).run();
	}
	return rows.length;
}

type ReferenceEnv = { playlists?: R2Bucket; channel_sections?: R2Bucket; SEARCH_DB?: unknown };

/** Removes `videoId` from one stored object; true when it changed. */
function dropFrom(record: Row, videoId: string): boolean {
	let changed = false;
	for (const field of ['videoIds', 'videos'] as const) {
		const list = record[field];
		if (Array.isArray(list) && list.some((v) => v === videoId || v?.id === videoId || v?.videoId === videoId)) {
			record[field] = list.filter((v) => v !== videoId && v?.id !== videoId && v?.videoId !== videoId);
			changed = true;
		}
	}
	for (const field of ['trailerVideoId', 'returningVideoId'] as const) {
		if (record[field] === videoId) {
			record[field] = null;
			changed = true;
		}
	}
	if (changed && typeof record.videosCount === 'number' && Array.isArray(record.videos)) record.videosCount = record.videos.length;
	return changed;
}

/**
 * The video's id in its own channel's sections (manual video lists, spotlight videos) and its
 * channel's playlists. Returns how many objects changed. A missing channel has nothing left.
 */
export async function dropVideoReferences(env: ReferenceEnv, videoId: string, channelId: string | null | undefined): Promise<number> {
	if (!channelId) return 0;
	let changed = 0;
	if (env.channel_sections) {
		const sections = new R2Repository<Row>(env.channel_sections);
		let cursor: string | undefined;
		do {
			const page = await env.channel_sections.list({ prefix: `${channelId}/`, ...(cursor ? { cursor } : {}) });
			for (const object of page.objects) {
				let did = false;
				await sections
					.updateObject(object.key, (record) => (did = !!record && typeof record === 'object' && !Array.isArray(record) && dropFrom(record, videoId)))
					.catch((error) => {
						// Not JSON (an asset under the channel's prefix): nothing to drop there
						if (!(error instanceof SyntaxError)) throw error;
					});
				if (did) changed++;
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}
	if (env.playlists && env.SEARCH_DB) {
		const playlists = new R2Repository<Row>(env.playlists);
		for (const id of await channelPlaylistIds(env, channelId)) {
			let did = false;
			await playlists.updateObject(id, (record) => (did = dropFrom(record, videoId)));
			if (did) changed++;
		}
	}
	if (changed) logger.debug('[Purge] Dropped video references', { videoId, channelId, changed });
	return changed;
}
