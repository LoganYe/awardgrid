import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Plugin, defineConfig } from "vite";

const here = import.meta.dirname;

/** One page of the site, as sites/landing/pages.json lists it. */
export interface Page {
  /** The URL path it is served at, with its trailing slash ("/", "/ios/"). */
  path: string;
  /** Its source, relative to this directory ("ios/index.html"). */
  file: string;
  /** The date its content last changed (YYYY-MM-DD), set by hand. */
  lastmod: string;
}

export interface Manifest {
  /** The hostname the pages are served on ("awardgrid.dowhiz.com"), over https. */
  host: string;
  pages: Page[];
  /** The IndexNow key: public/<key>.txt holds it (scripts/indexnow.mjs reads both). */
  indexnow_key: string;
}

/** sites/landing/pages.json: the pages this build makes, and what sitemap.xml lists. */
export function readManifest(file = path.join(here, "pages.json")): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

/** The site's origin, "https://" and its host. */
export const siteOrigin = (manifest: Manifest) => `https://${manifest.host}`;

/** Today's date where the build runs, as YYYY-MM-DD. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Is `s` a real calendar date written YYYY-MM-DD? */
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * What is wrong with the manifest, if anything: a host that is not a plain hostname, a page path that is not absolute
 * with a trailing slash, a repeated path, a file that is not the path's index.html under this directory (or does not
 * exist), a lastmod that is not a date or is later than `today`, a key that is not 32 hex digits or that public/ does
 * not hold as <key>.txt.
 */
export function manifestProblems(manifest: Manifest, today: string, root = here): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(manifest.host ?? "")) out.push(`host ${JSON.stringify(manifest.host)} is not a plain hostname`);
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) out.push("pages is empty");
  const seen = new Set<string>();
  for (const page of manifest.pages ?? []) {
    const label = JSON.stringify(page.path);
    if (!/^\/(?:[a-z0-9-]+\/)*$/.test(page.path ?? "")) out.push(`page ${label}: path must start and end with "/"`);
    if (seen.has(page.path)) out.push(`page ${label} is listed twice`);
    seen.add(page.path);
    const want = `${page.path.slice(1)}index.html`;
    if (page.file !== want) out.push(`page ${label}: file must be ${want}`);
    else if (!existsSync(path.join(root, page.file))) out.push(`page ${label}: ${page.file} does not exist`);
    if (!isDate(page.lastmod ?? "")) out.push(`page ${label}: lastmod ${JSON.stringify(page.lastmod)} is not a YYYY-MM-DD date`);
    else if (page.lastmod > today) out.push(`page ${label}: lastmod ${page.lastmod} is later than the build date ${today}`);
  }
  const key = manifest.indexnow_key ?? "";
  if (!/^[0-9a-f]{32}$/.test(key)) out.push("indexnow_key must be 32 lower-case hex digits");
  else if (!existsSync(path.join(root, "public", `${key}.txt`))) out.push(`indexnow_key: public/${key}.txt does not exist`);
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** sitemap.xml for the manifest: one <url> per page, in its order, with its <lastmod>. */
export function sitemapXml(manifest: Manifest): string {
  const urls = manifest.pages.map(
    (page) => `  <url>\n    <loc>${escapeXml(siteOrigin(manifest) + page.path)}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * Writes sitemap.xml into the build from pages.json, and stops the build when the manifest is wrong (a lastmod later
 * than today, a page file that does not exist). The sitemap is built, not kept in public/, so it cannot disagree with
 * the pages the build makes.
 */
function sitemap(): Plugin {
  return {
    name: "awardgrid:sitemap",
    apply: "build",
    generateBundle() {
      const manifest = readManifest();
      const problems = manifestProblems(manifest, localDate());
      if (problems.length) throw new Error(`sites/landing/pages.json: ${problems.join("; ")}`);
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(manifest) });
    },
  };
}

/** The build's inputs: every page of pages.json, named by its directory ("index" for the root). */
function pageInputs(): Record<string, string> {
  return Object.fromEntries(readManifest().pages.map((page) => [page.path === "/" ? "index" : page.path.slice(1, -1).replaceAll("/", "-"), path.join(here, page.file)]));
}

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
 * than a copy that drifts, and to build the pages pages.json lists (release decision D7): the home page at /, the
 * iPhone app's page at /ios/ with /ios/award-grid/ (how the table works) and /ios/zh-hans/ (its Chinese version) under
 * it, the privacy policy at /privacy/ and the support page at /support/. public/ adds the root
 * files (robots.txt, llms.txt, the IndexNow key, the favicons, _headers), and the build writes sitemap.xml.
 *
 * On awardgrid.dowhiz.com the Worker `awardgrid-site` serves /ios/, /privacy/, /support/ and /_site/ from this build,
 * and "/" and each root file by an exact route; every other path is the web app's (DEPLOY.md, wrangler.jsonc). So the
 * built CSS goes under _site/, not Vite's default assets/, and every page links it relatively.
 *
 * `root` and `publicDir` are this directory and its own public/, whichever directory the build starts in. Vite's
 * defaults are the working directory and its public/, and the repo root's public/ belongs to the Next.js web app: a
 * build started from the repo root must never copy it into this site.
 */
export default defineConfig({
  root: here,
  publicDir: path.join(here, "public"),
  base: "./",
  plugins: [supportEmail(), stripComments(), sitemap()],
  build: {
    outDir: "dist",
    cssMinify: true,
    assetsDir: "_site",
    rolldownOptions: {
      input: pageInputs(),
    },
  },
});
