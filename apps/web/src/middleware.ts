/**
 * Next.js Middleware for Content Security Policy
 * 
 * Implements strict CSP headers to prevent XSS attacks and enhance security.
 * Specifically configured for video player requirements including Video.js CDN,
 * Bunny CDN for media, and WebSocket connections.
 * 
 * Features:
 * - Strict CSP policy with minimal permissions
 * - Video.js CDN whitelisting with integrity checks
 * - Bunny CDN media source allowance
 * - WebSocket secure connection support
 * - Development vs production configuration
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CSP configuration for different environments
 */
const CSP_POLICIES = {
  development: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vjs.zencdn.net https://assets.mediadelivery.net",
    "style-src 'self' 'unsafe-inline' https://vjs.zencdn.net https://cdnjs.cloudflare.com",
    "media-src 'self' https://cdn.bunny.net https://bunny-cdn.b-cdn.net https://*.b-cdn.net blob:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://localhost:* https://ws.alummahnow.net wss://ws.alummahnow.net wss://localhost:* https://*.b-cdn.net",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; '),

  production: [
    "default-src 'self'",
    "script-src 'self' https://vjs.zencdn.net https://assets.mediadelivery.net https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://vjs.zencdn.net https://cdnjs.cloudflare.com",
    "media-src 'self' https://cdn.bunny.net https://bunny-cdn.b-cdn.net https://*.b-cdn.net blob:",
    "connect-src 'self' https://ws.alummahnow.net wss://ws.alummahnow.net https://*.b-cdn.net https://api.alummahnow.net",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; ')
};

/**
 * Additional security headers for enhanced protection
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
};

/**
 * Middleware function to add security headers
 */
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  
  // Determine environment
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Add Content Security Policy
  const csp = isDevelopment ? CSP_POLICIES.development : CSP_POLICIES.production;
  response.headers.set('Content-Security-Policy', csp);
  
  // Add additional security headers
  Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
    response.headers.set(header, value);
  });
  
  // Add security-related debug headers in development
  if (isDevelopment) {
    response.headers.set('X-CSP-Debug', 'development-mode');
    response.headers.set('X-Security-Headers', 'enabled');
  }
  
  return response;
}

/**
 * Configure middleware to run on specific paths
 * Excludes API routes, static files, and Next.js internals
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};