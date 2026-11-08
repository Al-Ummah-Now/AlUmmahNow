import { Context, Next } from 'hono';
import { AUTH_CONFIG, getAuthConfig } from './auth-config';
import { getClient } from '../lib/openauth-client';
import { logger } from '../lib/logger';
import { normalizeRoles, hasAdminRole, hasModeratorRole } from '../lib/roles';

interface AuthPayload {
  sub: string;
  email?: string;
  roles?: string[];
  iat: number;
  exp: number;
  aud?: string;
  iss?: string;
}

/**
 * Mask email address to prevent PII exposure in logs
 * Example: john.doe@example.com -> j***e@example.com
 */
function maskEmail(email?: string): string | undefined {
  if (!email) return undefined;

  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;

  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
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

    // Get dynamic auth config based on environment
    const authConfig = getAuthConfig(c.env);

    const payload = authConfig.VERIFY_JWT_SIGNATURE
      ? await validateJWTWithSignature(token, c.env)
      : await validateJWTBasic(token);

    if (!payload) {
      return c.json({
        success: false,
        error: 'Invalid or expired authentication token'
      }, 401);
    }

    // Log non-sensitive token data only
    logger.info('Auth token payload received', {
      userId: payload.sub,
      email: maskEmail(payload.email),
      roles: payload.roles,
      iat: payload.iat,
      exp: payload.exp,
      iss: payload.iss,
      aud: payload.aud
    });

    c.set('auth', {
      userId: payload.sub,
      email: payload.email,
      // Tokens carry RBAC display names ("Super Admin"); store snake_case ids.
      roles: normalizeRoles(payload.roles),
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
 * Reads roles from the auth token payload
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

    // Get roles from auth context (populated from token)
    const roles = auth.roles || [];
    const isAdmin = hasAdminRole(roles);
    const isModerator = hasModeratorRole(roles);

    logger.info('Admin middleware checking roles', {
      userId: auth.userId,
      email: maskEmail(auth.email),
      roles: roles,
      rolesLength: roles.length,
      isAdmin,
      isModerator
    });

    if (!isAdmin && !isModerator) {
      logger.warn(`User ${auth.userId} attempted admin access without proper role`, {
        roles,
        email: maskEmail(auth.email),
        payloadRoles: auth.payload?.roles
      });
      return c.json({
        success: false,
        error: 'Admin or moderator role required'
      }, 403);
    }

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

    // Log non-sensitive JWT data only
    logger.info('JWT basic validation', {
      userId: payload.sub,
      email: maskEmail(payload.email),
      roles: payload.roles,
      iat: payload.iat,
      exp: payload.exp
    });

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      logger.warn('JWT token expired', { exp: payload.exp, now });
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

    // Log non-sensitive OpenAuth verification result
    logger.info('OpenAuth verify result', {
      hasSubject: 'subject' in result,
      subjectType: 'subject' in result ? result.subject?.type : undefined,
      hasError: 'err' in result
    });

    if ('subject' in result && result.subject) {
      const openAuthPayload = result.subject.properties as { id?: string; email?: string; roles?: string[] };
      const now = Math.floor(Date.now() / 1000);

      const payload: AuthPayload = {
        sub: openAuthPayload.id || '',
        email: openAuthPayload.email || '',
        roles: openAuthPayload.roles || [],
        exp: now + 3600,
        iat: now,
        aud: authConfig.JWT.AUDIENCE,
        iss: authConfig.JWT.ISSUER,
      };

      logger.debug('Extracted auth payload from token', {
        userId: payload.sub,
        email: maskEmail(payload.email),
        roles: payload.roles
      });

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
  return hasAdminRole(getUserRoles(c));
}

export function isModerator(c: Context): boolean {
  return hasModeratorRole(getUserRoles(c));
}
