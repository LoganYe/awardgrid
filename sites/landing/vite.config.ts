import path from "node:path";
import { type Plugin, defineConfig } from "vite";

const here = import.meta.dirname;

/**
 * The address the privacy and support pages give (App Store Connect needs both pages, and a way to reach the
 * developer). It is the owner's to choose and is not kept in git: the build takes it from AWARDGRID_SUPPORT_EMAIL and
 * refuses to build without a plausible one, so no page goes out with the placeholder in it.
 *
 *   AWARDGRID_SUPPORT_EMAIL=you@example.com pnpm build:landing
 */
function supportEmail(): Plugin {
  const placeholder = "%AWARDGRID_SUPPORT_EMAIL%";
  return {
    name: "awardgrid:support-email",
    apply: "build",
    transformIndexHtml(html) {
      if (!html.includes(placeholder)) return html;
      const email = process.env.AWARDGRID_SUPPORT_EMAIL?.trim() ?? "";
      if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) {
        throw new Error("Set AWARDGRID_SUPPORT_EMAIL to the address the privacy and support pages give (see sites/landing/vite.config.ts).");
      }
      return html.replaceAll(placeholder, email);
    },
  };
}

/**
 * Static output only. PIVOT §2: "sites/landing — static, on Cloudflare Pages, makes no API calls at all." Vite is
 * here to resolve the `@awardgrid/tokens` workspace import and inline the result, so the palette has one source rather
 * than a copy that drifts, and to build the three pages: the landing page, the privacy policy and the support page
 * (release decision D7), each at its own path (/, /privacy/, /support/).
 */
export default defineConfig({
  base: "./",
  plugins: [supportEmail()],
  build: {
    outDir: "dist",
    cssMinify: true,
    rolldownOptions: {
      input: {
        index: path.join(here, "index.html"),
        privacy: path.join(here, "privacy", "index.html"),
        support: path.join(here, "support", "index.html"),
      },
    },
  },
});
