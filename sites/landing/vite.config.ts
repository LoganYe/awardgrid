import { defineConfig } from "vite";

/**
 * Static output only. PIVOT §2: "sites/landing — static, on Cloudflare Pages, makes no API calls
 * at all." Vite is here purely to resolve the `@awardgrid/tokens` workspace import and inline the
 * result, so the palette has one source rather than a copy that drifts.
 */
export default defineConfig({
  base: "./",
  build: { outDir: "dist", cssMinify: true },
});
