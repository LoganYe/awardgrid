/**
 * sites/landing/scripts/verify-live.mjs, on recorded and synthetic responses. Nothing here reaches the network: every
 * request goes to `fixtureFetch`, which answers from test/fixtures/verify-live/, and under vitest the script refuses
 * the real fetch (tested below).
 *
 * Fixtures (test/fixtures/verify-live/; each responses.json says how it was made):
 *   before/  what awardgrid.dowhiz.com and the workers.dev address served on 2026-09-28 at 06:26Z, before the deploy,
 *            as recorded (beacon token and support address redacted; a few URLs not recorded that day stand in).
 *   after/   synthetic: the state expected after the deploy. Each failure case below changes one response of it.
 *   site/    a page manifest, robots.txt and IndexNow key, laid out as sites/landing/pages.json and public/.
 *   beacon.html  the Cloudflare Web Analytics beacon tag as recorded, token redacted; added to after/ host pages.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  REQUEST_HEADERS,
  analyzeHtml,
  canonicalLinks,
  classifyScripts,
  formatReport,
  isBeacon,
  isNoindex,
  attributes,
  jsonTargetProblem,
  loadSite,
  main,
  metaRobots,
  planProbes,
  servedBy,
  sitemapLocs,
  verifyLive,
  type Report,
} from "../scripts/verify-live.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "verify-live");
const SITE_DIR = path.join(FIXTURES, "site");
const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "verify-live.mjs");
const H = "https://awardgrid.dowhiz.com";
const W = "https://awardgrid-site.logan-yegaoyang.workers.dev";
const HTTP_LOGIN = "http://awardgrid.dowhiz.com/login";
const KEY = "0123456789abcdef0123456789abcdef";
const BEACON = readFileSync(path.join(FIXTURES, "beacon.html"), "utf8");
const NOW = () => new Date("2026-10-01T12:00:00.000Z");

const HOST_PAGES = [`${H}/`, `${H}/ios/`, `${H}/privacy/`, `${H}/support/`];
const WORKERS_DEV_PAGES = [`${W}/`, `${W}/ios/`];
const WEB_APP = [`${H}/login`, `${H}/register`, `${H}/legal`, `${H}/?x=1`];
const ROOT_FILES = ["/robots.txt", "/sitemap.xml", "/llms.txt", `/${KEY}.txt`, "/favicon.ico", "/favicon.svg"].map((p) => `${H}${p}`);
const ALL_URLS = [...HOST_PAGES, ...WORKERS_DEV_PAGES, ...WEB_APP, ...ROOT_FILES, HTTP_LOGIN];

interface Entry {
  status: number;
  headers: Record<string, string>;
  body?: string;
  body_file?: string;
  body_base64?: string;
  beacon?: boolean;
}
/** A response as the fake server is about to send it; a change may rewrite it, or make the request fail. */
interface Served {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}
type Change = (served: Served) => Served | "network-error";
interface Call {
  url: string;
  init: RequestInit | undefined;
}

/**
 * A fetch that answers from a fixture state: each responses.json entry, its body from a file, base64 or inline text,
 * with the beacon added before </body> where the entry says so (as Cloudflare does on awardgrid.dowhiz.com).
 */
function fixtureFetch(state: "before" | "after", changes: Record<string, Change> = {}) {
  const dir = path.join(FIXTURES, state);
  const { responses } = JSON.parse(readFileSync(path.join(dir, "responses.json"), "utf8")) as { responses: Record<string, Entry> };
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const entry = responses[url];
    if (!entry) throw new TypeError(`fetch failed (no fixture for ${url})`);
    let body: string | Buffer = entry.body_file
      ? readFileSync(path.join(dir, entry.body_file))
      : entry.body_base64
        ? Buffer.from(entry.body_base64, "base64")
        : (entry.body ?? "");
    if (entry.beacon) body = body.toString().replace("</body>", `  ${BEACON}\n</body>`);
    let served: Served | "network-error" = { status: entry.status, headers: { ...entry.headers }, body };
    if (changes[url]) served = changes[url](served);
    if (served === "network-error") throw new TypeError("fetch failed");
    return new Response(new Uint8Array(Buffer.from(served.body)), { status: served.status, headers: served.headers });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const site = loadSite(SITE_DIR);

async function run(state: "before" | "after", options: { mode?: "before" | "after"; expectHttpsRedirect?: boolean; changes?: Record<string, Change> } = {}) {
  const { fetch, calls } = fixtureFetch(state, options.changes);
  const report = await verifyLive({ site, mode: options.mode ?? "after", expectHttpsRedirect: options.expectHttpsRedirect ?? false, fetch, now: NOW });
  return { report, calls };
}

/** "<url> <check id>" for every check at `level`, sorted. */
function at(report: Report, level: string): string[] {
  return report.results.flatMap((r) => r.checks.filter((c) => c.level === level).map((c) => `${r.url} ${c.id}`)).sort();
}
const changing = (report: Report) =>
  report.results.flatMap((r) => r.checks.filter((c) => c.after_deploy).map((c) => `${r.url} ${c.id}`)).sort();
const beacons = (report: Report) => Object.fromEntries(report.results.map((r) => [r.url, r.beacons]));
const text = (s: Served) => s.body.toString();
const withBody = (fn: (html: string) => string): Change => (s) => ({ ...s, body: fn(text(s)) });
const withHeaders = (fn: (h: Record<string, string>) => Record<string, string>): Change => (s) => ({ ...s, headers: fn({ ...s.headers }) });
const without = (name: string) => withHeaders((h) => {
  delete h[name];
  return h;
});
const WEB_APP_HEADERS = { "content-type": "text/html; charset=utf-8", vary: "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding" };
const RECORDED_ROOT = readFileSync(path.join(FIXTURES, "before", "host-root.html"));
const RECORDED_NOT_FOUND = readFileSync(path.join(FIXTURES, "before", "host-not-found.html"));

describe("the state recorded on 2026-09-28, before the deploy", () => {
  it("passes --before-deploy; the only finding is the missing http-to-https redirect, a warning", async () => {
    const { report } = await run("before", { mode: "before" });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual([`${HTTP_LOGIN} https-redirect`]);
    expect(report.ok).toBe(true);
    expect(report.mode).toBe("before-deploy");
  });

  it("counts one beacon on every awardgrid.dowhiz.com HTML page and none on workers.dev", async () => {
    const { report } = await run("before", { mode: "before" });
    const counts = beacons(report);
    for (const url of [...HOST_PAGES, ...WEB_APP, HTTP_LOGIN]) expect(counts[url], url).toBe(1);
    for (const url of WORKERS_DEV_PAGES) expect(counts[url], url).toBe(0);
    for (const url of ROOT_FILES) expect(counts[url], `${url} is the web app's not-found page`).toBe(1);
  });

  it("lists what the deploy is expected to change", async () => {
    const { report } = await run("before", { mode: "before" });
    expect(changing(report)).toEqual(
      [
        `${H}/ served-by`,
        ...[`${H}/ios/`, `${H}/privacy/`, `${H}/support/`].flatMap((u) => [`${u} comments`, `${u} canonical`, `${u} hsts`]),
        ...WORKERS_DEV_PAGES.flatMap((u) => [`${u} comments`, `${u} canonical`, `${u} x-robots-tag`]),
        ...ROOT_FILES.map((u) => `${u} served`),
      ].sort(),
    );
  });

  it("fails the after-deploy checks on exactly what the deploy is meant to change", async () => {
    const { report } = await run("before");
    expect(report.ok).toBe(false);
    expect(at(report, "fail")).toEqual(
      [
        `${H}/ served-by`,
        ...[`${H}/ios/`, `${H}/privacy/`, `${H}/support/`].flatMap((u) => [`${u} comments`, `${u} canonical`, `${u} hsts`]),
        ...WORKERS_DEV_PAGES.flatMap((u) => [`${u} comments`, `${u} canonical`, `${u} x-robots-tag`]),
        ...ROOT_FILES.flatMap((u) => [`${u} status`, `${u} served-by`]),
      ].sort(),
    );
    expect(at(report, "warn")).toEqual([`${HTTP_LOGIN} https-redirect`]);
  });

  it("with --expect-https-redirect, the missing redirect fails", async () => {
    const { report } = await run("before", { mode: "before", expectHttpsRedirect: true });
    expect(at(report, "fail")).toEqual([`${HTTP_LOGIN} https-redirect`]);
    expect(report.ok).toBe(false);
  });

  it("still fails, before the deploy, what must hold either way: a script on a Worker page, /login without noindex", async () => {
    const { report } = await run("before", {
      mode: "before",
      changes: {
        [`${H}/privacy/`]: withBody((h) => h.replace("</main>", '</main><script src="/x.js"></script>')),
        [`${H}/login`]: withBody((h) => h.replace('<meta name="robots" content="noindex, nofollow"/>', "")),
      },
    });
    expect(at(report, "fail")).toEqual([`${H}/login noindex`, `${H}/privacy/ scripts`]);
  });

  it("sees the web app's sign-in pages carry noindex", async () => {
    const { report } = await run("before", { mode: "before" });
    const noindex = report.results.flatMap((r) => r.checks.filter((c) => c.id === "noindex").map((c) => `${r.url} ${c.level}`));
    expect(noindex).toEqual([`${H}/login pass`, `${H}/register pass`]);
  });
});

describe("the state expected after the deploy (synthetic)", () => {
  it("passes with no failure and no warning, the https redirect required too", async () => {
    const { report } = await run("after", { expectHttpsRedirect: true });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.counts.pass).toBeGreaterThan(50);
  });

  it("reports the beacon counts: one on each awardgrid.dowhiz.com page and web app path, none on workers.dev", async () => {
    const { report } = await run("after");
    const counts = beacons(report);
    for (const url of [...HOST_PAGES, ...WEB_APP]) expect(counts[url], url).toBe(1);
    for (const url of WORKERS_DEV_PAGES) expect(counts[url], url).toBe(0);
  });

  it("in --before-deploy mode, warns that each change is already live and fails nothing", async () => {
    const { report } = await run("after", { mode: "before" });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual(
      [
        `${H}/ served-by`,
        ...[`${H}/`, `${H}/ios/`, `${H}/privacy/`, `${H}/support/`].flatMap((u) => [`${u} canonical`, `${u} hsts`]),
        ...WORKERS_DEV_PAGES.flatMap((u) => [`${u} canonical`, `${u} x-robots-tag`]),
        ...ROOT_FILES.map((u) => `${u} served`),
      ].sort(),
    );
  });
});

describe("each failure, one response changed from the after-deploy state", () => {
  const cases: [string, string, Change, string[]][] = [
    ["an HTML comment", `${H}/ios/`, withBody((h) => h.replace("<main>", "<!-- a note --><main>")), ["comments"]],
    ["a script with src", `${H}/privacy/`, withBody((h) => h.replace("</main>", '</main><script src="/x.js"></script>')), ["scripts"]],
    ["an inline script", `${H}/privacy/`, withBody((h) => h.replace("</main>", "</main><script>alert(1)</script>")), ["scripts"]],
    ["a module script", `${H}/`, withBody((h) => h.replace("</main>", '</main><script type="module">import "./x.js"</script>')), ["scripts"]],
    ["JSON-LD with src", `${H}/ios/`, withBody((h) => h.replace("</main>", '</main><script type="application/ld+json" src="/data.json"></script>')), ["scripts"]],
    ["a second beacon", `${H}/support/`, withBody((h) => h.replace("</main>", `</main>${BEACON}`)), ["scripts"]],
    [
      "a beacon-shaped script from another host",
      `${H}/support/`,
      withBody((h) => h.replace("</main>", `</main>${BEACON.replace("static.cloudflareinsights.com", "static.cloudflareinsights.com.example.net")}`)),
      ["scripts"],
    ],
    ["the beacon's script without data-cf-beacon, beside the real one", `${H}/support/`, withBody((h) => h.replace("</main>", '</main><script src="https://static.cloudflareinsights.com/beacon.min.js"></script>')), ["scripts"]],
    // Tags whose attributes the tag reader cannot parse; a browser still loads each one's script.
    ["a script tag with a stray quote after its src", `${H}/privacy/`, withBody((h) => h.replace("</main>", "</main><script src=/x.js'></script>")), ["scripts"]],
    ["a script tag with a bare quoted word", `${H}/privacy/`, withBody((h) => h.replace("</main>", '</main><script "a" src=/x.js></script>')), ["scripts"]],
    ["a script tag with a quote after a quoted src", `${W}/`, withBody((h) => h.replace("</main>", '</main><script src="/x.js"\'></script>')), ["scripts"]],
    // The beacon counts only as Cloudflare injects it: with an event handler added it runs code of its own.
    ["the beacon with an event handler", `${H}/ios/`, withBody((h) => h.replace(BEACON, BEACON.replace("<script ", '<script onload="fetch(1)" '))), ["scripts"]],
    ["JSON-LD with an event handler", `${H}/`, withBody((h) => h.replace("</main>", '</main><script type="application/ld+json" onerror="fetch(1)">{}</script>')), ["scripts"]],
    ["an inline event handler", `${H}/ios/`, withBody((h) => h.replace("<body>", '<body onload="fetch(1)">')), ["scripts"]],
    ["a javascript: URL", `${W}/ios/`, withBody((h) => h.replace("</main>", '<a href="javascript:void(0)">x</a></main>')), ["scripts"]],
    ["JSON-LD that does not parse", `${H}/`, withBody((h) => h.replace('{"@context"', '{"@context",')), ["json-ld"]],
    ["no canonical link", `${H}/support/`, withBody((h) => h.replace(/ *<link rel="canonical"[^>]*>\n/, "")), ["canonical"]],
    ["a canonical link on workers.dev", `${W}/ios/`, withBody((h) => h.replace(`href="${H}/ios/"`, `href="${W}/ios/"`)), ["canonical"]],
    ["two canonical links", `${H}/ios/`, withBody((h) => h.replace("</head>", `<link rel="canonical" href="${H}/ios/"></head>`)), ["canonical"]],
    ["X-Robots-Tag noindex on awardgrid.dowhiz.com", `${H}/ios/`, withHeaders((h) => ({ ...h, "x-robots-tag": "noindex" })), ["indexable"]],
    ["a robots noindex meta tag on awardgrid.dowhiz.com", `${H}/`, withBody((h) => h.replace("</head>", '<meta name="robots" content="noindex"></head>')), ["indexable"]],
    ["no Strict-Transport-Security", `${H}/ios/`, without("strict-transport-security"), ["hsts"]],
    ["Strict-Transport-Security with max-age=0", `${H}/privacy/`, withHeaders((h) => ({ ...h, "strict-transport-security": "max-age=0" })), ["hsts"]],
    ["no X-Robots-Tag on workers.dev", `${W}/`, without("x-robots-tag"), ["x-robots-tag"]],
    ["/ still the web app's", `${H}/`, () => ({ status: 200, headers: WEB_APP_HEADERS, body: RECORDED_ROOT }), ["served-by"]],
    ["a Worker page served as text/plain", `${H}/support/`, withHeaders((h) => ({ ...h, "content-type": "text/plain" })), ["content-type"]],
    ["a root file still the web app's not-found page", `${H}/llms.txt`, () => ({ status: 404, headers: WEB_APP_HEADERS, body: RECORDED_NOT_FOUND }), ["served-by", "status"]],
    ["a root file the Worker does not have", `${H}/favicon.svg`, () => ({ status: 404, headers: {}, body: "" }), ["status"]],
    [
      "robots.txt with lines prepended (a robots.txt that Cloudflare manages)",
      `${H}/robots.txt`,
      withBody((b) => `# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\n\n${b}`),
      ["content"],
    ],
    ["robots.txt with one byte changed", `${H}/robots.txt`, withBody((b) => b.replace("Disallow: /grid", "Disallow: /grid/")), ["content"]],
    ["robots.txt served as text/html", `${H}/robots.txt`, withHeaders((h) => ({ ...h, "content-type": "text/html" })), ["content-type"]],
    ["a sitemap without a page", `${H}/sitemap.xml`, withBody((b) => b.replace(/ *<url><loc>[^<]*\/support\/<\/loc>.*\n/, "")), ["content"]],
    ["a sitemap with a page not in the manifest", `${H}/sitemap.xml`, withBody((b) => b.replace("</urlset>", `<url><loc>${H}/login</loc></url></urlset>`)), ["content"]],
    ["a sitemap served as text/plain", `${H}/sitemap.xml`, withHeaders((h) => ({ ...h, "content-type": "text/plain" })), ["content-type"]],
    ["llms.txt that is an HTML page", `${H}/llms.txt`, () => ({ status: 200, headers: { "content-type": "text/plain" }, body: "<!doctype html><html><body>x</body></html>" }), ["content"]],
    ["a key file with another key", `${H}/${KEY}.txt`, withBody(() => "ffffffffffffffffffffffffffffffff"), ["content"]],
    ["favicon.ico that is not an ICO", `${H}/favicon.ico`, withBody(() => "<html></html>"), ["content"]],
    ["favicon.svg that runs a script", `${H}/favicon.svg`, withBody((b) => b.replace("</svg>", "<script>alert(1)</script></svg>")), ["content"]],
    ["/login without noindex", `${H}/login`, withBody((h) => h.replace('<meta name="robots" content="noindex, nofollow"/>', "")), ["noindex"]],
    ["/register without noindex", `${H}/register`, withBody((h) => h.replace('<meta name="robots" content="noindex, nofollow"/>', "")), ["noindex"]],
    ["a request that fails", `${H}/privacy/`, () => "network-error", ["request"]],
  ];

  it.each(cases)("%s fails at that URL, and nothing else does", async (_name, url, change, ids) => {
    const { report } = await run("after", { changes: { [url]: change } });
    expect(at(report, "fail")).toEqual(ids.map((id) => `${url} ${id}`).sort());
    expect(report.ok).toBe(false);
  });
});

describe("warnings, not failures", () => {
  const cases: [string, string, Change, string[]][] = [
    ["no beacon on an awardgrid.dowhiz.com page (analytics switched off)", `${H}/ios/`, withBody((h) => h.replace(BEACON, "")), ["beacons"]],
    ["a beacon on workers.dev", `${W}/`, withBody((h) => h.replace("</body>", `${BEACON}</body>`)), ["beacons"]],
    ["/?x=1 answered by the Worker (an exact route matching a query string)", `${H}/?x=1`, withHeaders(() => ({ "content-type": "text/html" })), ["served-by"]],
    ["the web app down on /login", `${H}/login`, () => ({ status: 502, headers: { "content-type": "text/html" }, body: "Bad gateway" }), ["noindex", "status"]],
    ["no http-to-https redirect", HTTP_LOGIN, () => ({ status: 200, headers: WEB_APP_HEADERS, body: "" }), ["https-redirect"]],
    ["a temporary redirect to https", HTTP_LOGIN, (s) => ({ ...s, status: 302 }), ["https-redirect"]],
    ["a permanent redirect elsewhere", HTTP_LOGIN, withHeaders(() => ({ location: `${H}/` })), ["https-redirect"]],
  ];

  it.each(cases)("%s warns", async (_name, url, change, ids) => {
    const { report } = await run("after", { changes: { [url]: change } });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual(ids.map((id) => `${url} ${id}`).sort());
    expect(report.ok).toBe(true);
  });

  it("a missing redirect fails with --expect-https-redirect; a 308 passes", async () => {
    const missing = await run("after", { expectHttpsRedirect: true, changes: { [HTTP_LOGIN]: () => ({ status: 200, headers: {}, body: "" }) } });
    expect(at(missing.report, "fail")).toEqual([`${HTTP_LOGIN} https-redirect`]);
    const permanent = await run("after", { expectHttpsRedirect: true, changes: { [HTTP_LOGIN]: (s) => ({ ...s, status: 308 }) } });
    expect(at(permanent.report, "fail")).toEqual([]);
  });
});

describe("Cloudflare's own error page (a 5xx): who would serve the path is unknown", () => {
  /** What Cloudflare answers while the tunnel to the web app is down: a 530 page, error 1033, no Vary, its own script. */
  const TUNNEL_DOWN: Change = () => ({
    status: 530,
    headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "private, max-age=0, no-store" },
    body: '<!DOCTYPE html><html><head><title>awardgrid.dowhiz.com | 530: Cloudflare Tunnel error</title></head><body><h1>Error 1033</h1><p>Cloudflare Tunnel error</p><script>(function(){var b=document.getElementById("cf-footer-item-ip")})();</script></body></html>',
  });
  const byUrl = (report: Report) => Object.fromEntries(report.results.map((r) => [r.url, r]));
  const detailsAt = (report: Report, url: string) => byUrl(report)[url]!.checks.map((c) => `${c.level} ${c.id}: ${c.detail}`);

  it("after the deploy, / answering 530 (its route missing, the web app down) fails on the status alone, not as the Worker's page", async () => {
    const { report } = await run("after", { changes: { [`${H}/`]: TUNNEL_DOWN } });
    expect(at(report, "fail")).toEqual([`${H}/ status`]);
    const home = byUrl(report)[`${H}/`]!;
    expect(home.served_by).toBe("unknown");
    expect(home.beacons).toBeNull();
    expect(detailsAt(report, `${H}/`).join("\n")).not.toMatch(/served by the Worker/);
    expect(detailsAt(report, `${H}/`).find((d) => d.startsWith("info served-by"))).toBe("info served-by: unknown (HTTP 530: Cloudflare's own error page, which does not say who would serve this path)");
  });

  it.each([`${H}/robots.txt`, `${H}/${KEY}.txt`, `${H}/ios/`, `${W}/ios/`])("after the deploy, %s answering 530 fails on the status alone", async (url) => {
    const { report } = await run("after", { changes: { [url]: TUNNEL_DOWN } });
    expect(at(report, "fail")).toEqual([`${url} status`]);
    expect(byUrl(report)[url]!.served_by).toBe("unknown");
    expect(detailsAt(report, url).filter((d) => /served by the Worker/.test(d))).toEqual([]);
  });

  it("before the deploy, with the web app down, / and the root files warn and nothing says the Worker serves them", async () => {
    const recorded = JSON.parse(readFileSync(path.join(FIXTURES, "before", "responses.json"), "utf8")) as { responses: Record<string, Entry> };
    const webApp = Object.entries(recorded.responses)
      .filter(([, e]) => /\brsc\b/.test(e.headers.vary ?? ""))
      .map(([url]) => url);
    expect(webApp).toEqual(expect.arrayContaining([`${H}/`, ...WEB_APP, ...ROOT_FILES, HTTP_LOGIN]));
    const { report } = await run("before", { mode: "before", changes: Object.fromEntries(webApp.map((url) => [url, TUNNEL_DOWN])) });
    expect(at(report, "fail")).toEqual([]);
    expect(at(report, "warn")).toEqual(
      [`${H}/ status`, ...WEB_APP.map((u) => `${u} status`), `${H}/login noindex`, `${H}/register noindex`, ...ROOT_FILES.map((u) => `${u} served`), `${HTTP_LOGIN} https-redirect`].sort(),
    );
    for (const url of [`${H}/`, ...WEB_APP, ...ROOT_FILES]) {
      expect(byUrl(report)[url]!.served_by, url).toBe("unknown");
      expect(detailsAt(report, url).join("\n"), url).not.toMatch(/served by the Worker|already as expected/);
    }
    const table = formatReport(report).split("\n");
    for (const url of [`${H}/`, ...ROOT_FILES]) expect(table.find((l) => l.endsWith(` ${url}`)), url).toMatch(/^WARN\s+530\s+unknown\s+-\s+/);
  });

  it("the http-to-https redirect is not attributed to the Worker or the web app", async () => {
    const { report } = await run("after");
    expect(byUrl(report)[HTTP_LOGIN]!.served_by).toBeNull();
    expect(formatReport(report).split("\n").find((l) => l.endsWith(` ${HTTP_LOGIN}`))).toMatch(/^PASS\s+301\s+-\s+/);
  });

  it.each([
    [{}, 200, "worker"],
    [{ vary: "rsc, Accept-Encoding" }, 404, "web-app"],
    [{}, 530, "unknown"],
    [{ vary: "rsc" }, 502, "unknown"],
  ] as const)("servedBy(%j, %i) is %s", (headers, status, expected) => {
    expect(servedBy({ ...headers }, status)).toBe(expected);
  });
});

describe("the requests", () => {
  it("asks for each URL once, in order, as a browser: GET, browser User-Agent, Accept: text/html, redirects not followed", async () => {
    const { calls } = await run("after");
    expect(calls.map((c) => c.url)).toEqual(ALL_URLS);
    for (const { url, init } of calls) {
      const headers = new Headers(init?.headers);
      expect(init?.method, url).toBe("GET");
      expect(init?.redirect, url).toBe("manual");
      expect(headers.get("user-agent"), url).toMatch(/^Mozilla\/5\.0 .*Chrome\/\d+/);
      expect(headers.get("user-agent"), url).not.toMatch(/bot|crawl|spider|curl|node|undici/i);
      expect(headers.get("accept"), url).toMatch(/^text\/html\b/);
    }
  });

  it("plans the probes from the manifest: its pages, the workers.dev pages, the web app paths, the root files, the redirect", () => {
    expect(planProbes(site).map((p) => p.url)).toEqual(ALL_URLS);
    expect(REQUEST_HEADERS.accept).toContain("text/html");
  });
});

describe("reading a page", () => {
  const recorded = (file: string) => readFileSync(path.join(FIXTURES, "before", file), "utf8");

  it("finds the recorded beacon, and nothing else, on the recorded Worker page", () => {
    const scripts = classifyScripts(recorded("host-ios.html"));
    expect(scripts.beacons).toHaveLength(1);
    expect(scripts.other).toEqual([]);
    expect(scripts.ldJson).toEqual([]);
  });

  it("tells the beacon from the web app's own scripts on the recorded /login", () => {
    const scripts = classifyScripts(recorded("host-login.html"));
    expect(scripts.beacons).toHaveLength(1);
    expect(scripts.other.length).toBeGreaterThan(10);
  });

  it.each([
    [BEACON, true],
    ['<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token": "REDACTED"}\'></script>', true],
    ['<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>', false],
    ['<script src="https://static.cloudflareinsights.com/other.js" data-cf-beacon="{}"></script>', false],
    ['<script src="https://evil.example/beacon.min.js" data-cf-beacon="{}"></script>', false],
    ['<script src="https://static.cloudflareinsights.com.evil.example/beacon.min.js" data-cf-beacon="{}"></script>', false],
    ['<script data-cf-beacon="{}"></script>', false],
  ])("isBeacon(%s) is %s", (tag, expected) => {
    const m = /<script\b([^>]*)>/i.exec(tag);
    expect(isBeacon(attributes(m?.[1] ?? ""))).toBe(expected);
  });

  it("allows JSON-LD without src in any spelling of its type, and nothing else", () => {
    const ok = ['<script type="application/ld+json">{}</script>', "<script type='application/ld+json'>{}</script>", "<script type=application/ld+json>{}</script>", '<script type="Application/LD+JSON ">{}</script>'];
    for (const html of ok) expect(classifyScripts(html), html).toEqual({ ldJson: ["{}"], beacons: [], other: [] });
    expect(classifyScripts('<script type="application/ld+json" src="/x.json"></script>').other).toHaveLength(1);
    expect(classifyScripts("<SCRIPT TYPE=text/javascript>1</SCRIPT>").other).toHaveLength(1);
  });

  it("counts every <script: one whose attributes cannot be read, or that carries an event handler, is 'other'", () => {
    for (const tag of ["<script src=/x.js'></script>", '<script "a" src=/x.js></script>', '<script src="/x.js"\'></script>', "<script src=/x.js", '<script type="application/ld+json" onload="x">{}</script>']) {
      const scripts = classifyScripts(`<p>a</p>${tag}<p>b</p>`);
      expect(scripts.other, tag).toHaveLength(1);
      expect([scripts.beacons, scripts.ldJson], tag).toEqual([[], []]);
    }
    const handled = classifyScripts(BEACON.replace("<script ", '<script onload="x" '));
    expect([handled.beacons.length, handled.other.length]).toEqual([0, 1]);
    expect(isBeacon(attributes('src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="{}" onerror="x"'))).toBe(false);
  });

  it("counts a commented-out script as a comment, not as a script", () => {
    const a = analyzeHtml('<p>a</p><!-- <script src="/x.js"></script> --><p onclick="x">b</p>');
    expect(a.comments).toBe(1);
    expect(a.otherScripts).toEqual([]);
    expect(a.inline).toHaveLength(1);
  });

  it.each([
    ["noindex", true],
    ["noindex, nofollow", true],
    ["NONE", true],
    ["googlebot: noindex", true],
    ["index, follow", false],
    ["nofollow", false],
    ["max-image-preview:none", false],
    ["unavailable_after: 2026-12-31", false],
    ["", false],
  ])("isNoindex(%j) is %s", (value, expected) => {
    expect(isNoindex(value)).toBe(expected);
  });

  it("reads robots meta tags, canonical links, sitemap locations and who served a response", () => {
    expect(metaRobots(recorded("host-login.html"))).toEqual(["noindex, nofollow"]);
    expect(metaRobots('<meta content="noindex" name="googlebot"><meta name="description" content="x">')).toEqual(["noindex"]);
    expect(canonicalLinks('<link href="https://a.example/x" rel="canonical"><link rel="icon" href="/f.svg">')).toEqual(["https://a.example/x"]);
    expect(sitemapLocs("<urlset><url><loc> https://a.example/ </loc></url><url><loc>https://a.example/b/</loc></url></urlset>")).toEqual([
      "https://a.example/",
      "https://a.example/b/",
    ]);
    expect(servedBy({ vary: "rsc, next-router-state-tree, Accept-Encoding" })).toBe("web-app");
    expect(servedBy({ vary: "Accept-Encoding" })).toBe("worker");
    expect(servedBy({})).toBe("worker");
  });
});

describe("the CLI", () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, deps: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s), siteDir: SITE_DIR, now: NOW } };
  };

  it("--help prints the usage and exits 0, run as a process whose fetch throws", () => {
    const run = spawnSync(process.execPath, ["--import", 'data:text/javascript,globalThis.fetch=()=>{throw new Error("network")}', SCRIPT, "--help"], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Usage: node sites/landing/scripts/verify-live.mjs");
    expect(run.stdout).toContain("--before-deploy");
  });

  it("refuses an unknown option, and --json without a file, with exit 2", async () => {
    for (const argv of [["--nope"], ["--json"], ["--json", "--before-deploy"]]) {
      const { err, deps } = capture();
      expect(await main(argv, { ...deps, fetch: fixtureFetch("before").fetch }), argv.join(" ")).toBe(2);
      expect(err.join("")).toContain("Usage:");
    }
  });

  it("prints a table and writes a JSON report; exit 0 before the deploy on the recorded state", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "verify-live-"));
    temps.push(dir);
    const file = path.join(dir, "report.json");
    const { out, deps } = capture();
    expect(await main(["--before-deploy", "--json", file], { ...deps, fetch: fixtureFetch("before").fetch })).toBe(0);
    const printed = out.join("");
    expect(printed).toContain("before the deploy (--before-deploy)");
    for (const url of ALL_URLS) expect(printed).toContain(url);
    expect(printed).toContain("Expected to change with the deploy:");
    expect(printed).toMatch(/OK: 17 URLs, 0 failure\(s\), 1 warning\(s\)\./);
    const report = JSON.parse(readFileSync(file, "utf8")) as Report;
    expect(report.mode).toBe("before-deploy");
    expect(report.checked_at).toBe("2026-10-01T12:00:00.000Z");
    expect(report.results.map((r) => r.url)).toEqual(ALL_URLS);
    expect(report.request_headers["user-agent"]).toBe(REQUEST_HEADERS["user-agent"]);
  });

  it("refuses a --json file it cannot write with exit 2, before making any request", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "verify-live-"));
    temps.push(dir);
    for (const target of [path.join(dir, "missing-dir", "report.json"), dir]) {
      const { out, err, deps } = capture();
      const { fetch, calls } = fixtureFetch("before");
      expect(await main(["--before-deploy", "--json", target], { ...deps, fetch }), target).toBe(2);
      expect(calls, target).toEqual([]);
      expect(out.join(""), target).toBe("");
      expect(err.join(""), target).toContain(`cannot write the JSON report to ${target}`);
    }
    expect(jsonTargetProblem(path.join(dir, "report.json"))).toBeNull();
  });

  it("when the JSON report cannot be written after the run, says so and does not crash: 2 on a passing run, 1 on a failing one", async () => {
    for (const [argv, code] of [[["--before-deploy"], 2], [[], 1]] as const) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "verify-live-"));
      temps.push(dir);
      const file = path.join(dir, "out", "report.json");
      mkdirSync(path.dirname(file));
      const { out, err, deps } = capture();
      const inner = fixtureFetch("before").fetch;
      // The directory goes away while the requests run, after the up-front check passed.
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        rmSync(path.dirname(file), { recursive: true, force: true });
        return inner(input, init);
      }) as typeof globalThis.fetch;
      expect(await main([...argv, "--json", file], { ...deps, fetch }), argv.join(" ")).toBe(code);
      expect(out.join("")).toMatch(code === 2 ? /OK: 17 URLs/ : /FAILED: 17 URLs/);
      expect(err.join("")).toContain(`cannot write the JSON report to ${file}`);
    }
  });

  it("exits 1 and lists the failures after the deploy when the deploy did not happen", async () => {
    const { out, deps } = capture();
    expect(await main([], { ...deps, fetch: fixtureFetch("before").fetch })).toBe(1);
    expect(out.join("")).toContain("Failures:");
    expect(out.join("")).toContain(`FAIL ${H}/robots.txt  status: HTTP 404; expected HTTP 200`);
  });

  it("under vitest, makes no request without an injected fetch: every probe fails instead", async () => {
    const { out, deps } = capture();
    expect(await main(["--before-deploy"], deps)).toBe(1);
    expect(out.join("")).toContain("no network under vitest");
  });

  it("exits 1 with a message when the site has no page manifest", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "verify-live-"));
    temps.push(dir);
    const { err, deps } = capture();
    expect(await main([], { ...deps, siteDir: dir, fetch: fixtureFetch("before").fetch })).toBe(1);
    expect(err.join("")).toMatch(/pages\.json/);
  });
});

describe("the site's own configuration", () => {
  it("loads sites/landing/pages.json and public/robots.txt: the host, its four pages and the IndexNow key", () => {
    const own = loadSite();
    expect(own.host).toBe("awardgrid.dowhiz.com");
    expect(own.paths).toEqual(expect.arrayContaining(["/", "/ios/", "/privacy/", "/support/"]));
    expect(own.key).toMatch(/^[0-9a-f]{32}$/);
    expect(own.robotsTxt.toString("utf8")).toMatch(/^User-agent: \*$/m);
    expect(planProbes(own).filter((p) => p.kind === "root-file").map((p) => p.path)).toContain(`/${own.key}.txt`);
  });
});
