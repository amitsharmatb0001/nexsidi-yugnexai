import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  images: { remotePatterns: [{ protocol: "https", hostname: "img.clerk.com" }] },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.clerk.com; style-src 'self' 'unsafe-inline' https://*.clerk.com; img-src 'self' data: https://*.clerk.com; connect-src 'self' https://*.clerk.com https://*.clerk.accounts.dev; frame-src https://*.clerk.com;" },
      ],
    },
  ],
};

export default nextConfig;
