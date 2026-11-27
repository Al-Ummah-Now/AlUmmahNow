import { Context } from 'hono';
import { D1Database } from '../lib/types';

/**
 * Authentication context containing user information from validated JWT token
 */
export interface AuthContext {
  userId: string;
  email?: string;
  payload: Record<string, any>;
  roles?: string[];
}

/**
 * Environment bindings for admin-api
 */
export interface AdminBindings {
  // D1 Database
  REPORTS_DB: D1Database;
  /** Platform analytics rollups written by apps/cost-monitor (docs/admin/LIVE_OPS.md); absent in local dev. */
  COSTS_DB?: D1Database;
  /** cost-monitor's job queue (al-ummah-cost-jobs[-env]): the Errors page "Run again" of a cost job (COST-1). */
  COST_JOBS_QUEUE?: Queue<unknown>;
  /** Optional dedicated master secret for cost credentials; INTERNAL_API_KEY otherwise (shared-types cost-credentials.ts). */
  COST_CREDENTIALS_KEY?: string | { get(): Promise<string> };
  /** Public status page's D1 (apps/status): incidents written here, checks read; absent in local dev. */
  STATUS_DB?: D1Database;
  /** Search index (api-videos owns it); the section index rebuild reads it (AA-4). */
  SEARCH_DB?: D1Database;

  // R2 Buckets
  videos: R2Bucket;
  channels: R2Bucket;
  profiles: R2Bucket;
  playlists: R2Bucket;
  global_settings: R2Bucket;
  /** Theme packages made in the theme builder (lib/themePackages.ts) */
  theme_packages: R2Bucket;
  /** Community posts (read for AI moderation review; optional) */
  community_posts?: R2Bucket;

  // Queue
  queue: any;
  /** api-videos' processing-check queue: starts Short/video format backfill runs */
  PROCESSING_CHECK_QUEUE?: Queue;

  /** Token revocation list written by the auth worker (#437) */
  TOKEN_REVOCATIONS?: KVNamespace;

  // Environment variables
  /** Default daily neuron cap shown when D1 has none (mirrors the processor's var) */
  AI_MODERATION_DAILY_NEURON_CAP?: string;
  /** "1" where the creator-support test collector and test rail exist (QA, local; never production; wiki AUN-MEMBERS) */
  SUPPORT_TEST_PROVIDERS?: string;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  Issuer: string;
  Audience: string;
  ClientId: string;

  /** Cloudflare account of every al-ummah resource (Secrets Store writes, analytics) */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Payments credentials (lib/billing-secrets.ts): the Secrets Store they are written to */
  PAYMENTS_SECRETS_STORE_ID?: string;
  /** Payments credentials: Cloudflare API token with Account Secrets Store Edit (optional binding; without it credentials cannot be saved from the admin) */
  PAYMENTS_SECRETS_TOKEN?: string | { get(): Promise<string> };

  /** api-videos (content data owner): /internal/* over a service binding */
  VIDEOS?: Fetcher;
  /** Local dev without the binding: base URL of a running api-videos */
  VIDEOS_API_URL?: string;
  /** Moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md): this app's auth client */
  AUTH_MODERATION_CLIENT_ID?: string;
  /** Worker secret: that client's secret (set by AlUmmahNowAuth rotate-client-secret.ts) */
  AUTH_MODERATION_CLIENT_SECRET?: string | { get(): Promise<string> };
  /** auth-moderation-requests[-env]: sends and status reads to auth, with retries (lib/authModerationQueue.ts) */
  AUTH_REQUESTS_QUEUE?: Queue<
    import('../lib/authModerationQueue').AuthRequestMessage | import('../lib/invites').InviteMessage | import('../lib/deviceTokenRevocation').DeviceRevocationMessage
  >;
  /** Videos web origin for invite links' sign-in (docs/admin/INVITES.md); default: the admin host with admin. → videos. */
  VIDEOS_WEB_URL?: string;

  // WebSocket integration
  WEBSOCKET_URL?: string;
  // A Secrets Store binding in deployed workers, a plain string var in local dev
  INTERNAL_API_KEY?: string | { get(): Promise<string> };

  // Contact us (lib/contact*.ts)
  /** Resend API key: Secrets Store RESEND_API_KEY (the auth server's sender), plain string in local dev */
  RESEND_API_KEY?: string | { get(): Promise<string> };
  /** Support inbox notified of every new message, and the Reply-To of mail to senders */
  CONTACT_INBOX?: string;
  /** From address of contact mail; default "Al Ummah Now <support@alummahnow.net>" */
  CONTACT_FROM?: string;
  /** admin-web origin, for the inbox link in notifications */
  ADMIN_WEB_URL?: string;
  /** www origin of the newsletter's confirm and unsubscribe links (lib/newsletter.ts) */
  NEWSLETTER_SITE_URL?: string;
  /** Public Turnstile site key, returned with human_check_required (lib/bot-guard.ts) */
  TURNSTILE_SITE_KEY?: string;
  /** Contact mail jobs (lib/contact-mail-queue.ts); this worker consumes them */
  CONTACT_MAIL_QUEUE?: Queue<unknown>;
  /** Platform DLQ (al-ummah-now-dlq[-env]): final mail failures, stored by the processor in dead_letters */
  ERRORS_DLQ?: Queue<unknown>;
  /** Status page subscriptions (lib/status-notify.ts): confirmation mail, incident fan-out, deliveries; consumed here */
  STATUS_NOTIFY_QUEUE?: Queue<unknown>;
  /** Public status page origin for links in status mail; defaults by ENVIRONMENT (the local stack sets it) */
  STATUS_PAGE_URL?: string;

  // Errors page (lib/errors-*.ts)
  /** Admin notification address for new-error and spike alerts (production only); falls back to CONTACT_INBOX */
  ERRORS_ALERT_TO?: string;
  /** Private source maps uploaded by the release, for symbolicating browser stacks */
  SOURCEMAPS?: R2Bucket;
  /** Opt-in scrubbed diagnostic log bundles linked by ERR-XXXX-XXXX (30-day R2 expiry) */
  DIAGNOSTICS?: R2Bucket;
  /** Error ingest queue (al-ummah-now-errors[-stage|-qa]): /internal/errors enqueues, this Worker consumes */
  ERRORS_QUEUE?: Queue<unknown>;
  /** Processor service binding: Retry of dead-lettered messages (POST /dlq/replay) */
  PROCESSOR?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  /** Scheduler service: Retry of a scheduled publish that failed for good (Errors page) */
  SCHEDULER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/**
 * Application context type with auth bindings
 */
export type AppContext = Context<{
  Bindings: AdminBindings;
  Variables: {
    auth?: AuthContext;
    userId?: string;
  };
}>;
