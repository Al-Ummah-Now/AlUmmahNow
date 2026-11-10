import { createRequire } from "node:module";
import path from "node:path";

// jose's default Node build verifies JWTs through node:crypto, and workerd's
// node:crypto EC support makes ES256 signature checks fail on Cloudflare
// ("signature verification failed" for valid tokens). Force jose's WebCrypto
// build, which is what the Workers runtime supports natively.
const requireFromHere = createRequire(import.meta.url);
const joseWebCrypto = path.join(
  requireFromHere.resolve("jose").replace(/dist[\\/].*$/, ""),
  "dist/browser/index.js",
);

/** @type {import('next').NextConfig} */

const nextConfig = {
    // Browser source maps: the release uploads them privately to R2 for the admin
    // Errors page and deletes them from the deployed assets (scripts/release/upload-sourcemaps.ts)
    productionBrowserSourceMaps: true,

    // Build id sent with every client error report; source maps are stored under it
    env: {
        NEXT_PUBLIC_RELEASE: (process.env.GITHUB_SHA || process.env.RELEASE_SHA || 'dev').slice(0, 12),
    },

    // Enable server-side source maps with webpack (more stable than Turbopack for Cloudflare Workers)
    webpack: (config: Record<string, unknown>, { isServer }: { isServer: boolean }) => {
        if (isServer) {
            config.devtool = "source-map";
        }
        const resolve = (config.resolve ?? {}) as { alias?: Record<string, string> };
        resolve.alias = { ...(resolve.alias ?? {}), jose$: joseWebCrypto };
        config.resolve = resolve;
        return config;
    },

    // Empty turbopack config to silence Next.js 16 warning
    turbopack: {
        resolveAlias: { jose: path.relative(process.cwd(), joseWebCrypto) },
    },

    // Increase body size limit for file uploads (default is 1MB)
    // Server Actions have a 1MB limit by default - increase to 10MB for image uploads
    experimental: {
        serverActions: {
            bodySizeLimit: '10mb',
        },
    },

    images: {
        // Serve images straight from the CDN (Cloudflare in front of Bunny,
        // cached at the edge). Optimization through /_next/image ran in the web
        // Worker (cold starts, uncached) and did not resize on Workers anyway.
        unoptimized: true,
        remotePatterns: [
          {
            protocol: "https",
            hostname: "images.alummahnow.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "al-ummah-now-images.b-cdn.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "vz-215a1ffd-a5a.b-cdn.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "iframe.mediadelivery.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "cdn.alummahnow.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "stream.alummahnow.net",
            port: "",
            pathname: "**",
          },
          {
            protocol: "https",
            hostname: "auth.alummahnow.net",
            port: "",
            pathname: "**",
          },
        ],
      },
    transpilePackages: [
      'video.js',
      '@videojs/http-streaming',
      'videojs-contrib-quality-levels',
      'videojs-hls-quality-selector'
    ],
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();