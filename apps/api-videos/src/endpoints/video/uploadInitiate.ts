import { uploadIdentity } from "../../lib/channelAccess";
import { Str, Num } from "chanfana";
import { createUploadRecord } from '../../lib/upload/uploadRecord';
import { checkThumbnailShape, imageSize, videoSizeOf } from '../../lib/thumbnail/shape';
import { z } from "zod";
import { channelContentCounts } from "../../lib/search/ownership";
import { checkDraftAllowed } from "../../lib/studioLimits";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { Channel, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { uploadCollection } from '../../lib/channelCollection';
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";
import { fingerprintKey, initiateOnce, UploadClaimBusyError, UploadFingerprintSchema } from "../../lib/uploads/initiateOnce";
import { checkReusable, issueTusSession, reuseFields, type PlaceholderRecord } from "../../lib/uploads/placeholder";
import { patchVideo } from "../../lib/videoWrites";
import { markUploadCreated } from "../../lib/uploads/reaper";
import { thumbnailProcessor, thumbnailStorage } from "../../lib/thumbnail";
import { adoptOrRequestSuggestion } from '../../lib/categorySuggestions';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

export class UploadInitiateEndpoint extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Initiate Video Upload with TUS Support",
		description: "🔒 **Authentication Required**: Create a video record in Bunny.net Stream and get TUS configuration for resumable upload.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							title: Str({ description: "Video title" }),
							description: Str({ description: "Video description" }).optional(),
							fileSize: Num({ description: "File size in bytes", required: true }),
							mimeType: Str({ description: "MIME type of the video file", required: true }),
							isPublic: z.boolean().optional().default(true),
							isDraft: z.boolean().optional().describe("Save without publishing. A draft is always private"),
							tags: z.string().optional().describe("Comma-separated tags"),
							// The web uploader sends these; they were stripped by the schema, so the
							// Arabic title/description and the category chosen on upload were lost
							titleLocalized: z.record(z.string()).optional().describe("Multi-language titles, e.g. {en, ar}"),
							descriptionLocalized: z.record(z.string()).optional().describe("Multi-language descriptions, e.g. {en, ar}"),
							category: z.nativeEnum(VideoCategory).optional().describe("Video category"),
							format: z.enum(['short', 'video', 'auto']).optional().describe("Upload as a Short or as a video; 'auto' (default) detects it from length and shape"),
							categorySuggestionKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional()
								.describe("draftKey of the form's AI category suggestion (POST /api/videos/category-suggestions): the video adopts it and records whether the uploader kept it"),
							thumbnail: z.object({
								type: z.enum(['auto', 'custom']).describe("Thumbnail type: auto-generated or custom"),
								data: z.string().optional().describe("Base64 encoded image data for custom thumbnails"),
								position: z.number().min(0).max(100).optional().describe("Frame position (0-100%) for auto-generated thumbnails"),
								filename: z.string().optional().describe("Original filename"),
								video: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional()
									.describe("The video file's size as the browser reads it: an image of another shape is not stored (Bunny's frame is used instead)"),
							}).optional().describe("Thumbnail configuration"),
							fingerprint: UploadFingerprintSchema.optional().describe("File fingerprint (name, size, lastModified, SHA-256 of the first and last MiB). With it, retrying the same file reuses its unfinished video (same id, upload resumed at its offset) instead of creating a new one."),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Upload initiated successfully with TUS configuration",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								videoId: z.string().describe("Video GUID for upload"),
								tusSessionId: z.string().describe("Secure session ID for TUS proxy (client sends this to /api/videos/tus)"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
								reused: z.boolean().optional().describe("True when an unfinished upload of the same file was reused (same videoId)"),
								tusUploadId: z.string().optional().describe("Proxy upload id of the reused video's earlier upload: resume at /api/videos/tus/<tusUploadId>"),
								expiresAt: z.string().optional().describe("ISO 8601 datetime when the TUS session expires"),
								// Thumbnail fields
								thumbnailUrl: z.string().optional().describe("Primary thumbnail URL"),
								thumbnailSizes: z.object({
									hd: z.string().optional(),
									sd: z.string().optional(),
									mobile: z.string().optional(),
									thumb: z.string().optional(),
								}).optional().describe("Thumbnail URLs for different sizes"),
								// Legacy fields for backward compatibility
								libraryId: z.number().optional().describe("Library ID"),
								status: z.string().optional().describe("Upload status"),
								message: z.string().optional().describe("Status message"),
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
			"503": {
				description: "Another request is starting the same file's upload, or a store is unavailable: retry",
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
		// Get authenticated user ID
		const userId = this.getUserId(c);

		// Validated outside the catch-all below: a bad request is a 400 with the
		// issues (chanfana), not a 500
		const request = await this.getValidatedData<typeof this.schema>();
		try {
			const { title, description, fileSize, mimeType, isPublic, isDraft, tags, thumbnail, titleLocalized, descriptionLocalized, category, format, fingerprint, categorySuggestionKey } = request.body;

			// Validate required fields
			if (!fileSize || fileSize <= 0) {
				return c.json({
					success: false,
					error: "Invalid file size: must be a positive number"
				}, 400);
			}

			if (!mimeType || !mimeType.startsWith('video/')) {
				return c.json({
					success: false,
					error: "Invalid MIME type: must be a video format (e.g., video/mp4)"
				}, 400);
			}

			const channelId = c.req.header('channelId') || userId;
			// A channel member's upload belongs to the channel's owner (lib/channelAccess.ts)
			const { ownerId, uploadedBy } = uploadIdentity(c, userId);
			if (fingerprint && fingerprint.size !== fileSize) {
				return c.json({ success: false, error: "fingerprint.size must equal fileSize" }, 400);
			}

			// Studio drafts are limited per plan (lib/studioLimits.ts)
			if (isDraft && channelId !== userId) {
				const counts = await channelContentCounts(c.env as never, channelId);
				const limit = await checkDraftAllowed(c.env, { userId, channelId, drafts: counts?.value.drafts ?? 0 });
				if (limit) return c.json(limit, 402);
			}

			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({
					success: false,
					error: "Bunny Stream library ID is invalid"
				}, 500);
			}

			const bunnyStream = new stream(bunnyKey).forEnv(c.env);
			type VideoType = z.infer<typeof BusinessVideo>;
			const bucket = c.env.videos;
			if (!bucket) {
				logger.error('[UploadInitiate] R2 bucket binding not available');
				throw new Error('R2 bucket binding "videos" is not configured');
			}
			const repository = new R2Repository<VideoType>(bucket);
			const claimKey = fingerprint ? await fingerprintKey(channelId, userId, fingerprint) : undefined;

			// Metadata the uploader entered (applied on create and on reuse)
			const metadata = {
				title,
				description: description || '',
				// A draft is always private (docs/specs/CREATOR-STUDIO.md §4.4.1)
				isPublic: isDraft ? false : isPublic ?? true,
				...(isDraft ? { isDraft: true } : {}),
				tags: tags ? tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
				...(titleLocalized && { titleLocalized }),
				...(descriptionLocalized && { descriptionLocalized }),
				// A category submitted with the form is the uploader's (confirming or replacing the AI suggestion)
				...(category && { category, categorySource: 'uploader' as const }),
				...(format && format !== 'auto' && { format }),
				fileSize,
				originalFormat: mimeType,
			};

			// Creates the Bunny video and its record (the claim, when there is
			// one, guarantees this runs once per file).
			const create = async (): Promise<string> => {
				const collectionId = await uploadCollection(c.env, bunnyStream, libraryId, channelId, userId);
				const bunnyVideo = await bunnyStream.createVideo(libraryId, {
					title,
					collectionId, // Add to collection if available
					thumbnailTime: 0,
				});
				const videoId = bunnyVideo.guid;
				// Ours: the reaper may remove it if its record never lands (lib/uploads/reaper.ts)
				await markUploadCreated(c.env.global_settings, videoId, { userId, channelId });
				const thumb = await this.processThumbnail(c, videoId, thumbnail);
				const now = new Date().toISOString();
				// Same record as a bulk upload (lib/upload/uploadRecord.ts). Without a
				// stored thumbnail there is no thumbnail URL until Bunny's exists.
				const video = {
					...createUploadRecord({
						videoId,
						title,
						description,
						// A channel member's upload belongs to the channel's owner (lib/channelAccess.ts)
						userId: ownerId,
						uploadedBy,
						channelId,
						isPublic: isDraft ? false : isPublic ?? true,
						tags,
						titleLocalized,
						descriptionLocalized,
						category,
						...(category && { categorySource: 'uploader' as const }),
						format,
						fileSize,
						mimeType,
						customThumbnail: thumb.custom ? { url: thumb.thumbnailUrl, type: thumb.thumbnailType, sizes: thumb.thumbnailSizes } : undefined,
						bunnyHostname: c.env.bunny_hostname,
						bunnyLibraryId: libraryId,
						now: new Date(now),
					}),
					...(claimKey ? { uploadFingerprint: claimKey, lastInitiateAt: now } : {}),
					...(isDraft ? { isDraft: true } : {}),
				};
				try {
					await repository.putObject(videoId, video as VideoType);
					logger.debug('[UploadInitiate] Video metadata saved to R2', { videoId, channelId, fingerprinted: !!claimKey });
				} catch (error) {
					// The Bunny video has no record now: the reaper's orphan sweep removes it.
					logger.error('[UploadInitiate] Failed to save video metadata to R2', {
						videoId,
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}

				// AI category (queued, never blocks the upload): adopt the form's suggestion and record
				// what the uploader kept; without a category and without a suggestion, request one
				adoptOrRequestSuggestion(c, { videoId, userId, channelId, category: category ?? null, draftKey: categorySuggestionKey });

				// Send analytics event for upload initiation
				const queue = new Queue(c.env.queue);
				await queue.send(MessageType.VideoUploadStarted, {
					videoId,
					userId,
					channelId,
					title,
					fileSize,
					mimeType,
					timestamp: now,
				});
				return videoId;
			};

			let videoId: string;
			let reused = false;
			if (claimKey) {
				const outcome = await initiateOnce(claimKey, {
					store: c.env.global_settings as never,
					userId,
					channelId,
					check: (id) => checkReusable(c.env as never, id, { ownerId, uploadedBy, channelId }),
					create,
				});
				videoId = outcome.videoId;
				reused = outcome.reused;
				if (outcome.replaced) logger.debug('[UploadInitiate] Earlier video of this file not reusable; created a new one', { videoId, why: outcome.replaced });
			} else {
				videoId = await create();
			}

			let stored: PlaceholderRecord | null = null;
			let thumbnailUrl: string | undefined;
			let thumbnailSizes: Record<string, string> | undefined;
			if (reused) {
				// Same video again: latest metadata (and thumbnail, when one was sent)
				const thumb = thumbnail?.data ? await this.processThumbnail(c, videoId, thumbnail) : null;
				const nowIso = new Date().toISOString();
				const result = await patchVideo(repository, videoId, (fresh) => {
					const fields = reuseFields(fresh as unknown as PlaceholderRecord, metadata, nowIso);
					if (!fields) return false;
					if (thumb?.custom) Object.assign(fields, { thumbnailUrl: thumb.thumbnailUrl, thumbnailType: thumb.thumbnailType, thumbnailSizes: thumb.thumbnailSizes });
					return fields as Partial<VideoType>;
				}, { ownerId });
				if (result.status !== 'ok') {
					logger.warn('[UploadInitiate] Reused video vanished while updating it', { videoId, status: result.status });
					return c.json({ success: false, error: 'Upload could not be started, retry' }, 503);
				}
				stored = result.video as unknown as PlaceholderRecord;
				thumbnailUrl = stored.thumbnailUrl as string | undefined;
				thumbnailSizes = stored.thumbnailSizes as Record<string, string> | undefined;
			} else {
				stored = (await repository.getObject(videoId)) as unknown as PlaceholderRecord | null;
				thumbnailUrl = stored?.thumbnailUrl as string | undefined;
				thumbnailSizes = stored?.thumbnailSizes as Record<string, string> | undefined;
			}

			// TUS proxy session (no Bunny credentials reach the client); for a
			// reused video also its earlier upload, resumed at Bunny's offset.
			const session = await issueTusSession(c.env.TUS_SESSIONS, {
				libraryId,
				bunnyKey,
				userId,
				channelId,
				videoId,
				video: reused ? stored : null,
			});

			return c.json({
				success: true,
				result: {
					videoId,
					tusSessionId: session.tusSessionId, // Client uses this to access TUS proxy
					...(session.tusUploadId ? { tusUploadId: session.tusUploadId } : {}),
					chunkSize: session.chunkSize,
					resumable: session.resumable,
					expiresAt: session.expiresAt,
					reused,
					// Thumbnail fields (a stored thumbnail only; Bunny's comes once the video plays)
					thumbnailUrl: thumbnailUrl || undefined,
					thumbnailSizes,
					// Legacy fields for backward compatibility
					libraryId,
					status: 'uploading',
					message: reused ? 'Unfinished upload of this file reused. Use tusSessionId (and tusUploadId) with TUS proxy.' : 'Upload initiated successfully. Use tusSessionId with TUS proxy.',
				},
			});

		} catch (error) {
			if (error instanceof UploadClaimBusyError) {
				c.header('Retry-After', '3');
				return c.json({ success: false, error: error.message, retryable: true }, 503);
			}
			logger.error("Upload initiate error:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				name: error instanceof Error ? error.name : undefined,
			});

			const errorMessage = error instanceof Error ? error.message : String(error);
			return c.json({
				success: false,
				error: "Failed to initiate upload",
				details: errorMessage,
			}, 500);
		}
	}

	/**
	 * Store a thumbnail sent with the initiate (custom image or an extracted
	 * frame) in Bunny image storage; without one, point at the thumbnail Bunny
	 * generates next to the playlist (signed per response).
	 */
	private async processThumbnail(
		c: AppContext,
		videoId: string,
		thumbnail: { type?: 'auto' | 'custom'; data?: string; position?: number; filename?: string; video?: { width?: number; height?: number } } | undefined,
	): Promise<{ thumbnailUrl: string; thumbnailType: 'auto' | 'custom'; thumbnailSizes?: Record<string, string>; custom: boolean }> {
		const fallback = { thumbnailUrl: `https://${c.env.bunny_hostname}/${videoId}/thumbnail.jpg`, thumbnailType: 'auto' as const, custom: false };
		if (!thumbnail?.data) return fallback;
		try {
			logger.debug('[UploadInitiate] Processing thumbnail', { videoId, thumbnailType: thumbnail.type, position: thumbnail.position });
			// Process base64 thumbnail data (validates and converts to ArrayBuffer)
			const processed = await thumbnailProcessor.processBase64(thumbnail.data, thumbnail.filename || 'thumbnail.jpg');
			// Never store a thumbnail of another shape than the video's: Bunny's own frame is used instead
			const shape = checkThumbnailShape(imageSize(new Uint8Array(processed.original)), videoSizeOf(thumbnail.video));
			if (!shape.ok) {
				logger.warn('[UploadInitiate] Thumbnail dropped: wrong shape, using Bunny\'s frame', { videoId, expected: shape.expected, actual: shape.actual });
				return fallback;
			}
			const imageStorageKey = await requireSecret(c.env.image_storage_key, 'image_storage_key');
			const zone = requireEnvVar(c.env, 'ZONE');
			// Bunny.net Image Optimizer resizes on the fly using URL parameters
			const storageResult = await thumbnailStorage.storeInBunny(videoId, processed.original, zone, imageStorageKey, 'https://images.alummahnow.net');
			logger.debug('[UploadInitiate] Thumbnail saved to Bunny.net', { videoId, sizes: Object.keys(storageResult.thumbnailSizes) });
			return { thumbnailUrl: storageResult.cdnUrl, thumbnailType: thumbnail.type ?? 'custom', thumbnailSizes: storageResult.thumbnailSizes, custom: true };
		} catch (error) {
			logger.error('[UploadInitiate] Thumbnail processing failed', {
				videoId,
				thumbnailType: thumbnail.type,
				error: error instanceof Error ? error.message : String(error),
			});
			// Continue without thumbnail, will fall back to Bunny.net auto-generated
			return fallback;
		}
	}
}
