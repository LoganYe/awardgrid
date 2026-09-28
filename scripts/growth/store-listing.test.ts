/**
 * The Smart App Banner and the MobileApplication JSON-LD, which the switch to released adds under the App Store listing
 * amendment in DECISIONS.md. They live in a commit of their own, with this file: without that commit /ios/ still links
 * the listing as text, with no banner and no MobileApplication node (the variant for when that amendment is not
 * approved).
 *
 *   - /ios/ and /ios/zh-hans/ carry one <meta name="apple-itunes-app" content="app-id=6816321841">, and nothing else
 *     in it (no app-argument, no affiliate data): a meta tag, not a script.
 *   - /ios/'s JSON-LD @graph ends with the MobileApplication node: offers.url is the listing with no slug, and every
 *     string in it is registry copy, word for word; it names no other app, program or brand.
 *   - DECISIONS.md carries the App Store listing amendment.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanContent, trademarkTerms } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
const APP_ID: string = REGISTRY.released.app_id;
const LISTING = `https://apps.apple.com/app/id${APP_ID}`;
const ORIGIN = "https://awardgrid.dowhiz.com";
const claim = (id: string) => REGISTRY.claims.find((c: { claim_id: string }) => c.claim_id === id);
const page = (file: string) => readFileSync(path.join(ROOT, "sites", "landing", file), "utf8");
const head = (html: string) => /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? "";
const graphOf = (html: string) => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m?.[1] ?? "{}")["@graph"] as Array<Record<string, unknown>>;
};
/** Every string in a JSON value, however deep. */
const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

/** The node, with the registry's sentences for its text. */
const APP_NODE = {
  "@type": "MobileApplication",
  "@id": `${ORIGIN}/ios/#app`,
  name: "AwardGrid",
  operatingSystem: "iOS 18.0 or later",
  applicationCategory: "TravelApplication",
  publisher: { "@id": `${ORIGIN}/#org` },
  offers: { "@type": "Offer", price: 0, priceCurrency: "USD", url: LISTING },
  softwareRequirements: claim("prerequisite").allowed_copy,
  sameAs: [LISTING, "https://github.com/LoganYe/awardgrid"],
  description: "On your own seats.aero Pro key, AwardGrid for iPhone puts seats.aero's cached award availability for many routes and up to 92 days into one table.",
  disambiguatingDescription: `${claim("identity").allowed_copy} ${claim("affiliation").allowed_copy}`,
};

describe("the Smart App Banner (apple-itunes-app)", () => {
  it("is on the app's pages once the registry says released", () => {
    expect(REGISTRY.released.status).toBe("released");
  });

  it.each(["ios/index.html", "ios/zh-hans/index.html"])("%s: one meta with the app's id and nothing else", (file) => {
    const metas = [...head(page(file)).matchAll(/<meta\b[^>]*\bname="apple-itunes-app"[^>]*>/gi)].map((m) => m[0]);
    expect(metas).toEqual([`<meta name="apple-itunes-app" content="app-id=${APP_ID}" />`]);
  });

  it("is on no other page", () => {
    for (const file of ["index.html", "ios/award-grid/index.html", "privacy/index.html", "support/index.html"]) {
      expect(page(file), file).not.toMatch(/apple-itunes-app/);
    }
  });
});

describe("the MobileApplication JSON-LD", () => {
  const graph = graphOf(page("ios/index.html"));
  const node = graph.find((n) => n["@type"] === "MobileApplication");

  it("ends /ios/'s @graph, after the FAQPage, as drafted", () => {
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "FAQPage", "MobileApplication"]);
    expect(node).toEqual(APP_NODE);
  });

  it("links the listing with no slug, and the gate's schema check passes it in released mode only", () => {
    expect((node!.offers as { url: string }).url).toBe(LISTING);
    const html = page("ios/index.html");
    const schema = (status: string) =>
      scanContent(html, { logical: "sites/landing/ios/index.html", status, registry: REGISTRY, root: ROOT }).filter((f: { rule: string }) => f.rule === "SCHEMA_JSON");
    expect(schema("released")).toEqual([]);
    expect(schema("submitted").length).toBe(1);
  });

  it("says only what the registry says: its text is registry copy, word for word", () => {
    expect(claim("grid").allowed_copy_extra).toContain(APP_NODE.description);
    expect(REGISTRY.released.minimum_ios).toBe("18.0");
    expect(REGISTRY.released.platforms).toEqual(["iPhone"]);
  });

  it("names no other app, program or brand: only seats.aero and Anthropic, as the dependency and the disclaimer do", () => {
    const text = stringsIn(node).join("\n");
    const terms = trademarkTerms(ROOT).filter((term): term is string => typeof term === "string");
    const named = terms.filter((term) => new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text));
    expect(named.sort()).toEqual(["Anthropic", "seats.aero"]);
  });
});

describe("DECISIONS.md, the App Store listing amendment", () => {
  it("amends the zero-network decision and supersedes the no-badge decision, in paragraphs under them", () => {
    const decisions = readFileSync(path.join(ROOT, "DECISIONS.md"), "utf8");
    // Each paragraph on one line, so filling in a date and re-wrapping the lines does not break this.
    const paragraphs = decisions.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim());
    const at = (re: RegExp) => paragraphs.findIndex((p) => re.test(p));
    const zeroNetwork = at(/^- \*\*The landing site ships zero JavaScript and makes zero network requests\.\*\*/);
    const noBadge = at(/^- \*\*The landing page carries NO App Store badge, and says why on the page\.\*\*/);
    const banner = at(
      /^Amended \S+: no executable script in the pages' source \(Cloudflare adds its Web Analytics beacon at the edge, as the privacy policy says\); Safari may fetch the Smart App Banner from Apple\.$/,
    );
    const superseded = at(/^Amended \S+: After Apple approved 1\.0 on [^,]+, \/ios\/ links the listing; the earlier no-badge decision is superseded\.$/);
    expect([zeroNetwork, noBadge, banner, superseded].every((i) => i >= 0)).toBe(true);
    // Under the entries they amend: each after its entry and before the next entry.
    expect(zeroNetwork < banner && banner < noBadge).toBe(true);
    expect(noBadge < superseded && paragraphs.slice(noBadge + 1, superseded).every((p) => p.startsWith("Amended "))).toBe(true);
  });
});
