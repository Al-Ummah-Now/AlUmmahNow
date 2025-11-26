import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@al-ummah/shared-types'],
};

export default nextConfig;
