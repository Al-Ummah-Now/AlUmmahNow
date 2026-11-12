import { completeOriginal, putWholeOriginal } from '../../lib/media/originals';
import { enqueueTranscode } from '../../lib/media/r2-delivery';
import { uploadCollection } from "../../lib/channelCollection";
import { uploadIdentity } from "../../lib/channelAccess";
import { OpenAPIRoute, Str } from "chanfana";
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { validateVideoMagicBytes, readFileHeader } from "../../lib/security/magic-bytes";
import { logger } from '../../lib/logger';

export class VideoUpload extends AuthenticatedRoute {
    schema = {
        tags: ["Videos"],
        summary: "Upload Video File",
        description: "🔒 **Authentication Required**: Upload a video file with metadata. Supports multipart/form-data.",
        request: {
            body: {
                content: {
                    "multipart/form-data": {
                        schema: z.object({
                            file: z.any().describe("Video file to upload"),
                            title: Str({ description: "Video title" }),
                            description: Str({ description: "Video description" }).optional(),
                            isPublic: z.boolean().optional().default(true),
                            isLive: z.boolean().optional().default(false),
                            tags: z.string().optional().describe("Comma-separated tags"),
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
                description: "Video uploaded successfully",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            result: z.object({
                                videoId: z.string(),
                                uploadUrl: z.string().optional(),
                                status: z.string(),
                                message: z.string(),
                            }),
                        }),
                    },
                },
            },
            "400": {
                description: "Bad request - invalid file or metadata",
                content: {
                    "application/json": {
                        schema: ResponseError,
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
            "413": {
                description: "File too large",
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
            const file = formData.get('file') as File;
            const title = formData.get('title') as string;
            const description = formData.get('description') as string || '';
            const isPublic = formData.get('isPublic') === 'true';
            const isLive = formData.get('isLive') === 'true';
            const tags = formData.get('tags') as string || '';

            if (!file) {
                return c.json({
                    success: false,
                    error: "No file provided"
                }, 400);
            }

            if (!title) {
                return c.json({
                    success: false,
                    error: "Title is required"
                }, 400);
            }

            // SECURITY: Validate file type using magic bytes (file signatures)
            // This prevents attackers from uploading malicious files by spoofing Content-Type headers
            try {
                const fileHeader = await readFileHeader(file, 12);
                const magicByteResult = validateVideoMagicBytes(fileHeader, file.type);

                if (!magicByteResult.isValid) {
                    logger.warn('[SECURITY] Video upload rejected: invalid file signature', {
                        userId,
                        providedType: file.type,
                        error: magicByteResult.error,
                    });

                    return c.json({
                        success: false,
                        error: magicByteResult.error || 'Invalid video file format'
                    }, 400);
                }

                // Log if Content-Type header doesn't match detected format
                if (magicByteResult.mimeTypeMismatch) {
                    logger.warn('[SECURITY] Video upload: MIME type mismatch', {
                        userId,
                        providedType: file.type,
                        detectedType: magicByteResult.detectedMimeType,
                        detectedFormat: magicByteResult.detectedFormat,
                    });
                }

                logger.debug('[SECURITY] Video file validated', {
                    userId,
                    detectedFormat: magicByteResult.detectedFormat,
                    detectedMimeType: magicByteResult.detectedMimeType,
                    fileSize: file.size,
                });
            } catch (error) {
                logger.error('[SECURITY] Magic byte validation error', { error, userId });
                return c.json({
                    success: false,
                    error: 'Failed to validate video file'
                }, 500);
            }

            // Validate file size (100MB limit)
            const maxSize = 100 * 1024 * 1024; // 100MB
            if (file.size > maxSize) {
                return c.json({
                    success: false,
                    error: `File too large: ${file.size} bytes. Maximum size: ${maxSize} bytes`
                }, 413);
            }

            const videoId = crypto.randomUUID();
            const channelId = c.req.header('channelId') || userId;
            // A channel member's upload belongs to the channel's owner (lib/channelAccess.ts)
            const { ownerId, uploadedBy } = uploadIdentity(c, userId);

            // Create video metadata
            const video = {
                id: videoId,
                title,
                description,
                userId: ownerId,
                ...(uploadedBy ? { uploadedBy } : {}),
                channelId,
                dateCreated: new Date().toISOString(),
                dateModified: new Date().toISOString(),
                views: 0,
                availableResolutions: [],
                comments: [],
                likes: [],
                dislikes: [],
                isPublic,
                isLive,
                tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
                fileSize: file.size,
                originalFormat: file.type,
                uploadStatus: 'uploading' as const,
            };

            // Save metadata to R2
            const bucket = c.env.videos;
            type VideoType = z.infer<typeof BusinessVideo>;
            const repository = new R2Repository<VideoType>(bucket);
            await repository.putObject(videoId, video);

            // Upload to Bunny Stream
            let uploadResult = null;
            let uploadUrl = null;

            try {
                const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
                if (bunnyKey) {
                    const libraryIdStr = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
                    const libraryId = parseInt(libraryIdStr);
                    const bunnyStream = new stream(bunnyKey).forEnv(c.env);

                    // Create video in Bunny Stream
                    // The channel's (or owner's) Bunny collection (lib/channelCollection.ts)
                    const collectionId = await uploadCollection(c.env, bunnyStream, libraryId, channelId, ownerId);
                    const bunnyVideo = await bunnyStream.createVideo(libraryId, {
                        title,
                        thumbnailTime: 0,
                        ...(collectionId ? { collectionId } : {}),
                    });

                    // Upload file to Bunny Stream
                    const fileBuffer = await file.arrayBuffer();
                    const fileBlob = new Blob([fileBuffer], { type: file.type });

                    uploadResult = await bunnyStream.uploadVideo(libraryId, videoId, fileBlob);
                    uploadUrl = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;

                    // Our own copy for the R2 transcode (docs/media-delivery/ORIGINALS.md); never fails the upload
                    if (await putWholeOriginal(c.env as never, videoId, 'direct', fileBuffer)) {
                        if (await completeOriginal(c.env as never, videoId, fileBuffer.byteLength)) {
                            await enqueueTranscode(c.env as never, videoId, 'upload', { uploaderId: userId });
                        }
                    }
                }
            } catch (error) {
                logger.error("Bunny Stream upload error:", error);
                // Continue with local storage even if Bunny Stream fails
            }

            // Send analytics event
            const queue = new Queue(c.env.queue);
            await queue.send(MessageType.VideoCreate, {
                videoId,
                userId,
                channelId,
                title,
                fileSize: file.size,
                fileType: file.type,
                uploadMethod: 'multipart',
                bunnyStreamSuccess: !!uploadResult,
                timestamp: new Date().toISOString(),
            });

            return c.json({
                success: true,
                result: {
                    videoId,
                    uploadUrl,
                    status: 'uploaded',
                    message: 'Video uploaded successfully',
                },
            });

        } catch (error) {
            logger.error("Video upload error:", error);
            return c.json({
                success: false,
                error: "Upload failed"
            }, 500);
        }
    }
}
