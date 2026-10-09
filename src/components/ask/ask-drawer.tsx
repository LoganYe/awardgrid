"use client";

/**
 * The Ask drawer (spec §3.6; docs/UI_PLAN.md §6.6). 420 px on the right at desktop, a bottom
 * sheet with a drag handle below 768 px (§6).
 *
 * Top to bottom: context pills the user can switch off before sending, three suggested
 * questions, the transcript (each turn: the question, the streamed markdown answer, a collapsed
 * tool-activity list), the composer with Send / Stop, and the cost meter with the one muted line
 * that says the history is per browser session.
 *
 * Boundaries: no money logic (the meter shows the operator's daily cap only), no tool inputs on
 * screen, no raw HTML from the model, history in sessionStorage and nowhere else.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ASK_PROMPT_MAX, type AskCellContext, type AskUsageResponse, type AskWireEvent } from "@/app/api/ask/wire";
import { Answer } from "@/components/ask/answer";
import { askStream, fetchAskUsage, type AskFailureCode } from "@/components/ask/client";
import { ContextPills } from "@/components/ask/context-pills";
import { atCap, CostMeter, formatReset } from "@/components/ask/cost-meter";
import { addToolName, buildAskContext, formatUsd } from "@/components/ask/context";
import { ASK_DEMO_OFF, askDemoStreamUrl, askDemoUsageUrl, probeAskDemo, resolveAskDemo, type AskDemoState } from "@/components/ask/demo";
import { appendTurn, loadHistory, saveHistory, type AskTurn } from "@/components/ask/history";
import { SeatsAttribution } from "@/components/shell/seats-attribution";
import { Suggestions } from "@/components/ask/suggestions";
import { ToolActivity } from "@/components/ask/tool-activity";
import { DrawerShell } from "@/components/drawers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { cn } from "@/lib/utils";

export interface AskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The grid's current QueryObject (null before the first parse). */
  query: QueryObject | null;
  /** The selected cell's best row (null when nothing is selected or the cell is empty). */
  cell: AskCellContext | null;
  /** Whether the user has a seats.aero key on file (server-rendered, like the grid). */
  hasKey: boolean;
  /**
   * UI/UX v1 T19, the workspace's assistant panel: its title (the approved "AI assistance"), width (360), the column it
   * docks into at ≥ 1280, its test id, and a full-height page below 768 (S10). The grid passes none of these.
   */
  panel?: { title: string; width: number; container: HTMLElement | null; testId: string; className?: string; opener?: HTMLElement | null };
}

type Phase = "idle" | "streaming" | "done";

/** Terminal states the drawer explains specially; anything else is a generic failure. */
type Problem =
  | { kind: "no_key" }
  | { kind: "budget"; capUsd?: number }
  | { kind: "timeout" }
  | { kind: "plugin_missing" }
  | { kind: "aborted" }
  | { kind: "unauthorized" }
  | { kind: "network" }
  | { kind: "internal" };

interface LiveAnswer {
  prompt: string;
  text: string;
  tools: string[];
  model: string | null;
  costUsd: number | null;
  subtype: string | null;
}

const EMPTY_ANSWER: LiveAnswer = { prompt: "", text: "", tools: [], model: null, costUsd: null, subtype: null };

/** Desktop width of the Ask drawer in px (spec §3.6). Below 768 px it becomes a bottom sheet. */
export const ASK_DRAWER_WIDTH = 420;

/** "Are we past hydration?" — sessionStorage may only be read once the answer is true. */
const subscribeNever = () => () => undefined;
const clientTrue = () => true;
const serverFalse = () => false;

function problemFromError(ev: AskWireEvent): Problem {
  switch (ev.code) {
    case "no_key":
      return { kind: "no_key" };
    case "budget":
    case "budget_exhausted":
    case "error_max_budget_usd":
      return { kind: "budget", ...(ev.capUsd !== undefined ? { capUsd: ev.capUsd } : {}) };
    case "timeout":
      return { kind: "timeout" };
    case "plugin_missing":
      return { kind: "plugin_missing" };
    case "aborted":
      return { kind: "aborted" };
    case "unauthorized":
      return { kind: "unauthorized" };
    default:
      return { kind: "internal" };
  }
}

function problemFromFailure(code: AskFailureCode): Problem {
  switch (code) {
    case "no_key":
      return { kind: "no_key" };
    case "unauthorized":
      return { kind: "unauthorized" };
    case "network":
      return { kind: "network" };
    case "aborted":
      return { kind: "aborted" };
    default:
      return { kind: "internal" };
  }
}

function Turn({ prompt, text, tools, streaming, defaultExpanded }: { prompt: string; text: string; tools: readonly string[]; streaming?: boolean; defaultExpanded?: boolean }) {
  const t = useT();
  return (
    /*
      `last-of-type`, not `last`: the scroll sentinel is the transcript container's real last
      child, so `last:` never matched a turn and the final answer was underlined by a rule that
      separated it from nothing (docs/UI_PLAN.md §1.3).
    */
    <article className="flex flex-col gap-1 border-b border-line pb-3 last-of-type:border-b-0 last-of-type:pb-0" data-testid="ask-turn">
      <p className="t-meta text-fg-muted">{t("ask.turn.you")}</p>
      <p className="t-body">{prompt}</p>
      <p className="t-meta text-fg-muted">{t("ask.turn.answer")}</p>
      <Answer text={text} streaming={streaming} />
      <ToolActivity tools={tools} defaultExpanded={defaultExpanded} />
    </article>
  );
}

export function AskDrawer({ open, onOpenChange, query, cell, hasKey, panel }: AskDrawerProps) {
  const t = useT();
  const locale = useLocale();
  const [prompt, setPrompt] = useState("");
  const [includeQuery, setIncludeQuery] = useState(true);
  const [includeCell, setIncludeCell] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<LiveAnswer>(EMPTY_ANSWER);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [usage, setUsage] = useState<AskUsageResponse | null>(null);
  const [stored, setStored] = useState<AskTurn[] | null>(null);
  const [demo, setDemo] = useState<AskDemoState>(ASK_DEMO_OFF);
  const inflight = useRef<AbortController | null>(null);
  const meterId = useId();
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  /** Answers received on this page. A ref: nothing renders it, and the usage URL reads it. */
  const answersRef = useRef(0);

  // sessionStorage exists only in the browser, so the history is read after hydration and the
  // server render (empty) matches the first client render.
  const mounted = useSyncExternalStore(subscribeNever, clientTrue, serverFalse);
  const initialHistory = useMemo(() => (mounted ? loadHistory() : []), [mounted]);
  const history = stored ?? initialHistory;
  /** The live answer, mirrored in a ref so the stream's callbacks never read a stale copy. */
  const liveRef = useRef<LiveAnswer>(EMPTY_ANSWER);

  // The scripted offline stream, for the e2e screenshots only (src/components/ask/demo.ts).
  useEffect(() => {
    const wanted = resolveAskDemo(window.location.search, window.sessionStorage);
    if (!wanted.on) return;
    let cancelled = false;
    // The route only exists when the server runs with ASK_DEMO_STREAM=1; a 404 leaves the
    // drawer on the real /api/ask.
    void probeAskDemo().then((enabled) => {
      if (!cancelled && enabled) setDemo(wanted);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const usageUrl = useCallback((seen: number) => (demo.on ? askDemoUsageUrl(seen, demo.cap) : undefined), [demo]);

  const refreshUsage = useCallback(
    (seen: number) => {
      const url = usageUrl(seen);
      void (url ? fetchAskUsage(fetch, url) : fetchAskUsage()).then((u) => {
        if (u) setUsage(u);
      });
    },
    [usageUrl],
  );

  // Today's spend when the drawer opens (and after every answer).
  useEffect(() => {
    if (!open || (!hasKey && !demo.on)) return;
    let cancelled = false;
    const url = usageUrl(answersRef.current);
    void (url ? fetchAskUsage(fetch, url) : fetchAskUsage()).then((u) => {
      if (!cancelled && u) setUsage(u);
    });
    return () => {
      cancelled = true;
    };
    // answersRef keeps the count out of the dependency list: this effect is the "on open" read.
  }, [open, hasKey, demo.on, usageUrl]);

  // Abort a running answer when the drawer unmounts.
  useEffect(() => () => inflight.current?.abort(), []);

  /**
   * …and when it closes. `AskDrawer` is rendered unconditionally by grid-app.tsx (DrawerShell
   * returns null internally), so closing it never unmounts this component and the cleanup above
   * never runs. Without this, Esc / the scrim / the X would leave the SSE connection and the
   * server-side agent session running to completion, still spending the operator's daily budget
   * — the exact thing the Stop button exists to prevent. Both exits now behave the same way:
   * abort, keep whatever text arrived, refresh the meter.
   */
  const closeAbort = useRef<() => void>(() => undefined);
  // Kept fresh every render, so the effect below can depend on `open` alone.
  useEffect(() => {
    closeAbort.current = () => {
      if (!inflight.current) return;
      inflight.current.abort();
      inflight.current = null;
      setProblem((p) => p ?? { kind: "aborted" });
      setPhase("done");
      answersRef.current += 1;
      commit();
      refreshUsage(answersRef.current);
    };
  });
  useEffect(() => {
    if (open) return;
    closeAbort.current();
  }, [open]);

  // Keep the newest streamed text in view (instant: motion only answers a user action, §1.1).
  useEffect(() => {
    if (phase === "streaming") transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [answer.text, phase]);

  const capped = atCap(usage);
  const canSend = (hasKey || demo.on) && !capped && phase !== "streaming" && prompt.trim().length > 0 && prompt.length <= ASK_PROMPT_MAX;

  /** Apply one event to the live answer. The ref is the source of truth; state mirrors it. */
  const onEvent = useCallback((ev: AskWireEvent) => {
    const a = liveRef.current;
    let next: LiveAnswer | null = null;
    switch (ev.type) {
      case "init":
        if (ev.model) next = { ...a, model: ev.model };
        break;
      case "text":
        if (ev.text) next = { ...a, text: a.text + ev.text };
        break;
      case "tool":
        if (ev.name) next = { ...a, tools: addToolName(a.tools, ev.name) };
        break;
      case "result":
        next = {
          ...a,
          costUsd: ev.costUsd ?? a.costUsd,
          subtype: ev.subtype ?? a.subtype,
          ...(ev.text && a.text.length === 0 ? { text: ev.text } : {}),
        };
        if (ev.subtype === "error_max_budget_usd") setProblem({ kind: "budget", ...(ev.capUsd !== undefined ? { capUsd: ev.capUsd } : {}) });
        break;
      case "error":
        setProblem(problemFromError(ev));
        break;
      default:
        break;
    }
    if (next) {
      liveRef.current = next;
      setAnswer(next);
    }
  }, []);

  /**
   * Move the finished (or stopped) answer into this session's history. An answer with no text
   * is dropped: the failure line already explains what happened.
   */
  function commit(): void {
    const a = liveRef.current;
    if (a.text.trim().length === 0) return;
    const next = appendTurn(stored ?? loadHistory(), { prompt: a.prompt, text: a.text, tools: a.tools, costUsd: a.costUsd, at: new Date().toISOString() });
    saveHistory(next);
    setStored(next);
    liveRef.current = EMPTY_ANSWER;
    setAnswer(EMPTY_ANSWER);
  }

  async function send() {
    if (!canSend) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const asked = prompt.trim();
    setPhase("streaming");
    liveRef.current = { ...EMPTY_ANSWER, prompt: asked };
    setAnswer(liveRef.current);
    setProblem(null);
    setPrompt("");
    const context = buildAskContext({ query, cell, includeQuery, includeCell });
    const res = await askStream({
      prompt: asked,
      context,
      signal: controller.signal,
      onEvent,
      ...(demo.on ? { endpoint: askDemoStreamUrl(demo, locale) } : {}),
    });
    if (inflight.current !== controller) return; // superseded
    inflight.current = null;
    if (!res.ok) setProblem((p) => p ?? problemFromFailure(res.error));
    setPhase("done");
    answersRef.current += 1;
    commit();
    refreshUsage(answersRef.current);
  }

  function stop() {
    inflight.current?.abort();
    inflight.current = null;
    setProblem((p) => p ?? { kind: "aborted" });
    setPhase("done");
    answersRef.current += 1;
    commit();
    refreshUsage(answersRef.current);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  }

  function pick(question: string) {
    setPrompt(question);
    promptRef.current?.focus();
  }

  function problemText(p: Problem): string {
    switch (p.kind) {
      case "no_key":
        return t("ask.no_key");
      case "budget":
        return t("ask.budget", { cap: formatUsd(p.capUsd ?? usage?.capUsd ?? 2), resetAt: formatReset(usage?.resetAt ?? "", locale) });
      case "timeout":
        return t("ask.timeout");
      case "plugin_missing":
        return t("ask.plugin_missing");
      case "aborted":
        return t("ask.aborted");
      case "unauthorized":
        return t("ask.error.unauthorized");
      case "network":
        return t("ask.error.network");
      default:
        return t("ask.error.generic");
    }
  }

  const showSuggestions = useMemo(() => history.length === 0 && answer.text.length === 0 && phase !== "streaming", [history.length, answer.text, phase]);
  const inputDisabled = (!hasKey && !demo.on) || capped || phase === "streaming";

  const footer = (
    <>
      {/* Failure states, always inline and never a modal */}
      {!hasKey && !demo.on && (
        <p className="t-meta text-fg-muted" data-testid="ask-no-key">
          {t("ask.no_key")}{" "}
          <Link href="/settings" className="link">
            {t("ask.no_key_link")}
          </Link>
        </p>
      )}
      {/*
        Always mounted, even while empty: a screen reader only announces changes to a live region
        that was ALREADY in the accessibility tree, so inserting the region and its text in one
        commit is commonly announced by nothing at all. While there is no failure it is `sr-only`,
        which keeps it in the tree and out of the layout (actions.tsx does the same for its toast).
      */}
      <p
        className={cn("t-meta", !problem ? "sr-only" : problem.kind === "aborted" ? "text-fg-muted" : "text-error")}
        role="status"
        aria-live="polite"
        data-testid="ask-problem"
      >
        {problem ? problemText(problem) : ""}
        {problem?.kind === "no_key" && (
          <>
            {" "}
            <Link href="/settings" className="link">
              {t("ask.no_key_link")}
            </Link>
          </>
        )}
      </p>

      {/* Composer */}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("ask.placeholder")}
          maxLength={ASK_PROMPT_MAX}
          rows={2}
          disabled={inputDisabled}
          aria-label={t("ask.prompt_label")}
          // At the cap the field is disabled; point at the meter so the reason and the reset time
          // are what a screen reader reads out with it, not just "disabled" (spec §3.6).
          aria-describedby={capped ? meterId : undefined}
          className="t-body min-h-14"
          data-testid="ask-prompt"
        />
        <div className="t-meta flex items-center gap-2 text-fg-muted">
          <span>{t("ask.chars", { n: prompt.length, max: ASK_PROMPT_MAX })}</span>
          {phase === "streaming" ? (
            <Button type="button" size="xs" variant="outline" className="ml-auto" onClick={stop} data-testid="ask-stop">
              {t("ask.stop")}
            </Button>
          ) : (
            <Button type="submit" size="xs" className="ml-auto" disabled={!canSend} data-testid="ask-send">
              {t("ask.send")}
            </Button>
          )}
        </div>
      </form>

      <CostMeter usage={usage} id={meterId} />
      <p className="t-meta text-fg-muted">{t("ask.history_note")}</p>
    </>
  );

  return (
    <DrawerShell
      open={open}
      onClose={() => onOpenChange(false)}
      title={panel?.title ?? t("ask.title")}
      subtitle={<p className="t-meta text-fg-muted">{t("ask.subtitle")}</p>}
      width={panel?.width ?? ASK_DRAWER_WIDTH}
      mobile={panel ? "sheet" : "bottom-sheet"}
      container={panel?.container}
      opener={panel?.opener}
      className={panel?.className}
      footer={footer}
      data-testid={panel?.testId ?? "ask-drawer"}
    >
      <div className="flex flex-col gap-3">
        <ContextPills
          query={query}
          cell={cell}
          includeQuery={includeQuery}
          includeCell={includeCell}
          onToggleQuery={setIncludeQuery}
          onToggleCell={setIncludeCell}
          disabled={phase === "streaming"}
        />

        {showSuggestions && <Suggestions onPick={pick} disabled={inputDisabled} />}

        {/*
          Transcript. Deliberately NOT a live region: a `text` delta mutates the last paragraph
          many times a second, so `aria-live` here would queue a re-announcement of every
          half-formed sentence, and restoring the session history would announce the whole
          backlog at once. The one-line status below announces the transitions instead, and
          `aria-busy` marks the region as still changing (spec §8).
        */}
        <div className="flex flex-col gap-3" aria-busy={phase === "streaming" || undefined} data-testid="ask-transcript">
          {history.map((turn, i) => (
            <Turn key={`${i}-${turn.prompt}`} prompt={turn.prompt} text={turn.text} tools={turn.tools} />
          ))}
          {(phase === "streaming" || answer.text.length > 0) && (
            <Turn prompt={answer.prompt} text={answer.text} tools={answer.tools} streaming={phase === "streaming"} />
          )}
          {phase === "streaming" && answer.text.length === 0 && <p className="t-meta text-fg-muted">{t("ask.streaming")}</p>}
          {phase === "done" && answer.text.length === 0 && history.length === 0 && !problem && <p className="t-meta text-fg-muted">{t("ask.empty_answer")}</p>}
          <div ref={transcriptEndRef} aria-hidden />
        </div>
        {/* Answers are drawn from seats.aero's results: the attribution sits beside them, not only in the page footer. */}
        {(history.length > 0 || answer.text.length > 0) && <SeatsAttribution />}

        {/* The only live region in the drawer: two transitions, not the answer text. */}
        <p className="sr-only" role="status" data-testid="ask-live">
          {phase === "streaming" ? t("ask.streaming") : phase === "done" && answer.text.length > 0 ? t("ask.answer_done") : ""}
        </p>
      </div>
    </DrawerShell>
  );
}
