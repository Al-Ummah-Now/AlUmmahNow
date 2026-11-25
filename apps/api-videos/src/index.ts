import { onImportAttachFailed } from './lib/admin/importAttach';
import { onSourceSyncFailed, queueDueSources, SOURCE_SYNC_JOB_KIND } from './lib/importSources/job';
import { onTakeoutFailed, TAKEOUT_JOB_KIND } from './lib/importSources/takeout';
import { edgeRateLimit, humanCheckStatus, requireHuman, scriptedClientBlock } from './middleware/bot-protection';
import attestationRouter from './routers/attestation.router';
import { batchJob, constantTimeEqual, envelopeResponse, reportServerError, withErrorReporting, type ErrorReporterEnv } from '@al-ummah/shared-types';
// Request/job trail for error context (ids, failed upstream calls, breadcrumbs); registers itself with the reporter
import { runWithErrorTrail } from '@al-ummah/shared-types/error-trail';
import { SUBSCRIPTION_IMPORT_CRON, importPendingSubscriptions } from './lib/subscription-import';
import { runReleaseIndex } from './lib/app-updates/run';
import { handleProcessingCheckBatch, sweepProcessingVideos } from './lib/processing/loop';
import { handleReaperBatch, isReaperMessage, sweepStaleUploads } from './lib/uploads/reaper';
import { handleBunnyDeleteBatch, isBunnyDeleteMessage } from './lib/uploads/bunnyDelete';
import { handleCollectionBackfillMessage, isCollectionBackfillMessage } from './lib/bunny/collectionBackfill';
import { handlePurgeBatch, isPurgeMessage, startScheduledPurge } from './lib/uploads/testLibraryPurge';
import { handleMediaMoveBatch, isMediaMoveMessage, sweepMediaJobs } from './lib/media/r2-delivery';
import { flagStalledTranscodes } from './lib/media/troubleshoot';
import { flushIndexNow } from './lib/indexnow';
import { collectDeliveryCosts } from './lib/media/costs';
import { sweepOriginals } from './lib/media/originals';
import { createMediaInternalRouter } from './endpoints/media/mediaInternal';
import { createReviewInternalRouter } from './endpoints/review/reviewInternal';
import { createYoutubeImportInternalRouter } from './endpoints/youtube-import/youtubeImportInternal';
import { oauthCallback, type YtEnv } from './lib/youtube-import/service';
import { handleYtImportBatch } from './lib/youtube-import/jobs';
import { sweepYoutubeImports } from './lib/youtube-import/sweep';
import { createNotificationsInternalRouter } from './endpoints/notifications/notificationsInternal';
import { createDownloadsInternalRouter } from './endpoints/downloads/downloadsInternal';
import { sweepRunUsers } from './lib/e2e/runUserSweep';
import { handlePlaylistAddBatch, isPlaylistAddMessage } from './lib/playlistUploadAdds';
import { handleChannelCommentsBatch, isChannelCommentsMessage, startCommentPurge } from './lib/channelComments/jobs';
import { createChannelCommentsInternalRouter } from './endpoints/channel/channelCommentsInternal';
import { createPlaylistAddsInternalRouter } from './endpoints/playlist/playlistAddsInternal';
import { createAudioUploadRouter } from './endpoints/audio/upload';
import { createAudioTracksInternalRouter } from './endpoints/audio/audioTracksInternal';
import { createCaptionJobsInternalRouter } from './endpoints/captions/captionJobsInternal';
import { createTranslateInternalRouter } from './endpoints/translate/translateInternal';

/** Every 10 minutes: start a processing-check loop for any video stuck without one */
const PROCESSING_SWEEP_CRON = '*/10 * * * *';
/**
 * Live sessions (idle timeout, Bunny polling; lib/live/service.ts) and scheduled community posts.
 * Every minute on production; every 5 minutes on QA and stage, where nobody waits on them and each
 * tick costs a community-posts listing (cost review 2026-11-14).
 */
const LIVE_SWEEP_CRONS = new Set(['* * * * *', '*/5 * * * *']);
import { fromHono } from "chanfana";
import { bunnySigningMiddleware } from './middleware/bunny-signing';
import { Hono } from "hono";
import { cors } from 'hono/cors'
import { isAllowedOrigin } from './lib/cors';
import { authMiddleware, optionalAuthMiddleware, channelIdMiddleware } from "./middleware/auth";
import { expireInvites, pruneTeamActivity, resolveStaleClaims } from "./lib/channelTeam";
import { roleOnChannel } from "./lib/channelAccess";
import { videosBanMiddleware } from "./middleware/videos-ban";
import { videosPendingDeletionMiddleware } from "./middleware/videos-pending-deletion";
import adminInternalRouter from "./routers/admin.router";
import csamInternalRouter from "./routers/csam.router";
import { handleLiveEdge, isLiveHost } from "./lib/live/edge";
import type { LiveEnv } from "./lib/live/providers";
import { sweepLiveSessions } from "./lib/live/service";
import { maintainLiveMetadata } from './lib/live/metadata';
import { runPremieres } from './lib/live/premieres';
import { runHeadsUps } from './lib/live/reminders';
import { markStreamLive, registerLiveStreamHooks, type StreamsEnv } from "./lib/live/streams";
import { pruneLiveData } from "./lib/live/qoe";
import { purgeRemovedChat } from './lib/live/chat';
import { loggingMiddleware } from "./middleware/logging";
import { videoListInvalidation } from './lib/videoListCache';
import { withLogging } from "@al-ummah/logger";
import { errorHandler } from "./middleware/error-handler";
import { pruneRateLimits, rateLimitMiddleware } from "./middleware/rate-limit";
import { UPLOAD_CONTINUE_PATHS, UPLOAD_SESSION_PATHS, uploadContinueLimitMiddleware, uploadSessionLimitMiddleware } from "./middleware/upload-limits";
import { pruneLimitHits } from "./lib/creatorTiers";
import { channelCreateGate, handleAcceptCreatorTerms, handleCreatorAccess } from "./endpoints/creator/creatorAccess";
import { handleCreateTierRequest, handleMyTier, handleMyTierRequests, handleUpgradeOverview, handleWithdrawTierRequest } from "./endpoints/creator/tierRequests";
import { handleAbandonCheckout, handlePaymentReceipt, handleBillingPlans, handleFakeCancel, handleMyCheckout, handleCancelOwn, handleCheckout, handleFakeCheckoutPage, handleFakePay, handleMyBilling, handlePortal, handleWebhook } from "./endpoints/billing/billing";
import billingInternalRouter from "./routers/billing.router";
import supportInternalRouter from "./routers/support.router";
import { handleSupportWebhook } from "./endpoints/support/supportWebhooks";
import { handleSupportPayee, handleSupportPayeeOnboard, handleSupportPayeeRefresh } from "./endpoints/support/supportPayee";
import { handleTestRailOnboardPage, handleTestRailOnboardSubmit } from "./endpoints/support/supportTestRail";
import { handleTestCheckoutPage, handleTestCheckoutSubmit } from "./endpoints/support/supportTestCheckout";
import { handleMySupport, handleMySupportCheckout, handleStopMyPledge, handleSupportCheckout, handleSupportQuote, handleSupportSettingsSave, handleSupportSheet } from "./endpoints/support/supportCheckout";
import { onSupportJobFailed, queueSupportCron } from "./lib/support/jobs";
import { onBillingJobFailed, queueReconciles } from "./lib/billing/service";
import { DISCOVERY_RANK_JOB, flagDiscoveryRankFailed, startDiscoveryRank } from "./lib/ranking/job";
import { createDiscoveryInternalRouter } from "./endpoints/discovery/discoveryInternal";
import { sweepEntitlements } from "./lib/billing/store";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';
import type { AppBindings } from './base';
import { ERASE_MEDIA_JOB, onEraseMediaFailed } from './lib/privacy/erase-media';
import { sweepProfileEmailPointers, sweepProfileEmailReports } from './lib/admin/profile-email-reports';
import { enforceRetention } from './lib/privacy/retention';
import { DEFAULT_OPERATION_BUDGET, OperationBudget } from './lib/privacy/scan';
import { withSearchSync } from './lib/search/sync';
import { handleAdminJobBatch, type JobMessage } from './lib/admin/jobs';
import { ADMIN_JOB_HANDLERS, purgeDeletion, reverifyRecentTransfers } from './lib/admin/service';
import { runDeletionCleanup } from './lib/admin/deletions';
import { startIndexReconcile } from './lib/search/reconcileJobs';
import { kickRepairJobIfPending } from './lib/search/repairs';
import { API_VERSION_HEADER, deprecationHeaders, findDeprecation, resolveApiVersion, unsupportedVersionResponse } from './lib/api-version';
import { buildContractDocument } from './lib/api-contract';

// TUS Proxy import (not in routers yet)
import { sweepStalledUploads } from "./lib/uploads/lifecycle";
import { createTusRouter } from "./endpoints/video/tus";
import { createProcessingInternalRouter } from "./endpoints/video/processingInternal";
import { handleInvalidateCategories, handleListCategories, videoCategoriesMiddleware } from "./lib/categories";
import scholarsInternalRouter from "./routers/scholars-internal.router";
import postsInternalRouter from "./routers/posts-internal.router";
import { sitesInternalRouter, sitesRouter } from "./routers/sites.router";
import { handleUserFeatures } from "./endpoints/creator/features";
import { socialInternalRouter, socialRouter } from "./routers/social.router";
import { publishDuePosts } from "./lib/scheduled-posts";
import { purgeSeasons } from "./lib/islamic-seasons";
import { sweepStaging } from "./lib/media/prebuilt";
import { runHealthCheck } from "./lib/media/health";
import { createUploadsInternalRouter } from "./endpoints/video/uploadsInternal";
import { createVideoFormatInternalRouter } from "./endpoints/video/videoFormatInternal";
import { createFootprintsInternalRouter } from "./endpoints/privacy/footprintsInternal";
import { handleFootprintBackfillMessage, isFootprintBackfillMessage, maintainFootprintPasses } from "./lib/privacy/footprints";
import { handleVideoFormatMessage, startDailyVideoFormatRun } from "./lib/video-format/job";
import { handlePublishedAtBackfillMessage, isPublishedAtBackfillMessage } from "./lib/publishedAtBackfill";
import { handleMp4BackfillMessage, isMp4BackfillMessage } from "./lib/media/mp4-backfill";
import { handleBackfillMessage, restartQuietRuns } from "./lib/media/backfill/run";
import { isBackfillMessage } from "./lib/media/backfill/types";
import { queueDueRemovals, removeFromBunny } from "./lib/media/backfill/removal";
import { handleArchivePrivacyMessage, isArchivePrivacyMessage } from "./lib/archivePrivacyRewrite";
import { startDailyThumbnailCheck } from "./lib/thumbnail/repair";
import { VIDEO_FORMAT_JOB_KIND } from "@al-ummah/shared-types";
// Profile/Channel image upload handlers (not in routers yet)
import handleAvatarUpdate from "./endpoints/profile/profileAvatarUpdate";
import handleCoverUpdate from "./endpoints/profile/profileCoverUpdate";
import handleChannelAvatarUpdate from "./endpoints/channel/channelAvatarUpdate";
import handleChannelCoverUpdate from "./endpoints/channel/channelCoverUpdate";
import { robotsTxtResponse, withNoIndex } from './lib/crawlers';
import { errorEnvelope } from './middleware/error-envelope';
import { applyFeatureGates } from './middleware/require-feature';
import { apiError } from './lib/api-error';
import { refuseInternalVideoKeys } from './middleware/internal-video-keys';

// ==========================================
// APP SETUP
// ==========================================

const app = new Hono<{ Bindings: AppBindings }>();

// Register global error handler (catches all unhandled errors)
app.onError(errorHandler);
// Error answers carry the shared envelope (outermost, so onError's answers are wrapped too)
app.use('*', errorEnvelope);

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
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Turnstile-Token', 'X-AUN-Bot-Bypass', 'channelId', 'userId', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Defer-Length', 'Upload-Concat', 'X-App-Locale', 'If-None-Match'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Allow', 'Location', 'Tus-Resumable', 'Tus-Version', 'Tus-Max-Size', 'Tus-Extension', 'Upload-Offset', 'Upload-Length', 'Upload-Metadata', 'X-API-Version', 'Deprecation', 'Sunset', 'Retry-After', 'Date', 'Content-Language', 'X-Error-Ref', 'ETag'],
	maxAge: 600,
	credentials: false,
}));

// Internal / diagnostic endpoints require the service-to-service key
// (X-API-Key == INTERNAL_API_KEY, compared in constant time). They mutate storage or expose internals.
const INTERNAL_PATHS = ['/internal/*', '/test', '/test-error', '/api/i18n/sync'];
for (const p of INTERNAL_PATHS) {
	app.use(p, async (c, next) => {
		const binding = (c.env as unknown as { INTERNAL_API_KEY?: string | { get(): Promise<string> } }).INTERNAL_API_KEY;
		const expected = typeof binding === 'string' ? binding : await binding?.get();
		const provided = c.req.header('X-API-Key');
		if (!constantTimeEqual(provided, expected)) {
			return apiError(c, 401, 'unauthorized', { error: 'Unauthorized' });
		}
		return next();
	});
}

// Add comprehensive logging middleware for ALL routes
app.use('*', loggingMiddleware);
// Admin-managed video categories: this isolate's list, refreshed at most once a minute (lib/categories.ts)
app.use('/api/*', videoCategoriesMiddleware);
app.use('/internal/*', videoCategoriesMiddleware);
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
app.use('/api/*', refuseInternalVideoKeys);
app.use('/api/*', optionalAuthMiddleware);
// Feature switches (FEAT-2): mapped routes answer 404 feature_off while their switch is off
applyFeatureGates(app, 'api-videos');

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

// BOT PROTECTION (middleware/bot-protection.ts, docs/features/bot-protection.md):
// edge rate limits per user (else IP), Turnstile on reports and an account's first
// comment or post, and (production, Turnstile enforced) no writes from curl & co.
app.use('/api/*', scriptedClientBlock());
for (const path of ['/api/videos/:id/comments', '/api/community/channels/:channelId/posts/:postId/comments']) {
	app.use(path, edgeRateLimit('COMMENT_LIMITER', 'videos.comment'));
	app.use(path, requireHuman('videos.comment', 'first'));
}
app.use('/api/community/channels/:channelId/posts', edgeRateLimit('POST_LIMITER', 'videos.post'));
app.use('/api/community/channels/:channelId/posts', requireHuman('videos.post', 'first'));
for (const path of [
	'/api/videos/:id/likes',
	'/api/videos/:id/dislikes',
	'/api/videos/:id/comments/:cid/likes',
	'/api/videos/:id/comments/:cid/dislikes',
	'/api/community/channels/:channelId/posts/:postId/like',
	'/api/community/channels/:channelId/posts/:postId/vote',
	'/api/community/channels/:channelId/posts/:postId/comments/:commentId/like',
	'/api/channels/:id/subscriptions',
]) {
	app.use(path, edgeRateLimit('REACTION_LIMITER', 'videos.reaction', ['POST', 'DELETE']));
}
app.use('/api/moderation/reports', edgeRateLimit('REPORT_LIMITER', 'videos.report'));
// Live watching heartbeats (AlUmmahNow#30), per IP: bounds made-up viewers with the per-network cap in the object
app.use('/api/live-streams/:id/viewers', edgeRateLimit('LIVE_VIEWER_LIMITER', 'videos.live_viewers'));
// Live chat (wiki E17): its own per-person limit, apart from comments; the per-address one is in the endpoint
app.use('/api/live-streams/:id/reminders', edgeRateLimit('REACTION_LIMITER', 'videos.live_reminder', ['POST', 'DELETE']));
app.use('/api/live-streams/:id/chat', edgeRateLimit('LIVE_CHAT_LIMITER', 'videos.live_chat'));
app.use('/api/live-streams/:id/chat', requireHuman('videos.live_chat', 'first'));
// Anonymous prayer-time and Hijri reads (wiki Epic 21 §3): per-IP limit in front of the edge cache
app.use('/api/prayer-times', edgeRateLimit('PRAYER_LIMITER', 'videos.prayer_times', ['GET']));
app.use('/api/hijri', edgeRateLimit('PRAYER_LIMITER', 'videos.hijri', ['GET']));
app.use('/api/moderation/reports', requireHuman('videos.report', 'signed_out'));
// Tier requests on /upgrade: Turnstile on every request (wiki AUN-TIER-REQUESTS)
app.use('/api/me/tier-requests', requireHuman('videos.tier_request', 'always'));
for (const path of ['/api/videos/upload/initiate', '/api/videos/upload/batch/initiate']) {
	app.use(path, edgeRateLimit('UPLOAD_INITIATE_LIMITER', 'videos.upload_initiate'));
}
for (const path of ['/api/search', '/api/videos/search']) {
	app.use(path, edgeRateLimit('SEARCH_LIMITER', 'videos.search', ['GET']));
}
// A title filter without a channel is a search of every video (VideosList): the same budget
const searchLimit = edgeRateLimit('SEARCH_LIMITER', 'videos.search', ['GET']);
for (const path of ['/api/videos', '/api/videos/']) {
	app.use(path, (c, next) => (c.req.query('q')?.trim() && !c.req.query('channelId') && !c.req.header('channelId') ? searchLimit(c, next) : next()));
}
// Channel move offers: each read names people and channels from their records
for (const path of ['/api/move-offers', '/api/move-offers/:id', '/api/channels/:id/move-offers', '/api/channels/:id/move-receivers']) {
	app.use(path, edgeRateLimit('SEARCH_LIMITER', 'videos.move_offers', ['GET']));
}
for (const path of ['/api/move-offers/:id', '/api/move-offers/:id/accept', '/api/move-offers/:id/decline', '/api/channels/:id/move-offers']) {
	app.use(path, edgeRateLimit('REACTION_LIMITER', 'videos.move_offer_answer', ['POST', 'DELETE']));
}
// Viewer-side translated titles (public): direct callers share the search budget per IP or user
app.use('/api/videos/:id/translated-metadata', edgeRateLimit('SEARCH_LIMITER', 'videos.translated_metadata', ['GET']));

// Channel creation is by invitation too: a creator tier, within its channel limit
app.use('/api/channels', channelCreateGate);
app.use('/api/channels/', channelCreateGate);
// Video categories (admin-managed; edge-cached for a minute) and the admin-api invalidation hook
app.get('/api/categories', handleListCategories);
app.post('/internal/categories/invalidate', handleInvalidateCategories);
// What the signed-in user may do (Upload, Create channel) for the web UI
app.get('/api/me/creator', authMiddleware, handleCreatorAccess);
app.post('/api/me/creator/terms', authMiddleware, handleAcceptCreatorTerms);
// Which user-facing features this caller sees (lib/features; auth optional): every client hides what is not true
app.get('/api/me/features', handleUserFeatures);
// Native app attestation: App Attest / Play Integrity → X-AUN-Native-Proof (lib/attestation, #1274)
app.route('/api/apps/attestation', attestationRouter as never);
// Tier requests (/upgrade): the tiers, the user's request, filing and withdrawing one
app.get('/api/tiers/upgrade', handleUpgradeOverview);
// Settings › Tier: the user's own tier in every mode (/upgrade itself is 404 feature_off while closed)
app.get('/api/me/tier', authMiddleware, handleMyTier);
// Payments for creator tiers (wiki AUN-SUBS, lib/billing/*): off until an admin enables a provider
app.get('/api/billing/plans', handleBillingPlans);
app.get('/api/me/billing', authMiddleware, handleMyBilling);
app.post('/api/me/billing/checkout', authMiddleware, handleCheckout);
app.get('/api/me/billing/checkouts/:id', authMiddleware, handleMyCheckout);
app.post('/api/me/billing/checkouts/:id/abandon', authMiddleware, handleAbandonCheckout);
app.get('/api/me/billing/payments/:id/receipt', authMiddleware, handlePaymentReceipt);
app.post('/api/me/billing/subscriptions/:id/cancel', authMiddleware, handleCancelOwn);
app.post('/api/me/billing/portal', authMiddleware, handlePortal);
// Provider webhooks live outside /api: no auth, bot or browser middleware runs on them (the signature is the check)
app.get('/webhooks/billing/fake/checkout/:id', handleFakeCheckoutPage);
app.post('/webhooks/billing/fake/checkout/:id/pay', handleFakePay);
app.post('/webhooks/billing/fake/checkout/:id/cancel', handleFakeCancel);
app.post('/webhooks/billing/:provider', handleWebhook);
// Creator support (wiki AUN-MEMBERS): collector and payout-rail webhooks; 404 for any vendor not available here
// The test rail's hosted onboarding page (QA and local only; registered before the webhook route)
app.get('/webhooks/support/rail/test/onboard/:ref', handleTestRailOnboardPage);
app.post('/webhooks/support/rail/test/onboard/:ref', handleTestRailOnboardSubmit);
app.get('/webhooks/support/test/checkout/:id', handleTestCheckoutPage);
app.post('/webhooks/support/test/checkout/:id', handleTestCheckoutSubmit);
app.post('/webhooks/support/:side/:vendor', handleSupportWebhook);
// The support sheet, the channel's own settings and Settings › Support (lib/support/checkout.ts); 404 feature_off while support is off
app.get('/api/channels/:channelId/support', handleSupportSheet);
app.get('/api/channels/:channelId/support/quote', handleSupportQuote);
app.post('/api/channels/:channelId/support/checkout', authMiddleware, handleSupportCheckout);
app.put('/api/channels/:channelId/support/settings', authMiddleware, handleSupportSettingsSave);
app.get('/api/me/support', authMiddleware, handleMySupport);
app.get('/api/me/support/checkouts/:id', authMiddleware, handleMySupportCheckout);
app.post('/api/me/support/pledges/:id/stop', authMiddleware, handleStopMyPledge);
// Studio › Support payee (lib/support/payees.ts): owner sets up payouts through the rail's hosted onboarding; 404 feature_off while support is off
app.get('/api/channels/:channelId/support/payee', authMiddleware, handleSupportPayee);
app.post('/api/channels/:channelId/support/payee/onboard', authMiddleware, handleSupportPayeeOnboard);
app.post('/api/channels/:channelId/support/payee/refresh', authMiddleware, handleSupportPayeeRefresh);
app.get('/api/me/tier-requests', authMiddleware, handleMyTierRequests);
app.post('/api/me/tier-requests', authMiddleware, handleCreateTierRequest);
app.post('/api/me/tier-requests/:id/withdraw', authMiddleware, handleWithdrawTierRequest);
// Whether the next comment/post/report needs a Turnstile token (middleware/bot-protection.ts)
app.get('/api/me/human-check', authMiddleware, humanCheckStatus);

// SECURITY: Apply rate limiting to community media uploads
app.use('/api/community/media/upload/images', rateLimitMiddleware('image_upload'));
app.use('/api/community/media/upload/gif', rateLimitMiddleware('image_upload'));
app.use('/api/community/media/link-preview', rateLimitMiddleware('image_upload'));
app.use('/api/videos/:id/thumbnail', rateLimitMiddleware('image_upload'));
// Translate button (AUN-CAPTIONS §5.8): the daily fair-use limit counts texts; this caps request bursts
app.use('/api/translate', rateLimitMiddleware('inline_translate', {
	limits: () => ({ perMinute: 20, perHour: 200, perDay: 1000, maxConcurrent: 3 }),
	methods: ['POST'],
}));
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
// Audio track file chunks (wiki AUN-MULTI-AUDIO): raw bodies, so not a chanfana route
app.use('/api/videos/:videoId/audio-tracks/:trackId/upload', authMiddleware);
app.route('/api/videos', createAudioUploadRouter() as never);
// Audio tracks: media reports and the admin Errors page's Retry
app.route('/internal/audio-tracks', createAudioTracksInternalRouter() as never);
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
// Studio comments: Retry of an index rebuild or the removed-comment purge (lib/channelComments/jobs.ts)
app.route('/internal/channel-comments', createChannelCommentsInternalRouter() as never);
// Caption jobs: media audio reports, processor progress/finish, admin retry (AUN-CAPTIONS §5.1)
app.route('/internal/captions', createCaptionJobsInternalRouter() as never);
// Staff-set field translation from admin-api (L10N rule; lib/translate/admin-fields.ts)
app.route('/internal/translate', createTranslateInternalRouter() as never);
// Scholars (the CMS): their channels and their articles on the Community tab
app.route('/internal/scholars', scholarsInternalRouter as never);
// Community posts for the CMS (www scholar post pages; wiki AUN-SCHOLAR-SITES §6.3)
app.route('/internal/posts', postsInternalRouter as never);
// White-label scholar sites (wiki AUN-SCHOLAR-SITES): admin-api grants; the sites Worker and Studio read and edit
app.route('/internal/sites', sitesInternalRouter as never);
app.route('/api/sites', sitesRouter as never);
// Social auto-post and scheduler-tool support (wiki AUN-SOCIAL, SOC-1)
app.route('/internal/social', socialInternalRouter as never);
app.route('/api/social', socialRouter as never);
// R2 delivery beside Bunny (epic #687): apps/media's callbacks, admin retry / jobs / settings
app.route('/internal/media', createMediaInternalRouter() as never);
app.route('/internal/discovery', createDiscoveryInternalRouter() as never);
// Platform notification settings (admin-api proxies with the admin role + audit)
app.route('/internal/notifications', createNotificationsInternalRouter() as never);
app.route('/internal/downloads', createDownloadsInternalRouter() as never);
// Pre-publication review: the processor's outcomes and admin-api's decisions (docs/specs/VIDEO-REVIEW.md)
app.route('/internal/review', createReviewInternalRouter() as never);
// Move from YouTube (wiki AUN-YT-IMPORT): admin settings (admin-api proxies with media:manage + audit), Errors page retry
app.route('/internal/youtube-import', createYoutubeImportInternalRouter() as never);
// Google's redirect after the creator's consent (no bearer token: the single-use state names the import's owner)
app.get('/api/youtube-import/oauth/callback', async (c) => {
	const q = c.req.query();
	const target = await oauthCallback(c.env as unknown as YtEnv, { code: q.code, state: q.state, error: q.error });
	c.header('Cache-Control', 'no-store');
	c.header('Referrer-Policy', 'no-referrer');
	return c.redirect(target, 302);
});
// Payments admin (lib/billing/*): providers, prices, tax, subscriptions; admin-api audits and stores credentials
app.route('/internal/billing', billingInternalRouter as never);
// Creator support admin (lib/support/*): job retries; admin-api checks support:manage
app.route('/internal/support', supportInternalRouter as never);

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
// CSAM response (docs/specs/CSAM-RESPONSE.md): super-admin actions relayed by admin-api
app.route('/internal/csam', csamInternalRouter);

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
 * daily, enforce data retention (Story 1.3, AC 5) and purge comments channels
 * removed more than 90 days ago (lib/channelComments/jobs.ts).
 * See src/lib/privacy/retention.ts and docs/compliance/GDPR.md.
 */
async function scheduled(controller: ScheduledController, rawEnv: AppBindings, ctx: ExecutionContext): Promise<void> {
	if (LIVE_SWEEP_CRONS.has(controller?.cron ?? '')) {
		// Every minute (production) or 5 (QA, stage): scheduled community posts whose time has come go live (lib/scheduled-posts.ts, #1218)
		ctx.waitUntil(
			publishDuePosts(rawEnv as never)
				.then((r) => (r.published || r.dropped ? logger.info('[ScheduledPosts] Run', r) : undefined))
				.catch((error) => logger.error('[ScheduledPosts] Run failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		// Every minute: end self-hosted sessions whose encoder went quiet, poll live Bunny sessions (lib/live/service.ts)
		ctx.waitUntil(
			// Through the search-sync wrapper: an ended stream's index rows follow its record (wiki E17)
			sweepLiveSessions(withSearchSync(rawEnv, ctx) as unknown as LiveEnv)
				.then((r) => (r.idleEnded || r.bunnyPolled ? logger.info('[Live] Sweep', r) : undefined))
				.catch((error) => logger.error('[Live] Sweep failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		// Every minute: premieres start and end (lib/live/premieres.ts, wiki E17). Through the search-sync wrapper:
		// its write hooks index the stream and move the video's media
		ctx.waitUntil(
			runPremieres(withSearchSync(rawEnv, ctx) as never)
				.then((r) => (r.started || r.ended || r.cancelled || r.failed ? logger.info('[Premiere] Tick', r) : undefined))
				.catch((error) => {
					logger.error('[Premiere] Tick failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'premieres', error);
				}),
		);
		// Every minute: people who asked hear of streams starting within 30 minutes (lib/live/reminders.ts, wiki E17)
		ctx.waitUntil(
			runHeadsUps(withSearchSync(rawEnv, ctx) as never)
				.then((r) => (r.sent || r.cancelled || r.failed ? logger.info('[LiveReminders] Tick', r) : undefined))
				.catch((error) => {
					logger.error('[LiveReminders] Tick failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'live-reminders', error);
				}),
		);
		// Every minute: probe each enabled media provider; playback moves off a failing one (lib/media/health.ts).
		// Never throws; the next minute is the retry, and a provider turning unhealthy is an Errors page item.
		ctx.waitUntil(runHealthCheck(rawEnv as never, ctx).then(() => undefined));
		return;
	}
	if (controller?.cron === PROCESSING_SWEEP_CRON) {
		// Payments: tiers of canceled subscriptions whose paid period ended, and ended comps (lib/billing/store.ts)
		ctx.waitUntil(
			sweepEntitlements(rawEnv as never).then(
				(r) => (r.synced || r.ended ? logger.info('[Billing] Entitlement sweep', r) : undefined),
				(error) => {
					logger.error('[Billing] Entitlement sweep failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'billing-entitlements', error);
				},
			),
		);
		// Safety net for the per-video processing-check loop (lib/processing/loop.ts)
		ctx.waitUntil(
			sweepProcessingVideos(withSearchSync(rawEnv, ctx) as never).catch((error) =>
				logger.error('[ProcessingSweep] Run failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// R2 backfill: restart run loops that went quiet, and queue Bunny removals whose grace period is over (lib/media/backfill/)
		ctx.waitUntil(
			Promise.all([restartQuietRuns(rawEnv as never), queueDueRemovals(rawEnv as never)]).then(
				() => undefined,
				(error) => logger.error('[Backfill] Sweep failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// R2 transcodes stuck in queued/transcoding (lib/media/r2-delivery.ts)
		ctx.waitUntil(
			sweepMediaJobs(rawEnv as never, Date.now(), ctx).then(
				() => undefined,
				(error) => logger.error('[MediaSweep] Run failed', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
		// R2 transcodes that stalled (no progress, a late retry, waiting too long to start) flag the admin once (lib/media/troubleshoot.ts)
		ctx.waitUntil(flagStalledTranscodes(rawEnv as never, ctx).then(() => undefined));
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
		// Safety net for per-object index repairs (lib/search/repairs.ts): a lost job message
		ctx.waitUntil(
			kickRepairJobIfPending(rawEnv as never).catch((error) =>
				logger.error('[IndexRepair] Could not start the repair job', { error: error instanceof Error ? error.message : String(error) }),
			),
		);
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
		// Hourly: social import sources whose scheduled sync is due (wiki TOOLS-ADMIN TA-9, lib/importSources/job.ts)
		ctx.waitUntil(
			queueDueSources(withSearchSync(rawEnv, ctx) as never)
				.then((queued) => (queued ? logger.info('[ImportSources] Due syncs queued', { queued }) : undefined))
				.catch((error) => {
					logger.error('[ImportSources] Due syncs not queued', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'import-sources-due', error);
				}),
		);
		// Hourly: pre-encoded renditions from desktop Studio that were never finished or used (D11, lib/media/prebuilt.ts)
		ctx.waitUntil(
			sweepStaging(rawEnv as never)
				.then((r) => (r.deleted ? logger.info('[Renditions] Staging sweep', r) : undefined))
				.catch((error) => {
					logger.error('[Renditions] Staging sweep failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'renditions-staging-sweep', error);
				}),
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
		// Hourly: the upcoming model is filled once from R2; a deleted stream's chat and reminders are removed
		// even if the job's message was lost (lib/live/metadata.ts, wiki E17)
		ctx.waitUntil(
			maintainLiveMetadata(rawEnv as never).catch((error) => {
				logger.error('[Live] Metadata upkeep failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'live-metadata', error);
			}),
		);
		// Hourly: creator support (lib/support/jobs.ts): release held gifts; at 01 UTC reconcile, disputes, payees.
		// Nothing is queued until support has data (one keyed read).
		ctx.waitUntil(
			queueSupportCron(rawEnv as never)
				.then((kinds) => (kinds.length ? logger.info('[Support] Cron jobs queued', { kinds }) : undefined))
				.catch((error) => {
					logger.error('[Support] Cron queueing failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'support-cron', error);
				}),
		);
		// Hourly: the app release index (wiki AUN-APP-UPDATES §3.2): new signed release manifests and
		// App Store versions into APP_CONFIG `releases`. A few small HTTPS reads; skipped while one runs.
		ctx.waitUntil(
			runReleaseIndex(rawEnv as never, ctx)
				.then((r) => (r.added.length || r.problems.length || r.feedErrors.length ? logger.info('[AppUpdates] Release index', { added: r.added, problems: r.problems.length, feedErrors: r.feedErrors }) : undefined))
				.catch((error) => {
					logger.error('[AppUpdates] Release index failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'app-release-index', error);
				}),
		);
		// Hourly: move legacy channel subscriptions into D1 (SCALABILITY-AUDIT AV-4)
		ctx.waitUntil(
			// Hourly: subscriptions whose renewal never arrived are checked with their provider (lib/billing/service.ts)
			queueReconciles(rawEnv as never)
				.then((n) => (n ? logger.info('[Billing] Reconciles queued', { n }) : undefined))
				.catch((error) => {
					logger.error('[Billing] Reconcile queueing failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'billing-reconcile', error);
				}),
		);
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
		// Hourly: Islamic seasons deleted more than 30 days ago are purged (lib/islamic-seasons.ts, wiki Epic 21 §5.3)
		if (rawEnv.SEARCH_DB) {
			ctx.waitUntil(
				purgeSeasons(rawEnv.SEARCH_DB as D1Database).then(
					(ids) => (ids.length ? logger.info('[Seasons] Purged', { count: ids.length }) : undefined),
					(error) => {
						logger.error('[Seasons] Purge failed', { error: error instanceof Error ? error.message : String(error) });
						reportJobFailure(rawEnv, ctx, 'islamic-seasons-purge', error);
					},
				),
			);
		}
		// Hourly: uploads that went quiet are completed or flagged for a
		// re-upload, never left hanging (lib/uploads/lifecycle.ts). Through the
		// search-sync wrapper so the ownership index sees the new status.
		ctx.waitUntil(
			sweepStalledUploads(withSearchSync(rawEnv, ctx) as never)
				.catch((error) => logger.error('[Uploads] Stalled-upload sweep failed', { error: error instanceof Error ? error.message : String(error) })),
		);
		// Hourly: discovery ranking (lib/ranking/job.ts) as an admin job: retried with backoff, DLQ, and an
		// Errors page item when it gives up. Skipped while one is queued or running, or ran under 50 min ago.
		ctx.waitUntil(
			startDiscoveryRank(rawEnv as never, 'system', { scheduled: true }).then(
				(r) => (r.existing ? undefined : logger.info('[Discovery] Ranking run queued', { jobId: r.job?.id })),
				(error) => {
					logger.error('[Discovery] Ranking run not queued', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'discovery-rank-schedule', error);
				},
			),
		);
		// Hourly: Move from YouTube upkeep: stale consents, settled imports closed, idle ones ended,
		// old snapshots emptied (lib/youtube-import/sweep.ts)
		ctx.waitUntil(
			sweepYoutubeImports(withSearchSync(rawEnv, ctx) as never).then(
				() => undefined,
				(error) => {
					logger.error('[YouTubeImport] Sweep failed', { error: error instanceof Error ? error.message : String(error) });
					reportJobFailure(rawEnv, ctx, 'youtube-import-sweep', error);
				},
			),
		);
		return;
	}
	// Retention deletes go through the search-sync wrapper so removed content leaves the index.
	const env = withSearchSync(rawEnv, ctx);
	ctx.waitUntil(
		(async () => {
			try {
				// Search and ownership indexes: weekly, one queued reconcile job per kind, each walking its
				// whole bucket in steps through the admin-jobs queue; daily, the repair job (lib/search/reconcileJobs.ts)
				await startIndexReconcile(rawEnv as never);
			} catch (error) {
				logger.error('[IndexMaintenance] Could not queue the daily passes', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'index-reconcile', error);
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
			// Comments a channel removed more than 90 days ago (lib/channelComments/jobs.ts; queued pages, never throws)
			await startCommentPurge(rawEnv as never, ctx);
			try {
				// Channel moves of the last 48 hours checked again (wiki AUN-CHANNEL-CLAIM §3.3)
				const moves = await reverifyRecentTransfers(withSearchSync(rawEnv, ctx) as never);
				if (moves.checked) logger.info('[ChannelMoves] Re-verify run', moves);
				if (moves.failed) reportJobFailure(rawEnv, ctx, 'channel-move-reverify', new Error(`${moves.failed} channel move(s) could not be re-verified`));
			} catch (error) {
				logger.error('[ChannelMoves] Re-verify run failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'channel-move-reverify', error);
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
			// Channel teams (docs/specs/CHANNEL-ROLES.md §9, §11): close invitations
			// past 14 days, delete activity rows older than a year.
			if (!rawEnv.SEARCH_DB) return;
			try {
				const stale = await resolveStaleClaims(rawEnv.SEARCH_DB, (channelId, userId) => roleOnChannel(rawEnv as never, channelId, userId));
				let expired = 0;
				for (let batch = 0; batch < 10; batch++) {
					const closed = await expireInvites(rawEnv.SEARCH_DB);
					expired += closed;
					if (closed < 500) break;
				}
				const pruned = await pruneTeamActivity(rawEnv.SEARCH_DB);
				logger.info('[ChannelTeam] Daily sweep finished', { stale, expired, pruned });
			} catch (error) {
				logger.error('[ChannelTeam] Daily sweep failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'channel-team', error);
			}
		})(),
	);
	ctx.waitUntil(
		(async () => {
			// Live chat removed or held 30 days ago (wiki E17-D1)
			if (!rawEnv.SEARCH_DB) return;
			try {
				const purged = await purgeRemovedChat(rawEnv.SEARCH_DB);
				if (purged) logger.info('[LiveChat] Retention purge', { purged });
			} catch (error) {
				logger.error('[LiveChat] Retention purge failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'live-chat-retention', error);
			}
		})(),
	);
	// Profile email reports older than 30 days (lib/admin/profile-email-reports.ts), on a budget of their own
	ctx.waitUntil(
		(async () => {
			const bucket = (rawEnv as unknown as { ADMIN_BACKUPS?: R2Bucket }).ADMIN_BACKUPS;
			if (!bucket) return;
			try {
				const now = new Date();
				const records = await sweepProfileEmailReports(bucket as never, now, new OperationBudget(100));
				const pointers = await sweepProfileEmailPointers(bucket as never, now, new OperationBudget(300));
				if (records.deleted || pointers.deleted || records.paused || pointers.paused) logger.info('[ProfileEmails] Expired reports swept', { records, pointers });
			} catch (error) {
				logger.error('[ProfileEmails] Report sweep failed', { error: error instanceof Error ? error.message : String(error) });
				reportJobFailure(rawEnv, ctx, 'profile-email-reports', error);
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
	if (resolved.kind === 'unsupported') return envelopeResponse(unsupportedVersionResponse(resolved.version), request);
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
 * - al-ummah-now-yt-import*: Move from YouTube jobs (lib/youtube-import/jobs.ts).
 * - otherwise PROCESSING_CHECK_QUEUE, which carries the per-video
 *   processing-check loop, the upload reaper's checks (kind "upload-reaper")
 *   new uploads' playlist adds (kind "playlist-add"), Bunny deletes after an
 *   owner delete (kind "bunny-delete"), the QA/stage test-library purge
 *   (kind "test-library-purge") and the channel collection backfill (kind
 *   "bunny-collection-backfill") and the privacy footprint backfill (kind
 *   "privacy-footprint-backfill") and the public MP4 backfill (kind "mp4-backfill")
 *   and Studio comments' index rebuilds and removed-comment purge (kind "channel-comments").
 * R2 writes go through the search-sync wrapper so changes reach the search
 * index and ownership rows like any API write.
 */
/** Each batch runs in its own error trail (queue, message id, attempt; calls made while handling it). */
function queue(batch: MessageBatch<unknown>, env: AppBindings, ctx: ExecutionContext): Promise<void> {
	return runWithErrorTrail({ job: batchJob(batch) }, () => handleQueueBatch(batch, env, ctx));
}

async function handleQueueBatch(batch: MessageBatch<unknown>, env: AppBindings, ctx: ExecutionContext): Promise<void> {
	try {
		// Run-account erasures (#887) are admin jobs on their own capped queue
		if (batch.queue.startsWith('al-ummah-now-admin-jobs') || batch.queue.startsWith('al-ummah-now-run-erase')) {
			const jobEnv = withSearchSync(env, ctx) as never;
			await handleAdminJobBatch(batch as unknown as { messages: readonly JobMessage[] }, jobEnv, ADMIN_JOB_HANDLERS, (job, error) =>
				job.kind.startsWith('billing.')
					? onBillingJobFailed(jobEnv, job, error)
					: job.kind.startsWith('support.')
						? onSupportJobFailed(jobEnv, job, error)
						: job.kind === ERASE_MEDIA_JOB
						? onEraseMediaFailed(jobEnv, job, error)
						: job.kind === DISCOVERY_RANK_JOB
						? Promise.resolve(flagDiscoveryRankFailed(jobEnv, job, error))
						: job.kind === 'import.attach'
							? onImportAttachFailed(jobEnv, job, error)
							: job.kind === SOURCE_SYNC_JOB_KIND
								? onSourceSyncFailed(jobEnv, job, error)
								: job.kind === TAKEOUT_JOB_KIND
									? onTakeoutFailed(jobEnv, job, error)
									: Promise.resolve(),
			);
			return;
		}
		// Move from YouTube jobs (lib/youtube-import/jobs.ts), one per invocation
		if (batch.queue.startsWith('al-ummah-now-yt-import')) {
			await handleYtImportBatch(batch as never, withSearchSync(env, ctx) as never, ctx);
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
		// R2 backfill of existing videos and Bunny removals (lib/media/backfill/, docs/media-delivery/BACKFILL.md)
		for (const msg of batch.messages.filter((m) => isBackfillMessage(m.body))) {
			await handleBackfillMessage(synced, ctx, msg, { removal: (e, c, videoId, last) => removeFromBunny(e, c, videoId, last) });
		}
		// Privacy footprint backfill (lib/privacy/footprints.ts), one bucket page per message
		for (const msg of batch.messages.filter((m) => isFootprintBackfillMessage(m.body))) await handleFootprintBackfillMessage(env as never, msg.body as never);
		// Studio comments: per-channel index rebuilds and the daily removed-comment purge (lib/channelComments/jobs.ts)
		const channelComments = batch.messages.filter((m) => isChannelCommentsMessage(m.body));
		if (channelComments.length) await handleChannelCommentsBatch({ messages: channelComments as never }, synced, ctx);
		const rest = batch.messages.filter((m) => !isFormat(m) && !isCollectionBackfill(m) && !isFootprintBackfillMessage(m.body) && !isPublishedAtBackfillMessage(m.body) && !isArchivePrivacyMessage(m.body) && !isMp4BackfillMessage(m.body) && !isChannelCommentsMessage(m.body) && !isBackfillMessage(m.body));
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
		reportServerError('api-videos', env as never, ctx, error, { route: `queue:${batch.queue}`, extra: { messages: batch.messages.length }, context: { job: batchJob(batch) } });
		throw error;
	}
}

/** A daily job that failed: reported to the admin Errors page (it runs again tomorrow). */
function reportJobFailure(env: AppBindings, ctx: ExecutionContext, job: string, error: unknown): void {
	reportServerError('api-videos', env as never, ctx, error, { route: `cron:${job}`, context: { job: { id: `cron:${job}` } } });
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
