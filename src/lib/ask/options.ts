/**
 * Builds the Agent SDK `Options` for one ask session (ARCHITECTURE.md §3, §3.2, §3.3, §4).
 *
 * Every option name used here exists in node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
 * (kickoff §0.2 #7 — options.test.ts reads that file and asserts it). The `env` map REPLACES the
 * subprocess environment: it is built from an explicit list and never spreads process.env, so
 * the only key material that reaches a session is the calling user's own (§0.2 #2).
 */
import path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { perRequestBudgetUsd } from "./budget";
import { DENIED_TOOLS, makeCanUseTool } from "./gate";
import { mcpServersOption } from "./mcp";
import { pluginSkillAllowlist } from "./skills";
import type { AskContext, AskKeys } from "./types";

/** Ask-lane model (ARCHITECTURE §4); env AWARDGRID_ASK_MODEL overrides. */
export const DEFAULT_ASK_MODEL = "claude-sonnet-5";
export const MAX_TURNS = 12;
/** Serialized context is capped so a huge grid cannot blow up the system prompt. */
export const MAX_CONTEXT_CHARS = 12_000;

export function askModelFromEnv(env: Record<string, string | undefined> = process.env): string {
  const m = env.AWARDGRID_ASK_MODEL?.trim();
  return m && m.length > 0 ? m : DEFAULT_ASK_MODEL;
}

function contextJson(value: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(value ?? null, null, 0) ?? "null";
  } catch {
    return "null";
  }
  return s.length > MAX_CONTEXT_CHARS ? `${s.slice(0, MAX_CONTEXT_CHARS)}…(truncated)` : s;
}

/** English, bilingual-aware system prompt. Contains no key material. */
export function buildSystemPrompt(context: AskContext = {}, now: Date = new Date()): string {
  const lang = context.lang === "zh" ? "zh-CN (Simplified Chinese)" : "en";
  const lines = [
    "You are awardgrid's award-travel advisor. awardgrid is a small self-hosted tool that shows award-flight availability grids from the seats.aero Partner API.",
    "",
    "What you do: search, compare, and explain award options — which program to book with, what transfers into it, how prices compare, what caveats apply.",
    "What you never do: book anything, log in anywhere, enter or ask for passwords or payment details, bypass any access control, rate limit, robots policy, or CAPTCHA, or open airline / bank / credit-card portal / loyalty-program websites. If a task would need any of that, say so and stop.",
    "",
    "Data sources:",
    "- Award availability comes ONLY from the seats.aero Partner API via the seats-aero skill's curl commands (Cached Search, Bulk Availability, Get Trips, Get Routes). Never use seats.aero Live Search.",
    "- The seats.aero key is already in the environment variable SEATS_AERO_API_KEY (Duffel: DUFFEL_API_KEY_LIVE; Ignav: IGNAV_API_KEY, when configured). Reference them only inside a curl -H header exactly as the skills show. NEVER print, echo, log, or repeat a key or any part of one, and never write a key into a URL.",
    "- Cash prices may come from the Duffel and Ignav skills when their keys are configured; otherwise say cash comparison is unavailable.",
    "- Reference skills (transfer partners, valuations, alliances, sweet spots, stopovers, holds, …) are read from the plugin's markdown and data/*.json files. The transfer-bonuses data is a shipped snapshot; its refresh script cannot run here. Portal skills (Chase/Amex/Southwest/AA) and browser automation are NOT available here — do not attempt them.",
    "- Only Bash commands of the form `curl https://<allowed API> … | jq …` are permitted; anything else is denied by policy, so do not retry denied commands with variations.",
    "",
    "Freshness: seats.aero returns cached availability. ALWAYS state how fresh the data is (the UpdatedAt / last-seen timestamps) and that cached awards can disappear before booking; suggest verifying on the program's site or by phone before transferring points.",
    "",
    `Language: answer in the language of the user's question (Chinese questions get Chinese answers). The UI locale is ${lang}. Keep airport, program, and cabin codes in Latin letters.`,
    "Style: be concise and concrete — short paragraphs or a compact table, numbers with units (miles, USD fees, seats), then a one-line recommendation. No marketing language.",
    'Attribution: end every answer with the line "Data: seats.aero".',
    "",
    `Current UTC time: ${now.toISOString()}.`,
    "Context from the user's screen (JSON; may be null):",
    `- current grid QueryObject: ${contextJson(context.query ?? null)}`,
    `- selected cell: ${contextJson(context.cell ?? null)}`,
    // UI/UX v1 T19: the grid row's 0 seats and null fees are "not reported", never "none" (docs/02 D02).
    "In the selected cell, seats_left 0 means the program did not report a seat count, and fees_cents null means the fees are not yet confirmed: say so, and never call them 0 seats or no fees.",
  ];
  return lines.join("\n");
}

export interface BuildAskOptionsInput {
  user: { id: string };
  keys: AskKeys;
  /** Absolute path to build/plugin. */
  pluginRoot: string;
  /** Per-request temp dir (HOME / TMPDIR / CLAUDE_CONFIG_DIR live under it). */
  sessionDir: string;
  model: string;
  /** Dollars left under today's cap. */
  remainingUsd: number;
  abortController: AbortController;
  context: AskContext;
  /**
   * Where PATH, ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are taken from (default process.env).
   * Only those three names are read; nothing else from it reaches the session.
   */
  hostEnv?: Record<string, string | undefined>;
  now?: Date;
  /** Observability hook for tool decisions (name + decision only). */
  onToolDecision?: (toolName: string, decision: { allow: boolean; reason: string }) => void;
}

/** Names that may appear in the session env. Anything else is a bug (options.test.ts asserts it). */
export const SESSION_ENV_NAMES: readonly string[] = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "ENABLE_CLAUDEAI_MCP_SERVERS",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_MAX_RETRIES",
  "SEATS_AERO_API_KEY",
  "DUFFEL_API_KEY_LIVE",
  "IGNAV_API_KEY",
]);

/** The minimal subprocess environment: explicit names only, never a spread of process.env. */
export function buildSessionEnv(
  input: Pick<BuildAskOptionsInput, "keys" | "sessionDir" | "hostEnv">,
): Record<string, string> {
  const host = input.hostEnv ?? process.env;
  const env: Record<string, string> = {
    PATH: host.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: input.sessionDir,
    TMPDIR: path.join(input.sessionDir, "tmp"),
    CLAUDE_CONFIG_DIR: path.join(input.sessionDir, "config"),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    API_TIMEOUT_MS: "90000",
    CLAUDE_CODE_MAX_RETRIES: "2",
    SEATS_AERO_API_KEY: input.keys.seats_aero,
  };
  if (host.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = host.ANTHROPIC_API_KEY;
  // Non-secret gateway config: a deployment behind an API proxy must reach the same endpoint the
  // key is valid for (a 403 "Request not allowed" otherwise). Only forwarded when https.
  if (host.ANTHROPIC_BASE_URL && /^https:\/\//i.test(host.ANTHROPIC_BASE_URL))
    env.ANTHROPIC_BASE_URL = host.ANTHROPIC_BASE_URL;
  if (input.keys.duffel) env.DUFFEL_API_KEY_LIVE = input.keys.duffel;
  if (input.keys.ignav) env.IGNAV_API_KEY = input.keys.ignav;
  return env;
}

export function buildAskOptions(input: BuildAskOptionsInput): Options {
  const pluginRoot = path.resolve(input.pluginRoot);
  const budget = perRequestBudgetUsd(input.remainingUsd);
  return {
    cwd: pluginRoot,
    plugins: [{ type: "local", path: pluginRoot, skipMcpDiscovery: true }],
    skills: pluginSkillAllowlist(pluginRoot),
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: mcpServersOption(),
    permissionMode: "default",
    // Empty on purpose: a bare name here auto-approves the whole tool BEFORE canUseTool is consulted
    // (SDK warning CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), so Bash / Read / MCP calls all reach the gate.
    // Exception: the SDK auto-approves the Skill tool itself once `skills` is set (sdk.d.ts: "the
    // single place to turn skills on; you do not need to add Skill to allowedTools") — canUseTool
    // is NOT consulted for Skill invocations. Which skills exist is enforced by the `skills`
    // allowlist above plus the physical pruning in build/plugin; gate.ts's Skill branch is
    // defense-in-depth only and must never be relied on to block a skill name.
    allowedTools: [],
    disallowedTools: [...DENIED_TOOLS],
    canUseTool: makeCanUseTool({ pluginRoot, onDecision: input.onToolDecision }),
    maxTurns: MAX_TURNS,
    maxBudgetUsd: budget,
    abortController: input.abortController,
    includePartialMessages: true,
    persistSession: false,
    model: input.model,
    systemPrompt: buildSystemPrompt(input.context, input.now),
    env: buildSessionEnv(input),
  };
}
