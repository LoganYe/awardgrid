#!/usr/bin/env node
/**
 * Fails the App Store build (`npm run build:store`, VITE_AG_STORE=1; src/app/flags.ts) if Ask or a paid-plan phrase
 * reached the bundle Capacitor copies into the app (3.1.1 remediation, plan steps 14-15).
 *
 * The store build compiles Ask out: its routes (#/ask, #/settings/anthropic), every way into it, and the copy that
 * names Ask, Claude or Anthropic. The neutral wording leaves no "Pro key" to paste and nothing to subscribe to. This
 * check makes that a fact about dist/, not about the source: every .js, .css, .html and .json file there is searched
 * for the NEEDLES below, and no chunk may be named after the Ask screen or the Anthropic key page.
 *
 * Some hits are known and allowed, each in ALLOWED with the reason. An allowed hit must lie inside a match of the
 * entry's `around` pattern (looked for within 240 characters of it), not merely share a needle, so the same words
 * anywhere else still fail. An entry that matches nothing fails too: when the reason goes away, so does the entry.
 *
 *   node scripts/check-store-bundle.mjs [distDir]      (run by `npm run build:store`, after `vite build`)
 *
 * What it does not see: the licenses list (src/about/acknowledgements.json) still names @anthropic-ai/sdk, because the
 * SDK is still bundled for AppServices.ask, which is built at launch and never opened in this build (release plan D3,
 * a known artifact: a license notice, not a feature). apps/ios/src/store-copy.test.ts checks the wording itself, in
 * the source the store build is made from.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Strings that must not be in the store bundle. Plain strings match exactly; regular expressions as written. */
export const NEEDLES = [
  // Ask's routes and the Anthropic key page.
  "settings/anthropic",
  /[`'"]#?\/ask[`'"/?]/,
  "Connect Anthropic",
  "Add an Anthropic key",
  "Paste your Anthropic API key",
  "Anthropic API key (for Ask)",
  "Anthropic's pricing page",
  "platform.claude.com",
  // Ways into Ask, and the sentences that name it.
  "AI assistance",
  "AI辅助",
  "AI 辅助",
  "Ask Claude",
  "your Ask conversation",
  "AI 对话",
  "AI (optional)",
  "AI（可选）",
  // The query editor's note that no AI is used: true in every build, but in this one, which has no AI, it only points
  // at a feature that is not there (simulator QA, plan step 20). The store build says what the editor does instead.
  "No AI",
  "不使用 AI",
  // A paid plan, a purchase or a subscription.
  "Paste your Pro key",
  "Pro 密钥",
  "Pro key",
  "Pro API",
  "Pro account",
  "Pro plan",
  "seats.aero Pro",
  "before you subscribe",
  "订阅",
  "paid seats.aero",
];

/**
 * Known hits, each with why it is there and why it is not shown. `needle` is the NEEDLES entry it answers (its
 * source, for a regular expression), `around` the text that must surround it.
 */
export const ALLOWED = [
  {
    needle: "AI assistance",
    around: /"ai\.entry":\{en:[`'"]AI assistance[`'"],zh:[`'"]AI辅助[`'"]\}/,
    why:
      "core workspace/present.ts COPY row ai.entry: the approved-copy table ships whole, since copy(key) looks rows up " +
      "by key. The shell renders the ai.* rows only on the Ask screen, which this build does not have.",
  },
  {
    needle: "AI辅助",
    around: /"ai\.entry":\{en:[`'"]AI assistance[`'"],zh:[`'"]AI辅助[`'"]\}/,
    why: "The same COPY row's Chinese.",
  },
  {
    needle: "platform.claude.com",
    around: /https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/(?:compaction|adaptive-thinking)/,
    why:
      "@anthropic-ai/sdk's own console warnings for deprecated parameters. The SDK stays bundled with AppServices.ask " +
      "(release plan D3), which this build never opens; nothing here is rendered.",
  },
  {
    needle: "seats.aero Pro",
    around: /and for seats\.aero calls with their own seats\.aero Pro key\./,
    why:
      "core ask/prompt.ts ASK_SYSTEM_PROMPT: sent to Anthropic as Ask's instructions, never shown. Bundled with " +
      "AppServices.ask, which this build never opens.",
  },
  {
    needle: "Pro key",
    around: /and for seats\.aero calls with their own seats\.aero Pro key\./,
    why: "The same system prompt sentence.",
  },
];

/** Chunk names that would mean a lazy Ask page was built into the store bundle after all. */
const ASK_CHUNK = /(^|\/)(AskScreen|AnthropicKeyScreen|anthropic-copy|ask-surface-copy)[-.]/;

const WINDOW = 240;
const label = (needle) => (typeof needle === "string" ? needle : String(needle));

function hits(text, needle) {
  const found = [];
  if (typeof needle === "string") {
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push({ at, length: needle.length });
  } else {
    const re = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : `${needle.flags}g`);
    for (const m of text.matchAll(re)) found.push({ at: m.index, length: m[0].length });
  }
  return found;
}

/** Whether a match of `around`, near the hit, contains the whole hit: the allowed words in their own place. */
function covers(text, around, at, length) {
  const from = Math.max(0, at - WINDOW);
  const window = text.slice(from, at + length + WINDOW);
  const re = new RegExp(around.source, around.flags.includes("g") ? around.flags : `${around.flags}g`);
  for (const m of window.matchAll(re)) {
    if (from + m.index <= at && at + length <= from + m.index + m[0].length) return true;
  }
  return false;
}

/**
 * The problems in a set of files ({ name, text }), and the allowed hits by entry. Exported for the script's own test
 * (src/store-bundle-check.test.ts).
 */
export function findProblems(files, { needles = NEEDLES, allowed = ALLOWED } = {}) {
  const problems = [];
  const used = new Map(allowed.map((entry) => [entry, 0]));
  for (const { name, text } of files) {
    if (ASK_CHUNK.test(name)) problems.push(`${name}: a chunk of Ask or the Anthropic key page is in the bundle`);
    for (const needle of needles) {
      for (const { at, length } of hits(text, needle)) {
        const entry = allowed.find((a) => a.needle === label(needle) && covers(text, a.around, at, length));
        if (entry) {
          used.set(entry, used.get(entry) + 1);
          continue;
        }
        const context = text.slice(Math.max(0, at - 60), at + length + 60).replace(/\s+/g, " ");
        problems.push(`${name}: contains ${JSON.stringify(label(needle))} … ${context} …`);
      }
    }
  }
  for (const [entry, count] of used) {
    if (count === 0) problems.push(`allow-list entry for ${JSON.stringify(entry.needle)} (${entry.around}) matched nothing: remove it`);
  }
  return { problems, used };
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function main() {
  const here = import.meta.dirname;
  const dist = path.resolve(process.argv[2] ?? path.join(here, "..", "dist"));
  let paths;
  try {
    paths = walk(dist);
  } catch {
    console.error(`check-store-bundle: no build output at ${dist}`);
    process.exit(2);
  }
  const files = paths
    .filter((file) => /\.(js|mjs|css|html|json)$/.test(file))
    .map((file) => ({ name: path.relative(dist, file), text: readFileSync(file, "utf8") }));
  const { problems, used } = findProblems(files);
  if (problems.length) {
    console.error("check-store-bundle: the App Store bundle carries Ask or a paid-plan phrase:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const allowedHits = [...used.values()].reduce((a, b) => a + b, 0);
  console.log(
    `check-store-bundle: ${files.length} files, ${NEEDLES.length} needles, none found in ${path.relative(process.cwd(), dist) || dist} ` +
      `(${allowedHits} known hits allowed by ${ALLOWED.length} documented entries)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
