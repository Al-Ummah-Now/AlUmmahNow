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
 * Application context type with auth bindings
 * This is the context type that all endpoints receive
 */
export type AppContext = Context<{
  Bindings: any;
  Variables: {
    auth?: AuthContext;
    userId?: string;
    channelId?: string;
  };
}>;
