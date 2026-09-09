import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smaller Docker image: .next/standalone contains a self-sufficient server.js.
  output: "standalone",
  // Native modules and the Agent SDK (which spawns a subprocess) must not be bundled.
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "@anthropic-ai/claude-agent-sdk"],
  // @awardgrid/core ships raw TypeScript with no build step (docs/PIVOT.md §6 Phase 1), so Next
  // has to compile it rather than treat it as a prebuilt dependency. One copy of the truth, and
  // no dist/ that can drift from source. This also preserves the "use client" directive in
  // i18n/client.tsx across the package boundary.
  //
  // The rule this encodes, which matters more than the line itself: @awardgrid/core must NEVER be
  // added to serverExternalPackages above. Doing so would leave the standalone server to
  // require() raw .ts at runtime — a build that succeeds and a server that dies on first request.
  // The two lists are also mutually exclusive: Next throws E173 at build start if a package
  // appears in both, so the mistake is at least loud.
  transpilePackages: ["@awardgrid/core"],
  // No telemetry, no third-party analytics (kickoff §10). Also keep the image header-light.
  poweredByHeader: false,
  // Only image-free UI is used (no logos); disable the optimizer so no remote hosts are ever contacted.
  images: { unoptimized: true },
  // Next's file tracing follows the process.cwd()-relative reads (src/app/legal/page.tsx → LEGAL.md,
  // src/lib/db/client.ts → drizzle/, src/lib/ask/skills.ts → readdirSync(build/plugin)) and, unable to
  // narrow the last one, copies the whole repo into .next/standalone. Keep what the standalone server
  // reads at runtime — LEGAL.md, drizzle/, data/places.json, build/plugin — and drop everything else:
  // tests and fixtures (fake keys), scripts, the vendored toolkit, docs, the local SQLite database and
  // cache, sources, and repo docs/config. Kickoff §9 Phase-2 self-acceptance
  // (scripts/check-no-secrets-in-bundle.sh, run in CI) greps the whole .next/ tree for fixture key strings.
  // `./spikes/**` is the Phase-0 throwaway: it carries its own node_modules/ and ios/Pods/, which
  // the standalone server never reads and which would otherwise be copied into it wholesale.
  // Root markdown is excluded BY NAME, so a new root .md file is traced in until it is listed here.
  // That is what the CI grep is for: HANDOFF.md quotes the fixture password and failed it until listed.
  // Note: Next copies a local .env / .env.production into .next/standalone by design (independent of
  // tracing); .dockerignore keeps them out of the image.
  outputFileTracingExcludes: {
    "*": [
      "./test/**",
      "./**/*.test.ts",
      "./**/*.test.tsx",
      "./src/**",
      "./scripts/**",
      "./spikes/**",
      // The client shells (docs/PIVOT.md §6 Phase 2). apps/ios carries its own node_modules, a
      // generated Xcode project and DerivedData; the Next server reads none of it.
      "./apps/**",
      "./vendor/**",
      "./docs/**",
      "./data/runtime/**",
      "./**/*.db",
      "./**/*.db-*",
      "./**/*.sqlite",
      "./**/*.sqlite3",
      "./.git/**",
      "./.github/**",
      "./.claude/**",
      "./node_modules/.cache/**",
      "./AGENTS.md",
      "./ARCHITECTURE.md",
      "./BACKLOG.md",
      "./CLAUDE.md",
      "./DECISIONS.md",
      "./FINAL_REPORT.md",
      "./HANDOFF.md",
      "./README.md",
      "./Dockerfile",
      "./docker-compose.yml",
      "./components.json",
      "./drizzle.config.ts",
      "./eslint.config.mjs",
      "./next.config.ts",
      "./postcss.config.mjs",
      "./vitest.config.ts",
      "./pnpm-lock.yaml",
      "./pnpm-workspace.yaml",
      "./tsconfig.json",
      "./tsconfig.tsbuildinfo",
    ],
  },
};

export default nextConfig;
