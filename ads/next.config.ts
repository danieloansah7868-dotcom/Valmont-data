import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The sandbox preview is served from https://{port}-{sandboxId}.e2b.app
  allowedDevOrigins: ["*.e2b.app", "*.app.github.dev", "localhost"],
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
