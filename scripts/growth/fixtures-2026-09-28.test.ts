/**
 * Regression on 2026-09-28's public content: the gate must find exactly what was wrong that day, in each status.
 *
 * Fixtures (scripts/growth/fixtures/2026-09-28/):
 *   live/{ios,privacy,support}/index.html  the HTML https://awardgrid.dowhiz.com/{ios,privacy,support}/ served at
 *       2026-09-28T06:26Z to a browser user agent. Two values are redacted, nothing else is changed: the Cloudflare Web
 *       Analytics beacon token (the script tag is kept) and the support address (support@example.com, as in CI).
 *       Scanned as a built site (--dist): comments and scripts count.
 *   src-10c8e36/…  `git show 10c8e36:<path>` of every public file on origin/main that day: the four landing pages,
 *       LEGAL.md and README.md. Scanned as source. README.md is read up to its first "## " heading: that intro was its
 *       public description, the part the public-claims markers now wrap; the rest is developer documentation, which
 *       the registry lists as not marketing.
 *
 * No exemptions apply here (these are the raw rules); the registry's exact-copy sentences and pending claims do.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanContent } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIXTURES = path.join(import.meta.dirname, "fixtures", "2026-09-28");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
const STATUSES = ["submitted", "released", "withdrawn"] as const;

const LIVE = ["ios", "privacy", "support"].map((page) => ({ path: path.join(FIXTURES, "live", page, "index.html"), logical: `sites/landing/${page}/index.html`, dist: true }));
const SOURCE = ["sites/landing/index.html", "sites/landing/ios/index.html", "sites/landing/privacy/index.html", "sites/landing/support/index.html", "LEGAL.md", "README.md"].map(
  (file) => ({ path: path.join(FIXTURES, "src-10c8e36", file), logical: file, dist: false }),
);

function findings(files: ReadonlyArray<{ path: string; logical: string; dist: boolean }>, status: (typeof STATUSES)[number]): string[] {
  return files
    .flatMap(({ path: file, logical, dist }) => {
      let text = readFileSync(file, "utf8");
      if (logical === "README.md") text = text.slice(0, text.indexOf("\n## "));
      return scanContent(text, { logical, file: logical, dist, status, registry: REGISTRY, root: ROOT }).map(
        (f: { rule: string; line: number; match: string }) => `${f.rule} ${logical}:${f.line} ${f.match}`,
      );
    })
    .sort();
}

// ---- What the pages served on 2026-09-28 got wrong, in every status ----
const LIVE_ALWAYS = [
  // /ios/ still said "It is not on the App Store: its developer is testing it privately, through TestFlight."
  // Version 1.0 was submitted for review on 2026-09-26; the source was corrected in 5e36109 (PR #103).
  "STALE_STATUS sites/landing/ios/index.html:164 testing it privately",
  // Its lead described a cell as the web app's table does ("the cheapest award seat in each cell, with the miles, the
  // fees, the seats left, the program that sells it, …"), the wording grid.retired_copy holds; version 1.0's App
  // Store description says the same.
  "PENDING_CLAIM_TEXT sites/landing/ios/index.html:26 the cheapest award seat in each cell",
  "PENDING_CLAIM_TEXT sites/landing/ios/index.html:26 the miles, the fees, the seats left, the program that sells it",
  // The "No accounts, no analytics" row names no subject; the web app on the same host has accounts and a server.
  "NO_SERVER_SUBJECT sites/landing/ios/index.html:143 No accounts",
  "NO_SERVER_SUBJECT sites/landing/ios/index.html:145 no server",
  // The build copied the source comments into the served pages: 6 on /ios/, 1 each on /privacy/ and /support/.
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:11 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:23 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:31 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:74 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:102 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/ios/index.html:153 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/privacy/index.html:11 <!--",
  "HTML_COMMENT_IN_DIST sites/landing/support/index.html:11 <!--",
  // A script the source does not have: Cloudflare Web Analytics, injected at the edge into every served page.
  'SCRIPT_NOT_LD_JSON sites/landing/ios/index.html:180 <script type="module" src="https://static.cloudflareinsights',
  'SCRIPT_NOT_LD_JSON sites/landing/privacy/index.html:279 <script type="module" src="https://static.cloudflareinsights',
  'SCRIPT_NOT_LD_JSON sites/landing/support/index.html:141 <script type="module" src="https://static.cloudflareinsights',
  // "Data: seats.aero" with no link to seats.aero: the table caption and footer of /ios/, the footer of /privacy/,
  // and the About sections (English and Chinese) and footer of /support/.
  "ATTRIBUTION_LINK sites/landing/ios/index.html:70 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/ios/index.html:175 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/privacy/index.html:275 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:89 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:129 数据：seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:136 Data: seats.aero",
  // "AwardGrid has no accounts and no server of its own." and 没有账号，也没有自己的服务器: the subject is AwardGrid,
  // which is also the web app's name, not the iPhone app.
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:38 no accounts",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:38 no server",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:191 没有账号",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:191 没有自己的服务器",
];
// "It is not on the App Store" was true while the app was not live; it is stale once the app is released.
const LIVE_RELEASED_ONLY = ["STALE_STATUS sites/landing/ios/index.html:163 not on the App Store"];

// ---- The same, in the source at 10c8e36 ----
const SOURCE_ALWAYS = [
  // The pages' own text is the served text, less the comments (allowed in source; the build strips them) and the
  // injected script; plus the site's root page, which the live capture did not include (on the host, "/" is the web app).
  "ATTRIBUTION_LINK sites/landing/index.html:30 Data: seats.aero",
  "STALE_STATUS sites/landing/ios/index.html:164 testing it privately",
  "PENDING_CLAIM_TEXT sites/landing/ios/index.html:26 the cheapest award seat in each cell",
  "PENDING_CLAIM_TEXT sites/landing/ios/index.html:26 the miles, the fees, the seats left, the program that sells it",
  "NO_SERVER_SUBJECT sites/landing/ios/index.html:143 No accounts",
  "NO_SERVER_SUBJECT sites/landing/ios/index.html:145 no server",
  "ATTRIBUTION_LINK sites/landing/ios/index.html:70 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/ios/index.html:175 Data: seats.aero",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:38 no accounts",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:38 no server",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:191 没有账号",
  "NO_SERVER_SUBJECT sites/landing/privacy/index.html:191 没有自己的服务器",
  "ATTRIBUTION_LINK sites/landing/privacy/index.html:275 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:89 Data: seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:129 数据：seats.aero",
  "ATTRIBUTION_LINK sites/landing/support/index.html:136 Data: seats.aero",
  // LEGAL.md: "The iOS app (AwardGrid) is tested privately through Apple's TestFlight and is not on the App Store."
  "STALE_STATUS LEGAL.md:5 tested privately",
  "STALE_STATUS LEGAL.md:5 through Apple's TestFlight and is not",
  // "… with invite-only registration": the web app, described outside the registered history and webapp_note sentences.
  "PRIVATE_WEBAPP LEGAL.md:4 invite-only",
  // README.md's intro: "Private, friends-only award-flight grid … Non-commercial, invite-only, fewer than ten users".
  "PRIVATE_WEBAPP README.md:3 Private",
  "PRIVATE_WEBAPP README.md:3 friends-only",
  "PRIVATE_WEBAPP README.md:5 invite-only",
  // The web app's worker "pushed to the user's own Telegram chat": true of the web app, never of the iPhone app, and
  // in the intro that described the product. It now sits outside the public-claims markers.
  "ALERT README.md:15 pushed",
];
const SOURCE_RELEASED_ONLY = [
  "STALE_STATUS sites/landing/ios/index.html:163 not on the App Store",
  // "a personal, non-commercial tool for its author and fewer than ten friends" … "is not on the App Store".
  "STALE_STATUS LEGAL.md:3 fewer than ten",
  "STALE_STATUS LEGAL.md:5 not on the App Store",
  "STALE_STATUS README.md:3 friends-only",
  "STALE_STATUS README.md:5 fewer than ten",
];

describe("2026-09-28 regression: the pages served that day", () => {
  it("the fixtures are redacted: no beacon token, no personal address", () => {
    for (const { path: file } of LIVE) {
      const html = readFileSync(file, "utf8");
      expect(html).toContain('"token":"REDACTED"');
      expect(html).not.toMatch(/"token":"[0-9a-f]{16,}"/);
      expect(html).not.toMatch(/[\w.+-]+@(?!example\.com\b)[\w-]+\.[a-z]{2,}/i);
    }
  });

  it.each(STATUSES)("finds exactly the expected problems in %s mode", (status) => {
    const expected = status === "released" ? [...LIVE_ALWAYS, ...LIVE_RELEASED_ONLY] : LIVE_ALWAYS;
    expect(findings(LIVE, status)).toEqual([...expected].sort());
  });

  it("finds nothing premature: no page claimed a listing that did not exist", () => {
    for (const status of STATUSES) expect(findings(LIVE, status).filter((f) => /PREMATURE|WITHDRAWN|SCHEMA/.test(f))).toEqual([]);
  });
});

describe("2026-09-28 regression: the public source at 10c8e36", () => {
  it.each(STATUSES)("finds exactly the expected problems in %s mode", (status) => {
    const expected = status === "released" ? [...SOURCE_ALWAYS, ...SOURCE_RELEASED_ONLY] : SOURCE_ALWAYS;
    expect(findings(SOURCE, status)).toEqual([...expected].sort());
  });

  it("reads the whole README intro, so the regression is not vacuous", () => {
    const intro = readFileSync(path.join(FIXTURES, "src-10c8e36", "README.md"), "utf8");
    expect(intro.indexOf("\n## ")).toBeGreaterThan(500);
  });
});
