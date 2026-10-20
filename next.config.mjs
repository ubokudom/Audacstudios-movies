/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
