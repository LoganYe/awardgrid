import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig, loadEnv } from "vite";

const here = import.meta.dirname;
const outDir = path.join(here, "dist");
/** Where the source maps go instead: beside dist/, never inside it (git-ignored). */
const mapsDir = path.join(here, "dist-sourcemaps");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * The maps are written, then moved out of dist/ before `cap copy` can put them in the app (release D14: about 4.4 MB
 * carrying the original TypeScript). They are kept beside it for reading a stack trace, and for the checks that read
 * them: scripts/check-fixture-free-bundle.mjs (no fixture module was bundled) and scripts/check-acknowledgements.mjs
 * (every package that ships has its notice). "hidden" writes no sourceMappingURL comment into the chunks, so nothing
 * in the app points at a file that is not there.
 */
function sourceMapsBesideBundle(): Plugin {
  return {
    name: "awardgrid:source-maps-beside-bundle",
    apply: "build",
    closeBundle() {
      rmSync(mapsDir, { recursive: true, force: true });
      for (const file of walk(outDir)) {
        if (!file.endsWith(".map")) continue;
        const target = path.join(mapsDir, path.relative(outDir, file));
        mkdirSync(path.dirname(target), { recursive: true });
        renameSync(file, target);
      }
    },
  };
}

/**
 * The build's flavour flags (src/app/flags.ts), checked before anything is built: a value the app does not know would
 * otherwise build the default flavour without a word. VITE_AG_STORE is "1" (the App Store build, `npm run build:store`)
 * or unset. VITE_AG_CONNECT is "key" (the default), "0" or "oauth"; "oauth" is refused for a bundle until the OAuth
 * connection exists (PR-O), because the app would still show the key field under that name.
 */
export function checkFlavour(env: Record<string, string>, command: "build" | "serve"): void {
  const store = env.VITE_AG_STORE;
  if (store !== undefined && store !== "" && store !== "1") throw new Error(`VITE_AG_STORE must be "1" or unset, not ${JSON.stringify(store)}`);
  const connect = env.VITE_AG_CONNECT;
  if (connect !== undefined && connect !== "" && !["key", "0", "oauth"].includes(connect)) {
    throw new Error(`VITE_AG_CONNECT must be "key", "0" or "oauth", not ${JSON.stringify(connect)}`);
  }
  if (connect === "oauth" && command === "build") throw new Error("VITE_AG_CONNECT=oauth is not built yet (the OAuth connection, PR-O): build with key or 0");
}

export default defineConfig(({ command, mode }) => {
  checkFlavour(loadEnv(mode, here, "VITE_AG_"), command);
  return {
    plugins: [react(), sourceMapsBesideBundle()],
    // Capacitor copies dist/ into ios/App/App/public and serves it from capacitor://localhost,
    // so every asset URL must be relative.
    base: "",
    build: { outDir, sourcemap: "hidden" },
  };
});
