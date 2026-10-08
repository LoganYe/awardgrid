#!/usr/bin/env node
/**
 * Checks what awardgrid.dowhiz.com and the Worker's own workers.dev address serve, the way a browser receives it.
 *
 *   node sites/landing/scripts/verify-live.mjs                     after a deploy: exit 1 on any failure
 *   node sites/landing/scripts/verify-live.mjs --before-deploy     before one: passes on the state before the crawl
 *                                                                  files and the "/" route are deployed, and lists
 *                                                                  what the deploy is expected to change
 *   options: --expect-https-redirect  --json <file>  --help
 *
 * Every request carries a browser User-Agent and `Accept: text/html`, never a crawler's: Cloudflare Web Analytics
 * adds its beacon script only to HTML answered to a browser, and the beacon is one of the things counted here.
 * Redirects are not followed, so a page must answer 200 itself.
 *
 * What is checked
 *   - Worker pages: every page in sites/landing/pages.json on awardgrid.dowhiz.com ("/" once its exact route sends
 *     it to the Worker), and "/" and "/ios/" on the workers.dev address. 200 from the Worker; HTML; no `<!--`; no
 *     `<script` except JSON-LD without src and at most one Cloudflare Web Analytics beacon
 *     (static.cloudflareinsights.com/beacon.min.js with data-cf-beacon; the privacy policy discloses it); no inline
 *     event handler or javascript: URL; JSON-LD that parses; one canonical link, on awardgrid.dowhiz.com. On
 *     awardgrid.dowhiz.com also: not noindex, and a Strict-Transport-Security header. On workers.dev: X-Robots-Tag
 *     noindex. The beacon count is reported: one is expected on awardgrid.dowhiz.com and none on workers.dev, and a
 *     different count is a warning (two or more, or any other script, is a failure).
 *   - Web app paths (/login, /register, /legal, /?x=1): the beacon count is reported (disclosed, not a failure);
 *     /login and /register must carry a robots noindex; /?x=1 must still reach the web app, since an exact route
 *     does not match a URL with a query string.
 *   - Root files (/robots.txt, /sitemap.xml, /llms.txt, /<IndexNow key>.txt, /favicon.ico, /favicon.svg): 200 from
 *     the Worker (a response with `Vary: rsc` is the web app's) with a fitting Content-Type; robots.txt byte for byte
 *     sites/landing/public/robots.txt (a robots.txt that Cloudflare manages would prepend its own lines); the sitemap
 *     lists exactly the pages in pages.json; the key file serves the key.
 *   - http://awardgrid.dowhiz.com/login answers with a permanent redirect (301 or 308) to https: a warning until the
 *     redirect rule exists, a failure with --expect-https-redirect.
 *   - A 5xx anywhere is Cloudflare's own error page (a 530 while the tunnel to the web app is down): who would serve
 *     the path is reported as unknown, and the page checks do not run on it. Where the Worker should answer, it is a
 *     failure; on a web app path (and "/" before the deploy), a warning.
 *
 * In --before-deploy mode the checks that the deploy changes (the "/" route, the root files, canonical links, HSTS,
 * comments, the workers.dev X-Robots-Tag) expect the state before it and report the state expected after it; the
 * checks that hold either way (no script but JSON-LD and the beacon, noindex on the web app's sign-in pages) are the
 * same in both modes. A page of pages.json that the Worker answers with a 404 before the deploy is a page the deploy
 * adds: it passes, and is listed as expected to answer 200 after it.
 *
 * Node built-ins only. The checks are exported as pure functions for sites/landing/test/verify-live.test.ts, which
 * runs them on recorded and synthetic responses; no test reaches the network.
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, SITE_DIR, readSiteConfig } from "./indexnow.mjs";

export { HOST };
export const WORKERS_DEV = "awardgrid-vercel-public.logan-yegaoyang.workers.dev";
/** Pages checked on the workers.dev address: the same build as on the host, so two are enough to see its headers. */
export const WORKERS_DEV_PATHS = ["/", "/ios/"];
/** Web app paths: the web app keeps every path the Worker's routes do not claim. */
export const WEB_APP_PATHS = ["/login", "/register", "/legal", "/?x=1"];
export const NOINDEX_PATHS = new Set(["/login", "/register"]);
export const REQUEST_HEADERS = Object.freeze({
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
});
const TIMEOUT_MS = 20_000;
const BEACON_HOST = "static.cloudflareinsights.com";
const BEACON_PATH = "/beacon.min.js";

export const USAGE = `Usage: node sites/landing/scripts/verify-live.mjs [--before-deploy] [--expect-https-redirect] [--json <file>]

Requests the pages and root files of https://${HOST}/ and of the Worker's workers.dev address as a
browser would (browser User-Agent, Accept: text/html), and checks the Worker pages, the web app paths, the root
files and the http-to-https redirect. Prints a table; exit 1 on any failure, 2 on a usage error (a --json file
that cannot be written is one; it is checked before any request).

  --before-deploy           expect the state before the crawl files and the "/" route are deployed, and list what
                            the deploy is expected to change
  --expect-https-redirect   a missing http-to-https redirect on /login fails instead of warning
  --json <file>             also write the full report as JSON
  --help                    this text
`;

// ---------------------------------------------------------------------------------------------------------------
// Reading a page
// ---------------------------------------------------------------------------------------------------------------

/** An opening tag's attribute text, with a `>` inside a quoted value kept in it. */
const ATTRS = String.raw`((?:[^'">]|=\s*"[^"]*"|=\s*'[^']*')*)`;
/** A script's opening tag, read from exactly where a `<script` starts (sticky). */
const SCRIPT_TAG_AT = new RegExp(String.raw`<script\b${ATTRS}>`, "iy");
const ANY_TAG = new RegExp(String.raw`<([a-zA-Z][^\s/>]*)${ATTRS}>`, "g");
const META_TAG = new RegExp(String.raw`<meta\b${ATTRS}>`, "gi");
const LINK_TAG = new RegExp(String.raw`<link\b${ATTRS}>`, "gi");
const withoutComments = (html) => html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ");

/** The value of each attribute in an opening tag's attribute text, first one wins (as in a browser). */
export function attributes(text) {
  const found = new Map();
  for (const m of String(text).matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!found.has(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return found;
}

/** An attribute that runs code on the element it sits on: onload, onerror, … */
const isHandler = (name) => /^on/i.test(name);

/**
 * Whether a script tag's attributes are Cloudflare Web Analytics' beacon: its script, with data-cf-beacon, and no
 * event handler (Cloudflare's tag has none; one added to it would run code of its own).
 */
export function isBeacon(attrs) {
  if (!attrs.has("data-cf-beacon") || !attrs.get("src")) return false;
  if ([...attrs.keys()].some(isHandler)) return false;
  try {
    const src = new URL(attrs.get("src"), "https://example.invalid/");
    return src.hostname === BEACON_HOST && (src.pathname === BEACON_PATH || src.pathname.startsWith(`${BEACON_PATH}/`));
  } catch {
    return false;
  }
}

/**
 * Every `<script` of a page (outside comments), sorted: JSON-LD without src (with its text), the Cloudflare Web
 * Analytics beacon, and everything else. Each `<script` counts, so a tag whose attributes cannot be read (a stray
 * quote: `<script src=/x.js'>`, which a browser still loads) is "everything else", as is a script with an event
 * handler.
 */
export function classifyScripts(html) {
  const markup = withoutComments(html);
  const out = { ldJson: [], beacons: [], other: [] };
  for (const { index } of markup.matchAll(/<script\b/gi)) {
    SCRIPT_TAG_AT.lastIndex = index;
    const m = SCRIPT_TAG_AT.exec(markup);
    if (!m) {
      const close = markup.indexOf(">", index);
      out.other.push(markup.slice(index, close === -1 ? index + 120 : close + 1));
      continue;
    }
    const attrs = attributes(m[1] ?? "");
    if (isBeacon(attrs)) out.beacons.push(m[0]);
    else if (!attrs.has("src") && ![...attrs.keys()].some(isHandler) && (attrs.get("type") ?? "").trim().toLowerCase() === "application/ld+json") {
      const start = index + m[0].length;
      const end = markup.slice(start).search(/<\/script\s*>/i);
      out.ldJson.push(end === -1 ? markup.slice(start) : markup.slice(start, start + end));
    } else out.other.push(m[0]);
  }
  return out;
}

/** Tags outside scripts, styles and comments that run code: an event handler, a javascript: URL, an iframe srcdoc. */
export function inlineCode(html) {
  const markup = withoutComments(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ");
  return [...markup.matchAll(ANY_TAG)]
    .filter((m) =>
      [...attributes(m[2] ?? "")].some(
        ([name, value]) =>
          /^on[a-z]+$/.test(name) ||
          /^javascript:/i.test(value.replace(/&#x0*61;?|&#0*97;?/gi, "a").replace(/[\s\u0000-\u001f]/g, "")) ||
          (m[1].toLowerCase() === "iframe" && name === "srcdoc"),
      ),
    )
    .map((m) => m[0]);
}

export const countComments = (html) => html.split("<!--").length - 1;

/**
 * Whether a robots meta content or an X-Robots-Tag value says noindex: a directive `noindex` or `none`, alone or
 * after a crawler's name (`googlebot: noindex`). `max-image-preview:none` and the like are not.
 */
export function isNoindex(value) {
  return String(value)
    .split(",")
    .some((part) => {
      const m = /^(?:([a-z0-9_-]+)\s*:\s*)?(?:noindex|none)$/.exec(part.trim().toLowerCase());
      return Boolean(m) && !/^max-/.test(m[1] ?? "");
    });
}

/** The content of each robots meta tag (robots, googlebot, bingbot). */
export function metaRobots(html) {
  return [...withoutComments(html).matchAll(META_TAG)]
    .map((m) => attributes(m[1] ?? ""))
    .filter((attrs) => /^(?:robots|googlebot|bingbot)$/i.test((attrs.get("name") ?? "").trim()))
    .map((attrs) => attrs.get("content") ?? "");
}

/** The href of each `<link rel="canonical">`. */
export function canonicalLinks(html) {
  return [...withoutComments(html).matchAll(LINK_TAG)]
    .map((m) => attributes(m[1] ?? ""))
    .filter((attrs) => (attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .map((attrs) => attrs.get("href") ?? "");
}

/** What a page runs and says about itself. */
export function analyzeHtml(html) {
  const scripts = classifyScripts(html);
  return {
    comments: countComments(html),
    beacons: scripts.beacons.length,
    ldJson: scripts.ldJson,
    otherScripts: scripts.other,
    inline: inlineCode(html),
    canonical: canonicalLinks(html),
    metaRobots: metaRobots(html),
  };
}

/**
 * "web-app" when the response varies on `rsc` (the Next.js web app's responses do), else "worker". With a status of
 * 500 or more, "unknown": that is Cloudflare's own error page (a 530 while the tunnel to the web app is down, say),
 * which varies on nothing and says nothing about who would have served the path. The static-assets Worker does not
 * answer 5xx.
 */
export function servedBy(headers, status = 200) {
  if (status >= 500) return "unknown";
  return /(?:^|,)\s*rsc\s*(?:,|$)/i.test(headers.vary ?? "") ? "web-app" : "worker";
}

/** What a `served-by` check says it saw. */
function servedByDetail(served, status) {
  if (served === "worker") return "served by the Worker";
  if (served === "web-app") return "served by the web app (Vary: rsc)";
  return `unknown (HTTP ${status}: Cloudflare's own error page, which does not say who would serve this path)`;
}

/** `<loc>` values of a sitemap. */
export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------------------------------------------
// What to request
// ---------------------------------------------------------------------------------------------------------------

/** The site as the checks need it: the manifest's host, page paths and IndexNow key, and the repo's robots.txt. */
export function loadSite(siteDir = SITE_DIR) {
  const { host, paths, key } = readSiteConfig(siteDir);
  const robotsTxt = readFileSync(path.join(siteDir, "public", "robots.txt"));
  return { host, paths, key, robotsTxt, workersDev: WORKERS_DEV };
}

export function rootFiles(key) {
  return [
    { path: "/robots.txt", file: "robots" },
    { path: "/sitemap.xml", file: "sitemap" },
    { path: "/llms.txt", file: "llms" },
    { path: `/${key}.txt`, file: "key" },
    { path: "/favicon.ico", file: "favicon-ico" },
    { path: "/favicon.svg", file: "favicon-svg" },
  ];
}

/** Every request, in order. `kind` picks the checks: home, page, workers-dev, web-app, root-file, https-redirect. */
export function planProbes(site) {
  const at = (host, p, scheme = "https") => new URL(p, `${scheme}://${host}`).href;
  const workersDev = site.workersDev ?? WORKERS_DEV;
  return [
    ...site.paths.map((p) => ({ kind: p === "/" ? "home" : "page", path: p, url: at(site.host, p) })),
    ...WORKERS_DEV_PATHS.map((p) => ({ kind: "workers-dev", path: p, url: at(workersDev, p) })),
    ...WEB_APP_PATHS.map((p) => ({ kind: "web-app", path: p, url: at(site.host, p) })),
    ...rootFiles(site.key).map(({ path: p, file }) => ({ kind: "root-file", file, path: p, url: at(site.host, p) })),
    { kind: "https-redirect", path: "/login", url: at(site.host, "/login", "http") },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Judging one response
// ---------------------------------------------------------------------------------------------------------------

const check = (id, level, detail, extra = {}) => ({ id, level, detail, ...extra });

/** A check that holds in both modes: pass, or `level` (fail by default) with what was expected. */
function plain(id, ok, observed, expected, level = "fail") {
  return ok ? check(id, "pass", observed) : check(id, level, `${observed}; expected ${expected}`);
}

/**
 * A check the deploy changes. After the deploy (the default mode) it passes on the after-state. Before it, it passes
 * on the before-state and says what is expected after the deploy; it warns when the after-state is already live,
 * and fails when the response is neither.
 */
function phased(ctx, id, { before, after, observed, expectedBefore, expectedAfter }) {
  if (ctx.mode === "after") return plain(id, after, observed, expectedAfter);
  if (before) return check(id, "pass", observed, after ? {} : { after_deploy: expectedAfter });
  if (after) return check(id, "warn", `${observed} (already as expected after the deploy)`);
  return check(id, "fail", `${observed}; expected ${expectedBefore} before the deploy, ${expectedAfter} after it`);
}

const shorten = (s, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function hstsOk(value) {
  const m = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i.exec(value ?? "");
  return Boolean(m && Number(m[1]) > 0);
}

function workerPageChecks(ctx, probe, res, a, { onHost }) {
  const out = [];
  const ct = res.headers["content-type"] ?? "";
  out.push(plain("status", res.status === 200, `HTTP ${res.status}`, "HTTP 200"));
  out.push(plain("content-type", /^text\/html\b/i.test(ct), `Content-Type ${ct || "(none)"}`, "text/html"));
  out.push(
    phased(ctx, "comments", {
      before: true,
      after: a.comments === 0,
      observed: `${a.comments} HTML comment(s)`,
      expectedBefore: "any number",
      expectedAfter: "none (the build removes them)",
    }),
  );
  const extra = [...a.otherScripts, ...a.inline].map((tag) => shorten(tag));
  if (a.beacons > 1) extra.push(`${a.beacons} beacons`);
  out.push(
    plain(
      "scripts",
      extra.length === 0,
      extra.length ? `runs code: ${extra.join(" | ")}` : `${a.ldJson.length} JSON-LD, ${a.beacons} beacon, nothing else`,
      "no script but JSON-LD without src and at most one Cloudflare Web Analytics beacon",
    ),
  );
  const expectedBeacons = onHost ? 1 : 0;
  const where = onHost ? ctx.host : "the workers.dev address";
  out.push(
    a.beacons === expectedBeacons
      ? check("beacons", "info", `${a.beacons} Cloudflare Web Analytics beacon(s)${onHost ? " (disclosed in the privacy policy)" : ""}`)
      : check("beacons", "warn", `${a.beacons} Cloudflare Web Analytics beacon(s); expected ${expectedBeacons} on ${where}`),
  );
  const broken = a.ldJson.filter((text) => {
    try {
      JSON.parse(text);
      return false;
    } catch {
      return true;
    }
  });
  out.push(plain("json-ld", broken.length === 0, `${a.ldJson.length} JSON-LD block(s), ${broken.length} that do not parse`, "JSON-LD that parses"));
  const want = new URL(probe.path, `https://${ctx.host}`).href;
  out.push(
    phased(ctx, "canonical", {
      before: a.canonical.length === 0,
      after: a.canonical.length === 1 && a.canonical[0] === want,
      observed: a.canonical.length ? `canonical ${a.canonical.join(", ")}` : "no canonical link",
      expectedBefore: "no canonical link",
      expectedAfter: `one canonical link, ${want}`,
    }),
  );
  if (onHost) {
    const noindex = [res.headers["x-robots-tag"] ?? "", ...a.metaRobots].filter(isNoindex);
    out.push(plain("indexable", noindex.length === 0, noindex.length ? `noindex (${noindex.join("; ")})` : "no noindex", "no noindex in X-Robots-Tag or a robots meta tag"));
    const hsts = res.headers["strict-transport-security"];
    out.push(
      phased(ctx, "hsts", {
        before: !hsts,
        after: hstsOk(hsts),
        observed: hsts ? `Strict-Transport-Security: ${hsts}` : "no Strict-Transport-Security",
        expectedBefore: "none",
        expectedAfter: "Strict-Transport-Security with a max-age (public/_headers)",
      }),
    );
  } else {
    const xr = res.headers["x-robots-tag"] ?? "";
    out.push(
      phased(ctx, "x-robots-tag", {
        before: !isNoindex(xr),
        after: isNoindex(xr),
        observed: xr ? `X-Robots-Tag: ${xr}` : "no X-Robots-Tag",
        expectedBefore: "no X-Robots-Tag noindex",
        expectedAfter: "X-Robots-Tag: noindex (public/_headers)",
      }),
    );
  }
  return out;
}

/**
 * A 5xx is Cloudflare's own error page (servedBy): the Worker serves static files and does not answer one, so most
 * likely no Worker route matched and the web app did not answer (the Mac asleep, the tunnel down). Its markup is not
 * the site's, so no page check runs on it.
 */
const errorPage = (status) =>
  `HTTP ${status}, Cloudflare's own error page (the Worker does not answer 5xx: most likely no Worker route matched and the web app did not answer)`;

/** A 5xx where the Worker should answer 200: a failure, and who would have served it is unknown. */
function errorPageChecks(res, expected) {
  return [check("status", "fail", `${errorPage(res.status)}; expected ${expected}`), check("served-by", "info", servedByDetail("unknown", res.status))];
}

function webAppChecks(ctx, probe, res, a) {
  const out = [];
  const served = servedBy(res.headers, res.status);
  out.push(
    res.status === 200
      ? check("status", "info", "HTTP 200")
      : check("status", "warn", served === "unknown" ? errorPage(res.status) : `HTTP ${res.status} from the web app`),
  );
  if (served === "unknown") out.push(check("served-by", "info", servedByDetail(served, res.status)));
  else if (probe.kind === "web-app") {
    out.push(
      served === "web-app"
        ? check("served-by", "pass", "served by the web app")
        : check(
            "served-by",
            "warn",
            probe.path.includes("?") ? "served by the Worker; an exact route should not match a URL with a query string" : "served by the Worker, not the web app",
          ),
    );
  }
  if (served !== "unknown") out.push(check("beacons", "info", `${a.beacons} Cloudflare Web Analytics beacon(s) (disclosed; not a failure on a web app path)`));
  if (NOINDEX_PATHS.has(probe.path)) {
    if (res.status !== 200) out.push(check("noindex", "warn", `not checked: HTTP ${res.status}`));
    else {
      const robots = [res.headers["x-robots-tag"] ?? "", ...a.metaRobots].filter(Boolean);
      out.push(plain("noindex", robots.some(isNoindex), robots.length ? `robots: ${robots.join("; ")}` : "no robots directive", "a robots noindex"));
    }
  }
  return out;
}

const ROOT_CONTENT_TYPES = {
  robots: [/^text\/plain\b/i, "text/plain"],
  sitemap: [/^(?:application|text)\/xml\b/i, "application/xml or text/xml"],
  llms: [/^text\/plain\b/i, "text/plain"],
  key: [/^text\/plain\b/i, "text/plain"],
  "favicon-ico": [/^image\/(?:x-icon|vnd\.microsoft\.icon)\b/i, "image/x-icon or image/vnd.microsoft.icon"],
  "favicon-svg": [/^image\/svg\+xml\b/i, "image/svg+xml"],
};

/** Where two byte strings first differ, and the line of `live` around it, for a readable robots.txt diff. */
function firstDifference(live, expected) {
  let i = 0;
  while (i < live.length && i < expected.length && live[i] === expected[i]) i++;
  const text = live.toString("utf8");
  const lineStart = text.lastIndexOf("\n", i - 1) + 1;
  const lineEnd = text.indexOf("\n", i);
  return { offset: i, line: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd) };
}

function rootFileContent(ctx, probe, res) {
  const text = res.text;
  switch (probe.file) {
    case "robots": {
      if (Buffer.compare(res.bytes, ctx.robotsTxt) === 0) return [true, "byte for byte public/robots.txt"];
      const d = firstDifference(res.bytes, ctx.robotsTxt);
      return [false, `differs from public/robots.txt at byte ${d.offset} (${res.bytes.length} bytes live, ${ctx.robotsTxt.length} in the repo; live line ${JSON.stringify(shorten(d.line, 80))})`];
    }
    case "sitemap": {
      const want = ctx.paths.map((p) => new URL(p, `https://${ctx.host}`).href);
      const locs = sitemapLocs(text);
      const missing = want.filter((u) => !locs.includes(u));
      const extra = locs.filter((u, i) => !want.includes(u) || locs.indexOf(u) !== i);
      if (!/<urlset\b/.test(text)) return [false, "no <urlset>"];
      if (missing.length || extra.length) return [false, `missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`];
      return [true, `${locs.length} <loc>, the pages in pages.json`];
    }
    case "llms": {
      if (/<html\b|<!doctype/i.test(text)) return [false, "is HTML"];
      return text.startsWith("# ") ? [true, `starts ${JSON.stringify(shorten(text.split("\n")[0], 60))}`] : [false, "does not start with a '# ' title line"];
    }
    case "key":
      return text.trim() === ctx.key ? [true, "serves the key"] : [false, `serves ${JSON.stringify(shorten(text.trim(), 60))}, not the key`];
    case "favicon-ico":
      return res.bytes.length > 6 && res.bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
        ? [true, `an ICO file, ${res.bytes.length} bytes`]
        : [false, "not an ICO file"];
    case "favicon-svg": {
      if (!/<svg\b/i.test(text)) return [false, "not an SVG"];
      if (/<script\b/i.test(text) || inlineCode(text).length) return [false, "an SVG that runs code"];
      return [true, "an SVG without script"];
    }
    default:
      return [false, `unknown root file ${probe.file}`];
  }
}

function rootFileChecks(ctx, probe, res) {
  const served = servedBy(res.headers, res.status);
  const ct = res.headers["content-type"] ?? "";
  const [ctRule, ctName] = ROOT_CONTENT_TYPES[probe.file] ?? [/$^/, "?"];
  if (served === "unknown") {
    if (ctx.mode === "after") return errorPageChecks(res, `HTTP 200 from the Worker (exact route ${ctx.host}${probe.path})`);
    return [check("served", "warn", `${errorPage(res.status)}; who would serve it is unknown`, { after_deploy: `HTTP 200 from the Worker, ${ctName}` })];
  }
  const items = [
    plain("status", res.status === 200, `HTTP ${res.status}`, "HTTP 200"),
    plain("served-by", served === "worker", servedByDetail(served, res.status), "served by the Worker"),
  ];
  if (res.status === 200 && served === "worker") {
    items.push(plain("content-type", ctRule.test(ct), `Content-Type ${ct || "(none)"}`, ctName));
    const [ok, detail] = rootFileContent(ctx, probe, res);
    items.push(check("content", ok ? "pass" : "fail", detail));
  }
  if (ctx.mode === "after") return items;
  if (!(res.status === 200 && served === "worker")) {
    return [check("served", "pass", `not served by the Worker yet (HTTP ${res.status}${served === "web-app" ? " from the web app" : ""})`, { after_deploy: `HTTP 200 from the Worker, ${ctName}` })];
  }
  const failing = items.filter((c) => c.level === "fail");
  return failing.length ? failing : [check("served", "warn", "already served by the Worker, as expected after the deploy")];
}

function redirectChecks(ctx, probe, res) {
  const target = `https://${ctx.host}/login`;
  const location = res.headers.location ?? "";
  let resolved = "";
  try {
    resolved = location ? new URL(location, probe.url).href : "";
  } catch {
    resolved = location;
  }
  const ok = (res.status === 301 || res.status === 308) && resolved === target;
  if (ok) return [check("https-redirect", "pass", `HTTP ${res.status} to ${resolved}`)];
  const observed = `HTTP ${res.status}${location ? ` to ${location}` : ", no redirect"}`;
  return [
    check(
      "https-redirect",
      ctx.expectHttpsRedirect ? "fail" : "warn",
      `${observed}; expected a 301 or 308 to ${target}${ctx.expectHttpsRedirect ? "" : " (a warning until the redirect rule exists; --expect-https-redirect makes it a failure)"}`,
    ),
  ];
}

const LEVELS = ["info", "pass", "warn", "fail"];
const PAGE_KINDS = new Set(["home", "page", "workers-dev", "web-app"]);
const worst = (checks) => checks.reduce((acc, c) => (LEVELS.indexOf(c.level) > LEVELS.indexOf(acc) ? c.level : acc), "pass");

/**
 * The result for one request. `res` is `{ status, headers (lower-case names), bytes: Buffer, text }`, or
 * `{ error }` when the request failed. `ctx` is `{ mode: "after" | "before", expectHttpsRedirect, host, paths, key, robotsTxt }`.
 */
export function evaluate(probe, res, ctx) {
  const base = { url: probe.url, kind: probe.kind, path: probe.path };
  if (res.error !== undefined) {
    const checks = [check("request", "fail", `request failed: ${res.error}`)];
    return { ...base, http_status: null, served_by: null, level: "fail", checks };
  }
  const served = servedBy(res.headers, res.status);
  const unknown = served === "unknown";
  // A page is read whatever its Content-Type says (a script in a page mislabelled text/plain still counts); any
  // other response only when it is HTML (the web app's not-found page, say). Cloudflare's own error page (a 5xx) is
  // not read at all: it is neither the Worker's page nor the web app's.
  const isHtml = /^text\/html\b/i.test(res.headers["content-type"] ?? "");
  const a = !unknown && (isHtml || PAGE_KINDS.has(probe.kind)) ? analyzeHtml(res.text) : null;
  const workerPage = (onHost) =>
    unknown
      ? errorPageChecks(res, "HTTP 200 from the Worker")
      : [plain("served-by", served === "worker", servedByDetail(served, res.status), "served by the Worker"), ...workerPageChecks(ctx, probe, res, a, { onHost })];
  let checks;
  switch (probe.kind) {
    case "page":
      // Before the deploy, a page of pages.json that the Worker answers with a 404 is one this deploy adds (the Worker
      // has not_found_handling "none"): expected, and listed with what the deploy should change. After it, a failure.
      if (ctx.mode === "before" && served === "worker" && res.status === 404) {
        checks = [check("status", "pass", "HTTP 404 from the Worker: not deployed yet, a page this deploy adds", { after_deploy: "HTTP 200 from the Worker, text/html" })];
        break;
      }
      checks = workerPage(true);
      break;
    case "workers-dev":
      checks = workerPage(false);
      break;
    case "home": {
      // Before the deploy "/" is a web app path, so a 5xx there is the web app down (a warning); after it, "/" must
      // be the Worker's page. Either way a 5xx gives no verdict on the route.
      if (unknown) {
        checks = ctx.mode === "before" ? webAppChecks(ctx, probe, res, a) : errorPageChecks(res, `HTTP 200 from the Worker's home page (exact route ${ctx.host}/)`);
        break;
      }
      const route = phased(ctx, "served-by", {
        before: served === "web-app",
        after: served === "worker",
        observed: servedByDetail(served, res.status),
        expectedBefore: "the web app",
        expectedAfter: `the Worker's home page (exact route ${ctx.host}/)`,
      });
      if (served === "worker") checks = [route, ...workerPageChecks(ctx, probe, res, a, { onHost: true })];
      else if (ctx.mode === "before") checks = [route, ...webAppChecks(ctx, probe, res, a)];
      else checks = [route, check("beacons", "info", `${a.beacons} Cloudflare Web Analytics beacon(s)`)];
      break;
    }
    case "web-app":
      checks = webAppChecks(ctx, probe, res, a);
      break;
    case "root-file":
      checks = rootFileChecks(ctx, probe, res);
      break;
    case "https-redirect":
      checks = redirectChecks(ctx, probe, res);
      break;
    default:
      checks = [check("kind", "fail", `unknown probe kind ${probe.kind}`)];
  }
  return {
    ...base,
    http_status: res.status,
    // A redirect from http to https carries no mark of who sent it (Cloudflare's edge, most likely): not reported.
    served_by: probe.kind === "https-redirect" && res.status >= 300 && res.status < 400 ? null : served,
    content_type: res.headers["content-type"] ?? null,
    location: res.headers.location ?? null,
    strict_transport_security: res.headers["strict-transport-security"] ?? null,
    x_robots_tag: res.headers["x-robots-tag"] ?? null,
    beacons: a ? a.beacons : null,
    other_scripts: a ? a.otherScripts.length : null,
    comments: a ? a.comments : null,
    canonical: a ? a.canonical : null,
    meta_robots: a ? a.metaRobots : null,
    level: worst(checks),
    checks,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------------------------

/** One GET as a browser sends it, redirects not followed. Never throws: a failed request is `{ error }`. */
export async function request(url, fetchImpl, timeoutMs = TIMEOUT_MS) {
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { ...REQUEST_HEADERS }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: response.status, headers, bytes, text: bytes.toString("utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Requests every probe (one at a time) and judges it. Returns the report.
 *
 * @param {{ site: ReturnType<typeof loadSite>, mode?: "after" | "before", expectHttpsRedirect?: boolean, fetch: typeof fetch, now?: () => Date }} options
 */
export async function verifyLive({ site, mode = "after", expectHttpsRedirect = false, fetch: fetchImpl, now = () => new Date() }) {
  const ctx = { mode, expectHttpsRedirect, host: site.host, paths: site.paths, key: site.key, robotsTxt: site.robotsTxt };
  const results = [];
  for (const probe of planProbes(site)) results.push(evaluate(probe, await request(probe.url, fetchImpl), ctx));
  const counts = { pass: 0, info: 0, warn: 0, fail: 0 };
  for (const r of results) for (const c of r.checks) counts[c.level] += 1;
  return {
    tool: "sites/landing/scripts/verify-live.mjs",
    mode: mode === "before" ? "before-deploy" : "after-deploy",
    expect_https_redirect: expectHttpsRedirect,
    host: site.host,
    workers_dev: site.workersDev ?? WORKERS_DEV,
    checked_at: now().toISOString(),
    request_headers: { ...REQUEST_HEADERS },
    ok: counts.fail === 0,
    counts,
    results,
  };
}

const pad = (s, n) => String(s).padEnd(n);

/** The report as a table, then every failure and warning, then (before a deploy) what the deploy should change. */
export function formatReport(report) {
  const lines = [];
  lines.push(`verify-live: ${report.mode === "before-deploy" ? "before the deploy (--before-deploy)" : "after the deploy"}, ${report.checked_at}`);
  lines.push(`${report.host} and ${report.workers_dev}, requested as a browser (User-Agent Chrome, Accept: text/html)`);
  lines.push("");
  lines.push(`${pad("RESULT", 7)}${pad("HTTP", 6)}${pad("SERVED BY", 10)}${pad("BEACONS", 9)}${pad("KIND", 15)}URL`);
  for (const r of report.results) {
    lines.push(`${pad(r.level.toUpperCase(), 7)}${pad(r.http_status ?? "-", 6)}${pad(r.served_by ?? "-", 10)}${pad(r.beacons ?? "-", 9)}${pad(r.kind, 15)}${r.url}`);
  }
  for (const level of ["fail", "warn"]) {
    const found = report.results.flatMap((r) => r.checks.filter((c) => c.level === level).map((c) => `  ${level.toUpperCase()} ${r.url}  ${c.id}: ${c.detail}`));
    if (found.length) lines.push("", level === "fail" ? "Failures:" : "Warnings:", ...found);
  }
  const changes = report.results.flatMap((r) => r.checks.filter((c) => c.after_deploy).map((c) => `  ${r.url}  ${c.id}: now ${c.detail}; after the deploy ${c.after_deploy}`));
  if (changes.length) lines.push("", "Expected to change with the deploy:", ...changes);
  const { fail, warn } = report.counts;
  lines.push("", `${report.ok ? "OK" : "FAILED"}: ${report.results.length} URLs, ${fail} failure(s), ${warn} warning(s).`);
  return `${lines.join("\n")}\n`;
}

/** Tests inject `fetch`; under vitest the real one is refused, so no test can reach the network by accident. */
function networkFetch() {
  if (process.env.VITEST) {
    return () => {
      throw new Error("verify-live.mjs: no network under vitest; pass a fetch");
    };
  }
  return globalThis.fetch;
}

/**
 * The CLI. Returns the exit code: 0 when nothing failed, 1 on a failure, 2 on a usage error. `deps` lets a test pass
 * its own `fetch`, site directory, output streams and clock.
 *
 * @param {string[]} argv
 * @param {{ fetch?: typeof fetch, siteDir?: string, stdout?: (s: string) => void, stderr?: (s: string) => void, now?: () => Date }} [deps]
 */
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  const options = { mode: "after", expectHttpsRedirect: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out(USAGE);
      return 0;
    }
    if (arg === "--before-deploy") options.mode = "before";
    else if (arg === "--expect-https-redirect") options.expectHttpsRedirect = true;
    else if (arg === "--json") {
      const file = argv[++i];
      if (!file || file.startsWith("--")) {
        err(`--json needs a file\n\n${USAGE}`);
        return 2;
      }
      options.json = file;
    } else {
      err(`Unknown option ${arg}\n\n${USAGE}`);
      return 2;
    }
  }
  // Before any request: a report that cannot be written is a usage error, not a surprise after 17 requests.
  const unwritable = options.json ? jsonTargetProblem(options.json) : null;
  if (unwritable) {
    err(`verify-live: cannot write the JSON report to ${options.json}: ${unwritable}\n`);
    return 2;
  }
  let site;
  try {
    site = loadSite(deps.siteDir);
  } catch (error) {
    err(`verify-live: ${error instanceof Error ? error.message : error}\n`);
    return 1;
  }
  const report = await verifyLive({ site, mode: options.mode, expectHttpsRedirect: options.expectHttpsRedirect, fetch: deps.fetch ?? networkFetch(), now: deps.now });
  out(formatReport(report));
  if (options.json) {
    try {
      writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
      out(`JSON report: ${options.json}\n`);
    } catch (error) {
      // The verdict above stands; a failed check still exits 1, a passing run 2 (the report asked for is missing).
      err(`verify-live: cannot write the JSON report to ${options.json}: ${error instanceof Error ? error.message : error}\n`);
      return report.ok ? 2 : 1;
    }
  }
  return report.ok ? 0 : 1;
}

/** Why `file` cannot take the JSON report (a directory, or a directory that is missing or not writable), or null. */
export function jsonTargetProblem(file) {
  const target = path.resolve(file);
  try {
    if (existsSync(target)) {
      if (statSync(target).isDirectory()) return "it is a directory";
      accessSync(target, constants.W_OK);
      return null;
    }
    const dir = path.dirname(target);
    if (!existsSync(dir)) return `no directory ${dir}`;
    if (!statSync(dir).isDirectory()) return `${dir} is not a directory`;
    accessSync(dir, constants.W_OK);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const invokedAsScript = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsScript) process.exitCode = await main(process.argv.slice(2));
