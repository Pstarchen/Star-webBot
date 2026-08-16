import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["quickjs-emscripten", "ws"],
};

export default nextConfig;
