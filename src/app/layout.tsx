import type { Metadata } from "next";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Inter } from "next/font/google";
import { Suspense } from "react"
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Al Ummah Now",
  description: "Excerpts from scholars' clips about the state of the nation today",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="referrer" content="origin" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={metadata.description} />
        <meta name="keywords" content="Al Ummah Now, Islamic, Videos, Clips" />
        <meta name="author" content="Al Ummah Now" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="robots" content="index, follow" />
        <meta name="og:image" content="/favicon-16x16.png" />
        <meta name="og:title" content="Al Ummah Now" />
        <meta name="og:description" content={metadata.description} />
        <meta name="og:url" content="https://alummahnow.com" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Al Ummah Now" />
        <meta name="twitter:description" content={metadata.description} />
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
            {children}
          </NuqsAdapter>
        </Suspense>
      </body>
      <script async src="https://unpkg.com/@material-tailwind/html@latest/scripts/ripple.js"></script>
    </html>
  );
}
