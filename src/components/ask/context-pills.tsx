"use client";

/**
 * Context pills (spec §3.6): what the question is sent with, and a way to switch each off
 * before sending. Each pill is a toggle button carrying `aria-pressed`; the off state is drawn
 * with a dashed edge and struck-through text as well as muted color, so the state never depends
 * on color alone (§8).
 *
 * The labels are the spec's verbatim formats and come from `labels.ts`.
 */
import type { AskCellContext } from "@/app/api/ask/wire";
import { cellPillLabel, gridPillLabel } from "@/components/ask/labels";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";
import { cn } from "@/lib/utils";

export interface ContextPillsProps {
  query: QueryObject | null;
  cell: AskCellContext | null;
  includeQuery: boolean;
  includeCell: boolean;
  onToggleQuery: (next: boolean) => void;
  onToggleCell: (next: boolean) => void;
  disabled?: boolean;
}

function Pill({ label, pressed, onToggle, disabled, testId }: { label: string; pressed: boolean; onToggle: (next: boolean) => void; disabled?: boolean; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onToggle(!pressed)}
      className={cn(
        "t-meta max-w-full truncate rounded-[var(--radius-control)] border px-2 py-1 text-left",
        pressed ? "border-line-strong bg-bg-raised text-fg" : "border-dashed border-line text-fg-muted line-through",
        disabled && "opacity-60",
      )}
      title={label}
    >
      {label}
    </button>
  );
}

export function ContextPills({ query, cell, includeQuery, includeCell, onToggleQuery, onToggleCell, disabled }: ContextPillsProps) {
  const t = useT();
  const locale = useLocale();
  if (!query && !cell) return <p className="t-meta text-fg-muted">{t("ask.context.none")}</p>;
  return (
    <div className="flex flex-col items-start gap-1" role="group" aria-label={t("ask.context.include")}>
      {query && (
        <Pill label={gridPillLabel(query, t, locale)} pressed={includeQuery} onToggle={onToggleQuery} disabled={disabled} testId="ask-pill-grid" />
      )}
      {cell && <Pill label={cellPillLabel(cell, t, locale)} pressed={includeCell} onToggle={onToggleCell} disabled={disabled} testId="ask-pill-cell" />}
    </div>
  );
}
