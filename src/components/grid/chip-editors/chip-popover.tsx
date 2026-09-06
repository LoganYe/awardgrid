"use client";

/**
 * The shared surface every chip editor sits in (docs/UI_PLAN.md §6.2a): a 28 px chip that is a
 * real <button> (Enter / Space open it, Esc closes it and returns focus to the chip — Base UI
 * does both) and a 320 px popover anchored under it on the --bg-raised ground.
 *
 * Chip states: rest = 1 px --line-strong; modified = 1 px --accent (the accent never fills);
 * error = 1 px --error, aria-invalid, and aria-describedby pointing at the message chip-row.tsx
 * renders under the row — one message per errored chip, so the state never rests on color.
 */
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ChipId } from "@/components/grid/chips-model";

export type ChipState = "default" | "modified" | "error";

export interface ChipPopoverProps {
  id: ChipId;
  label: string;
  /** The value summary (chipSummary); empty renders the placeholder dash. */
  summary: string;
  state?: ChipState;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the popover itself. */
  title: string;
  /** Id of the inline validation message for this chip; wired as aria-describedby on error. */
  errorId?: string;
  /** Hover text for the trigger: the full "label value" string, which the chip itself truncates. */
  tooltip?: string;
  /** Widen the surface (the two-month calendar needs more than the 320 px default). */
  contentClassName?: string;
  children: ReactNode;
}

export function ChipPopover({ id, label, summary, state = "default", disabled = false, open, onOpenChange, title, errorId, tooltip, contentClassName, children }: ChipPopoverProps) {
  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverTrigger
        data-chip={id}
        data-chip-state={state}
        disabled={disabled}
        title={tooltip}
        // The error is never color alone (spec §8): the chip is invalid, and it points at the
        // message under the row that says what to fix.
        aria-invalid={state === "error" ? true : undefined}
        aria-describedby={state === "error" ? errorId : undefined}
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border bg-bg px-2 text-grid text-fg select-none",
          "disabled:border-line disabled:bg-bg-raised disabled:text-fg-muted",
          state === "modified" && "border-accent",
          state === "error" && "border-error text-error",
          state === "default" && "border-line-strong",
        )}
      >
        <span className={cn("t-meta", state === "error" ? "text-error" : "text-fg-muted")}>{label}</span>
        <span className="truncate">{summary === "" ? "–" : summary}</span>
      </PopoverTrigger>
      <PopoverContent aria-label={title} className={contentClassName}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Section title inside an editor popover. */
export function EditorNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return <p className={cn("t-meta", tone === "error" ? "text-error" : "text-fg-muted")}>{children}</p>;
}
