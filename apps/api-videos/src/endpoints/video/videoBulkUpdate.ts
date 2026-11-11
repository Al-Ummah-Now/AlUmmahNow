import { Bool, Str } from "chanfana";
import { z } from "zod";
import { can, VideoCategory, type ChannelRole } from "@al-ummah/shared-types";
import { Video as BusinessVideo, Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { recordOwnerCategory, requestVideoSuggestion } from "../../lib/categorySuggestions";
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceNewVideo } from "../../lib/notification-events";
import { scanInBackground, videoScanText } from '../../lib/moderation-scan';
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import { requireSecret } from "../../lib/env-helpers";
import { canManagePlaylist, roleOnChannel } from "../../lib/channelAccess";
import { addVideosNow, removeVideos } from "../../lib/playlistBulk";
import {
	applyBulkChanges,
	isEmptyChange,
	pickFields,
	revertFields,
	MAX_BULK_PLAYLISTS,
	MAX_BULK_VIDEOS,
	MAX_TAG_LENGTH,
	MAX_TAGS,
	type BulkEditError,
	type BulkVideoChanges,
	type PerVideoChanges,
} from "../../lib/bulkEdit";
import { OPERATION_ID, readUndo, writeUndo, type BulkUndoRecord, type UndoKv } from "../../lib/bulkEditUndo";
import { AuthenticatedRoute, AppContext } from '../../base';

type VideoType = z.infer<typeof BusinessVideo>;
type PlaylistType = z.infer<typeof BusinessPlaylist>;

/** Per-video failure codes (the studio shows its own words for each). */
const MESSAGES = {
	not_found: "Video not found",
	forbidden: "Forbidden - you can't edit this video",
	scheduled: "Visibility of a scheduled video follows its schedule",
	too_many_tags: `A video can have at most ${MAX_TAGS} tags`,
	title_empty: "The title can't be empty",
	title_too_long: "The title is too long",
	description_too_long: "The description is too long",
	playlist_other_channel: "The playlist belongs to another channel",
	playlist_full: "The playlist is full",
	changed_since: "Changed since the edit; newer values kept",
	nothing_to_undo: "Nothing to undo (expired or not edited)",
	failed: "Update failed",
} as const;
type FailureCode = keyof typeof MESSAGES;

const tag = z.string().trim().min(1).max(MAX_TAG_LENGTH);
const textEdit = z.object({ mode: z.enum(['append', 'prepend', 'replace']), text: z.string().max(5000) });
const languageText = <T extends z.ZodTypeAny>(value: T) => z.object({ en: value.optional(), ar: value.optional() });

const Changes = z.object({
	isPublic: z.boolean().optional(),
	category: z.nativeEnum(VideoCategory).nullable().optional(),
	addTags: z.array(tag).max(MAX_TAGS).optional(),
	removeTags: z.array(tag).max(MAX_TAGS).optional(),
	replaceTags: z.array(tag).max(MAX_TAGS).optional().describe("The whole tag list (not with addTags/removeTags)"),
	language: z.enum(['en', 'ar', 'ur', 'fr']).optional(),
	commentSettings: z.enum(['on', 'held', 'off']).optional(),
	description: languageText(textEdit).optional().describe("Per language: append, prepend or replace"),
	addPlaylists: z.array(Str()).max(MAX_BULK_PLAYLISTS).optional(),
	removePlaylists: z.array(Str()).max(MAX_BULK_PLAYLISTS).optional(),
});

const Result = z.object({
	videoId: Str(),
	success: Bool(),
	changed: Bool().optional(),
	/** Already applied by an earlier request with this operation id */
	replayed: Bool().optional(),
	code: Str().optional(),
	error: Str().optional(),
});

const ResultsResponse = {
	"200": {
		description: "Per-video results",
		content: {
			"application/json": {
				schema: z.object({
					success: Bool(),
					operationId: Str().optional(),
					results: z.array(Result),
					summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number() }),
				}),
			},
		},
	},
	"400": { description: "No change requested, or invalid input", content: { "application/json": { schema: ResponseError } } },
	"403": { description: "A playlist the caller can't manage", content: { "application/json": { schema: ResponseError } } },
};

type Outcome = z.infer<typeof Result>;
const fail = (videoId: string, code: FailureCode): Outcome => ({ videoId, success: false, code, error: MESSAGES[code] });

function summarize(results: Outcome[], operationId?: string) {
	const succeeded = results.filter((r) => r.success).length;
	return { success: true, ...(operationId ? { operationId } : {}), results, summary: { total: results.length, succeeded, failed: results.length - succeeded } };
}

/**
 * Whether the caller may edit a video: its owner, or a role on its channel
 * that grants `video.edit` (lib/channelAccess.ts). Roles are read once per
 * channel per request.
 */
function editChecker(env: AppContext['env'], userId: string) {
	const roles = new Map<string, Promise<ChannelRole | null>>();
	return async (video: Pick<VideoType, 'userId' | 'channelId'>): Promise<boolean> => {
		if (video.userId && video.userId === userId) return true;
		if (!video.channelId) return false;
		let role = roles.get(video.channelId);
		if (!role) {
			role = roleOnChannel(env as never, video.channelId, userId).catch((error) => {
				logger.warn('[VideoBulkUpdate] Channel read failed; access refused', { channelId: video.channelId, error: error instanceof Error ? error.message : String(error) });
				return null;
			});
			roles.set(video.channelId, role);
		}
		return can(await role, 'video.edit');
	};
}

/**
 * PATCH /api/videos/bulk (also POST /api/videos/bulk-update): edit many
 * videos at once.
 *
 * - `changes` apply to every video; `perVideo` carries values that differ
 *   (titles from the rename preview). Only named fields change.
 * - Each video is authorized on its own (`video.edit` on its channel) and
 *   written with a conditional write on the fresh copy; results are per
 *   video, so a few failures never stop the rest.
 * - `operationId` (sent with every batch of one edit) makes retries safe and
 *   records each video's previous values for POST /api/videos/bulk/undo
 *   (24 hours).
 * - Afterwards each changed video goes through the same follow-ups as a
 *   single edit: VideoEdit event (search and ownership indexes, caches),
 *   moderation re-scan of changed text, Bunny title, publish announcement.
 */
export class VideoBulkUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Edit metadata of multiple videos",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							ids: z.array(Str()).min(1).max(MAX_BULK_VIDEOS).optional(),
							/** Older clients (POST /bulk-update) */
							videoIds: z.array(Str()).min(1).max(MAX_BULK_VIDEOS).optional(),
							operationId: z.string().regex(OPERATION_ID).optional(),
							changes: Changes.default({}),
							perVideo: z.record(z.object({ title: languageText(z.string().max(1000)).optional() })).optional(),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: ResultsResponse,
	};

	async handle(c: AppContext) {
		const { body, headers } = await this.getValidatedData<typeof this.schema>();
		const changes = body.changes as BulkVideoChanges;
		const perVideo = (body.perVideo ?? {}) as Record<string, PerVideoChanges>;
		const videoIds = Array.from(new Set(body.ids ?? body.videoIds ?? []));
		const operationId = body.operationId;
		if (videoIds.length === 0) return c.json({ success: false, error: "No videos given" }, 400);
		if (videoIds.length > MAX_BULK_VIDEOS) return c.json({ success: false, error: `At most ${MAX_BULK_VIDEOS} videos per request` }, 400);
		if (isEmptyChange(changes, perVideo)) return c.json({ success: false, error: "No change requested" }, 400);
		if (changes.replaceTags !== undefined && (changes.addTags?.length || changes.removeTags?.length)) {
			return c.json({ success: false, error: "replaceTags can't be combined with addTags or removeTags" }, 400);
		}

		const userId = this.getUserId(c);
		const env = c.env;
		const repository = new R2Repository<VideoType>(env.videos);
		const queue = new Queue(env.queue);
		const kv = env.TUS_SESSIONS as unknown as UndoKv | undefined;
		const now = new Date().toISOString();
		const mayEdit = editChecker(env, userId);

		// Playlists are checked once for the whole request
		const playlistIds = Array.from(new Set([...(changes.addPlaylists ?? []), ...(changes.removePlaylists ?? [])]));
		const playlistRepo = new R2Repository<PlaylistType>(env.playlists);
		const playlists = new Map<string, PlaylistType>();
		for (const id of playlistIds) {
			const playlist = await playlistRepo.getObject(id);
			if (!playlist || (playlist as { isDeleted?: boolean }).isDeleted) return c.json({ success: false, code: 'playlist_not_found', error: "Playlist not found" }, 400);
			if (!(await canManagePlaylist(env as never, { ...playlist, id }, userId))) {
				return c.json({ success: false, code: 'playlist_forbidden', error: "Forbidden - you can't manage this playlist" }, 403);
			}
			playlists.set(id, playlist);
		}

		// 1. Fields, per video
		type Done = { videoId: string; video: VideoType; record: BulkUndoRecord; previous: VideoType | null };
		const done: Done[] = [];
		const results = new Map<string, Outcome>();
		await Promise.all(videoIds.map(async (videoId) => {
			try {
				if (operationId && (await readUndo(kv, userId, operationId, videoId))) {
					results.set(videoId, { videoId, success: true, changed: false, replayed: true });
					return;
				}
				const current = await repository.getObject(videoId);
				if (!current || current.isDeleted) return void results.set(videoId, fail(videoId, 'not_found'));
				if (!(await mayEdit(current))) return void results.set(videoId, fail(videoId, 'forbidden'));
				for (const id of changes.addPlaylists ?? []) {
					if (playlists.get(id)?.channelId !== current.channelId) return void results.set(videoId, fail(videoId, 'playlist_other_channel'));
				}

				let error: BulkEditError | null = null;
				let previous: VideoType | null = null;
				let record: BulkUndoRecord | null = null;
				const { data: video, rejected } = await repository.updateObjectOrReject<FailureCode>(videoId, (fresh) => {
					error = null;
					record = null;
					// The owner checked above must still own it
					if (fresh.userId !== current.userId || fresh.channelId !== current.channelId) return { reject: 'forbidden' };
					const applied = applyBulkChanges(fresh, changes, now, perVideo[videoId]);
					// 'in' narrows the union (this package compiles without strictNullChecks)
					if ('error' in applied) {
						error = applied.error;
						return { reject: applied.error };
					}
					record = { at: now, before: pickFields(fresh, applied.fields), after: pickFields(applied.video, applied.fields), playlistsAdded: [], playlistsRemoved: [] };
					if (!applied.changed) return false;
					previous = { ...fresh };
					Object.assign(fresh, applied.video);
					return true;
				});
				if (!video) return void results.set(videoId, fail(videoId, 'not_found'));
				if (rejected || error) return void results.set(videoId, fail(videoId, (rejected ?? error) as FailureCode));
				done.push({ videoId, video, record: record!, previous });
				results.set(videoId, { videoId, success: true, changed: previous !== null });
			} catch (err) {
				logger.error('[VideoBulkUpdate] Video update failed', { videoId, error: err instanceof Error ? err.message : String(err) });
				results.set(videoId, fail(videoId, 'failed'));
			}
		}));

		// 2. Playlists, one write per playlist for every video that passed
		const doneById = new Map(done.map((d) => [d.videoId, d]));
		for (const [playlistId, playlist] of playlists) {
			const adding = (changes.addPlaylists ?? []).includes(playlistId);
			// In the order the request listed them (the rename order): adds append in it
			const ids = done.filter((d) => !adding || d.video.channelId === playlist.channelId).map((d) => d.videoId)
				.sort((x, y) => videoIds.indexOf(x) - videoIds.indexOf(y));
			if (ids.length === 0) continue;
			const before = new Set(playlist.videos ?? []);
			try {
				if (adding) {
					await addVideosNow(env as never, playlistId, playlist.channelId as string, ids);
					const after = new Set((await playlistRepo.getObject(playlistId))?.videos ?? []);
					for (const id of ids) {
						const entry = doneById.get(id)!;
						if (!after.has(id)) {
							results.set(id, fail(id, 'playlist_full'));
							continue;
						}
						if (!before.has(id)) {
							entry.record.playlistsAdded.push(playlistId);
							results.set(id, { ...results.get(id)!, changed: true });
						}
					}
				} else {
					const removing = ids.filter((id) => before.has(id));
					if (removing.length === 0) continue;
					await removeVideos(env as never, playlistId, removing);
					for (const id of removing) {
						doneById.get(id)!.record.playlistsRemoved.push(playlistId);
						results.set(id, { ...results.get(id)!, changed: true });
					}
				}
			} catch (err) {
				logger.error('[VideoBulkUpdate] Playlist update failed', { playlistId, adding, error: err instanceof Error ? err.message : String(err) });
				for (const id of ids) results.set(id, fail(id, 'failed'));
			}
		}

		// 3. Undo records and the same follow-ups as a single edit
		await Promise.all(done.map(async ({ videoId, video, record, previous }) => {
			const changed = previous !== null || record.playlistsAdded.length > 0 || record.playlistsRemoved.length > 0;
			if (operationId && changed) {
				try {
					await writeUndo(kv, userId, operationId, videoId, record);
				} catch (err) {
					logger.warn('[VideoBulkUpdate] Undo record not saved', { videoId, error: err instanceof Error ? err.message : String(err) });
				}
			}
			if (!changed) return;
			await this.followUps(c, { videoId, video, previous, userId, channelId: headers.channelId ?? video.channelId, changes, now });
		}));

		const ordered = videoIds.map((id) => results.get(id) ?? fail(id, 'failed'));
		const response = summarize(ordered, operationId);
		logger.info('[VideoBulkUpdate] Bulk edit', { userId, operationId, total: videoIds.length, succeeded: response.summary.succeeded, fields: Object.keys(changes), titles: Object.keys(perVideo).length });
		return response;
	}

	/** What a single edit (VideoUpdate) does after its write. */
	private async followUps(
		c: AppContext,
		{ videoId, video, previous, userId, channelId, changes, now }: { videoId: string; video: VideoType; previous: VideoType | null; userId: string; channelId?: string | null; changes: BulkVideoChanges; now: string },
	) {
		try {
			await new Queue(c.env.queue).send(MessageType.VideoEdit, { videoId, userId, channelId, timestamp: now });
		} catch (err) {
			logger.error('[VideoBulkUpdate] VideoEdit event not sent', { videoId, error: err instanceof Error ? err.message : String(err) });
		}
		if (!previous) return;
		if (previous.isPublic === false && video.isPublic !== false) {
			inBackground(c, 'video-published', () => announceNewVideo(c.env, { ...video, id: videoId }));
		}
		if (changes.category !== undefined) recordOwnerCategory(c, videoId, changes.category ?? null, userId);
		const textChanged = videoScanText(video) !== videoScanText(previous);
		if (textChanged) {
			scanInBackground(c, { surface: 'video_metadata', event: 'edit', subjectId: videoId, authorId: userId, channelId, text: videoScanText(video) });
			const personChose = !!video.category && video.categorySource !== 'ai';
			if (!personChose) requestVideoSuggestion(c, { videoId, userId, channelId: video.channelId, reason: 'edit' });
		}
		if (video.title && video.title !== previous.title) {
			inBackground(c, 'bulk-bunny-title', async () => {
				const key = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
				const libraryId = parseInt(await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id'));
				await new stream(key).forEnv(c.env).updateVideo(libraryId, videoId, { title: video.title });
			});
		}
	}
}

/**
 * POST /api/videos/bulk/undo: puts back what one bulk edit changed, video
 * by video, within 24 hours. A field someone changed since keeps its newer
 * value (reported as `changed_since`); playlist adds and removes are
 * reverted.
 */
export class VideoBulkUndo extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Undo a bulk edit",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							operationId: z.string().regex(OPERATION_ID),
							ids: z.array(Str()).min(1).max(MAX_BULK_VIDEOS),
						}),
					},
				},
			},
		},
		responses: ResultsResponse,
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const env = c.env;
		const kv = env.TUS_SESSIONS as unknown as UndoKv | undefined;
		const repository = new R2Repository<VideoType>(env.videos);
		const playlistRepo = new R2Repository<PlaylistType>(env.playlists);
		const mayEdit = editChecker(env, userId);
		const now = new Date().toISOString();
		const ids = Array.from(new Set(body.ids));

		const records = new Map<string, BulkUndoRecord>();
		const results = new Map<string, Outcome>();
		await Promise.all(ids.map(async (videoId) => {
			try {
				const record = await readUndo(kv, userId, body.operationId, videoId);
				// Unchanged by the edit, or the record expired: nothing to put back (not a failure)
				if (!record) return void results.set(videoId, { videoId, success: true, changed: false, code: 'nothing_to_undo', error: MESSAGES.nothing_to_undo });
				if (record.undoneAt) return void results.set(videoId, { videoId, success: true, changed: false, replayed: true });
				const current = await repository.getObject(videoId);
				if (!current || current.isDeleted) return void results.set(videoId, fail(videoId, 'not_found'));
				if (!(await mayEdit(current))) return void results.set(videoId, fail(videoId, 'forbidden'));

				let kept: string[] = [];
				let restoredAny = false;
				let previous: VideoType | null = null;
				const { data: video } = await repository.updateObjectOrReject<never>(videoId, (fresh) => {
					const reverted = revertFields(fresh, record.before, record.after, now);
					kept = reverted.kept;
					restoredAny = reverted.restored.length > 0;
					if (!restoredAny) return false;
					previous = { ...fresh };
					for (const key of Object.keys(fresh)) {
						if (!(key in reverted.video)) delete (fresh as Record<string, unknown>)[key];
					}
					Object.assign(fresh, reverted.video);
					return true;
				});
				if (!video) return void results.set(videoId, fail(videoId, 'not_found'));
				records.set(videoId, record);
				await writeUndo(kv, userId, body.operationId, videoId, { ...record, undoneAt: now });
				if (restoredAny) {
					await new Queue(env.queue).send(MessageType.VideoEdit, { videoId, userId, channelId: video.channelId, timestamp: now });
					if (previous && video.title !== (previous as VideoType).title) {
						scanInBackground(c, { surface: 'video_metadata', event: 'edit', subjectId: videoId, authorId: userId, channelId: video.channelId, text: videoScanText(video) });
					}
				}
				results.set(videoId, kept.length > 0
					? { videoId, success: true, changed: restoredAny, code: 'changed_since', error: MESSAGES.changed_since }
					: { videoId, success: true, changed: restoredAny || record.playlistsAdded.length + record.playlistsRemoved.length > 0 });
			} catch (err) {
				logger.error('[VideoBulkUndo] Undo failed', { videoId, error: err instanceof Error ? err.message : String(err) });
				results.set(videoId, fail(videoId, 'failed'));
			}
		}));

		// Playlists: take out what the edit added, put back what it removed
		const byPlaylist = new Map<string, { add: string[]; remove: string[] }>();
		for (const [videoId, record] of records) {
			for (const id of record.playlistsAdded) (byPlaylist.get(id) ?? byPlaylist.set(id, { add: [], remove: [] }).get(id)!).remove.push(videoId);
			for (const id of record.playlistsRemoved) (byPlaylist.get(id) ?? byPlaylist.set(id, { add: [], remove: [] }).get(id)!).add.push(videoId);
		}
		for (const [playlistId, { add, remove }] of byPlaylist) {
			try {
				const playlist = await playlistRepo.getObject(playlistId);
				if (!playlist || !(await canManagePlaylist(env as never, { ...playlist, id: playlistId }, userId))) continue;
				if (remove.length) await removeVideos(env as never, playlistId, remove);
				if (add.length) await addVideosNow(env as never, playlistId, playlist.channelId as string, add);
			} catch (err) {
				logger.error('[VideoBulkUndo] Playlist undo failed', { playlistId, error: err instanceof Error ? err.message : String(err) });
				for (const id of [...add, ...remove]) results.set(id, fail(id, 'failed'));
			}
		}

		const response = summarize(ids.map((id) => results.get(id) ?? fail(id, 'failed')), body.operationId);
		logger.info('[VideoBulkUndo] Bulk undo', { userId, operationId: body.operationId, total: ids.length, succeeded: response.summary.succeeded });
		return response;
	}
}
