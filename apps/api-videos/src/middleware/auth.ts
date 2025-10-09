import { Context, Next } from 'hono';
import { env } from 'cloudflare:workers';
import { AUTH_CONFIG, getAuthConfig } from './auth-config';
import { getClient } from '../lib/openauth-client';

// Type for the decoded JWT payload from OpenAuth
interface AuthPayload {
  sub: string; // Subject (user ID)
  email?: string;
  iat: number; // Issued at
  exp: number; // Expiration
  aud?: string; // Audience
  iss?: string; // Issuer
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

    // Validate the JWT token using the configured method
    const payload = AUTH_CONFIG.VERIFY_JWT_SIGNATURE 
      ? await validateJWTWithSignature(token, c.env) 
      : await validateJWTBasic(token);
    
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
    console.error('Auth middleware error:', error);
    return c.json({
      success: false,
      error: 'Authentication failed'
    }, 401);
  }
}

/**
 * Basic JWT validation (payload only, no signature verification)
 * Used when VERIFY_JWT_SIGNATURE is false
 */
async function validateJWTBasic(token: string): Promise<AuthPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (we'll do basic validation for now)
    const payload = JSON.parse(atob(parts[1])) as AuthPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    // TODO: Verify signature with public key from your auth service
    // For now, we'll do basic validation
    // In production, you should verify the signature using your auth service's public key
    
    return payload;
  } catch (error) {
    console.error('JWT validation error:', error);
    return null;
  }
}

/**
 * Enhanced JWT validation that verifies signature with OpenAuth subjects
 * This should be used in production
 */
async function validateJWTWithSignature(token: string, env?: any): Promise<AuthPayload | null> {
  try {
    if (!env) {
      console.error('Environment not provided for JWT signature validation');
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
      };

      // Additional validation with environment config
      console.log(`JWT validated for issuer: ${authConfig.JWT.ISSUER}, audience: ${authConfig.JWT.AUDIENCE}`);
      
      return payload;
    }
    
    // If result is an error, log it
    if ('error' in result) {
      console.error('OpenAuth verification error:', result.error);
    }
    
    return null;
  } catch (error) {
    console.error('JWT signature validation error:', error);
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
      const payload = AUTH_CONFIG.VERIFY_JWT_SIGNATURE 
        ? await validateJWTWithSignature(token, c.env) 
        : await validateJWTBasic(token);
      
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

    await next();
  } catch (error) {
    // Log error but don't fail the request for optional auth
    console.error('Optional auth middleware error:', error);
    await next();
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