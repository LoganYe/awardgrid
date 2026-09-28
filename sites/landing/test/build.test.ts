/**
 * The built site, as the Worker would serve it. The site is built here with Vite's JS API into a fresh temp directory,
 * never into sites/landing/dist: only one build at a time may write dist/, and a test must not race it. The temp
 * directory is removed afterwards.
 *
 * What is checked is what reaches a reader, a crawler or an answer engine: no HTML comment, no script that runs, the
 * support address filled in, and nothing from the repo root's public/ (the Next.js web app's) in the output.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config, { stripHtmlComments } from "../vite.config";

const SITE = path.join(import.meta.dirname, "..");
const REPO = path.join(SITE, "..", "..");
const CONFIG_FILE = path.join(SITE, "vite.config.ts");
const EMAIL = "support@example.com";
const PLACEHOLDER = "%AWARDGRID_SUPPORT_EMAIL%";
const PAGES = ["index.html", "ios/index.html", "privacy/index.html", "support/index.html"];

/** Every file under `dir`, as a relative path with forward slashes. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
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

/**
 * Opening tags that could run code: a `<script>` that is anything but `type="application/ld+json"` without `src`, and
 * any tag with an event handler (`onload=`), a `javascript:` URL or an iframe `srcdoc` (the same checks as the
 * public-claims gate's SCRIPT_NOT_LD_JSON).
 */
function executableScripts(html: string): string[] {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .filter((m) => {
      const attrs = attributes(m[1] ?? "");
      return attrs.has("src") || attrs.get("type")?.trim().toLowerCase() !== "application/ld+json";
    })
    .map((m) => m[0]);
  const markup = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  const inline = [...markup.matchAll(/<([a-zA-Z][^\s/>]*)((?:[^'">]|=\s*"[^"]*"|=\s*'[^']*')*)>/g)]
    .filter((m) =>
      [...attributes(m[2] ?? "")].some(
        ([name, value]) =>
          /^on[a-z]+$/.test(name) ||
          /^javascript:/i.test(value.replace(/&#x0*61;?|&#0*97;?/gi, "a").replace(/[\s\u0000-\u001f]/g, "")) ||
          (m[1]!.toLowerCase() === "iframe" && name === "srcdoc"),
      ),
    )
    .map((m) => m[0]);
  return [...scripts, ...inline];
}

/** Runs `fn` with AWARDGRID_SUPPORT_EMAIL set to `value` (or unset), and puts the old value back. */
async function withSupportEmail<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env.AWARDGRID_SUPPORT_EMAIL;
  if (value === undefined) delete process.env.AWARDGRID_SUPPORT_EMAIL;
  else process.env.AWARDGRID_SUPPORT_EMAIL = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.AWARDGRID_SUPPORT_EMAIL;
    else process.env.AWARDGRID_SUPPORT_EMAIL = before;
  }
}

const buildInto = (outDir: string) => build({ configFile: CONFIG_FILE, logLevel: "silent", build: { outDir, emptyOutDir: true } });

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "awardgrid-landing-"));
  temps.push(dir);
  return dir;
};

let out = "";
let built: string[] = [];
const read = (file: string) => readFileSync(path.join(out, file), "utf8");
const builtPages = () => built.filter((file) => file.endsWith(".html"));

beforeAll(async () => {
  out = tempDir();
  await withSupportEmail(EMAIL, () => buildInto(out));
  built = listFiles(out);
}, 120_000);

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("the built site", () => {
  it("has every page and its stylesheet, so the checks below are not vacuous", () => {
    expect(built).toEqual(expect.arrayContaining(PAGES));
    expect(built.filter((file) => /^_site\/[^/]+\.css$/.test(file)).length).toBeGreaterThan(0);
    expect(builtPages().length).toBeGreaterThanOrEqual(PAGES.length);
  });

  it("has no HTML comment in any page", () => {
    const withComments = builtPages().filter((file) => read(file).includes("<!--"));
    expect(withComments).toEqual([]);
  });

  it("has no script that runs: the only <script> allowed is JSON-LD without src", () => {
    const offenders = builtPages().flatMap((file) => executableScripts(read(file)).map((tag) => `${file} ${tag}`));
    expect(offenders).toEqual([]);
  });

  it("fills in the support address wherever the source asks for it", () => {
    const asking = PAGES.filter((page) => readFileSync(path.join(SITE, page), "utf8").includes(PLACEHOLDER));
    expect(asking.length).toBeGreaterThan(0);
    for (const page of asking) expect(read(page), page).toContain(EMAIL);
    expect(built.filter((file) => read(file).includes(PLACEHOLDER))).toEqual([]);
  });

  it("copies nothing from the repo root's public/ (the Next.js web app's)", () => {
    const rootPublic = listFiles(path.join(REPO, "public"));
    const names = new Set(rootPublic.map((file) => path.posix.basename(file)));
    expect(built.filter((file) => rootPublic.includes(file) || names.has(path.posix.basename(file)))).toEqual([]);
  });

  it("copies every file of the site's own public/", () => {
    expect(built).toEqual(expect.arrayContaining(listFiles(path.join(SITE, "public"))));
  });
});

describe("the build configuration", () => {
  it("fixes root and publicDir to this directory, whichever directory the build starts in", () => {
    expect(config.root).toBe(SITE);
    expect(config.publicDir).toBe(path.join(SITE, "public"));
  });

  it("builds the same site, and nothing from the repo root's public/, when Vite starts in the repo root", () => {
    // The CLI from the repo root, as a `vite build --config sites/landing/vite.config.ts` there would run it. (The
    // build above runs in sites/landing, where Vite's own defaults already point here, so it cannot show this.)
    const vite = path.join(path.dirname(createRequire(path.join(SITE, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
    const outDir = tempDir();
    const run = spawnSync(process.execPath, [vite, "build", "--config", CONFIG_FILE, "--outDir", outDir, "--emptyOutDir", "--logLevel", "silent"], {
      cwd: REPO,
      env: { ...process.env, AWARDGRID_SUPPORT_EMAIL: EMAIL },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const fromRoot = listFiles(outDir);
    expect(fromRoot).toEqual(expect.arrayContaining(PAGES));
    const rootPublic = listFiles(path.join(REPO, "public"));
    expect(rootPublic.length, "the repo root's public/ has files, so this check is not vacuous").toBeGreaterThan(0);
    const names = new Set(rootPublic.map((file) => path.posix.basename(file)));
    expect(fromRoot.filter((file) => rootPublic.includes(file) || names.has(path.posix.basename(file)))).toEqual([]);
  }, 120_000);

  it("still refuses to build without a plausible support address", async () => {
    for (const value of [undefined, "", "not-an-address"]) {
      await expect(withSupportEmail(value, () => buildInto(tempDir())), String(value)).rejects.toThrow(/AWARDGRID_SUPPORT_EMAIL/);
    }
  }, 120_000);
});

describe("stripHtmlComments", () => {
  it("removes a comment on a line of its own together with its line", () => {
    const html = "<main>\n    <!--\n      a note for whoever edits the page\n    -->\n    <p>Text</p>\n</main>\n";
    expect(stripHtmlComments(html)).toBe("<main>\n    <p>Text</p>\n</main>\n");
  });

  it("removes a comment beside markup and leaves the markup and its spacing alone", () => {
    expect(stripHtmlComments("<p>one <!-- a --> two</p>")).toBe("<p>one  two</p>");
    expect(stripHtmlComments("  <!-- a --> <p>kept</p> <!-- b -->\n")).toBe("   <p>kept</p> \n");
  });

  it("never runs a comment past its first -->", () => {
    expect(stripHtmlComments("<!-- a --><p>kept</p><!-- b -->")).toBe("<p>kept</p>");
  });

  it("removes the comments the HTML parser closes at once, and conditional comments", () => {
    expect(stripHtmlComments("<p>a<!-->b<!--->c<!---->d</p>")).toBe("<p>abcd</p>");
    expect(stripHtmlComments("<!--[if IE]><p>old</p><![endif]--><p>new</p>")).toBe("<p>new</p>");
  });

  it("keeps the doctype and leaves a page with no comment as it is", () => {
    const html = '<!doctype html>\n<html lang="en"><head><title>AwardGrid</title></head><body><p>a &lt;!-- b</p></body></html>\n';
    expect(stripHtmlComments(html)).toBe(html);
  });

  it("refuses a page where a <!-- would survive: unterminated, or inside a script, style, textarea or title", () => {
    expect(() => stripHtmlComments("<p>a</p>\n<!-- never closed", "x.html")).toThrow(/x\.html:2 still has "<!--"/);
    expect(() => stripHtmlComments('<script type="application/ld+json">{"a":"<!-- b -->"}</script>')).toThrow(/still has "<!--"/);
    expect(() => stripHtmlComments("<style>/* <!-- */</style>")).toThrow(/still has "<!--"/);
    expect(() => stripHtmlComments("<title>a <!-- b --></title>")).toThrow(/still has "<!--"/);
  });
});

describe("executableScripts (the check above)", () => {
  it.each([
    "<script>alert(1)</script>",
    '<script src="/x.js"></script>',
    '<script type="module">import "./x.js"</script>',
    "<SCRIPT TYPE=text/javascript>1</SCRIPT>",
    '<script type="application/ld+json" src="/data.json"></script>',
    '<script defer src="https://third-party.example/tag.js" data-config="{}"></script>',
    '<body onload="fetch(\'https://example.com/b\')">',
    '<img src="x.png" alt="" onerror="fetch(1)">',
    '<a href="javascript:void(0)">AwardGrid</a>',
    '<a href="jav&#x61;script:void(0)">AwardGrid</a>',
    '<iframe srcdoc="<p>x</p>"></iframe>',
  ])("flags %j", (html) => {
    expect(executableScripts(html)).toHaveLength(1);
  });

  it.each([
    '<script type="application/ld+json">{"@type":"Organization"}</script>',
    "<script type='application/ld+json'>{}</script>",
    "<script type=application/ld+json>{}</script>",
    '<script type="Application/LD+JSON ">{}</script>',
    "<p>No script here.</p>",
    '<p><a href="https://seats.aero">seats.aero</a> <span data-on="x" class="online">on</span></p><!-- <p onclick="x"> -->',
  ])("allows %j", (html) => {
    expect(executableScripts(html)).toEqual([]);
  });
});
