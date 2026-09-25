/**
 * A modal sheet for one simple task (docs/04 "Overlay": phone sheet with 24 pt top corners, a visible 44 pt close
 * button; a 16 pt-cornered dialog from 768 px). Complex editors (query editor, details, AI) are full pages instead.
 *
 * It renders into <body>, and while it is open everything else in <body> is inert: a screen reader, a tap or a Tab
 * cannot reach the page behind it. Focus moves to the title when it opens (unless a field in it took focus itself);
 * Tab and Shift+Tab wrap inside, over the controls that really take Tab focus; Esc closes it wherever focus is, except
 * while an input method is composing; a tap on the scrim closes it. Focus returns to whatever had it before the sheet
 * opened, or to <main> when that is gone or can no longer take focus. One modal layer at a time (--ag-z-modal).
 */
import { type MouseEvent, type ReactNode, useEffect, useEffectEvent, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** The close button's accessible name, in the screen's language: required, so no sheet falls back to an English word (T11). */
  closeLabel: string;
  children: ReactNode;
}

const CANDIDATES = "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]";

/** The elements inside `root` that Tab actually stops on: not disabled, not tabindex -1, rendered, not inert. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !(el instanceof HTMLInputElement && el.type === "hidden") &&
      el.getClientRects().length > 0 &&
      el.closest("[inert]") === null,
  );
}

export function Sheet({ open, title, onClose, closeLabel, children }: SheetProps) {
  const titleId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** The last element outside the sheet that had focus: the opener, even when a field in the sheet autofocuses. */
  const lastOutside = useRef<Element | null>(null);
  /** Whether the current press started on the scrim itself, so a drag out of the panel does not close the sheet. */
  const pressOnScrim = useRef(false);
  // The latest onClose, without re-running the open/close effect when a parent passes a new function each render.
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    // A DOM check, not the panel ref: a field's autoFocus runs before React attaches the panel's ref.
    const track = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(".ag-sheet-scrim") === null) lastOutside.current = event.target;
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const opener = active !== null && panel.current?.contains(active) ? lastOutside.current : active;
    if (!panel.current?.contains(document.activeElement)) heading.current?.focus();

    // Everything else in <body> becomes inert; what was inert already is left as it was.
    const background = [...document.body.children].filter((el) => el !== layer.current && !el.hasAttribute("inert"));
    for (const el of background) el.setAttribute("inert", "");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        // Esc during IME composition cancels the candidate, not the sheet (Chinese input).
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = tabbable(panel.current);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      const inside = current instanceof Node && panel.current.contains(current);
      if (event.shiftKey && (!inside || current === first || !items.includes(current as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Focus that lands outside the sheet anyway (an element added to <body> later, a programmatic focus()) is
    // brought back to the title.
    const onFocusIn = (event: FocusEvent) => {
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) heading.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      for (const el of background) el.removeAttribute("inert");
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
        if (document.activeElement === opener) return;
      }
      const main = document.querySelector<HTMLElement>("main");
      if (!main) return;
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus();
    };
  }, [open]);

  if (!open) return null;

  // Close on a completed tap or click on the scrim itself. The press's default is prevented, so the browser does not
  // move focus to <body> after the sheet has already handed it back.
  const onScrimMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    pressOnScrim.current = event.target === event.currentTarget;
    if (pressOnScrim.current) event.preventDefault();
  };
  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (pressOnScrim.current && event.target === event.currentTarget) onClose();
    pressOnScrim.current = false;
  };

  const sheet = (
    <div ref={layer} className="ag-sheet-scrim" onMouseDown={onScrimMouseDown} onClick={onScrimClick}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="ag-sheet">
        <div className="ag-sheet-header">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="ag-sheet-title">
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </div>
        <div className="ag-sheet-body">{children}</div>
      </div>
    </div>
  );
  // Rendered to a string (the component tests, no DOM) it stays inline; in a document it goes to <body>.
  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
