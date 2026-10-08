/**
 * verify-live.mjs against this branch's own build, served by the retained rollback assets Worker: so the checks the owner
 * runs after the deploy pass on a correct deploy of exactly these files, and a mismatch between the script and the
 * pages, the manifest, public/, _headers or the routes shows up here instead of on the day.
 *
 * The site is built with Vite's JS API into a fresh temp directory, never into sites/landing/dist (only one build at a
 * time may write dist/). Nothing reaches the network: a fake zone answers every request.
 *
 *   - Routing follows wrangler.jsonc as Cloudflare matches routes: a pattern ending in "*" matches every URL that
 *     starts with it, query string included; any other pattern matches only that URL, with no query string. A URL no
 *     route matches goes to the web app, which answers as recorded on 2026-09-28 (fixtures/verify-live/before/).
 *   - The Worker serves the build as static assets (html_handling auto-trailing-slash, not_found_handling none) with
 *     the headers of the built _headers file, whose patterns match a path or, when absolute, the whole URL.
 *   - On awardgrid.dowhiz.com, Cloudflare Web Analytics adds its beacon to every HTML response (as recorded, token
 *     redacted), and http:// answers with a 301 to https:// (the redirect rule the owner adds).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSite, verifyLive, type Report } from "../scripts/verify-live.mjs";

const SITE = path.join(import.meta.dirname, "..");
const FIXTURES = path.join(import.meta.dirname, "fixtures", "verify-live");
const HOST = "awardgrid.dowhiz.com";
// This fake zone models the retained assets Worker and its legacy _headers, not the active proxy.
const loadRollbackSite = () => ({ ...loadSite(), workersDev: "awardgrid-site.logan-yegaoyang.workers.dev" });
const BEACON = readFileSync(path.join(FIXTURES, "beacon.html"), "utf8");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

interface Recorded {
  status: number;
  headers: Record<string, string>;
  body_file: string;
}

/** Cloudflare's route matching: a trailing "*" is a prefix match (query string included), anything else exact. */
function routeMatches(pattern: string, url: URL): boolean {
  const target = `${url.host}${url.pathname}${url.search}`;
  return pattern.endsWith("*") ? target.startsWith(pattern.slice(0, -1)) : target === pattern;
}

/** The rules of a _headers file: a pattern at the start of a line, then its indented `Name: value` lines. */
function headerRules(text: string): { pattern: string; headers: Record<string, string> }[] {
  const rules: { pattern: string; headers: Record<string, string> }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
    else {
      const i = line.indexOf(":");
      const rule = rules.at(-1);
      if (rule && i > 0) rule.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

function headerRuleMatches(pattern: string, url: URL): boolean {
  const target = /^https?:\/\//.test(pattern) ? `${url.origin}${url.pathname}` : url.pathname;
  const re = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(target);
}

/** A fetch that answers as the zone would once the build in `outDir` is deployed with wrangler.jsonc's routes. */
function deployedFetch(outDir: string): typeof globalThis.fetch {
  const wrangler = JSON.parse(readFileSync(path.join(SITE, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "")) as { routes: { pattern: string }[] };
  const routes = wrangler.routes.map((r) => r.pattern);
  const rules = headerRules(readFileSync(path.join(outDir, "_headers"), "utf8"));
  const recordedDir = path.join(FIXTURES, "before");
  const recorded = (JSON.parse(readFileSync(path.join(recordedDir, "responses.json"), "utf8")) as { responses: Record<string, Recorded> }).responses;
  const notFound = recorded[`https://${HOST}/robots.txt`]!;

  const worker = (url: URL): { status: number; headers: Record<string, string>; body: Buffer } => {
    const file = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const full = path.join(outDir, file);
    const headers: Record<string, string> = {};
    for (const rule of rules) if (headerRuleMatches(rule.pattern, url)) Object.assign(headers, rule.headers);
    if (file.includes("..") || file === "/_headers" || !existsSync(full)) return { status: 404, headers, body: Buffer.from("") };
    headers["content-type"] = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    return { status: 200, headers, body: readFileSync(full) };
  };

  const webApp = (url: URL) => {
    const entry = recorded[url.href] ?? notFound;
    return { status: entry.status, headers: entry.headers, body: readFileSync(path.join(recordedDir, entry.body_file)) };
  };

  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.protocol === "http:") return new Response("", { status: 301, headers: { location: url.href.replace(/^http:/, "https:") } });
    const onHost = url.host === HOST;
    const served = !onHost || routes.some((pattern) => routeMatches(pattern, url)) ? worker(url) : webApp(url);
    let body: Buffer | string = served.body;
    if (onHost && /^text\/html\b/.test(served.headers["content-type"] ?? "")) body = body.toString().replace("</body>", `  ${BEACON}\n</body>`);
    return new Response(new Uint8Array(Buffer.from(body)), { status: served.status, headers: served.headers });
  }) as typeof globalThis.fetch;
}

const EMAIL = "support@example.com";
let outDir = "";

beforeAll(async () => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "verify-live-build-"));
  const before = process.env.AWARDGRID_SUPPORT_EMAIL;
  process.env.AWARDGRID_SUPPORT_EMAIL = EMAIL;
  try {
    await build({ configFile: path.join(SITE, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    if (before === undefined) delete process.env.AWARDGRID_SUPPORT_EMAIL;
    else process.env.AWARDGRID_SUPPORT_EMAIL = before;
  }
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const at = (report: Report, level: string) => report.results.flatMap((r) => r.checks.filter((c) => c.level === level).map((c) => `${r.url} ${c.id}: ${c.detail}`));

describe("verify-live on this build, deployed as wrangler.jsonc and _headers say", () => {
  it("passes after the deploy with no failure and no warning, the https redirect required", async () => {
    const report = await verifyLive({ site: loadRollbackSite(), mode: "after", expectHttpsRedirect: true, fetch: deployedFetch(outDir) });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("finds each page of the manifest served by the Worker with one beacon, and /?x=1 still the web app's", async () => {
    const site = loadRollbackSite();
    const report = await verifyLive({ site, mode: "after", fetch: deployedFetch(outDir) });
    const pages = report.results.filter((r) => r.kind === "home" || r.kind === "page");
    expect(pages.map((r) => r.path)).toEqual(site.paths);
    for (const r of pages) expect([r.url, r.served_by, r.beacons, r.comments, r.canonical]).toEqual([r.url, "worker", 1, 0, [r.url]]);
    expect(report.results.find((r) => r.path === "/?x=1")?.served_by).toBe("web-app");
  });

  it("in --before-deploy mode, fails nothing and warns only that the deploy's changes are already live", async () => {
    const report = await verifyLive({ site: loadRollbackSite(), mode: "before", fetch: deployedFetch(outDir) });
    expect(at(report, "fail")).toEqual([]);
    for (const line of at(report, "warn")) expect(line).toMatch(/already/);
  });
});

describe("the fake zone's routing (Cloudflare's matching, as wrangler.jsonc describes it)", () => {
  it.each([
    ["awardgrid.dowhiz.com/", "https://awardgrid.dowhiz.com/", true],
    ["awardgrid.dowhiz.com/", "https://awardgrid.dowhiz.com/?utm_source=x", false],
    ["awardgrid.dowhiz.com/", "https://awardgrid.dowhiz.com/login", false],
    ["awardgrid.dowhiz.com/robots.txt", "https://awardgrid.dowhiz.com/robots.txt?x", false],
    ["awardgrid.dowhiz.com/ios*", "https://awardgrid.dowhiz.com/ios/?ref=x", true],
    ["awardgrid.dowhiz.com/ios*", "https://awardgrid.dowhiz.com/iosx", true],
    ["awardgrid.dowhiz.com/ios*", "https://awardgrid.dowhiz.com/", false],
  ])("%s matches %s: %s", (pattern, url, expected) => {
    expect(routeMatches(pattern, new URL(url))).toBe(expected);
  });

  it("applies an absolute _headers pattern only to its own host", () => {
    const rules = headerRules("/*\n  A: 1\n\nhttps://x.workers.dev/*\n  X-Robots-Tag: noindex\n");
    expect(rules).toEqual([
      { pattern: "/*", headers: { a: "1" } },
      { pattern: "https://x.workers.dev/*", headers: { "x-robots-tag": "noindex" } },
    ]);
    expect(headerRuleMatches("https://x.workers.dev/*", new URL("https://x.workers.dev/ios/"))).toBe(true);
    expect(headerRuleMatches("https://x.workers.dev/*", new URL("https://awardgrid.dowhiz.com/ios/"))).toBe(false);
    expect(headerRuleMatches("/*", new URL("https://awardgrid.dowhiz.com/ios/"))).toBe(true);
    expect(headerRuleMatches("/_site/*", new URL("https://awardgrid.dowhiz.com/ios/"))).toBe(false);
  });
});
