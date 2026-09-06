"use client";

/**
 * The Ask drawer (kickoff §7 point 6, §8): a right-hand Sheet with a prompt, context chips
 * (current query + selected cell, each with an include toggle), the streamed answer rendered as
 * text-only minimal markdown, a live "tools used" line, and a footer with this answer's cost and
 * today's spend against the daily cap. Every failure state is explicit: no key → Settings,
 * budget exhausted → reset time, timeout, plugin missing → `pnpm build:plugin`.
 */
import { SquareIcon, SendHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";
import { cn } from "@/lib/utils";
import { ASK_PROMPT_MAX, type AskCellContext, type AskUsageResponse, type AskWireEvent } from "@/app/api/ask/wire";
import { askStream, fetchAskUsage, type AskFailureCode } from "@/components/ask/client";
import { ASK_EXAMPLE_PROMPT, addToolName, buildAskContext, formatUsd, summarizeCell, summarizeQuery } from "@/components/ask/context";
import { parseMarkdownLite, type Block, type Inline } from "@/components/ask/markdown";

export interface AskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The grid's current QueryObject (null before the first parse). */
  query: QueryObject | null;
  /** The selected cell's best row (null when nothing is selected or the cell is empty). */
  cell: AskCellContext | null;
  /** Whether the user has a seats.aero key on file (server-rendered, like the grid). */
  hasKey: boolean;
}

type Phase = "idle" | "streaming" | "done";

/** Terminal states the drawer explains specially; anything else is a generic failure. */
type Problem = { kind: "no_key" } | { kind: "budget"; capUsd?: number } | { kind: "timeout" } | { kind: "plugin_missing" } | { kind: "aborted" } | { kind: "unauthorized" } | { kind: "network" } | { kind: "internal" };

interface Answer {
  text: string;
  tools: string[];
  model: string | null;
  costUsd: number | null;
  subtype: string | null;
}

const EMPTY_ANSWER: Answer = { text: "", tools: [], model: null, costUsd: null, subtype: null };

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

function formatReset(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00:00 UTC";
  return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

// ---------------------------------------------------------------------------
// Text-only markdown renderer (no dangerouslySetInnerHTML anywhere)
// ---------------------------------------------------------------------------

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "bold") return <strong key={i}>{s.text}</strong>;
        if (s.kind === "code")
          return (
            <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
              {s.text}
            </code>
          );
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <p key={i} className="mt-2 font-medium first:mt-0">
                <Spans spans={b.spans} />
              </p>
            );
          case "list": {
            const cls = cn("my-1 flex flex-col gap-0.5 pl-5", b.ordered ? "list-decimal" : "list-disc");
            return b.ordered ? (
              <ol key={i} className={cls}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className={cls}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );
          }
          case "code":
            return (
              <pre key={i} className="my-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={i} className="my-1 first:mt-0">
                <Spans spans={b.spans} />
              </p>
            );
        }
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export function AskDrawer({ open, onOpenChange, query, cell, hasKey }: AskDrawerProps) {
  const t = useT();
  const locale = useLocale();
  const [prompt, setPrompt] = useState("");
  const [includeQuery, setIncludeQuery] = useState(true);
  const [includeCell, setIncludeCell] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<Answer>(EMPTY_ANSWER);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [usage, setUsage] = useState<AskUsageResponse | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  const refreshUsage = useCallback(() => {
    void fetchAskUsage().then((u) => {
      if (u) setUsage(u);
    });
  }, []);

  // Today's spend when the drawer opens (and after every answer).
  useEffect(() => {
    if (!open || !hasKey) return;
    let cancelled = false;
    void fetchAskUsage().then((u) => {
      if (!cancelled && u) setUsage(u);
    });
    return () => {
      cancelled = true;
    };
  }, [open, hasKey]);

  // Abort a running answer when the drawer unmounts.
  useEffect(() => () => inflight.current?.abort(), []);

  // Keep the newest streamed text in view.
  useEffect(() => {
    const el = answerRef.current;
    if (el && phase === "streaming") el.scrollTop = el.scrollHeight;
  }, [answer.text, phase]);

  const budgetExhausted = usage !== null && usage.capUsd > 0 && usage.remainingUsd <= 0;
  const canSend = hasKey && !budgetExhausted && phase !== "streaming" && prompt.trim().length > 0 && prompt.length <= ASK_PROMPT_MAX;

  const onEvent = useCallback((ev: AskWireEvent) => {
    switch (ev.type) {
      case "init":
        if (ev.model) setAnswer((a) => ({ ...a, model: ev.model ?? a.model }));
        break;
      case "text":
        if (ev.text) setAnswer((a) => ({ ...a, text: a.text + ev.text }));
        break;
      case "tool":
        if (ev.name) setAnswer((a) => ({ ...a, tools: addToolName(a.tools, ev.name ?? "") }));
        break;
      case "result":
        setAnswer((a) => ({
          ...a,
          costUsd: ev.costUsd ?? a.costUsd,
          subtype: ev.subtype ?? a.subtype,
          ...(ev.text && a.text.length === 0 ? { text: ev.text } : {}),
        }));
        if (ev.subtype === "error_max_budget_usd") setProblem({ kind: "budget", ...(ev.capUsd !== undefined ? { capUsd: ev.capUsd } : {}) });
        break;
      case "error":
        setProblem(problemFromError(ev));
        break;
      default:
        break;
    }
  }, []);

  async function send() {
    if (!canSend) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setPhase("streaming");
    setAnswer(EMPTY_ANSWER);
    setProblem(null);
    const context = buildAskContext({ query, cell, includeQuery, includeCell });
    const res = await askStream({ prompt: prompt.trim(), context, signal: controller.signal, onEvent });
    if (inflight.current !== controller) return; // superseded
    inflight.current = null;
    if (!res.ok) setProblem((p) => p ?? problemFromFailure(res.error));
    setPhase("done");
    refreshUsage();
  }

  function stop() {
    inflight.current?.abort();
    inflight.current = null;
    setProblem((p) => p ?? { kind: "aborted" });
    setPhase("done");
    refreshUsage();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  }

  const blocks = useMemo(() => parseMarkdownLite(answer.text), [answer.text]);
  const querySummary = query ? summarizeQuery(query) : null;
  const cellSummary = cell ? summarizeCell(cell) : null;

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("ask.title")}</SheetTitle>
          <SheetDescription>{t("ask.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-4">
          {/* Context chips */}
          <div className="flex flex-col gap-1 text-xs">
            {querySummary ? (
              <label className="flex items-center gap-2">
                <Switch size="sm" checked={includeQuery} onCheckedChange={setIncludeQuery} disabled={phase === "streaming"} aria-label={t("ask.context.include")} />
                <span className="text-muted-foreground">{t("ask.context.query")}:</span>
                <span className={cn("num truncate", !includeQuery && "line-through opacity-60")} title={querySummary}>
                  {querySummary}
                </span>
              </label>
            ) : null}
            {cellSummary ? (
              <label className="flex items-center gap-2">
                <Switch size="sm" checked={includeCell} onCheckedChange={setIncludeCell} disabled={phase === "streaming"} aria-label={t("ask.context.include")} />
                <span className="text-muted-foreground">{t("ask.context.cell")}:</span>
                <span className={cn("num truncate", !includeCell && "line-through opacity-60")} title={cellSummary}>
                  {cellSummary}
                </span>
              </label>
            ) : null}
            {!querySummary && !cellSummary && <p className="text-muted-foreground">{t("ask.context.none")}</p>}
          </div>

          {/* Prompt */}
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={ASK_EXAMPLE_PROMPT}
              maxLength={ASK_PROMPT_MAX}
              rows={3}
              disabled={!hasKey || phase === "streaming"}
              aria-label={t("ask.prompt_label")}
              className="min-h-16 text-sm"
            />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <button type="button" className="underline-offset-2 hover:underline disabled:opacity-50" disabled={!hasKey || phase === "streaming"} onClick={() => setPrompt(ASK_EXAMPLE_PROMPT)}>
                {t("ask.use_example")}
              </button>
              <span className="num ml-auto">{t("ask.chars", { n: prompt.length, max: ASK_PROMPT_MAX })}</span>
              {phase === "streaming" ? (
                <Button type="button" size="xs" variant="outline" onClick={stop}>
                  <SquareIcon data-icon="inline-start" />
                  {t("ask.stop")}
                </Button>
              ) : (
                <Button type="submit" size="xs" disabled={!canSend}>
                  <SendHorizontalIcon data-icon="inline-start" />
                  {t("ask.send")}
                </Button>
              )}
            </div>
          </form>

          {/* States */}
          {!hasKey && (
            <p className="text-xs text-muted-foreground">
              {t("ask.no_key")}{" "}
              <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
                {t("ask.no_key_link")}
              </Link>
            </p>
          )}
          {hasKey && budgetExhausted && phase !== "streaming" && !problem && (
            <p className="text-xs text-aging">{t("ask.budget", { cap: formatUsd(usage.capUsd), resetAt: formatReset(usage.resetAt, locale) })}</p>
          )}
          {problem && (
            <p className={cn("text-xs", problem.kind === "aborted" ? "text-muted-foreground" : "text-destructive")} role="status">
              {problemText(problem)}
              {problem.kind === "no_key" && (
                <>
                  {" "}
                  <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
                    {t("ask.no_key_link")}
                  </Link>
                </>
              )}
            </p>
          )}

          {/* Answer */}
          <div ref={answerRef} className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card p-2.5 text-sm leading-relaxed" aria-live="polite">
            {answer.text.length > 0 ? (
              <Blocks blocks={blocks} />
            ) : phase === "streaming" ? (
              <p className="text-xs text-muted-foreground">{t("ask.streaming")}</p>
            ) : phase === "done" && !problem ? (
              <p className="text-xs text-muted-foreground">{t("ask.empty_answer")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("ask.hint")}</p>
            )}
            {phase === "streaming" && answer.text.length > 0 && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/60 align-middle" aria-hidden />}
          </div>

          {/* Tools + footer */}
          <p className="num truncate text-[11px] text-muted-foreground" title={answer.tools.join(", ")}>
            {answer.tools.length > 0 ? t("ask.tools_used", { names: answer.tools.join(", ") }) : t("ask.tools_none")}
          </p>
          <div className="num flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border pt-1.5 text-[11px] text-muted-foreground">
            <span>{t("ask.footer.cost", { cost: answer.costUsd === null ? "—" : formatUsd(answer.costUsd) })}</span>
            {usage && <span>{t("ask.footer.today", { spent: formatUsd(usage.spentUsd), cap: formatUsd(usage.capUsd) })}</span>}
            {answer.model && <span className="truncate">{answer.model}</span>}
            {answer.subtype === "error_max_turns" && <span className="text-aging">{t("ask.max_turns")}</span>}
            <span className="ml-auto">{t("footer.attribution")}</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
