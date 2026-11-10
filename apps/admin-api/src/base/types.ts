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
  /** Search index (api-videos owns it); the section index rebuild reads it (AA-4). */
  SEARCH_DB?: D1Database;

  // R2 Buckets
  videos: R2Bucket;
  channels: R2Bucket;
  profiles: R2Bucket;
  playlists: R2Bucket;
  global_settings: R2Bucket;
  /** Community posts (read for AI moderation review; optional) */
  community_posts?: R2Bucket;

  // Queue
  queue: any;

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

  // WebSocket integration
  WEBSOCKET_URL?: string;
  // A Secrets Store binding in deployed workers, a plain string var in local dev
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
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
