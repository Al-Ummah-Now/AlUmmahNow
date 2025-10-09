import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";

export class VideoUpload extends OpenAPIRoute {
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

// Validate file type
const allowedTypes = ['video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo'];
if (!allowedTypes.includes(file.type)) {
return c.json({
success: false,
error: `Unsupported file type: ${file.type}. Allowed types: ${allowedTypes.join(', ')}`
}, 400);
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

// Create video metadata
const video = {
id: videoId,
title,
description,
userId,
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
uploadStatus: 'uploading',
};

// Save metadata to R2
const bucket = env.videos;
type VideoType = z.infer<typeof BusinessVideo>;
const repository = new R2Repository<VideoType>(bucket);
await repository.putObject(videoId, video);

// Upload to Bunny Stream
let uploadResult = null;
let uploadUrl = null;

try {
const bunnyKey = await env["bunny-stream-key"].get();
if (bunnyKey) {
const bunnyStream = new stream(bunnyKey);
const libraryId = parseInt(await env.bunny_stream_library_id.get());

// Create video in Bunny Stream
const bunnyVideo = await bunnyStream.createVideo(libraryId, {
title,
thumbnailTime: 0,
});

// Upload file to Bunny Stream
const fileBuffer = await file.arrayBuffer();
const fileBlob = new Blob([fileBuffer], { type: file.type });

uploadResult = await bunnyStream.uploadVideo(libraryId, videoId, fileBlob);
uploadUrl = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;
}
} catch (error) {
console.error("Bunny Stream upload error:", error);
// Continue with local storage even if Bunny Stream fails
}

// Send analytics event
const queue = new Queue();
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
console.error("Video upload error:", error);
return c.json({
success: false,
error: "Upload failed"
}, 500);
}
}
}
