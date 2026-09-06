import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DENIED_TOOLS } from "./gate";
import {
  DEFAULT_ASK_MODEL,
  MAX_CONTEXT_CHARS,
  SESSION_ENV_NAMES,
  askModelFromEnv,
  buildAskOptions,
  buildSessionEnv,
  buildSystemPrompt,
  type BuildAskOptionsInput,
} from "./options";

const PLUGIN_ROOT = path.resolve(process.cwd(), "build", "plugin");
const ALICE_KEY = "pro_alice_SECRET_KEY_1111";
const BOB_KEY = "pro_bob_SECRET_KEY_2222";
const BOB_DUFFEL = "duffel_live_bob_3333";

function input(
  userId: string,
  keys: BuildAskOptionsInput["keys"],
  extra: Partial<BuildAskOptionsInput> = {},
): BuildAskOptionsInput {
  return {
    user: { id: userId },
    keys,
    pluginRoot: PLUGIN_ROOT,
    sessionDir: `/tmp/awardgrid-ask-${userId}`,
    model: "claude-sonnet-5",
    remainingUsd: 1.25,
    abortController: new AbortController(),
    context: {},
    hostEnv: {
      PATH: "/usr/bin:/bin",
      ANTHROPIC_API_KEY: "sk-ant-test",
      CANARY: "must-not-leak",
      MASTER_KEY: "nope",
    },
    now: new Date("2026-09-06T12:00:00Z"),
    ...extra,
  };
}

/** Top-level property names of `export declare type Options = { … };` in the installed sdk.d.ts. */
function sdkOptionNames(): Set<string> {
  const file = path.resolve(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => /^export declare type Options = \{/.test(l));
  expect(start).toBeGreaterThan(-1);
  const names = new Set<string>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\};/.test(line)) break;
    const m = /^ {4}([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line);
    if (m) names.add(m[1]!);
  }
  return names;
}

describe("buildAskOptions", () => {
  const savedCanary = process.env.CANARY;
  afterEach(() => {
    if (savedCanary === undefined) delete process.env.CANARY;
    else process.env.CANARY = savedCanary;
  });

  it("uses only option names that exist in the installed SDK's Options type (kickoff §0.2 #7)", () => {
    const names = sdkOptionNames();
    expect(names.size).toBeGreaterThan(20);
    const opts = buildAskOptions(input("alice", { seats_aero: ALICE_KEY }));
    for (const key of Object.keys(opts))
      expect(names.has(key), `Options.${key} is not in sdk.d.ts`).toBe(true);
    // The specific shapes ARCHITECTURE §3 verified:
    expect(opts.plugins).toEqual([{ type: "local", path: PLUGIN_ROOT, skipMcpDiscovery: true }]);
    expect(opts.settingSources).toEqual([]);
    expect(opts.strictMcpConfig).toBe(true);
    expect(opts.permissionMode).toBe("default");
    expect(opts.allowedTools).toEqual([]); // nothing bypasses canUseTool
    expect(opts.disallowedTools).toEqual([...DENIED_TOOLS]);
    expect(opts.maxTurns).toBe(12);
    expect(opts.maxBudgetUsd).toBe(0.5); // min(0.5, 1.25)
    expect(
      buildAskOptions(input("alice", { seats_aero: ALICE_KEY }, { remainingUsd: 0.2 }))
        .maxBudgetUsd,
    ).toBe(0.2);
    expect(opts.includePartialMessages).toBe(true);
    expect(opts.persistSession).toBe(false);
    expect(opts.model).toBe("claude-sonnet-5");
    expect(opts.cwd).toBe(PLUGIN_ROOT);
    expect(typeof opts.canUseTool).toBe("function");
    expect(Object.keys(opts.mcpServers ?? {})).toEqual([
      "skiplagged",
      "kiwi",
      "trivago",
      "ferryhopper",
    ]);
    expect(Array.isArray(opts.skills)).toBe(true);
    for (const s of opts.skills as string[]) expect(s).toMatch(/^travel-hacker:[a-z0-9-]+$/);
    expect(typeof opts.systemPrompt).toBe("string");
  });

  it("two users: each env holds only its own key, nothing shared, nothing from process.env", () => {
    process.env.CANARY = "canary-in-process-env";
    const a = buildAskOptions(input("alice", { seats_aero: ALICE_KEY }));
    const b = buildAskOptions(input("bob", { seats_aero: BOB_KEY, duffel: BOB_DUFFEL }));
    const envA = a.env as Record<string, string>;
    const envB = b.env as Record<string, string>;

    expect(envA.SEATS_AERO_API_KEY).toBe(ALICE_KEY);
    expect(envB.SEATS_AERO_API_KEY).toBe(BOB_KEY);
    expect(envA.DUFFEL_API_KEY_LIVE).toBeUndefined();
    expect(envB.DUFFEL_API_KEY_LIVE).toBe(BOB_DUFFEL);
    expect(envA.IGNAV_API_KEY).toBeUndefined();

    const jsonA = JSON.stringify(envA);
    const jsonB = JSON.stringify(envB);
    expect(jsonA).not.toContain(BOB_KEY);
    expect(jsonA).not.toContain(BOB_DUFFEL);
    expect(jsonB).not.toContain(ALICE_KEY);
    for (const j of [jsonA, jsonB]) {
      expect(j).not.toContain("canary");
      expect(j).not.toContain("must-not-leak");
      expect(j).not.toContain("MASTER_KEY");
    }
    for (const env of [envA, envB]) {
      for (const k of Object.keys(env))
        expect(SESSION_ENV_NAMES, `unexpected env var ${k}`).toContain(k);
      expect(env.HOME).toMatch(/awardgrid-ask-/);
      expect(env.TMPDIR).toBe(path.join(env.HOME!, "tmp"));
      expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(env.HOME!, "config"));
      expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
      expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
      expect(env.API_TIMEOUT_MS).toBe("90000");
      expect(env.CLAUDE_CODE_MAX_RETRIES).toBe("2");
      expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
      expect(env.PATH).toBe("/usr/bin:/bin");
    }
    expect(envA.HOME).not.toBe(envB.HOME);
    // Keys never leak into the prompt or anywhere else on the options object.
    const rest = JSON.stringify({
      ...a,
      env: undefined,
      canUseTool: undefined,
      abortController: undefined,
    });
    expect(rest).not.toContain(ALICE_KEY);
    expect(rest).not.toContain("sk-ant-test");
  });

  it("buildSessionEnv reads only PATH, ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL from the host env (default process.env)", () => {
    process.env.CANARY = "canary";
    const env = buildSessionEnv({ keys: { seats_aero: ALICE_KEY }, sessionDir: "/tmp/s" });
    expect(env.CANARY).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin");
    const noKey = buildSessionEnv({
      keys: { seats_aero: ALICE_KEY },
      sessionDir: "/tmp/s",
      hostEnv: {},
    });
    expect(noKey.ANTHROPIC_API_KEY).toBeUndefined();
    expect(noKey.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(noKey.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
    const gateway = buildSessionEnv({
      keys: { seats_aero: ALICE_KEY },
      sessionDir: "/tmp/s",
      hostEnv: { ANTHROPIC_BASE_URL: "https://gateway.example.com/v1", OTHER: "x" },
    });
    expect(gateway.ANTHROPIC_BASE_URL).toBe("https://gateway.example.com/v1");
    expect(gateway.OTHER).toBeUndefined();
    const plain = buildSessionEnv({
      keys: { seats_aero: ALICE_KEY },
      sessionDir: "/tmp/s",
      hostEnv: { ANTHROPIC_BASE_URL: "http://insecure.example.com" },
    });
    expect(plain.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("model comes from AWARDGRID_ASK_MODEL with the ARCHITECTURE §4 default", () => {
    expect(DEFAULT_ASK_MODEL).toBe("claude-sonnet-5");
    expect(askModelFromEnv({})).toBe("claude-sonnet-5");
    expect(askModelFromEnv({ AWARDGRID_ASK_MODEL: " claude-opus-5 " })).toBe("claude-opus-5");
    expect(askModelFromEnv({ AWARDGRID_ASK_MODEL: "" })).toBe("claude-sonnet-5");
  });
});

describe("buildSystemPrompt", () => {
  it("states the rules, embeds the context as JSON, and carries no key", () => {
    const p = buildSystemPrompt(
      {
        query: { origins: ["SEA"], dests: ["NRT"], cabins: ["F"] } as never,
        cell: {
          origin: "SEA",
          dest: "NRT",
          date: "2026-10-01",
          cabin: "F",
          program: "alaska",
          miles: 70000,
        },
        lang: "zh",
      },
      new Date("2026-09-06T12:00:00Z"),
    );
    expect(p).toContain("search, compare, and explain");
    expect(p).toMatch(/never do: book anything, log in anywhere/);
    expect(p).toContain("seats.aero Partner API");
    expect(p).toContain("Never use seats.aero Live Search");
    expect(p).toContain("SEATS_AERO_API_KEY");
    expect(p).toContain("NEVER print, echo, log, or repeat a key");
    expect(p).toContain("cached awards can disappear");
    expect(p).toContain("answer in the language of the user's question");
    expect(p).toContain("zh-CN");
    expect(p).toContain('"Data: seats.aero"');
    expect(p).toContain('"origins":["SEA"]');
    expect(p).toContain('"program":"alaska"');
    expect(p).toContain("2026-09-06T12:00:00.000Z");
    expect(p).not.toMatch(/pro_|sk-ant/);
    const empty = buildSystemPrompt();
    expect(empty).toContain("current grid QueryObject: null");
    expect(empty).toContain("selected cell: null");
    expect(empty).toContain("The UI locale is en");
  });

  it("truncates oversized context", () => {
    const big = buildSystemPrompt({ cell: { blob: "x".repeat(MAX_CONTEXT_CHARS * 2) } });
    expect(big).toContain("…(truncated)");
    expect(big.length).toBeLessThan(MAX_CONTEXT_CHARS + 3000);
  });
});
