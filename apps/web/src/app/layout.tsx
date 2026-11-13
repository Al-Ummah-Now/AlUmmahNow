import React from "react";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ThemeProvider } from "@/components/themeProvider";
import { authenticated } from "../lib/actions"
import type { Metadata, Viewport } from 'next'
import { headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_REQUEST_HEADER } from "@/lib/i18n/locales";
import { getTextDirection, isLocaleSupported } from "@/lib/i18n/utils";
import "./globals.css";
import "@/theme/font-faces.css";
import "@/theme/fonts.css";
import "@/theme/materials.css";
import "@/theme/bridge.css";
import "@/theme/demo-motion.css";
import "@/theme/system.css";
import "@/theme/pages.css";
import "@/theme/fawanees.css";
import backdrops from "@/theme/demo-backdrops.json";
import Navigation from "@/components/navigation";
import AuthProvider from "@/components/AuthProvider";
import { WebSocketProvider } from "@/lib/websocket/WebSocketProvider";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { TranslationSyncProvider } from "@/components/TranslationSyncProvider";
import { MultiAccountProvider } from "@/hooks/useMultiAccount";
import { CookieSizeMonitor } from "@/components/CookieSizeMonitor";
import { ActiveChannelWrapper } from "@/components/ActiveChannelWrapper";
import { QueryProvider } from "@/providers/QueryProvider";
import { NONCE_HEADER } from "@/lib/security/nonce-header";
import { serializeForInlineScript } from "@/lib/security/csp";
import { authOrigin, deriveAuthProfileUrl } from "@/lib/runtime-config";
import { deriveCmsUrl, deriveWwwUrl } from "@/lib/scholars/sites";
import { SecurityBootstrap } from "@/components/security/SecurityBootstrap";
import { RuntimeConfigBootstrap } from "@/components/RuntimeConfigBootstrap";
import { ConsentBanner } from "@/components/consent/ConsentBanner";
import SkipLinks from "@/components/SkipLinks";
import { FanousStreet } from "@/components/FanousStreet";
import { EMBED_REQUEST_HEADER } from "@/lib/embed/routes";
import { getSiteTheme } from "@/lib/theme/site-theme";
import { VersionSkewProvider } from "@/lib/version-skew/VersionSkewProvider";
import { ErrorReportingProvider } from "@/lib/errors/ErrorReportingProvider";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { appIcons } from "@/lib/favicon";

/** Worker version id and environment for client error reports (admin Errors page). */
async function errorReportingContext(): Promise<{ workerVersion?: string; environment?: string }> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const e = env as unknown as { CF_VERSION_METADATA?: { id?: string }; NEXTJS_ENV?: string };
    return { workerVersion: e.CF_VERSION_METADATA?.id, environment: e.NEXTJS_ENV || process.env.NEXTJS_ENV };
  } catch {
    return { environment: process.env.NEXTJS_ENV };
  }
}

/** Default title and description per language (pages override them): the site tagline's long line
 * (owner pick 2026-11-13, matches www). Tone: wiki Copy-Tone-Guide. */
const SITE_COPY = {
  en: {
    title: 'Al Ummah Now',
    description: 'Upload videos, go live and post to your channel, and see what the community is sharing, in Arabic and English.',
    keywords: 'Al Ummah Now, Islamic, videos, Shorts, live, channels, community',
    imageAlt: 'Al Ummah Now Videos',
  },
  ar: {
    title: 'الأمة الآن',
    description: 'ارفع المرئيات وابدأ البث المباشر وانشر في قناتك، وتابع ما يشاركه المجتمع، بالعربية والإنجليزية.',
    keywords: 'الأمة الآن، إسلامي، مرئيات، مقاطع قصيرة، بث مباشر، قنوات، مجتمع',
    imageAlt: 'مرئيات الأمة الآن',
  },
} as const;

function siteMetadata(locale: string): Metadata {
  const copy = locale === 'ar' ? SITE_COPY.ar : SITE_COPY.en;
  return {
    title: copy.title,
    description: copy.description,
    keywords: copy.keywords,
    authors: [{ name: copy.title }],
    robots: 'index, follow',
    openGraph: {
      title: copy.title,
      description: copy.description,
      // The share image is the app icon at full size; url and metadataBase are set per request.
      images: [{ url: '/icon-512.png', width: 512, height: 512, alt: copy.imageAlt }],
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: copy.title,
      description: copy.description,
      images: ['/icon-512.png'],
      site: '@alummahnow',
      creator: '@alummahnow',
    },
    manifest: '/site.webmanifest',
    other: {
      referrer: 'origin',
    },
  };
}

/** Per request: the tab icon marks QA and stage (same build as production, so read at runtime). */
export async function generateMetadata(): Promise<Metadata> {
  const { environment } = await errorReportingContext();
  const origin = await requestOrigin();
  const metadata = siteMetadata(await requestLocale());
  return {
    ...metadata,
    icons: appIcons(environment),
    // Without a base, Next resolves relative share images against localhost:3000.
    ...(origin ? { metadataBase: new URL(origin), openGraph: { ...metadata.openGraph, url: origin } } : {}),
  };
}

/** The language middleware resolved for this request (English when absent). */
async function requestLocale(): Promise<string> {
  try {
    const requested = (await headers()).get(LOCALE_REQUEST_HEADER);
    return requested && isLocaleSupported(requested) ? requested : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** This deployment's public origin, from the request (QA, stage and production share one build). */
async function requestOrigin(): Promise<string | undefined> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (!host) return undefined;
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return undefined;
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom must stay enabled (WCAG 1.4.4 Resize Text / axe meta-viewport)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111827' }, // gray-900
  ],
};

/** Runtime configuration injected from the server (read by client API helpers). */
function serverRuntimeConfig() {
  return {
    API_URL: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '',
    WEBSOCKET_URL: process.env.WEBSOCKET_URL || process.env.NEXT_PUBLIC_WEBSOCKET_URL || '',
    AUTH_PROFILE_URL: deriveAuthProfileUrl(
      process.env.OPENAUTH_ISSUER || process.env.Issuer,
      process.env.AUTH_PROFILE_URL
    ),
    AUTH_URL: authOrigin(process.env.OPENAUTH_ISSUER || process.env.Issuer),
    CMS_URL: deriveCmsUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.CMS_URL),
    WWW_URL: deriveWwwUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.WWW_URL),
  };
}

function RuntimeConfigScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `window.__RUNTIME_CONFIG__ = ${serializeForInlineScript(serverRuntimeConfig())};`,
      }}
    />
  );
}

/**
 * Minimal document for embed frames (docs/embeds): no navigation, auth,
 * websocket, notifications or consent banner, and no session lookup, so an
 * embed never acts as the viewer even when the browser sent a session cookie.
 */
/** A theme package made in the admin: its compiled CSS, scoped to its own data-theme. */
function ThemePackageStyle({ css, nonce }: { css: string | null; nonce?: string }) {
  return css ? <style id="theme-package" nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} /> : null;
}

function EmbedDocument({ locale, nonce, theme, themeCss, children }: { locale: string; nonce?: string; theme: string; themeCss: string | null; children: React.ReactNode }) {
  return (
    <html lang={locale} dir={getTextDirection(locale)} data-theme={theme} suppressHydrationWarning>
      <head>
        <ThemePackageStyle css={themeCss} nonce={nonce} />
        <RuntimeConfigScript nonce={nonce} />
      </head>
      <body className="font-inter">
        {/* Embed errors are reported too, never as the viewer (no user id) */}
        <ErrorReportingProvider />
        <VersionSkewProvider />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}

export default async function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  const requestHeaders = await headers();
  const requestedLocale = requestHeaders.get(LOCALE_REQUEST_HEADER);
  const locale = requestedLocale && isLocaleSupported(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  // Per-request CSP nonce set by middleware (production only).
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;

  const { id: theme, css: themeCss } = await getSiteTheme();

  if (requestHeaders.get(EMBED_REQUEST_HEADER) === '1') {
    return <EmbedDocument locale={locale} nonce={nonce} theme={theme} themeCss={themeCss}>{children}</EmbedDocument>;
  }

  const subject = await authenticated()
  const user = subject ? subject.properties : null;
  const reporting = await errorReportingContext();

  return (
    <html lang={locale} dir={getTextDirection(locale)} data-theme={theme} suppressHydrationWarning>
      <head>
        {/* Font Awesome - Consider self-hosting for better performance */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.1/css/all.min.css"
          integrity="sha512-MV7K8+y+gLIBoVD59lQIYicR65iaqukzvf/nwasF0nqhPay5w/9lJmVM2hMDcnK1OnMGCdVK+iQrJ7lzPJQd1w=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        <ThemePackageStyle css={themeCss} nonce={nonce} />
        <RuntimeConfigScript nonce={nonce} />
      </head>
      <body className="font-inter">
        <SecurityBootstrap />
        {/* Every client-side error reaches the admin Errors page (lib/errors/reporter.ts) */}
        <ErrorReportingProvider userId={user?.id} workerVersion={reporting.workerVersion} environment={reporting.environment} />
        {/* A deploy while this page is open: notice + reload, never mid-upload */}
        <VersionSkewProvider />
        <RuntimeConfigBootstrap config={serverRuntimeConfig()} />
        {/* No <Suspense> around the app: with one, the shell (and a 200 status)
            streamed before a page or layout could call notFound(), so unknown
            channels/handles/playlists were soft 404s rendered twice. Every route
            is dynamic (cookies/headers above), so nothing needs the boundary. */}
          <QueryProvider>
            <NuqsAdapter>
              <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              nonce={nonce}
              disableTransitionOnChange>
              <MultiAccountProvider>
                <AuthProvider>
                  <ActiveChannelWrapper>
                    <WebSocketProvider user={user}>
                      <TranslationSyncProvider>
                        <div className="theme-bg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: backdrops[theme as keyof typeof backdrops] ?? "" }} />
                        <div className="demo-layer flex flex-col min-h-screen bg-white dark:bg-gray-900">
                          {/* Skip links must be the first focusable elements (WCAG 2.4.1) */}
                          <SkipLinks />
                          {/* Header */}
                          <Navigation></Navigation>
                          {/* Skip-link target for pages without <main id="main-content"> (PAGE_CONTENT_ID in SkipLinks; a literal because this is a server component) */}
                          <div id="page-content" className="flex flex-1 flex-col">
                            {children}
                          </div>

                          {/* Real-time notification center */}
                          <NotificationCenter />

                          {/* Cookie / tracking consent (GDPR, Story 1.3) */}
                          <ConsentBanner />
                          <FanousStreet />
                        </div>
                      </TranslationSyncProvider>
                    </WebSocketProvider>
                  </ActiveChannelWrapper>
                </AuthProvider>
                {/* Cookie size monitor (dev mode only) */}
                <CookieSizeMonitor />
              </MultiAccountProvider>
            </ThemeProvider>
            </NuqsAdapter>
          </QueryProvider>
      </body>
      <script async nonce={nonce} type="text/javascript" src="https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js"></script>

    </html>
  );
}
