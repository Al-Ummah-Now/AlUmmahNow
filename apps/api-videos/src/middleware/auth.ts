import { Context, Next } from 'hono';
import { AUTH_CONFIG, getAuthConfig } from './auth-config';
import { getClient } from '../lib/openauth-client';
import { logger } from '../lib/logger';
import { isUserScopedRoute } from '../lib/reactions';
import { channelRoleOf } from '@al-ummah/shared-types';
import { memberMayActAs } from '../lib/channelAccess';
import { decodeVerifiedClaims, isLegacyLongLivedToken, isTokenRevoked } from '../lib/token-revocation';

// Type for the decoded JWT payload from OpenAuth
interface AuthPayload {
  sub: string; // Subject (user ID)
  email?: string;
  iat: number; // Issued at
  exp: number; // Expiration
  aud?: string; // Audience
  iss?: string; // Issuer
  roles?: string[]; // RBAC role names from the auth server (e.g. "Super Admin")
}

// Type for the auth context that will be available in handlers
export interface AuthContext {
  userId: string;
  email?: string;
  payload: AuthPayload;
}

/**
 * Authentication middleware for validating JWT tokens from OpenAuth
 * Expects the token in the Authorization header as "Bearer <token>"
 */
export async function authMiddleware(c: Context, next: Next) {
  try {
    // Get the Authorization header
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Missing or invalid Authorization header. Expected: Bearer <token>'
      }, 401);
    }

    // Extract the token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      return c.json({
        success: false,
        error: 'Missing authentication token'
      }, 401);
    }

    // Validate the JWT token with signature verification
    const payload = await validateJWTWithSignature(token, c.env);
    
    if (!payload) {
      return c.json({
        success: false,
        error: 'Invalid or expired authentication token'
      }, 401);
    }

    // Add auth context to the request
    c.set('auth', {
      userId: payload.sub,
      email: payload.email,
      payload
    } as AuthContext);

    // Set userId in context for backward compatibility with existing endpoints
    c.set('userId', payload.sub);

    return await next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return c.json({
      success: false,
      error: 'Authentication failed'
    }, 401);
  }
}

/**
 * JWT validation that verifies signature with OpenAuth subjects
 */
async function validateJWTWithSignature(token: string, env?: any): Promise<AuthPayload | null> {
  try {
    if (!env) {
      logger.error('Environment not provided for JWT signature validation');
      return null;
    }

    // Get dynamic auth configuration based on environment
    const authConfig = getAuthConfig(env);
    
    // Get the OpenAuth client
    const client = await getClient(env);
    
    // Verify the token using OpenAuth client with subjects
    const result = await client.verify(AUTH_CONFIG.SUBJECTS, token, { refresh: undefined });
    
    // Check if verification was successful (not an error)
    if ('subject' in result && result.subject) {
      // Successfully validated - convert OpenAuth payload to our AuthPayload format
      const openAuthPayload = result.subject.properties;
      // The token's own times (signature already verified above)
      const claims = decodeVerifiedClaims(token);
      const userId = openAuthPayload.id || '';

      // A legacy 30-day token carries the roles from its issue: 401, the client refreshes (#663)
      if (isLegacyLongLivedToken(claims)) {
        logger.debug('Rejected a legacy long-lived token', { userId });
        return null;
      }

      // Signed out everywhere / account deleted / suspended since this sign-in (#437)
      if (await isTokenRevoked(env.TOKEN_REVOCATIONS, { userId, authTime: claims.auth_time, iat: claims.iat })) {
        logger.debug('Rejected a revoked token', { userId });
        return null;
      }

      const payload: AuthPayload = {
        sub: userId,
        email: openAuthPayload.email || '',
        exp: claims.exp ?? 0,
        iat: claims.iat ?? 0,
        aud: authConfig.JWT.AUDIENCE,  // ✅ Now using dynamic config
        iss: authConfig.JWT.ISSUER,    // ✅ Now using dynamic config
        roles: Array.isArray(openAuthPayload.roles) ? openAuthPayload.roles.map(String) : [],
      };

      // Additional validation with environment config
      logger.debug(`JWT validated for issuer: ${authConfig.JWT.ISSUER}, audience: ${authConfig.JWT.AUDIENCE}`);
      
      return payload;
    }
    
    // An expired or invalid token is an ordinary 401 (the client refreshes): debug only
    if ('error' in result) {
      logger.debug('OpenAuth verification rejected the token', { error: result.error });
    }
    
    return null;
  } catch (error) {
    logger.error('JWT signature validation error:', error);
    return null;
  }
}

/**
 * Optional middleware for endpoints that can work with or without auth
 * This sets auth context if token is present but doesn't fail if missing
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = await validateJWTWithSignature(token, c.env);

      if (payload) {
        c.set('auth', {
          userId: payload.sub,
          email: payload.email,
          payload
        } as AuthContext);

        // Set userId in context for backward compatibility
        c.set('userId', payload.sub);
      }
    }

    return await next();
  } catch (error) {
    // Log error but don't fail the request for optional auth
    logger.error('Optional auth middleware error:', error);
    return await next();
  }
}

/**
 * Helper function to get auth context from request
 */
export function getAuthContext(c: Context): AuthContext | null {
  return c.get('auth') || null;
}

/**
 * Helper function to get user ID from auth context
 */
export function getUserId(c: Context): string | null {
  const auth = getAuthContext(c);
  return auth?.userId || null;
}

export const CHANNEL_SUSPENDED_CODE = 'channel_suspended';

/**
 * Requests that publish something new for a channel: uploads (incl. tus),
 * video create/schedule/publish, live streams, playlists and community posts.
 * A suspended channel may not make them; everything else its owner does
 * (watching, liking, editing or deleting their own content) still works.
 */
const PUBLISHING_ROUTES: RegExp[] = [
  /^\/api\/videos\/?$/,
  /^\/api\/videos\/upload(\/|$)/,
  /^\/api\/videos\/tus(\/|$)/,
  /^\/api\/videos\/[^/]+\/(publish-now|schedule)\/?$/,
  /^\/api\/live-streams(\/[^/]+)?\/?$/,
  /^\/api\/playlists\/?$/,
  /^\/api\/community\/channels\/[^/]+\/posts\/?$/,
  /^\/api\/community\/media\//,
];

export function channelRefusesWrite(method: string, path: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(method.toUpperCase())) return false;
  return PUBLISHING_ROUTES.some((route) => route.test(path));
}

/**
 * Middleware to validate channelId header
 * Must be used AFTER authMiddleware
 * Validates that the channelId in the header:
 * 1. Exists as a channel in R2
 * 2. Belongs to the authenticated user, or the user holds a channel role
 *    that allows this request (lib/channelAccess.ts memberMayActAs)
 *
 * If channelId header is not provided, middleware passes through
 * If channelId is invalid or doesn't belong to user, returns 403
 */
export async function channelIdMiddleware(c: Context, next: Next) {
  try {
    // Get channelId from header
    const channelId = c.req.header('channelId');

    // If no channelId header, pass through (some endpoints may not need it)
    if (!channelId) {
      return await next();
    }

    // Get auth context - must have been set by authMiddleware
    const auth = getAuthContext(c);
    if (!auth) {
      return c.json({
        success: false,
        error: 'Authentication required'
      }, 401);
    }

    // Likes and dislikes belong to the member: one without a channel reacts
    // as themselves, with their own user id as channelId (#292). Every other
    // route still needs a real channel owned by the caller.
    if (channelId === auth.userId && isUserScopedRoute(c.req.path)) {
      return await next();
    }

    // Fetch channel from R2
    const channelsBucket = c.env.channels;
    if (!channelsBucket) {
      logger.error('Channels bucket not available');
      return c.json({
        success: false,
        error: 'Internal server error'
      }, 500);
    }

    const channelObject = await channelsBucket.get(channelId);
    if (!channelObject) {
      logger.debug(`Channel not found: ${channelId}`);
      return c.json({
        success: false,
        error: 'Channel not found'
      }, 404);
    }

    // Parse channel data
    const channelData = await channelObject.json() as { userId: string; members?: unknown; isSuspended?: boolean; isDeleted?: boolean };

    // The owner, or a member whose channel role allows this request (reads,
    // and the writes listed in lib/channelAccess.ts). Channel roles come from
    // the channel record, never from token (site) roles.
    const role = channelRoleOf(channelData, auth.userId);
    if (!memberMayActAs(role, c.req.method, c.req.path)) {
      logger.warn(`User ${auth.userId} attempted to use channel ${channelId} owned by ${channelData.userId}`, { role, method: c.req.method, path: c.req.path });
      return c.json({
        success: false,
        error: 'You do not have permission to perform actions on behalf of this channel'
      }, 403);
    }

    // A channel an admin suspended (or deleted) publishes nothing new
    if ((channelData.isSuspended || channelData.isDeleted) && channelRefusesWrite(c.req.method, c.req.path)) {
      logger.warn(`User ${auth.userId} attempted a write as suspended channel ${channelId}`);
      return c.json({
        success: false,
        code: CHANNEL_SUSPENDED_CODE,
        error: 'This channel is suspended on Al Ummah Now videos'
      }, 403);
    }

    // Set channelId in context for use by endpoints, with the caller's role
    // and the channel's owner (new videos belong to the owner, lib/channelAccess.ts)
    c.set('channelId', channelId);
    c.set('channelRole', role);
    // Uploads to the channel run under its owner's creator tier (middleware/upload-limits.ts)
    c.set('channelOwnerId', channelData.userId);

    return await next();
  } catch (error) {
    logger.error('Channel ID middleware error:', error);
    return c.json({
      success: false,
      error: 'Failed to validate channel'
    }, 500);
  }
}