/**
 * What crawlers, search engines and answer engines get from the site, beyond the pages' text: the page manifest
 * (pages.json) and the sitemap built from it, the files the build copies from public/ (robots.txt, llms.txt, the
 * IndexNow key, the favicons, _headers), the Worker's routes for them, and each page's head tags and JSON-LD.
 *
 * The site is built with Vite's JS API into a fresh temp directory, never into sites/landing/dist (only one build at a
 * time may write dist/). Nothing here touches the network.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config, { type Manifest, isDate, localDate, manifestProblems, readManifest, siteOrigin, sitemapXml } from "../vite.config";

const SITE = path.join(import.meta.dirname, "..");
const REPO = path.join(SITE, "..", "..");
const PUBLIC = path.join(SITE, "public");
const CONFIG_FILE = path.join(SITE, "vite.config.ts");
const MANIFEST = readManifest();
const ORIGIN = "https://awardgrid.dowhiz.com";
const TODAY = localDate();
const REGISTRY = JSON.parse(readFileSync(path.join(REPO, "growth", "product-facts.json"), "utf8"));
const claim = (id: string) => REGISTRY.claims.find((c: { claim_id: string }) => c.claim_id === id);
const KEY = MANIFEST.indexnow_key;
/**
 * The files at the site's root that each need an exact Worker route: everything in public/ except _headers (which
 * Cloudflare reads and does not serve). A file added to public/ (a search console's verification file) needs its route.
 */
const ROOT_FILES = listFiles(PUBLIC).filter((file) => file !== "_headers");
/**
 * The exact routes a root file needs. The Worker's html_handling (auto-trailing-slash) answers `/name.html` with a
 * 307 to `/name`, so an HTML file there (Google's `google<token>.html`) also needs the route of `/name`
 * (DEPLOY.md, "Search-console verification").
 */
const routesFor = (file: string) => (file.endsWith(".html") ? [file, file.slice(0, -".html".length)] : [file]);
/** Every exact route: the home page, each root file's, and the sitemap the build writes. */
const EXACT_ROUTES = ["", ...ROOT_FILES.flatMap(routesFor), "sitemap.xml"].map((f) => `awardgrid.dowhiz.com/${f}`).sort();
/** The site graph every page that carries JSON-LD before release carries: the organization and the website. */
const SITE_GRAPH = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${ORIGIN}/#org`, name: "Curastone CORP." },
    { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "AwardGrid", url: `${ORIGIN}/`, publisher: { "@id": `${ORIGIN}/#org` } },
  ],
};

/** The Worker's own address, which serves every file of the build (the hostname serves only what a route claims). */
const WORKERS_DEV_ORIGIN = "https://awardgrid-site.logan-yegaoyang.workers.dev";
/**
 * The widest meta description a search result shows whole, in the width of a Latin character: Google cuts a snippet
 * at about 155-160 of them on desktop, and a CJK character takes about two. Past it, the end of the sentence (on
 * these pages, the prerequisite) is what a searcher never sees.
 */
const DESCRIPTION_MAX = 155;
const displayWidth = (text: string) => [...text].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0);

/** Every file under `dir`, as a relative path with forward slashes. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/** Every index.html of the site's source, found by walking it (build output, dependencies and public/ aside). */
function sourcePages(dir = SITE, rel = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return ["dist", "node_modules", "public", "test", "scripts"].includes(entry.name) || entry.name.startsWith(".") ? [] : sourcePages(path.join(dir, entry.name), child);
      }
      return entry.isFile() && entry.name === "index.html" ? [child] : [];
    })
    .sort();
}

/** The value of each attribute in an opening tag's attribute text, first one wins (as in a browser). */
function attributes(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of text.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1]!.toLowerCase();
    if (!found.has(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return found;
}

/** A page's <head>, comments removed. */
const headOf = (html: string) => (/<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? "");
/** Every <tag> of `name` in `markup`, as attribute maps. */
const tags = (markup: string, name: string) => [...markup.matchAll(new RegExp(`<${name}\\b((?:[^'">]|"[^"]*"|'[^']*')*)>`, "gi"))].map((m) => attributes(m[1] ?? ""));
const metas = (head: string, key: "name" | "property", value: string) => tags(head, "meta").filter((a) => a.get(key) === value).map((a) => a.get("content"));
const links = (head: string, rel: string) => tags(head, "link").filter((a) => (a.get("rel") ?? "").toLowerCase().split(/\s+/).includes(rel));
const titleOf = (head: string) => /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.replace(/\s+/g, " ").trim();
/** Every JSON-LD block of a page, parsed. */
const jsonLd = (html: string) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((m) => attributes(m[1] ?? "").get("type")?.trim().toLowerCase() === "application/ld+json")
    .map((m) => JSON.parse(m[2] ?? ""));
/** Every @type in a JSON-LD value, however deep. */
const typesIn = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(typesIn);
  if (value && typeof value === "object") {
    const own = [(value as Record<string, unknown>)["@type"]].flat().filter((t): t is string => typeof t === "string");
    return [...own, ...Object.values(value).flatMap(typesIn)];
  }
  return [];
};

/**
 * The head tags a page must carry, checked against its URL: a canonical link to itself on the hostname, og:url the
 * same, og:type website, og:title its title, og:description its meta description, twitter:card summary, and the two
 * favicons (an href that resolves, from the page, to /favicon.svg and /favicon.ico). No og:image yet, no Smart App
 * Banner before release. Returns what is wrong.
 */
function headProblems(html: string, pagePath: string): string[] {
  const head = headOf(html);
  const out: string[] = [];
  const url = ORIGIN + pagePath;
  const one = (label: string, values: Array<string | undefined>, want: string | undefined) => {
    if (values.length !== 1) out.push(`${label}: ${values.length} found, want 1`);
    else if (values[0] !== want) out.push(`${label}: ${JSON.stringify(values[0])}, want ${JSON.stringify(want)}`);
  };
  one("canonical", links(head, "canonical").map((a) => a.get("href")), url);
  one("og:url", metas(head, "property", "og:url"), url);
  one("og:type", metas(head, "property", "og:type"), "website");
  const title = titleOf(head);
  if (!title) out.push("no <title>");
  one("og:title", metas(head, "property", "og:title"), title);
  const description = metas(head, "name", "description");
  if (description.length !== 1 || !description[0]) out.push("needs exactly one meta description");
  else if (displayWidth(description[0]) > DESCRIPTION_MAX) out.push(`meta description: ${displayWidth(description[0])} wide, want at most ${DESCRIPTION_MAX} (a search result cuts the rest)`);
  one("og:description", metas(head, "property", "og:description"), description[0]);
  one("twitter:card", metas(head, "name", "twitter:card"), "summary");
  const icons = links(head, "icon").map((a) => ({ href: new URL(a.get("href") ?? "", url).href, type: a.get("type"), sizes: a.get("sizes") }));
  expectIcon(icons, `${ORIGIN}/favicon.svg`, (i) => i.type === "image/svg+xml", out);
  expectIcon(icons, `${ORIGIN}/favicon.ico`, (i) => i.sizes === "32x32", out);
  if (icons.length !== 2) out.push(`${icons.length} icon links, want 2`);
  for (const property of ["og:image", "twitter:image"]) if (metas(head, "property", property).length || metas(head, "name", property).length) out.push(`${property}: none yet`);
  if (/apple-itunes-app/i.test(head)) out.push("apple-itunes-app: only once the app is released");
  return out;
}

function expectIcon(icons: Array<{ href: string; type?: string; sizes?: string }>, href: string, ok: (i: { type?: string; sizes?: string }) => boolean, out: string[]) {
  const found = icons.filter((i) => i.href === href);
  if (found.length !== 1 || !ok(found[0]!)) out.push(`icon ${href}: ${JSON.stringify(found)}`);
}

/** Runs `fn` with AWARDGRID_SUPPORT_EMAIL set, and puts the old value back. */
async function withSupportEmail<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.AWARDGRID_SUPPORT_EMAIL;
  process.env.AWARDGRID_SUPPORT_EMAIL = "support@example.com";
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.AWARDGRID_SUPPORT_EMAIL;
    else process.env.AWARDGRID_SUPPORT_EMAIL = before;
  }
}

let out = "";
let built: string[] = [];
const read = (file: string) => readFileSync(path.join(out, file), "utf8");

beforeAll(async () => {
  out = mkdtempSync(path.join(os.tmpdir(), "awardgrid-crawl-"));
  await withSupportEmail(() => build({ configFile: CONFIG_FILE, logLevel: "silent", build: { outDir: out, emptyOutDir: true } }));
  built = listFiles(out);
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("pages.json, the page manifest", () => {
  it("is well formed: paths, files that exist, lastmod dates that are real and not later than today, the key", () => {
    expect(siteOrigin(MANIFEST)).toBe(ORIGIN);
    expect(manifestProblems(MANIFEST, TODAY)).toEqual([]);
    expect(MANIFEST.pages.map((p) => p.path)).toEqual(["/", "/ios/", "/ios/award-grid/", "/ios/zh-hans/", "/privacy/", "/support/"]);
  });

  it("lists every page of the site's source, and the build's inputs are exactly its pages", () => {
    expect(MANIFEST.pages.map((p) => p.file).sort()).toEqual(sourcePages());
    const input = config.build?.rolldownOptions?.input as Record<string, string>;
    expect(Object.values(input).sort()).toEqual(MANIFEST.pages.map((p) => path.join(SITE, p.file)).sort());
  });

  it("refuses what would make a wrong sitemap", () => {
    const base: Manifest = JSON.parse(JSON.stringify(MANIFEST));
    const problems = (change: (m: Manifest) => void) => {
      const m: Manifest = JSON.parse(JSON.stringify(base));
      change(m);
      return manifestProblems(m, "2026-09-28").join("\n");
    };
    expect(problems(() => {})).toBe("");
    expect(problems((m) => (m.pages[1]!.lastmod = "2026-09-29"))).toMatch(/later than the build date 2026-09-28/);
    expect(problems((m) => (m.pages[1]!.lastmod = "2026-02-30"))).toMatch(/is not a YYYY-MM-DD date/);
    expect(problems((m) => (m.pages[1]!.lastmod = "28/09/2026"))).toMatch(/is not a YYYY-MM-DD date/);
    expect(problems((m) => m.pages.push({ ...m.pages[1]! }))).toMatch(/listed twice/);
    expect(problems((m) => (m.pages[1]!.path = "/ios"))).toMatch(/must start and end with "\/"/);
    expect(problems((m) => (m.pages[1]!.file = "support/index.html"))).toMatch(/file must be ios\/index.html/);
    expect(problems((m) => m.pages.push({ path: "/gone/", file: "gone/index.html", lastmod: "2026-09-01" }))).toMatch(/gone\/index.html does not exist/);
    expect(problems((m) => (m.host = "https://awardgrid.dowhiz.com/"))).toMatch(/not a plain hostname/);
    expect(problems((m) => (m.indexnow_key = "not-a-key"))).toMatch(/indexnow_key must be/);
    expect(problems((m) => (m.indexnow_key = "0123456789abcdef0123456789abcdef"))).toMatch(/public\/0123456789abcdef0123456789abcdef.txt does not exist/);
  });

  it("reads dates strictly", () => {
    expect(isDate("2026-09-28")).toBe(true);
    expect(isDate("2024-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-9-28")).toBe(false);
    expect(localDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("sitemap.xml", () => {
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const lastmods = (xml: string) => [...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);

  it("is written by the build from the manifest, one <url> per page with its lastmod", () => {
    const xml = read("sitemap.xml");
    expect(xml).toBe(sitemapXml(MANIFEST));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(MANIFEST.pages.length);
    expect(locs(xml)).toEqual(MANIFEST.pages.map((p) => ORIGIN + p.path));
    expect(lastmods(xml)).toEqual(MANIFEST.pages.map((p) => p.lastmod));
  });

  it("has only real dates, none later than today", () => {
    const dates = lastmods(read("sitemap.xml"));
    expect(dates.length).toBe(MANIFEST.pages.length);
    for (const date of dates) {
      expect(isDate(date!), date).toBe(true);
      expect(date! <= TODAY, `${date} is later than ${TODAY}`).toBe(true);
    }
  });

  it("lists every page the build made, and the build made every page it lists", () => {
    const fromPublic = new Set(listFiles(PUBLIC));
    const builtPages = built.filter((file) => file.endsWith(".html") && !fromPublic.has(file));
    const listed = locs(read("sitemap.xml")).map((loc) => `${new URL(loc!).pathname.slice(1)}index.html`);
    expect(builtPages.sort()).toEqual([...listed].sort());
  });

  it("escapes what XML needs escaped", () => {
    const xml = sitemapXml({ host: "awardgrid.dowhiz.com", pages: [{ path: "/a&b/", file: "x", lastmod: "2026-09-01" }], indexnow_key: KEY });
    expect(xml).toContain(`<loc>${ORIGIN}/a&amp;b/</loc>`);
  });
});

describe("the built site's files", () => {
  it("are exactly public/'s files, the manifest's pages, the stylesheet under _site/ and sitemap.xml", () => {
    const styles = built.filter((file) => file.startsWith("_site/"));
    expect(styles.length).toBe(1);
    expect(styles[0]).toMatch(/^_site\/styles-[\w-]+\.css$/);
    const expected = [...listFiles(PUBLIC), ...MANIFEST.pages.map((p) => p.file), ...styles, "sitemap.xml"].sort();
    expect(built).toEqual(expected);
  });

  it("copy public/ byte for byte (robots.txt is what the live check compares with)", () => {
    for (const file of listFiles(PUBLIC)) expect(readFileSync(path.join(out, file)).equals(readFileSync(path.join(PUBLIC, file))), file).toBe(true);
  });

  it("include every root file the Worker has an exact route for", () => {
    expect(ROOT_FILES).toEqual(expect.arrayContaining(["robots.txt", "llms.txt", `${KEY}.txt`, "favicon.ico", "favicon.svg"]));
    expect(ROOT_FILES.filter((file) => file.includes("/"))).toEqual([]);
    expect(built).toEqual(expect.arrayContaining([...ROOT_FILES, "sitemap.xml", "_headers", "index.html"]));
  });
});

describe("head tags", () => {
  it.each(MANIFEST.pages.map((p) => [p.path, p.file] as const))("%s: in the source", (pagePath, file) => {
    const html = readFileSync(path.join(SITE, file), "utf8");
    expect(headProblems(html, pagePath)).toEqual([]);
    // Same-origin, absolute: the Worker serves both files on the hostname and on workers.dev.
    const icons = links(headOf(html), "icon").map((a) => a.get("href"));
    expect(icons.sort()).toEqual(["/favicon.ico", "/favicon.svg"]);
  });

  it.each(MANIFEST.pages.map((p) => [p.path, p.file] as const))("%s: in the built page", (pagePath, file) => {
    expect(headProblems(read(file), pagePath)).toEqual([]);
  });

  it("catches a wrong or missing tag (the check above is not vacuous)", () => {
    const good = readFileSync(path.join(SITE, "support", "index.html"), "utf8");
    expect(headProblems(good, "/ios/").join("\n")).toMatch(/canonical/);
    expect(headProblems(good.replace(/<meta name="twitter:card"[^>]*>/, ""), "/support/").join("\n")).toMatch(/twitter:card: 0 found/);
    expect(headProblems(good.replace('content="summary"', 'content="summary_large_image"'), "/support/").join("\n")).toMatch(/twitter:card/);
    expect(headProblems(good.replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="website" /><meta property="og:image" content="x.png" />'), "/support/").join("\n")).toMatch(/og:image/);
    expect(headProblems(good.replace('href="/favicon.svg"', 'href="favicon.svg"'), "/support/").join("\n")).toMatch(/favicon.svg/);
    const long = "Help for the AwardGrid iPhone app. ".repeat(5).trim();
    expect(headProblems(good.replace(/content="Help for the AwardGrid[^"]*"/g, `content="${long}"`), "/support/").join("\n")).toMatch(/meta description: 174 wide, want at most 155/);
    expect(displayWidth("一张表 AB")).toBe(9);
  });
});

describe("JSON-LD", () => {
  const fileOf = (pagePath: string) => MANIFEST.pages.find((p) => p.path === pagePath)!.file;
  /** A page shows questions when it has a section in the FAQ convention (scripts/growth/sync-faq-schema.mjs). */
  const showsQuestions = (html: string) => /<section\b[^>]*\sdata-faq\b/i.test(html.replace(/<!--[\s\S]*?-->/g, ""));

  it.each(["/", "/ios/award-grid/"])("%s carries the organization and the website, and nothing else", (pagePath) => {
    for (const html of [readFileSync(path.join(SITE, fileOf(pagePath)), "utf8"), read(fileOf(pagePath))]) {
      expect(jsonLd(html)).toEqual([SITE_GRAPH]);
    }
  });

  it.each(["/ios/", "/ios/zh-hans/"])("%s carries the organization, the website and the FAQPage of its questions", (pagePath) => {
    for (const html of [readFileSync(path.join(SITE, fileOf(pagePath)), "utf8"), read(fileOf(pagePath))]) {
      expect(showsQuestions(html)).toBe(true);
      const blocks = jsonLd(html);
      expect(blocks).toHaveLength(1);
      const graph = blocks[0]["@graph"] as Array<Record<string, unknown>>;
      expect({ "@context": blocks[0]["@context"], "@graph": graph.slice(0, 2) }).toEqual(SITE_GRAPH);
      expect(graph.slice(2).map((node) => node["@type"])).toEqual(["FAQPage"]);
      expect(graph[2]!["@id"]).toBe(`${ORIGIN}${pagePath}#faq`);
      expect((graph[2]!.mainEntity as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("FAQPage only where the page shows its questions, and no MobileApplication (the app is not released)", () => {
    const types = MANIFEST.pages.flatMap((p) => jsonLd(read(p.file)).flatMap(typesIn));
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["Organization", "WebSite", "FAQPage", "Question", "Answer"]));
    for (const p of MANIFEST.pages) {
      const html = read(p.file);
      expect(jsonLd(html).flatMap(typesIn).includes("FAQPage"), p.path).toBe(showsQuestions(html));
    }
  });

  it("no JSON-LD block has a src", () => {
    for (const p of MANIFEST.pages) {
      const scripts = [...read(p.file).matchAll(/<script\b([^>]*)>/gi)].map((m) => attributes(m[1] ?? ""));
      expect(scripts.filter((a) => a.has("src")), p.file).toEqual([]);
    }
  });
});

describe("hreflang", () => {
  /** The alternates a page names: hreflang → absolute URL, in its order. */
  const alternates = (html: string) =>
    links(headOf(html), "alternate")
      .filter((a) => a.has("hreflang"))
      .map((a) => [a.get("hreflang"), a.get("href")]);
  /** The English page and its Simplified Chinese version name each other, and the English page is the default. */
  const PAIR = [
    ["en", `${ORIGIN}/ios/`],
    ["zh-Hans", `${ORIGIN}/ios/zh-hans/`],
    ["x-default", `${ORIGIN}/ios/`],
  ];

  it.each(["/ios/", "/ios/zh-hans/"])("%s names both versions and the default, in the source and the built page", (pagePath) => {
    const file = MANIFEST.pages.find((p) => p.path === pagePath)!.file;
    for (const html of [readFileSync(path.join(SITE, file), "utf8"), read(file)]) expect(alternates(html)).toEqual(PAIR);
  });

  it("gives each version the language it names: <html lang>", () => {
    const lang = (file: string) => /<html\b[^>]*\blang="([^"]+)"/i.exec(read(file))?.[1];
    expect(lang("ios/index.html")).toBe("en");
    expect(lang("ios/zh-hans/index.html")).toBe("zh-Hans");
  });

  it("no other page names alternates: each has one version (/privacy/ and /support/ hold their Chinese on the same page)", () => {
    const others = MANIFEST.pages.filter((p) => !["/ios/", "/ios/zh-hans/"].includes(p.path));
    for (const p of others) expect(alternates(read(p.file)), p.path).toEqual([]);
  });
});

describe("the home page", () => {
  const html = readFileSync(path.join(SITE, "index.html"), "utf8");
  const text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hrefs = tags(html.replace(/<!--[\s\S]*?-->/g, ""), "a").map((a) => a.get("href"));

  it("links the three pages relatively, so it works on the hostname and on workers.dev; into the web app only /grid, no log-in link", () => {
    // "/" is the Worker's now, so the web app's home no longer redirects its signed-in users to /grid: the home page
    // gives them that link (absolute, so it also works from the workers.dev copy). /grid sends a signed-out visitor to /login.
    expect(hrefs).toEqual(["./ios/", "./privacy/", "./support/", "https://awardgrid.dowhiz.com/grid", "https://seats.aero"]);
    expect(html).not.toMatch(/\/(?:login|register)\b/);
    expect(text.replace(/\s+([.,;])/g, "$1")).toContain(`Web app users: open the grid.`);
    expect(claim("webapp_note").allowed_copy_extra).toEqual(["Web app users: open the grid."]);
  });

  it("says the registry's words: the status for the current status, the web app note as plain text, the affiliation", () => {
    expect(text).toContain(claim("release_status").allowed_copy_by_status[REGISTRY.released.status]);
    expect(text).toContain(claim("webapp_note").allowed_copy_variants.kept_named_host);
    expect(text).toContain(claim("affiliation").allowed_copy);
    expect(text).toContain(claim("grid").allowed_copy_extra[0]);
    expect(html).toMatch(/Data: <a href="https:\/\/seats\.aero">seats\.aero<\/a>/);
  });
});

describe("links between the pages", () => {
  // wrangler.jsonc's comments are whole lines; JSON.parse reads the rest.
  const routes: string[] = JSON.parse(readFileSync(path.join(SITE, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "")).routes.map(
    (r: { pattern: string }) => r.pattern.slice("awardgrid.dowhiz.com".length),
  );
  /** The home page's one link into the web app (its users lost the "/" → /grid redirect when the Worker took "/"). */
  const WEB_APP_LINKS = new Set(["https://awardgrid.dowhiz.com/grid"]);
  /** Whether a route sends this path to the Worker on the hostname: a prefix route (`/ios*`) or an exact one. */
  const routed = (pathname: string) => routes.some((r) => (r.endsWith("*") ? pathname.startsWith(r.slice(0, -1)) : pathname === r));
  const idsOf = (html: string) => new Set([...html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3]));

  /**
   * What is wrong with a built page's links, on the hostname and on workers.dev. Each <a href> and <link href> that
   * stays on the origin the page is served from must name a file of the build (a path ending in "/" serves its
   * index.html) that the Worker answers there (on the hostname a route must claim the path; workers.dev serves every
   * file), and a #fragment must be an id on the page it points to. No <a href> names the hostname itself: on
   * workers.dev it would leave for the hostname. (canonical and hreflang are absolute on purpose.) The one exception is
   * WEB_APP_LINKS: the home page's link into the web app, absolute on purpose, to a path no Worker route claims.
   */
  function linkProblems(pagePath: string, html: string, files: Set<string>, htmlOf: (file: string) => string): string[] {
    const out: string[] = [];
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
    const refs = [...tags(markup, "a").map((a) => ["a", a.get("href")] as const), ...tags(markup, "link").map((a) => ["link", a.get("href")] as const)];
    for (const [tag, href] of refs) {
      if (href === undefined || /^(?:mailto|tel):/i.test(href)) continue;
      if (tag === "a" && WEB_APP_LINKS.has(href)) {
        if (pagePath !== "/") out.push(`${pagePath}: the web app link ${href} belongs on the home page only`);
        if (routed(new URL(href).pathname)) out.push(`${pagePath}: ${href} is claimed by a Worker route, so it is not the web app's`);
        continue;
      }
      if (tag === "a" && /^(?:https?:)?\/\/awardgrid\.dowhiz\.com(?:[/?#]|$)/i.test(href)) out.push(`${pagePath}: <a href="${href}"> names the hostname, so it leaves workers.dev`);
      for (const origin of [ORIGIN, WORKERS_DEV_ORIGIN]) {
        const url = new URL(href, origin + pagePath);
        if (url.origin !== origin) continue;
        const pathname = decodeURIComponent(url.pathname);
        const file = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
        if (!files.has(file)) out.push(`${pagePath}: ${href} on ${origin} is ${pathname}, which the build does not have`);
        else if (origin === ORIGIN && !routed(pathname)) out.push(`${pagePath}: ${href} is ${pathname}, which no Worker route claims on the hostname`);
        else if (url.hash && !idsOf(htmlOf(file)).has(decodeURIComponent(url.hash.slice(1)))) out.push(`${pagePath}: ${href} names #${url.hash.slice(1)}, which ${pathname} does not have`);
      }
    }
    return out;
  }

  it.each(MANIFEST.pages.map((p) => [p.path, p.file] as const))("%s: every same-site link of the built page resolves, on the hostname and on workers.dev", (pagePath, file) => {
    const html = read(file);
    expect(linkProblems(pagePath, html, new Set(built), read)).toEqual([]);
    expect(tags(html, "a").length, "the page links somewhere").toBeGreaterThan(0);
  });

  it("catches a link that goes nowhere (the check above is not vacuous)", () => {
    const files = new Set(built);
    const problems = (anchor: string) => linkProblems("/ios/award-grid/", `<main>${anchor}</main>`, files, read).join("\n");
    expect(problems('<a href="../support/">x</a>')).toMatch(/\/ios\/support\/, which the build does not have/);
    expect(problems('<a href="../../privacy/#nope">x</a>')).toMatch(/names #nope/);
    expect(problems('<a href="https://awardgrid.dowhiz.com/support/">x</a>')).toMatch(/names the hostname/);
    expect(problems('<a href="../../sitemap.xml">x</a>')).toBe("");
    expect(problems('<a href="../../support/">x</a> <a href="../../privacy/#zh">x</a> <a href="https://seats.aero">x</a>')).toBe("");
  });
});

describe("robots.txt", () => {
  const robots = readFileSync(path.join(PUBLIC, "robots.txt"), "utf8");
  const lines = robots.split("\n");
  const disallowed = lines.filter((l) => /^Disallow:/i.test(l)).map((l) => l.replace(/^Disallow:\s*/i, "").trim());

  it("has one group for every crawler, the web app's API and grid disallowed, and the sitemap", () => {
    expect(lines.filter((l) => /^User-agent:/i.test(l))).toEqual(["User-agent: *"]);
    expect(disallowed).toEqual(["/api/", "/grid"]);
    expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots.endsWith("\n")).toBe(true);
  });

  it("blocks no page, no root file, and not /login or /register (their noindex has to stay visible to crawlers)", () => {
    const paths = [...MANIFEST.pages.map((p) => p.path), ...ROOT_FILES.map((f) => `/${f}`), "/sitemap.xml", "/login", "/register"];
    expect(paths.filter((p) => disallowed.some((rule) => rule !== "" && p.startsWith(rule)))).toEqual([]);
  });

  it("lists exactly the manifest's pages in its comment", () => {
    const listed = /^# Public pages: (.*) \(static files\)\.$/m.exec(robots)?.[1]?.split(", ");
    expect(listed).toEqual(MANIFEST.pages.map((p) => p.path));
  });

  it("has comments only as robots comments, with the web app note", () => {
    expect(robots).not.toContain("<!--");
    expect(lines.filter((l) => l && !/^(?:#|User-agent:|Disallow:|Sitemap:)/.test(l))).toEqual([]);
    expect(robots).toContain(`# ${claim("webapp_note").allowed_copy_variants.kept_named_host}`);
  });
});

describe("llms.txt", () => {
  const llms = readFileSync(path.join(PUBLIC, "llms.txt"), "utf8");

  it("is an llms.txt: a title, a summary, and links to the pages on the hostname", () => {
    expect(llms.startsWith("# AwardGrid\n\n> ")).toBe(true);
    const linked = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]!));
    expect(linked.length).toBeGreaterThan(0);
    for (const url of linked) {
      expect(url.origin).toBe(ORIGIN);
      expect(MANIFEST.pages.map((p) => p.path)).toContain(url.pathname);
    }
  });

  it("gives the date its facts were checked: a real date, not before the registry's check and not after today", () => {
    const checked = /^## Facts \(checked (\d{4}-\d{2}-\d{2})\)$/m.exec(llms)?.[1];
    expect(checked && isDate(checked)).toBe(true);
    expect(checked! >= REGISTRY.released.checked_at).toBe(true);
    expect(checked! <= TODAY).toBe(true);
  });

  it("names the app and the web app in the registry's words", () => {
    expect(llms).toContain(claim("webapp_note").allowed_copy_variants.kept_named_host);
    expect(llms).not.toContain(claim("webapp_note").allowed_copy_variants.kept_host);
    for (const sentence of claim("identity").allowed_copy_extra) expect(llms).toContain(sentence);
    expect(llms).toContain(claim("affiliation").allowed_copy);
  });

  it("says the domain awardgrid.com is not Curastone CORP.'s, in the registry's words (approved 2026-09-28)", () => {
    const domain = claim("domain_collision");
    expect(domain.public_use).toBe("approved");
    expect(llms).toContain(domain.allowed_copy);
    expect(llms.match(/awardgrid\.com/g)).toHaveLength(1);
  });

  it("is not linked from any page", () => {
    for (const p of MANIFEST.pages) expect(read(p.file), p.file).not.toMatch(/llms\.txt/);
  });
});

describe("the IndexNow key", () => {
  it("is one file in public/, named by pages.json's indexnow_key, holding the key and nothing else", () => {
    const keyFiles = listFiles(PUBLIC).filter((file) => /^[0-9a-f]{32}\.txt$/.test(file));
    expect(keyFiles).toEqual([`${KEY}.txt`]);
    expect(readFileSync(path.join(PUBLIC, `${KEY}.txt`), "utf8")).toBe(KEY);
  });
});

describe("the favicons", () => {
  it("are what sites/landing/scripts/favicon.mjs draws", () => {
    const run = spawnSync(process.execPath, [path.join(SITE, "scripts", "favicon.mjs"), "--check"], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
  });

  it("the SVG is plain shapes: no script, no event handler, no external reference", () => {
    const svg = readFileSync(path.join(PUBLIC, "favicon.svg"), "utf8");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<script|\son[a-z]+\s*=|href\s*=|<foreignObject|<image|url\((?!#)/i);
  });

  it("the ICO holds one 32×32, 32-bit image", () => {
    const ico = readFileSync(path.join(PUBLIC, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7], ico.readUInt16LE(12)]).toEqual([32, 32, 32]);
    expect(ico.readUInt32LE(18) + ico.readUInt32LE(14)).toBe(ico.length);
  });
});

describe("_headers", () => {
  const rules = new Map<string, string[]>();
  let current = "";
  for (const line of readFileSync(path.join(PUBLIC, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.set((current = line.trim()), []);
    else rules.get(current)!.push(line.trim());
  }

  it("gives every response HSTS for a year (no includeSubDomains, no preload) and nosniff", () => {
    expect(rules.get("/*")).toEqual(["Strict-Transport-Security: max-age=31536000", "X-Content-Type-Options: nosniff"]);
  });

  it("caches the hashed stylesheet for good, and keeps the workers.dev address out of search results", () => {
    expect(rules.get("/_site/*")).toEqual(["Cache-Control: public, max-age=31536000, immutable"]);
    expect(rules.get("https://awardgrid-site.logan-yegaoyang.workers.dev/*")).toEqual(["X-Robots-Tag: noindex"]);
    expect([...rules.keys()]).toHaveLength(3);
  });
});

describe("wrangler.jsonc routes", () => {
  // wrangler.jsonc's comments are whole lines; JSON.parse reads the rest.
  const wrangler = JSON.parse(readFileSync(path.join(SITE, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const routes: Array<{ pattern: string; zone_name: string }> = wrangler.routes;
  const patterns = routes.map((r) => r.pattern);

  it("puts every route on the dowhiz.com zone and the awardgrid hostname", () => {
    expect(routes.filter((r) => r.zone_name !== "dowhiz.com" || !r.pattern.startsWith("awardgrid.dowhiz.com/"))).toEqual([]);
  });

  it("keeps the prefix routes of the pages and the stylesheet", () => {
    expect(patterns).toEqual(expect.arrayContaining(["ios*", "privacy*", "support*", "_site/*"].map((p) => `awardgrid.dowhiz.com/${p}`)));
  });

  it("serves the home page and each root file by an exact route, with no wildcard (so /?… stays the web app's)", () => {
    const exact = patterns.filter((p) => !p.includes("*"));
    expect(exact.sort()).toEqual(EXACT_ROUTES);
  });

  it("gives an HTML root file the route of its extensionless path too, where auto-trailing-slash redirects it", () => {
    expect(routesFor("google0123456789abcdef.html")).toEqual(["google0123456789abcdef.html", "google0123456789abcdef"]);
    expect(routesFor("BingSiteAuth.xml")).toEqual(["BingSiteAuth.xml"]);
    expect(routesFor("robots.txt")).toEqual(["robots.txt"]);
  });

  it("routes nothing else: every route is a page of the manifest, the stylesheet, or a root file", () => {
    expect(patterns).toHaveLength(4 + EXACT_ROUTES.length);
    const prefixes = patterns.filter((p) => p.endsWith("*")).map((p) => p.slice("awardgrid.dowhiz.com".length, -1));
    for (const page of MANIFEST.pages.filter((p) => p.path !== "/")) expect(prefixes.some((prefix) => page.path.startsWith(prefix)), page.path).toBe(true);
  });

  it("are the routes DEPLOY.md's table lists, so the runbook the owner follows cannot miss one", () => {
    const deploy = readFileSync(path.join(SITE, "DEPLOY.md"), "utf8");
    const table = [...deploy.matchAll(/^\| `(awardgrid\.dowhiz\.com\/[^`]*)` \|/gm)].map((m) => m[1]);
    expect([...table].sort()).toEqual([...patterns].sort());
  });

  it("serves the built site as assets only, with the workers.dev address on", () => {
    expect(wrangler.assets).toEqual({ directory: "./dist", html_handling: "auto-trailing-slash", not_found_handling: "none" });
    expect(wrangler.main).toBeUndefined();
    expect(wrangler.workers_dev).toBe(true);
  });
});
