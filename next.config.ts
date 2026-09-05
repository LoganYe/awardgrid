import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smaller Docker image: .next/standalone contains a self-sufficient server.js.
  output: "standalone",
  // Native modules and the Agent SDK (which spawns a subprocess) must not be bundled.
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "@anthropic-ai/claude-agent-sdk"],
  // No telemetry, no third-party analytics (kickoff §10). Also keep the image header-light.
  poweredByHeader: false,
  // Only image-free UI is used (no logos); disable the optimizer so no remote hosts are ever contacted.
  images: { unoptimized: true },
};

export default nextConfig;
