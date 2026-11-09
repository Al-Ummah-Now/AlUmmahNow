/**
 * Upload a custom thumbnail for a video (owner only).
 *
 * POST /api/videos/:id/thumbnail  (multipart/form-data, field "thumbnail")
 *
 * The image is stored in the same Bunny.net image storage zone used for
 * profile/channel avatars and covers, and the video's thumbnailUrl is updated.
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from '../../base';
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { patchVideo } from '../../lib/videoWrites';
import BunnyStorageClient from "../../lib/bunny/storage";
import { validateImageBuffer, detectMimeType } from "../../lib/thumbnail/validator";
import { thumbnailProcessor } from "../../lib/thumbnail/processor";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";
import { addAuthToSchema } from "../../lib/openapi-auth";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

const IMAGE_CDN_BASE_URL = 'https://images.alummahnow.net';

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
};

export class VideoThumbnailUpload extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Upload a custom video thumbnail",
		description: "🔒 **Authentication Required**: Upload a JPEG/PNG/WebP image (max 2MB, min 320x180) as the video's thumbnail. Only the video owner can do this. Send multipart/form-data with the image in the `thumbnail` field.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Thumbnail uploaded and set on the video",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								thumbnailUrl: z.string(),
								thumbnailSizes: z.record(z.string()),
							}),
						}),
					},
				},
			},
			"400": { description: "Invalid image", content: { "application/json": { schema: ResponseError } } },
			"401": { description: "Unauthorized", content: { "application/json": { schema: ResponseError } } },
			"403": { description: "Not the video owner", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
			"500": { description: "Internal server error", content: { "application/json": { schema: ResponseError } } },
		},
	}, 'required');

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;

		try {
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(c.env.videos);
			const video = await repository.getObject(id);

			if (!video || video.isDeleted) {
				return c.json({ success: false, error: "Video not found" }, 404);
			}

			if (video.userId !== userId) {
				return c.json({ success: false, error: "Forbidden - you can only update your own videos" }, 403);
			}

			// chanfana only parses JSON bodies, so read the multipart form here
			const form = await c.req.parseBody();
			const file = form["thumbnail"] ?? form["file"];
			if (!file || typeof file === 'string') {
				return c.json({ success: false, error: "No image uploaded (expected multipart field 'thumbnail')" }, 400);
			}

			const buffer = await file.arrayBuffer();
			const validation = await validateImageBuffer(buffer, file.name);
			if (!validation.valid) {
				return c.json({ success: false, error: validation.error || "Invalid image" }, 400);
			}

			// Use the sniffed type (magic bytes), not the client-declared one
			const mimeType = detectMimeType(new Uint8Array(buffer)) || 'image/jpeg';
			const extension = EXTENSIONS[mimeType] || 'jpg';

			// Unique path per upload so CDN caches never serve a stale image
			const path = `/thumbnails/${id}/${crypto.randomUUID()}.${extension}`;

			const storageKey = await requireSecret(c.env.image_storage_key, 'image_storage_key');
			const zone = requireEnvVar(c.env, 'ZONE');
			const storage = new BunnyStorageClient(zone, storageKey);

			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(buffer));
					controller.close();
				},
			});

			const uploaded = await storage.putFile(path, stream);
			if (!uploaded) {
				logger.error('[VideoThumbnailUpload] Bunny storage upload failed', { videoId: id, path });
				return c.json({ success: false, error: "Failed to store thumbnail" }, 500);
			}

			const baseUrl = `${IMAGE_CDN_BASE_URL}${path}`;
			const thumbnailSizes = thumbnailProcessor.generateBunnyUrls(baseUrl);
			const thumbnailUrl = thumbnailSizes.hd || baseUrl;

			// Conditional write on the fresh video (SCALABILITY-AUDIT AV-3)
			const saved = await patchVideo(repository, id, (fresh) => fresh.isDeleted ? false : {
				thumbnailUrl,
				thumbnailType: 'custom' as const,
				thumbnailSizes,
				dateModified: new Date().toISOString(),
			}, { ownerId: userId });
			if (saved.status === 'forbidden') {
				return c.json({ success: false, error: "Forbidden - you can only update your own videos" }, 403);
			}
			if (saved.status === 'missing' || !saved.changed) {
				return c.json({ success: false, error: "Video not found" }, 404);
			}

			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.VideoEdit, {
				videoId: id,
				userId,
				channelId: video.channelId,
				timestamp: new Date().toISOString(),
				action: 'thumbnail_upload',
			});

			logger.info('[VideoThumbnailUpload] Thumbnail updated', {
				videoId: id,
				userId,
				thumbnailUrl,
				warnings: validation.warnings,
			});

			return c.json({
				success: true,
				result: { thumbnailUrl, thumbnailSizes },
			});
		} catch (error) {
			logger.error('[VideoThumbnailUpload] Failed', {
				videoId: id,
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
			return c.json({ success: false, error: "Failed to upload thumbnail" }, 500);
		}
	}
}
