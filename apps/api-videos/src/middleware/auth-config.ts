import { subjects } from './auth-subjects';

// Static authentication configuration
export const AUTH_CONFIG = {
  // OpenAuth subjects for JWT validation
  SUBJECTS: subjects,
  
  // JWT settings
  JWT: {
    // Algorithm used (typically RS256 for OpenAuth)
    ALGORITHM: 'RS256' as const,
  },
  
  // Routes that don't require authentication
  PUBLIC_ROUTES: [
    // GET endpoints are public by default with optional auth
    'GET /api/videos',
    'GET /api/videos/:id',
    'GET /api/profiles',
    'GET /api/profiles/:id', 
    'GET /api/playlists',
    'GET /api/playlists/:id',
    'GET /api/channels',
    'GET /api/channels/:id',
    
    // OpenAPI documentation
    'GET /',
    'GET /openapi.json',
    
    // OPTIONS requests for CORS
    'OPTIONS *'
  ]
} as const;

// Dynamic configuration that depends on environment variables
export function getAuthConfig(env: any) {
  return {
    ...AUTH_CONFIG,
    // JWT settings with environment variables
    JWT: {
      ...AUTH_CONFIG.JWT,
      // Expected issuer (configure based on your OpenAuth setup)
      ISSUER: env.Issuer,
      
      // Expected audience (configure based on your setup)
      AUDIENCE: env.Audience,
      
      // Client ID for OpenAuth
      CLIENT_ID: env.ClientId,
    },
  };
}

// Helper to check if a route is public
export function isPublicRoute(method: string, path: string): boolean {
  return AUTH_CONFIG.PUBLIC_ROUTES.some(route => {
    const [routeMethod, routePath] = route.split(' ');
    return routeMethod === method && (
      routePath === path || 
      routePath === '*' ||
      (routePath.includes(':') && pathMatches(routePath, path))
    );
  });
}

// Simple path matching for routes with parameters
function pathMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    
    if (patternPart.startsWith(':')) {
      // Parameter - matches anything
      continue;
    }
    
    if (patternPart !== pathPart) {
      return false;
    }
  }
  
  return true;
}