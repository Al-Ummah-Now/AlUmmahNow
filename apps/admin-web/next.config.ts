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

import type { NextConfig } from 'next';

/** The build's release: first 12 characters of the commit (error reports, source maps). */
const RELEASE = (process.env.GITHUB_SHA || process.env.RELEASE_SHA || 'dev').slice(0, 12);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_RELEASE: RELEASE },
  // Uploaded privately by scripts/release/upload-sourcemaps.ts and removed from the assets
  productionBrowserSourceMaps: true,
  transpilePackages: ['@al-ummah/shared-types'],

  // Channel avatars/covers and video thumbnails (up to 5 MB) go through server actions
  experimental: { serverActions: { bodySizeLimit: '6mb' } },

  // Empty turbopack config to silence Next.js 16 warning
  turbopack: {
    resolveAlias: { jose: path.relative(process.cwd(), joseWebCrypto) },
  },

  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), jose$: joseWebCrypto };
    return config;
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.alummahnow.net",
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
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
