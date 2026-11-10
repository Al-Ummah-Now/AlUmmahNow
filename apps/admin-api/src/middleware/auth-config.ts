import { subjects } from './auth-subjects';
import { logger } from '../lib/logger';

// Static authentication configuration for Admin API
export const AUTH_CONFIG = {
  // OpenAuth subjects for JWT validation
  SUBJECTS: subjects,

  // JWT settings
  JWT: {
    ALGORITHM: 'RS256' as const,
  },

  // All routes in admin-api require authentication
  PUBLIC_ROUTES: [
    'GET /',
    'GET /openapi.json',
    'OPTIONS *'
  ]
} as const;

/**
 * Determines if JWT signature verification should be enabled based on environment
 * SECURITY: Always enabled in production/staging, only disabled in development/local
 */
export function shouldVerifyJWTSignature(env: any): boolean {
  const environment = env?.ENVIRONMENT?.toLowerCase() || 'production';

  // SECURITY: Only allow disabled verification in development/local environments
  const allowedDevEnvironments = ['development', 'dev', 'local'];
  const isDevEnvironment = allowedDevEnvironments.includes(environment);

  // Always verify in production and staging
  const shouldVerify = !isDevEnvironment;

  if (!shouldVerify) {
    logger.warn('JWT signature verification DISABLED', {
      environment,
      reason: 'Running in development/local mode',
      security_risk: 'This should NEVER happen in production'
    });
  } else {
    logger.debug('JWT signature verification ENABLED', {
      environment,
      security: 'Production-grade token validation active'
    });
  }

  return shouldVerify;
}

// Dynamic configuration that depends on environment variables
export function getAuthConfig(env: any) {
  return {
    ...AUTH_CONFIG,
    VERIFY_JWT_SIGNATURE: shouldVerifyJWTSignature(env),
    JWT: {
      ...AUTH_CONFIG.JWT,
      ISSUER: env.Issuer,
      AUDIENCE: env.Audience,
      CLIENT_ID: env.ClientId,
    },
  };
}
