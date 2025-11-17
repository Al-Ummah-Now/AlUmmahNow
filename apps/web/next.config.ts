/** @type {import('next').NextConfig} */

const nextConfig = {
    productionBrowserSourceMaps: true, // Enable source maps in production for better error tracking

    // Enable server-side source maps with webpack (more stable than Turbopack for Cloudflare Workers)
    webpack: (config: Record<string, unknown>, { isServer }: { isServer: boolean }) => {
        if (isServer) {
            config.devtool = 'source-map';
        }
        return config;
    },

    // Empty turbopack config to silence Next.js 16 warning
    turbopack: {},

    images: {
        remotePatterns: [
          {
            protocol: "https",
            hostname: "images.alummahnow.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "al-ummah-now-images.b-cdn.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "vz-215a1ffd-a5a.b-cdn.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "iframe.mediadelivery.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "cdn.alummahnow.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "stream.alummahnow.net",
            port: "",
            pathname: "**",
            search: "",
          },
          {
            protocol: "https",
            hostname: "auth.alummahnow.net",
            port: "",
            pathname: "**",
            search: "",
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