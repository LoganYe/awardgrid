"use client";

/**
 * Tool activity (spec §3.6): a collapsed one-line summary that expands on click into the list of
 * steps the lane took ("Checked seats.aero cached search", "Read transfer-partners").
 *
 * Only the tool *name* is ever shown, mapped to a human sentence by `labels.ts`; tool inputs are
 * never rendered (they can carry the user's query text and, in principle, key material).
 */
import { useEffect, useId, useRef, useState } from "react";
import { toolLabels } from "@/components/ask/labels";
import { useT } from "@/lib/i18n/client";

export interface ToolActivityProps {
  /** Raw tool names in first-seen order. */
  tools: readonly string[];
  /** Start expanded (used by the "tools expanded" screenshot and by tests). */
  defaultExpanded?: boolean;
}

export function ToolActivity({ tools, defaultExpanded = false }: ToolActivityProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  /*
    On the mobile bottom sheet the transcript is already scrolled to its end, so the list this
    reveals lands below the fold and the tap looks like it did nothing. Same technique the
    drawer already uses for its transcript sentinel.
  */
  useEffect(() => {
    if (expanded) listRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded]);
  if (tools.length === 0) return null;
  const labels = toolLabels(tools, t);
  return (
    <div className="flex flex-col gap-0.5" data-testid="ask-tool-activity">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((v) => !v)}
        /* Underlined at rest, not on hover: on a touch viewport hover never fires, and the toggle read as a static caption. */
        className="t-meta self-start text-fg-muted underline underline-offset-2"
        data-testid="ask-tools-toggle"
      >
        {t("ask.tools.toggle", { n: labels.length })}
      </button>
      <ul ref={listRef} id={id} hidden={!expanded} className="t-meta flex flex-col gap-0.5 pl-3 text-fg-muted">
        {labels.map((label, i) => (
          <li key={`${label}-${i}`}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
