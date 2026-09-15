"use client";

/**
 * The cell drawer's action block (spec §3.5; docs/UI_PLAN.md §6.5).
 *
 * Order is load-bearing and asserted in e2e: the confirmation line is BODY TEXT sitting directly
 * above "Open in <program>", never a tooltip and never a footnote below it. A user about to
 * leave for a program's site reads it on the way out, before the click, not after.
 *
 * The link itself comes from `resolveDeeplink`: seats.aero's own booking URL once "Show flights"
 * has learned it, else the one program search builder that exists (American), else nothing —
 * the button is disabled and says so rather than inventing a URL (kickoff §4.4).
 */
import { useEffect, useId, useRef, useState } from "react";
import { SaveQueryDialog } from "@/components/queries/SaveQueryDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { buildCopyDetails, copyText } from "@/components/grid/cell-drawer/copy-details";
import { programDisplayName } from "@awardgrid/core/grid/ranking";
import { prefillFromCell } from "@/components/drawers/prefill";
import { localToday } from "@/components/grid/state";
import { resolveDeeplink } from "@awardgrid/core/grid/deeplinks/index";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";

/** How long the "Details copied" line stays up. */
const TOAST_MS = 4000;

export interface CellActionsProps {
  /** The action target: the cheapest program in this cell, the one the grid cell shows. */
  row: AvailabilityRow;
  /** The query the grid was produced from; the standing query inherits everything but the route. */
  query: QueryObject;
  now: number;
  /** "Ask about this cell" — hands the selected cell to the Ask drawer (spec §3.6). */
  onAsk?: () => void;
}

export function CellActions({ row, query, now, onAsk }: CellActionsProps) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const [note, setNote] = useState<string>("");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  function flash(text: string) {
    setNote(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(""), TOAST_MS);
  }

  const link = resolveDeeplink(row);
  const noLinkId = `${id}-no-link`;
  // The long name, not the 112 px cell's short one: src/lib/grid/format.ts states the rule
  // ("the long names stay in SOURCE_NAMES for the drawer, CSV and digests") and the button broke
  // it, so the primary action read "Open in Singapore" — a country, not a program.
  const label = t("grid.sheet.open_in", { program: programDisplayName(row.program) });
  const prefill = prefillFromCell({ origin: row.origin, dest: row.dest, date: row.date }, query, localToday());

  async function onCopy() {
    const ok = await copyText(buildCopyDetails({ row, url: link.url, now, locale, t }));
    flash(ok ? t("grid.sheet.copied") : t("grid.drawer.copy_failed"));
  }

  return (
    <>
      {/* Body text, directly above the button (spec §3.5) — never a tooltip. */}
      <p className="agd-caveat t-body" data-testid="drawer-caveat">
        {t("grid.deeplink_caveat")}
      </p>

      <div className="agd-buttons">
        {link.url ? (
          <a
            data-slot="button"
            className={buttonVariants({ variant: "default", size: "xs" })}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-testid="drawer-open"
          >
            {label}
          </a>
        ) : (
          <>
            <Button type="button" size="xs" disabled aria-describedby={noLinkId} data-testid="drawer-open">
              {label}
            </Button>
            {/* The note explains the button beside it, so it sits beside it: below the whole
                block it read as a footnote about the block, one (desktop) or two (sheet) rows
                away from the disabled button it is about. */}
            <span id={noLinkId} className="agd-muted t-meta" data-testid="drawer-no-link">
              {t("grid.drawer.no_link_yet")}
            </span>
          </>
        )}
        <Button type="button" size="xs" variant="outline" onClick={() => void onCopy()} data-testid="drawer-copy">
          {t("grid.sheet.copy_details")}
        </Button>
        <SaveQueryDialog query={query} prefill={prefill} />
        {onAsk && (
          <Button type="button" size="xs" variant="outline" onClick={onAsk} data-testid="drawer-ask">
            {t("grid.drawer.ask_about")}
          </Button>
        )}
      </div>

      {/* `min-h-[1lh]` keeps the line's box whether or not it has text: the toast used to
          collapse to zero height, so clicking "Copy details" moved the whole action block
          16 px up, directly under the pointer that had just clicked it. */}
      <p className="agd-muted t-meta min-h-[1lh]" role="status" aria-live="polite" data-testid="drawer-toast">
        {note}
      </p>
    </>
  );
}
