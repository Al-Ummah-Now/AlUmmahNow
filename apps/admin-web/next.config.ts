import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@al-ummah/shared-types'],

  // Empty turbopack config to silence Next.js 16 warning
  turbopack: {},

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
