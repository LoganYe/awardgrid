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
 * One token: an element whose content is raw text (a `<!--` inside it is its content, not a comment, and is left as
 * it is), or an HTML comment with the indentation before it and the line break after it. `<!-->` and `<!--->` are
 * comments too (the HTML parser closes them at once). A comment never runs past its first `-->`.
 */
const HTML_TOKEN = /<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|(^[ \t]*)?<!--(?:>|->|(?:(?!-->)[\s\S])*-->)([ \t]*\r?\n)?/gim;

/**
 * Removes every HTML comment from a page. A comment on a line of its own goes with its line; one beside other markup
 * leaves that markup and its spacing alone. Throws when a `<!--` is still there afterwards (an unterminated comment,
 * or one inside a script, style, textarea or title), because the built site carries none: CI runs
 * `scripts/growth/validate-public-claims.mjs --dist`, whose HTML_COMMENT_IN_DIST rule fails on any.
 */
export function stripHtmlComments(html: string, file = "a page"): string {
  const out = html.replace(HTML_TOKEN, (match, rawTag: string | undefined, lead: string | undefined, trail: string | undefined) => {
    if (rawTag) return match;
    if (lead !== undefined && trail !== undefined) return "";
    return (lead ?? "") + (trail ?? "");
  });
  const left = out.indexOf("<!--");
  if (left !== -1) {
    const line = out.slice(0, left).split("\n").length;
    throw new Error(
      `${file}:${line} still has "<!--" after its comments were removed (an unterminated comment, or one inside a script, style, textarea or title). The built site carries none (sites/landing/NOTES.md).`,
    );
  }
  return out;
}

/**
 * The built pages carry no HTML comments: they are what a reader, a crawler and an answer engine get. The notes the
 * source comments hold are for whoever edits the page, and sites/landing/NOTES.md keeps them. Runs last, on the page
 * Vite has finished (its stylesheet link included).
 */
function stripComments(): Plugin {
  return {
    name: "awardgrid:strip-html-comments",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => stripHtmlComments(html, path.relative(here, ctx.filename) || ctx.path),
    },
  };
}

/**
 * Static output only. PIVOT §2: "sites/landing — static, on Cloudflare Pages, makes no API calls at all." Vite is
 * here to resolve the `@awardgrid/tokens` workspace import and inline the result, so the palette has one source rather
 * than a copy that drifts, and to build the pages (release decision D7): the iPhone app's page at /ios/, the privacy
 * policy at /privacy/, the support page at /support/, and a root page for the Worker's own address.
 *
 * On awardgrid.dowhiz.com the web app keeps "/" and everything else; the Worker `awardgrid-site` serves only /ios/,
 * /privacy/, /support/ and /_site/ from this build (DEPLOY.md, wrangler.jsonc). So the built CSS goes under _site/,
 * not Vite's default assets/, and every page links it relatively.
 *
 * `root` and `publicDir` are this directory and its own public/, whichever directory the build starts in. Vite's
 * defaults are the working directory and its public/, and the repo root's public/ belongs to the Next.js web app: a
 * build started from the repo root must never copy it into this site.
 */
export default defineConfig({
  root: here,
  publicDir: path.join(here, "public"),
  base: "./",
  plugins: [supportEmail(), stripComments()],
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
