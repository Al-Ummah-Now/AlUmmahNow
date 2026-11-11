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
  /** R2 delivery beside Bunny (epic #687): public / private renditions. Optional: no dual write without them. */
  MEDIA?: R2Bucket;
  MEDIA_PRIVATE?: R2Bucket;
  /** R2 transcode jobs for apps/media */
  TRANSCODE_QUEUE?: Queue;
  MEDIA_SIGN_KEY?: { get(): Promise<string> } | string;
  MEDIA_PUBLIC_HOST?: string;
  /** Processor-written view/watch-time rollups (al-ummah-now-messages bucket) */
  analytics_rollups?: R2Bucket;

  // D1: notification center + library per-user indexes (Epic 29; optional until bound)
  NOTIFICATIONS_DB?: D1Database;
  // D1 search index (Epic 29, migrations/search); also holds the upload rate limits (middleware/rate-limit.ts).
  // Optional so local setups without it still run.
  SEARCH_DB?: D1Database;

  // KV Namespaces
  /** Workers rate limiting: watch-time reports per playback session (#235). Optional: unlimited without it. */
  WATCH_TIME_LIMITER?: RateLimit;
  /** Typeahead lookups per signed-in user or client IP (GET /api/search/suggestions) */
  SUGGEST_LIMITER?: RateLimit;
  TUS_SESSIONS: KVNamespace;
  /** Remote config: app version policies and feature flags (Epic 9.3 / 9.5). Optional: defaults without it. */
  APP_CONFIG?: KVNamespace;

  // Queues
  queue: Queue;
  /** AI moderation queue (Epic 28). Optional: scans are skipped when unbound. */
  MODERATION_QUEUE?: Queue;
  /** Per-video processing-check loop (lib/processing/loop.ts). Optional: no loop when unbound. */
  PROCESSING_CHECK_QUEUE?: Queue;

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
  /** Legacy Bunny library that only serves its existing videos (lib/bunny/libraries.ts) */
  BUNNY_LEGACY_LIBRARY_ID?: string;
  BUNNY_LEGACY_HOSTNAME?: string;
  BUNNY_LEGACY_STREAM_KEY?: { get(): Promise<string> } | string;
  BUNNY_LEGACY_TOKEN_KEY?: { get(): Promise<string> } | string;
  WEBSOCKET_URL?: string;
  CORS_ORIGINS?: string;
  // Live providers (lib/live/*)
  LIVE_MEDIA?: R2Bucket;
  LIVE_INGEST_SECRET?: { get(): Promise<string> } | string;
  LIVE_PUBLIC_HOST?: string;
  BUNNY_LIVE_INGEST_URL?: string;
  BUNNY_LIVE_ENABLED?: string;
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
    /** Caller's role on the channelId header's channel (channelIdMiddleware) */
    channelRole?: import('@al-ummah/shared-types').ChannelRole | null;
    /** Owner of the channelId header's channel: new videos belong to them */
    channelOwnerId?: string;
    creatorTier?: unknown;
    uploadAllowance?: { allowed: number; requested: number; retryAfter: number };
  };
}>;
