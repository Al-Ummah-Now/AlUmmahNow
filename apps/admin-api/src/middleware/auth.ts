import { Context, Next } from 'hono';
import { AUTH_CONFIG, getAuthConfig } from './auth-config';
import { getClient } from '../lib/openauth-client';
import { logger } from '../lib/logger';
import R2Repository from '../lib/r2Repo';

interface AuthPayload {
  sub: string;
  email?: string;
  iat: number;
  exp: number;
  aud?: string;
  iss?: string;
}

export interface AuthContext {
  userId: string;
  email?: string;
  payload: AuthPayload;
  roles?: string[];
}

/**
 * Authentication middleware for validating JWT tokens
 */
export async function authMiddleware(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Missing or invalid Authorization header. Expected: Bearer <token>'
      }, 401);
    }

    const token = authHeader.substring(7);

    if (!token) {
      return c.json({
        success: false,
        error: 'Missing authentication token'
      }, 401);
    }

    const payload = AUTH_CONFIG.VERIFY_JWT_SIGNATURE
      ? await validateJWTWithSignature(token, c.env)
      : await validateJWTBasic(token);

    if (!payload) {
      return c.json({
        success: false,
        error: 'Invalid or expired authentication token'
      }, 401);
    }

    c.set('auth', {
      userId: payload.sub,
      email: payload.email,
      payload
    } as AuthContext);

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
 * Admin/Moderator role check middleware
 * Must be used AFTER authMiddleware
 */
export async function adminMiddleware(c: Context, next: Next) {
  try {
    const auth = c.get('auth') as AuthContext | undefined;

    if (!auth) {
      return c.json({
        success: false,
        error: 'Authentication required'
      }, 401);
    }

    // Check user roles from profile in R2
    const profilesBucket = c.env.profiles;
    if (!profilesBucket) {
      logger.error('Profiles bucket not available');
      return c.json({
        success: false,
        error: 'Internal server error'
      }, 500);
    }

    const repository = new R2Repository<any>(profilesBucket);
    const userProfile = await repository.getObject(`profile:${auth.userId}`);

    const roles = userProfile?.roles || [];
    const isAdmin = roles.includes('admin');
    const isModerator = roles.includes('moderator');

    if (!isAdmin && !isModerator) {
      logger.warn(`User ${auth.userId} attempted admin access without proper role`, { roles });
      return c.json({
        success: false,
        error: 'Admin or moderator role required'
      }, 403);
    }

    // Add roles to auth context
    c.set('auth', {
      ...auth,
      roles
    });

    logger.debug(`Admin access granted for user ${auth.userId}`, { roles, isAdmin, isModerator });

    return await next();
  } catch (error) {
    logger.error('Admin middleware error:', error);
    return c.json({
      success: false,
      error: 'Failed to verify admin permissions'
    }, 500);
  }
}

async function validateJWTBasic(token: string): Promise<AuthPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(atob(parts[1])) as AuthPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch (error) {
    logger.error('JWT validation error:', error);
    return null;
  }
}

async function validateJWTWithSignature(token: string, env?: any): Promise<AuthPayload | null> {
  try {
    if (!env) {
      logger.error('Environment not provided for JWT signature validation');
      return null;
    }

    const authConfig = getAuthConfig(env);
    const client = await getClient(env);
    const result = await client.verify(AUTH_CONFIG.SUBJECTS, token, { refresh: undefined });

    if ('subject' in result && result.subject) {
      const openAuthPayload = result.subject.properties;
      const now = Math.floor(Date.now() / 1000);

      const payload: AuthPayload = {
        sub: openAuthPayload.id || '',
        email: openAuthPayload.email || '',
        exp: now + 3600,
        iat: now,
        aud: authConfig.JWT.AUDIENCE,
        iss: authConfig.JWT.ISSUER,
      };

      return payload;
    }

    if ('error' in result) {
      logger.error('OpenAuth verification error:', result.error);
    }

    return null;
  } catch (error) {
    logger.error('JWT signature validation error:', error);
    return null;
  }
}

export function getAuthContext(c: Context): AuthContext | null {
  return c.get('auth') || null;
}

export function getUserId(c: Context): string | null {
  const auth = getAuthContext(c);
  return auth?.userId || null;
}

export function getUserRoles(c: Context): string[] {
  const auth = getAuthContext(c);
  return auth?.roles || [];
}

export function isAdmin(c: Context): boolean {
  return getUserRoles(c).includes('admin');
}

export function isModerator(c: Context): boolean {
  const roles = getUserRoles(c);
  return roles.includes('admin') || roles.includes('moderator');
}
