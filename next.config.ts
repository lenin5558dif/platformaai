import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
