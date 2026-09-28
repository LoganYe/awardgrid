/**
 * sites/landing/scripts/indexnow.mjs. Nothing here reaches the network: the dry run is run with a fetch that fails the
 * test if it is called (and once as a process whose fetch throws), submitting with a fetch that answers as the live
 * key file and the IndexNow endpoint would, and under vitest the script refuses the real fetch (tested below).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ENDPOINT, HOST, buildPayload, findKey, main, pageUrls, readSiteConfig } from "../scripts/indexnow.mjs";

const SITE = path.join(import.meta.dirname, "..");
const SCRIPT = path.join(SITE, "scripts", "indexnow.mjs");
const KEY = "0123456789abcdef0123456789abcdef";
const PAGES = ["/", "/ios/", "/privacy/", "/support/"];
const URLS = PAGES.map((p) => `https://${HOST}${p}`);
const NOW = () => new Date("2026-10-01T12:00:00.000Z");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A site directory: pages.json (with `manifest` merged over the default) and public/ with the given files. */
function makeSite(manifest: Record<string, unknown> = {}, files: Record<string, string> = { [`${KEY}.txt`]: KEY }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "indexnow-"));
  temps.push(dir);
  mkdirSync(path.join(dir, "public"));
  const pages = PAGES.map((p) => ({ path: p, lastmod: "2026-09-28" }));
  writeFileSync(path.join(dir, "pages.json"), JSON.stringify({ host: HOST, pages, indexnow_key: KEY, ...manifest }));
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, "public", name), content);
  return dir;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that serves the key file with `keyFile` and answers the IndexNow POST with `status`. */
function indexNowFetch({ keyFile = { status: 200, body: KEY }, status = 200, body = "" }: { keyFile?: { status: number; body: string }; status?: number; body?: string } = {}) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `https://${HOST}/${KEY}.txt`) return new Response(keyFile.body, { status: keyFile.status });
    if (url === ENDPOINT && init?.method === "POST") return new Response(body, { status });
    throw new TypeError(`fetch failed (unexpected ${init?.method ?? "GET"} ${url})`);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const noFetch = (() => {
  throw new Error("the dry run must not fetch");
}) as typeof globalThis.fetch;

function capture(siteDir: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { siteDir, now: NOW, stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) } };
}

describe("the site's own configuration", () => {
  it("publishes exactly one IndexNow key file, containing its own name, and pages.json names that key", () => {
    const key = findKey(path.join(SITE, "public"));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const manifest = JSON.parse(readFileSync(path.join(SITE, "pages.json"), "utf8")) as { indexnow_key?: string };
    expect(manifest.indexnow_key).toBe(key);
    expect(readSiteConfig().key).toBe(key);
  });

  it("builds a payload for the host, with the key at the host's root and every page of pages.json", () => {
    const site = readSiteConfig();
    const payload = buildPayload(site.key, pageUrls(site.paths));
    expect(payload).toEqual({ host: HOST, key: site.key, keyLocation: `https://${HOST}/${site.key}.txt`, urlList: site.paths.map((p) => `https://${HOST}${p}`) });
    expect(payload.urlList).toEqual(expect.arrayContaining(URLS));
    expect(new Set(payload.urlList).size).toBe(payload.urlList.length);
  });

  it("`node sites/landing/scripts/indexnow.mjs` prints that payload and sends nothing, in a process whose fetch throws", () => {
    const run = spawnSync(process.execPath, ["--import", 'data:text/javascript,globalThis.fetch=()=>{throw new Error("network")}', SCRIPT], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const site = readSiteConfig();
    expect(JSON.parse(run.stdout)).toEqual(buildPayload(site.key, pageUrls(site.paths)));
    expect(run.stderr).toContain("Dry run: nothing was sent.");
  });
});

describe("finding the key and reading pages.json", () => {
  it("reads the manifest's host, page paths and key", () => {
    expect(readSiteConfig(makeSite())).toEqual({ host: HOST, paths: PAGES, key: KEY });
  });

  it("takes the key from public/ when pages.json does not name one, and accepts a trailing newline in the key file", () => {
    expect(readSiteConfig(makeSite({ indexnow_key: undefined }, { [`${KEY}.txt`]: `${KEY}\n` })).key).toBe(KEY);
  });

  it.each([
    ["no key file", {}, {}, /exactly one IndexNow key file .* found 0/],
    ["two key files", {}, { [`${KEY}.txt`]: KEY, ["f".repeat(32) + ".txt"]: "f".repeat(32) }, /exactly one IndexNow key file .* found 2/],
    ["a key file that does not contain its name", {}, { [`${KEY}.txt`]: "f".repeat(32) }, /must contain its own name/],
    ["an upper-case key file name (not a key file)", {}, { [`${KEY.toUpperCase()}.txt`]: KEY.toUpperCase() }, /found 0/],
    ["pages.json naming another key", { indexnow_key: "f".repeat(32) }, undefined, /is not the key in public\//],
    ["another host", { host: "example.com" }, undefined, /host is "example\.com"/],
    ["no pages", { pages: [] }, undefined, /lists no pages/],
    ["a relative path", { pages: [{ path: "ios/" }] }, undefined, /not a plain absolute path/],
    ["a path with a query", { pages: [{ path: "/?x=1" }] }, undefined, /not a plain absolute path/],
    ["a path to another host", { pages: [{ path: "//example.com/" }] }, undefined, /not a plain absolute path/],
    ["a page listed twice", { pages: [{ path: "/ios/" }, { path: "/ios/" }] }, undefined, /lists a page twice: \/ios\//],
  ])("refuses %s", (_name, manifest, files, error) => {
    expect(() => readSiteConfig(makeSite(manifest, files))).toThrow(error);
  });

  it("refuses a missing or malformed pages.json", () => {
    const dir = makeSite();
    rmSync(path.join(dir, "pages.json"));
    expect(() => readSiteConfig(dir)).toThrow(/cannot read the page manifest/);
    writeFileSync(path.join(dir, "pages.json"), "[]");
    expect(() => readSiteConfig(dir)).toThrow(/is not a JSON object/);
  });
});

describe("the payload", () => {
  it("uses the production host, the published key, and only the manifest's URLs", () => {
    expect(buildPayload(KEY, URLS)).toEqual({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: URLS });
    expect(pageUrls(PAGES)).toEqual(URLS);
    expect(() => pageUrls(["/"], "example.com")).toThrow(/outside awardgrid\.dowhiz\.com/);
    expect(() => buildPayload(KEY, ["https://example.com/"])).toThrow(/outside/);
    expect(() => buildPayload("nope", URLS)).toThrow(/invalid/);
    expect(() => buildPayload(KEY.toUpperCase(), URLS)).toThrow(/invalid/);
    expect(() => buildPayload(KEY, [])).toThrow(/no URLs/);
  });
});

describe("the CLI", () => {
  it("dry run by default: prints the payload, sends nothing, exit 0", async () => {
    const { out, err, deps } = capture(makeSite());
    expect(await main([], { ...deps, fetch: noFetch })).toBe(0);
    expect(JSON.parse(out.join(""))).toEqual(buildPayload(KEY, URLS));
    expect(err.join("")).toContain("Dry run: nothing was sent. To submit these 4 URL(s)");
  });

  it.each([[["--submit"]], [["--i-confirm"]]])("%j alone sends nothing and exits 2", async (argv) => {
    const { fetch, calls } = indexNowFetch();
    const { out, err, deps } = capture(makeSite());
    expect(await main(argv, { ...deps, fetch })).toBe(2);
    expect(calls).toEqual([]);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("needs both --submit and --i-confirm");
  });

  it("--help prints the usage; an unknown option exits 2", async () => {
    const help = capture(makeSite());
    expect(await main(["--help"], { ...help.deps, fetch: noFetch })).toBe(0);
    expect(help.out.join("")).toContain("--submit --i-confirm");
    const bad = capture(makeSite());
    expect(await main(["--submit", "--i-confirm", "--force"], { ...bad.deps, fetch: noFetch })).toBe(2);
    expect(bad.err.join("")).toContain("Unknown option --force");
  });

  it.each([200, 202])("--submit --i-confirm: checks the live key, POSTs the payload; %i is success", async (status) => {
    const { fetch, calls } = indexNowFetch({ status });
    const { out, deps } = capture(makeSite());
    expect(await main(["--submit", "--i-confirm"], { ...deps, fetch })).toBe(0);
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([`GET https://${HOST}/${KEY}.txt`, `POST ${ENDPOINT}`]);
    const post = calls[1]!.init!;
    expect(new Headers(post.headers).get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(String(post.body))).toEqual(buildPayload(KEY, URLS));
    expect(out.join("")).toBe(`IndexNow ${status} for 4 URL(s) at 2026-10-01T12:00:00.000Z\n`);
  });

  it.each([400, 403, 422, 429, 500])("an IndexNow answer of %i fails with its body", async (status) => {
    const { fetch } = indexNowFetch({ status, body: "Key not valid" });
    const { err, deps } = capture(makeSite());
    expect(await main(["--submit", "--i-confirm"], { ...deps, fetch })).toBe(1);
    expect(err.join("")).toContain("Key not valid");
  });

  it.each([
    ["not deployed yet", { status: 404, body: "Not found" }],
    ["serving another key", { status: 200, body: "f".repeat(32) }],
  ])("does not submit when the live key file is %s", async (_name, keyFile) => {
    const { fetch, calls } = indexNowFetch({ keyFile });
    const { err, deps } = capture(makeSite());
    expect(await main(["--submit", "--i-confirm"], { ...deps, fetch })).toBe(1);
    expect(calls.map((c) => c.url)).toEqual([`https://${HOST}/${KEY}.txt`]);
    expect(err.join("")).toContain("does not serve the key yet");
  });

  it("a failed request exits 1", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const { err, deps } = capture(makeSite());
    expect(await main(["--submit", "--i-confirm"], { ...deps, fetch })).toBe(1);
    expect(err.join("")).toContain("fetch failed");
  });

  it("under vitest, submitting without an injected fetch sends nothing and exits 1", async () => {
    const { err, deps } = capture(makeSite());
    expect(await main(["--submit", "--i-confirm"], deps)).toBe(1);
    expect(err.join("")).toContain("no network under vitest");
  });

  it("a site without a usable pages.json exits 1 with the reason", async () => {
    const { err, deps } = capture(makeSite({ host: "example.com" }));
    expect(await main([], { ...deps, fetch: noFetch })).toBe(1);
    expect(err.join("")).toContain('pages.json host is "example.com"');
  });
});
