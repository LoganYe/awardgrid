/**
 * Bottom-sheet drag arithmetic (spec §6: "the Ask drawer is a bottom sheet with a drag handle").
 *
 * Kept apart from bottom-sheet.tsx so the threshold is a pure function with a unit test rather
 * than something only a pointer-event simulation can check. Pointer events themselves live in
 * bottom-sheet.tsx; everything here is numbers.
 */

/** Drag the handle further than this and the sheet closes on release (spec §6). */
export const BOTTOM_SHEET_DISMISS_PX = 120;

/**
 * Movement below this is a tap, not a drag: the handle doubles as a close button, and a click
 * that follows a real drag must not also fire it.
 */
export const DRAG_SLOP_PX = 4;

export interface DragSample {
  /** Pointer Y at pointerdown. */
  startY: number;
  /** Pointer Y now. */
  currentY: number;
}

/**
 * How far the sheet has been pulled down, in px. Upward movement is clamped to 0: a bottom
 * sheet does not grow past its own height, so dragging up must do nothing rather than lift the
 * panel off the bottom edge.
 */
export function dragOffset({ startY, currentY }: DragSample): number {
  const dy = currentY - startY;
  return dy > 0 ? dy : 0;
}

export type DragOutcome = "dismiss" | "settle";

/** Past the threshold the sheet closes; otherwise it springs back to its open position. */
export function dragOutcome(offsetPx: number, threshold: number = BOTTOM_SHEET_DISMISS_PX): DragOutcome {
  return offsetPx > threshold ? "dismiss" : "settle";
}

/** True when the pointer moved far enough that the gesture was a drag, not a tap. */
export function isDrag(offsetPx: number, slop: number = DRAG_SLOP_PX): boolean {
  return offsetPx > slop;
}
