import { OpenAPIRoute, Str } from "chanfana";
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { ResponseError } from "../../lib/types";
import { requireSecret } from "../../lib/env-helpers";
import { generateTUSConfig } from "../../lib/bunny/tus";
import { logger } from '../../lib/logger';
import * as tus from 'tus-js-client';

/**
 * Stream video upload to Bunny.net using TUS protocol
 *
 * This endpoint acts as a proxy:
 * 1. Client uploads video to this endpoint
 * 2. This endpoint streams it to Bunny.net using TUS
 * 3. Client never sees Bunny.net URL (security)
 */
export class UploadStreamEndpoint extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Stream Video Upload (Hidden TUS Proxy)",
		description: "🔒 **Authentication Required**: Upload video via streaming proxy. Client uploads to API, API streams to Bunny.net using TUS protocol. Bunny.net is completely hidden from client.",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				'content-type': Str({ description: "Must be multipart/form-data" }),
				'content-length': Str({ description: "File size in bytes" }),
			}),
			body: {
				content: {
					"multipart/form-data": {
						schema: z.object({
							videoId: z.string().describe("Video ID from initiate endpoint"),
							file: z.any().describe("Video file binary data"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Upload completed successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								videoId: z.string(),
								message: z.string(),
								uploadedBytes: z.number(),
							}),
						}),
					},
				},
			},
			"401": {
				description: "Unauthorized - authentication required",
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
		// Get auth context
		const userId = this.getUserId(c);


		try {
			// Parse multipart form data
			const formData = await c.req.formData();
			const videoId = formData.get('videoId') as string;
			const file = formData.get('file') as File;

			if (!videoId || !file) {
				return c.json({
					success: false,
					error: "Missing videoId or file"
				}, 400);
			}

			logger.info('[UploadStream] Starting upload', {
				videoId,
				fileName: file.name,
				fileSize: file.size,
				fileType: file.type,
			});

			// Get Bunny.net credentials
			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			// Generate TUS config for server-side upload
			const tusConfig = await generateTUSConfig(
				libraryId,
				bunnyKey,
				videoId,
				1 // 1 hour expiration
			);

			logger.info('[UploadStream] TUS config generated', {
				videoId,
				endpoint: tusConfig.tusEndpoint,
				chunkSize: tusConfig.chunkSize,
			});

			// Create TUS upload instance
			return new Promise((resolve, reject) => {
				const upload = new tus.Upload(file, {
					endpoint: tusConfig.tusEndpoint,
					headers: tusConfig.tusHeaders,
					chunkSize: tusConfig.chunkSize,
					retryDelays: [0, 3000, 5000, 10000, 20000],
					metadata: {
						filename: file.name,
						filetype: file.type,
					},

					onError: (error) => {
						logger.error('[UploadStream] Upload failed', {
							videoId,
							error: error.message,
							stack: error.stack,
						});
						resolve(c.json({
							success: false,
							error: "Upload failed",
							details: error.message,
						}, 500));
					},

					onProgress: (bytesUploaded, bytesTotal) => {
						const percent = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
						logger.info('[UploadStream] Progress', {
							videoId,
							bytesUploaded,
							bytesTotal,
							percent: `${percent}%`,
						});
					},

					onSuccess: () => {
						logger.info('[UploadStream] Upload completed', {
							videoId,
							fileSize: file.size,
						});
						resolve(c.json({
							success: true,
							result: {
								videoId,
								message: 'Upload completed successfully',
								uploadedBytes: file.size,
							},
						}));
					},
				});

				// Start upload
				logger.info('[UploadStream] Starting TUS upload', { videoId });
				upload.start();
			});

		} catch (error) {
			logger.error("Upload stream error:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			const errorMessage = error instanceof Error ? error.message : String(error);
			return c.json({
				success: false,
				error: "Failed to upload video",
				details: errorMessage,
			}, 500);
		}
	}
}
