import { subjects } from './auth-subjects';

// Static authentication configuration for Admin API
export const AUTH_CONFIG = {
  // Set to true to enable JWT signature verification
  VERIFY_JWT_SIGNATURE: true,

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

// Dynamic configuration that depends on environment variables
export function getAuthConfig(env: any) {
  return {
    ...AUTH_CONFIG,
    JWT: {
      ...AUTH_CONFIG.JWT,
      ISSUER: env.Issuer,
      AUDIENCE: env.Audience,
      CLIENT_ID: env.ClientId,
    },
  };
}
