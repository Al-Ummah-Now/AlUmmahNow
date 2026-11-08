import { Context } from 'hono';

/**
 * Authentication context containing user information from validated JWT token
 */
export interface AuthContext {
  /** User ID from JWT subject (sub) */
  userId: string;
  /** User email (if present in token) */
  email?: string;
  /** Full JWT payload */
  payload: Record<string, any>;
}

/**
 * Cloudflare Workers environment bindings
 * These are configured in wrangler.jsonc and wrangler.qa.jsonc
 */
export interface AppBindings {
  // R2 Buckets
  videos: R2Bucket;
  profiles: R2Bucket;
  channels: R2Bucket;
  playlists: R2Bucket;
  reports: R2Bucket;
  watch_history: R2Bucket;
  channel_sections: R2Bucket;
  community_posts: R2Bucket;
  channel_tabs: R2Bucket;
  'upload-defaults': R2Bucket;
  subtitles: R2Bucket;
  SCHEDULED_VIDEOS: R2Bucket;
  'scheduled-videos': R2Bucket;
  global_settings: R2Bucket;
  /** Processor-written view/watch-time rollups (al-ummah-now-messages bucket) */
  analytics_rollups?: R2Bucket;

  // D1: notification center + library per-user indexes (Epic 29; optional until bound)
  NOTIFICATIONS_DB?: D1Database;
  // D1 search index (Epic 29, migrations/search). Optional so local setups without it still run.
  SEARCH_DB?: D1Database;

  // KV Namespaces
  RATE_LIMIT_KV: KVNamespace;
  /** Workers rate limiting: watch-time reports per playback session (#235). Optional: unlimited without it. */
  WATCH_TIME_LIMITER?: RateLimit;
  TUS_SESSIONS: KVNamespace;

  // Queues
  queue: Queue;
  /** AI moderation queue (Epic 28). Optional: scans are skipped when unbound. */
  MODERATION_QUEUE?: Queue;

  // Secrets (accessed via .text() method)
  image_storage_key: { text(): Promise<string> };
  'bunny-stream-key': { text(): Promise<string> };
  bunny_stream_library_id: { text(): Promise<string> };
  INTERNAL_API_KEY: { text(): Promise<string> };

  // Environment Variables
  ZONE: string;
  ClientId: string;
  Issuer: string;
  Audience?: string;
  bunny_hostname?: string;
  /** "true" to sign Bunny Stream URLs (requires CDN token auth on the library) */
  BUNNY_SIGN_URLS?: string;
  /** Bunny Stream CDN token authentication key (Secrets Store) */
  BUNNY_TOKEN_KEY?: { get(): Promise<string> } | string;
  WEBSOCKET_URL?: string;
  CORS_ORIGINS?: string;
}

/**
 * Application context type with auth bindings
 * This is the context type that all endpoints receive
 */
export type AppContext = Context<{
  Bindings: AppBindings;
  Variables: {
    auth?: AuthContext;
    userId?: string;
    channelId?: string;
  };
}>;
