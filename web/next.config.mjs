/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The preview/iframe host is proxied by the platform; allow any dev origin.
  allowedDevOrigins: ['*'],
  experimental: {
    // Large template/element JSON is imported dynamically; keep bundles tidy.
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Data access is node:sqlite + raw SQL — no ORM binaries to externalise.
  serverExternalPackages: [],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
