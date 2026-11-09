import { Str } from "chanfana";
import { z } from "zod";
import type { VideoObject } from "@al-ummah/shared-types";
import { AuthenticatedRoute, AppContext } from "../../base";
import { MAX_BULK_VIDEOS } from "../../lib/bulkEdit";
import { logger } from "../../lib/logger";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { announceSchedule, applySchedule, scheduleDateProblem, scheduleRefusal } from "../../lib/videoSchedule";
import { canOnVideo } from "../../lib/channelAccess";

/** At most a week between two videos. */
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

const videoIds = z.array(Str()).min(1).max(MAX_BULK_VIDEOS);

const Results = z.object({
	success: z.boolean(),
	results: z.array(z.object({ videoId: z.string(), success: z.boolean(), error: z.string().optional() })),
	summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number() }),
});

type Result = { videoId: string; success: boolean; error?: string };

function summarize(results: Result[]) {
	const succeeded = results.filter((r) => r.success).length;
	return { success: true, results, summary: { total: results.length, succeeded, failed: results.length - succeeded } };
}

/** POST /api/videos/bulk-schedule: schedules videos one after another. Each is checked on its own. */
export class VideoBulkSchedule extends AuthenticatedRoute {
	schema = {
		tags: ["Videos - Scheduling"],
		summary: "Schedule several videos",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videoIds,
							startAt: z.string().describe("When the first video publishes (ISO 8601)"),
							intervalMinutes: z.number().int().min(0).max(MAX_INTERVAL_MINUTES).optional().default(0),
							timezone: z.string().min(1).max(64),
						}),
					},
				},
			},
		},
		responses: {
			"200": { description: "Result per video", content: { "application/json": { schema: Results } } },
			"400": { description: "Invalid input", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const ids = Array.from(new Set(body.videoIds));
		const userId = this.getUserId(c) as string;
		const repository = new R2Repository<VideoObject>(c.env.videos);
		const now = new Date();
		const start = new Date(body.startAt).getTime();
		const interval = (body.intervalMinutes ?? 0) * 60 * 1000;

		const results = await Promise.all(ids.map(async (videoId, index): Promise<Result> => {
			try {
				const date = new Date(start + index * interval);
				const problem = scheduleDateProblem(date, now);
				if (problem) return { videoId, success: false, error: `Invalid time: ${problem}` };
				// The owner, or a channel member allowed to schedule; checked again on the fresh copy
				const current = await repository.getObject(videoId);
				if (!current) return { videoId, success: false, error: "Video not found" };
				if (!(await canOnVideo(c.env as never, current, userId, "video.schedule"))) return { videoId, success: false, error: "Forbidden" };
				const { data: video, rejected } = await repository.updateObjectOrReject<string>(videoId, (fresh) => {
					if (fresh.userId !== current.userId) return { reject: "Forbidden" };
					const refusal = scheduleRefusal(fresh);
					if (refusal) return { reject: refusal };
					applySchedule(fresh, { date, timezone: body.timezone, userId, now });
					return true;
				});
				if (!video) return { videoId, success: false, error: "Video not found" };
				if (rejected) return { videoId, success: false, error: rejected };
				await announceSchedule(c.env as never, { ...video, id: videoId }, { date, timezone: body.timezone, notifyOnPublish: true, userId });
				return { videoId, success: true };
			} catch (error) {
				logger.error("[VideoBulkSchedule] Failed", { videoId, error: error instanceof Error ? error.message : String(error) });
				return { videoId, success: false, error: "Schedule failed" };
			}
		}));
		return summarize(results);
	}
}

/** POST /api/videos/bulk-playlist: adds videos to one of the caller's playlists. */
export class VideoBulkPlaylist extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Add several videos to a playlist",
		request: {
			body: { content: { "application/json": { schema: z.object({ playlistId: Str(), videoIds }) } } },
		},
		responses: {
			"200": { description: "Result per video", content: { "application/json": { schema: Results } } },
			"400": { description: "Invalid input", content: { "application/json": { schema: ResponseError } } },
			"403": { description: "Not your playlist", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Playlist not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c) as string;
		type PlaylistType = z.infer<typeof BusinessPlaylist>;
		const playlists = new R2Repository<PlaylistType>(c.env.playlists);
		const playlist = await playlists.getObject(body.playlistId);
		if (!playlist) return c.json({ success: false, error: "Playlist not found" }, 404);
		if (playlist.userId !== userId) return c.json({ success: false, error: "Forbidden" }, 403);

		const repository = new R2Repository<VideoObject>(c.env.videos);
		const ids = Array.from(new Set(body.videoIds));
		const checks = await Promise.all(ids.map((id) => repository.getObject(id)));
		const present = new Set(playlist.videos);
		const added: string[] = [];
		const results = ids.map((videoId, index): Result => {
			const video = checks[index];
			if (!video) return { videoId, success: false, error: "Video not found" };
			if (video.userId !== userId) return { videoId, success: false, error: "Forbidden" };
			if (!present.has(videoId)) added.push(videoId);
			return { videoId, success: true };
		});

		if (added.length > 0) {
			await playlists.putObject(body.playlistId, { ...playlist, videos: [...playlist.videos, ...added], dateModified: new Date().toISOString() });
		}
		return summarize(results);
	}
}
