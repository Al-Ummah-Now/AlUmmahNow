import { Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

// Watch history entry type
const WatchHistoryEntry = z.object({
	videoId: z.string(),
	videoTitle: z.string().optional(),
	watchTime: z.number().optional().describe("How long the user watched in seconds"),
	totalDuration: z.number().optional().describe("Total video duration in seconds"),
	watchedAt: z.string().describe("ISO timestamp when video was watched"),
	completed: z.boolean().optional().default(false).describe("Whether the video was watched to completion"),
});

export class WatchHistoryAdd extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Add Video to Watch History",
		description: "🔒 **Authentication Required**: Add a video to the user's watch history.",
		request: {
        body: {
				content: {
					"application/json": {
						schema: z.object({
							videoId: Str({ description: "ID of the video being watched" }),
							watchTime: z.number().optional().describe("How long the user watched in seconds"),
							totalDuration: z.number().optional().describe("Total video duration in seconds"),
							completed: z.boolean().optional().default(false).describe("Whether the video was watched to completion"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Video added to watch history successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								message: z.string(),
								historyLength: z.number(),
							}),
						}),
					},
				},
			},
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "User profile not found",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Get user ID from auth
		const userId = this.getUserId(c);

		const { videoId, watchTime, totalDuration, completed } = request.body;

		// Get user profile from storage
		const bucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		const auth = c.get('auth');

		// Create watch history entry
		const historyEntry = {
			videoId,
			videoTitle: undefined, // Could be fetched from video data
			watchTime,
			totalDuration,
			watchedAt: new Date().toISOString(),
			completed: completed || false,
		};

		// Conditional write on the fresh profile (SCALABILITY-AUDIT AV-6): a
		// subscribe, profile edit or "pause history" from another device at the
		// same time is not overwritten. A missing profile is created (create-only).
		const profile = await repository.updateObject(userId, (fresh) => {
			// Remove any existing entry for this video (to update position in history),
			// add the new one first (most recent first), keep the last 1000
			const history = (fresh.watchHistory || []).filter((entry: any) => entry.videoId !== videoId);
			history.unshift(historyEntry);
			fresh.watchHistory = history.slice(0, 1000);
			fresh.dateModified = new Date().toISOString();
		}, {
			initial: () => ({
				id: userId,
				email: auth?.email || "unknown",
				dateCreated: new Date().toISOString(),
				dateModified: new Date().toISOString(),
				watchHistory: [],
			} as ProfileType),
		});

		// Send analytics event
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ProfileUpdate, {
			userId: userId,
			action: "watch_history_add",
			videoId: videoId,
			watchTime: watchTime,
			completed: completed,
			timestamp: new Date().toISOString(),
		});

		return {
			success: true,
			result: {
				message: "Video added to watch history",
				historyLength: profile.watchHistory.length,
			},
		};
	}
}