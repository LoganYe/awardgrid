"use client";

/**
 * The bottom sheet's drag handle (spec §6: "the Ask drawer is a bottom sheet with a drag
 * handle"; docs/UI_PLAN.md §6.6: a 32 × 4 px bar).
 *
 * Pointer events only — one code path for touch, pen and mouse, with pointer capture so a drag
 * that leaves the handle still tracks. The arithmetic (how far, and whether that closes the
 * sheet) lives in drag.ts and is unit tested; this file is the wiring.
 *
 * The handle is a real button: it is the mobile close affordance, so tapping it or pressing
 * Enter closes the sheet the same way dragging past the threshold does. A click that follows a
 * genuine drag is swallowed, otherwise a dismissing drag would fire the close twice.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BOTTOM_SHEET_DISMISS_PX, dragOffset, dragOutcome, isDrag } from "@/components/drawers/drag";

export interface BottomSheetHandleProps {
  /** Live offset while dragging, `null` when the pointer is up (the panel springs back). */
  onDrag: (offsetPx: number | null) => void;
  /** Dragged past the threshold, tapped, or activated from the keyboard. */
  onDismiss: () => void;
  /** Accessible name — the handle is the sheet's close control. */
  label: string;
  threshold?: number;
}

export function BottomSheetHandle({ onDrag, onDismiss, label, threshold = BOTTOM_SHEET_DISMISS_PX }: BottomSheetHandleProps) {
  const startY = useRef<number | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startY.current = e.clientY;
    dragged.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    onDrag(0);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (startY.current === null) return;
    const offset = dragOffset({ startY: startY.current, currentY: e.clientY });
    if (isDrag(offset)) dragged.current = true;
    onDrag(offset);
  }

  function end(e: ReactPointerEvent<HTMLButtonElement>, dismissable: boolean) {
    if (startY.current === null) return;
    const offset = dragOffset({ startY: startY.current, currentY: e.clientY });
    startY.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onDrag(null);
    if (dismissable && dragOutcome(offset, threshold) === "dismiss") onDismiss();
  }

  return (
    <button
      type="button"
      className="ag-drawer-handle"
      data-dragging={dragging ? "true" : undefined}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onClick={() => {
        // A drag that ended in "settle" is not also a tap; only a real tap closes here.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onDismiss();
      }}
    />
  );
}
