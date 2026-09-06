/**
 * ask-smoke — the Phase-4 self-acceptance run (kickoff §9 Phase 4): one REAL Claude Agent SDK
 * session through `runAsk` against the built travel-hacker plugin, answering
 *
 *   "which program should I book the cheapest SEA→NRT F cell with, and what transfers into it?"
 *
 * with the canonical QueryObject and a synthetic selected cell as context. The seats.aero key
 * handed to the session is a FAKE ("fake-smoke-key-not-real"): the point is the SDK / plugin /
 * gate / env wiring, not seats.aero data — the model may report that the seats.aero call failed.
 *
 * Gated: exits 2 (with a note) unless ANTHROPIC_API_KEY is set AND AWARDGRID_LIVE_SMOKE=1, so
 * CI (which has neither) never spawns the SDK. Budget: maxBudgetUsd 0.50 (runAsk's per-request
 * cap), 120 s timeout.
 *
 * Writes (no keys, no user data; absolute paths scrubbed to <plugin-root>):
 *   test/fixtures/ask/init-message.json   the init event (plugins, skills, mcp_servers, model,
 *                                         claude_code_version) — asserted by
 *                                         test/ask/init-assertions.test.ts
 *   test/fixtures/ask/smoke-result.json   cost_usd, num_turns, duration_ms, subtype, tools used,
 *                                         gate decisions, a scrubbed answer excerpt
 *
 * Usage: export PATH="$HOME/.local/node-arm64/bin:$PATH"; AWARDGRID_LIVE_SMOKE=1 pnpm exec tsx scripts/ask-smoke.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTestDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { runAsk } from "@/lib/ask/session";
import { askModelFromEnv } from "@/lib/ask/options";
import { pluginRootExists } from "@/lib/ask/skills";
import type { AskContext, AskEvent } from "@/lib/ask/types";
import type { QueryObject } from "@/lib/query/schema";
import { DEFAULT_OUT, buildPlugin } from "./build-plugin";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
export const FIXTURE_DIR = path.join(REPO_ROOT, "test", "fixtures", "ask");
export const INIT_FIXTURE = path.join(FIXTURE_DIR, "init-message.json");
export const RESULT_FIXTURE = path.join(FIXTURE_DIR, "smoke-result.json");

export const SMOKE_PROMPT =
  "which program should I book the cheapest SEA→NRT F cell with, and what transfers into it?";
/** Obviously fake; never a real credential. The session env is the only place it goes. */
export const FAKE_SEATS_KEY = "fake-smoke-key-not-real";
export const SMOKE_USER_ID = "smoke-user";

/** The canonical QueryObject shape (kickoff §2 example), pointed at the SEA→NRT cell under test. */
export const SMOKE_QUERY: QueryObject = {
  origins: ["SEA"],
  destinations: ["NRT", "HND"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["F"],
  direct_only: false,
  include_filtered: false,
  sort_by: "miles_asc",
  raw_text: "西雅图到东京 十月 最便宜的头等舱",
  language: "zh",
};

/** Synthetic selected cell — the AskCellContext projection the drawer sends (no URLs, no timestamps). */
export const SMOKE_CELL = {
  origin: "SEA",
  dest: "NRT",
  date: "2026-10-15",
  cabin: "F",
  program: "alaska",
  miles: 70000,
  fees_cents: 1250,
  seats_left: 2,
  source_id: "smoke-fixture-cell",
} as const;

export interface InitFixture {
  recorded_at: string;
  plugins: { name: string; path: string }[];
  skills: string[];
  mcp_servers: { name: string; status: string }[];
  model: string;
  configured_model: string;
  claude_code_version: string | null;
}

export interface SmokeResultFixture {
  recorded_at: string;
  prompt: string;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  subtype: string;
  tools_used: string[];
  gate_decisions: { tool: string; allow: boolean; reason: string }[];
  events: Record<string, number>;
  answer_chars: number;
  answer_excerpt: string;
  mentions_program: boolean;
  mentions_transfer_partner: boolean;
  error: { code: string; message: string } | null;
}

const PROGRAM_WORDS =
  /\b(alaska|american|aadvantage|united|mileageplus|ana|jal|cathay|asia miles|aeroplan|avios|british airways|flying blue|virgin|delta|skymiles|singapore|krisflyer|qantas|lifemiles|avianca|turkish|etihad|emirates|mileage plan|hawaiian)\b/i;
const TRANSFER_WORDS =
  /\b(transfer|chase|ultimate rewards|amex|membership rewards|capital one|citi|thankyou|bilt|marriott|bonvoy|wells fargo|rove)\b/i;

export function scrubPath(s: string, pluginRoot: string): string {
  return s.split(pluginRoot).join("<plugin-root>");
}

export function scrubSecrets(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const k of secrets) if (k && k.length >= 4) out = out.split(k).join("[redacted]");
  return out;
}

function ensurePlugin(): string {
  if (!pluginRootExists(DEFAULT_OUT)) {
    console.info("ask-smoke: build/plugin missing — running buildPlugin()");
    const r = buildPlugin();
    console.info(`ask-smoke: built ${r.written.length} files, kept ${r.keptSkills.length} skills`);
  }
  return DEFAULT_OUT;
}

export async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || process.env.AWARDGRID_LIVE_SMOKE !== "1") {
    console.info(
      "ask-smoke: skipped — needs ANTHROPIC_API_KEY and AWARDGRID_LIVE_SMOKE=1 (no key is printed or stored).",
    );
    return 2;
  }
  const pluginRoot = ensurePlugin();
  const model = askModelFromEnv();
  const db = openTestDb();
  db.insert(users)
    .values({
      id: SMOKE_USER_ID,
      username: SMOKE_USER_ID,
      passwordHash: "x",
      createdAt: new Date().toISOString(),
    })
    .run();

  const secrets = [FAKE_SEATS_KEY, apiKey];
  const context: AskContext = { query: SMOKE_QUERY, cell: SMOKE_CELL, lang: "en" };
  const gate: SmokeResultFixture["gate_decisions"] = [];
  let claudeCodeVersion: string | null = null;
  const counts: Record<string, number> = {};
  const tools: string[] = [];
  let text = "";
  let initEv: Extract<AskEvent, { type: "init" }> | null = null;
  let resultEv: Extract<AskEvent, { type: "result" }> | null = null;
  let errorEv: Extract<AskEvent, { type: "error" }> | null = null;

  const startedAt = new Date();
  console.info(
    `ask-smoke: model=${model} plugin=${scrubPath(pluginRoot, pluginRoot)} prompt="${SMOKE_PROMPT}"`,
  );

  for await (const ev of runAsk({
    db,
    user: { id: SMOKE_USER_ID },
    prompt: SMOKE_PROMPT,
    context,
    keys: { seats_aero: FAKE_SEATS_KEY },
    deps: {
      pluginRoot,
      model,
      log: (line) => {
        const m = /claude_code=(\S+)/.exec(line);
        if (m) claudeCodeVersion = m[1] ?? null;
        console.info(scrubSecrets(scrubPath(line, pluginRoot), secrets));
      },
      onToolDecision: (tool, d) => {
        gate.push({ tool, allow: d.allow, reason: scrubSecrets(d.reason, secrets) });
        console.info(
          `  gate ${d.allow ? "ALLOW" : "DENY "} ${tool}: ${scrubSecrets(d.reason, secrets)}`,
        );
      },
    },
  })) {
    counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    switch (ev.type) {
      case "init":
        initEv = ev;
        console.info(
          `  init model=${ev.model} plugins=${ev.plugins.map((p) => p.name).join(",")} skills=${ev.skills.length} mcp=${ev.mcp_servers.map((s) => `${s.name}:${s.status}`).join(",")}`,
        );
        break;
      case "text":
        text += ev.delta;
        process.stdout.write(scrubSecrets(ev.delta, secrets));
        break;
      case "tool":
        if (!tools.includes(ev.name)) tools.push(ev.name);
        console.info(`\n  tool ${ev.name}`);
        break;
      case "result":
        resultEv = ev;
        console.info(
          `\n  result subtype=${ev.subtype} cost_usd=${ev.cost_usd.toFixed(4)} turns=${ev.num_turns} duration_ms=${ev.duration_ms}`,
        );
        break;
      case "error":
        errorEv = ev;
        console.info(`\n  error ${ev.code}: ${scrubSecrets(ev.message, secrets)}`);
        break;
    }
  }

  const recordedAt = startedAt.toISOString();
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  if (initEv) {
    const init = initEv as Extract<AskEvent, { type: "init" }>;
    const fixture: InitFixture = {
      recorded_at: recordedAt,
      plugins: init.plugins.map((p) => ({ name: p.name, path: scrubPath(p.path, pluginRoot) })),
      skills: [...init.skills],
      mcp_servers: init.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
      model: init.model,
      configured_model: model,
      claude_code_version: claudeCodeVersion,
    };
    fs.writeFileSync(INIT_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
    console.info(`ask-smoke: wrote ${path.relative(REPO_ROOT, INIT_FIXTURE)}`);
  } else {
    console.info("ask-smoke: no init event — init fixture NOT written");
  }

  const cleanText = scrubSecrets(text, secrets);
  const result: SmokeResultFixture = {
    recorded_at: recordedAt,
    prompt: SMOKE_PROMPT,
    cost_usd: resultEv?.cost_usd ?? 0,
    num_turns: resultEv?.num_turns ?? 0,
    duration_ms: resultEv?.duration_ms ?? 0,
    subtype: resultEv?.subtype ?? (errorEv ? `error:${errorEv.code}` : "none"),
    tools_used: tools,
    gate_decisions: gate,
    events: counts,
    answer_chars: cleanText.length,
    answer_excerpt: scrubPath(cleanText.slice(0, 1500), pluginRoot),
    mentions_program: PROGRAM_WORDS.test(cleanText),
    mentions_transfer_partner: TRANSFER_WORDS.test(cleanText),
    error: errorEv
      ? {
          code: errorEv.code,
          message: scrubSecrets(scrubPath(errorEv.message, pluginRoot), secrets),
        }
      : null,
  };
  fs.writeFileSync(RESULT_FIXTURE, `${JSON.stringify(result, null, 2)}\n`);
  console.info(`ask-smoke: wrote ${path.relative(REPO_ROOT, RESULT_FIXTURE)}`);
  console.info(
    `ask-smoke: cost_usd=${result.cost_usd} num_turns=${result.num_turns} subtype=${result.subtype} tools=[${tools.join(",")}] program=${result.mentions_program} transfer=${result.mentions_transfer_partner}`,
  );
  return resultEv && resultEv.subtype === "success" && !errorEv ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`ask-smoke: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
