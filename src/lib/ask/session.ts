/**
 * runAsk — one ask-lane session = one Claude Agent SDK `query()` = one isolated `claude`
 * subprocess (kickoff §7, ARCHITECTURE.md §3–§3.3).
 *
 * Isolation model (why a user can never see another user's key, files, or history):
 *
 *   process boundary   Every request spawns its own subprocess and `persistSession: false`, so
 *                      no transcript is written and nothing survives the request.
 *   environment        `Options.env` REPLACES the subprocess environment. options.ts builds it
 *                      from an explicit list (PATH, HOME, TMPDIR, ANTHROPIC_API_KEY,
 *                      CLAUDE_CONFIG_DIR, three Claude Code tunables, and the calling user's
 *                      SEATS_AERO_API_KEY / DUFFEL_API_KEY_LIVE / IGNAV_API_KEY). Nothing else
 *                      from the server's process.env is copied, and other users' keys are never
 *                      in process.env to begin with — they live encrypted in SQLite and are
 *                      decrypted only for the session being built (§0.2 #2).
 *   filesystem         HOME, TMPDIR and CLAUDE_CONFIG_DIR point into a per-request mkdtemp dir
 *                      that is rm -rf'd in `finally`; `settingSources: []` and
 *                      CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 keep the host's ~/.claude settings,
 *                      memory and connectors out. `cwd` is the built plugin root.
 *   tools              `canUseTool` (gate.ts) allows only: reading the plugin directory, the
 *                      Skill tool, the four kept remote MCP servers, and `curl https://<allowed
 *                      API> | jq` pipelines where `$SEATS_AERO_API_KEY` may appear only inside a
 *                      -H header. Everything else (Write/Edit/Task/WebFetch/…) is removed via
 *                      `disallowedTools` AND denied by the gate. MCP: `strictMcpConfig: true` +
 *                      `skipMcpDiscovery: true`, so the plugin's .mcp.json is never read.
 *   skills             `skills` is the exact allowlist of directories present in build/plugin
 *                      minus the explicit deny list (pruned.ts). The init message is checked
 *                      (kickoff §9 Phase 4): the travel-hacker plugin must be loaded from the
 *                      expected path, travel-hacker:seats-aero must be present, and no pruned
 *                      skill may appear in `skills` or `slash_commands` — otherwise the session is
 *                      aborted before the first model turn.
 *   money / time       holdAsk denies when today's spend ≥ the $2 cap, otherwise it charges
 *                      `maxBudgetUsd = min($0.50, remaining)` + one request UP FRONT (so parallel
 *                      sessions of one user cannot each be granted the same remaining dollars);
 *                      a 120 s timer aborts the subprocess; the result's `total_cost_usd`
 *                      replaces the held ceiling. A session that ends without a result (timeout,
 *                      abort, stream error) keeps the ceiling charged — the SDK gives no cost
 *                      readout on that path, and it can have spent up to maxBudgetUsd.
 *   events             AskEvent never carries key material, tool inputs, or raw SDK messages —
 *                      text deltas, tool NAMES, the init summary, the cost result, and coded
 *                      errors only. Error messages are scrubbed of every key value.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DbConn } from "@/lib/auth/clock";
import { holdAsk, releaseHold, settleHold } from "./budget";
import { askModelFromEnv, buildAskOptions } from "./options";
import { isPrunedSkill } from "./pruned";
import { PLUGIN_NAME, REQUIRED_SKILL_ID, defaultPluginRoot, pluginRootExists } from "./skills";
import type { AskContext, AskEvent, AskKeys, AskUserRef } from "./types";

export const DEFAULT_ASK_TIMEOUT_MS = 120_000;
export const MAX_PROMPT_CHARS = 4000;

/** What `deps.query` must look like: the SDK's `query`, or a fake in tests. */
export interface AskQueryParams {
  prompt: string;
  options: Options;
}
export type AskQueryStream = AsyncIterable<SDKMessage> & { close?: () => void };
export type AskQueryFn = (params: AskQueryParams) => AskQueryStream;

export interface AskDeps {
  query: AskQueryFn;
  now: () => Date;
  pluginRoot: string;
  model: string;
  timeoutMs: number;
  /** Where PATH / ANTHROPIC_API_KEY come from (default process.env). */
  hostEnv: Record<string, string | undefined>;
  /** Parent of the per-request session dir (default os.tmpdir()). */
  tmpBase: string;
  /** Daily cap override (default env / $2). */
  capUsd?: number;
  /** Where the init summary and errors are logged (never keys). */
  log: (line: string) => void;
  /** Caller-side cancellation (client disconnect): aborts the subprocess when it fires. */
  signal?: AbortSignal;
  /** Observability hook for gate decisions (tool name + allow/deny + short reason; never inputs). */
  onToolDecision?: (toolName: string, decision: { allow: boolean; reason: string }) => void;
}

export interface RunAskParams {
  db: DbConn;
  user: AskUserRef;
  prompt: string;
  context?: AskContext;
  /**
   * THIS user's seats.aero authorization ("Bearer seats:ota:…", src/app/api/ask/route.ts) and optional keys;
   * null/empty seats_aero → `no_key`.
   */
  keys: AskKeys | null;
  deps?: Partial<AskDeps>;
}

export function askTimeoutFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ASK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASK_TIMEOUT_MS;
}

/** Lazy default so importing this module never loads the SDK (tests inject a fake). */
async function sdkQuery(): Promise<AskQueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return (p) => sdk.query({ prompt: p.prompt, options: p.options });
}

/** The bare access token inside a "Bearer seats:ota:…" value, so it is scrubbed on its own too. */
function bareToken(value: string | undefined): string | undefined {
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : undefined;
}

/** Remove every key value from a message (belt and braces — the SDK should never echo env). */
function scrub(message: string, keys: AskKeys | null): string {
  let out = message;
  for (const v of [keys?.seats_aero, bareToken(keys?.seats_aero), keys?.duffel, keys?.ignav]) {
    if (v && v.length >= 4) out = out.split(v).join("[redacted]");
  }
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : "unknown error";
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message));
}

type InitMessage = Extract<SDKMessage, { type: "system"; subtype: "init" }>;

/** Kickoff §9 Phase-4 assertion on the init message. Returns a reason string on failure. */
export function checkInit(init: InitMessage, pluginRoot: string): string | null {
  const wanted = path.resolve(pluginRoot);
  const loaded = (init.plugins ?? []).some(
    (p) => p.name === PLUGIN_NAME && path.resolve(p.path) === wanted,
  );
  if (!loaded) return `plugin ${PLUGIN_NAME} was not loaded from ${wanted}`;
  const skills = init.skills ?? [];
  if (!skills.includes(REQUIRED_SKILL_ID))
    return `required skill ${REQUIRED_SKILL_ID} is not loaded`;
  for (const s of [...skills, ...(init.slash_commands ?? [])]) {
    if (s.startsWith(`${PLUGIN_NAME}:`) && isPrunedSkill(s)) return `pruned skill ${s} is loaded`;
  }
  return null;
}

function makeSessionDir(tmpBase: string): string {
  const dir = fs.mkdtempSync(path.join(tmpBase, "awardgrid-ask-"));
  fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  return dir;
}

export async function* runAsk(params: RunAskParams): AsyncGenerator<AskEvent, void, undefined> {
  const deps: AskDeps = {
    query: params.deps?.query ?? (await sdkQuery()),
    now: params.deps?.now ?? (() => new Date()),
    pluginRoot: path.resolve(params.deps?.pluginRoot ?? defaultPluginRoot()),
    model: params.deps?.model ?? askModelFromEnv(),
    timeoutMs: params.deps?.timeoutMs ?? askTimeoutFromEnv(),
    hostEnv: params.deps?.hostEnv ?? process.env,
    tmpBase: params.deps?.tmpBase ?? os.tmpdir(),
    capUsd: params.deps?.capUsd,
    log: params.deps?.log ?? ((line) => console.info(line)),
    signal: params.deps?.signal,
    onToolDecision: params.deps?.onToolDecision,
  };
  const { db, user, keys } = params;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

  if (prompt.length === 0) {
    yield { type: "error", code: "sdk", message: "Empty question." };
    return;
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    yield {
      type: "error",
      code: "sdk",
      message: `Question is too long (max ${MAX_PROMPT_CHARS} characters).`,
    };
    return;
  }
  if (!keys || !keys.seats_aero) {
    yield {
      type: "error",
      code: "no_key",
      message: "No seats.aero account is connected. Connect seats.aero in Settings.",
    };
    return;
  }
  if (!pluginRootExists(deps.pluginRoot)) {
    yield {
      type: "error",
      code: "plugin_missing",
      message: "The travel-hacker plugin is not built (run `pnpm build:plugin`).",
    };
    return;
  }
  if (!deps.hostEnv.ANTHROPIC_API_KEY) {
    yield {
      type: "error",
      code: "sdk",
      message: "The ask lane is not configured on this server (no ANTHROPIC_API_KEY).",
    };
    return;
  }

  if (deps.signal?.aborted) {
    yield { type: "error", code: "sdk", message: "The session was cancelled." };
    return;
  }
  // Last check before spawning: charges the per-request ceiling + one request atomically.
  const reservation = holdAsk(db, user.id, { now: deps.now, capUsd: deps.capUsd });
  if (!reservation.allowed) {
    yield {
      type: "error",
      code: "budget",
      message: `Daily ask budget ($${reservation.capUsd.toFixed(2)}) is used up for ${reservation.day}; it resets at 00:00 UTC.`,
    };
    return;
  }
  const hold = reservation.hold;
  const sessionDir = makeSessionDir(deps.tmpBase);
  const abortController = new AbortController();
  const onCallerAbort = () => abortController.abort();
  deps.signal?.addEventListener("abort", onCallerAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, deps.timeoutMs);

  const options = buildAskOptions({
    user: { id: user.id },
    keys,
    pluginRoot: deps.pluginRoot,
    sessionDir,
    model: deps.model,
    remainingUsd: hold.budgetUsd, // == maxBudgetUsd: what holdAsk charged up front
    abortController,
    context: params.context ?? {},
    hostEnv: deps.hostEnv,
    now: deps.now(),
    onToolDecision: deps.onToolDecision,
  });

  let stream: AskQueryStream | null = null;
  let resultSeen = false;
  let textStreamed = false;
  let initFailed = false;
  const toolsSeen = new Set<string>();

  try {
    stream = deps.query({ prompt, options });
    for await (const msg of stream) {
      if (msg.type === "system" && msg.subtype === "init") {
        const problem = checkInit(msg, deps.pluginRoot);
        deps.log(
          `ask init user=${user.id} model=${msg.model} claude_code=${msg.claude_code_version} plugins=${JSON.stringify(msg.plugins.map((p) => p.name))} skills=${msg.skills.length} mcp=${JSON.stringify(msg.mcp_servers)}${problem ? ` PROBLEM=${problem}` : ""}`,
        );
        if (problem) {
          initFailed = true;
          yield {
            type: "error",
            code: "plugin_missing",
            message: `Plugin check failed: ${problem}`,
          };
          return; // finally aborts the subprocess and closes the stream
        }
        yield {
          type: "init",
          plugins: msg.plugins.map((p) => ({ name: p.name, path: p.path })),
          skills: [...msg.skills],
          mcp_servers: msg.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
          model: msg.model,
        };
        continue;
      }
      if (msg.type === "stream_event") {
        if (msg.parent_tool_use_id !== null) continue; // subagent / sidechain output is not ours
        const ev = msg.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta" &&
          ev.delta.text.length > 0
        ) {
          textStreamed = true;
          yield { type: "text", delta: ev.delta.text };
        } else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          const id = ev.content_block.id;
          if (!toolsSeen.has(id)) {
            toolsSeen.add(id);
            yield { type: "tool", name: ev.content_block.name };
          }
        }
        continue;
      }
      if (msg.type === "assistant") {
        if (msg.parent_tool_use_id !== null) continue;
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && !toolsSeen.has(block.id)) {
            toolsSeen.add(block.id);
            yield { type: "tool", name: block.name };
          }
        }
        continue;
      }
      if (msg.type === "result") {
        resultSeen = true;
        const cost =
          typeof msg.total_cost_usd === "number" && Number.isFinite(msg.total_cost_usd)
            ? msg.total_cost_usd
            : 0;
        settleHold(db, hold, cost);
        if (msg.subtype === "success" && msg.is_error) {
          // sdk.d.ts: subtype "success" with is_error true = the turn ended on an API error and
          // `result` carries the error text (e.g. "Failed to authenticate. API Error: 403 …").
          const m = scrub(
            typeof msg.result === "string" && msg.result.length > 0 ? msg.result : "API error",
            keys,
          );
          deps.log(`ask api-error user=${user.id}: ${m}`);
          yield { type: "error", code: "sdk", message: `Agent error: ${m}` };
        } else if (
          !textStreamed &&
          msg.subtype === "success" &&
          typeof msg.result === "string" &&
          msg.result.length > 0
        ) {
          yield { type: "text", delta: msg.result };
        }
        yield {
          type: "result",
          cost_usd: cost,
          num_turns: msg.num_turns,
          duration_ms: msg.duration_ms,
          subtype: msg.subtype,
        };
        continue;
      }
      // every other SDKMessage kind (status, hooks, compaction, …) is ignored
    }
    if (!resultSeen && !initFailed) {
      if (timedOut)
        yield {
          type: "error",
          code: "timeout",
          message: `Timed out after ${Math.round(deps.timeoutMs / 1000)} s.`,
        };
      else yield { type: "error", code: "sdk", message: "The session ended without a result." };
    }
  } catch (err) {
    if (resultSeen || initFailed) {
      // An error-subtype result is followed by a throw (ARCHITECTURE §3) — already reported.
    } else if (timedOut) {
      yield {
        type: "error",
        code: "timeout",
        message: `Timed out after ${Math.round(deps.timeoutMs / 1000)} s.`,
      };
    } else if (isAbortError(err) || abortController.signal.aborted) {
      yield { type: "error", code: "sdk", message: "The session was cancelled." };
    } else {
      const m = scrub(errorMessage(err), keys);
      deps.log(`ask error user=${user.id}: ${m}`);
      yield { type: "error", code: "sdk", message: `Agent error: ${m}` };
    }
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onCallerAbort);
    // Never reached the model (init check failed): nothing was spent, undo the hold. Every other
    // no-result exit (timeout, abort, stream error) keeps the ceiling charged — see budget.ts.
    if (initFailed && !resultSeen) releaseHold(db, hold);
    // Consumer stopped early (client disconnect) or we bailed: make sure the subprocess dies.
    if (!resultSeen && !abortController.signal.aborted) abortController.abort();
    try {
      stream?.close?.();
    } catch {
      // already closed
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}
