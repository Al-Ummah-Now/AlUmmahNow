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
        ],
      },
};

export default nextConfig;
