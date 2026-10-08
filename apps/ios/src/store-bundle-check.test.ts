/**
 * scripts/check-store-bundle.mjs, the App Store build's last gate (`npm run build:store`), run as the build runs it:
 * over a dist/ directory, here a throwaway one with hand-written chunks. It must find Ask, paid-plan phrases and the
 * paste-a-key connection's words wherever they are, refuse a bundle that is not the OAuth flavour, allow only the documented hits in their own surroundings, and fail on an allow-list entry that no
 * longer matches anything. No build, no network.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "check-store-bundle.mjs");
const dirs: string[] = [];

/**
 * The known hits a real store bundle carries (the script fails when an allow-list entry matches nothing), and what the
 * OAuth flavour's bundle must carry: the connect page's button and the consent page it opens.
 */
const KNOWN = [
  '"ai.entry":{en:`AI assistance`,zh:`AI辅助`},"ai.query_only":{en:`Only the query conditions will be sent.`}',
  '"key.check_cost":{en:`Checking this key sends a request to the data source.`,zh:`检查密钥会向数据源发送一次请求。`},"demo.synthetic":{en:`x`}',
  "console.warn('See https://platform.claude.com/docs/en/build-with-claude/compaction')",
  "`You are Ask. The person asking pays for you with their own Anthropic API key, and for seats.aero calls with their own seats.aero Pro key.`",
  "if(!e.apiKey)throw new Yh(`a seats.aero API key is required (no default key exists)`)",
  "if(!e.apiKey)throw new Yh(`runFind requires the calling user's seats.aero API key`)",
  "connect:`Connect seats.aero`,consent:`https://seats.aero/oauth2/consent`",
].join(";\n");

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
  it("passes a bundle that carries only the documented hits, and says how many it allowed", () => {
    const result = run({ "assets/index-abc.js": `${KNOWN};\nconst t={title:\`Search\`,attribution:\`Data: seats.aero\`};`, "index.html": "<div id=root></div>" });
    expect(result.out).toMatch(/none found .* \(9 known hits allowed by 9 documented entries\)/);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["the Ask route", "{path:`/ask`,element:x}"],
    ["the Anthropic key page", "to:`/settings/anthropic`"],
    ["the Search header's link", "{ai:`AI assistance`}"],
    ["Ask's link under the results", "`Ask Claude about this search`"],
    ["the Anthropic pricing link", "`https://platform.claude.com/docs/en/about-claude/pricing`"],
    ["a Pro key field", "placeholder:`Paste your Pro key`"],
    ["a Pro key in Chinese", "label:`seats.aero Pro 密钥`"],
    ["a paid plan in a message", "message:`the Partner API needs a Pro account.`"],
    ["the cache note's Ask", "`This does not touch your keys or your Ask conversation.`"],
    ["the Chinese cache note's Ask", "`不影响密钥和 AI 对话。`"],
    ["the AI group", "groups:{ai:`AI（可选）`}"],
    ["a subscription call to action", "`Check the API tab before you subscribe.`"],
    ["the editor's note that no AI is used", "intro:`Change the conditions directly. No AI is used.`"],
    ["the Chinese editor note", "submitNote:`使用你自己的 seats.aero 额度 · 不使用 AI`"],
    // The paste-a-key connection: the App Store build connects only through seats.aero's own sign-in.
    ["the key field's placeholder", "placeholder:`Paste your seats.aero API key`"],
    ["the Chinese placeholder", "placeholder:`粘贴你的 seats.aero API 密钥`"],
    ["the key field's label", "label:`seats.aero API key`"],
    ["the key page's instruction", "purpose:`Paste the API key from the API tab of your seats.aero settings.`"],
    ["the Chinese instruction", "purpose:`请粘贴 seats.aero 设置中 API 页上的 API 密钥。`"],
    ["the key check's button", "checkAndSave:`Check and save`"],
    ["the key check's progress", "checking:`Checking the key with seats.aero`"],
    ["the key check's refusal", "invalid:`seats.aero did not accept this key.`"],
    ["the key check's cost outside its COPY row", "`Checking this key sends a request to the data source.`"],
    ["a key on file", "onFile:e=>`Key on file ending in ${e}`"],
    ["the key's removal sheet", "confirmTitle:`Remove the seats.aero key?`"],
    ["the core error in a sentence a screen shows", "message:`Add a seats.aero API key in Settings.`"],
  ])("fails on %s", (_, chunk) => {
    const result = run({ "assets/index-abc.js": `${KNOWN};\n${chunk}` });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("assets/index-abc.js: contains");
  });

  it("allows a known string only in its own surroundings", () => {
    // "AI assistance" outside the COPY row, and the system prompt's words in a sentence a person would read.
    for (const chunk of ["{en:`AI assistance`,zh:`AI辅助`}", "`Search with your own seats.aero Pro key.`"]) {
      expect(run({ "assets/index-abc.js": `${KNOWN};\n${chunk}` }).ok, chunk).toBe(false);
    }
  });

  it("fails on a chunk of the key page, and on a bundle without the OAuth connect page's words", () => {
    expect(run({ "assets/index-abc.js": KNOWN, "assets/SeatsKeyScreen-1a2b.js": "export{}" }).out).toContain("a chunk of the key page");
    expect(run({ "assets/index-abc.js": KNOWN, "assets/seats-key-copy-1a2b.js": "export{}" }).ok).toBe(false);
    for (const missing of ["connect:`Connect seats.aero`,", "consent:`https://seats.aero/oauth2/consent`"]) {
      const result = run({ "assets/index-abc.js": KNOWN.replace(missing, "") });
      expect(result.ok, missing).toBe(false);
      expect(result.out).toContain("the bundle was not built as the OAuth flavour");
    }
  });

  it("fails on a chunk of Ask's pages, whatever it holds, and searches CSS, HTML and JSON too", () => {
    expect(run({ "assets/index-abc.js": KNOWN, "assets/AskScreen-1a2b.js": "export{}" }).out).toContain("a chunk of Ask or the Anthropic key page");
    expect(run({ "assets/index-abc.js": KNOWN, "assets/AnthropicKeyScreen-1a2b.js": "export{}" }).ok).toBe(false);
    expect(run({ "assets/index-abc.js": KNOWN, "index.html": "<a href='#/ask'>x</a>" }).ok).toBe(false);
    expect(run({ "assets/index-abc.js": KNOWN, "data.json": '{"label":"Pro plan"}' }).ok).toBe(false);
  });

  it("fails when a documented hit is gone, so the allow-list cannot go stale", () => {
    const result = run({ "assets/index-abc.js": KNOWN.split(";\n").slice(1).join(";\n") });
    expect(result.ok).toBe(false);
    expect(result.out).toMatch(/allow-list entry for "AI assistance" .* matched nothing: remove it/);
  });

  it("refuses to pass when there is no build to check", () => {
    const missing = path.join(tmpdir(), "store-bundle-does-not-exist");
    expect(() => execFileSync(process.execPath, [SCRIPT, missing], { stdio: "pipe" })).toThrow();
  });
});
