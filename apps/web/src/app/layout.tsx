import React from "react";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ThemeProvider } from "@/components/themeProvider";
import { authenticated } from "../lib/actions"
import { Suspense } from "react"
import type { Metadata, Viewport } from 'next'
import { headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_REQUEST_HEADER } from "@/lib/i18n/locales";
import { getTextDirection, isLocaleSupported } from "@/lib/i18n/utils";
import "./globals.css";
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
import { deriveAuthProfileUrl } from "@/lib/runtime-config";
import { SecurityBootstrap } from "@/components/security/SecurityBootstrap";
import { ConsentBanner } from "@/components/consent/ConsentBanner";
import SkipLinks from "@/components/SkipLinks";

export const metadata: Metadata = {
  title: 'Al Ummah Now',
  description: 'Excerpts from scholars\' clips about the state of the nation today',
  keywords: 'Al Ummah Now, Islamic, Videos, Clips',
  authors: [{ name: 'Al Ummah Now' }],
  robots: 'index, follow',
  openGraph: {
    title: 'Al Ummah Now',
    description: 'Excerpts from scholars\' clips about the state of the nation today',
    url: 'https://alummahnow.com',
    images: ['/favicon-16x16.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Al Ummah Now',
    description: 'Excerpts from scholars\' clips about the state of the nation today',
    images: ['/favicon-16x16.png'],
    site: '@alummahnow',
    creator: '@alummahnow',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  other: {
    referrer: 'origin',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom must stay enabled (WCAG 1.4.4 Resize Text / axe meta-viewport)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111827' }, // gray-900
  ],
};

export default async function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  const subject = await authenticated()
  const user = subject ? subject.properties : null;
  const requestedLocale = (await headers()).get(LOCALE_REQUEST_HEADER);
  const locale = requestedLocale && isLocaleSupported(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  // Per-request CSP nonce set by middleware (production only).
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html lang={locale} dir={getTextDirection(locale)} suppressHydrationWarning>
      <head>
        {/* Font Awesome - Consider self-hosting for better performance */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.1/css/all.min.css"
          integrity="sha512-MV7K8+y+gLIBoVD59lQIYicR65iaqukzvf/nwasF0nqhPay5w/9lJmVM2hMDcnK1OnMGCdVK+iQrJ7lzPJQd1w=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        {/* Runtime configuration injected from server */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.__RUNTIME_CONFIG__ = ${serializeForInlineScript({
              API_URL: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '',
              WEBSOCKET_URL: process.env.WEBSOCKET_URL || process.env.NEXT_PUBLIC_WEBSOCKET_URL || '',
              AUTH_PROFILE_URL: deriveAuthProfileUrl(
                process.env.OPENAUTH_ISSUER || process.env.Issuer,
                process.env.AUTH_PROFILE_URL
              ),
            })};`,
          }}
        />
      </head>
      <body className="font-inter">
        <SecurityBootstrap />
        <Suspense>
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
                        <div className="flex flex-col min-h-screen bg-white dark:bg-gray-900">
                          {/* Skip links must be the first focusable elements (WCAG 2.4.1) */}
                          <SkipLinks />
                          {/* Header */}
                          <Navigation></Navigation>
                          {children}

                          {/* Real-time notification center */}
                          <NotificationCenter />

                          {/* Cookie / tracking consent (GDPR, Story 1.3) */}
                          <ConsentBanner />
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
        </Suspense>
      </body>
      <script async nonce={nonce} type="text/javascript" src="https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js"></script>

    </html>
  );
}
