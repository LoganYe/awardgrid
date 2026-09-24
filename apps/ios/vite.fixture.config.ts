/**
 * TEST-ONLY Vite root for the UI/UX v1 fixture host (apps/ios/fixture-host). playwright.uiux.config.ts serves it
 * on 127.0.0.1; it is never built, never synced into the Xcode project, and src/main.tsx never imports it.
 * `vite build` (vite.config.ts) builds index.html → src/main.tsx only, and scripts/check-fixture-free-bundle.mjs
 * fails that build if any fixture marker reaches dist/.
 */
import path from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig, transformWithOxc } from "vite";

const here = import.meta.dirname;
const repo = path.resolve(here, "..", "..");

/**
 * Parity with the shipped bundle for core's `process.env` defaults (seatsaero/cache.ts cacheTtlMinutesFromEnv,
 * query/llm.ts resolveParserModel). `vite build` compiles them to `{}` — dist shows `function …(e={})` — and the
 * phone has no `process` global at all. The dev server leaves them as they are, so the first search would throw.
 * A `define` would fix that by creating a `process` global the phone does not have; this rewrites only the
 * workspace's own source, the way the build does, and leaves `typeof process` checks in dependencies alone.
 */
function processEnvParity(): Plugin {
  return {
    name: "uiux-fixture:process-env-parity",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0]!;
      if (file.includes("/node_modules/") || !file.endsWith(".ts") || !code.includes("process.env")) return null;
      const out = await transformWithOxc(code, file, { lang: "ts", define: { "process.env": "{}" } });
      return { code: out.code, map: out.map };
    },
  };
}

export default defineConfig({
  root: path.resolve(here, "fixture-host"),
  // The app's own public/ (fonts), so the host renders with the same assets as the shell.
  publicDir: path.resolve(here, "public"),
  plugins: [processEnvParity(), react()],
  // No VITE_* variable reaches this page: a probe/e2e flag (VITE_AG_PROBES) exported in the shell would make App
  // boot the Simulator probe ports instead of the injected ones. main.tsx also refuses to start if one leaks.
  envPrefix: "UIUX_FIXTURE_PUBLIC_",
  server: {
    host: "127.0.0.1",
    strictPort: true,
    // Serve only what the host renders. Vite's default allows the whole workspace, which here includes
    // git-ignored logs and the runtime SQLite files under data/runtime.
    fs: {
      strict: true,
      allow: [here, path.join(repo, "packages", "core"), path.join(repo, "packages", "tokens"), path.join(repo, "node_modules")],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/*.db", "**/*.db-*", "**/data/runtime/**"],
    },
  },
  clearScreen: false,
});
