import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors'
import { authMiddleware, optionalAuthMiddleware, channelIdMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';

// TUS Proxy import (not in routers yet)
import { createTusRouter } from "./endpoints/video/tus";
// Profile/Channel image upload handlers (not in routers yet)
import handleAvatarUpdate from "./endpoints/profile/profileAvatarUpdate";
import handleCoverUpdate from "./endpoints/profile/profileCoverUpdate";
import handleChannelAvatarUpdate from "./endpoints/channel/channelAvatarUpdate";
import handleChannelCoverUpdate from "./endpoints/channel/channelCoverUpdate";

// ==========================================
// APP SETUP
// ==========================================

const app = new Hono();

// Register global error handler (catches all unhandled errors)
app.onError(errorHandler);

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================

// Setup CORS for all routes
app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'channelId', 'userId', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Defer-Length', 'Upload-Concat'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Allow', 'Location', 'Tus-Resumable', 'Tus-Version', 'Tus-Max-Size', 'Tus-Extension', 'Upload-Offset', 'Upload-Length', 'Upload-Metadata'],
	maxAge: 600,
	credentials: false,
}));

// Add comprehensive logging middleware for ALL routes
app.use('*', loggingMiddleware);

// ==========================================
// OPTIONS HANDLERS
// ==========================================

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
	c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, channelId, userId, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Upload-Defer-Length, Upload-Concat');
	c.header('Access-Control-Expose-Headers', 'Location, Tus-Resumable, Tus-Version, Tus-Max-Size, Tus-Extension, Upload-Offset, Upload-Length, Upload-Metadata');
	c.header('Access-Control-Max-Age', '600');
	c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
	return new Response('', { status: 204 });
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

// Add authentication middleware to all API routes
// Use optionalAuthMiddleware for GET endpoints (allow both authenticated and public access)
// Use authMiddleware for CUD operations (require authentication)
app.use('/api/*', optionalAuthMiddleware);

// Validate channelId header when present
// This middleware verifies that the channelId belongs to the authenticated user
// It must run after auth middleware so the user context is available
app.use('/api/*', channelIdMiddleware);

// ==========================================
// RATE LIMITING
// ==========================================

// SECURITY: Apply rate limiting to video upload endpoints
app.use('/api/videos/upload', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/initiate', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/batch/initiate', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/complete', rateLimitMiddleware('video_upload'));
app.use('/api/videos/upload/resume/:videoId', rateLimitMiddleware('video_upload'));

// SECURITY: Apply rate limiting to community media uploads
app.use('/api/community/media/upload/images', rateLimitMiddleware('image_upload'));
app.use('/api/community/media/upload/gif', rateLimitMiddleware('image_upload'));

// ==========================================
// TUS PROXY
// ==========================================

// TUS Proxy: Apply authentication and rate limiting
app.use('/api/videos/tus', authMiddleware); // Require authentication for all TUS operations
app.use('/api/videos/tus/*', authMiddleware);
app.use('/api/videos/tus', rateLimitMiddleware('video_upload')); // Apply rate limiting
app.use('/api/videos/tus/*', rateLimitMiddleware('video_upload'));

// Mount the TUS proxy router
const tusRouter = createTusRouter();
app.route('/api/videos/tus', tusRouter);

// ==========================================
// PROFILE/CHANNEL IMAGE UPLOADS
// ==========================================

// Profile photo/cover routes (require auth)
app.put("/api/profile/avatar", authMiddleware, handleAvatarUpdate);
app.put("/api/profile/cover", authMiddleware, handleCoverUpdate);

// Channel photo/cover routes (require auth)
app.put("/api/channels/:id/avatar", authMiddleware, handleChannelAvatarUpdate);
app.put("/api/channels/:id/cover", authMiddleware, handleChannelCoverUpdate);

// ==========================================
// OPENAPI SETUP
// ==========================================

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

// ==========================================
// REGISTER ALL ROUTES
// ==========================================

registerAllRouters(openapi);

// ==========================================
// OPENAPI CUSTOMIZATION
// ==========================================

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

// ==========================================
// EXPORT
// ==========================================

export default app;
