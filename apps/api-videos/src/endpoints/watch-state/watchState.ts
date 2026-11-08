/**
 * Watch-state sync & Continue watching (Epic 9.9), for native clients:
 *
 * - PUT /api/v1/watch-state/:videoId   last-writer-wins position write
 * - GET /api/v1/watch-state?since=     incremental sync
 * - GET /api/v1/continue-watching      in-progress videos, newest first
 *
 * Rules live in lib/watch-state.ts; storage is the watch history entry.
 */
import { z } from 'zod';
import type { WatchHistoryEntry, WatchHistoryEvent } from '@al-ummah/shared-types';
import { AuthenticatedRoute } from '../../base';
import type { AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { logger } from '../../lib/logger';
import { canViewVideo, type VideoType } from '../../lib/playlists';
import { isWatchHistoryPaused, queueWatchHistoryEvent, resolveVideoChannelName, withChannelNames } from '../../lib/watch-history';
import { COMPLETED_PERCENT, applyWatchState, changesSince, isContinueWatching, toWatchState } from '../../lib/watch-state';
import { listUserWatchHistory } from '../watch-history/user-entries';

const WatchStateSchema = z.object({
	videoId: z.string(),
	position: z.number().describe('Playback position, seconds'),
	duration: z.number().describe('Video duration, seconds'),
	percentageWatched: z.number().describe('0..100'),
	completed: z.boolean().describe('Watched to 95% at least once'),
	updatedAt: z.string().describe('Last-writer-wins clock: client time of the write, clamped to server time + 5 min'),
	serverUpdatedAt: z.string().describe('Server time of the last write; pass the newest as `since` for incremental sync'),
	deviceId: z.string().optional(),
});

const PutBody = z.object({
	position: z.number().min(0).describe('Playback position, seconds'),
	duration: z.number().min(0).describe('Video duration, seconds'),
	clientUpdatedAt: z.string().datetime({ offset: true }).describe('Device time of this position (ISO 8601); the newest write wins'),
	deviceId: z.string().min(1).max(128).optional(),
});

const PutResponse = z.object({
	applied: z.boolean().describe('false: a newer state was already stored; `state` is that state'),
	paused: z.boolean().describe('Watch history is paused: nothing was stored'),
	state: WatchStateSchema.nullable(),
});

export class WatchStatePut extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Watch state'],
			summary: 'Save the playback position of a video (last writer wins)',
			description:
				'🔒 Requires authentication. Stores the position for every device of the user. The write with the newest `clientUpdatedAt` wins; an older write returns `applied: false` with the stored state, so clients converge without conflicts. Creates the history entry when missing. Paused history stores nothing.',
			request: {
				params: z.object({ videoId: z.string().min(1) }),
				body: { content: { 'application/json': { schema: PutBody } } },
			},
			responses: {
				'200': { description: 'Stored, or the newer stored state', content: { 'application/json': { schema: PutResponse } } },
				'400': { description: 'Invalid body' },
				'401': { description: 'Authentication required' },
				'404': { description: 'Video not found' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const { videoId } = params;

		if (await isWatchHistoryPaused(c.env.profiles, userId)) {
			return c.json({ applied: false, paused: true, state: null });
		}

		const repo = new R2Repository<WatchHistoryEntry>(c.env.watch_history);
		const id = `${userId}:${videoId}`;
		const now = new Date();

		// A new entry needs the video's card fields (and the video must be viewable)
		let initial: WatchHistoryEntry | undefined;
		if (!(await repo.getObject(id))) {
			const video = (await new R2Repository<VideoType>(c.env.videos).getObject(videoId)) as any;
			if (!video || !canViewVideo(video, userId)) return c.json({ error: 'Video not found' }, 404);
			initial = {
				id,
				userId,
				videoId,
				videoTitle: video.title || 'Untitled',
				videoThumbnail: video.thumbnailUrl || video.thumbnail,
				videoDuration: body.duration,
				channelId: video.channelId || '',
				channelName: await resolveVideoChannelName(c.env.channels, video),
				firstWatchedAt: now.toISOString(),
				// Epoch clock: any first write wins
				lastWatchedAt: new Date(0).toISOString(),
				watchCount: 1,
				progress: 0,
				completed: false,
				percentageWatched: 0,
			};
		}

		let applied = false;
		const entry = await repo.updateObject(
			id,
			(data) => {
				applied = applyWatchState(data, body, now);
				return applied;
			},
			initial ? { initial: () => structuredClone(initial!) } : {},
		);
		if (!entry) return c.json({ error: 'Video not found' }, 404);

		if (applied) {
			const event: WatchHistoryEvent = {
				type: entry.percentageWatched >= COMPLETED_PERCENT ? 'watch_completed' : initial ? 'watch_started' : 'watch_progress',
				userId,
				videoId,
				progress: body.position,
				duration: body.duration,
				timestamp: now.toISOString(),
			};
			await queueWatchHistoryEvent(c.env.queue, event).catch((error) =>
				logger.warn('[WatchState] Failed to queue watch event', { error: String(error) }),
			);
		}
		return c.json({ applied, paused: false, state: toWatchState(entry) });
	}
}

export class WatchStateList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Watch state'],
			summary: 'Playback positions changed since a time (incremental sync)',
			description:
				'🔒 Requires authentication. Oldest change first. `since` is inclusive: pass the `serverUpdatedAt` of the last item received (or `nextSince`); a repeated item is safe to apply again.',
			request: {
				query: z.object({
					since: z.string().datetime({ offset: true }).optional().describe('Server time (ISO 8601); omit for everything'),
					limit: z.coerce.number().int().min(1).max(500).default(100),
				}),
			},
			responses: {
				'200': {
					description: 'Changed states',
					content: {
						'application/json': {
							schema: z.object({
								items: z.array(WatchStateSchema),
								hasMore: z.boolean(),
								nextSince: z.string().nullable().describe('Pass as `since` for the next page or sync'),
								serverTime: z.string(),
							}),
						},
					},
				},
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const serverTime = new Date().toISOString();
		const entries = await listUserWatchHistory(c.env.watch_history, userId);
		const { items, hasMore } = changesSince(entries, query.since, query.limit);
		const last = items[items.length - 1];
		c.header('Cache-Control', 'private, no-store');
		return c.json({
			items: items.map(toWatchState),
			hasMore,
			// Nothing new: the same cursor, so nothing written meanwhile is missed
			nextSince: last ? last.lastWatchedAt : query.since ?? null,
			serverTime,
		});
	}
}

const ContinueItem = z.object({
	videoId: z.string(),
	position: z.number(),
	duration: z.number(),
	percentageWatched: z.number(),
	lastWatchedAt: z.string(),
	video: z.object({
		id: z.string(),
		title: z.string(),
		thumbnailUrl: z.string().nullable(),
		channelId: z.string(),
		channelName: z.string(),
		duration: z.number().nullable(),
	}),
});

/** At most this many videos are read per request while skipping removed ones. */
const MAX_VIDEO_READS = 60;

export class ContinueWatchingList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Watch state'],
			summary: 'Continue watching',
			description:
				'🔒 Requires authentication. Videos the user started (≥ 5%) and has not finished (< 95%), most recently watched first. Deleted, hidden and private (not owned) videos are left out.',
			request: {
				query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
			},
			responses: {
				'200': {
					description: 'In-progress videos',
					content: { 'application/json': { schema: z.object({ items: z.array(ContinueItem) }) } },
				},
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const candidates = (await listUserWatchHistory(c.env.watch_history, userId))
			.filter(isContinueWatching)
			.sort((a, b) => Date.parse(b.lastWatchedAt) - Date.parse(a.lastWatchedAt))
			.slice(0, MAX_VIDEO_READS);

		const videos = new R2Repository<VideoType>(c.env.videos);
		const kept: Array<{ entry: WatchHistoryEntry; video: any }> = [];
		// Read in small batches until the row is full
		for (let i = 0; i < candidates.length && kept.length < query.limit; i += query.limit) {
			const batch = candidates.slice(i, i + query.limit);
			const found = await Promise.all(batch.map((e) => videos.getObject(e.videoId).catch(() => null)));
			batch.forEach((entry, j) => {
				const video = found[j] as any;
				if (video && canViewVideo(video, userId) && kept.length < query.limit) kept.push({ entry, video });
			});
		}

		const named = await withChannelNames(
			c.env.channels,
			kept.map(({ entry }) => entry),
		);
		c.header('Cache-Control', 'private, no-store');
		return c.json({
			items: kept.map(({ entry, video }, i) => ({
				videoId: entry.videoId,
				position: entry.progress,
				duration: entry.videoDuration,
				percentageWatched: entry.percentageWatched,
				lastWatchedAt: entry.lastWatchedAt,
				video: {
					id: entry.videoId,
					title: video.title || entry.videoTitle,
					thumbnailUrl: video.thumbnailUrl || video.thumbnail || entry.videoThumbnail || null,
					channelId: video.channelId || entry.channelId || '',
					channelName: named[i].channelName,
					duration: typeof video.duration === 'number' ? video.duration : entry.videoDuration || null,
				},
			})),
		});
	}
}
