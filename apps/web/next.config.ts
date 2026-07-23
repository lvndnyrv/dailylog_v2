import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the development tools launcher away from the fixed sidebar account
  // control. Production is unaffected, but localhost now mirrors the handoff
  // instead of covering the admin avatar with Next's floating badge.
  devIndicators: { position: "bottom-right" },
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
