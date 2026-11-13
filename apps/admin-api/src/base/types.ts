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
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  Issuer: string;
  Audience: string;
  ClientId: string;

  /** api-videos (content data owner): /internal/* over a service binding */
  VIDEOS?: Fetcher;
  /** Local dev without the binding: base URL of a running api-videos */
  VIDEOS_API_URL?: string;
  /** Moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md): this app's auth client */
  AUTH_MODERATION_CLIENT_ID?: string;
  /** Worker secret: that client's secret (set by AlUmmahNowAuth rotate-client-secret.ts) */
  AUTH_MODERATION_CLIENT_SECRET?: string | { get(): Promise<string> };
  /** auth-moderation-requests[-env]: sends and status reads to auth, with retries (lib/authModerationQueue.ts) */
  AUTH_REQUESTS_QUEUE?: Queue<import('../lib/authModerationQueue').AuthRequestMessage | import('../lib/invites').InviteMessage>;
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
  /** Contact mail jobs (lib/contact-mail-queue.ts); this worker consumes them */
  CONTACT_MAIL_QUEUE?: Queue<unknown>;
  /** Platform DLQ (al-ummah-now-dlq[-env]): final mail failures, stored by the processor in dead_letters */
  ERRORS_DLQ?: Queue<unknown>;

  // Errors page (lib/errors-*.ts)
  /** Admin notification address for new-error and spike alerts (production only); falls back to CONTACT_INBOX */
  ERRORS_ALERT_TO?: string;
  /** Private source maps uploaded by the release, for symbolicating browser stacks */
  SOURCEMAPS?: R2Bucket;
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
