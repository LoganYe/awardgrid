/**
 * Tests for the pruned travel-hacker plugin build (kickoff §7.2; ARCHITECTURE.md §3.3, §6).
 *
 * Builds from the REAL vendored toolkit into a temp dir — no network, no keys. If the submodule is
 * not checked out (fresh clone without --recurse-submodules) the filesystem suite is skipped with a
 * note; the pure-manifest assertions still run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPlugin,
  classificationProblems,
  DEFAULT_SRC,
  listSourceSkills,
  main,
  PluginBuildError,
  PRUNED_MD,
  validatePlugin,
  walkFiles,
  type BuildResult,
} from "./build-plugin";
import {
  ALLOWED_MENTIONS,
  DROPPED_MCP_SERVERS,
  EXCLUDED_FILE_PATTERNS,
  KEPT_MCP_SERVERS,
  KEPT_SKILL_IDS,
  KEPT_SKILLS,
  MUST_KEEP_SKILLS,
  PLUGIN_NAME,
  PRUNE_PATTERNS,
  PRUNED_SKILL_IDS,
  PRUNED_SKILLS,
  skillId,
} from "./plugin-manifest";

const SRC = DEFAULT_SRC;
const haveSource =
  fs.existsSync(path.join(SRC, ".claude-plugin", "plugin.json")) &&
  fs.existsSync(path.join(SRC, "skills"));

const SCRATCH = process.env.CLAUDE_SCRATCHPAD_DIR ?? os.tmpdir();

function mkTmp(label: string): string {
  return fs.mkdtempSync(path.join(SCRATCH, `awardgrid-plugin-${label}-`));
}

// ------------------------------------------------------------------------------------------------
// Pure manifest assertions (no filesystem)
// ------------------------------------------------------------------------------------------------
describe("plugin-manifest (pure data)", () => {
  it("PLUGIN_NAME / skillId produce the SDK's plugin:skill form", () => {
    expect(PLUGIN_NAME).toBe("travel-hacker");
    expect(skillId("seats-aero")).toBe("travel-hacker:seats-aero");
    expect(KEPT_SKILL_IDS).toContain("travel-hacker:seats-aero");
    expect(PRUNED_SKILL_IDS).toContain("travel-hacker:southwest");
    expect(KEPT_SKILL_IDS.some((id) => id.includes("*"))).toBe(false);
  });

  it("KEPT and PRUNED are disjoint, sorted, and every pruned entry has a reason", () => {
    const kept = new Set(KEPT_SKILLS);
    for (const [name, reason] of Object.entries(PRUNED_SKILLS)) {
      expect(kept.has(name), `${name} is in both lists`).toBe(false);
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
    }
    expect([...KEPT_SKILLS]).toEqual([...KEPT_SKILLS].sort());
    expect(new Set(KEPT_SKILLS).size).toBe(KEPT_SKILLS.length);
  });

  it("the kickoff §7.2 must-keep skills are all in KEPT_SKILLS", () => {
    for (const name of [
      "seats-aero",
      "duffel",
      "ignav",
      "transfer-partners",
      "points-valuations",
      "flight-search-strategy",
      "alliances",
      "lessons-learned",
      "wheretocredit",
      "wikipedia-airports",
    ]) {
      expect(MUST_KEEP_SKILLS).toContain(name);
      expect(KEPT_SKILLS).toContain(name);
    }
  });

  it("the kickoff §0.2 #5 credential skills are all pruned", () => {
    for (const name of [
      "chase-travel",
      "amex-travel",
      "american-airlines",
      "southwest",
      "ticketsatwork",
      "vrbo",
      "sutochno",
    ]) {
      expect(Object.keys(PRUNED_SKILLS)).toContain(name);
    }
    // plus the scraping / key / installer / filesystem ones named in the task
    for (const name of [
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
    ]) {
      expect(Object.keys(PRUNED_SKILLS)).toContain(name);
    }
    // explicitly kept per the task (the script referenced by it is NOT shipped)
    expect(KEPT_SKILLS).toContain("transfer-bonuses");
    // pruned: the SDK init lists every on-disk skill regardless of the allowlist (ARCHITECTURE §6.1)
    expect(Object.keys(PRUNED_SKILLS)).toContain("round-the-world");
    expect(KEPT_SKILLS).not.toContain("round-the-world");
  });

  it("PRUNE_PATTERNS covers every forbidden marker and is case-insensitive", () => {
    for (const s of [
      "Docker",
      "patchright",
      "Playwright",
      "agent-browser",
      "SW_USERNAME",
      "AA_PASSWORD",
      "printenv",
    ]) {
      expect(PRUNE_PATTERNS.test(s), s).toBe(true);
    }
    expect(PRUNE_PATTERNS.test("curl -H 'Partner-Authorization: $SEATS_AERO_API_KEY'")).toBe(false);
    expect(PRUNE_PATTERNS.flags).not.toContain("g"); // a sticky lastIndex would make .test() flaky
  });

  it("no ALLOWED_MENTIONS entry names a pruned skill, and every reason is non-trivial", () => {
    for (const [rel, reason] of Object.entries(ALLOWED_MENTIONS)) {
      const m = /^skills\/([^/]+)\//.exec(rel);
      if (m) {
        expect(KEPT_SKILLS, rel).toContain(m[1]);
      }
      expect(reason.length, rel).toBeGreaterThan(20);
    }
  });

  it("KEPT_MCP_SERVERS are exactly the four keyless http servers; dropped ones documented", () => {
    expect(Object.keys(KEPT_MCP_SERVERS).sort()).toEqual([
      "ferryhopper",
      "kiwi",
      "skiplagged",
      "trivago",
    ]);
    for (const s of Object.values(KEPT_MCP_SERVERS)) {
      expect(s.type).toBe("http");
      expect(s.url).toMatch(/^https:\/\//);
    }
    expect(Object.keys(DROPPED_MCP_SERVERS).sort()).toEqual(["airbnb", "liteapi"]);
    expect(DROPPED_MCP_SERVERS.liteapi).toMatch(/LITEAPI_API_KEY/);
    expect(DROPPED_MCP_SERVERS.airbnb).toMatch(/npx/);
    expect(DROPPED_MCP_SERVERS.airbnb).toMatch(/--ignore-robots-txt/);
  });

  it("EXCLUDED_FILE_PATTERNS rejects scripts and Dockerfiles but not markdown/json", () => {
    const hit = (name: string) => EXCLUDED_FILE_PATTERNS.some((re) => re.test(name));
    for (const f of [
      "x.py",
      "ao.mjs",
      "a.js",
      "run.sh",
      "Dockerfile",
      "package.json",
      "package-lock.json",
    ])
      expect(hit(f), f).toBe(true);
    for (const f of ["SKILL.md", "README.md", "transfer-partners.json", "LICENSE"])
      expect(hit(f), f).toBe(false);
  });

  it("classificationProblems flags unclassified, missing, and doubly-classified skills", () => {
    const all = [...KEPT_SKILLS, ...Object.keys(PRUNED_SKILLS)];
    expect(classificationProblems(all)).toEqual([]);
    expect(classificationProblems([...all, "brand-new-skill"]).join("\n")).toMatch(
      /unclassified skill "brand-new-skill"/,
    );
    expect(classificationProblems(all.filter((n) => n !== "seats-aero")).join("\n")).toMatch(
      /"seats-aero" does not exist/,
    );
  });

  it("main() rejects unknown arguments without touching the filesystem", () => {
    const err = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      expect(main(["--bogus"])).toBe(2);
    } finally {
      console.error = err;
    }
    expect(lines.join("\n")).toMatch(/unknown argument --bogus/);
  });
});

// ------------------------------------------------------------------------------------------------
// Real build from the vendored toolkit
// ------------------------------------------------------------------------------------------------
describe.skipIf(!haveSource)("build-plugin against vendor/travel-hacking-toolkit", () => {
  let out: string;
  let result: BuildResult;
  let outFiles: string[];

  beforeAll(() => {
    out = mkTmp("out");
    result = buildPlugin({ src: SRC, out });
    outFiles = walkFiles(out);
  });

  afterAll(() => {
    if (out) fs.rmSync(out, { recursive: true, force: true });
  });

  it("KEPT ∪ PRUNED equals the set of skill dirs in the vendored repo (a toolkit update must be classified)", () => {
    const source = listSourceSkills(SRC);
    const classified = [...KEPT_SKILLS, ...Object.keys(PRUNED_SKILLS)].sort();
    expect(classified).toEqual(source);
    expect(classificationProblems(source)).toEqual([]);
  });

  it("every PRUNED skill is absent from the output", () => {
    for (const name of Object.keys(PRUNED_SKILLS)) {
      expect(fs.existsSync(path.join(out, "skills", name)), name).toBe(false);
    }
    const outSkills = fs.readdirSync(path.join(out, "skills")).sort();
    expect(outSkills).toEqual([...KEPT_SKILLS].sort());
  });

  it("every KEPT skill is present with a SKILL.md that is a real file (symlinks resolved)", () => {
    for (const name of KEPT_SKILLS) {
      const p = path.join(out, "skills", name, "SKILL.md");
      const st = fs.lstatSync(p);
      expect(st.isFile(), name).toBe(true);
      expect(st.isSymbolicLink(), name).toBe(false);
      expect(fs.statSync(p).size, name).toBeGreaterThan(100);
    }
    expect(fs.lstatSync(path.join(out, "skills")).isSymbolicLink()).toBe(false);
  });

  it("no output file matches PRUNE_PATTERNS except the documented ALLOWED_MENTIONS", () => {
    const hits: string[] = [];
    for (const rel of outFiles) {
      if (rel === PRUNED_MD) continue;
      if (PRUNE_PATTERNS.test(fs.readFileSync(path.join(out, rel), "utf8"))) hits.push(rel);
    }
    expect(hits.sort()).toEqual(Object.keys(ALLOWED_MENTIONS).sort());
    expect(result.allowedMentionHits).toEqual(Object.keys(ALLOWED_MENTIONS).sort());
  });

  it("no *_USERNAME / *_PASSWORD reference survives outside the single documented flight-search-strategy example", () => {
    const credRe = /_USERNAME|_PASSWORD|_PASS\b/;
    const hits = outFiles.filter(
      (rel) => rel !== PRUNED_MD && credRe.test(fs.readFileSync(path.join(out, rel), "utf8")),
    );
    expect(hits).toEqual(["skills/flight-search-strategy/SKILL.md"]);
  });

  it("no .py / .mjs / .js / .sh / Dockerfile / package.json anywhere in the output", () => {
    const bad = outFiles.filter((rel) =>
      EXCLUDED_FILE_PATTERNS.some((re) => re.test(path.posix.basename(rel))),
    );
    expect(bad).toEqual([]);
    expect(outFiles.filter((rel) => /\.(py|mjs|js)$/.test(rel) || /Dockerfile/.test(rel))).toEqual(
      [],
    );
  });

  it("data/*.json copied, including transfer-partners.json and points-valuations.json", () => {
    for (const f of [
      "transfer-partners.json",
      "points-valuations.json",
      "transfer-bonuses.json",
      "alliances.json",
    ]) {
      const p = path.join(out, "data", f);
      expect(fs.existsSync(p), f).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(p, "utf8")), f).not.toThrow();
    }
    const srcData = fs
      .readdirSync(path.join(SRC, "data"))
      .filter((n) => n.endsWith(".json"))
      .sort();
    expect(fs.readdirSync(path.join(out, "data")).sort()).toEqual(srcData);
  });

  it("LICENSE is copied verbatim (MIT, Michael Borohovski)", () => {
    const lic = fs.readFileSync(path.join(out, "LICENSE"), "utf8");
    expect(lic).toBe(fs.readFileSync(path.join(SRC, "LICENSE"), "utf8"));
    expect(lic).toMatch(/MIT License/);
    expect(lic).toMatch(/Michael Borohovski/);
  });

  it("plugin.json is copied verbatim and named travel-hacker", () => {
    const rel = path.join(".claude-plugin", "plugin.json");
    const built = fs.readFileSync(path.join(out, rel), "utf8");
    expect(built).toBe(fs.readFileSync(path.join(SRC, rel), "utf8"));
    expect((JSON.parse(built) as { name: string }).name).toBe(PLUGIN_NAME);
  });

  it("agents/, .mcp.json, scripts/, commands/, hooks/ are absent", () => {
    for (const f of [
      "agents",
      ".mcp.json",
      "scripts",
      "commands",
      "hooks",
      "plugins",
      ".env.example",
    ]) {
      expect(fs.existsSync(path.join(out, f)), f).toBe(false);
    }
    expect(fs.readdirSync(out).sort()).toEqual(
      [".claude-plugin", "LICENSE", PRUNED_MD, "data", "skills"].sort(),
    );
  });

  it("KEPT_MCP_SERVERS match the vendored .mcp.json exactly; dropped servers exist there and are not kept", () => {
    const mcp = JSON.parse(fs.readFileSync(path.join(SRC, ".mcp.json"), "utf8")) as {
      mcpServers: Record<
        string,
        { type?: string; url?: string; command?: string; headers?: unknown }
      >;
    };
    for (const [name, def] of Object.entries(KEPT_MCP_SERVERS)) {
      const entry = mcp.mcpServers[name];
      expect(entry, name).toBeDefined();
      expect(entry?.type).toBe("http");
      expect(entry?.url).toBe(def.url);
      expect(entry?.headers, `${name} must be keyless`).toBeUndefined();
    }
    for (const name of Object.keys(DROPPED_MCP_SERVERS)) {
      expect(mcp.mcpServers[name], name).toBeDefined();
      expect(name in KEPT_MCP_SERVERS).toBe(false);
    }
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(
      [...Object.keys(KEPT_MCP_SERVERS), ...Object.keys(DROPPED_MCP_SERVERS)].sort(),
    );
  });

  it("PRUNED.md lists every pruned skill with its reason and carries no timestamp", () => {
    const md = fs.readFileSync(path.join(out, PRUNED_MD), "utf8");
    for (const [name, reason] of Object.entries(PRUNED_SKILLS)) {
      expect(md).toContain(`| \`${name}\` | ${reason} |`);
    }
    for (const name of KEPT_SKILLS) expect(md).toContain(`- \`${name}\``);
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(md).not.toMatch(/generated at|timestamp/i);
  });

  it("output is deterministic: a second build yields the identical file list and bytes", () => {
    const out2 = mkTmp("out2");
    try {
      const r2 = buildPlugin({ src: SRC, out: out2 });
      expect(r2.written).toEqual(result.written);
      expect(walkFiles(out2)).toEqual(outFiles);
      for (const rel of outFiles) {
        expect(fs.readFileSync(path.join(out2, rel)), rel).toEqual(
          fs.readFileSync(path.join(out, rel)),
        );
      }
      expect(result.written).toEqual([...result.written].sort());
    } finally {
      fs.rmSync(out2, { recursive: true, force: true });
    }
    // Two full builds of the vendored toolkit in one test. The repo-wide 15 s budget
    // (vitest.config.ts) held on an idle machine and timed out at 17.6 s while Xcode was building
    // alongside it. The assertion was never the problem: given room it passes in about 14 s, so the
    // budget is sized for the work rather than for a quiet machine.
  }, 60_000);

  it("validatePlugin passes on the fresh build and rejects tampered outputs", () => {
    expect(validatePlugin(out).problems).toEqual([]);

    const tamper = (mutate: () => void, expected: RegExp) => {
      const copy = mkTmp("tamper");
      try {
        fs.cpSync(out, copy, { recursive: true });
        const cwd = process.cwd();
        process.chdir(copy);
        try {
          mutate();
        } finally {
          process.chdir(cwd);
        }
        expect(validatePlugin(copy).problems.join("\n")).toMatch(expected);
      } finally {
        fs.rmSync(copy, { recursive: true, force: true });
      }
    };

    tamper(() => {
      fs.mkdirSync("skills/southwest");
      fs.writeFileSync("skills/southwest/SKILL.md", "# southwest\n");
    }, /pruned skill "southwest" present in output/);
    tamper(() => {
      fs.mkdirSync("agents");
      fs.writeFileSync("agents/travel-hacker.md", "model: opus\n");
    }, /must not contain agents/);
    tamper(() => fs.writeFileSync(".mcp.json", "{}"), /must not contain \.mcp\.json/);
    tamper(
      () => fs.appendFileSync("skills/alliances/SKILL.md", "\nRun `docker run ghcr.io/x`\n"),
      /alliances\/SKILL\.md matches PRUNE_PATTERNS/,
    );
    tamper(
      () => fs.writeFileSync("skills/alliances/helper.py", "print(1)\n"),
      /excluded file type shipped: skills\/alliances\/helper\.py/,
    );
    tamper(
      () => fs.rmSync("skills/seats-aero/SKILL.md"),
      /kept skill "seats-aero" has no SKILL\.md/,
    );
    tamper(
      () =>
        fs.writeFileSync(
          ".claude-plugin/plugin.json",
          JSON.stringify({ name: "travel-hacking-toolkit" }),
        ),
      /plugin\.json name is "travel-hacking-toolkit", expected "travel-hacker"/,
    );
    tamper(() => fs.rmSync("LICENSE"), /LICENSE missing/);
  });

  it("buildPlugin throws PluginBuildError when the source is missing or overlaps the output", () => {
    const missing = mkTmp("missing");
    try {
      expect(() =>
        buildPlugin({ src: path.join(missing, "nope"), out: path.join(missing, "out") }),
      ).toThrow(PluginBuildError);
    } finally {
      fs.rmSync(missing, { recursive: true, force: true });
    }
    expect(() => buildPlugin({ src: SRC, out: path.join(SRC, "build") })).toThrow(/overlaps/);
  });

  it("buildPlugin wipes a stale output directory before writing", () => {
    const stale = mkTmp("stale");
    try {
      fs.mkdirSync(path.join(stale, "skills", "southwest"), { recursive: true });
      fs.writeFileSync(path.join(stale, "skills", "southwest", "SKILL.md"), "stale\n");
      fs.writeFileSync(path.join(stale, ".mcp.json"), "{}");
      buildPlugin({ src: SRC, out: stale });
      expect(fs.existsSync(path.join(stale, "skills", "southwest"))).toBe(false);
      expect(fs.existsSync(path.join(stale, ".mcp.json"))).toBe(false);
    } finally {
      fs.rmSync(stale, { recursive: true, force: true });
    }
  });
});
