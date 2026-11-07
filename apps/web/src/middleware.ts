/**
 * Next.js Middleware for Content Security Policy and Locale Routing
 *
 * Features:
 * - Nonce-based Content Security Policy (CSP) headers (see lib/security/csp.ts)
 * - Locale validation based on LOCALES config (supports any locale with isSupported: true)
 * - Automatic redirect of unsupported locales to default locale
 * - RTL/LTR direction headers
 * - Video.js CDN whitelisting
 * - Bunny CDN media source allowance
 * - WebSocket secure connection support
 * - Development vs production configuration
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getValidLocale,
  getTextDirection,
  getSupportedLocaleCodes,
  LANGUAGE_PREFERENCE_COOKIE,
  isLocaleSupported
} from '@/lib/i18n/utils';
import { DEFAULT_LOCALE, LOCALE_REQUEST_HEADER } from '@/lib/i18n/locales';
import {
  buildContentSecurityPolicy,
  generateNonce,
  SECURITY_HEADERS,
} from '@/lib/security/csp';
import { NONCE_HEADER } from '@/lib/security/nonce-header';

/**
 * Build the CSP for this request. In production a fresh nonce is generated per
 * request; Next.js reads it from the request's Content-Security-Policy header
 * and applies it to every script it renders.
 */
function createCsp(isDevelopment: boolean): { csp: string; nonce?: string } {
  const nonce = isDevelopment ? undefined : generateNonce();
  const csp = buildContentSecurityPolicy({
    isDevelopment,
    nonce,
    env: {
      apiUrl: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL,
      websocketUrl: process.env.WEBSOCKET_URL || process.env.NEXT_PUBLIC_WEBSOCKET_URL,
      bunnyPullZone: process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL,
      authUrl: process.env.OPENAUTH_ISSUER || process.env.Issuer,
    },
  });
  return { csp, nonce };
}

/**
 * Continue the request with the CSP (and nonce) visible to server rendering,
 * and attach CSP + security headers to the response.
 */
function nextWithSecurityHeaders(request: NextRequest, isDevelopment: boolean, locale?: string): NextResponse {
  const { csp, nonce } = createCsp(isDevelopment);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  if (nonce) requestHeaders.set(NONCE_HEADER, nonce);
  // Forward the locale so the root layout can render <html lang dir> for it
  if (locale) requestHeaders.set(LOCALE_REQUEST_HEADER, locale);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
    response.headers.set(header, value);
  });
  if (isDevelopment) {
    response.headers.set('X-CSP-Debug', 'development-mode');
    response.headers.set('X-Security-Headers', 'enabled');
  }
  return response;
}

/**
 * Get language preference from cookie
 */
function getLanguagePreferenceFromCookie(request: NextRequest): string | null {
  const cookieValue = request.cookies.get(LANGUAGE_PREFERENCE_COOKIE)?.value;
  if (cookieValue && isLocaleSupported(cookieValue)) {
    return cookieValue;
  }
  return null;
}

/**
 * Middleware function to handle locale validation and security headers
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Determine environment
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Handle root path - redirect to preferred locale or default
  if (pathname === '/') {
    const preferredLocale = getLanguagePreferenceFromCookie(request) || DEFAULT_LOCALE;
    return NextResponse.redirect(new URL(`/${preferredLocale}`, request.url));
  }

  // Handle locale routes
  // Check if the first path segment is a locale code
  const localeMatch = pathname.match(/^\/([^\/]+)/);

  if (localeMatch) {
    const potentialLocale = localeMatch[1];
    const supportedLocaleCodes = getSupportedLocaleCodes();

    // Skip Next.js internals (_next), API routes (api), and static files
    const isNextInternal = potentialLocale.startsWith('_next');
    const isApiRoute = potentialLocale === 'api';
    const isPublicFile = potentialLocale === 'public' || pathname.includes('.');

    if (!isNextInternal && !isApiRoute && !isPublicFile) {
      // Check if this looks like a locale code (2 letters)
      if (potentialLocale.length === 2) {
        // Check if the locale is supported
        if (supportedLocaleCodes.includes(potentialLocale)) {
          // Valid supported locale - continue processing with CSP + security headers
          const direction = getTextDirection(potentialLocale);
          const response = nextWithSecurityHeaders(request, isDevelopment, potentialLocale);

          // Add locale and direction headers for the response
          response.headers.set('X-Locale', potentialLocale);
          response.headers.set('X-Text-Direction', direction);

          return response;
        } else {
          // Looks like a locale code but not supported - redirect to default locale
          const defaultLocale = getValidLocale(potentialLocale);
          const redirectPath = pathname.replace(`/${potentialLocale}`, `/${defaultLocale}`);

          return NextResponse.redirect(new URL(redirectPath, request.url));
        }
      } else {
        // No locale prefix (e.g. /video?vid=..., /does-not-exist). Every page
        // lives under /[locale], so send it there: real pages keep working and
        // unknown ones get the localized 404 with a real 404 status instead of
        // the [locale] layout's notFound() answering 200 (soft 404).
        const preferredLocale = getLanguagePreferenceFromCookie(request) || DEFAULT_LOCALE;
        const target = new URL(`/${preferredLocale}${pathname}`, request.url);
        target.search = request.nextUrl.search;
        return NextResponse.redirect(target);
      }
    }
  }

  // Default response for all other routes
  return nextWithSecurityHeaders(request, isDevelopment);
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
