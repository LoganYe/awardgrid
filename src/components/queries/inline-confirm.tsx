"use client";

/**
 * The inline confirmation a destructive action gets — on the Queries page (spec §4, §11:
 * "deletes confirm inline in the row", never a modal) and, for the same reason and with the
 * same keyboard behaviour, on Settings (remove a key, log out everywhere). It replaces the
 * row's actions with the question and two buttons; nothing overlays the page, nothing traps
 * focus, and the row stays readable behind the decision.
 *
 * Keyboard: focus moves to the destructive button when the confirmation appears (it is the
 * thing the user just asked for), Esc cancels, and the group is labelled by the question so a
 * screen reader announces what is being confirmed rather than two bare verbs.
 *
 * Focus comes BACK on dismissal. The control that opened the confirmation is usually unmounted
 * while the question is up — the row swaps its actions for it — so the node captured on mount
 * is detached by the time the effect cleans up; `restoreFocusTo` names the re-rendered opener
 * by selector instead. Without this, Esc or Cancel drops the keyboard user on <body> and they
 * have to tab through the whole shell to get back to the row.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface InlineConfirmProps {
  /** "Delete this query?" — the whole question, already translated. */
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** Button size: "xs" in the dense Queries row, "sm" in the Settings column. */
  size?: "xs" | "sm";
  /** Where the group sits in its container: at the end (a table's Actions cell) or at the start. */
  align?: "start" | "end";
  /**
   * CSS selector for the control that opened this confirmation, e.g.
   * `[data-testid="delete-abc"]`. Focus returns there when the confirmation goes away and the
   * opener is back in the DOM; nothing happens when it is gone (a confirmed delete).
   */
  restoreFocusTo?: string;
  onConfirm: () => void;
  onCancel: () => void;
  "data-testid"?: string;
}

export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel,
  busy = false,
  size = "xs",
  align = "end",
  restoreFocusTo,
  onConfirm,
  onCancel,
  "data-testid": testId,
}: InlineConfirmProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Captured once: the opener of a mounted confirmation never changes, and re-running the
  // effect for a new selector would hand focus back mid-decision.
  const restoreRef = useRef(restoreFocusTo);

  useEffect(() => {
    // The confirmation exists because the user just pressed Delete; focus follows the action.
    const selector = restoreRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.querySelector("button")?.focus();
    return () => {
      const reopened = selector ? document.querySelector<HTMLElement>(selector) : null;
      // Passive-effect cleanup runs after the DOM is committed, so the opener the row just
      // re-rendered is already there; the captured node is only a fallback for a caller that
      // keeps its opener mounted.
      const back = reopened ?? (opener?.isConnected ? opener : null);
      back?.focus();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={question}
      className={align === "end" ? "flex items-center justify-end gap-2 whitespace-nowrap" : "flex flex-wrap items-center gap-2"}
      data-testid={testId ?? "inline-confirm"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <span className="t-meta text-fg-muted">{question}</span>
      <Button type="button" size={size} variant="destructive" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button type="button" size={size} variant="outline" disabled={busy} onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
}
