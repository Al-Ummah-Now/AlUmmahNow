import { canOnVideo } from "../../lib/channelAccess";
import { OpenAPIRoute, Str } from "chanfana";
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
import { generateTUSConfig, createTusProxySession, TUS_PROXY_SESSION_TTL_SECONDS } from "../../lib/bunny/tus";
import { buildTusUploadId, type VideoTusUpload } from "./tus/tusProxy";
import { reopenForReupload, type UploadVideo } from "../../lib/uploads/lifecycle";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';

/**
 * Upload Resume Endpoint
 *
 * Re-authorises an unfinished upload of the SAME Bunny video: a new TUS proxy
 * session (send as `tusSessionId` upload metadata) and, while Bunny still
 * holds the bytes, the proxy upload id to resume at Bunny's offset. The client
 * calls it when the proxy answers 404 (session or upload gone), after a page
 * reload or browser crash, or for a bulk-queue file whose session expired.
 * Bunny credentials never reach the client.
 */
export class UploadResumeEndpoint extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Resume Video Upload",
		description: "Re-authorise an unfinished upload of the same video: returns a new TUS proxy session id and, when the earlier upload still exists at Bunny, its proxy upload id (resume at its offset). Any not-yet-finished upload of the caller can be resumed; a finished one answers 409 with completed: true.",
		request: {
			headers: z.object({
          channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
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
								tusSessionId: z.string().describe("New TUS proxy session id (send as tusSessionId upload metadata)"),
								tusUploadId: z.string().optional().describe("Proxy upload id of the earlier upload, when Bunny may still hold its bytes: resume at /api/videos/tus/<tusUploadId>"),
								tusUploadFileSize: z.number().optional().describe("Size in bytes of the earlier upload (tusUploadId); a different file must start a new upload instead of resuming it"),
								expiresAt: z.string().describe("ISO 8601 datetime when the session expires"),
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

	async handle(c: AppContext) {
		// Get auth context
		const userId = this.getUserId(c);


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
			if (!(await canOnVideo(c.env as never, video, userId, 'video.upload'))) {
				return c.json({
					success: false,
					error: "Forbidden - you can only resume uploads for your own videos",
				}, 403);
			}

			// Any upload that has not finished can be resumed; a finished one
			// tells the client so (it treats the file as uploaded).
			const uploadStatus = video.uploadStatus || 'initiated';
			if (uploadStatus === 'ready' || uploadStatus === 'processing') {
				return c.json({
					success: false,
					completed: true,
					error: `Cannot resume upload - video status is '${uploadStatus}'. Upload has already been completed.`,
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

			// New proxy session for the same video (the proxy signs every Bunny
			// request itself; this signature only fills the stored session).
			const tusConfig = await generateTUSConfig(libraryId, bunnyKey, videoId, 1);
			let tusSessionId: string;
			try {
				tusSessionId = await createTusProxySession(c.env.TUS_SESSIONS, {
					videoId,
					userId,
					channelId: video.channelId,
					tusConfig,
				});
			} catch (error) {
				logger.warn('[UploadResume] Session store unavailable', { videoId, error: error instanceof Error ? error.message : String(error) });
				c.header('Retry-After', '5');
				return c.json({ success: false, error: 'Session store unavailable, retry' }, 503);
			}

			// The earlier upload, while Bunny may still hold its bytes
			const durable = (video as VideoType & { tusUpload?: VideoTusUpload }).tusUpload;
			const tusUploadId = durable?.sessionId && durable.bunnyUploadUrl ? buildTusUploadId(durable.sessionId, videoId) : undefined;

			// Record the resume attempt; best effort, never blocks the upload
			// (conditional write on the fresh video, SCALABILITY-AUDIT AV-3)
			const resumedAt = new Date().toISOString();
			try {
				// A re-upload of a flagged video reopens it (back to uploading,
				// needs_reupload cleared); it is flagged again if this attempt fails.
				await repository.updateObject(videoId, (fresh) => {
					if (fresh.userId !== video.userId || fresh.uploadStatus === 'ready' || fresh.uploadStatus === 'processing') return false;
					reopenForReupload(fresh as UploadVideo);
					Object.assign(fresh, { dateModified: resumedAt, lastResumeAt: resumedAt });
					return true;
				});
			} catch (error) {
				logger.warn('[UploadResume] Could not record the resume attempt', { videoId, error: error instanceof Error ? error.message : String(error) });
			}

			return c.json({
				success: true,
				result: {
					videoId,
					tusSessionId,
					...(tusUploadId ? { tusUploadId, tusUploadFileSize: durable?.fileSize } : {}),
					expiresAt: new Date(Date.now() + TUS_PROXY_SESSION_TTL_SECONDS * 1000).toISOString(),
					chunkSize: tusConfig.chunkSize,
					resumable: true,
					videoMetadata: {
						title: video.title,
						uploadStatus: uploadStatus === 'failed' ? 'uploading' : uploadStatus,
						fileSize: video.fileSize,
						mimeType: video.originalFormat,
					},
				},
			});

		} catch (error) {
			rethrowBusy(error);
			logger.error("Upload resume error:", error);
			return c.json({
				success: false,
				error: "Failed to generate resume configuration"
			}, 500);
		}
	}
}
