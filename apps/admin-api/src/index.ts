import { fromHono } from "chanfana";
import { batchJob, idsFromRoute } from '@al-ummah/shared-types';
import { runWithErrorTrail } from '@al-ummah/shared-types/error-trail';
import { adminRequestOrigin } from './lib/request-origin';
import { Hono } from "hono";
import { cors } from 'hono/cors';
import { authMiddleware, adminMiddleware } from "./middleware/auth";
import { passkeyMiddleware } from "./middleware/passkeys";
import { registerStepUpRoutes } from "./middleware/step-up-routes";
import { loggingMiddleware, markErrorLogged } from "./middleware/logging";
import { withLogging } from "@al-ummah/logger";
import { robotsTxtResponse, withNoIndex } from "./lib/crawlers";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';
import { publicSiteTheme } from './lib/siteSettings';
import { mobileAppsEnvironment, readMobileApps } from './lib/mobileApps';
import { appleAppSiteAssociation, assetLinks } from '@al-ummah/shared-types';
import themesRouter, { publicThemes } from './routers/themes.router';
import contentRouter from './routers/content.router';
import suggestRouter from './routers/suggest.router';
import { auditRouter, namesRouter } from './routers/audit.router';
import reportQueueRouter from './routers/reportQueue.router';
import reviewRouter from './routers/review.router';
import { purgeReviewMedia, reviewStats } from './lib/review/queue';
import { writeReviewQueueMinutes } from '@al-ummah/shared-types';
import { scheduledReportMetaSync } from './lib/moderation/reportMeta';
import { errorsPipelineSink, syncCostAlerts } from './lib/opsCost';
import { costAlertNotifier } from './lib/cost-alert-mail';
import { runWeeklyDigest } from './lib/costs';
import costsRouter from './routers/costs.router';
import invitesRouter from './routers/invites.router';
import sitesRouter from './routers/sites.router';
import { siteDomainsStatusRouter, staffSiteDomainsRouter, studioSiteDomainsRouter } from './routers/siteDomains.router';
import { runDomainChecks } from './lib/sites/domains';
import { scheduleInviteSyncs } from './lib/invites';
import processingRouter from './routers/processing.router';
import mediaRouter from './routers/media.router';
import youtubeImportRouter from './routers/youtubeImport.router';
import adminImportRouter from './routers/adminImport.router';
import notificationSettingsRouter from './routers/notificationSettings.router';
import socialRouter from './routers/social.router';
import videoCategoriesRouter from './routers/videoCategories.router';
import discoveryRouter from './routers/discovery.router';
import translateRouter from './routers/translate.router';
import emailTemplatesRouter from './routers/emailTemplates.router';
import appConfigRouter from './routers/appConfig.router';
import opsRouter from './routers/ops.router';
import abuseRouter from './routers/abuse.router';
import vitalsRouter from './routers/vitals.router';
import statusRouter from './routers/status.router';
import newsletterRouter from './routers/newsletter.router';
import newsletterInternal from './endpoints/newsletter/NewsletterInternal';
import { publicFeaturesRoute } from './lib/public-features';
import reviewAlertsRouter from './routers/reviewAlerts.router';
import staleUploadsRouter from './routers/staleUploads.router';
import trashRouter from './routers/trash.router';
import csamRouter from './routers/csam.router';
import billingRouter from './routers/billing.router';
import { handleCloudflareWebhook, isCsamRetentionTick, runCsamRetention } from './lib/csam';
import { isHourlyTick, runTrashCleanup } from './lib/trash';
import type { AdminBindings } from './base/types';
import { contactSubmit } from './endpoints/contact/ContactSubmit';
import { contactMailConsumer, type ContactMailJob, type QueueMessageLike } from './lib/contact-mail-queue';
import { handleAuthRequestBatch, scheduleSyncs, type AuthRequestMessage } from './lib/authModerationQueue';
import { consumeErrorQueue, errorsIngest, reportAdminApiError } from './endpoints/errors/ErrorsIngest';
import { statusNotifyConsumer } from './lib/status-notify';
import { runErrorRetention } from './lib/errors-retention';
import { purgeE2eReports } from './lib/report-stats';

// ==========================================
// APP SETUP
// ==========================================

const app = new Hono();

// Global error handler
// Uncaught exceptions are recorded on the Errors page; the caller gets only a reference
app.onError((err, c) => {
  logger.error('Unhandled error', { error: err, method: c.req.method, path: c.req.path, ray: c.req.header('cf-ray') || undefined });
  markErrorLogged(c);
  const reference = reportAdminApiError(c as never, err, 500);
  return c.json({ success: false, error: 'Internal server error', reference }, 500, reference ? { 'X-Error-Ref': reference } : {});
});

// 5xx answers that did not throw are recorded too
app.use('*', async (c, next) => {
  await next();
  if (c.res.status >= 500 && !c.res.headers.has('X-Error-Ref')) {
    const reference = reportAdminApiError(c as never, null, c.res.status);
    try {
      if (reference) c.res.headers.set('X-Error-Ref', reference);
    } catch {
      // immutable headers (a proxied response): the event is recorded anyway
    }
  }
});

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================

// CORS origin validation
const isAllowedOrigin = (origin: string): boolean => {
  const allowedOrigins = [
    // Production
    'https://alummahnow.net',
    'https://www.alummahnow.net',
    'https://admin.alummahnow.net',
    // Staging
    'https://staging.alummahnow.net',
    'https://admin-staging.alummahnow.net',
    // Development
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3090',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3086',
    'http://127.0.0.1:3090',
  ];
  return allowedOrigins.includes(origin);
};

// Setup CORS
app.use('*', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : '',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false,
}));

// OPTIONS handler for API endpoints
app.options('/api/*', (c) => {
  const origin = c.req.header('Origin') || '';
  const allowedOrigin = isAllowedOrigin(origin) ? origin : '';
  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin);
  }
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  c.header('Access-Control-Max-Age', '600');
  c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  return new Response('', { status: 204 });
});

// ==========================================
// LOGGING MIDDLEWARE
// ==========================================

// Apply logging middleware to all API routes
app.use('/api/*', loggingMiddleware);

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

// The site theme is public and read by the web apps on every page, so it is short-lived at the edge
app.get('/public/site-theme', async (c) => {
  const answer = await publicSiteTheme((c.env as AdminBindings).REPORTS_DB, new URL(c.req.url).origin);
  return c.json(answer, 200, { 'Cache-Control': 'public, max-age=30' });
});

// Which optional public-site features can work (booleans only): www leaves out what can't (lib/public-features.ts)
app.get('/public/features', (c) => publicFeaturesRoute(c as never));

// Mobile apps settings, all public by nature (they are published in the domain association files):
// the videos site serves AASA / assetlinks.json from them and api-videos reads the attestation switches
app.get('/public/mobile-apps', async (c) => {
  const env = c.env as AdminBindings;
  const { settings } = await readMobileApps(env.REPORTS_DB, mobileAppsEnvironment(env.ENVIRONMENT));
  return c.json({ settings }, 200, { 'Cache-Control': 'public, max-age=60' });
});
// The two domain association files, built here so the sites that serve them (videos web on its host)
// only pass them through. 404 while they would list no app: empty means not served.
app.get('/public/mobile-apps/:file{apple-app-site-association|assetlinks\\.json}', async (c) => {
  const env = c.env as AdminBindings;
  const { settings } = await readMobileApps(env.REPORTS_DB, mobileAppsEnvironment(env.ENVIRONMENT));
  const doc = c.req.param('file') === 'assetlinks.json' ? assetLinks(settings) : appleAppSiteAssociation(settings);
  if (!doc) return c.json({ error: 'not_configured' }, 404, { 'Cache-Control': 'public, max-age=60' });
  return c.json(doc, 200, { 'Cache-Control': 'public, max-age=60' });
});

// Contact us messages from the videos site's server (X-API-Key; endpoints/contact/ContactSubmit.ts)
app.post('/internal/contact', (c) => contactSubmit(c as never));
// Newsletter sign-up, confirm and unsubscribe from www's server (X-API-Key; endpoints/newsletter/NewsletterInternal.ts)
app.route('/internal/newsletter', newsletterInternal as never);

// Published theme packages: compiled CSS, theme.json and assets, immutable per version
app.route('/public/themes', publicThemes as never);
// Error events from every app (X-API-Key; endpoints/errors/ErrorsIngest.ts)
app.post('/internal/errors', (c) => errorsIngest(c as never));
// Cloudflare Notifications (docs/specs/CSAM-RESPONSE.md §9): signed with cf-webhook-auth; our URLs open CSAM cases
app.post('/webhooks/cloudflare/notifications', async (c) => {
  const out = await handleCloudflareWebhook(c.env as never, { secret: c.req.header('cf-webhook-auth'), body: await c.req.text() });
  return c.json({ success: out.status === 200, ...(out.opened !== undefined ? { opened: out.opened } : {}) }, out.status);
});
// Studio → Site → Domains from the videos site's server (X-API-Key + the user's token; channel.edit)
app.route('/internal/site-domains', studioSiteDomainsRouter as never);
// Whether own domains can be offered at all (api-videos /api/me/features → siteDomains)
app.route('/internal/site-domains-status', siteDomainsStatusRouter as never);

// Apply auth + admin middleware to all API routes
app.use('/api/*', authMiddleware);
app.use('/api/*', adminMiddleware);
// Staff passkeys (wiki AUTH-PASSKEYS): 403 passkey_required after the deadline without a passkey sign-in
app.use('/api/*', passkeyMiddleware);
// High-risk actions need a sign-in under 15 minutes old (401 step_up_required); list in middleware/step-up-routes.ts
registerStepUpRoutes(app);

// ==========================================
// OPENAPI SETUP
// ==========================================

const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: {
      title: "Al Ummah Admin API",
      version: "1.0.0",
      description: "Admin and moderation API for Al Ummah platform. All endpoints require admin or moderator role.",
    },
    servers: [
      { url: "http://127.0.0.1:3090", description: "Local development" },
      { url: "https://admin-api.alummahnow.net", description: "Production" },
    ],
    security: [
      { bearerAuth: [] }
    ],
  },
});

// ==========================================
// REGISTER ROUTERS
// ==========================================

registerAllRouters(openapi);

// Theme builder (zip and file bodies, so plain Hono): /api/themes
app.route('/api/themes', themesRouter as never);

// Platform content management (channels, videos, comments, playlists, posts,
// videos users): permission-checked, audited proxy to api-videos
app.route('/api/content', contentRouter);

// Reports queue: Action needed (grouped per item) and History, with search (shared-types report-queue.ts)
app.route('/api/moderation/queue', reportQueueRouter as never);
// Pre-publication video review: the queue for people, web and native (docs/specs/VIDEO-REVIEW.md §6)
app.route('/api/review', reviewRouter as never);

// Admin autocomplete: suggestions for every search and lookup box in admin-web
app.route('/api/suggest', suggestRouter);
// Audit log page (merged audit tables, audit:read) and names for the ids every admin page shows
app.route('/api/audit', auditRouter);
app.route('/api/names', namesRouter);
// Invite creators: pre-provisioned accounts, plan and channels before first sign-in (docs/admin/INVITES.md)
app.route('/api/invites', invitesRouter);
// White-label scholar sites: grant, change, revoke, restore (wiki AUN-SCHOLAR-SITES §8)
app.route('/api/sites', staffSiteDomainsRouter as never);
app.route('/api/sites', sitesRouter);

// Upload processing health (sync from Bunny, retry, mark failed): permission-checked, audited proxy to api-videos
app.route('/api/processing', processingRouter);

// Delivery comparison (Bunny vs R2, epic #687): the switch, transcode jobs, QoE and cost; permission-checked, audited proxy to api-videos
app.route('/api/media', mediaRouter);

// Move from YouTube (wiki AUN-YT-IMPORT): on/off and the Google client id; media:manage, audited proxy to api-videos
app.route('/api/youtube-import', youtubeImportRouter);
// Admin Tools, the desktop import app (wiki TOOLS-ADMIN): imports:manage, audited
app.route('/api/admin/import', adminImportRouter);

// Platform notification settings (what opening the notification menu does): settings:manage to change, audited proxy to api-videos
app.route('/api/notification-settings', notificationSettingsRouter);
// Social auto-post (wiki AUN-SOCIAL): kill switches, the X spend cap, network credentials; settings:manage, audited proxy to api-videos
app.route('/api/social', socialRouter);
// Video categories (admin-managed list in the search D1): videos:categories to change, audited
app.route('/api/video-categories', videoCategoriesRouter);
// Discovery curation (pins, exclusions, home rail order, run now, preview): discovery:manage to change, audited (wiki E07)
app.route('/api/discovery', discoveryRouter);
// Translate for staff-set en/ar fields (L10N rule; routers/translate.router.ts)
app.route('/api/translate', translateRouter);
// Settings › Emails: admin-edited system emails, versions, preview and test send (emails:manage; routers/emailTemplates.router.ts)
app.route('/api/email-templates', emailTemplatesRouter);
app.route('/api/app-config', appConfigRouter);

// Platform analytics (Operations page, docs/admin/LIVE_OPS.md): reads apps/cost-monitor's rollups; ops:read / ops:manage
app.route('/api/ops', opsRouter);
// Costs page (COST-1): connections, alert settings, opt-in alert emails, the cost dashboard
app.route('/api/costs', costsRouter);
// Abuse panel: Turnstile and rate-limit counters from Analytics Engine (routers/abuse.router.ts); ops:read
app.route('/api/abuse', abuseRouter);
app.route('/api/vitals', vitalsRouter);

// Public status page incidents and maintenance (docs/status-page/README.md): writes apps/status's D1; status:manage
app.route('/api/status', statusRouter);
// Newsletter subscribers and issues (AlUmmahNowUI#6): newsletter:manage, audited
app.route('/api/newsletter', newsletterRouter as never);
// Review alerts for the native Admin app: rota, escalation, staff devices, timings
app.route('/api/review-alerts', reviewAlertsRouter);

// Stale uploads (abandoned placeholders, Bunny orphans): permission-checked, audited proxy to api-videos
app.route('/api/uploads/stale', staleUploadsRouter as never);

// Recently deleted (contact messages, themes, creator tiers): restore, delete permanently now
app.route('/api/trash', trashRouter as never);

// CSAM cases (docs/specs/CSAM-RESPONSE.md): super admins only, audited
app.route('/api/csam', csamRouter as never);

// Payments (wiki AUN-SUBS): providers, prices, subscriptions; billing:* permissions, audited, credentials to Secrets Store
app.route('/api/billing', billingRouter as never);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'admin-api',
    // Worker version id serving this request (the release smoke checks it)
    deployment: (c.env as { CF_VERSION_METADATA?: { id: string } }).CF_VERSION_METADATA?.id ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// EXPORT
// ==========================================

/**
 * Cron (wrangler triggers.crons):
 *   - every 5 minutes: queue status reads of open requests to auth (lib/authModerationQueue.ts)
 *     and of open invites (lib/invites.ts); fill the name copies of new reports (lib/moderation/reportMeta.ts)
 *   - 03:17 UTC daily: retention of error data and old source maps (lib/errors-retention.ts)
 *   - hourly (the 5-minute tick at the top of each UTC hour): soft-delete cleanup, the only hard
 *     delete of contact messages, themes and creator tiers (lib/trash.ts); on QA/stage also the
 *     admin E2E suite's old reports (lib/report-stats.ts purgeE2eReports); spend alerts: the $500 budget
 *     at 50/80/100% and a projected overrun (production), daily spend jumps per env and driver (lib/opsCost.ts)
 */
async function scheduled(controller: ScheduledController, env: AdminBindings, ctx: ExecutionContext): Promise<void> {
  if (controller.cron === '17 3 * * *') {
    ctx.waitUntil(runErrorRetention(env as never));
    // Pre-publication review retention (VR12): media 30 days after the decision, findings 12 months
    ctx.waitUntil(
      purgeReviewMedia(env as never)
        .then(({ purged }) => { if (purged > 0) logger.info('[Review] Purged review media', { purged }); })
        .catch((error) => logger.error('[Review] Review media purge failed', { error: String(error) })),
    );
    return;
  }
  ctx.waitUntil(scheduleSyncs(env).catch((error) => logger.error('[AuthRequests] scheduled status reads failed', { error: String(error) })));
  if (isHourlyTick(controller.scheduledTime)) {
    ctx.waitUntil(runTrashCleanup(env as never).then(() => undefined));
    ctx.waitUntil(
      purgeE2eReports(env.REPORTS_DB as never, env.ENVIRONMENT)
        .then((purged) => { if (purged > 0) logger.info('[Reports] Purged E2E reports', { purged }); })
        .catch((error) => logger.error('[Reports] E2E report purge failed', { error: String(error) })),
    );
    ctx.waitUntil(
      syncCostAlerts(env as never, errorsPipelineSink(env), new Date(controller.scheduledTime), costAlertNotifier(env as never))
        .then(() => undefined)
        .catch((error) => logger.error('[OpsCost] Spend alert check failed', { error: String(error) })),
    );
    // Weekly cost digest to the admins who opted in (COST-1), on the Costs page's weekday and hour
    ctx.waitUntil(
      runWeeklyDigest(env as never, new Date(controller.scheduledTime))
        .then((queued) => { if (queued) logger.info('[Costs] Weekly digest queued', { queued }); })
        .catch((error) => logger.error('[Costs] Weekly digest failed', { error: String(error) })),
    );
  }
  // CSAM evidence past its retention (never before the report + retention days, never under a hold)
  if (isCsamRetentionTick(controller.scheduledTime)) {
    ctx.waitUntil(
      runCsamRetention(env as never)
        .then((out) => { if (out.deleted || out.failed) logger.info('[CSAM] Retention sweep', out); })
        .catch((error) => logger.error('[CSAM] Retention sweep failed', { error: String(error) })),
    );
  }
  ctx.waitUntil(scheduledReportMetaSync(env as never));
  // Pre-publication review: the live queue time creators see when a video is held (VR6)
  if ((env as { VIDEO_REVIEW_ALLOWED?: string }).VIDEO_REVIEW_ALLOWED === 'true') ctx.waitUntil(
    reviewStats(env.REPORTS_DB as never)
      .then((stats) => (env.global_settings ? writeReviewQueueMinutes(env.global_settings as never, stats.queueMinutes) : undefined))
      .catch((error) => logger.warn('[Review] Queue time not published', { error: String(error) })),
  );
  ctx.waitUntil(scheduleInviteSyncs(env as never).catch((error) => logger.error('[Invites] scheduled status reads failed', { error: String(error) })));
  // Own domains of scholar sites (#1212): only the due checks (indexed), every 10 min then daily
  ctx.waitUntil(runDomainChecks(env as never, controller.scheduledTime).then(() => undefined).catch((error) => logger.error('[SiteDomains] scheduled checks failed', { error: String(error) })));
}

/**
 * Queue consumers:
 *   - contact mail jobs (lib/contact-mail-queue.ts)
 *   - status page subscriptions: confirmations, incident fan-out, deliveries (lib/status-notify.ts)
 *   - requests to auth: auth-moderation-requests[-env] and its DLQ (lib/authModerationQueue.ts)
 *   - error ingest and its DLQ: al-ummah-now-errors[-dlq][-env] (endpoints/errors/ErrorsIngest.ts)
 */
function queue(batch: { queue: string; messages: readonly QueueMessageLike<ContactMailJob>[] }, env: AdminBindings): Promise<void> {
  return runWithErrorTrail({ job: batchJob(batch as never) }, () => handleQueueBatch(batch, env));
}

async function handleQueueBatch(batch: { queue: string; messages: readonly QueueMessageLike<ContactMailJob>[] }, env: AdminBindings): Promise<void> {
  if (/(^|-)contact-mail(-|$)/.test(batch.queue)) return contactMailConsumer(batch, env);
  if (/(^|-)status-notify(-|$)/.test(batch.queue)) return statusNotifyConsumer(batch, env);
  if (/^auth-moderation-requests(-|$)/.test(batch.queue)) return handleAuthRequestBatch(batch as unknown as MessageBatch<AuthRequestMessage>, env);
  if (/(^|-)errors(-dlq)?(-|$)/.test(batch.queue)) return consumeErrorQueue(batch, env);
  logger.error('[Queue] Batch for an unknown queue; retrying', { queue: batch.queue });
  for (const m of batch.messages) m.retry();
}

/** Nothing on the admin API host is for search engines (lib/crawlers.ts) */
// One error trail per request / queue batch: errors reported meanwhile carry the ids, failed upstream calls and steps
const fetchHandler: typeof app.fetch = (request, env, ctx) =>
  runWithErrorTrail({ ...idsFromRoute(new URL(request.url).pathname), origin: adminRequestOrigin(request, env) }, async () => robotsTxtResponse(request) ?? withNoIndex(await app.fetch(request, env, ctx)));

export default withLogging({ fetch: fetchHandler, scheduled, queue });
export { app };
