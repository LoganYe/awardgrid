#!/usr/bin/env node
/**
 * Fails the App Store build (`npm run build:store`, VITE_AG_STORE=1 VITE_AG_CONNECT=oauth; src/app/flags.ts) if Ask,
 * a paid-plan phrase or the paste-a-key connection reached the bundle Capacitor copies into the app (3.1.1
 * remediation, plan steps 14-15 and 47F).
 *
 * The store build compiles Ask out: its routes (#/ask, #/settings/anthropic), every way into it, and the copy that
 * names Ask, Claude or Anthropic. The neutral wording leaves no "Pro key" and nothing to subscribe to. And it is the
 * OAuth flavour: a seats.aero account is connected only through seats.aero's own sign-in ("Connect seats.aero"), so the
 * key page, its paste field, its key check and every sentence that asks for an API key are compiled out too. This check
 * makes that a fact about dist/, not about the source: every .js, .css, .html and .json file there is searched for the
 * NEEDLES below; no chunk may be named after the Ask screen, the Anthropic key page or the key page; and the OAuth
 * connect page's words must be there (REQUIRED: a bundle without them was not built as the OAuth flavour).
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
  // The paste-a-key connection (the key flavour's connect page, ../src/screens/seats-key-copy.ts): the App Store build
  // connects only through seats.aero's own sign-in, so no field, label, instruction or key check of it may remain.
  "Paste your seats.aero API key",
  "粘贴你的 seats.aero API 密钥",
  "seats.aero API key",
  "seats.aero API 密钥",
  "API tab",
  "API 页",
  "Paste the API key",
  "API 密钥",
  "Check and save",
  "检查并保存",
  "Checking the key with seats.aero",
  "正在向 seats.aero 检查密钥",
  "did not accept this key",
  "未接受此密钥",
  "Checking this key sends a request",
  "检查密钥会向数据源发送一次请求",
  "Key on file ending in",
  "已保存密钥",
  "Remove the seats.aero key",
  "移除 seats.aero 密钥",
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
  {
    needle: "Checking this key sends a request",
    around: /"key\.check_cost":\{en:[`'"]Checking this key sends a request to the data source\.[`'"],zh:[`'"]检查密钥会向数据源发送一次请求。[`'"]\}/,
    why:
      "core workspace/present.ts COPY row key.check_cost: the approved-copy table ships whole, as ai.entry does. The shell " +
      "renders it only on the key flavour's connect page, which this build does not have.",
  },
  {
    needle: "检查密钥会向数据源发送一次请求",
    around: /"key\.check_cost":\{en:[`'"]Checking this key sends a request to the data source\.[`'"],zh:[`'"]检查密钥会向数据源发送一次请求。[`'"]\}/,
    why: "The same COPY row's Chinese.",
  },
  {
    needle: "seats.aero API key",
    around: /new [\w$]+\([`'"]a seats\.aero API key is required \(no default key exists\)[`'"]\)/,
    why:
      "core seatsaero/client.ts: the client's own error for an empty credential, thrown in code, never a sentence a " +
      "screen shows. In this build the credential is the sign-in's access token, and the shell checks for one first.",
  },
  {
    needle: "seats.aero API key",
    around: /new [\w$]+\([`'"]runFind requires the calling user's seats\.aero API key[`'"]\)/,
    why: "core seatsaero/find.ts: the same kind of error, for runFind called without a credential.",
  },
];

/**
 * What the OAuth flavour's bundle must carry: its connect page's button and the consent page it opens. Without them the
 * bundle was built as another flavour (App.tsx OAUTH_BUILT drops the OAuth page from the others), whatever else it
 * says.
 */
export const REQUIRED = [
  { text: "Connect seats.aero", why: "the OAuth connect page's button (src/screens/oauth-copy.ts)" },
  { text: "https://seats.aero/oauth2/consent", why: "the consent page Connect seats.aero opens (src/oauth/connect.ts)" },
];

/** Chunk names that would mean a lazy Ask page, or the key page, was built into the store bundle after all. */
const ASK_CHUNK = /(^|\/)(AskScreen|AnthropicKeyScreen|anthropic-copy|ask-surface-copy)[-.]/;
const KEY_CHUNK = /(^|\/)(SeatsKeyScreen|seats-key-copy)[-.]/;

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
export function findProblems(files, { needles = NEEDLES, allowed = ALLOWED, required = REQUIRED } = {}) {
  const problems = [];
  const used = new Map(allowed.map((entry) => [entry, 0]));
  for (const { text, why } of required) {
    if (!files.some((file) => file.text.includes(text))) {
      problems.push(`missing ${JSON.stringify(text)}, ${why}: the bundle was not built as the OAuth flavour (npm run build:store sets VITE_AG_CONNECT=oauth)`);
    }
  }
  for (const { name, text } of files) {
    if (ASK_CHUNK.test(name)) problems.push(`${name}: a chunk of Ask or the Anthropic key page is in the bundle`);
    if (KEY_CHUNK.test(name)) problems.push(`${name}: a chunk of the key page (the paste field) is in the bundle`);
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
    console.error("check-store-bundle: the App Store bundle carries Ask, a paid-plan phrase or the paste-a-key connection, or is not the OAuth flavour:");
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
