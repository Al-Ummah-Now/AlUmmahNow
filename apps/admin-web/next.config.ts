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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@al-ummah/shared-types'],

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
