/**
 * A question's own lines in Chinese (UI/UX v1 T17; U-039; acceptance A21): every step outcome, ending, Stop moment,
 * failure code and meta line is said in Chinese, and English is exactly ./labels.ts. Chinese keeps the rules English
 * keeps: Stop stops the next steps and recalls nothing; an unfinished question is never resent on its own.
 */
import { describe, expect, it } from "vitest";
import type { AskEntry, EntryStep, QuestionFailureCode, QuestionUsage } from "@awardgrid/core/ask/conversation";
import type { ToolStep } from "@awardgrid/core/ask/tools";
import { ENTRY_LABELS } from "./entry-labels";
import * as en from "./labels";

const HAN = /\p{Script=Han}/u;
const CJK = /[\p{Script=Han}　-〿＀-￯]/u;
const zh = ENTRY_LABELS.zh;

const OUTCOMES: ToolStep["outcome"][] = [
  "ok", "limit_reached", "invalid_input", "invalid_place", "too_wide", "quota_reserve", "quota", "seatsaero_key_rejected", "network",
  "seatsaero_error", "unknown_id", "unknown_tool", "tool_failed", "needs_confirmation", "inside_scope", "stopped",
];
const search = { origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-10-31", cabins: ["J" as const], programs: ["aeroplan"], direct_only: true, max_miles: 80000 };
const step = (tool: string, outcome: ToolStep["outcome"], over: Partial<ToolStep> = {}): EntryStep => ({
  kind: "tool",
  step: { tool, outcome, calls: 1, fromCache: false, fromMemo: false, search, program: "aeroplan", estimate: 6, ...over },
});
const usage: QuestionUsage = { requests: 2, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, lastRequestInputTokens: 4000, toolCalls: 1, seatsCalls: 2 };
const end = (status: NonNullable<AskEntry["end"]>["status"], over: Partial<NonNullable<AskEntry["end"]>> = {}) => ({ status, committed: false, failure: null, stoppedDuring: null, at: "2026-10-18T12:00:00Z", ...over });

describe("Chinese entry lines", () => {
  it("every step outcome, for each tool, with and without an included search", () => {
    for (const tool of ["search_awards", "get_flights", "propose_query_change", "not_a_tool"]) {
      for (const outcome of OUTCOMES) {
        for (const searchIncluded of [true, false]) {
          const line = zh.stepLabel(step(tool, outcome), { searchIncluded });
          expect(HAN.test(line), `${tool}/${outcome}: ${line}`).toBe(true);
        }
      }
    }
    expect(zh.stepLabel({ kind: "paused" })).toBe(zh.pausedStep);
    expect(zh.stepLabel(step("search_awards", "ok", { fromCache: true, calls: 0 }))).toContain("从本机缓存读取");
  });

  it("every ending, every Stop moment, and an unfinished question that is not resent", () => {
    for (const status of ["answered", "empty", "truncated", "refused", "too_long", "deadline", "request_limit", "failed", "unfinished"] as const) {
      const line = zh.endLabel({ end: end(status), steps: [] });
      if (status === "answered") expect(line).toBeNull();
      else expect(HAN.test(line ?? ""), `${status}: ${line}`).toBe(true);
    }
    for (const during of ["request", "tool", "between"] as const) {
      for (const steps of [[], [step("search_awards", "ok")], [step("get_flights", "ok")], [step("search_awards", "ok", { calls: 0 })]]) {
        const line = zh.endLabel({ end: end("stopped", { stoppedDuring: during }), steps })!;
        expect(line).toMatch(/停止/);
        expect(line).not.toMatch(/已撤回|已取消请求/);
      }
    }
    expect(zh.endLabel({ end: end("unfinished"), steps: [] })).toContain("上次任务未完成。");
    expect(zh.endLabel({ end: end("unfinished"), steps: [] })).toContain("不会自动重新发送");
  });

  it("every failure code has its own Chinese sentence, with core's words kept as the detail", () => {
    const codes: QuestionFailureCode[] = [
      "stopped", "request_limit", "anthropic_key_missing", "anthropic_key_rejected", "model_unavailable", "anthropic_forbidden", "spend_limit", "rate_limited",
      "bad_request", "too_large", "overloaded", "overloaded_mid_answer", "anthropic_error", "unreadable_response", "connection_failed", "connection_failed_left_app",
      "wiring", "unexpected_stop",
    ];
    const seen = new Set<string>();
    for (const code of codes) {
      const f = zh.failure({ code, retryable: false, message: "Core's own words.", requestId: null });
      expect(HAN.test(f.text), code).toBe(true);
      expect(f.detail).toBe("Core's own words.");
      seen.add(f.text);
    }
    expect(seen.size).toBe(codes.length);
  });

  it("meta lines: exact, and lower bounds when a count is not known, never zero", () => {
    expect(zh.entryMetaLine({ end: end("answered"), usage })).toBe("Claude Opus 5 · 2 次请求 · 9,000 个输入 token（3,956 个来自缓存） · 400 个输出 token · seats.aero 调用：2");
    const interrupted = zh.entryMetaLine({ end: end("stopped"), usage: { ...usage, lastRequestInputTokens: null } });
    expect(interrupted).toContain("至少 2 次请求");
    expect(interrupted).toContain("Anthropic 没有报告最后一个请求的用量");
    const unfinished = zh.entryMetaLine({ end: end("unfinished"), usage: { ...usage, requests: 0, seatsCalls: 0 } });
    expect(unfinished).not.toMatch(/没有请求|调用：0/);
  });

  it("Claude's raw input is read as English reads it, and cabins keep the app's own Chinese names (review L10N-5, L10N-6)", () => {
    expect(zh.toolRunningLabel("search_awards", { ...search, origins: [" sea "], destinations: ["nrt"], cabins: ["W"], programs: null, direct_only: false, max_miles: null })).toBe(
      "正在查询 seats.aero：SEA → NRT，2026-10-18 至 2026-10-31，超经舱",
    );
    expect(zh.toolRunningLabel("search_awards", { ...search, origins: [] })).toBe("正在查询 seats.aero");
    expect(zh.toolRunningLabel("search_awards", null)).toBe("正在查询 seats.aero");
    expect(zh.stepLabel(step("search_awards", "ok", { search: { ...search, cabins: ["W"] } }))).toContain("超经舱");
  });

  it("a step still waiting its turn is said as waiting; a Stop there ends before the step began (review COORD-2)", () => {
    expect(zh.queuedStep).toContain("正在等待另一个 seats.aero 请求完成");
    const stoppedQueued = { end: end("stopped", { stoppedDuring: "tool" as const }), steps: [step("search_awards", "stopped", { calls: 0 })] };
    expect(zh.endLabel(stoppedQueued)).toBe("在下一步开始前已停止。本问题不会再发送任何内容。");
    expect(ENTRY_LABELS.en.endLabel(stoppedQueued)).toBe("Stopped before the next step began. Nothing more will be sent for this question.");
  });

  it("what runs now, and the announcements", () => {
    expect(zh.waitingLabel(12.4)).toBe("正在等待 Claude（12 秒）");
    expect(zh.toolRunningLabel("search_awards", search)).toBe("正在查询 seats.aero：HKG → SEA，2026-10-18 至 2026-10-31，商务舱，仅直飞，Air Canada Aeroplan，不超过 80,000 里程");
    for (const text of Object.values(zh.announcements)) expect(HAN.test(text)).toBe(true);
    for (const text of [zh.pausedStep, zh.followUpNote, zh.tryAgainHint, zh.requestIdLine("req_1")]) expect(HAN.test(text)).toBe(true);
  });

  it("English is labels.ts itself, and has no Chinese", () => {
    expect(ENTRY_LABELS.en.stepLabel).toBe(en.stepLabel);
    expect(ENTRY_LABELS.en.endLabel).toBe(en.endLabel);
    expect(ENTRY_LABELS.en.entryMetaLine).toBe(en.entryMetaLine);
    for (const outcome of OUTCOMES) expect(CJK.test(ENTRY_LABELS.en.stepLabel(step("search_awards", outcome)))).toBe(false);
  });
});
