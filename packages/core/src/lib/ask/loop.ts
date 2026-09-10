/**
 * One question, from the person's words to an answer or an honest end: the manual Messages API tool loop
 * (design §3.10).
 *
 * The loop owns four promises the rest of Ask relies on:
 *
 *   1. EVERY REQUEST HAS THE SAME PREFIX. model, effort, system and tools never change, and the messages are the
 *      history captured when the question started plus this question's turns, only ever appended to. Assistant
 *      content goes back exactly as it came, thinking blocks and their signatures included (ThinkingBlockParam,
 *      SDK resources/messages/messages.d.ts:2408-2422). So request n's messages are a prefix of request n+1's, and
 *      the prompt cache can read them (claude-api shared/prompt-caching.md).
 *   2. NOTHING IS SENT AFTER STOP. Stop aborts the request under way, which ends the wait but cannot recall the
 *      request (docs/PHASE0.md §3); a tool call under way finishes, because the seats.aero call inside it cannot be
 *      recalled either, and no step starts after it.
 *   3. NO BOUND FIRES THAT THE COPY DOES NOT NAME. A request is waited on for at most ASK_REQUEST_LIMIT_MS, by this
 *      loop's own AbortController, which records why it aborted, so describeAskError never has to guess. The
 *      question bound, ASK_QUESTION_LIMIT_MS, only stops a new step from starting: a request already sent may be
 *      billed, and is never abandoned for it.
 *   4. NOTHING IS RETRIED UNASKED. A retryable failure offers retryLastRequest, which resends the identical
 *      parameters when the person asks, and counts toward MAX_MODEL_REQUESTS like any request.
 *
 * Everything the loop needs from the app arrives in `deps`: the clock, timers, whether the app is hidden, and the
 * watch runner's idle signal. Nothing here reads a global, so loop.test.ts drives it with fake timers.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AskModel } from "./client";
import {
  canAsk,
  commitQuestion,
  type Conversation,
  type QuestionFailure,
  type QuestionUsage,
  type StopMoment,
} from "./conversation";
import { describeAskError } from "./errors";
import { ASK_EFFORT, ASK_MAX_TOKENS, ASK_MODEL, ASK_QUESTION_LIMIT_MS, ASK_REQUEST_LIMIT_MS, MAX_MODEL_REQUESTS } from "./limits";
import { ASK_SYSTEM_PROMPT, buildUserTurn, checkQuestion, closingBlock, type LastSearch } from "./prompt";
import { ASK_TOOLS, type ToolRunner, type ToolStep } from "./tools";

export interface LoopDeps {
  /** The injected clock: the question's start, each request's elapsed time, the question bound. */
  now(): Date;
  /** Start a one-shot timer; the handle is passed back to clearTimer. The shell passes setTimeout. */
  setTimer(ms: number, fire: () => void): unknown;
  clearTimer(handle: unknown): void;
  /** Whether awardgrid is hidden right now (the shell reads document.visibilityState). */
  isHidden(): boolean;
  /** Call `listener` each time awardgrid becomes hidden; returns an unsubscribe. */
  onHidden(listener: () => void): () => void;
  /** Resolves once awardgrid is visible; at once when it already is. */
  waitUntilVisible(): Promise<void>;
  /** Resolves once no watch run is under way, so a tool never races a watch for the quota reserve (design §4.3). */
  whenWatchesIdle(): Promise<void>;
  /** Both keys, masked from every failure message. */
  secrets: ReadonlyArray<string | null | undefined>;
}

export interface RunQuestionOptions {
  model: Pick<AskModel, "send">;
  /** This question's runner, over the conversation's own state (createToolRunner(port, conversation)). */
  tools: ToolRunner;
  conversation: Conversation;
  question: string;
  /** The search the person chose to include, or null. */
  lastSearch: LastSearch | null;
  deps: LoopDeps;
  /** Events for the screen, in order. A listener that throws is logged and ignored. */
  onEvent?: (event: AskEvent) => void;
  /** Stop. Aborting it sends nothing more for this question, a resend included. */
  signal?: AbortSignal;
}

/** One request's usage. `inputTokens` counts every input token sent: input, cache writes and cache reads. */
export interface RequestUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export type AskEvent =
  | { type: "question_started"; question: string; at: string }
  /** awardgrid was hidden before a step, which waits for it to be visible again. */
  | { type: "paused"; before: "request" | "tool" }
  | { type: "request_started"; request: number; toolChoice: "auto" | "none"; resend: boolean }
  | {
      type: "request_finished";
      request: number;
      stopReason: Anthropic.StopReason | null;
      usage: RequestUsage;
      /** A streamed final message carries no request-id today (SDK lib/MessageStream.js keeps it on the stream), so this is usually null. */
      requestId: string | null;
      /** The response's text blocks, in order; none for a refusal, whose partial output is discarded. */
      texts: string[];
      elapsedMs: number;
    }
  | { type: "tool_started"; request: number; toolUseId: string; name: string; input: unknown }
  | { type: "tool_finished"; request: number; toolUseId: string; step: ToolStep }
  | { type: "ended"; outcome: AskOutcome };

interface Ended {
  usage: QuestionUsage;
  /** Whether the question joined the conversation's history. */
  committed: boolean;
  /** Every text shown for this question, in order. */
  texts: string[];
}

export type AskOutcome =
  | (Ended & { status: "answered" | "empty" | "truncated" | "refused" | "too_long" | "deadline" | "request_limit" })
  | (Ended & { status: "stopped"; during: StopMoment })
  | (Ended & {
      status: "failed";
      failure: QuestionFailure;
      /** failure.retryable, and a request is left in this question's MAX_MODEL_REQUESTS. */
      canRetry: boolean;
      /**
       * Resend the identical last request and carry on from it. Sends nothing when the failure is not retryable
       * (resolves with this same outcome) or when every request is used (resolves "request_limit"). One call per
       * failure; the outcome it resolves with offers its own.
       */
      retryLastRequest(): Promise<AskOutcome>;
    })
  /** Refused before anything was sent: the question's length, or the conversation's limits (canAsk). */
  | { status: "not_started"; reason: "empty" | "too_long" | "question_limit" | "input_limit" | "file_limit"; message: string };

export async function runQuestion(opts: RunQuestionOptions): Promise<AskOutcome> {
  const checked = checkQuestion(opts.question);
  if (!checked.ok) return { status: "not_started", reason: checked.reason, message: checked.message };
  const allowed = canAsk(opts.conversation);
  if (!allowed.ok) return { status: "not_started", reason: allowed.reason, message: allowed.message };

  const { model, tools, conversation, deps, signal } = opts;
  const startedAt = deps.now();
  // Captured once: every request of this question resends exactly this history, whatever happens elsewhere.
  const history = [...conversation.committed];
  // The closing text goes with a question's last request; only a limit of one request would make that the first.
  const firstIsLast = (MAX_MODEL_REQUESTS as number) <= 1;
  const turns: Anthropic.MessageParam[] = [
    buildUserTurn({ question: checked.question, today: startedAt, lastSearch: opts.lastSearch, closing: firstIsLast }),
  ];
  const texts: string[] = [];
  const usage: QuestionUsage = { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, lastRequestInputTokens: null, toolCalls: 0, seatsCalls: 0 };
  let questionStartMs = startedAt.getTime();
  let lastParams: Anthropic.MessageStreamParams | null = null;
  let activity: "request" | "tool" | null = null;
  let stoppedDuring: StopMoment | null = null;
  let inFlight: AbortController | null = null;

  const emit = (event: AskEvent) => {
    try {
      opts.onEvent?.(event);
    } catch (err) {
      // The screen's listener is not the loop: a bug there must not leave a paid request unaccounted for.
      console.error("ask onEvent listener failed", err instanceof Error ? err.name : typeof err);
    }
  };
  const stopRequested = () => signal?.aborted === true;
  const onStop = () => {
    stoppedDuring ??= activity ?? "between";
    inFlight?.abort("stop");
  };

  /** Wait for `wait`, or stop waiting at Stop. A rejection counts as done: the loop then re-checks what it waited for. */
  const untilOrStopped = (wait: Promise<void>): Promise<void> =>
    new Promise<void>((resolve) => {
      if (stopRequested()) return resolve();
      const done = () => {
        signal?.removeEventListener("abort", done);
        resolve();
      };
      signal?.addEventListener("abort", done);
      wait.then(done, done);
    });

  /** The checks before any step: Stop, a pause while hidden, the watch runner for a tool, then the question bound. */
  const gate = async (before: "request" | "tool"): Promise<"go" | "stopped" | "deadline"> => {
    if (stopRequested()) return "stopped";
    if (deps.isHidden()) emit({ type: "paused", before });
    await untilOrStopped(deps.waitUntilVisible());
    if (before === "tool" && !stopRequested()) await untilOrStopped(deps.whenWatchesIdle());
    if (stopRequested()) return "stopped";
    if (deps.now().getTime() - questionStartMs >= ASK_QUESTION_LIMIT_MS) return "deadline";
    return "go";
  };

  const snapshot = (): Ended => {
    const spent = tools.usage();
    return { usage: { ...usage, toolCalls: spent.toolCalls, seatsCalls: spent.seatsCalls }, committed: false, texts: [...texts] };
  };
  const finish = (outcome: AskOutcome): AskOutcome => {
    emit({ type: "ended", outcome });
    return outcome;
  };
  const params = (last: boolean): Anthropic.MessageStreamParams => ({
    model: ASK_MODEL,
    max_tokens: ASK_MAX_TOKENS,
    output_config: { effort: ASK_EFFORT },
    cache_control: { type: "ephemeral" },
    system: ASK_SYSTEM_PROMPT,
    tools: ASK_TOOLS,
    tool_choice: last ? { type: "none" } : { type: "auto" },
    messages: [...history, ...turns],
  });

  const failed = (failure: QuestionFailure): AskOutcome => {
    const canRetry = failure.retryable && usage.requests < MAX_MODEL_REQUESTS;
    const failedAtMs = deps.now().getTime();
    const resend = lastParams;
    let used = false;
    const outcome: AskOutcome = {
      status: "failed",
      failure,
      canRetry,
      ...snapshot(),
      retryLastRequest: async () => {
        if (used) throw new Error("retryLastRequest was already used for this failure.");
        used = true;
        if (!failure.retryable || resend === null) return outcome;
        if (usage.requests >= MAX_MODEL_REQUESTS) return finish({ status: "request_limit", ...snapshot() });
        if (conversation.committed.length !== history.length) {
          throw new Error("The conversation has moved on since this question failed, so its last request cannot be resent.");
        }
        // The question bound measures the loop's own running time, not the time the person took to decide.
        questionStartMs += deps.now().getTime() - failedAtMs;
        return drive(resend);
      },
    };
    return outcome;
  };

  type Sent = { ok: true; message: Anthropic.Message; request: number } | { ok: false; failure: QuestionFailure };

  const send = async (request: Anthropic.MessageStreamParams, resend: boolean): Promise<Sent> => {
    usage.requests += 1;
    lastParams = request;
    const n = usage.requests;
    emit({ type: "request_started", request: n, toolChoice: request.tool_choice?.type === "none" ? "none" : "auto", resend });
    const controller = new AbortController();
    inFlight = controller;
    activity = "request";
    const sentAtMs = deps.now().getTime();
    let hidden = deps.isHidden();
    const unsubscribe = deps.onHidden(() => {
      hidden = true;
    });
    const timer = deps.setTimer(ASK_REQUEST_LIMIT_MS, () => controller.abort("request_limit"));
    try {
      const message = await model.send(request, { signal: controller.signal });
      const u = message.usage;
      const cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = u.cache_read_input_tokens ?? 0;
      const requestUsage: RequestUsage = { inputTokens: u.input_tokens + cacheCreationTokens + cacheReadTokens, cacheCreationTokens, cacheReadTokens, outputTokens: u.output_tokens };
      usage.inputTokens += requestUsage.inputTokens;
      usage.cacheReadTokens += cacheReadTokens;
      usage.outputTokens += requestUsage.outputTokens;
      usage.lastRequestInputTokens = requestUsage.inputTokens;
      const shown = message.stop_reason === "refusal" ? [] : textsOf(message.content);
      texts.push(...shown);
      emit({
        type: "request_finished",
        request: n,
        stopReason: message.stop_reason,
        usage: requestUsage,
        requestId: requestIdOf(message),
        texts: shown,
        elapsedMs: deps.now().getTime() - sentAtMs,
      });
      return { ok: true, message, request: n };
    } catch (err) {
      hidden ||= deps.isHidden();
      const failure = describeAskError(err, { reason: controller.signal.reason, elapsedMs: deps.now().getTime() - sentAtMs, hidden, secrets: deps.secrets });
      return { ok: false, failure };
    } finally {
      deps.clearTimer(timer);
      unsubscribe();
      inFlight = null;
      activity = null;
    }
  };

  const drive = async (resend: Anthropic.MessageStreamParams | null): Promise<AskOutcome> => {
    signal?.addEventListener("abort", onStop);
    try {
      let pending = resend;
      for (;;) {
        const go = await gate("request");
        if (go === "stopped") return finish({ status: "stopped", during: stoppedDuring ?? "between", ...snapshot() });
        if (go === "deadline") return finish({ status: "deadline", ...snapshot() });

        const request = pending ?? params(usage.requests + 1 === MAX_MODEL_REQUESTS);
        const sent = await send(request, pending !== null);
        pending = null;
        if (!sent.ok) {
          if (sent.failure.code === "stopped") return finish({ status: "stopped", during: stoppedDuring ?? "request", ...snapshot() });
          return finish(failed(sent.failure));
        }

        const { message } = sent;
        // Exactly as returned: the SDK's response blocks are valid request blocks, and a thinking block must come back unchanged.
        turns.push({ role: "assistant", content: message.content as unknown as Anthropic.ContentBlockParam[] });
        const commit = () =>
          conversation.committed.length === history.length &&
          commitQuestion(conversation, turns, { ended: "response", stopReason: message.stop_reason, content: message.content });

        switch (message.stop_reason) {
          case "end_turn":
          case "stop_sequence": {
            const status = textsOf(message.content).length > 0 ? "answered" : "empty";
            return finish({ status, ...snapshot(), committed: commit() });
          }
          case "max_tokens":
            // The text is kept; a tool_use cut off with it never runs, and commitQuestion leaves such a question out.
            return finish({ status: "truncated", ...snapshot(), committed: commit() });
          case "refusal":
            return finish({ status: "refused", ...snapshot() });
          case "model_context_window_exceeded":
            return finish({ status: "too_long", ...snapshot() });
          case "tool_use": {
            const calls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
            if (calls.length === 0) return finish(failed(unexpectedStop(message)));
            // The last request went out with tool_choice none; a tool call from it is not run.
            if (usage.requests >= MAX_MODEL_REQUESTS) return finish({ status: "request_limit", ...snapshot() });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const block of calls) {
              const next = await gate("tool");
              if (next === "stopped") return finish({ status: "stopped", during: stoppedDuring ?? "between", ...snapshot() });
              if (next === "deadline") return finish({ status: "deadline", ...snapshot() });
              emit({ type: "tool_started", request: sent.request, toolUseId: block.id, name: block.name, input: block.input });
              activity = "tool";
              let run;
              try {
                run = await tools.run(block);
              } finally {
                activity = null;
              }
              results.push(run.result);
              emit({ type: "tool_finished", request: sent.request, toolUseId: block.id, step: run.step });
            }
            // Every tool_result first, in tool_use order, in one user message; the closing text rides on the last request's.
            turns.push({ role: "user", content: [...results, ...(usage.requests + 1 === MAX_MODEL_REQUESTS ? [closingBlock()] : [])] });
            continue;
          }
          default:
            return finish(failed(unexpectedStop(message)));
        }
      }
    } finally {
      signal?.removeEventListener("abort", onStop);
    }
  };

  emit({ type: "question_started", question: checked.question, at: startedAt.toISOString() });
  return drive(null);
}

/** A response that ended in a way §3.6 has no row for: pause_turn (no server tools are declared), null, or a new reason. */
function unexpectedStop(message: Anthropic.Message): QuestionFailure {
  const reason = message.stop_reason ?? "none";
  return {
    code: "unexpected_stop",
    retryable: false,
    message: `Claude's response ended in a way awardgrid does not handle (stop reason: ${reason}). The request was processed and may be billed to your key.`,
    requestId: requestIdOf(message),
  };
}

/** Non-empty text blocks, in order. */
function textsOf(content: readonly Anthropic.ContentBlock[]): string[] {
  return content.filter((block): block is Anthropic.TextBlock => block.type === "text" && block.text.trim().length > 0).map((block) => block.text);
}

/** The SDK attaches `_request_id` to a non-streamed response; read it defensively, since a streamed final message has none. */
function requestIdOf(message: Anthropic.Message): string | null {
  const id: unknown = (message as { _request_id?: unknown })._request_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
