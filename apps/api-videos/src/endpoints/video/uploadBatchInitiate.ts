import { uploadCollection } from "../../lib/channelCollection";
import { uploadIdentity } from "../../lib/channelAccess";
import { Str, Num } from "chanfana";
import { createUploadRecord } from '../../lib/upload/uploadRecord';
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { VideoCategory } from "@al-ummah/shared-types";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { fingerprintKey, initiateOnce, UploadClaimBusyError, UploadFingerprintSchema } from "../../lib/uploads/initiateOnce";
import { checkReusable, issueTusSession, reuseFields, type PlaceholderRecord } from "../../lib/uploads/placeholder";
import { patchVideo } from "../../lib/videoWrites";
import { markUploadCreated } from "../../lib/uploads/reaper";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { requestVideoSuggestion } from '../../lib/categorySuggestions';
import { logger } from '../../lib/logger';

const MAX_BATCH_SIZE = 15;

const BatchVideoSchema = z.object({
	title: Str({ description: "Video title" }),
	description: Str({ description: "Video description" }).optional(),
	fileSize: Num({ description: "File size in bytes", required: true }),
	mimeType: Str({ description: "MIME type of the video file", required: true }),
	isPublic: z.boolean().optional(),
	tags: z.string().optional().describe("Comma-separated tags"),
	titleLocalized: z.object({ en: z.string().max(1000).optional(), ar: z.string().max(1000).optional() }).optional().describe("Titles per language (set for all / per file on the upload page)"),
	descriptionLocalized: z.object({ en: z.string().max(5000).optional(), ar: z.string().max(5000).optional() }).optional().describe("Descriptions per language"),
	language: z.enum(['en', 'ar', 'ur', 'fr']).optional().describe("Primary language of the video"),
	commentSettings: z.enum(['on', 'held', 'off']).optional().describe("Comments: on, held for review, or off"),
	fileName: z.string().max(255).optional().describe("The file's name as picked (kept for bulk rename's {filename})"),
	format: z.enum(['short', 'video', 'auto']).optional().describe("Upload as a Short or as a video; 'auto' (default) detects it from length and shape"),
	fingerprint: UploadFingerprintSchema.optional().describe("File fingerprint (name, size, lastModified, SHA-256 of the first and last MiB): retrying the same file reuses its unfinished video"),
});

const SharedMetadataSchema = z.object({
	channelId: z.string().optional().describe("Channel ID for all videos (defaults to the channelId header)"),
	category: z.nativeEnum(VideoCategory).optional().describe("Category for all videos"),
	isPublic: z.boolean().optional().describe("Visibility for all videos"),
});

type BatchVideo = z.infer<typeof BatchVideoSchema>;

/** {en, ar} without the empty languages (an empty Arabic title is "none", not ""). */
function dropEmpty(values: { en?: string; ar?: string }): Record<string, string> {
	return Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as Record<string, string>;
}

/**
 * Validate a single batch entry. Returns an error message or null.
 */
function validateBatchVideo(video: BatchVideo): string | null {
	if (!video.fileSize || video.fileSize <= 0) {
		return `Invalid file size for "${video.title}": must be a positive number`;
	}
	if (!video.mimeType || !video.mimeType.startsWith('video/')) {
		return `Invalid MIME type for "${video.title}": must be a video format (e.g., video/mp4)`;
	}
	if (video.fingerprint && video.fingerprint.size !== video.fileSize) {
		return `fingerprint.size must equal fileSize for "${video.title}"`;
	}
	return null;
}

export class UploadBatchInitiateEndpoint extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Initiate Batch Video Upload",
		description: "🔒 **Authentication Required**: Initiate upload for multiple videos (up to 15). Each video gets a TUS proxy session; upload each file to /api/videos/tus with `tusSessionId` in the upload metadata (same flow as single upload).",
		request: {
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videos: z.array(BatchVideoSchema).min(1).max(MAX_BATCH_SIZE).describe("Array of video metadata (1-15 videos)"),
							sharedMetadata: SharedMetadataSchema.optional().describe("Shared metadata applied to all videos"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Batch upload initiated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.array(z.object({
								videoId: z.string().describe("Video GUID for upload"),
								tusSessionId: z.string().describe("Session ID for the TUS proxy (send as tusSessionId upload metadata)"),
								expiresAt: z.string().describe("ISO 8601 datetime when the session expires"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
								reused: z.boolean().optional().describe("True when an unfinished upload of the same file was reused (same videoId)"),
								tusUploadId: z.string().optional().describe("Proxy upload id of the reused video's earlier upload: resume at /api/videos/tus/<tusUploadId>"),
							})),
							deferred: z.object({
								count: z.number().describe("Videos not started: the creator tier's upload limit fits only the first result.length"),
								indexes: z.array(z.number()).describe("Positions (in the request's videos) of the deferred videos"),
								retryAfter: z.number().describe("Seconds until the deferred videos can be initiated"),
								retryAt: z.string().describe("ISO 8601 datetime when the deferred videos can be initiated"),
							}).optional().describe("Present when only part of the batch fits the upload limit"),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: { "application/json": { schema: ResponseError } },
			},
			"401": {
				description: "Unauthorized - authentication required",
				content: { "application/json": { schema: ResponseError } },
			},
			"503": {
				description: "Another request is starting the same file's upload, or a store is unavailable: retry",
				content: { "application/json": { schema: ResponseError } },
			},
			"500": {
				description: "Internal server error",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	}, 'required');

	async handle(c: AppContext) {
		const userId = this.getUserId(c);

		try {
			const request = await this.getValidatedData<typeof this.schema>();
			const { videos: requestedVideos, sharedMetadata } = request.body;
			// The creator tier's limits fit only part of the batch: start the first
			// `allowed` videos, tell the client which were deferred and when they can start
			const allowance = c.get('uploadAllowance');
			const videos = allowance && allowance.allowed < requestedVideos.length ? requestedVideos.slice(0, allowance.allowed) : requestedVideos;

			// Validate every entry before creating anything in Bunny/R2
			for (const video of requestedVideos) {
				const validationError = validateBatchVideo(video);
				if (validationError) {
					return c.json({ success: false, error: validationError }, 400);
				}
			}

			// channelIdMiddleware already verified the header belongs to this user.
			// A body channelId is only accepted when it matches the header.
			const headerChannelId = request.headers.channelId || undefined;
			if (sharedMetadata?.channelId && headerChannelId && sharedMetadata.channelId !== headerChannelId) {
				return c.json({ success: false, error: "sharedMetadata.channelId must match the channelId header" }, 400);
			}
			const channelId = headerChannelId || userId;
			// A channel member's uploads belong to the channel's owner (lib/channelAccess.ts)
			const { ownerId, uploadedBy } = uploadIdentity(c, userId);

			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({ success: false, error: "Bunny Stream library ID is invalid" }, 500);
			}

			const bunnyStream = new stream(bunnyKey).forEnv(c.env);
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(c.env.videos);
			const queue = new Queue(c.env.queue);

			logger.debug('[UploadBatchInitiate] Initiating batch', {
				userId,
				channelId,
				videoCount: videos.length,
			});

			// Duplicate files in one request share one video
			const keys = await Promise.all(videos.map((v) => (v.fingerprint ? fingerprintKey(channelId, userId, v.fingerprint) : Promise.resolve(undefined))));
			const byKey = new Map<string, Promise<{ videoId: string; reused: boolean }>>();
			let collection: Promise<string | undefined> | undefined;

			const results = await Promise.all(videos.map(async (videoData, index) => {
				const claimKey = keys[index];
				const metadata = {
					title: videoData.title,
					description: videoData.description || '',
					isPublic: videoData.isPublic ?? sharedMetadata?.isPublic ?? true,
					tags: videoData.tags ? videoData.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
					...(sharedMetadata?.category ? { category: sharedMetadata.category, categorySource: 'uploader' as const } : {}),
					...(videoData.format && videoData.format !== 'auto' ? { format: videoData.format } : {}),
					fileSize: videoData.fileSize,
					originalFormat: videoData.mimeType,
				};

				const create = async (): Promise<string> => {
					// The channel's collection, like a single upload (one lookup per batch)
					const collectionId = await (collection ??= uploadCollection(c.env, bunnyStream, libraryId, channelId, ownerId));
					const bunnyVideo = await bunnyStream.createVideo(libraryId, {
						title: videoData.title,
						collectionId,
						thumbnailTime: 0,
					});
					const videoId = bunnyVideo.guid;
					// Ours: the reaper may remove it if its record never lands (lib/uploads/reaper.ts)
					await markUploadCreated(c.env.global_settings, videoId, { userId, channelId });
					const now = new Date().toISOString();

					// Same record as a single upload (lib/upload/uploadRecord.ts)
					const video: VideoType = {
						...createUploadRecord({
							videoId,
							title: videoData.title,
							description: videoData.description,
							userId: ownerId,
							uploadedBy,
							channelId,
							isPublic: videoData.isPublic ?? sharedMetadata?.isPublic ?? true,
							tags: videoData.tags,
							...(videoData.titleLocalized ? { titleLocalized: dropEmpty(videoData.titleLocalized) } : {}),
							...(videoData.descriptionLocalized ? { descriptionLocalized: dropEmpty(videoData.descriptionLocalized) } : {}),
							...(videoData.language ? { language: videoData.language } : {}),
							...(videoData.commentSettings ? { commentSettings: videoData.commentSettings } : {}),
							...(videoData.fileName ? { originalFilename: videoData.fileName } : {}),
							category: sharedMetadata?.category,
							format: videoData.format,
							...(sharedMetadata?.category ? { categorySource: 'uploader' as const } : {}),
							fileSize: videoData.fileSize,
							mimeType: videoData.mimeType,
							bunnyHostname: c.env.bunny_hostname,
							bunnyLibraryId: libraryId,
							now: new Date(now),
						}),
						...(claimKey ? { uploadFingerprint: claimKey, lastInitiateAt: now } : {}),
					};

					await repository.putObject(videoId, video);
					// No category chosen for the batch: AI suggests one per video (queued)
					if (!sharedMetadata?.category) requestVideoSuggestion(c, { videoId, userId, channelId, reason: 'upload' });

					await queue.send(MessageType.VideoUploadStarted, {
						videoId,
						userId,
						channelId,
						title: videoData.title,
						fileSize: videoData.fileSize,
						mimeType: videoData.mimeType,
						timestamp: now,
						batchUpload: true,
					});
					return videoId;
				};

				let outcome: { videoId: string; reused: boolean };
				if (claimKey) {
					let pending = byKey.get(claimKey);
					if (!pending) {
						pending = initiateOnce(claimKey, {
							store: c.env.global_settings as never,
							userId,
							channelId,
							check: (id) => checkReusable(c.env as never, id, { ownerId, uploadedBy, channelId }),
							create,
						});
						byKey.set(claimKey, pending);
					}
					outcome = await pending;
				} else {
					outcome = { videoId: await create(), reused: false };
				}
				const { videoId, reused } = outcome;

				let stored: PlaceholderRecord | null = null;
				if (reused) {
					const nowIso = new Date().toISOString();
					const result = await patchVideo(repository, videoId, (fresh) => {
						const fields = reuseFields(fresh as unknown as PlaceholderRecord, metadata, nowIso);
						return fields ? (fields as Partial<VideoType>) : false;
					}, { ownerId });
					if (result.status !== 'ok') throw new UploadClaimBusyError(claimKey!);
					stored = result.video as unknown as PlaceholderRecord;
				}

				const session = await issueTusSession(c.env.TUS_SESSIONS, {
					libraryId,
					bunnyKey,
					userId,
					channelId,
					videoId,
					video: stored,
				});

				return {
					videoId,
					tusSessionId: session.tusSessionId,
					...(session.tusUploadId ? { tusUploadId: session.tusUploadId } : {}),
					expiresAt: session.expiresAt,
					chunkSize: session.chunkSize,
					resumable: session.resumable,
					reused,
				};
			}));

			logger.debug('[UploadBatchInitiate] Batch initiated', {
				userId,
				channelId,
				videoIds: results.map(r => r.videoId),
			});

			if (videos.length < requestedVideos.length) {
				const retryAfter = allowance?.retryAfter ?? 60;
				return c.json({
					success: true,
					result: results,
					deferred: {
						count: requestedVideos.length - videos.length,
						indexes: requestedVideos.map((_, i) => i).slice(videos.length),
						retryAfter,
						retryAt: new Date(Date.now() + retryAfter * 1000).toISOString(),
					},
				});
			}
			return c.json({ success: true, result: results });
		} catch (error) {
			if (error instanceof UploadClaimBusyError) {
				c.header('Retry-After', '3');
				return c.json({ success: false, error: error.message, retryable: true }, 503);
			}
			logger.error("[UploadBatchInitiate] Batch upload initiate error", {
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
			return c.json({
				success: false,
				error: error instanceof Error ? error.message : "Failed to initiate batch upload"
			}, 500);
		}
	}
}
