import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors';
import { authMiddleware, adminMiddleware } from "./middleware/auth";
import { loggingMiddleware, markErrorLogged } from "./middleware/logging";
import { withLogging } from "@al-ummah/logger";
import { robotsTxtResponse, withNoIndex } from "./lib/crawlers";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';
import { publicSiteTheme } from './lib/siteSettings';
import themesRouter, { publicThemes } from './routers/themes.router';
import contentRouter from './routers/content.router';
import suggestRouter from './routers/suggest.router';
import reportQueueRouter from './routers/reportQueue.router';
import { scheduledReportMetaSync } from './lib/moderation/reportMeta';
import invitesRouter from './routers/invites.router';
import sitesRouter from './routers/sites.router';
import { scheduleInviteSyncs } from './lib/invites';
import processingRouter from './routers/processing.router';
import mediaRouter from './routers/media.router';
import notificationSettingsRouter from './routers/notificationSettings.router';
import opsRouter from './routers/ops.router';
import abuseRouter from './routers/abuse.router';
import statusRouter from './routers/status.router';
import staleUploadsRouter from './routers/staleUploads.router';
import trashRouter from './routers/trash.router';
import { isHourlyTick, runTrashCleanup } from './lib/trash';
import type { AdminBindings } from './base/types';
import { contactSubmit } from './endpoints/contact/ContactSubmit';
import { contactMailConsumer, type ContactMailJob, type QueueMessageLike } from './lib/contact-mail-queue';
import { handleAuthRequestBatch, scheduleSyncs, type AuthRequestMessage } from './lib/authModerationQueue';
import { consumeErrorQueue, errorsIngest, reportAdminApiError } from './endpoints/errors/ErrorsIngest';
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

// Contact us messages from the videos site's server (X-API-Key; endpoints/contact/ContactSubmit.ts)
app.post('/internal/contact', (c) => contactSubmit(c as never));

// Published theme packages: compiled CSS, theme.json and assets, immutable per version
app.route('/public/themes', publicThemes as never);
// Error events from every app (X-API-Key; endpoints/errors/ErrorsIngest.ts)
app.post('/internal/errors', (c) => errorsIngest(c as never));

// Apply auth + admin middleware to all API routes
app.use('/api/*', authMiddleware);
app.use('/api/*', adminMiddleware);

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

// Admin autocomplete: suggestions for every search and lookup box in admin-web
app.route('/api/suggest', suggestRouter);
// Invite creators: pre-provisioned accounts, plan and channels before first sign-in (docs/admin/INVITES.md)
app.route('/api/invites', invitesRouter);
// White-label scholar sites: grant, change, revoke, restore (wiki AUN-SCHOLAR-SITES §8)
app.route('/api/sites', sitesRouter);

// Upload processing health (sync from Bunny, retry, mark failed): permission-checked, audited proxy to api-videos
app.route('/api/processing', processingRouter);

// Delivery comparison (Bunny vs R2, epic #687): the switch, transcode jobs, QoE and cost; permission-checked, audited proxy to api-videos
app.route('/api/media', mediaRouter);

// Platform notification settings (what opening the notification menu does): settings:manage to change, audited proxy to api-videos
app.route('/api/notification-settings', notificationSettingsRouter);

// Platform analytics (Operations page, docs/admin/LIVE_OPS.md): reads apps/cost-monitor's rollups; ops:read / ops:manage
app.route('/api/ops', opsRouter);
// Abuse panel: Turnstile and rate-limit counters from Analytics Engine (routers/abuse.router.ts); ops:read
app.route('/api/abuse', abuseRouter);

// Public status page incidents and maintenance (docs/status-page/README.md): writes apps/status's D1; status:manage
app.route('/api/status', statusRouter);

// Stale uploads (abandoned placeholders, Bunny orphans): permission-checked, audited proxy to api-videos
app.route('/api/uploads/stale', staleUploadsRouter as never);

// Recently deleted (contact messages, themes, creator tiers): restore, delete permanently now
app.route('/api/trash', trashRouter as never);

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
 *     admin E2E suite's old reports (lib/report-stats.ts purgeE2eReports)
 */
async function scheduled(controller: ScheduledController, env: AdminBindings, ctx: ExecutionContext): Promise<void> {
  if (controller.cron === '17 3 * * *') {
    ctx.waitUntil(runErrorRetention(env as never));
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
  }
  ctx.waitUntil(scheduledReportMetaSync(env as never));
  ctx.waitUntil(scheduleInviteSyncs(env as never).catch((error) => logger.error('[Invites] scheduled status reads failed', { error: String(error) })));
}

/**
 * Queue consumers:
 *   - contact mail jobs (lib/contact-mail-queue.ts)
 *   - requests to auth: auth-moderation-requests[-env] and its DLQ (lib/authModerationQueue.ts)
 *   - error ingest and its DLQ: al-ummah-now-errors[-dlq][-env] (endpoints/errors/ErrorsIngest.ts)
 */
async function queue(batch: { queue: string; messages: readonly QueueMessageLike<ContactMailJob>[] }, env: AdminBindings): Promise<void> {
  if (/(^|-)contact-mail(-|$)/.test(batch.queue)) return contactMailConsumer(batch, env);
  if (/^auth-moderation-requests(-|$)/.test(batch.queue)) return handleAuthRequestBatch(batch as unknown as MessageBatch<AuthRequestMessage>, env);
  if (/(^|-)errors(-dlq)?(-|$)/.test(batch.queue)) return consumeErrorQueue(batch, env);
  logger.error('[Queue] Batch for an unknown queue; retrying', { queue: batch.queue });
  for (const m of batch.messages) m.retry();
}

/** Nothing on the admin API host is for search engines (lib/crawlers.ts) */
const fetchHandler: typeof app.fetch = async (request, env, ctx) =>
  robotsTxtResponse(request) ?? withNoIndex(await app.fetch(request, env, ctx));

export default withLogging({ fetch: fetchHandler, scheduled, queue });
export { app };
