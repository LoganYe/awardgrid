import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

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

export default defineConfig({
  plugins: [react(), sourceMapsBesideBundle()],
  // Capacitor copies dist/ into ios/App/App/public and serves it from capacitor://localhost,
  // so every asset URL must be relative.
  base: "",
  build: { outDir, sourcemap: "hidden" },
});
