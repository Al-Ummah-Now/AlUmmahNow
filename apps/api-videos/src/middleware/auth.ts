import { Context, Next } from 'hono';
import { AUTH_CONFIG, getAuthConfig } from './auth-config';
import { getClient } from '../lib/openauth-client';
import { logger } from '../lib/logger';

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
      const now = Math.floor(Date.now() / 1000);
      
      // Use dynamic auth config for validation
      const payload: AuthPayload = {
        sub: openAuthPayload.id || '',
        email: openAuthPayload.email || '',
        exp: now + 3600, // Default 1 hour from now
        iat: now,
        aud: authConfig.JWT.AUDIENCE,  // ✅ Now using dynamic config
        iss: authConfig.JWT.ISSUER,    // ✅ Now using dynamic config
        roles: Array.isArray(openAuthPayload.roles) ? openAuthPayload.roles.map(String) : [],
      };

      // Additional validation with environment config
      logger.debug(`JWT validated for issuer: ${authConfig.JWT.ISSUER}, audience: ${authConfig.JWT.AUDIENCE}`);
      
      return payload;
    }
    
    // If result is an error, log it
    if ('error' in result) {
      logger.error('OpenAuth verification error:', result.error);
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

/**
 * Middleware to validate channelId header
 * Must be used AFTER authMiddleware
 * Validates that the channelId in the header:
 * 1. Exists as a channel in R2
 * 2. Belongs to the authenticated user
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
      logger.warn(`Channel not found: ${channelId}`);
      return c.json({
        success: false,
        error: 'Channel not found'
      }, 404);
    }

    // Parse channel data
    const channelData = await channelObject.json() as { userId: string };

    // Verify ownership
    if (channelData.userId !== auth.userId) {
      logger.warn(`User ${auth.userId} attempted to use channel ${channelId} owned by ${channelData.userId}`);
      return c.json({
        success: false,
        error: 'You do not have permission to perform actions on behalf of this channel'
      }, 403);
    }

    // Set channelId in context for use by endpoints
    c.set('channelId', channelId);

    return await next();
  } catch (error) {
    logger.error('Channel ID middleware error:', error);
    return c.json({
      success: false,
      error: 'Failed to validate channel'
    }, 500);
  }
}