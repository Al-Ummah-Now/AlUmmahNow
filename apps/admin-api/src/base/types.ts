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

  // R2 Buckets
  videos: R2Bucket;
  channels: R2Bucket;
  profiles: R2Bucket;
  playlists: R2Bucket;

  // KV
  AUTH_STORAGE: KVNamespace;

  // Queue
  queue: any;

  // Environment variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  Issuer: string;
  Audience: string;
  ClientId: string;
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
