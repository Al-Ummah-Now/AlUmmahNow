import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";

export class Metrics extends OpenAPIRoute {
schema = {
tags: ["Monitoring"],
summary: "API Metrics",
description: "🔓 **Public Endpoint**: Get API usage metrics and statistics.",
responses: {
"200": {
description: "API metrics",
content: {
"application/json": {
schema: z.object({
timestamp: z.string(),
metrics: z.object({
videos: z.object({
total: z.number(),
public: z.number(),
private: z.number(),
totalViews: z.number(),
}),
profiles: z.object({
total: z.number(),
}),
channels: z.object({
total: z.number(),
}),
playlists: z.object({
total: z.number(),
}),
storage: z.object({
videos: z.object({
objects: z.number(),
}),
profiles: z.object({
objects: z.number(),
}),
channels: z.object({
objects: z.number(),
}),
playlists: z.object({
objects: z.number(),
}),
}),
}),
performance: z.object({
responseTime: z.number(),
}),
}),
},
},
},
},
};

async handle(c) {
const startTime = Date.now();

try {
// Get storage metrics
const videosRepository = new R2Repository(env.videos);
const profilesRepository = new R2Repository(env.profiles);
const channelsRepository = new R2Repository(env.channels);
const playlistsRepository = new R2Repository(env.playlists);

// Get basic counts (limit to avoid performance issues)
const videosResult = await videosRepository.listObjects(1000);
const profilesResult = await profilesRepository.listObjects(1000);
const channelsResult = await channelsRepository.listObjects(1000);
const playlistsResult = await playlistsRepository.listObjects(1000);

// Calculate video metrics
const videos = videosResult.items || [];
const publicVideos = videos.filter((v: any) => v.isPublic !== false).length;
const privateVideos = videos.length - publicVideos;
const totalViews = videos.reduce((sum: number, v: any) => sum + (v.views || 0), 0);

const responseTime = Date.now() - startTime;

return c.json({
timestamp: new Date().toISOString(),
metrics: {
videos: {
total: videos.length,
public: publicVideos,
private: privateVideos,
totalViews,
},
profiles: {
total: (profilesResult.items || []).length,
},
channels: {
total: (channelsResult.items || []).length,
},
playlists: {
total: (playlistsResult.items || []).length,
},
storage: {
videos: {
objects: videos.length,
},
profiles: {
objects: (profilesResult.items || []).length,
},
channels: {
objects: (channelsResult.items || []).length,
},
playlists: {
objects: (playlistsResult.items || []).length,
},
},
},
performance: {
responseTime,
},
});

} catch (error) {
console.error("Metrics error:", error);
return c.json({
timestamp: new Date().toISOString(),
error: "Failed to retrieve metrics",
performance: {
responseTime: Date.now() - startTime,
}
}, 500);
}
}
}
