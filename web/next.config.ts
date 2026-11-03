import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(webDir);
const building = process.argv.includes("build");

const nextConfig: NextConfig = {
  ...(building ? { output: "export" as const } : {}),
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  images: { unoptimized: true },
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
};

if (!building) {
  nextConfig.rewrites = async () => [
    { source: "/api/:path*", destination: "http://127.0.0.1:8787/api/:path*" },
  ];
}

export default nextConfig;
