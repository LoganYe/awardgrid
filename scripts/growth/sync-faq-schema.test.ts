/**
 * scripts/growth/sync-faq-schema.mjs: the FAQPage JSON-LD is written from the FAQ a page shows (a port of Restful's
 * tool/aso/test_sync_faq_schema.py). The failure the script exists to prevent is an answer silently left out of the
 * JSON-LD or left stale in it, so most of these tests are about failing loudly: markup the convention does not allow,
 * a guard that does not share the parser's blind spots, and --check on every kind of drift. The shipped pages are
 * checked by sites/landing/test/faq.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FaqMarkupError, extractFaq, faqPageNode, formatJson, guardCount, main, parseArgs, syncPage, visibleText } from "./sync-faq-schema.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "sync-faq-schema.mjs");
const ORIGIN = "https://awardgrid.dowhiz.com";

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sync-faq-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** The site graph as the pages write it by hand (sites/landing/ios/index.html before it had an FAQ), indented as there. */
const SITE_BLOCK = `    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": "${ORIGIN}/#org",
            "name": "Curastone CORP."
          },
          {
            "@type": "WebSite",
            "@id": "${ORIGIN}/#website",
            "name": "AwardGrid",
            "url": "${ORIGIN}/",
            "publisher": { "@id": "${ORIGIN}/#org" }
          }
        ]
      }
    </script>
`;

const FAQ = `      <section class="faq" data-faq aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <h3>Is the availability live?</h3>
        <p>
          No. Results are seats.aero's cached availability, not a live search.
        </p>
        <h3>Will it alert me?</h3>
        <p>No. Watches are checked when you open the app.</p>
      </section>
`;

/** A page: a head (with `head` inside it, the site graph by default) and a main holding `body`. */
function page(body: string, { head = SITE_BLOCK, lang = "en", canonical = `${ORIGIN}/ios/` } = {}): string {
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <title>AwardGrid</title>
    <link rel="canonical" href="${canonical}" />
${head}    <link rel="stylesheet" href="../styles.css" />
  </head>
  <body>
    <main>
${body}    </main>
  </body>
</html>
`;
}

/** Every JSON-LD block of a page, parsed. */
const jsonLd = (html: string): unknown[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1] ?? ""));
type Node = Record<string, unknown> & { mainEntity?: Array<{ name: string; inLanguage?: string; acceptedAnswer: { text: string } }> };
const graphOf = (html: string) => (jsonLd(html)[0] as { "@graph": Node[] })["@graph"];
const faqNodes = (html: string): Node[] => jsonLd(html).flatMap((v) => ((v as { "@graph"?: Node[] })["@graph"] ?? [v]) as Node[]).filter((n) => n["@type"] === "FAQPage");
const questions = (html: string) => faqNodes(html).flatMap((n) => n.mainEntity ?? []).map((q) => q.name);

/** The FaqMarkupError extractFaq throws for a page with this body, as its message. */
function markupError(body: string, opts?: Parameters<typeof page>[1]): string {
  try {
    extractFaq(page(body, opts));
  } catch (error) {
    expect(error).toBeInstanceOf(FaqMarkupError);
    return (error as Error).message;
  }
  throw new Error("expected a FaqMarkupError");
}

/** Run the script as a process in `cwd`. */
const run = (args: string[], cwd = ROOT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

/** A page written to a temp file, for the CLI. */
function pageFile(html: string, name = "index.html"): string {
  const file = path.join(tempDir(), name);
  writeFileSync(file, html);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the FAQ
// ---------------------------------------------------------------------------------------------------------------

describe("reading the FAQ a page shows", () => {
  it("reads each <h3> as a question and the <p>s after it as its answer; the heading is neither", () => {
    expect(extractFaq(page(FAQ))).toEqual([
      { question: "Is the availability live?", answer: "No. Results are seats.aero's cached availability, not a live search." },
      { question: "Will it alert me?", answer: "No. Watches are checked when you open the app." },
    ]);
  });

  it("joins an answer's paragraphs with a blank line, and leaves the <p>s before the first question out", () => {
    const body = FAQ.replace('<h2 id="faq-h">Questions</h2>', '<h2 id="faq-h">Questions</h2>\n<p>Short answers.</p>').replace(
      "<p>No. Watches are checked when you open the app.</p>",
      "<p>No. Watches are checked when you open the app.</p>\n<p>There is no notification.</p>",
    );
    const faq = extractFaq(page(body));
    expect(faq[1]?.answer).toBe("No. Watches are checked when you open the app.\n\nThere is no notification.");
    expect(JSON.stringify(faq)).not.toContain("Short answers.");
  });

  it("reads text as a reader sees it: inline markup read through, a <br> a space, entities decoded, whitespace collapsed", () => {
    expect(visibleText('Data: <a href="https://seats.aero">seats.aero</a>, <em>not</em>\n   live.')).toBe("Data: seats.aero, not live.");
    expect(visibleText("It&rsquo;s cached &amp; dated &mdash; see&nbsp;below.<br>Next line")).toBe("It\u2019s cached & dated \u2014 see\u00a0below. Next line");
    expect(visibleText("&#x4E2D;&#25991;")).toBe("中文");
    expect(visibleText('Get <u>real</u>-time <span class="x">data</span>')).toBe("Get real-time data");
  });

  it("keeps an apostrophe and quotes in the copy (Restful's test_apostrophe_in_copy_survives)", () => {
    const body = FAQ.replace("Will it alert me?", "Does it need your phone's microphone?").replace(
      "No. Watches are checked when you open the app.",
      'No. A route it does not monitor is marked "not monitored".',
    );
    const synced = syncPage(page(body)).html;
    expect(questions(synced)).toEqual(["Is the availability live?", "Does it need your phone's microphone?"]);
    expect(faqNodes(synced)[0]?.mainEntity?.[1]?.acceptedAnswer.text).toBe('No. A route it does not monitor is marked "not monitored".');
  });

  it("makes one list of every data-faq section's questions, in page order, and marks a section in another language", () => {
    const zh = `      <section id="zh" lang="zh-Hans" aria-labelledby="zh-h">
        <h2 id="zh-h">中文</h2>
        <section class="faq" data-faq aria-labelledby="zh-h">
          <h3>结果是实时的吗？</h3>
          <p>不是。</p>
        </section>
      </section>
`;
    const faq = extractFaq(page(FAQ + zh));
    expect(faq.map((q) => q.question)).toEqual(["Is the availability live?", "Will it alert me?", "结果是实时的吗？"]);
    expect(faq.map((q) => q.lang)).toEqual([undefined, undefined, "zh-Hans"]);
    const node = faqNodes(syncPage(page(FAQ + zh)).html)[0];
    expect(node?.inLanguage).toBe("en");
    expect(node?.mainEntity?.map((q) => q.inLanguage)).toEqual([undefined, undefined, "zh-Hans"]);
  });

  it("does not read a commented-out question, or markup inside a script", () => {
    const body = FAQ.replace("<h3>Will it alert me?</h3>", "<!-- <h3>Old question?</h3><p>Old.</p> -->\n<h3>Will it alert me?</h3>");
    expect(extractFaq(page(body)).map((q) => q.question)).toEqual(["Is the availability live?", "Will it alert me?"]);
    const script = '<script type="application/ld+json">{"x": "<section data-faq>"}</script>\n';
    expect(extractFaq(page("<p>No FAQ here.</p>\n", { head: script }))).toEqual([]);
  });

  it("a page with no data-faq section has no questions", () => {
    expect(extractFaq(page("<h3>A heading</h3><p>Text.</p>\n"))).toEqual([]);
  });
});

describe("failing loudly instead of dropping an answer", () => {
  it.each([
    ["a list in an answer", FAQ.replace("<p>No. Watches are checked when you open the app.</p>", "<ul><li>No.</li></ul>"), /<ul> in the FAQ/],
    ["a block inside a <p>", FAQ.replace("<p>No. Watches", "<p><div>No.</div> Watches"), /<div> inside an FAQ <p>/],
    ["a wrapper around a question and its answer", FAQ.replace("<h3>Will it alert me?</h3>", "<div><h3>Will it alert me?</h3>").replace("open the app.</p>", "open the app.</p></div>"), /<div> in the FAQ/],
    ["a question with no answer", FAQ.replace("<p>No. Watches are checked when you open the app.</p>", ""), /"Will it alert me\?" has no answer/],
    ["text outside a <p>", FAQ.replace("<h3>Will it alert me?</h3>", "Loose text.\n<h3>Will it alert me?</h3>"), /text outside a question or an answer: "Loose text\."/],
    ["an unclosed <p>", FAQ.replace("open the app.</p>", "open the app."), /<p> is never closed/],
    ["an unknown entity", FAQ.replace("Will it alert me?", "Will it alert me&unknownthing;"), /&unknownthing; is a character reference/],
    ["a hidden answer", FAQ.replace("<p>No. Watches", "<p hidden>No. Watches"), /a hidden <p>/],
    ["a hidden span", FAQ.replace("No. Watches", '<span hidden="">No.</span> Watches'), /a hidden <span>/],
    ["an empty question", FAQ.replace("<h3>Will it alert me?</h3>", "<h3> </h3>"), /an empty question/],
    ["a heading after the first question", FAQ.replace("<h3>Will it alert me?</h3>", "<h2>More</h2><h3>Will it alert me?</h3>"), /<h2> in the FAQ: after the first question/],
    ["no question at all", '<section class="faq" data-faq aria-labelledby="faq-h"><h2 id="faq-h">Questions</h2></section>\n', /holds no question/],
    ["a section never closed", FAQ.replace("</section>", ""), /never closed/],
    ["data-faq on a <div>", '<div data-faq><h3>Q?</h3><p>A.</p></div>\n', /data-faq is on a <div>/],
    ["a data-faq section inside another", FAQ.replace("</section>", '<section class="faq" data-faq aria-labelledby="faq-h"><h3>Q?</h3><p>A.</p></section></section>'), /inside another/],
    ["no class faq", FAQ.replace('class="faq" ', ""), /needs class="faq"/],
    ["no aria-labelledby", FAQ.replace(' aria-labelledby="faq-h"', ""), /needs an aria-labelledby/],
    ["an aria-labelledby that names nothing", FAQ.replace('aria-labelledby="faq-h"', 'aria-labelledby="nope"'), /names "nope"/],
  ])("%s", (_label, body, message) => {
    expect(markupError(body)).toMatch(message);
  });

  it("the guard counts the section's <h3>s and <p>s by a plain pattern, independent of the parser", () => {
    const inner = "<h2>Q</h2><p>Intro.</p><h3>One?</h3><p>A.</p><h3>Two?</h3><p>B.</p><p>C.</p>";
    expect(() => guardCount(inner, [{ paragraphs: ["A."] }, { paragraphs: ["B.", "C."] }])).not.toThrow();
    // A parser that dropped the second question, or a paragraph, is caught (Restful: "contains 2 objects").
    expect(() => guardCount(inner, [{ paragraphs: ["A."] }])).toThrow(/contains 2 <h3> and 3 <p>/);
    expect(() => guardCount(inner, [{ paragraphs: ["A."] }, { paragraphs: ["B."] }])).toThrow(/Fix the parser rather than ship a partial FAQPage/);
  });

  it("refuses an FAQ on a page with no canonical link (the FAQPage's @id is the canonical URL)", () => {
    expect(() => syncPage(page(FAQ).replace(/ *<link rel="canonical"[^>]*>\n/, ""))).toThrow(/no <link rel="canonical">/);
  });

  it("refuses a JSON-LD block that does not parse", () => {
    expect(() => syncPage(page(FAQ, { head: '<script type="application/ld+json">{"a": 1,}</script>\n' }))).toThrow(/does not parse/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Writing the JSON-LD
// ---------------------------------------------------------------------------------------------------------------

describe("the FAQPage it writes", () => {
  it("goes into the page's @graph after the nodes already there, and changes nothing else on the page", () => {
    const before = page(FAQ);
    const { html, entries } = syncPage(before);
    expect(entries).toHaveLength(2);
    const graph = graphOf(html);
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "FAQPage"]);
    expect(graph[2]).toEqual({
      "@type": "FAQPage",
      "@id": `${ORIGIN}/ios/#faq`,
      inLanguage: "en",
      isPartOf: { "@id": `${ORIGIN}/#website` },
      mainEntity: [
        { "@type": "Question", name: "Is the availability live?", acceptedAnswer: { "@type": "Answer", text: "No. Results are seats.aero's cached availability, not a live search." } },
        { "@type": "Question", name: "Will it alert me?", acceptedAnswer: { "@type": "Answer", text: "No. Watches are checked when you open the app." } },
      ],
    });
    // Only lines were added: the hand-written nodes keep their formatting, the rest of the page is untouched.
    const beforeLines = before.split("\n");
    const afterLines = html.split("\n");
    let i = 0;
    for (const line of afterLines) if (line === beforeLines[i]) i++;
    expect(i).toBe(beforeLines.length);
    expect(html).toContain(`            "publisher": { "@id": "${ORIGIN}/#org" }\n          },\n          {\n            "@type": "FAQPage",\n            "@id": "${ORIGIN}/ios/#faq",\n            "inLanguage": "en",\n            "isPartOf": { "@id": "${ORIGIN}/#website" },\n            "mainEntity": [`);
  });

  it("writes the pages' hand-written style: two-space indents, an object of only @id on one line", () => {
    const value = JSON.parse(SITE_BLOCK.replace(/<\/?script[^>]*>/g, ""));
    const content = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(SITE_BLOCK)?.[1];
    expect(`\n      ${formatJson(value, "      ")}\n    `).toBe(content);
    expect(formatJson({ a: [], b: {}, c: [1, true, null], d: { "@id": "x", name: "y" } })).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    1,\n    true,\n    null\n  ],\n  "d": {\n    "@id": "x",\n    "name": "y"\n  }\n}',
    );
  });

  it("writes < as \\u003c, so no answer can close the script or open a comment", () => {
    const body = FAQ.replace("Will it alert me?", "What does &lt;/script&gt; or &lt;!-- do?");
    const { html } = syncPage(page(body));
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(block).not.toMatch(/<\/script|<!--/i);
    expect(block).toContain("What does \\u003c/script> or \\u003c!-- do?");
    expect(questions(html)).toContain("What does </script> or <!-- do?");
  });

  it("gets a block of its own, with @context, on a page without a @graph: after its JSON-LD, or before </head>", () => {
    const other = '    <script type="application/ld+json">\n      {\n        "@context": "https://schema.org",\n        "@type": "WebPage"\n      }\n    </script>\n';
    const after = syncPage(page(FAQ, { head: other })).html;
    expect(jsonLd(after)).toHaveLength(2);
    expect(after).toContain(`    </script>\n    <script type="application/ld+json">\n      {\n        "@context": "https://schema.org",\n        "@type": "FAQPage",`);
    const none = syncPage(page(FAQ, { head: "" })).html;
    expect(jsonLd(none)).toHaveLength(1);
    expect(none).toContain(`    <script type="application/ld+json">\n      {\n        "@context": "https://schema.org",\n        "@type": "FAQPage",`);
    expect(none.indexOf("FAQPage")).toBeLessThan(none.indexOf("</head>"));
    expect((jsonLd(none)[0] as Node).isPartOf).toBeUndefined();
  });

  it("replaces a stale FAQPage where it is, and leaves one FAQPage when a page had two", () => {
    const written = syncPage(page(FAQ)).html;
    const edited = written.replace("<h3>Will it alert me?</h3>", "<h3>Does it send notifications?</h3>");
    const resynced = syncPage(edited);
    expect(resynced.reason).toMatch(/question 2: the page asks "Does it send notifications\?", FAQPage has "Will it alert me\?"/);
    expect(questions(resynced.html)).toEqual(["Is the availability live?", "Does it send notifications?"]);
    expect(graphOf(resynced.html).map((n) => n["@type"])).toEqual(["Organization", "WebSite", "FAQPage"]);

    const extra = '    <script type="application/ld+json">\n      {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": []}\n    </script>\n';
    const twice = syncPage(page(FAQ, { head: SITE_BLOCK + extra }));
    expect(faqNodes(twice.html)).toHaveLength(1);
    expect(jsonLd(twice.html)).toHaveLength(1);
    expect(twice.html).not.toContain('"mainEntity": []');
  });

  it("removes the FAQPage of a page whose FAQ was removed, and a block that held only it", () => {
    const written = syncPage(page(FAQ)).html;
    const without = written.replace(/ *<section class="faq"[\s\S]*?<\/section>\n/, "      <p>No questions now.</p>\n");
    const synced = syncPage(without);
    expect(synced.reason).toMatch(/no data-faq section but its JSON-LD has an FAQPage/);
    expect(synced.html).toBe(page("      <p>No questions now.</p>\n"));

    const own = syncPage(page(FAQ, { head: "" })).html;
    const ownWithout = own.replace(/ *<section class="faq"[\s\S]*?<\/section>\n/, "");
    expect(syncPage(ownWithout).html).toBe(page("", { head: "" }));
  });

  it("is idempotent, and a page without an FAQ or FAQPage is returned as it is", () => {
    const once = syncPage(page(FAQ)).html;
    expect(syncPage(once)).toEqual({ html: once, entries: extractFaq(once), reason: null });
    const plain = page("<p>Hello.</p>\n");
    expect(syncPage(plain)).toEqual({ html: plain, entries: [], reason: null });
  });

  it("builds the node with @context only when it stands alone, and isPartOf only when the page names its WebSite", () => {
    const entries = [{ question: "Q?", answer: "A." }];
    expect(faqPageNode(entries, { pageUrl: `${ORIGIN}/x/` })).toEqual({
      "@type": "FAQPage",
      "@id": `${ORIGIN}/x/#faq`,
      mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }],
    });
    expect(Object.keys(faqPageNode(entries, { pageUrl: "u", websiteId: "w", language: "zh-Hans", context: true }))).toEqual(["@context", "@type", "@id", "inLanguage", "isPartOf", "mainEntity"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------

describe("--check and --write", () => {
  it("--check passes a page in sync and prints its summary", () => {
    const file = pageFile(syncPage(page(FAQ)).html);
    const r = run(["--check", file]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/sync-faq-schema --check: pages=1 with an FAQ=1 questions=2 out of date=0 markup errors=0 \(in sync\)/);
  });

  it.each([
    ["an edited answer", (h: string) => h.replace("open the app.</p>", "open or return to the app.</p>"), /question 2 \("Will it alert me\?"\): FAQPage's answer is not the page's/],
    ["a new question", (h: string) => h.replace("</section>", "<h3>Is it free?</h3><p>Yes.</p></section>"), /FAQPage lists 2 questions; the page shows 3/],
    ["a hand-formatted FAQPage", (h: string) => h.replace('"isPartOf": { "@id"', '"isPartOf": {"@id"'), /formatting differ/],
    ["no FAQPage at all", () => page(FAQ), /shows 2 questions and has no FAQPage JSON-LD/],
  ])("--check fails on %s, and --write fixes it", (_label, change, reason) => {
    const file = pageFile(change(syncPage(page(FAQ)).html));
    const check = run(["--check", file]);
    expect(check.status).toBe(1);
    expect(check.stderr).toMatch(reason);
    expect(check.stderr).toContain("Run: node scripts/growth/sync-faq-schema.mjs --write");
    const write = run(["--write", file]);
    expect(write.status, write.stdout + write.stderr).toBe(0);
    expect(write.stdout).toMatch(/wrote .*index\.html \(\d questions\)/);
    expect(run(["--check", file]).status).toBe(0);
  });

  it("reports markup that breaks the convention with its line, exits 1, and --write leaves that page alone", () => {
    const html = page(FAQ.replace("<p>No. Watches are checked when you open the app.</p>", "<ul><li>No.</li></ul>"));
    const file = pageFile(html);
    for (const mode of ["--check", "--write"]) {
      const r = run([mode, file]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`FAQ_MARKUP .*index\\.html:${html.split("\n").findIndex((l) => l.includes("<ul>")) + 1}: <ul> in the FAQ`));
    }
    expect(readFileSync(file, "utf8")).toBe(html);
  });

  it("reads every index.html under <root>/sites/landing without page arguments (build output, public/ and test/ aside)", () => {
    const root = tempDir();
    const site = path.join(root, "sites", "landing");
    for (const dir of ["", "ios", "ios/zh-hans", "dist", "dist/ios", "public", "test/fixtures", "node_modules/x"]) mkdirSync(path.join(site, dir), { recursive: true });
    writeFileSync(path.join(site, "index.html"), page("<p>Home.</p>\n", { canonical: `${ORIGIN}/` }));
    writeFileSync(path.join(site, "ios", "index.html"), syncPage(page(FAQ)).html);
    writeFileSync(path.join(site, "ios", "zh-hans", "index.html"), page(FAQ, { lang: "zh-Hans", canonical: `${ORIGIN}/ios/zh-hans/` }));
    for (const dir of ["dist", "dist/ios", "public", "test/fixtures", "node_modules/x"]) writeFileSync(path.join(site, dir, "index.html"), page(FAQ));

    const check = run(["--check", "--root", root]);
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("pages=3 with an FAQ=2 questions=4 out of date=1");
    expect(check.stderr).toContain("FAQ_SCHEMA sites/landing/ios/zh-hans/index.html: the page shows 2 questions and has no FAQPage JSON-LD");
    expect(check.stdout).toContain("FAQ on sites/landing/ios/index.html (2), sites/landing/ios/zh-hans/index.html (2)");

    const write = run(["--write", "--root", root]);
    expect(write.status, write.stderr).toBe(0);
    expect(write.stdout).toContain("written=1");
    expect(faqNodes(readFileSync(path.join(site, "ios", "zh-hans", "index.html"), "utf8"))[0]?.inLanguage).toBe("zh-Hans");
    expect(readFileSync(path.join(site, "dist", "index.html"), "utf8")).toBe(page(FAQ));
    expect(run(["--check", "--root", root]).status).toBe(0);
  });

  it.each([
    [[], /pass --check or --write/],
    [["--check", "--write"], /two different runs/],
    [["--check", "--nope"], /unknown argument --nope/],
    [["--check", "--root"], /--root needs a value/],
  ])("usage error %j exits 2", (args, message) => {
    const r = run(args as string[]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(message);
    expect(r.stderr).toContain("usage: node scripts/growth/sync-faq-schema.mjs");
  });

  it("a page that does not exist exits 2; --help exits 0", () => {
    const r = run(["--check", path.join(tempDir(), "missing.html")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/sync-faq-schema: .*missing\.html/);
    expect(run(["--help"]).status).toBe(0);
  });

  it("parses its arguments", () => {
    expect(parseArgs(["--write", "a.html", "b.html", "--root", "/r"])).toEqual({ mode: "write", root: "/r", files: ["a.html", "b.html"] });
    expect(parseArgs(["--check", "--check"])).toEqual({ mode: "check", files: [] });
  });

  it("main() in-process: the summary goes to log, findings to error", () => {
    const out: string[] = [];
    const err: string[] = [];
    const file = pageFile(page(FAQ));
    expect(main(["--check", file], { log: (s: string) => out.push(s), error: (s: string) => err.push(s) })).toBe(1);
    expect(err[0]).toMatch(/^FAQ_SCHEMA .*index\.html: the page shows 2 questions/);
    expect(out.join("\n")).toMatch(/out of date=1/);
  });
});

describe("the repository", () => {
  it("every page of the site is in sync (Restful's test_repo_is_in_sync)", () => {
    const r = run(["--check"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(in sync\)/);
  });
});
