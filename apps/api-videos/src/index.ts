import { reportServerError, withErrorReporting, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { SUBSCRIPTION_IMPORT_CRON, importPendingSubscriptions } from './lib/subscription-import';
import { handleProcessingCheckBatch, sweepProcessingVideos } from './lib/processing/loop';
import { handleReaperBatch, isReaperMessage, sweepStaleUploads } from './lib/uploads/reaper';
import { handleBunnyDeleteBatch, isBunnyDeleteMessage } from './lib/uploads/bunnyDelete';
import { handleCollectionBackfillMessage, isCollectionBackfillMessage } from './lib/bunny/collectionBackfill';
import { handlePurgeBatch, isPurgeMessage, startScheduledPurge } from './lib/uploads/testLibraryPurge';
import { handleMediaMoveBatch, isMediaMoveMessage, sweepMediaJobs } from './lib/media/r2-delivery';
import { flushIndexNow } from './lib/indexnow';
import { collectDeliveryCosts } from './lib/media/costs';
import { sweepOriginals } from './lib/media/originals';
import { createMediaInternalRouter } from './endpoints/media/mediaInternal';
import { createNotificationsInternalRouter } from './endpoints/notifications/notificationsInternal';
import { sweepRunUsers } from './lib/e2e/runUserSweep';
import { handlePlaylistAddBatch, isPlaylistAddMessage } from './lib/playlistUploadAdds';
import { createPlaylistAddsInternalRouter } from './endpoints/playlist/playlistAddsInternal';

/** Every 10 minutes: start a processing-check loop for any video stuck without one */
const PROCESSING_SWEEP_CRON = '*/10 * * * *';
/** Every minute: live sessions (idle timeout, Bunny polling); lib/live/service.ts */
const LIVE_SWEEP_CRON = '* * * * *';
import { fromHono } from "chanfana";
import { bunnySigningMiddleware } from './middleware/bunny-signing';
import { Hono } from "hono";
import { cors } from 'hono/cors'
import { isAllowedOrigin } from './lib/cors';
import { authMiddleware, optionalAuthMiddleware, channelIdMiddleware } from "./middleware/auth";
import { videosBanMiddleware } from "./middleware/videos-ban";
import { videosPendingDeletionMiddleware } from "./middleware/videos-pending-deletion";
import adminInternalRouter from "./routers/admin.router";
import { handleLiveEdge, isLiveHost } from "./lib/live/edge";
import type { LiveEnv } from "./lib/live/providers";
import { sweepLiveSessions } from "./lib/live/service";
import { markStreamLive, registerLiveStreamHooks, type StreamsEnv } from "./lib/live/streams";
import { pruneLiveData } from "./lib/live/qoe";
import { loggingMiddleware } from "./middleware/logging";
import { videoListInvalidation } from './lib/videoListCache';
import { withLogging } from "@al-ummah/logger";
import { errorHandler } from "./middleware/error-handler";
import { pruneRateLimits, rateLimitMiddleware } from "./middleware/rate-limit";
import { UPLOAD_CONTINUE_PATHS, UPLOAD_SESSION_PATHS, uploadContinueLimitMiddleware, uploadSessionLimitMiddleware } from "./middleware/upload-limits";
import { pruneLimitHits } from "./lib/creatorTiers";
import { channelCreateGate, handleCreatorAccess } from "./endpoints/creator/creatorAccess";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';
import type { AppBindings } from './base';
import { enforceRetention } from './lib/privacy/retention';
import { DEFAULT_OPERATION_BUDGET, OperationBudget } from './lib/privacy/scan';
import { withSearchSync } from './lib/search/sync';
import { handleAdminJobBatch, type JobMessage } from './lib/admin/jobs';
import { ADMIN_JOB_HANDLERS, purgeDeletion } from './lib/admin/service';
import { runDeletionCleanup } from './lib/admin/deletions';
import { reconcileSearchIndex } from './lib/search/backfill';
import { reconcileOwnershipIndex } from './lib/search/ownership';
import { API_VERSION_HEADER, deprecationHeaders, findDeprecation, resolveApiVersion, unsupportedVersionResponse } from './lib/api-version';
import { buildContractDocument } from './lib/api-contract';

// TUS Proxy import (not in routers yet)
import { sweepStalledUploads } from "./lib/uploads/lifecycle";
import { createTusRouter } from "./endpoints/video/tus";
import { createProcessingInternalRouter } from "./endpoints/video/processingInternal";
import scholarsInternalRouter from "./routers/scholars-internal.router";
import postsInternalRouter from "./routers/posts-internal.router";
import { sitesInternalRouter, sitesRouter } from "./routers/sites.router";
import { publishDuePosts } from "./lib/scheduled-posts";
import { createUploadsInternalRouter } from "./endpoints/video/uploadsInternal";
import { createVideoFormatInternalRouter } from "./endpoints/video/videoFormatInternal";
import { createFootprintsInternalRouter } from "./endpoints/privacy/footprintsInternal";
import { handleFootprintBackfillMessage, isFootprintBackfillMessage, maintainFootprintPasses } from "./lib/privacy/footprints";
import { handleVideoFormatMessage, startDailyVideoFormatRun } from "./lib/video-format/job";
import { handlePublishedAtBackfillMessage, isPublishedAtBackfillMessage } from "./lib/publishedAtBackfill";
import { handleMp4BackfillMessage, isMp4BackfillMessage } from "./lib/media/mp4-backfill";
import { handleArchivePrivacyMessage, isArchivePrivacyMessage } from "./lib/archivePrivacyRewrite";
import { startDailyThumbnailCheck } from "./lib/thumbnail/repair";
import { VIDEO_FORMAT_JOB_KIND } from "@al-ummah/shared-types";
// Profile/Channel image upload handlers (not in routers yet)
import handleAvatarUpdate from "./endpoints/profile/profileAvatarUpdate";
import handleCoverUpdate from "./endpoints/profile/profileCoverUpdate";
import handleChannelAvatarUpdate from "./endpoints/channel/channelAvatarUpdate";
import handleChannelCoverUpdate from "./endpoints/channel/channelCoverUpdate";
import { robotsTxtResponse, withNoIndex } from './lib/crawlers';

// ==========================================
// APP SETUP
// ==========================================

const app = new Hono<{ Bindings: AppBindings }>();

// Register global error handler (catches all unhandled errors)
app.onError(errorHandler);

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================

// Allowed origins (CORS_ORIGINS, local defaults, www dev servers on the public play routes): lib/cors.ts
const allowOrigin = (origin: string, c: { env: AppBindings; req: { path: string; method: string } }): string =>
	isAllowedOrigin(origin, c.env as never, { path: c.req.path, method: c.req.method }) ? origin : '';

// Setup CORS for all routes
app.use('*', cors({
	// origin callback receives (origin, context) - context has env access
	origin: (origin, c) => allowOrigin(origin, c as never),
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'channelId', 'userId', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Defer-Length', 'Upload-Concat'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Allow', 'Location', 'Tus-Resumable', 'Tus-Version', 'Tus-Max-Size', 'Tus-Extension', 'Upload-Offset', 'Upload-Length', 'Upload-Metadata', 'X-API-Version', 'Deprecation', 'Sunset', 'Retry-After', 'Date'],
	maxAge: 600,
	credentials: false,
}));

// Internal / diagnostic endpoints require the service-to-service key
// (X-API-Key == INTERNAL_API_KEY). They mutate storage or expose internals.
const INTERNAL_PATHS = ['/internal/*', '/test', '/test-error', '/api/i18n/sync'];
for (const p of INTERNAL_PATHS) {
	app.use(p, async (c, next) => {
		const binding = (c.env as unknown as { INTERNAL_API_KEY?: string | { get(): Promise<string> } }).INTERNAL_API_KEY;
		const expected = typeof binding === 'string' ? binding : await binding?.get();
		const provided = c.req.header('X-API-Key');
		if (!expected || !provided || provided !== expected) {
			return c.json({ success: false, error: 'Unauthorized' }, 401);
		}
		return next();
	});
}

// Add comprehensive logging middleware for ALL routes
app.use('*', loggingMiddleware);
// A delete, edit or hide drops the cached anonymous first page of the list (#1131)
app.use('*', videoListInvalidation);

// Public API contract (Epic 9.3), served as /api/v1/openapi.json. Registered
// before the /api/* auth and URL-signing middleware: it is static and public.
app.get('/api/openapi.json', async (c) => {
	c.header('Cache-Control', 'public, max-age=300');
	return c.json(await getContractDocument());
});

// ==========================================
// OPTIONS HANDLERS
// ==========================================

// Explicit OPTIONS handler for profile endpoints
app.options('/api/profile*', (c) => {
	const origin = c.req.header('Origin') || '';
	const allowedOrigin = allowOrigin(origin, c as never);
	if (allowedOrigin) {
		c.header('Access-Control-Allow-Origin', allowedOrigin);
	}
	c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, channelId, userId');
	c.header('Access-Control-Max-Age', '600');
	c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	return new Response('', { status: 204 });
});

// Explicit OPTIONS handler for all API endpoints
app.options('/api/*', (c) => {
	const origin = c.req.header('Origin') || '';
	const allowedOrigin = allowOrigin(origin, c as never);
	if (allowedOrigin) {
		c.header('Access-Control-Allow-Origin', allowedOrigin);
	}
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

// Videos bans (admin-web Users): a banned usr_ id reads like a visitor and changes nothing.
app.use('/api/*', videosBanMiddleware);
// A pending admin "Delete videos data" (30 days, #701): signs in and reads, changes nothing; restore lifts it.
app.use('/api/*', videosPendingDeletionMiddleware);

// Validate channelId header when present
// This middleware verifies that the channelId belongs to the authenticated user
// It must run after auth middleware so the user context is available
app.use('/api/*', channelIdMiddleware);

// Sign Bunny Stream URLs in responses for CDN token authentication
// (no-op unless BUNNY_SIGN_URLS is "true"; see middleware/bunny-signing.ts)
app.use('/api/*', bunnySigningMiddleware);
// Admin video details carry play/thumbnail URLs for the admin player preview
app.use('/internal/admin/*', bunnySigningMiddleware);

// ==========================================
// RATE LIMITING
// ==========================================

// SECURITY: Uploading is by invitation (creator tiers, middleware/upload-limits.ts).
// No tier: every session route, TUS create and complete answer 403. A tier's
// limits count new upload SESSIONS, once per video (#290); the calls that
// continue an initiated upload (TUS HEAD/PATCH/DELETE, resume) are not counted.
// Rejected initiations are refused before any video record is created.
const uploadSessionLimit = uploadSessionLimitMiddleware();
for (const path of UPLOAD_SESSION_PATHS) app.use(path, uploadSessionLimit);
// TUS create and complete: a looser per-user bucket so a session cannot be replayed without bound
const uploadContinueLimit = uploadContinueLimitMiddleware();
for (const path of UPLOAD_CONTINUE_PATHS) app.use(path, uploadContinueLimit);

// Channel creation is by invitation too: a creator tier, within its channel limit
app.use('/api/channels', channelCreateGate);
app.use('/api/channels/', channelCreateGate);
// What the signed-in user may do (Upload, Create channel) for the web UI
app.get('/api/me/creator', authMiddleware, handleCreatorAccess);

// SECURITY: Apply rate limiting to community media uploads
app.use('/api/community/media/upload/images', rateLimitMiddleware('image_upload'));
app.use('/api/community/media/upload/gif', rateLimitMiddleware('image_upload'));
app.use('/api/videos/:id/thumbnail', rateLimitMiddleware('image_upload'));
// AI category suggestions: forms debounce typing; this caps a client that does not
app.use('/api/videos/category-suggestions', rateLimitMiddleware('category_suggest', {
	limits: () => ({ perMinute: 10, perHour: 60, perDay: 300, maxConcurrent: 3 }),
	methods: ['POST'],
}));

// ==========================================
// TUS PROXY
// ==========================================

// TUS Proxy: authentication only. Every TUS request needs a session from an
// (already rate-limited) initiate, and the proxy checks it belongs to this user.
app.use('/api/videos/tus', authMiddleware); // Require authentication for all TUS operations
app.use('/api/videos/tus/*', authMiddleware);

// Mount the TUS proxy router
const tusRouter = createTusRouter();
app.route('/api/videos/tus', tusRouter);
// Processing health / repair (internal; admin-api proxies with RBAC + audit)
app.route('/internal/processing', createProcessingInternalRouter() as never);
// Stale uploads (abandoned placeholders, Bunny orphans): the reaper's admin side
app.route('/internal/uploads', createUploadsInternalRouter() as never);
// Short/video format backfill (ops; admins go through admin-api)
app.route('/internal/video-format', createVideoFormatInternalRouter() as never);
// Privacy footprint backfill (#1073): lets account erasure find a user's data without bucket scans
app.route('/internal/privacy/footprints', createFootprintsInternalRouter() as never);
// New uploads → playlists: the admin Errors page's Retry on a failed add
app.route('/internal/playlist-adds', createPlaylistAddsInternalRouter() as never);
// Scholars (the CMS): their channels and their articles on the Community tab
app.route('/internal/scholars', scholarsInternalRouter as never);
// Community posts for the CMS (www scholar post pages; wiki AUN-SCHOLAR-SITES §6.3)
app.route('/internal/posts', postsInternalRouter as never);
// White-label scholar sites (wiki AUN-SCHOLAR-SITES): admin-api grants; the sites Worker and Studio read and edit
app.route('/internal/sites', sitesInternalRouter as never);
app.route('/api/sites', sitesRouter as never);
// R2 delivery beside Bunny (epic #687): apps/media's callbacks, admin retry / jobs / settings
app.route('/internal/media', createMediaInternalRouter() as never);
// Platform notification settings (admin-api proxies with the admin role + audit)
app.route('/internal/notifications', createNotificationsInternalRouter() as never);

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

// Platform content management for admin-api (X-API-Key, see INTERNAL_PATHS)
app.route('/internal/admin', adminInternalRouter);

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

/**
 * Crons (wrangler `triggers.crons`): hourly, the subscription import, the
 * stalled-upload sweep and the privacy footprint pass upkeep;
 * daily, enforce data retention (Story 1.3, AC 5).
 * See src/lib/privacy/retention.ts and docs/compliance/GDPR.md.
 */
async function scheduled(controller: ScheduledController, rawEnv: AppBindings, ctx: ExecutionContext): Promise<void> {
	if (controller?.cron === LIVE_SWEEP_CRON) {
		// Every minute: scheduled community posts whose time has come go live (lib/scheduled-posts.ts, #1218)
		ctx.waitUntil(
			publishDuePosts(rawEnv as never)
				.then((r) => (r.published || r.dropped ? logger.info('[ScheduledPosts] Run', r) : undefined))
				.catch((error) => logger.error('[ScheduledPosts] Run failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		// Every minute: end self-hosted sessions whose encoder went quiet, poll live Bunny sessions (lib/live/service.ts)
		ctx.waitUntil(
			sweepLiveSessions(rawEnv as unknown as LiveEnv)
				.then((r) => (r.idleEnded || r.bunnyPolled ? logger.info('[Live] Sweep', r) : undefined))
				.catch((error) => logger.error('[Live] Sweep failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		return;
	}
	if (controller?.cron === PROCESSING_SWEEP_CRON) {
		// Safety net for the per-video processing-check loop (lib/processing/loop.ts)
		ctx.waitUntil(
			sweepProcessingVideos(withSearchSync(rawEnv, ctx) as never).catch((error) =>
				logger.error('[ProcessingSweep] Run failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// R2 transcodes stuck in queued/transcoding (lib/media/r2-delivery.ts)
		ctx.waitUntil(
			sweepMediaJobs(rawEnv as never).then(
				() => undefined,
				(error) => logger.error('[MediaSweep] Run failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// Watch pages whose public content changed go to IndexNow (lib/indexnow.ts; production only)
		ctx.waitUntil(
			flushIndexNow(rawEnv as never).then(
				(r) => (r.sent ? logger.info('[IndexNow] Pinged', r) : undefined),
				(error) => logger.error('[IndexNow] Flush failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// QA / stage only: erase the videos data (profile, channels, videos and their Bunny media) of
		// E2E run accounts the auth server has deleted (lib/e2e/runUserSweep.ts)
		ctx.waitUntil(sweepRunUsers(withSearchSync(rawEnv, ctx) as never).then(() => undefined));
		return;
	}
	if (controller?.cron === SUBSCRIPTION_IMPORT_CRON) {
		// Hourly: the upload reaper's safety-net sweep (lib/uploads/reaper.ts);
		// record writes go through the search-sync wrapper so an abandoned
		// placeholder leaves the channel's lists.
		ctx.waitUntil(
			sweepStaleUploads(withSearchSync(rawEnv, ctx) as never).catch((error) =>
				logger.error('[UploadReaper] Sweep failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// Hourly, QA / stage only: purge the test library's leaked Bunny videos (no record,
		// or a record soft-deleted 30+ min ago; lib/uploads/testLibraryPurge.ts)
		ctx.waitUntil(startScheduledPurge(rawEnv as never).then(() => undefined));
		// Hourly: privacy footprint passes ops started keep going, and a bucket whose footprints
		// lost a write gets a new pass (lib/privacy/footprints.ts)
		ctx.waitUntil(
			maintainFootprintPasses(rawEnv as never)
				.then((result) => (result.resumed.length || result.restarted.length ? logger.info('[PrivacyFootprints] Passes maintained', result) : undefined))
				.catch((error) => {
					logger.error('[PrivacyFootprints] Pass upkeep failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'privacy-footprints', error);
				}),
		);
		// Hourly: move legacy channel subscriptions into D1 (SCALABILITY-AUDIT AV-4)
		ctx.waitUntil(
			importPendingSubscriptions(rawEnv as never)
				.then((result) => logger.info('[SubscriptionImport] Run finished', { ...result }))
				.catch((error) => {
					logger.error('[SubscriptionImport] Run failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'subscription-import', error);
				}),
		);
		// Hourly: admin and creator soft deletes (lib/videoTrash.ts) that are due (30 days up, or queued with
		// "Delete permanently now") are purged (lib/admin/deletions.ts). Through
		// the search-sync wrapper so purged content leaves the indexes.
		ctx.waitUntil(
			(async () => {
				const env = withSearchSync(rawEnv, ctx) as never;
				await runDeletionCleanup(env, (deletion) => purgeDeletion(env, deletion));
			})().catch((error) => {
				logger.error('[DeletionCleanup] Run failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'deletion-cleanup', error);
			}),
		);
		// Hourly: uploads that went quiet are completed or flagged for a
		// re-upload, never left hanging (lib/uploads/lifecycle.ts). Through the
		// search-sync wrapper so the ownership index sees the new status.
		ctx.waitUntil(
			sweepStalledUploads(withSearchSync(rawEnv, ctx) as never)
				.catch((error) => logger.error('[Uploads] Stalled-upload sweep failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		return;
	}
	// Retention deletes go through the search-sync wrapper so removed content leaves the index.
	const env = withSearchSync(rawEnv, ctx);
	ctx.waitUntil(
		(async () => {
			try {
				// Story 29.9: daily reconciliation of the search index with R2 (a few pages per type per run).
				await reconcileSearchIndex(rawEnv as never);
			} catch (error) {
				logger.error('[SearchReconcile] Sweep failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'search-reconcile', error);
			}
			try {
				// Ownership index: advance (and when finished, prune and mark complete) the full pass of videos and channels.
				await reconcileOwnershipIndex(rawEnv as never);
			} catch (error) {
				logger.error('[Ownership] Reconcile failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'ownership-reconcile', error);
			}
			try {
				// Kept originals past their retention (lib/media/originals.ts)
				const swept = await sweepOriginals(rawEnv as never);
				if (swept.deleted) logger.info('[Originals] Retention run', swept);
			} catch (error) {
				logger.error('[Originals] Retention run failed', { error: error instanceof Error ? error.message : String(error) });
			}
			try {
				// R2 vs Bunny cost inputs for yesterday (lib/media/costs.ts; never throws)
				const costs = await collectDeliveryCosts(rawEnv as never);
				logger.info('[MediaCosts] Daily run', costs);
			} catch (error) {
				logger.error('[MediaCosts] Daily run failed', { error: error instanceof Error ? error.message : String(error) });
			}
			try {
				// Short vs video: classify videos added by imports, syncs and uploads (lib/video-format/job.ts)
				const daily = await startDailyVideoFormatRun(rawEnv as never);
				logger.info('[VideoFormat] Daily run', daily);
			} catch (error) {
				logger.error('[VideoFormat] Daily run failed to start', { error: error instanceof Error ? error.message : String(error) });
			}
			try {
				// Thumbnail shapes: flag (Errors page) any thumbnail that does not match its video (lib/thumbnail/repair.ts)
				const thumbs = await startDailyThumbnailCheck(rawEnv as never);
				logger.info('[ThumbnailRepair] Daily run', thumbs);
			} catch (error) {
				logger.error('[ThumbnailRepair] Daily run failed to start', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'thumbnail-check', error);
			}
			try {
				// Live QoE, events and segment indexes past 90 days (lib/live/qoe.ts)
				if (rawEnv.SEARCH_DB) await pruneLiveData(rawEnv.SEARCH_DB);
			} catch (error) {
				logger.error('[Live] Prune failed', { error: error instanceof Error ? error.message : String(error) });
			}
			try {
				// Upload rate limits (AV-14): drop windows of users who stopped uploading and expired leases.
				if (rawEnv.SEARCH_DB) await pruneRateLimits(rawEnv.SEARCH_DB);
				// Upload-limit hits older than 30 days (the Creators page shows the last 7)
				if (rawEnv.SEARCH_DB) await pruneLimitHits(rawEnv.SEARCH_DB);
			} catch (error) {
				logger.error('[RateLimit] Prune failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'rate-limit-prune', error);
			}
		})(),
	);
	ctx.waitUntil(
		(async () => {
			const budget = new OperationBudget(DEFAULT_OPERATION_BUDGET);
			try {
				const result = await enforceRetention(env, new Date(), budget);
				logger.info('[Retention] Retention sweep finished', { ...result, operations: budget.spent });
			} catch (error) {
				logger.error('[Retention] Retention sweep failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'retention', error);
			}
		})(),
	);
}

/** Routes Hono really serves (method + path), for the contract test. */
export function listServedRoutes(): { method: string; path: string }[] {
	return app.routes.map((r) => ({ method: r.method, path: r.path }));
}

/** The public API contract (openapi/v1.json is generated from this; see lib/api-contract.ts). */
export async function getContractDocument(): Promise<any> {
	return buildContractDocument((openapi as any).schema);
}

/**
 * `/api/v1/...` is served by the `/api/...` handlers (lib/api-version.ts).
 * Versioned responses carry X-API-Version; deprecated operations carry
 * Deprecation / Sunset headers.
 */
async function handleFetch(request: Request, env: AppBindings, ctx: ExecutionContext): Promise<Response> {
	const resolved = resolveApiVersion(request);
	if (resolved.kind === 'unsupported') return unsupportedVersionResponse(resolved.version);
	// Content buckets are wrapped so every R2 write also updates the search index (lib/search/sync.ts).
	const response = await app.fetch(resolved.request, withSearchSync(env, ctx), ctx);
	const deprecation = findDeprecation(request.method, new URL(resolved.request.url).pathname);
	if (resolved.kind === 'unversioned' && !deprecation) return response;
	const out = new Response(response.body, response);
	if (resolved.kind === 'versioned') out.headers.set(API_VERSION_HEADER, resolved.version);
	if (deprecation) for (const [k, v] of Object.entries(deprecationHeaders(deprecation))) out.headers.set(k, v);
	return out;
}

/**
 * Queue consumers, by queue name (prod name, or with its -stage / -qa suffix):
 * - al-ummah-now-admin-jobs*: heavy admin actions (lib/admin/jobs.ts).
 * - al-ummah-now-run-erase*: E2E run-account erasures, admin jobs on their own queue (#887).
 * - otherwise PROCESSING_CHECK_QUEUE, which carries the per-video
 *   processing-check loop, the upload reaper's checks (kind "upload-reaper")
 *   new uploads' playlist adds (kind "playlist-add"), Bunny deletes after an
 *   owner delete (kind "bunny-delete"), the QA/stage test-library purge
 *   (kind "test-library-purge") and the channel collection backfill (kind
 *   "bunny-collection-backfill") and the privacy footprint backfill (kind
 *   "privacy-footprint-backfill") and the public MP4 backfill (kind "mp4-backfill").
 * R2 writes go through the search-sync wrapper so changes reach the search
 * index and ownership rows like any API write.
 */
async function queue(batch: MessageBatch<unknown>, env: AppBindings, ctx: ExecutionContext): Promise<void> {
	try {
		// Run-account erasures (#887) are admin jobs on their own capped queue
		if (batch.queue.startsWith('al-ummah-now-admin-jobs') || batch.queue.startsWith('al-ummah-now-run-erase')) {
			await handleAdminJobBatch(batch as unknown as { messages: readonly JobMessage[] }, withSearchSync(env, ctx) as never, ADMIN_JOB_HANDLERS);
			return;
		}
		const synced = withSearchSync(env, ctx) as never;
		// The same queue carries the Short/video format backfill (lib/video-format/job.ts) and the upload reaper
		const isFormat = (m: { body: unknown }) => (m.body as { kind?: unknown } | null)?.kind === VIDEO_FORMAT_JOB_KIND;
		for (const msg of batch.messages.filter(isFormat)) await handleVideoFormatMessage(synced, msg);
		// Channel collection backfill (lib/bunny/collectionBackfill.ts)
		const isCollectionBackfill = (m: { body: unknown }) => isCollectionBackfillMessage(m.body);
		for (const msg of batch.messages.filter(isCollectionBackfill)) await handleCollectionBackfillMessage(synced, msg);
		// publishedAt backfill (lib/publishedAtBackfill.ts), one bucket page per message, dry run by default
		for (const msg of batch.messages.filter((m) => isPublishedAtBackfillMessage(m.body))) await handlePublishedAtBackfillMessage(synced, msg);
		// Queue-message archive pseudonymisation of older entries (lib/archivePrivacyRewrite.ts, #1177), dry run by default
		for (const msg of batch.messages.filter((m) => isArchivePrivacyMessage(m.body))) await handleArchivePrivacyMessage(env as never, msg);
		// Public MP4 backfill (lib/media/mp4-backfill.ts, #1182), one media_jobs page per message, dry run by default
		for (const msg of batch.messages.filter((m) => isMp4BackfillMessage(m.body))) await handleMp4BackfillMessage(env as never, msg);
		// Privacy footprint backfill (lib/privacy/footprints.ts), one bucket page per message
		for (const msg of batch.messages.filter((m) => isFootprintBackfillMessage(m.body))) await handleFootprintBackfillMessage(env as never, msg.body as never);
		const rest = batch.messages.filter((m) => !isFormat(m) && !isCollectionBackfill(m) && !isFootprintBackfillMessage(m.body) && !isPublishedAtBackfillMessage(m.body) && !isArchivePrivacyMessage(m.body) && !isMp4BackfillMessage(m.body));
		// New uploads → playlists (lib/playlistUploadAdds.ts)
		const playlistAdds = rest.filter((m) => isPlaylistAddMessage(m.body));
		const reaper = rest.filter((m) => isReaperMessage(m.body));
		// Owner deletes → Bunny (lib/uploads/bunnyDelete.ts); QA/stage purge (lib/uploads/testLibraryPurge.ts)
		const bunnyDeletes = rest.filter((m) => isBunnyDeleteMessage(m.body));
		const purges = rest.filter((m) => isPurgeMessage(m.body));
		// R2 renditions moved between the public and private buckets (lib/media/r2-delivery.ts)
		const mediaMoves = rest.filter((m) => isMediaMoveMessage(m.body));
		const processing = rest.filter(
			(m) =>
				!isReaperMessage(m.body) && !isPlaylistAddMessage(m.body) && !isBunnyDeleteMessage(m.body) && !isPurgeMessage(m.body) && !isMediaMoveMessage(m.body),
		);
		if (processing.length) await handleProcessingCheckBatch({ messages: processing }, synced);
		if (reaper.length) await handleReaperBatch({ messages: reaper }, synced);
		if (bunnyDeletes.length) await handleBunnyDeleteBatch({ messages: bunnyDeletes }, synced);
		if (purges.length) await handlePurgeBatch({ messages: purges }, synced);
		if (mediaMoves.length) await handleMediaMoveBatch({ messages: mediaMoves as never }, synced);
		if (playlistAdds.length) await handlePlaylistAddBatch({ messages: playlistAdds }, synced, ctx);
	} catch (error) {
		// The batch is retried by the queue; the failure is flagged on the admin Errors page
		reportServerError('api-videos', env as never, ctx, error, { route: `queue:${batch.queue}`, extra: { messages: batch.messages.length } });
		throw error;
	}
}

/** A daily job that failed: reported to the admin Errors page (it runs again tomorrow). */
function reportJobFailure(env: AppBindings, ctx: ExecutionContext, job: string, error: unknown): void {
	reportServerError('api-videos', env as never, ctx, error, { route: `cron:${job}` });
}

// Uncaught exceptions and 5xx answers are reported to the admin Errors page (docs/features/error-reporting.md)
const loggedWorker = withLogging({
	fetch: withErrorReporting<AppBindings & ErrorReporterEnv, ExecutionContext>('api-videos', handleFetch as never),
	scheduled,
	queue,
});

registerLiveStreamHooks();

/**
 * The live host (LIVE_PUBLIC_HOST) is the self-hosted live edge (lib/live/edge.ts):
 * HLS segment ingest and delivery, answered before the API stack so a
 * segment costs one Worker request and no per-request log line.
 */
export default {
	...loggedWorker,
	async fetch(request: Request, env: AppBindings, ctx: ExecutionContext): Promise<Response> {
		// Nothing on the API or live hosts is for search engines (lib/crawlers.ts)
		const robots = robotsTxtResponse(request);
		if (robots) return robots;
		return withNoIndex(await routeFetch(request, env, ctx));
	},
};

async function routeFetch(request: Request, env: AppBindings, ctx: ExecutionContext): Promise<Response> {
	const liveEnv = env as unknown as LiveEnv;
	if (isLiveHost(liveEnv, new URL(request.url).hostname)) {
		try {
			return await handleLiveEdge(request, liveEnv, ctx, { onLive: (e, session) => markStreamLive(e as unknown as StreamsEnv, session.stream_id) });
		} catch (error) {
			logger.error('[LiveEdge] Request failed', { method: request.method, error: error instanceof Error ? error.message : String(error) });
			return new Response('Live edge error', { status: 500, headers: { 'access-control-allow-origin': '*' } });
		}
	}
	return (loggedWorker.fetch as (r: Request, e: AppBindings, c: ExecutionContext) => Promise<Response>)(request, env, ctx);
}
