/**
 * scripts/check-store-bundle.mjs, the App Store build's last gate (`npm run build:store`), run as the build runs it:
 * over a dist/ directory, here a throwaway one with hand-written chunks. It must find Ask and paid-plan phrases
 * wherever they are, allow only the documented hits in their own surroundings, and fail on an allow-list entry that no
 * longer matches anything. No build, no network.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "check-store-bundle.mjs");
const dirs: string[] = [];

/** The known hits a real store bundle carries (the script fails when an allow-list entry matches nothing). */
const KNOWN = [
  '"ai.entry":{en:`AI assistance`,zh:`AI辅助`},"ai.query_only":{en:`Only the query conditions will be sent.`}',
  "console.warn('See https://platform.claude.com/docs/en/build-with-claude/compaction')",
  "`You are Ask. The person asking pays for you with their own Anthropic API key, and for seats.aero calls with their own seats.aero Pro key.`",
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
    expect(result.out).toMatch(/none found .* \(5 known hits allowed by 5 documented entries\)/);
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
