import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { addAuthToSchema } from "../../lib/openapi-auth";
import R2Repository from "../../lib/r2Repo";
import { generateTUSConfig } from "../../lib/bunny/tus";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';

/**
 * Upload Resume Endpoint
 *
 * Allows users to resume an interrupted TUS upload by generating a new
 * authorization signature for the existing video. This endpoint is useful
 * when an upload was interrupted due to network issues, browser crash,
 * or expired authorization.
 */
export class UploadResumeEndpoint extends OpenAPIRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Resume Video Upload",
		description: "Generate new TUS authorization to resume an interrupted video upload. The video must have been previously initiated and owned by the authenticated user.",
		request: {
			headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
				videoId: Str({ description: "Video ID to resume upload for" }),
			}),
		},
		responses: {
			"200": {
				description: "Resume configuration generated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								videoId: z.string().describe("Video GUID for upload"),
								tusEndpoint: z.string().describe("TUS upload endpoint"),
								tusHeaders: z.object({
									AuthorizationSignature: z.string().describe("TUS authorization signature"),
									AuthorizationExpire: z.string().describe("Unix timestamp when signature expires"),
									LibraryId: z.string().describe("Bunny.net Stream library ID"),
									VideoId: z.string().describe("Video GUID"),
								}).describe("Headers required for TUS upload"),
								expiresAt: z.string().describe("ISO 8601 datetime when authorization expires"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
								videoMetadata: z.object({
									title: z.string().describe("Video title"),
									uploadStatus: z.string().describe("Current upload status"),
									fileSize: z.number().optional().describe("Expected file size in bytes"),
									mimeType: z.string().optional().describe("MIME type of the video"),
								}).describe("Video metadata"),
							}),
						}),
					},
				},
			},
			"403": {
				description: "Forbidden - user doesn't own this video",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "Video not found",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"409": {
				description: "Conflict - video upload already completed",
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
	}, 'required');

	async handle(c) {
		// Get auth context
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;

		if (!userId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();
			const videoId = request.params.videoId;

			// Get video from storage
			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const video = await repository.getObject(videoId);

			if (!video) {
				return c.json({
					success: false,
					error: "Video not found. Please initiate a new upload.",
				}, 404);
			}

			// Check ownership
			if (video.userId !== userId) {
				return c.json({
					success: false,
					error: "Forbidden - you can only resume uploads for your own videos",
				}, 403);
			}

			// Check upload status - only allow resume for 'uploading' or 'initiated' status
			const uploadStatus = video.uploadStatus || 'initiated';
			if (uploadStatus === 'ready' || uploadStatus === 'processing') {
				return c.json({
					success: false,
					error: `Cannot resume upload - video status is '${uploadStatus}'. Upload has already been completed.`,
				}, 409);
			}

			if (uploadStatus === 'failed') {
				return c.json({
					success: false,
					error: "Cannot resume failed upload. Please initiate a new upload.",
				}, 409);
			}

			if (uploadStatus !== 'uploading' && uploadStatus !== 'initiated') {
				return c.json({
					success: false,
					error: `Cannot resume upload - video status is '${uploadStatus}'. Only 'uploading' or 'initiated' videos can be resumed.`,
				}, 409);
			}

			// Get Bunny.net configuration
			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({
					success: false,
					error: "Bunny Stream library ID is invalid"
				}, 500);
			}

			// Generate new TUS configuration for resuming upload
			const tusConfig = await generateTUSConfig(
				libraryId,
				bunnyKey,
				videoId,
				1 // 1 hour expiration
			);

			// Update video metadata to reflect resume attempt
			const updatedVideo = {
				...video,
				dateModified: new Date().toISOString(),
				lastResumeAt: new Date().toISOString(),
			};
			await repository.putObject(videoId, updatedVideo);

			// Return TUS configuration for resuming upload
			return c.json({
				success: true,
				result: {
					videoId,
					tusEndpoint: tusConfig.tusEndpoint,
					tusHeaders: tusConfig.tusHeaders,
					expiresAt: tusConfig.expiresAt,
					chunkSize: tusConfig.chunkSize,
					resumable: tusConfig.resumable,
					videoMetadata: {
						title: video.title,
						uploadStatus: uploadStatus,
						fileSize: video.fileSize,
						mimeType: video.originalFormat,
					},
				},
			});

		} catch (error) {
			logger.error("Upload resume error:", error);
			return c.json({
				success: false,
				error: "Failed to generate resume configuration"
			}, 500);
		}
	}
}