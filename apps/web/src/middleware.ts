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
 * - Access-token refresh ahead of expiry (see lib/auth/middleware-refresh.ts)
 */

import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { recordServerVisit } from '@/lib/analytics/site-visit';
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
  EMBED_SECURITY_HEADERS,
  generateNonce,
  SECURITY_HEADERS,
} from '@/lib/security/csp';
import { EMBED_REQUEST_HEADER, isEmbedPath, isOEmbedPath, isShareImagePath } from '@/lib/embed/routes';
import { parseEmbedLang } from '@/lib/embed/params';
import { NONCE_HEADER } from '@/lib/security/nonce-header';
import { handleRewritePath } from '@/lib/channel-url';
import { refreshSessionCookie } from '@/lib/auth/middleware-refresh';
import { presentSessionCookieNames, sessionCookieOptions, writeSessionValue } from '@/lib/auth/session-cookie';

/**
 * Build the CSP for this request. In production a fresh nonce is generated per
 * request; Next.js reads it from the request's Content-Security-Policy header
 * and applies it to every script it renders.
 */
function createCsp(isDevelopment: boolean, embed = false, insecureOrigin = false): { csp: string; nonce?: string } {
  const nonce = isDevelopment ? undefined : generateNonce();
  const csp = buildContentSecurityPolicy({
    isDevelopment,
    insecureOrigin,
    nonce,
    frameAncestors: embed ? '*' : "'none'",
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
function nextWithSecurityHeaders(request: NextRequest, isDevelopment: boolean, locale?: string, rewriteTo?: URL, embed = false): NextResponse {
  const { csp, nonce } = createCsp(isDevelopment, embed, request.nextUrl.protocol === 'http:');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  if (nonce) requestHeaders.set(NONCE_HEADER, nonce);
  // Only the middleware decides what is an embed frame (the root layout renders
  // the minimal shell for it); never trust the header from the client.
  if (embed) requestHeaders.set(EMBED_REQUEST_HEADER, '1');
  else requestHeaders.delete(EMBED_REQUEST_HEADER);
  // Forward the locale so the root layout can render <html lang dir> for it
  if (locale) requestHeaders.set(LOCALE_REQUEST_HEADER, locale);

  const response = rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  Object.entries(embed ? EMBED_SECURITY_HEADERS : SECURITY_HEADERS).forEach(([header, value]) => {
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
 * Refreshes the session's access token when it is about to expire, then routes
 * the request. The rotated cookie goes on the forwarded request (inside
 * refreshSessionCookie, before routeRequest copies the request headers) so this
 * render uses the new token, and on the response so the browser keeps it.
 */
export async function middleware(request: NextRequest, event?: NextFetchEvent) {
  // Where a visit starts and where it came from, counted here (cookieless, D-SEO-9; lib/analytics/site-visit.ts)
  if (event) recordServerVisit(request, (p) => event.waitUntil(p));
  // The browser's session cookies, before the refresh rewrites the request's
  const browserSessionCookies = presentSessionCookieNames(request.cookies);
  const refreshedSession = await refreshSessionCookie(request);
  const response = routeRequest(request);
  if (refreshedSession) {
    writeSessionValue(response.cookies, refreshedSession, browserSessionCookies, sessionCookieOptions(request.headers.get('host')));
  }
  return response;
}

/**
 * Locale validation and security headers
 */
function routeRequest(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Determine environment
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Handle root path - redirect to preferred locale or default
  if (pathname === '/') {
    const preferredLocale = getLanguagePreferenceFromCookie(request) || DEFAULT_LOCALE;
    return NextResponse.redirect(new URL(`/${preferredLocale}`, request.url));
  }

  // oEmbed endpoint (route handler with its own CORS/caching headers): no locale redirect
  if (isOEmbedPath(pathname)) {
    return NextResponse.next();
  }

  // Stable share images (route handler with its own caching headers): no locale redirect
  if (isShareImagePath(pathname)) {
    return NextResponse.next();
  }

  // Embed frames (docs/embeds): frameable by any origin, minimal shell, ?lang= locale
  if (isEmbedPath(pathname)) {
    const locale = parseEmbedLang(request.nextUrl.searchParams.get('lang'));
    const response = nextWithSecurityHeaders(request, isDevelopment, locale, undefined, true);
    response.headers.set('X-Locale', locale);
    response.headers.set('X-Text-Direction', getTextDirection(locale));
    return response;
  }

  // Channel @handle URLs (Story 29.1): handles may contain `.`, so this runs
  // before the static-file heuristic below
  const handleRoute = handleRewritePath(pathname);
  if (handleRoute && getSupportedLocaleCodes().includes(handleRoute.locale)) {
    const target = request.nextUrl.clone();
    target.pathname = handleRoute.path;
    const response = nextWithSecurityHeaders(request, isDevelopment, handleRoute.locale, target);
    response.headers.set('X-Locale', handleRoute.locale);
    response.headers.set('X-Text-Direction', getTextDirection(handleRoute.locale));
    return response;
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
    // (/{locale}/c/{handle} paths may contain dots but are pages)
    const isPublicFile = potentialLocale === 'public' || (pathname.includes('.') && !/^\/[a-z]{2}\/c\//.test(pathname));

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
