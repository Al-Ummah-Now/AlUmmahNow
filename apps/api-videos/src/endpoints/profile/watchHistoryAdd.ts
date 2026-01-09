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
			headers: z.object({
        }),
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
		let profile = await repository.getObject(userId);

		// Create profile if it doesn't exist
		if (!profile) {
			const auth = c.get('auth');
			profile = {
				id: userId,
				email: auth?.email || "unknown",
				dateCreated: new Date().toISOString(),
				dateModified: new Date().toISOString(),
				watchHistory: [],
			} as ProfileType;
		}

		// Initialize watch history if it doesn't exist
		if (!profile.watchHistory) {
			profile.watchHistory = [];
		}

		// Create watch history entry
		const historyEntry = {
			videoId,
			videoTitle: undefined, // Could be fetched from video data
			watchTime,
			totalDuration,
			watchedAt: new Date().toISOString(),
			completed: completed || false,
		};

		// Remove any existing entry for this video (to update position in history)
		profile.watchHistory = profile.watchHistory.filter((entry: any) => entry.videoId !== videoId);

		// Add new entry at the beginning (most recent first)
		profile.watchHistory.unshift(historyEntry);

		// Limit watch history to last 1000 entries
		if (profile.watchHistory.length > 1000) {
			profile.watchHistory = profile.watchHistory.slice(0, 1000);
		}

		// Update profile
		profile.dateModified = new Date().toISOString();
		await repository.putObject(userId, profile);

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