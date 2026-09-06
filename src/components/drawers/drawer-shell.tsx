"use client";

/**
 * The one drawer shell both grid drawers are drawn in (spec §3.5, §3.6, §6; docs/UI_PLAN.md
 * §6.5, §6.6, §10).
 *
 * Responsive behaviour, per spec §6 — the caller states a width and a mobile presentation, the
 * shell decides the rest from the current breakpoint:
 *
 *   ≥ 1280      push          the panel takes `width`; <main> gives up exactly that much, so the
 *                             grid shrinks instead of being covered. Not modal: no scrim, no
 *                             `aria-modal`, no focus trap — the grid behind it stays usable.
 *   768–1279    overlay       over the page with a 40 % scrim, modal, focus trapped.
 *   < 768       sheet         full-height, full-width (the cell drawer).
 *   < 768       bottom-sheet  bottom-anchored with a drag handle (the Ask drawer); a drag of
 *                             more than 120 px closes it (bottom-sheet.tsx, drag.ts).
 *
 * In every mode Esc closes, focus moves into the panel on open and returns to whatever opened
 * it on close, and the open/close transform runs 200 ms — 0 under prefers-reduced-motion
 * (drawer.css). Mutual exclusion is not this component's job: one `useDrawerState` slot decides
 * which drawer exists at all (use-drawer-state.ts).
 */
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BottomSheetHandle } from "@/components/drawers/bottom-sheet";
import { drawerMode, isModalMode, type DrawerMode, type MobilePresentation } from "@/components/drawers/use-drawer-state";
import { useDensity } from "@/components/grid/use-roving-grid";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import "./drawer.css";

/** Matches --motion-slow in tokens.css; how long the panel is kept mounted while it leaves. */
const EXIT_MS = 200;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** SSR-safe "are we in the browser yet": false on the server and during hydration, then true. */
const subscribeNever = () => () => undefined;
const clientTrue = () => true;
const serverFalse = () => false;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === root);
}

/**
 * Where focus lands when a drawer opens. The bottom sheet's drag handle is a real button and the
 * panel's first child, so "the first focusable" would put a keyboard or screen-reader user on
 * "Drag down to close" — one Enter away from dismissing the sheet they just opened. It is skipped
 * here (it is still in the Tab order, just not the entry point); the panel itself is the fallback
 * so a drawer whose body is still loading never leaves focus on the page behind it.
 */
function initialFocusTarget(panel: HTMLElement): HTMLElement {
  return focusableIn(panel).find((el) => !el.classList.contains("ag-drawer-handle")) ?? panel;
}

export interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  /** Header title, rendered as the drawer's `h2`. */
  title: ReactNode;
  /** Spoken name of the drawer; use it when `title` renders codes or glyphs that read badly. */
  ariaLabel?: string;
  /** Only "right" today — the bottom sheet is the < 768 form of a right drawer, not a side. */
  side?: "right";
  /** Desktop width in px: 480 for the cell drawer, 420 for Ask (spec §3.5, §3.6). */
  width?: number;
  /** How the drawer presents below 768 px (spec §6). */
  mobile?: MobilePresentation;
  /** Fixed block under the scrolling body — the cell drawer's caveat + actions (§6.5). */
  footer?: ReactNode;
  /** Extra header content under the title, e.g. the cell drawer's date line. */
  subtitle?: ReactNode;
  /**
   * What the open drawer is about (the cell key, for the cell drawer). When it changes while the
   * drawer stays open, the shell re-captures the element to hand focus back to on close.
   */
  openerKey?: string;
  children: ReactNode;
  className?: string;
  /** Test/e2e hook, set on the panel. */
  "data-testid"?: string;
}

export function DrawerShell({
  open,
  onClose,
  title,
  ariaLabel,
  side = "right",
  width = 480,
  mobile = "sheet",
  footer,
  subtitle,
  openerKey,
  children,
  className,
  "data-testid": testId,
}: DrawerShellProps) {
  const t = useT();
  const density = useDensity();
  const mode: DrawerMode = drawerMode(density, mobile);
  const modal = isModalMode(mode);
  const titleId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const mounted = useSyncExternalStore(subscribeNever, clientTrue, serverFalse);
  // `rendered` keeps the panel in the DOM through the closing transition; `entered` drives it.
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);
  const [dragOffsetPx, setDragOffsetPx] = useState<number | null>(null);

  // React to the `open` prop during render rather than in an effect, so a drawer that opens
  // mounts already in its closed transform and has something to animate from on the next frame.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setEntered(false);
    if (open) setRendered(true);
    else setDragOffsetPx(null);
  }

  // Remember the opener BEFORE the panel takes focus, so Esc can hand it back (spec §3.4:
  // "Esc closes drawers" and the keyboard walk returns to the cell that opened them).
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) openerRef.current = active;
    // `openerKey` re-runs this when the drawer stays open but changes what it is about — in push
    // mode the grid behind it is still clickable, so a second cell replaces the first without a
    // close, and Esc must return focus to the cell the user actually came from.
  }, [open, openerKey]);

  // Enter: two frames before `entered`, so the closed transform is painted first.
  useEffect(() => {
    if (!open || !rendered) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, rendered]);

  // Exit: keep the panel mounted for the length of the slide, and not one frame under reduced
  // motion (drawer.css drops the transition there, so there is nothing to wait for).
  useEffect(() => {
    if (open || !rendered) return;
    const id = window.setTimeout(() => setRendered(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open, rendered]);

  // Move focus in on open; hand it back on close. The panel itself is the fallback target so a
  // drawer whose body is still loading is never left with focus on the page behind it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    initialFocusTarget(panel).focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  /**
   * Body scroll lock for the modal modes (spec §6: overlay, sheet and bottom sheet are modal).
   * Without it a scroll or a touch drag over the scrim chains to the grid behind a dialog that
   * claims to be modal — and on the bottom sheet, most of the viewport IS scrim. The pushing
   * drawer is deliberately excluded: the page beside it is meant to stay usable.
   */
  useEffect(() => {
    if (!open || !modal) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    // Compensate the scrollbar we just removed, so the page does not jump sideways.
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open, modal]);

  // Push mode reserves the width on <main> (drawer.css). Drawers are mutually exclusive, so at
  // most one of these effects owns the attribute at a time.
  useEffect(() => {
    if (!open || mode !== "push") return;
    const root = document.documentElement;
    root.dataset.drawerPush = "open";
    root.style.setProperty("--ag-drawer-push", `${width}px`);
    return () => {
      delete root.dataset.drawerPush;
      root.style.removeProperty("--ag-drawer-push");
    };
  }, [open, mode, width]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // A popover inside the drawer that handled Escape itself has already called
      // preventDefault; closing the whole drawer on top of that would be one Esc too many.
      // An Escape that dismisses an IME candidate window is not a request to close either
      // (query-bar.tsx guards Enter the same way), so a zh draft is never lost to it.
      if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !modal) return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [modal, onClose],
  );

  if (!mounted || !rendered) return null;

  const state = entered && open ? "open" : "closed";
  const bottom = mode === "bottom-sheet";
  const dragging = dragOffsetPx !== null;
  const style: React.CSSProperties = { ["--ag-drawer-width" as string]: `${width}px` };
  if (dragging && dragOffsetPx > 0) style.transform = `translateY(${dragOffsetPx}px)`;

  return createPortal(
    <>
      {modal && (
        <div
          className="ag-drawer-scrim"
          data-state={state}
          aria-hidden
          onClick={onClose}
          data-testid={testId ? `${testId}-scrim` : undefined}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        // A pushing drawer sits beside the page and leaves it usable, so it is deliberately not
        // aria-modal — announcing the rest of the page as inert would be a lie (spec §6).
        // Only while it is actually open: during the 200 ms exit focus is already back on the
        // page, and a panel that still claimed to be a modal dialog would be lying about it.
        aria-modal={modal && open ? true : undefined}
        // `inert` takes the exiting panel out of the accessibility tree, the tab order and the
        // hit-testing all at once, so nothing in it can be reached or clicked on the way out.
        inert={!open}
        {...(ariaLabel ? { "aria-label": ariaLabel } : { "aria-labelledby": titleId })}
        tabIndex={-1}
        className={cn("ag-drawer", className)}
        data-slot="drawer"
        data-side={bottom ? "bottom" : side}
        data-mode={mode}
        data-state={state}
        data-dragging={dragging ? "true" : undefined}
        data-testid={testId}
        style={style}
        onKeyDown={onKeyDown}
      >
        {bottom && <BottomSheetHandle label={t("drawer.handle")} onDrag={setDragOffsetPx} onDismiss={onClose} />}
        <div className="flex items-start gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={titleId} className="truncate text-base font-semibold text-fg">
              {title}
            </h2>
            {subtitle}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common.close")}>
            <XIcon aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="flex flex-col gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
