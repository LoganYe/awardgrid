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
 * The App Store flavour (src/app/flags.ts STORE, and OAUTH, as `npm run build:store` builds it): `UIUX_STORE=1` serves
 * the host with Ask compiled out and seats.aero's own sign-in instead of the key field, for the `ios-store` Playwright
 * project on its own port (playwright.uiux.config.ts). No VITE_* variable reaches this page (envPrefix below), so the
 * flags are defined here, never left to the shell.
 */
const STORE = process.env.UIUX_STORE === "1";

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
  // The App Store flavour is the OAuth flavour, as `npm run build:store` builds it, with the test client's ID (the
  // HTTP mock's, scripts/mock-seatsaero-oauth-core.ts); the default flavour is the key flavour.
  define: {
    "import.meta.env.VITE_AG_STORE": JSON.stringify(STORE ? "1" : ""),
    "import.meta.env.VITE_AG_CONNECT": JSON.stringify(STORE ? "oauth" : ""),
    "import.meta.env.VITE_AG_SEATS_CLIENT_ID": JSON.stringify(STORE ? "mock-client-id" : ""),
  },
  // The two hosts run side by side; each keeps its own pre-bundled dependencies so neither rewrites the other's.
  cacheDir: path.join(here, "node_modules", STORE ? ".vite-uiux-store" : ".vite"),
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
      // One file of scripts/: the sign-in mock's rules, shared with the HTTP mock (fixture-host/transports.ts).
      allow: [here, path.join(repo, "packages", "core"), path.join(repo, "packages", "tokens"), path.join(repo, "node_modules"), path.join(repo, "scripts", "mock-seatsaero-oauth-core.ts")],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/*.db", "**/*.db-*", "**/data/runtime/**"],
    },
  },
  clearScreen: false,
});
