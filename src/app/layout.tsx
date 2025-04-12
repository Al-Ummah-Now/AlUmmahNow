"use client";
import React, { useState, useEffect } from "react";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/themeProvider";
import Header from "@/components/Header/index";
import LeftNavigation from "@/components/LeftNavigation/index";
import HeaderRtl from "@/components/Header/rtl/index";
import LeftNavigationRtl from "@/components/LeftNavigation/rtl/index";
import AccountNavigation from "@/components/accountNavigation";
import AccountNavigationRtl from "@/components/accountNavigation/rtl";
import { redirect, useSearchParams, usePathname } from "next/navigation";
import { auth, login, logout } from "./actions"
import { Suspense } from "react"
import "./globals.css";
import { subjects } from "./auth";
import { set } from "video.js/dist/types/tech/middleware";
import AuthProvider from "@/components/AuthProvider";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isAccountCollapsed, setIsAccountCollapsed] = useState(true);
  const path = usePathname();
  const params = useSearchParams()?.toString();
  const rtl = path.indexOf('/rtl') > -1;
  const withOverlay = path.indexOf('/video') > -1 ? true : false;

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const toggleAccountCollapse = () => {
    setIsAccountCollapsed(!isAccountCollapsed);
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="referrer" content="origin" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="description" content="Excerpts from scholars' clips about the state of the nation today" />
        <meta name="keywords" content="Al Ummah Now, Islamic, Videos, Clips" />
        <meta name="author" content="Al Ummah Now" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="robots" content="index, follow" />
        <meta name="og:image" content="/favicon-16x16.png" />
        <meta name="og:title" content="Al Ummah Now" />
        <meta name="og:description" content="Excerpts from scholars' clips about the state of the nation today" />
        <meta name="og:url" content="https://alummahnow.com" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Al Ummah Now" />
        <meta name="twitter:description" content="Excerpts from scholars' clips about the state of the nation today" />
        <meta name="twitter:image" content="/favicon-16x16.png" />
        <meta name="twitter:site" content="@alummahnow" />
        <meta name="twitter:creator" content="@alummahnow" />
        <meta name="twitter:domain" content="alummahnow.net" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon.ico" sizes="any" type="image/x-icon" />
        <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />

        <title>Al Ummah Now</title>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.1/css/all.min.css"
          integrity="sha512-MV7K8+y+gLIBoVD59lQIYicR65iaqukzvf/nwasF0nqhPay5w/9lJmVM2hMDcnK1OnMGCdVK+iQrJ7lzPJQd1w=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body className={inter.className}>
        <Suspense>
          <NuqsAdapter>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange>
              <AuthProvider>
                <div className="flex flex-col min-h-screen bg-white dark:bg-gray-900" style={{ direction: rtl ? "rtl" : "ltr" }}>
                  {/* Header */}
                  {rtl
                    ? <HeaderRtl toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />
                    : <Header toggleCollapse={toggleCollapse} toggleAccountCollapse={toggleAccountCollapse} />}
                  <div className="flex flex-1">
                    {/* Left Navigation */}
                    {path.indexOf('/rtl') > -1
                      ? <LeftNavigationRtl isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />
                      : <LeftNavigation isCollapsed={isCollapsed} withOverlay={true} onCollapse={() => setIsCollapsed(true)} />}

                    {/* Account Navigation */}
                    {path.indexOf('/rtl') > -1
                      ? <AccountNavigationRtl isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />
                      : <AccountNavigation isVisible={!isAccountCollapsed} onClose={() => setIsAccountCollapsed(true)} />}

                  </div>
                  {children}
                </div>
              </AuthProvider>
            </ThemeProvider>
          </NuqsAdapter>
        </Suspense>
      </body>
      <script async src="https://unpkg.com/@material-tailwind/html@latest/scripts/ripple.js"></script>
      <script async type="text/javascript" src="//assets.mediadelivery.net/playerjs/player-0.1.0.min.js"></script>

    </html>
  );
}
