import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEPT_MCP_SERVERS,
  KEPT_MCP_SERVER_NAMES,
  isKeptMcpTool,
  mcpServersOption,
  parseMcpToolName,
} from "./mcp";
import { PRUNED_SKILLS, isPrunedSkill } from "./pruned";
import {
  PLUGIN_NAME,
  REQUIRED_SKILL_ID,
  listPluginSkillDirs,
  pluginRootExists,
  pluginSkillAllowlist,
  skillId,
} from "./skills";

/** ARCHITECTURE.md §6.1 — the 21 skills that must never be loadable. */
const EXPECTED_PRUNED = [
  "american-airlines",
  "amex-travel",
  "chase-travel",
  "southwest",
  "ticketsatwork",
  "vrbo",
  "sutochno",
  "google-flights",
  "seatmaps",
  "atlas-obscura",
  "deutsche-bahn",
  "getting-started",
  "gardening",
  "trip-log",
  "awardwallet",
  "rapidapi",
  "serpapi",
  "tripadvisor",
  "scandinavia-transit",
  "round-the-world",
  "compare-hotels",
];

const tmpDirs: string[] = [];
function fakePlugin(
  skillDirs: string[],
  opts: { manifest?: boolean; skillMd?: boolean } = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awardgrid-plugin-"));
  tmpDirs.push(root);
  if (opts.manifest !== false) {
    fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: PLUGIN_NAME }),
    );
  }
  for (const d of skillDirs) {
    fs.mkdirSync(path.join(root, "skills", d), { recursive: true });
    if (opts.skillMd !== false)
      fs.writeFileSync(path.join(root, "skills", d, "SKILL.md"), `# ${d}\n`);
  }
  return root;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("pruned deny list", () => {
  it("is exactly the 21 skills from ARCHITECTURE §6.1", () => {
    expect([...PRUNED_SKILLS].sort()).toEqual([...EXPECTED_PRUNED].sort());
    expect(PRUNED_SKILLS).toHaveLength(21);
  });

  it("matches bare and namespaced names, case-insensitively, and nothing else", () => {
    for (const s of EXPECTED_PRUNED) {
      expect(isPrunedSkill(s)).toBe(true);
      expect(isPrunedSkill(skillId(s))).toBe(true);
      expect(isPrunedSkill(`other-plugin:${s}`)).toBe(true);
    }
    expect(isPrunedSkill("SOUTHWEST")).toBe(true);
    expect(isPrunedSkill("seats-aero")).toBe(false);
    expect(isPrunedSkill("travel-hacker:seats-aero")).toBe(false);
    expect(isPrunedSkill("southwest-airlines")).toBe(false);
    expect(isPrunedSkill("")).toBe(false);
  });
});

describe("skill allowlist from the physical build", () => {
  it("lists only real skill dirs, namespaced and sorted, never a pruned one even if its dir exists", () => {
    const root = fakePlugin([
      "seats-aero",
      "duffel",
      "alliances",
      ...EXPECTED_PRUNED,
      "Bad Name",
      "trip-planner",
    ]);
    fs.writeFileSync(path.join(root, "skills", "not-a-dir"), "x");
    fs.mkdirSync(path.join(root, "skills", "no-skill-md"));
    expect(listPluginSkillDirs(root)).toEqual([
      "alliances",
      "duffel",
      "seats-aero",
      "trip-planner",
    ]);
    const allow = pluginSkillAllowlist(root);
    expect(allow).toEqual([
      "travel-hacker:alliances",
      "travel-hacker:duffel",
      "travel-hacker:seats-aero",
      "travel-hacker:trip-planner",
    ]);
    expect(allow).toContain(REQUIRED_SKILL_ID);
    for (const p of EXPECTED_PRUNED) expect(allow).not.toContain(skillId(p));
    for (const a of allow) expect(a).toMatch(/^travel-hacker:[a-z0-9-]+$/); // no wildcards, ever
  });

  it("returns [] for a missing dir and pluginRootExists needs manifest + seats-aero", () => {
    expect(listPluginSkillDirs("/definitely/not/here")).toEqual([]);
    expect(pluginRootExists("/definitely/not/here")).toBe(false);
    expect(pluginRootExists(fakePlugin(["duffel"]))).toBe(false);
    expect(pluginRootExists(fakePlugin(["seats-aero"], { manifest: false }))).toBe(false);
    expect(pluginRootExists(fakePlugin(["seats-aero"]))).toBe(true);
  });

  it("the real build (when present) contains seats-aero and no pruned skill", () => {
    const root = path.resolve(process.cwd(), "build", "plugin");
    if (!pluginRootExists(root)) return;
    const allow = pluginSkillAllowlist(root);
    expect(allow).toContain(REQUIRED_SKILL_ID);
    for (const p of EXPECTED_PRUNED) expect(allow).not.toContain(skillId(p));
    expect(allow.length).toBeGreaterThanOrEqual(10);
  });
});

describe("kept MCP servers", () => {
  it("are exactly the four keyless http servers from the toolkit .mcp.json", () => {
    expect(KEPT_MCP_SERVER_NAMES).toEqual(["skiplagged", "kiwi", "trivago", "ferryhopper"]);
    expect(KEPT_MCP_SERVERS).toEqual({
      skiplagged: { type: "http", url: "https://mcp.skiplagged.com/mcp" },
      kiwi: { type: "http", url: "https://mcp.kiwi.com" },
      trivago: { type: "http", url: "https://mcp.trivago.com/mcp" },
      ferryhopper: { type: "http", url: "https://mcp.ferryhopper.com/mcp" },
    });
    const vendored = path.resolve(process.cwd(), "vendor", "travel-hacking-toolkit", ".mcp.json");
    if (fs.existsSync(vendored)) {
      const json = JSON.parse(fs.readFileSync(vendored, "utf8")) as {
        mcpServers: Record<string, { type?: string; url?: string }>;
      };
      for (const [name, cfg] of Object.entries(KEPT_MCP_SERVERS))
        expect(json.mcpServers[name]).toEqual({ type: "http", url: cfg.url });
    }
    const copy = mcpServersOption();
    expect(copy).toEqual(KEPT_MCP_SERVERS);
    expect(Object.isFrozen(copy)).toBe(false);
  });

  it("tool-name parsing", () => {
    expect(parseMcpToolName("mcp__kiwi__search")).toEqual({ server: "kiwi", tool: "search" });
    expect(parseMcpToolName("mcp__kiwi__search__deep")).toEqual({
      server: "kiwi",
      tool: "search__deep",
    });
    expect(parseMcpToolName("mcp__kiwi")).toBeNull();
    expect(parseMcpToolName("mcp____x")).toBeNull();
    expect(parseMcpToolName("Bash")).toBeNull();
    expect(isKeptMcpTool("mcp__kiwi__search")).toBe(true);
    expect(isKeptMcpTool("mcp__airbnb__search")).toBe(false);
    expect(isKeptMcpTool("mcp__liteapi__x")).toBe(false);
    expect(isKeptMcpTool("mcp__constructor__x")).toBe(false);
  });
});
