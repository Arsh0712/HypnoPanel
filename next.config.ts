import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Keep the preview surface clean (no dev-tools overlay covering the sidebar)
  devIndicators: false,
};

export default nextConfig;
