#!/usr/bin/env node
/**
 * Tells IndexNow engines (Bing, Yandex, Seznam, Naver and the others that share submissions) that the site's pages
 * changed. The URL list is the site's page manifest, `sites/landing/pages.json`, on https://awardgrid.dowhiz.com.
 *
 *   node sites/landing/scripts/indexnow.mjs                          dry run: prints the payload, sends nothing
 *   node sites/landing/scripts/indexnow.mjs --submit --i-confirm     submits it (the owner's step, after a deploy
 *                                                                    that verify-live.mjs has checked)
 *
 * The key is public by design: IndexNow proves ownership by fetching https://awardgrid.dowhiz.com/<key>.txt, which
 * must contain the key. The key file sits at the root of the host (an exact Worker route, wrangler.jsonc), because a
 * key file in a subdirectory only covers URLs under that directory. `public/<key>.txt` is the key's source; pages.json's
 * `indexnow_key`, when present, must name the same key.
 *
 * The dry run makes no network request at all. Submitting first checks that the live key file serves the key, then
 * POSTs to api.indexnow.org; 200 (accepted) and 202 (accepted, key validation pending) are success, anything else
 * exits 1. Exit 2 on a usage error.
 *
 * Node built-ins only. Ported from Restful's website/scripts/indexnow.mjs.
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOST = "awardgrid.dowhiz.com";
export const ENDPOINT = "https://api.indexnow.org/indexnow";
/** sites/landing: pages.json and public/ are read from here. */
export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = /^[0-9a-f]{32}$/;
const KEY_FILE = /^[0-9a-f]{32}\.txt$/;

export const USAGE = `Usage: node sites/landing/scripts/indexnow.mjs [--submit --i-confirm]

Without options: a dry run. Prints the IndexNow payload for every page in sites/landing/pages.json and sends nothing.

  --submit --i-confirm   submit the payload to api.indexnow.org (both flags are needed). Run it only after a
                         deploy that verify-live.mjs has checked. It first checks that the live key file serves
                         the key; 200 and 202 from IndexNow are success.
  --help                 this text
`;

/** The one IndexNow key file in `publicDir` (`<32 hex>.txt`, containing its own name), as the key. */
export function findKey(publicDir) {
  const keys = readdirSync(publicDir).filter((file) => KEY_FILE.test(file));
  if (keys.length !== 1) throw new Error(`expected exactly one IndexNow key file (<32 hex>.txt) in ${publicDir}, found ${keys.length}`);
  const key = keys[0].slice(0, -4);
  if (readFileSync(path.join(publicDir, keys[0]), "utf8").trim() !== key) throw new Error(`the IndexNow key file ${keys[0]} must contain its own name`);
  return key;
}

/**
 * The site's page manifest and key: `{ host, paths, key }`. pages.json is
 * `{"host":"awardgrid.dowhiz.com","pages":[{"path":"/","lastmod":"YYYY-MM-DD"},…],"indexnow_key":"<32 hex>"}`;
 * the key comes from `public/<key>.txt` and must equal `indexnow_key` when pages.json has one.
 */
export function readSiteConfig(siteDir = SITE_DIR) {
  const file = path.join(siteDir, "pages.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read the page manifest ${file}: ${error instanceof Error ? error.message : error}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${file} is not a JSON object`);
  const host = manifest.host ?? HOST;
  if (host !== HOST) throw new Error(`pages.json host is ${JSON.stringify(host)}, expected ${JSON.stringify(HOST)}`);
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) throw new Error("pages.json lists no pages");
  const paths = manifest.pages.map((page) => page?.path);
  for (const p of paths) {
    if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || /[?#\s]/.test(p)) {
      throw new Error(`pages.json has a page path that is not a plain absolute path: ${JSON.stringify(p)}`);
    }
  }
  const repeated = paths.filter((p, i) => paths.indexOf(p) !== i);
  if (repeated.length) throw new Error(`pages.json lists a page twice: ${repeated.join(", ")}`);
  const key = findKey(path.join(siteDir, "public"));
  if (manifest.indexnow_key !== undefined && manifest.indexnow_key !== key) {
    throw new Error(`pages.json indexnow_key ${JSON.stringify(manifest.indexnow_key)} is not the key in public/${key}.txt`);
  }
  return { host, paths, key };
}

/** The absolute URL of each page path on the host. */
export function pageUrls(paths, host = HOST) {
  const urls = paths.map((p) => new URL(p, `https://${host}`).href);
  for (const url of urls) {
    if (new URL(url).hostname !== HOST) throw new Error(`URL outside ${HOST}: ${url}`);
  }
  return urls;
}

export function buildPayload(key, urlList) {
  if (!KEY.test(key)) throw new Error("invalid IndexNow key (32 lowercase hex characters)");
  if (urlList.length === 0) throw new Error("no URLs to submit");
  for (const url of urlList) {
    if (new URL(url).hostname !== HOST) throw new Error(`URL outside ${HOST}: ${url}`);
  }
  return { host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList };
}

/** Tests inject `fetch`; under vitest the real one is refused, so no test can reach the network by accident. */
function networkFetch() {
  if (process.env.VITEST) {
    return () => {
      throw new Error("indexnow.mjs: no network under vitest; pass a fetch");
    };
  }
  return globalThis.fetch;
}

/**
 * The CLI. Returns the exit code. `deps` lets a test pass its own `fetch`, site directory, output streams and clock.
 *
 * @param {string[]} argv
 * @param {{ fetch?: typeof fetch, siteDir?: string, stdout?: (s: string) => void, stderr?: (s: string) => void, now?: () => Date }} [deps]
 */
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  const now = deps.now ?? (() => new Date());
  const known = new Set(["--submit", "--i-confirm", "--help", "-h"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) {
    err(`Unknown option ${unknown.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    out(USAGE);
    return 0;
  }
  const submit = argv.includes("--submit");
  const confirmed = argv.includes("--i-confirm");
  if (submit !== confirmed) {
    err(`Submitting needs both --submit and --i-confirm; nothing was sent.\n\n${USAGE}`);
    return 2;
  }

  let payload;
  try {
    const site = readSiteConfig(deps.siteDir);
    payload = buildPayload(site.key, pageUrls(site.paths, site.host));
  } catch (error) {
    err(`indexnow: ${error instanceof Error ? error.message : error}\n`);
    return 1;
  }

  if (!submit) {
    out(`${JSON.stringify(payload, null, 2)}\n`);
    err(`Dry run: nothing was sent. To submit these ${payload.urlList.length} URL(s): node sites/landing/scripts/indexnow.mjs --submit --i-confirm\n`);
    return 0;
  }

  const doFetch = deps.fetch ?? networkFetch();
  try {
    const served = await doFetch(payload.keyLocation, { headers: { "cache-control": "no-cache" }, redirect: "manual" });
    const body = served.ok ? (await served.text()).trim() : "";
    if (!served.ok || body !== payload.key) {
      err(`${payload.keyLocation} does not serve the key yet (HTTP ${served.status}); deploy first. Nothing was sent.\n`);
      return 1;
    }
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    // 200 = accepted, 202 = accepted, key validation pending; anything else failed.
    out(`IndexNow ${response.status} for ${payload.urlList.length} URL(s) at ${now().toISOString()}\n`);
    if (response.status !== 200 && response.status !== 202) {
      err(`${await response.text()}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    err(`indexnow: ${error instanceof Error ? error.message : error}\n`);
    return 1;
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
