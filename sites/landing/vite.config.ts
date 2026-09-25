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
 * than a copy that drifts, and to build the pages (release decision D7): the iPhone app's page at /ios/, the privacy
 * policy at /privacy/, the support page at /support/, and a root page for the Pages project's own address.
 *
 * On awardgrid.dowhiz.com the web app keeps "/" and everything else; the Worker `awardgrid-site` serves only /ios/,
 * /privacy/, /support/ and /_site/ from this build (DEPLOY.md, wrangler.jsonc). So the built CSS goes under _site/,
 * not Vite's default assets/, and every page links it relatively.
 */
export default defineConfig({
  base: "./",
  plugins: [supportEmail()],
  build: {
    outDir: "dist",
    cssMinify: true,
    assetsDir: "_site",
    rolldownOptions: {
      input: {
        index: path.join(here, "index.html"),
        ios: path.join(here, "ios", "index.html"),
        privacy: path.join(here, "privacy", "index.html"),
        support: path.join(here, "support", "index.html"),
      },
    },
  },
});
