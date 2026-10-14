/**
 * scripts/check-store-bundle.mjs, the App Store build's last gate (`npm run build:store`), run as the build runs it:
 * over a dist/ directory, here a throwaway one with hand-written chunks. It must find Ask, Anthropic, Claude, a paid
 * plan and the paste-a-key connection's words wherever they are and however they are written, refuse a bundle that is
 * not the OAuth flavour, allow a documented hit only in its own surroundings, and fail on an allow-list entry that no
 * longer matches anything. Since 1.0 (8) a real store bundle needs no allowance at all. No build, no network.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "check-store-bundle.mjs");
const dirs: string[] = [];

interface Allowance {
  needle: string;
  around: RegExp;
  why: string;
}
interface CheckModule {
  NEEDLES: Array<string | RegExp>;
  ALLOWED: Allowance[];
  findProblems(files: Array<{ name: string; text: string }>, opts?: { allowed?: Allowance[] }): { problems: string[]; used: Map<Allowance, number> };
}
const check = (await import(pathToFileURL(SCRIPT).href)) as CheckModule;

/** What the OAuth flavour's bundle must carry (the connect page's button and the consent page it opens), and nothing else. */
const REQUIRED = "connect:`Connect seats.aero`,consent:`https://seats.aero/oauth2/consent`";
/** Neutral words a real bundle is full of, some of which only look like a needle. */
const NEUTRAL = [
  "const t={title:`Search`,attribution:`Data: seats.aero`}",
  "Promise.resolve(Property)",
  "`Asking seats.aero about 4 mileage programs…`",
  "[`maskType`,`mask-type`]",
  "`Premium economy`",
  "`seats.aero rate limited this key (HTTP 429)`",
].join(";\n");
const CLEAN = `${REQUIRED};\n${NEUTRAL}`;

function run(files: Record<string, string>): { ok: boolean; out: string } {
  const dist = mkdtempSync(path.join(tmpdir(), "store-bundle-"));
  dirs.push(dist);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dist, name)), { recursive: true });
    writeFileSync(path.join(dist, name), text);
  }
  try {
    return { ok: true, out: execFileSync(process.execPath, [SCRIPT, dist], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-store-bundle", () => {
  it("passes a bundle with none of the needles and no allowance, and says so", () => {
    const result = run({ "assets/index-abc.js": CLEAN, "index.html": "<div id=root></div>" });
    expect(result.out).toMatch(/none found .* \(0 known hits allowed by 0 documented entries\)/);
    expect(result.ok).toBe(true);
    expect(check.ALLOWED).toEqual([]);
  });

  it.each([
    // Anthropic, its endpoint, its keys and Claude's models, however they are written (case-insensitive).
    ["the Anthropic endpoint", "baseURL:`https://api.anthropic.com`"],
    ["the endpoint in capitals", "`HTTPS://API.ANTHROPIC.COM/v1/messages`"],
    ["the SDK's own header", "headers:{`anthropic-version`:`2023-06-01`}"],
    ["the SDK package's name", "`@anthropic-ai/sdk`"],
    ["Anthropic by name", "`AwardGrid is not affiliated with Anthropic.`"],
    ["Anthropic in capitals", "`ANTHROPIC`"],
    ["a Claude model", "model:`claude-opus-5`"],
    ["a Claude model in capitals", "model:`CLAUDE-HAIKU-4-5`"],
    ["Claude by name", "`Claude is thinking…`"],
    ["an Anthropic key's prefix", "`sk-ant-api03-xxxx`"],
    ["an Anthropic key's prefix in capitals", "`SK-ANT-`"],
    ["a Pro key, in lower case", "`paste your pro key`"],
    ["a Pro key, in capitals", "`PRO KEY`"],
    ["an API key, in lower case", "`a seats.aero api key is required`"],
    ["an API key, in capitals", "`API KEY`"],
    ["an API key in a core error", "if(!e.apiKey)throw new Yh(`a seats.aero API key is required (no default key exists)`)"],
    ["Pro as a word", "`Upgrade to Pro`"],
    ["Ask as a word", "label:`Ask`"],
    // Ask's routes, ways into it and its own words (its screen's and its approved rows, core AI_COPY).
    ["the Ask route", "{path:`/ask`,element:x}"],
    ["the Anthropic key page", "to:`/settings/anthropic`"],
    ["the Search header's link", "{ai:`AI assistance`}"],
    ["Ask's link under the results", "`Ask Claude about this search`"],
    ["the Anthropic pricing link", "`https://platform.claude.com/docs/en/about-claude/pricing`"],
    ["the SDK's console warning", "console.warn('See https://platform.claude.com/docs/en/build-with-claude/compaction')"],
    ["the system prompt", "`You are Ask. The person asking pays for you with their own Anthropic API key, and for seats.aero calls with their own seats.aero Pro key.`"],
    ["the AI entry's COPY row", '"ai.entry":{en:`AI assistance`,zh:`AI辅助`}'],
    ["the context line's row", "`Only the query conditions will be sent.`"],
    ["the selected rows' row", "`Query and {count} selected options will be sent.`"],
    ["the proposal's apply", "`Apply and search`"],
    ["the proposal's keep", "`Keep current conditions`"],
    ["the stale proposal", "`The query has changed. Create a new proposal.`"],
    ["the Stop button", "`Stop subsequent steps`"],
    ["the Stop note", "`Requests already sent cannot be recalled and may still be billed.`"],
    ["the unfinished task", "`The previous task did not finish.`"],
    ["the Chinese Stop button", "`停止后续步骤`"],
    ["the Chinese Stop note", "`已发送的请求不能撤回，仍可能计费。`"],
    ["the Chinese apply", "`应用并查找`"],
    ["the cache note's Ask", "`This does not touch your keys or your Ask conversation.`"],
    ["the Chinese cache note's Ask", "`不影响密钥和 AI 对话。`"],
    ["the AI group", "groups:{ai:`AI（可选）`}"],
    ["the editor's note that no AI is used", "intro:`Change the conditions directly. No AI is used.`"],
    ["the Chinese editor note", "submitNote:`使用你自己的 seats.aero 额度 · 不使用 AI`"],
    // A paid plan.
    ["a Pro key field", "placeholder:`Paste your Pro key`"],
    ["a Pro key in Chinese", "label:`seats.aero Pro 密钥`"],
    ["a paid plan in a message", "message:`the Partner API needs a Pro account.`"],
    ["a subscription call to action", "`Check the API tab before you subscribe.`"],
    // The paste-a-key connection: the App Store build connects only through seats.aero's own sign-in.
    ["the key field's placeholder", "placeholder:`Paste your seats.aero API key`"],
    ["the Chinese placeholder", "placeholder:`粘贴你的 seats.aero API 密钥`"],
    ["the key field's label", "label:`seats.aero API key`"],
    ["the key page's instruction", "purpose:`Paste the API key from the API tab of your seats.aero settings.`"],
    ["the Chinese instruction", "purpose:`请粘贴 seats.aero 设置中 API 页上的 API 密钥。`"],
    ["the key check's button", "checkAndSave:`Check and save`"],
    ["the key check's progress", "checking:`Checking the key with seats.aero`"],
    ["the key check's refusal", "invalid:`seats.aero did not accept this key.`"],
    ["the key check's COPY row", '"key.check_cost":{en:`Checking this key sends a request to the data source.`,zh:`检查密钥会向数据源发送一次请求。`}'],
    ["a key on file", "onFile:e=>`Key on file ending in ${e}`"],
    ["the key's removal sheet", "confirmTitle:`Remove the seats.aero key?`"],
    ["the core error in a sentence a screen shows", "message:`Add a seats.aero API key in Settings.`"],
  ])("fails on %s", (_, chunk) => {
    const result = run({ "assets/index-abc.js": `${CLEAN};\n${chunk}` });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("assets/index-abc.js: contains");
  });

  it("searches the licenses list too: a list that names the Anthropic SDK fails", () => {
    const list = JSON.stringify([{ name: "@anthropic-ai/sdk", version: "0.128.0", license: "MIT", kind: "npm", notice: "Copyright 2023 Anthropic, PBC." }]);
    const result = run({ "assets/index-abc.js": CLEAN, "assets/AcknowledgementsScreen-1a2b.js": `var u=JSON.parse(\`${list}\`)` });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("assets/AcknowledgementsScreen-1a2b.js: contains");
  });

  it("fails on a chunk of the key page, and on a bundle without the OAuth connect page's words", () => {
    expect(run({ "assets/index-abc.js": CLEAN, "assets/SeatsKeyScreen-1a2b.js": "export{}" }).out).toContain("a chunk of the key page");
    expect(run({ "assets/index-abc.js": CLEAN, "assets/seats-key-copy-1a2b.js": "export{}" }).ok).toBe(false);
    for (const missing of ["connect:`Connect seats.aero`,", "consent:`https://seats.aero/oauth2/consent`"]) {
      const result = run({ "assets/index-abc.js": CLEAN.replace(missing, "") });
      expect(result.ok, missing).toBe(false);
      expect(result.out).toContain("the bundle was not built as the OAuth flavour");
    }
  });

  it("fails on a chunk of Ask's pages, whatever it holds, and searches CSS, HTML and JSON too", () => {
    expect(run({ "assets/index-abc.js": CLEAN, "assets/AskScreen-1a2b.js": "export{}" }).out).toContain("a chunk of Ask or the Anthropic key page");
    expect(run({ "assets/index-abc.js": CLEAN, "assets/AnthropicKeyScreen-1a2b.js": "export{}" }).ok).toBe(false);
    expect(run({ "assets/index-abc.js": CLEAN, "index.html": "<a href='#/ask'>x</a>" }).ok).toBe(false);
    expect(run({ "assets/index-abc.js": CLEAN, "data.json": '{"label":"Pro plan"}' }).ok).toBe(false);
    expect(run({ "assets/index-abc.js": CLEAN, "assets/index.css": ".x::after{content:'Anthropic'}" }).ok).toBe(false);
  });

  it("matches each of the first group case-insensitively, and the words Ask and Pro only as words", () => {
    const sources = check.NEEDLES.filter((n): n is RegExp => n instanceof RegExp).map(String);
    expect(sources).toEqual(expect.arrayContaining(["/anthropic/i", "/api\\.anthropic\\.com/i", "/claude/i", "/claude-/i", "/sk-ant/i", "/Pro key/i", "/API key/i", "/\\bPro\\b/", "/\\bAsk\\b/"]));
    const found = (text: string) => check.findProblems([{ name: "a.js", text: `${REQUIRED};${text}` }]).problems;
    for (const text of ["Promise", "Provider", "Asking", "task", "asked", "mask-type", "Professional"]) expect(found(text), text).toEqual([]);
  });

  it("allows a documented hit only in its own surroundings, and fails on an entry that matches nothing", () => {
    const entry: Allowance = { needle: "/claude/i", around: /`a documented claude sentence`/, why: "a test of the mechanism" };
    const files = (text: string) => [{ name: "assets/index-abc.js", text: `${REQUIRED};${text}` }];
    const allowed = check.findProblems(files("`a documented claude sentence`"), { allowed: [entry] });
    expect(allowed.problems).toEqual([]);
    expect(allowed.used.get(entry)).toBe(1);
    // The same needle anywhere else still fails, and the entry that matched nothing is reported.
    const elsewhere = check.findProblems(files("`claude elsewhere`"), { allowed: [entry] });
    expect(elsewhere.problems.some((p) => p.includes('contains "/claude/i"'))).toBe(true);
    expect(elsewhere.problems.some((p) => /allow-list entry for "\/claude\/i" .* matched nothing: remove it/.test(p))).toBe(true);
  });

  it("refuses to pass when there is no build to check", () => {
    const missing = path.join(tmpdir(), "store-bundle-does-not-exist");
    expect(() => execFileSync(process.execPath, [SCRIPT, missing], { stdio: "pipe" })).toThrow();
  });
});
