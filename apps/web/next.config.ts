/** @type {import('next').NextConfig} */

const nextConfig = {
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
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();