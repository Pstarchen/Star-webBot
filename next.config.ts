import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["quickjs-emscripten", "ws", "@tencent-connect/qqbot-connector", "qrcode"],
};

export default nextConfig;
