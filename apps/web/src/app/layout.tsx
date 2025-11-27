import React from "react";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ThemeProvider } from "@/components/themeProvider";
import { authenticated } from "../lib/actions"
import { Suspense } from "react"
import type { Metadata, Viewport } from 'next'
import "./globals.css";
import Navigation from "@/components/navigation";
import AuthProvider from "@/components/AuthProvider";
import { WebSocketProvider } from "@/lib/websocket/WebSocketProvider";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { MultiAccountProvider } from "@/hooks/useMultiAccount";
import { CookieSizeMonitor } from "@/components/CookieSizeMonitor";
import { ActiveChannelWrapper } from "@/components/ActiveChannelWrapper";
import { QueryProvider } from "@/providers/QueryProvider";

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
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111827' }, // gray-900
  ],
};

export default async function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  const subject = await authenticated()
  const user = subject ? subject.properties : null;

  return (
    <html lang="en" suppressHydrationWarning>
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
          dangerouslySetInnerHTML={{
            __html: `window.__RUNTIME_CONFIG__ = ${JSON.stringify({
              API_URL: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '',
              WEBSOCKET_URL: process.env.WEBSOCKET_URL || process.env.NEXT_PUBLIC_WEBSOCKET_URL || '',
            })};`,
          }}
        />
      </head>
      <body className="font-inter">
        <Suspense>
          <QueryProvider>
            <NuqsAdapter>
              <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange>
              <MultiAccountProvider>
                <AuthProvider>
                  <ActiveChannelWrapper>
                    <WebSocketProvider user={user}>
                      <div className="flex flex-col min-h-screen bg-white dark:bg-gray-900">
                        {/* Header */}
                        <Navigation></Navigation>
                        {children}

                        {/* Real-time notification center */}
                        <NotificationCenter />
                      </div>
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
      <script async type="text/javascript" src="//assets.mediadelivery.net/playerjs/player-0.1.0.min.js"></script>

    </html>
  );
}
