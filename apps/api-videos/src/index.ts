import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors'
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth";
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
import { Metrics } from "./endpoints/monitoring/metrics";
import { StatusPage } from "./endpoints/monitoring/statusPage";
// Phase 2: Live Streaming imports
import { LiveStreamCreate } from "./endpoints/live/liveStreamCreate";
import { LiveStreamsList } from "./endpoints/live/liveStreamsList";
import { LiveStreamUpdate } from "./endpoints/live/liveStreamUpdate";
// Phase 2: Analytics imports
import { AnalyticsGet } from "./endpoints/analytics/analyticsGet";
// Phase 2: Content Moderation imports
import { ReportCreate } from "./endpoints/moderation/reportCreate";
import { ModerationAction } from "./endpoints/moderation/moderationAction";


// Start a Hono app - testing reload
const app = new Hono();

// Setup CORS for all routes
app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'channelId', 'userId'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Allow'],
	maxAge: 600,
	credentials: false,
}));

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
				url: "http://127.0.0.1:8686",
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

// Register OpenAPI endpoints
// PUBLIC endpoints (optional auth - work without authentication)
openapi.get("/api/videos", VideosList);
openapi.get("/api/videos/search", VideoSearch);
openapi.get("/api/videos/:id", VideoFetch);
openapi.post("/api/videos/:id/view", VideoView); // View tracking (analytics)
openapi.get("/api/profiles", ProfilesList);
openapi.get("/api/profiles/:id", ProfileFetch);
openapi.get("/api/playlists", PlaylistsList);
openapi.get("/api/playlists/:id", PlaylistFetch);
openapi.get("/api/channels", ChannelsList);
openapi.get("/api/channels/:id", ChannelFetch);
// Phase 2: Live Streaming endpoints
openapi.get("/api/live-streams", LiveStreamsList);
// Phase 2: Analytics endpoints  
openapi.get("/api/analytics", AnalyticsGet);

// Monitoring and testing endpoints (public)
openapi.get("/health", HealthCheck);
openapi.get("/metrics", Metrics);
openapi.get("/test", TestRunner);
openapi.get("/status", StatusPage);

// Authentication test endpoint (requires auth)
openapi.get("/auth-test", AuthTest);

// Apply authentication middleware to routes that require login
app.use('/auth-test', authMiddleware);

app.use('/api/videos', (c, next) => {
	// Allow GET requests and POST to /:id/view (view tracking) without authentication
	if (c.req.method === 'GET' || 
		(c.req.method === 'POST' && c.req.path.endsWith('/view'))) {
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

// AUTHENTICATED endpoints (require valid JWT token)
openapi.post("/api/videos", VideoCreate);
openapi.post("/api/videos/upload", VideoUpload);
openapi.post("/api/videos/upload/initiate", UploadInitiateEndpoint);
openapi.post("/api/videos/upload/complete", UploadCompleteEndpoint);
openapi.put("/api/videos/:id", VideoUpdate);
openapi.delete("/api/videos/:id", VideoDelete);
openapi.get("/api/videos/:id/upload-status", VideoUploadStatus);

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
		'/api/videos/upload/complete', // POST
		'/api/videos/{id}', // PUT, DELETE
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
				console.log("OAuth2 initialized for Swagger UI");
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
