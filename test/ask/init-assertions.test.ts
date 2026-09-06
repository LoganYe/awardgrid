/**
 * Kickoff §9 Phase 4 self-acceptance: "init message's loaded plugin/skill list logged and asserted
 * to exclude every pruned skill".
 *
 * The fixture test/fixtures/ask/init-message.json is recorded by `scripts/ask-smoke.ts` from a REAL
 * Claude Agent SDK session (AWARDGRID_LIVE_SMOKE=1). This test runs everywhere (no network, no key)
 * against that recording. Re-record after changing the plugin build or the SDK version.
 *
 * Observed facts about the init message (Claude Code 2.1.260, SDK 0.3.260), relied on here:
 *   - `skills` lists EVERY skill physically present in build/plugin/skills, regardless of the
 *     `skills` allowlist option, plus Claude Code's own bundled skills (bare names such as
 *     "deep-research", "code-review"). The allowlist hides unlisted skills from the model; it does
 *     not change what init reports. Physical pruning is therefore the control this test verifies.
 *   - `mcp_servers[].status` was "connected" for all four kept servers; "pending" would also be
 *     acceptable (ARCHITECTURE §3: pending is not failure) — only "failed" is rejected.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRUNED_SKILLS as MANIFEST_PRUNED,
  KEPT_SKILLS as MANIFEST_KEPT,
} from "../../scripts/plugin-manifest";
import { KEPT_MCP_SERVER_NAMES } from "@/lib/ask/mcp";
import { DEFAULT_ASK_MODEL } from "@/lib/ask/options";
import { PRUNED_SKILLS } from "@/lib/ask/pruned";
import { PLUGIN_NAME, skillId } from "@/lib/ask/skills";

interface InitFixture {
  recorded_at: string;
  plugins: { name: string; path: string }[];
  skills: string[];
  mcp_servers: { name: string; status: string }[];
  model: string;
  configured_model: string;
  claude_code_version: string | null;
}

const FIXTURE = path.resolve(__dirname, "..", "fixtures", "ask", "init-message.json");

function loadFixture(): InitFixture {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as InitFixture;
}

describe("recorded SDK init message (test/fixtures/ask/init-message.json)", () => {
  const init = loadFixture();
  const pluginSkills = init.skills.filter((s) => s.startsWith(`${PLUGIN_NAME}:`));

  it("carries no absolute path, key, or user data", () => {
    const raw = fs.readFileSync(FIXTURE, "utf8");
    expect(raw).not.toMatch(/\/Users\/|\/home\/|C:\\/);
    expect(raw).not.toMatch(/sk-ant-|pro_|fake-smoke-key/);
    expect(init.plugins.every((p) => p.path === "<plugin-root>")).toBe(true);
  });

  it("loaded the travel-hacker plugin", () => {
    expect(init.plugins.map((p) => p.name)).toContain(PLUGIN_NAME);
    expect(init.plugins).toHaveLength(1);
  });

  it("lists the required skills", () => {
    for (const s of ["seats-aero", "transfer-partners", "points-valuations"]) {
      expect(init.skills).toContain(skillId(s));
    }
  });

  it("lists every kept skill and nothing else under the travel-hacker namespace", () => {
    const expected = [...MANIFEST_KEPT].map(skillId).sort();
    expect([...pluginSkills].sort()).toEqual(expected);
  });

  it("contains none of the 21 pruned skills (either deny list)", () => {
    const manifestPruned = Object.keys(MANIFEST_PRUNED).sort();
    expect(manifestPruned).toHaveLength(21);
    expect([...PRUNED_SKILLS].sort()).toEqual(manifestPruned); // src/ and scripts/ agree
    for (const name of PRUNED_SKILLS) {
      expect(init.skills, name).not.toContain(skillId(name));
      expect(init.skills, name).not.toContain(name);
    }
  });

  it("connected only the four kept MCP servers, none failed", () => {
    const names = init.mcp_servers.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(KEPT_MCP_SERVER_NAMES).toContain(n);
    for (const n of KEPT_MCP_SERVER_NAMES) expect(names).toContain(n);
    for (const s of init.mcp_servers) {
      expect(["connected", "pending"], `${s.name} is ${s.status}`).toContain(s.status);
    }
    expect(names).not.toContain("liteapi");
    expect(names).not.toContain("airbnb");
  });

  it("runs the configured ask model", () => {
    expect(init.model).toBe(init.configured_model);
    expect(init.configured_model).toBe(DEFAULT_ASK_MODEL);
  });

  it("was recorded from a real Claude Code binary", () => {
    expect(init.claude_code_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Date.parse(init.recorded_at)).toBeGreaterThan(0);
  });
});
