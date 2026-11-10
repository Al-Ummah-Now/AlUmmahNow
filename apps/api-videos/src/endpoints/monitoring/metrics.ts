import { PublicRoute, AppContext } from "../../base";
import { } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { ownershipVideoTotals } from '../../lib/search/ownership';

export class Metrics extends PublicRoute {
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

async handle(c: AppContext) {
const startTime = Date.now();

try {
// Get storage metrics
const videosRepository = new R2Repository(c.env.videos);
const profilesRepository = new R2Repository(c.env.profiles);
const channelsRepository = new R2Repository(c.env.channels);
const playlistsRepository = new R2Repository(c.env.playlists);

// Counts from key listings (one list each, no object reads) and video totals
// from the ownership index (SCALABILITY-AUDIT AV-16); up to 1000 keys per bucket as before
const keys = async (bucket: R2Bucket) => ((await bucket.list({ limit: 1000 })).objects || []).map(() => ({}));
const [videoKeys, profileKeys, channelKeys, playlistKeys, indexed] = await Promise.all([
  keys(c.env.videos), keys(c.env.profiles), keys(c.env.channels), keys(c.env.playlists), ownershipVideoTotals(c.env as never),
]);
const profilesResult = { items: profileKeys };
const channelsResult = { items: channelKeys };
const playlistsResult = { items: playlistKeys };

// Calculate video metrics (a sample of 100 objects while the index is unavailable)
const sample = indexed ? [] : ((await videosRepository.listObjects(100)).items || []);
const videoCount = indexed ? indexed.total : videoKeys.length;
const publicVideos = indexed ? indexed.public : sample.filter((v: any) => v.isPublic !== false).length;
const privateVideos = (indexed ? indexed.total : sample.length) - publicVideos;
const totalViews = indexed ? indexed.views : sample.reduce((sum: number, v: any) => sum + (v.views || 0), 0);

const responseTime = Date.now() - startTime;

return c.json({
timestamp: new Date().toISOString(),
metrics: {
videos: {
total: videoCount,
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
objects: videoCount,
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
logger.error("Metrics error:", error);
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
