import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors'
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { VideoCreate } from "./endpoints/video/videoCreate";
import { VideoUpdate } from "./endpoints/video/videoUpdate";
import { VideoDelete } from "./endpoints/video/videoDelete";
import { VideoFetch } from "./endpoints/video/videoFetch";
import { VideosList } from "./endpoints/video/videoList";
import { VideoSearch } from "./endpoints/video/videoSearch";
import { VideoView } from "./endpoints/video/videoView";
import { VideoUploadStatus } from "./endpoints/video/videoUploadStatus";
import { VideoUpload } from "./endpoints/video/videoUpload";
import { UploadInitiateEndpoint } from "./endpoints/video/uploadInitiate";
import { UploadCompleteEndpoint } from "./endpoints/video/uploadComplete";
import { UploadResumeEndpoint } from "./endpoints/video/uploadResume";
import { UploadBatchInitiateEndpoint } from "./endpoints/video/uploadBatchInitiate";
import { VideoChaptersGet } from "./endpoints/video/chapters";
import { VideoChaptersUpdate } from "./endpoints/video/chaptersUpdate";
import { SubtitlesUpload } from "./endpoints/video/subtitlesUpload";
import { SubtitlesList } from "./endpoints/video/subtitlesList";
import { SubtitlesGet } from "./endpoints/video/subtitlesGet";
import { SubtitlesDelete } from "./endpoints/video/subtitlesDelete";
// Video Scheduling imports
import { VideoScheduleCreate } from "./endpoints/video/scheduleCreate";
import { VideoScheduleUpdate } from "./endpoints/video/scheduleUpdate";
import { VideoScheduleDelete } from "./endpoints/video/scheduleDelete";
import { VideoScheduleFetch } from "./endpoints/video/scheduleFetch";
import { VideoScheduleList } from "./endpoints/video/scheduleList";
import { ProfileCreate } from "./endpoints/profile/profileCreate";
import { ProfileDelete } from "./endpoints/profile/profileDelete";
import { ProfileFetch } from "./endpoints/profile/profileFetch";
import { ProfilesList } from "./endpoints/profile/profileList";
import { ProfileUpdate } from "./endpoints/profile/profileUpdate";
import { WatchHistoryAdd } from "./endpoints/profile/watchHistoryAdd";
import { WatchHistoryList } from "./endpoints/profile/watchHistoryList";
import handleAvatarUpdate from "./endpoints/profile/profileAvatarUpdate";
// Watch History endpoints (new system)
import { RecordWatchHistory } from "./endpoints/watch-history/record";
import { ListWatchHistory } from "./endpoints/watch-history/list";
import { DeleteWatchHistory } from "./endpoints/watch-history/delete";
import { ClearWatchHistory } from "./endpoints/watch-history/clear";
import { UpdateWatchProgress } from "./endpoints/watch-history/update-progress";
import { GetWatchProgress } from "./endpoints/watch-history/get-progress";
import handleCoverUpdate from "./endpoints/profile/profileCoverUpdate";
import handleChannelAvatarUpdate from "./endpoints/channel/channelAvatarUpdate";
import handleChannelCoverUpdate from "./endpoints/channel/channelCoverUpdate";
import { PlaylistCreate } from "./endpoints/playlist/playlistCreate";
import { PlaylistFetch } from "./endpoints/playlist/playlistFetch";
import { PlaylistDelete } from "./endpoints/playlist/playlistDelete";
import { PlaylistsList } from "./endpoints/playlist/playlistsList";
import { PlaylistUpdate } from "./endpoints/playlist/playlistUpdate";
import { PlaylistAddVideo } from "./endpoints/playlist/playlistAddVideo";
import { PlaylistRemoveVideo } from "./endpoints/playlist/playlistRemoveVideo";
import { ChannelCreate } from "./endpoints/channel/channelCreate";
import { ChannelUpdate } from "./endpoints/channel/channelUpdate";
import { ChannelFetch } from "./endpoints/channel/channelFetch";
import { ChannelDelete } from "./endpoints/channel/channelDelete";
import { ChannelsList } from "./endpoints/channel/channelList";
import { SubscriptionCreate } from "./endpoints/channel/SubscriptionCreate";
import { SubscriptionDelete } from "./endpoints/channel/SubscriptionDelete";
// Channel Sections endpoints
import { ChannelSectionsList } from "./endpoints/channel-section/channelSectionList";
import { ChannelSectionFetch } from "./endpoints/channel-section/channelSectionFetch";
import { ChannelSectionCreate } from "./endpoints/channel-section/channelSectionCreate";
import { ChannelSectionUpdate } from "./endpoints/channel-section/channelSectionUpdate";
import { ChannelSectionDelete } from "./endpoints/channel-section/channelSectionDelete";
import { ChannelSectionReorder } from "./endpoints/channel-section/channelSectionReorder";
// Channel Tabs endpoints
import { ChannelTabsFetch } from "./endpoints/channel/channelTabsFetch";
import { ChannelTabsUpdate } from "./endpoints/channel/channelTabsUpdate";
import { CommentCreate } from "./endpoints/video/commentCreate";
import { CommentUpdate } from "./endpoints/video/commentUpdate";
import { CommentDelete } from "./endpoints/video/commentDelete";
import { LikeCreate } from "./endpoints/video/videoLikeCreate";
import { LikeDelete } from "./endpoints/video/videoLikeDelete";
import { DislikeCreate } from "./endpoints/video/videoDislikeCreate";
import { DislikeDelete } from "./endpoints/video/videoDislikeDelete";
import { AuthTest } from "./endpoints/auth/authTest";
import { HealthCheck } from "./endpoints/monitoring/healthCheck";
import { TestRunner } from "./endpoints/monitoring/testRunner";
import { TestError } from "./endpoints/monitoring/test-error";
import { Metrics } from "./endpoints/monitoring/metrics";
import { StatusPage } from "./endpoints/monitoring/statusPage";
import { SyncR2Buckets } from "./endpoints/monitoring/sync-r2";
// Phase 2: Live Streaming imports
import { LiveStreamCreate } from "./endpoints/live/liveStreamCreate";
import { LiveStreamsList } from "./endpoints/live/liveStreamsList";
import { LiveStreamUpdate } from "./endpoints/live/liveStreamUpdate";
// Phase 2: Analytics imports
import { AnalyticsGet } from "./endpoints/analytics/analyticsGet";
// Phase 2: Content Moderation imports
import { ReportCreate } from "./endpoints/moderation/reportCreate";
import { ModerationAction } from "./endpoints/moderation/moderationAction";
// Community Posts imports
import { ListCommunityPosts } from "./endpoints/community/list-posts";
import { GetCommunityPost } from "./endpoints/community/get-post";
import { CreateCommunityPost } from "./endpoints/community/create-post";
import { UpdateCommunityPost } from "./endpoints/community/update-post";
import { DeleteCommunityPost } from "./endpoints/community/delete-post";
import { LikeCommunityPost } from "./endpoints/community/like-post";
import { UnlikeCommunityPost } from "./endpoints/community/unlike-post";
import { VoteOnPoll } from "./endpoints/community/vote-poll";
import { GetPollResults } from "./endpoints/community/get-poll-results";
// Community Posts - Comments imports
import { ListPostComments } from "./endpoints/community/post-comments-list";
import { CreatePostComment } from "./endpoints/community/post-comment-create";
import { UpdatePostComment } from "./endpoints/community/post-comment-update";
import { DeletePostComment } from "./endpoints/community/post-comment-delete";
import { LikePostComment } from "./endpoints/community/post-comment-like";
import { UnlikePostComment } from "./endpoints/community/post-comment-unlike";
// Community Posts - Media Upload imports
import { UploadCommunityPostImages } from "./endpoints/community/upload-images";
import { UploadCommunityPostGif } from "./endpoints/community/upload-gif";
// Upload Defaults (Templates) imports
import { ListUploadDefaultsEndpoint, CreateUploadDefaultEndpoint } from "./endpoints/settings/uploadDefaults";
import { GetUploadDefaultEndpoint, UpdateUploadDefaultEndpoint, DeleteUploadDefaultEndpoint, SetDefaultTemplateEndpoint } from "./endpoints/settings/uploadDefaultsById";
import { logger } from './lib/logger';


// Start a Hono app - testing reload
const app = new Hono();

// Register global error handler (catches all unhandled errors)
app.onError(errorHandler);

// Setup CORS for all routes
app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'channelId', 'userId'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Allow'],
	maxAge: 600,
	credentials: false,
}));

// Add comprehensive logging middleware for ALL routes
app.use('*', loggingMiddleware);

// Explicit OPTIONS handler for profile endpoints
app.options('/api/profile*', (c) => {
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, channelId, userId');
	c.header('Access-Control-Max-Age', '600');
	c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	return new Response('', { status: 204 });
});

// Explicit OPTIONS handler for all API endpoints
app.options('/api/*', (c) => {
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, channelId, userId');
	c.header('Access-Control-Max-Age', '600');
	c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	return new Response('', { status: 204 });
});

// Add authentication middleware to all API routes
// Use optionalAuthMiddleware for GET endpoints (allow both authenticated and public access)
// Use authMiddleware for CUD operations (require authentication)
app.use('/api/*', optionalAuthMiddleware);

// For routes that require authentication, we'll add authMiddleware later
// or use it selectively based on the operation type

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
	schema: {
		info: {
			title: "Al-Ummah Now Videos API",
			version: "1.0.0",
			description: "Video content management API with OpenAuth OAuth2 authentication support. Click 'Authorize' to authenticate via OAuth2 or provide a Bearer token."
		},
		servers: [
			{
				url: "https://videos.api.alummahnow.net",
				description: "Production server"
			},
			{
				url: "http://127.0.0.1:3086",
				description: "Development server"
			}
		],
		security: [
			{
				BearerToken: []
			}
		]
	}
});
openapi.registry.registerComponent("securitySchemes", "BearerToken", {
	type: "http",
	scheme: 'bearer',
	bearerFormat: 'JWT'
});

// CRITICAL: Add logging middleware to OpenAPI router
// Chanfana creates a new router, so we need to register middleware on it too
openapi.original.use('*', loggingMiddleware);

// Register OpenAPI endpoints
// PUBLIC endpoints (optional auth - work without authentication)
openapi.get("/api/videos", VideosList);
openapi.get("/api/videos/search", VideoSearch);
openapi.get("/api/videos/:id", VideoFetch);
openapi.post("/api/videos/:id/view", VideoView); // View tracking (analytics)
openapi.get("/api/videos/:id/chapters", VideoChaptersGet); // Get video chapters
openapi.get("/api/videos/:videoId/subtitles", SubtitlesList); // List subtitle tracks
openapi.get("/api/videos/:videoId/subtitles/:language", SubtitlesGet); // Get specific subtitle
openapi.get("/api/profiles", ProfilesList);
openapi.get("/api/profiles/:id", ProfileFetch);
openapi.get("/api/playlists", PlaylistsList);
openapi.get("/api/playlists/:id", PlaylistFetch);
openapi.get("/api/channels", ChannelsList);
openapi.get("/api/channels/:id", ChannelFetch);
openapi.get("/api/channels/:id/tabs", ChannelTabsFetch); // Channel tabs configuration (public)
// Community Posts endpoints (public)
openapi.get("/api/community/posts", ListCommunityPosts);
openapi.get("/api/community/posts/:postId", GetCommunityPost);
openapi.get("/api/community/posts/:postId/results", GetPollResults);
// Community Posts - Comments endpoints (public read, auth required for write)
openapi.get("/api/community/posts/:postId/comments", ListPostComments);
// Phase 2: Live Streaming endpoints
openapi.get("/api/live-streams", LiveStreamsList);
// Phase 2: Analytics endpoints
openapi.get("/api/analytics", AnalyticsGet);

// Monitoring and testing endpoints (public)
openapi.get("/health", HealthCheck);
openapi.get("/metrics", Metrics);
openapi.get("/test", TestRunner);
openapi.get("/test-error", TestError);
openapi.get("/status", StatusPage);

// Internal sync endpoint (dev only)
openapi.get("/internal/sync-r2", SyncR2Buckets);

// Authentication test endpoint (requires auth)
openapi.get("/auth-test", AuthTest);

// Apply authentication middleware to routes that require login
app.use('/auth-test', authMiddleware);

// SECURITY: Apply rate limiting to video upload endpoints
app.use('/api/videos/upload', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/initiate', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/batch/initiate', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/complete', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/resume/:videoId', rateLimitMiddleware('video_upload'));

app.use('/api/videos', (c, next) => {
	// Allow GET requests and POST to /:id/view (view tracking) without authentication
	// Exception: GET /api/videos/upload/resume/:videoId requires auth
	if (c.req.method === 'GET' && !c.req.path.includes('/upload/resume/')) {
		return next();
	}
	if (c.req.method === 'POST' && c.req.path.endsWith('/view')) {
		return next();
	}
	return authMiddleware(c, next);
});

app.use('/api/profiles', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

app.use('/api/playlists', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

app.use('/api/channels', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

// Channel Tabs - GET is public, PUT requires auth
app.use('/api/channels/:id/tabs', (c, next) => {
	if (c.req.method === 'PUT') {
		return authMiddleware(c, next);
	}
	return next();
});

// Channel Sections - GET is public, CUD operations require auth
app.use('/api/channels/:channelId/sections', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

// Phase 2: Apply authentication middleware to new endpoints
app.use('/api/live-streams', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

app.use('/api/analytics', authMiddleware);
app.use('/api/moderation/*', authMiddleware);
app.use('/api/watch-history/*', authMiddleware);
app.use('/api/watch-history', authMiddleware);

// Community posts - GET endpoints are public, others require auth
app.use('/api/community/posts', (c, next) => {
	if (c.req.method === 'GET') {
		return next();
	}
	return authMiddleware(c, next);
});

app.use('/api/community/posts/:postId/like', authMiddleware);
app.use('/api/community/posts/:postId/vote', authMiddleware);

// Community posts comments - GET is public, others require auth
app.use('/api/community/posts/:postId/comments', (c, next) => {
	if (c.req.method === 'GET') {
		return next();
	}
	return authMiddleware(c, next);
});

app.use('/api/community/posts/:postId/comments/:commentId', authMiddleware);
app.use('/api/community/posts/:postId/comments/:commentId/like', authMiddleware);

// SECURITY: Apply rate limiting to community media uploads
app.use('/api/community/media/upload/images', rateLimitMiddleware('image_upload'));
app.use('/api/community/media/upload/gif', rateLimitMiddleware('image_upload'));

// Upload Defaults (Templates) - All operations require auth
app.use('/api/upload-defaults/*', authMiddleware);
app.use('/api/upload-defaults', authMiddleware);

// AUTHENTICATED endpoints (require valid JWT token)
openapi.post("/api/videos", VideoCreate);
openapi.post("/api/videos/upload", VideoUpload);
openapi.post("/api/videos/upload/initiate", UploadInitiateEndpoint);
openapi.post("/api/videos/upload/batch/initiate", UploadBatchInitiateEndpoint);
openapi.post("/api/videos/upload/complete", UploadCompleteEndpoint);
openapi.get("/api/videos/upload/resume/:videoId", UploadResumeEndpoint);
openapi.put("/api/videos/:id", VideoUpdate);
openapi.delete("/api/videos/:id", VideoDelete);
openapi.get("/api/videos/:id/upload-status", VideoUploadStatus);
openapi.put("/api/videos/:id/chapters", VideoChaptersUpdate); // Update video chapters (manual edit)
openapi.post("/api/videos/:videoId/subtitles", SubtitlesUpload); // Upload subtitle track
openapi.delete("/api/videos/:videoId/subtitles/:language", SubtitlesDelete); // Delete subtitle track

// Video Scheduling (require auth)
openapi.post("/api/videos/:id/schedule", VideoScheduleCreate); // Schedule video publication
openapi.patch("/api/videos/:id/schedule", VideoScheduleUpdate); // Reschedule video publication
openapi.delete("/api/videos/:id/schedule", VideoScheduleDelete); // Cancel scheduled publication
openapi.get("/api/videos/:id/schedule", VideoScheduleFetch); // Get schedule status
openapi.get("/api/videos/scheduled", VideoScheduleList); // List all scheduled videos

openapi.post("/api/profiles", ProfileCreate);
openapi.put("/api/profiles/:id", ProfileUpdate);
openapi.delete("/api/profiles/:id", ProfileDelete);

// Watch history management (require auth)
openapi.post("/api/profiles/watch-history", WatchHistoryAdd);
openapi.get("/api/profiles/watch-history", WatchHistoryList);

// New Watch History System (require auth)
openapi.post("/api/watch-history", RecordWatchHistory);
openapi.get("/api/watch-history", ListWatchHistory);
openapi.delete("/api/watch-history", ClearWatchHistory);
openapi.delete("/api/watch-history/:videoId", DeleteWatchHistory);
openapi.post("/api/watch-history/:videoId/progress", UpdateWatchProgress);
openapi.get("/api/watch-history/:videoId/progress", GetWatchProgress);

// Profile photo/cover routes (also require auth)
app.put("/api/profiles/:id/avatar", authMiddleware, handleAvatarUpdate);
app.put("/api/profiles/:id/cover", authMiddleware, handleCoverUpdate);

// Channel photo/cover routes (also require auth)
app.put("/api/channels/:id/avatar", authMiddleware, handleChannelAvatarUpdate);
app.put("/api/channels/:id/cover", authMiddleware, handleChannelCoverUpdate);

// Playlist management (require auth)
openapi.post("/api/playlists", PlaylistCreate);
openapi.patch("/api/playlists/:id", PlaylistUpdate);
openapi.delete("/api/playlists/:id", PlaylistDelete);
openapi.post("/api/playlists/:id/videos", PlaylistAddVideo);
openapi.delete("/api/playlists/:id/videos/:videoId", PlaylistRemoveVideo);

// Channel management (require auth)
openapi.post("/api/channels", ChannelCreate);
openapi.put("/api/channels/:id", ChannelUpdate);
openapi.delete("/api/channels/:id", ChannelDelete);

// Subscription management (require auth)
openapi.post("/api/channels/:id/subscriptions", SubscriptionCreate);
openapi.delete("/api/channels/:id/subscriptions", SubscriptionDelete);

// Channel Tabs management (require auth for PUT)
openapi.put("/api/channels/:id/tabs", ChannelTabsUpdate);

// Channel Sections management
openapi.get("/api/channels/:channelId/sections", ChannelSectionsList); // Public: list sections
openapi.get("/api/channels/:channelId/sections/:sectionId", ChannelSectionFetch); // Public: get section
openapi.post("/api/channels/:channelId/sections", ChannelSectionCreate); // Auth required: create
openapi.put("/api/channels/:channelId/sections/:sectionId", ChannelSectionUpdate); // Auth required: update
openapi.delete("/api/channels/:channelId/sections/:sectionId", ChannelSectionDelete); // Auth required: delete
openapi.patch("/api/channels/:channelId/sections/reorder", ChannelSectionReorder); // Auth required: reorder (PATCH)

// Comment management (require auth)
openapi.post("/api/videos/:id/comments", CommentCreate);
openapi.put("/api/videos/:id/comments/:cid", CommentUpdate);
openapi.delete("/api/videos/:id/comments/:cid", CommentDelete);
openapi.post("/api/videos/:id/comments/:cid/likes", LikeCreate);
openapi.delete("/api/videos/:id/comments/:cid/likes", LikeDelete);
openapi.post("/api/videos/:id/comments/:cid/dislikes", DislikeCreate);
openapi.delete("/api/videos/:id/comments/:cid/dislikes", DislikeDelete);

// Video likes/dislikes (require auth)
openapi.post("/api/videos/:id/likes", LikeCreate);
openapi.delete("/api/videos/:id/likes", LikeDelete);
openapi.post("/api/videos/:id/dislikes", DislikeCreate);
openapi.delete("/api/videos/:id/dislikes", DislikeDelete);

// Phase 2: AUTHENTICATED endpoints (require valid JWT token)
// Live Streaming management (require auth)
openapi.post("/api/live-streams", LiveStreamCreate);
openapi.patch("/api/live-streams/:id", LiveStreamUpdate);

// Content Moderation (require auth)
openapi.post("/api/moderation/report", ReportCreate);
openapi.post("/api/moderation/actions/:reportId", ModerationAction);

// Community Posts management (require auth)
openapi.post("/api/community/posts", CreateCommunityPost);
openapi.put("/api/community/posts/:postId", UpdateCommunityPost);
openapi.delete("/api/community/posts/:postId", DeleteCommunityPost);
openapi.post("/api/community/posts/:postId/like", LikeCommunityPost);
openapi.delete("/api/community/posts/:postId/like", UnlikeCommunityPost);
openapi.post("/api/community/posts/:postId/vote", VoteOnPoll);

// Community Posts - Comments management (require auth)
openapi.post("/api/community/posts/:postId/comments", CreatePostComment);
openapi.put("/api/community/posts/:postId/comments/:commentId", UpdatePostComment);
openapi.delete("/api/community/posts/:postId/comments/:commentId", DeletePostComment);
openapi.post("/api/community/posts/:postId/comments/:commentId/like", LikePostComment);
openapi.delete("/api/community/posts/:postId/comments/:commentId/like", UnlikePostComment);

// Community Posts - Media Upload (require auth)
openapi.post("/api/community/media/upload/images", UploadCommunityPostImages);
openapi.post("/api/community/media/upload/gif", UploadCommunityPostGif);

// Upload Defaults (Templates) management (require auth)
openapi.get("/api/upload-defaults", ListUploadDefaultsEndpoint);
openapi.post("/api/upload-defaults", CreateUploadDefaultEndpoint);
openapi.get("/api/upload-defaults/:id", GetUploadDefaultEndpoint);
openapi.put("/api/upload-defaults/:id", UpdateUploadDefaultEndpoint);
openapi.delete("/api/upload-defaults/:id", DeleteUploadDefaultEndpoint);
openapi.put("/api/upload-defaults/:id/default", SetDefaultTemplateEndpoint);

// Override the default OpenAPI document to include authentication
app.get("/openapi.json", async (c) => {
	// Get the original OpenAPI document from Chanfana
	const originalDoc = await (openapi as any).getOpenAPIDocument();

	// Add security schemes
	if (!originalDoc.components) {
		originalDoc.components = {};
	}
	originalDoc.components.securitySchemes = {
		BearerAuth: {
			type: "http",
			scheme: "bearer",
			bearerFormat: "JWT",
			description: "JWT authentication using Bearer tokens. Format: 'Bearer {token}'. Obtain tokens from your OpenAuth provider."
		}
	};

	// Add shared response components as recommended by the specification
	if (!originalDoc.components.responses) {
		originalDoc.components.responses = {};
	}
	originalDoc.components.responses.UnauthorizedError = {
		description: "Access token is missing or invalid",
		content: {
			"application/json": {
				schema: {
					type: "object",
					properties: {
						success: { type: "boolean", example: false },
						error: { type: "string", example: "Missing or invalid Authorization header. Expected: Bearer <token>" }
					}
				}
			}
		}
	};
	originalDoc.components.responses.ForbiddenError = {
		description: "Insufficient permissions or token validation failed",
		content: {
			"application/json": {
				schema: {
					type: "object",
					properties: {
						success: { type: "boolean", example: false },
						error: { type: "string", example: "Authentication failed" }
					}
				}
			}
		}
	};

	// Add security requirements to authenticated endpoints
	const authenticatedPaths = [
		// Authentication test
		'/auth-test', // GET (for testing)
		// Video management
		'/api/videos', // POST
		'/api/videos/upload/initiate', // POST
		'/api/videos/upload/batch/initiate', // POST
		'/api/videos/upload/complete', // POST
		'/api/videos/upload/resume/{videoId}', // GET
		'/api/videos/{id}', // PUT, DELETE
		'/api/videos/{id}/chapters', // PUT (manual edit)
		'/api/videos/{videoId}/subtitles', // POST (upload)
		'/api/videos/{videoId}/subtitles/{language}', // DELETE
		// Video Scheduling
		'/api/videos/{id}/schedule', // POST, PATCH, DELETE, GET
		'/api/videos/scheduled', // GET
		'/api/videos/{id}/likes', // POST, DELETE
		'/api/videos/{id}/dislikes', // POST, DELETE
		'/api/videos/{id}/comments', // POST
		'/api/videos/{id}/comments/{cid}', // PUT, DELETE
		'/api/videos/{id}/comments/{cid}/likes', // POST, DELETE
		'/api/videos/{id}/comments/{cid}/dislikes', // POST, DELETE
		// Profile management
		'/api/profiles', // POST
		'/api/profiles/{id}', // PUT, DELETE
		'/api/profiles/{id}/avatar', // PUT
		'/api/profiles/{id}/cover', // PUT
		// Channel management
		'/api/channels', // POST
		'/api/channels/{id}', // PUT, DELETE
		'/api/channels/{id}/avatar', // PUT
		'/api/channels/{id}/cover', // PUT
		'/api/channels/{id}/subscriptions', // POST, DELETE
		'/api/channels/{id}/tabs', // PUT (update tabs)
		// Channel Sections management
		'/api/channels/{channelId}/sections', // POST (create)
		'/api/channels/{channelId}/sections/{sectionId}', // PUT, DELETE
		'/api/channels/{channelId}/sections/reorder', // PATCH
		// Playlist management
		'/api/playlists', // POST
		'/api/playlists/{id}', // PUT, DELETE
		'/api/playlists/{id}/videos', // POST, DELETE
		// Watch History (new system)
		'/api/watch-history', // POST, GET, DELETE
		'/api/watch-history/{videoId}', // DELETE
		'/api/watch-history/{videoId}/progress', // POST, GET
		// Phase 2: Live Streaming management
		'/api/live-streams', // POST
		'/api/live-streams/{id}', // PATCH
		// Phase 2: Analytics
		'/api/analytics', // GET (requires auth)
		// Phase 2: Content Moderation
		'/api/moderation/report', // POST
		'/api/moderation/actions/{reportId}', // POST
		// Community Posts management
		'/api/community/posts', // POST (create)
		'/api/community/posts/{postId}', // PUT, DELETE
		'/api/community/posts/{postId}/like', // POST, DELETE
		'/api/community/posts/{postId}/vote', // POST
		// Community Posts - Comments management
		'/api/community/posts/{postId}/comments', // POST (create)
		'/api/community/posts/{postId}/comments/{commentId}', // PUT, DELETE
		'/api/community/posts/{postId}/comments/{commentId}/like', // POST, DELETE
		// Community Posts - Media Upload
		'/api/community/media/upload/images', // POST
		'/api/community/media/upload/gif', // POST
		// Upload Defaults (Templates) management
		'/api/upload-defaults', // GET, POST
		'/api/upload-defaults/{id}', // GET, PUT, DELETE
		'/api/upload-defaults/{id}/default', // PUT
	];

	// Add security requirements to authenticated endpoints
	for (const path of authenticatedPaths) {
		if (originalDoc.paths && originalDoc.paths[path]) {
			const methods = path === '/auth-test' ? ['get'] : ['post', 'put', 'patch', 'delete'];
			for (const method of methods) {
				if (originalDoc.paths[path][method]) {
					// Add security requirement
					originalDoc.paths[path][method].security = [{ BearerAuth: [] }];

					// Add authentication error responses if not already present
					if (!originalDoc.paths[path][method].responses) {
						originalDoc.paths[path][method].responses = {};
					}

					if (!originalDoc.paths[path][method].responses['401']) {
						originalDoc.paths[path][method].responses['401'] = {
							"$ref": "#/components/responses/UnauthorizedError"
						};
					}

					if (!originalDoc.paths[path][method].responses['403']) {
						originalDoc.paths[path][method].responses['403'] = {
							"$ref": "#/components/responses/ForbiddenError"
						};
					}
				}
			}
		}
	}

	return c.json(originalDoc);
});

// Override openapi.json to add OAuth2 configuration
app.get("/openapi.json", async (c) => {
	// Get the base OpenAPI document from Chanfana
	const originalRequest = new Request(c.req.url);
	const response = await openapi.fetch(originalRequest);
	const doc = await response.json() as any;

	// Add OAuth2 security schemes
	if (!doc.components) {
		doc.components = {};
	}
	if (!doc.components.securitySchemes) {
		doc.components.securitySchemes = {};
	}

	doc.components.securitySchemes.OpenAuthOAuth2 = {
		type: "oauth2",
		description: "OAuth2 authentication via OpenAuth",
		flows: {
			authorizationCode: {
				authorizationUrl: "https://your-openauth-issuer.com/authorize",
				tokenUrl: "https://your-openauth-issuer.com/token",
				scopes: {
					"openid": "OpenID Connect scope",
					"profile": "Access to user profile information",
					"email": "Access to user email"
				}
			}
		}
	};

	doc.components.securitySchemes.BearerAuth = {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description: "JWT Bearer token authentication. Use this if you already have a token."
	};

	// Add global security (users can choose either OAuth2 or Bearer)
	doc.security = [
		{ OpenAuthOAuth2: ["openid", "profile", "email"] },
		{ BearerAuth: [] }
	];

	return c.json(doc);
});

// Override the main docs route to add OAuth2 initialization
app.get("/", async (c) => {
	// Get the original HTML from Chanfana
	const originalRequest = new Request(c.req.url);
	const response = await openapi.fetch(originalRequest);
	let html = await response.text();

	// Inject OAuth2 initialization script
	const oauthScript = `
	<script>
	// Wait for Swagger UI to load, then initialize OAuth
	window.addEventListener('load', function() {
		// Find the Swagger UI instance (it's usually available globally)
		setTimeout(function() {
			if (window.ui) {
				window.ui.initOAuth({
					clientId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
					realm: "al-ummah-now",
					appName: "Al-Ummah Now Videos API",
					scopeSeparator: " ",
					scopes: "openid profile email",
					additionalQueryStringParams: {},
					useBasicAuthenticationWithAccessCodeGrant: false,
					usePkceWithAuthorizationCodeGrant: true
				});
				logger.info("OAuth2 initialized for Swagger UI");
			}
		}, 1000);
	});
	</script>`;

	// Inject the script before the closing </body> tag
	html = html.replace('</body>', oauthScript + '</body>');

	return c.html(html);
});

// Export the Hono app
export default app;
