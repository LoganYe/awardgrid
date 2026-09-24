/**
 * A question's own lines in the page's language (UI/UX v1 T17; U-039, U-050; acceptance A21): its steps, what is under
 * way, how it ended, its failure, its meta line, and the announcements. English is ./labels.ts, unchanged; Chinese says
 * the same under the same rules: Stop stops the next steps and never claims to recall a request; a count not known is
 * never said as zero; nothing promises a check later.
 *
 * What core writes itself (a failure's details, Anthropic's request ID) stays in English, marked, after the sentence.
 */
import type { AskEntry, EntryStep, QuestionFailure, QuestionFailureCode, QuestionUsage, StopMoment } from "@awardgrid/core/ask/conversation";
import {
  ASK_QUESTION_LIMIT_MS,
  ASK_QUOTA_RESERVE,
  MAX_FLIGHTS_PER_QUESTION,
  MAX_MODEL_REQUESTS,
  MAX_PAIRS,
  MAX_SEARCHES_PER_QUESTION,
  MAX_TOOL_CALLS,
  QUESTION_SEATS_CALL_CAP,
  SEARCH_PAGE_CAP,
} from "@awardgrid/core/ask/limits";
import { GET_FLIGHTS, PROPOSE_QUERY_CHANGE, SEARCH_AWARDS, type SearchEcho, type ToolStep } from "@awardgrid/core/ask/tools";
import { SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";
import { copy } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { Cabin } from "@awardgrid/core/query/schema";
import type { Locale } from "../app/locale";
import * as en from "./labels";

export interface EntryLabels {
  stepLabel(step: EntryStep, opts?: { searchIncluded?: boolean }): string;
  endLabel(entry: Pick<AskEntry, "end" | "steps">): string | null;
  entryMetaLine(entry: Pick<AskEntry, "end" | "usage">): string;
  waitingLabel(seconds: number): string;
  toolRunningLabel(name: string, input: unknown): string;
  /** A failure's own sentence, and core's words when they are a translation away (null when the sentence is core's). */
  failure(failure: QuestionFailure): { text: string; detail: string | null };
  requestIdLine(requestId: string): string;
  announcements: { waiting: string; searching: string; answered: string; stopped: string; failed: string };
  pausedStep: string;
  /** T17: a tool call waiting its turn. */
  queuedStep: string;
  followUpNote: string;
  tryAgainHint: string;
}

const EN: EntryLabels = {
  stepLabel: en.stepLabel,
  endLabel: en.endLabel,
  entryMetaLine: en.entryMetaLine,
  waitingLabel: en.waitingLabel,
  toolRunningLabel: en.toolRunningLabel,
  failure: (f) => ({ text: f.message, detail: null }),
  requestIdLine: (id) => `Anthropic request ID: ${id}`,
  announcements: en.ANNOUNCEMENTS,
  pausedStep: en.PAUSED_STEP,
  queuedStep: en.QUEUED_STEP,
  followUpNote: en.FOLLOW_UP_NOTE,
  tryAgainHint: en.TRY_AGAIN_HINT,
};

// ---- Chinese ---------------------------------------------------------------------------------------------------

const thousands = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const calls = (n: number) => (n === 0 ? "没有调用" : `${thousands(n)} 次调用`);
/** The cabin's Chinese name as the rest of the app says it (core cabinName), or the letter as sent when unknown. */
const cabinZh = (letter: string) => (["Y", "W", "J", "F"].includes(letter) ? cabinName(letter as Cabin, "zh") : letter);
const programName = (source: string) => (SOURCE_NAMES as Partial<Record<string, string>>)[source] ?? source;

/** "SEA → NRT、HND，2026-10-01 至 2026-10-30，商务舱", narrowed the same way the English summary is. */
function summaryZh(search: en.SummarySearch | SearchEcho): string {
  const parts = [`${search.origins.join("、")} → ${search.destinations.join("、")}`, `${search.date_from} 至 ${search.date_to}`, search.cabins.map(cabinZh).join("、")];
  if (search.direct_only) parts.push("仅直飞");
  if (search.programs && search.programs.length > 0) parts.push(search.programs.map(programName).join("、"));
  if (typeof search.max_miles === "number") parts.push(`不超过 ${thousands(search.max_miles)} 里程`);
  return parts.filter((p) => p.length > 0).join("，");
}

function searchStepZh(step: ToolStep, searchIncluded: boolean): string {
  const what = step.search === null ? "" : `：${summaryZh(step.search)}`;
  const spent = `${calls(step.calls)}。`;
  switch (step.outcome) {
    case "ok":
      return step.fromCache && step.calls === 0 ? `从本机缓存读取${what}。没有调用。` : `已查询 seats.aero${what}。${spent}`;
    case "too_wide":
      if (step.estimate === null) return `未查询：航线组合超过单次查询上限 ${MAX_PAIRS} 个。没有调用。`;
      if (step.estimate > SEARCH_PAGE_CAP) return `未查询：约需 ${thousands(step.estimate)} 次调用，超过单次查询结果可用的 ${SEARCH_PAGE_CAP} 次。已请 Claude 缩小范围。`;
      return `未查询：约需 ${thousands(step.estimate)} 次调用，超过这个问题剩余的调用。已请 Claude 缩小范围。`;
    case "quota_reserve":
      return `未查询：会用到今天额度最后 ${ASK_QUOTA_RESERVE} 次调用，这些留给你自己的查询。`;
    case "limit_reached":
      if (step.calls > 0) return `查询在 ${thousands(step.calls)} 次调用后停止，已达允许的上限。`;
      if (step.search === null) return `未查询：这个问题已达 ${MAX_SEARCHES_PER_QUESTION} 次查询或 ${MAX_TOOL_CALLS} 次工具调用的上限。没有调用。`;
      return "未查询：没有剩余的 seats.aero 调用可用。没有调用。";
    case "invalid_place":
      return "未查询：Claude 使用了本应用不认识的地点代码。没有调用。";
    case "invalid_input":
      return "未查询：Claude 请求的查询无效。没有调用。";
    case "quota":
      return `查询失败：今天的 seats.aero 额度已用完。${spent}`;
    case "seatsaero_key_rejected":
      return `查询失败：seats.aero 拒绝了你的密钥。${spent}`;
    case "network":
      return `查询失败：发往 seats.aero 的请求失败。${spent}`;
    case "seatsaero_error":
      return `查询失败：seats.aero 未能完成。${spent}`;
    case "tool_failed":
      return `查询在本应用内部失败。${spent}`;
    case "stopped":
      return "未开始查询：你在它开始前按了停止。没有调用。";
    case "needs_confirmation":
      if (!searchIncluded) return "未查询：这个问题没有附带查询，只有你从建议中应用的查询才会运行。没有调用。";
      return step.search === null ? "未查询：超出了你附带的查询。没有调用。" : `未查询：${summaryZh(step.search)} 超出了你附带的查询。没有调用。`;
    default:
      return `查询没有得到结果。${spent}`;
  }
}

function flightsStepZh(step: ToolStep, searchIncluded: boolean): string {
  const spent = `${calls(step.calls)}。`;
  switch (step.outcome) {
    case "ok":
      if (step.fromMemo) return "显示了本次对话中之前查过的航班。没有调用。";
      return step.program === null ? `查询了一个结果的航班。${spent}` : `查询了一个 ${programName(step.program)} 结果的航班。${spent}`;
    case "unknown_id":
      return "未查航班：Claude 指定的结果不是本次对话的查询返回的。没有调用。";
    case "quota_reserve":
      return `未查航班：会用到今天额度最后 ${ASK_QUOTA_RESERVE} 次调用中的一次，这些留给你自己的查询。`;
    case "limit_reached":
      if (step.calls > 0) return `航班查询在 ${thousands(step.calls)} 次调用后停止，已达允许的上限。`;
      return `未查航班：这个问题已达上限（${MAX_FLIGHTS_PER_QUESTION} 次航班查询、${MAX_TOOL_CALLS} 次工具调用、${QUESTION_SEATS_CALL_CAP} 次 seats.aero 调用）。没有调用。`;
    case "invalid_input":
      return "未查航班：无法读取 Claude 的请求。没有调用。";
    case "quota":
      return `航班查询失败：今天的 seats.aero 额度已用完。${spent}`;
    case "seatsaero_key_rejected":
      return `航班查询失败：seats.aero 拒绝了你的密钥。${spent}`;
    case "network":
      return `航班查询失败：发往 seats.aero 的请求失败。${spent}`;
    case "seatsaero_error":
      return `航班查询失败：seats.aero 未能完成。${spent}`;
    case "tool_failed":
      return `航班查询在本应用内部失败。${spent}`;
    case "stopped":
      return "未查航班：你在查询开始前按了停止。没有调用。";
    case "needs_confirmation":
      return searchIncluded ? "未查航班：这个结果超出了你附带的查询。没有调用。" : "未查航班：这个问题没有附带查询。没有调用。";
    default:
      return `航班查询没有得到结果。${spent}`;
  }
}

function proposalStepZh(step: ToolStep): string {
  switch (step.outcome) {
    case "ok":
      return "提出了修改查询的建议，等你确认。没有调用。";
    case "limit_reached":
      return "没有再提出建议：这个问题已提出过一个建议，或已达工具调用上限。没有调用。";
    case "inside_scope":
      return "无需建议：这个查询在你附带的查询范围内。没有调用。";
    case "too_wide":
      return `建议被拒绝：航线组合超过单次查询上限 ${MAX_PAIRS} 个。没有调用。`;
    case "invalid_place":
      return "建议被拒绝：Claude 使用了本应用不认识的地点代码。没有调用。";
    case "stopped":
      return "没有建议：你在它提出前按了停止。没有调用。";
    default:
      return "建议被拒绝：Claude 提出的修改不是有效的查询。没有调用。";
  }
}

const STOPPED_ZH: Record<"request" | "search" | "lookup" | "free" | "between", string> = {
  request: "已停止后续步骤。本问题不会再发送任何内容。已发给 Anthropic 的请求仍会完成，并可能计费。",
  search: "已停止后续步骤。进行中的 seats.aero 查询无法撤回，会完成并计入今天的调用。",
  lookup: "已停止后续步骤。进行中的 seats.aero 航班查询无法撤回，会完成并计入今天的调用。",
  free: "已停止后续步骤。进行中的步骤没有发出 seats.aero 调用，本问题不会再发送任何内容。",
  between: "在下一步开始前已停止。本问题不会再发送任何内容。",
};

function stoppedZh(during: StopMoment, tool: ToolStep | null): string {
  if (during === "request") return STOPPED_ZH.request;
  if (during === "between") return STOPPED_ZH.between;
  if (tool?.outcome === "stopped") return STOPPED_ZH.between;
  if (tool !== null && tool.calls === 0) return STOPPED_ZH.free;
  return tool?.tool === GET_FLIGHTS ? STOPPED_ZH.lookup : STOPPED_ZH.search;
}

/** Each failure said in Chinese by its code; core's own words follow it, marked English. A Record, so a new code must be added here. */
const FAILURES_ZH: Record<QuestionFailureCode, string> = {
  stopped: "已停止。",
  request_limit: "这个请求超过了单次请求的时长上限，没有得到回答。",
  anthropic_key_missing: "没有 Anthropic 密钥。请在设置中添加。",
  anthropic_key_rejected: "Anthropic 拒绝了这个密钥。请在设置中检查。",
  model_unavailable: "这个密钥无法使用 Claude Opus 5。请在设置中检查。",
  anthropic_forbidden: "Anthropic 拒绝了这个请求（没有权限）。",
  spend_limit: "这个 Anthropic 账户已达到支出上限。",
  rate_limited: "Anthropic 暂时限制了请求频率。",
  bad_request: "Anthropic 无法处理这个请求。",
  too_large: "这个对话太大，无法发送。请开始新对话。",
  overloaded: "Anthropic 目前负载过高，没有回答。",
  overloaded_mid_answer: "Anthropic 在回答中途负载过高，回答没有完成。",
  anthropic_error: "Anthropic 返回了错误。",
  unreadable_response: "无法读取 Anthropic 的回应。",
  connection_failed: "与 Anthropic 的连接失败。",
  connection_failed_left_app: "离开应用期间，与 Anthropic 的连接中断。",
  wiring: "此版本无法从本机连接 Anthropic（原生网络不可用）。这是接线问题，不是服务中断。",
  unexpected_stop: "回答以本应用无法处理的方式结束。",
};

function lastToolStep(steps: readonly EntryStep[]): ToolStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.kind === "tool") return step.step;
  }
  return null;
}

function metaZh(usage: QuestionUsage): string {
  return [
    en.MODEL_NAME,
    usage.requests === 0 ? "没有请求" : `${thousands(usage.requests)} 次请求`,
    `${thousands(usage.inputTokens)} 个输入 token（${thousands(usage.cacheReadTokens)} 个来自缓存）`,
    `${thousands(usage.outputTokens)} 个输出 token`,
    `seats.aero 调用：${thousands(usage.seatsCalls)}`,
  ].join(" · ");
}

/** Every count as a lower bound, zeros left out, and what the line cannot vouch for. */
function interruptedZh(usage: QuestionUsage, closing: string): string {
  const parts = [en.MODEL_NAME];
  if (usage.requests > 0) parts.push(`至少 ${thousands(usage.requests)} 次请求`);
  if (usage.inputTokens > 0) parts.push(`至少 ${thousands(usage.inputTokens)} 个输入 token${usage.cacheReadTokens > 0 ? `（至少 ${thousands(usage.cacheReadTokens)} 个来自缓存）` : ""}`);
  if (usage.outputTokens > 0) parts.push(`至少 ${thousands(usage.outputTokens)} 个输出 token`);
  if (usage.seatsCalls > 0) parts.push(`seats.aero 调用：至少 ${thousands(usage.seatsCalls)}`);
  parts.push(closing);
  return parts.join(" · ");
}

/** Claude's raw input read exactly as the English line reads it (checked, trimmed, upper-cased), then said in Chinese. */
function toolInputSummaryZh(input: unknown): string | null {
  const search = en.searchFromInput(input);
  return search === null ? null : summaryZh(search);
}

const ZH: EntryLabels = {
  stepLabel(entryStep, opts = {}) {
    if (entryStep.kind === "paused") return ZH.pausedStep;
    const { step } = entryStep;
    if (step.tool === SEARCH_AWARDS) return searchStepZh(step, opts.searchIncluded ?? true);
    if (step.tool === GET_FLIGHTS) return flightsStepZh(step, opts.searchIncluded ?? true);
    if (step.tool === PROPOSE_QUERY_CHANGE) return proposalStepZh(step);
    return `Claude 请求了一个本应用没有的工具。${calls(step.calls)}。`;
  },
  endLabel(entry) {
    const end = entry.end;
    if (end === null) return null;
    switch (end.status) {
      case "answered":
        return null;
      case "empty":
        return "Claude 没有返回文字。请重新提问。";
      case "truncated":
        return "回答达到长度上限，被截断。";
      case "refused":
        return "Claude 拒绝回答这个问题。";
      case "too_long":
        return "Claude 在完成回答前用完了上下文空间。请开始新对话。";
      case "deadline":
        return `一个问题最长 ${ASK_QUESTION_LIMIT_MS / 60_000} 分钟，之后不再开始新步骤，所以这个问题没有得到回答。`;
      case "request_limit":
        return `这个问题已用完 ${MAX_MODEL_REQUESTS} 次请求。`;
      case "stopped":
        return stoppedZh(end.stoppedDuring ?? "between", lastToolStep(entry.steps));
      case "failed":
        return end.failure ? ZH.failure(end.failure).text : ZH.announcements.failed;
      case "unfinished":
        // The approved "The previous task did not finish.", then why and what it may have cost.
        return `${copy("ai.unfinished", "zh")}应用在问题进行时被关闭，已发出的请求可能已计费。本应用不会自动重新发送。`;
    }
  },
  entryMetaLine(entry) {
    if (entry.end?.status === "unfinished") return interruptedZh(entry.usage, "应用关闭前保存的计数可能少于实际用量");
    if (entry.usage.requests > 0 && entry.usage.lastRequestInputTokens === null) return interruptedZh(entry.usage, "Anthropic 没有报告最后一个请求的用量");
    return metaZh(entry.usage);
  },
  waitingLabel: (seconds) => `正在等待 Claude（${Math.max(0, Math.floor(seconds))} 秒）`,
  toolRunningLabel(name, input) {
    if (name === SEARCH_AWARDS) {
      const summary = toolInputSummaryZh(input);
      return summary === null ? "正在查询 seats.aero" : `正在查询 seats.aero：${summary}`;
    }
    if (name === GET_FLIGHTS) return "正在 seats.aero 查询航班";
    if (name === PROPOSE_QUERY_CHANGE) return "正在准备修改查询的建议";
    return "正在检查 Claude 的工具请求";
  },
  failure: (f) => {
    const text = (FAILURES_ZH as Partial<Record<string, string>>)[f.code];
    return text ? { text, detail: f.message } : { text: "提问失败。", detail: f.message };
  },
  requestIdLine: (id) => `Anthropic 请求 ID：${id}`,
  announcements: { waiting: "正在等待 Claude", searching: "正在查询 seats.aero", answered: "回答已就绪", stopped: "已停止", failed: "提问失败" },
  pausedStep: "你离开本应用期间已暂停。",
  queuedStep: "正在等待另一个 seats.aero 请求完成。这一步还没有发送任何内容。",
  followUpNote: "本应用之后不会再查询，也不会给你发送任何内容。要关注某条航线，请在查票页使用“关注此查询”；打开应用时会检查。",
  tryAgainHint: "会再次发送同一个请求。如果第一次已送达 Anthropic，两次都可能计费。",
};

export const ENTRY_LABELS: Record<Locale, EntryLabels> = { en: EN, zh: ZH };
