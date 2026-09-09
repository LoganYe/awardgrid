"use client";

/**
 * The "Examples" link next to the query bar (spec §3.1): a popover with three example queries
 * in the current UI language. Clicking one fills the bar and closes the popover; it never runs
 * the search, so the user can edit it first.
 *
 * The link stretches to the height of the query-bar row (`self-stretch`) so the popover, which
 * Base UI anchors to the trigger's own box, opens BELOW the whole row instead of on top of the
 * field it is meant to fill (and, on desktop, on top of the Run button next to it).
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { I18nKey } from "@awardgrid/core/i18n";
import { useT } from "@awardgrid/core/i18n/client";

/** The three examples, per language, from the dictionaries. */
export const EXAMPLE_KEYS: readonly I18nKey[] = ["grid.example.one", "grid.example.two", "grid.example.three"];

export interface ExamplesPopoverProps {
  onPick: (text: string) => void;
  disabled?: boolean;
}

export function ExamplesPopover({ onPick, disabled = false }: ExamplesPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger
        disabled={disabled}
        className="link t-meta inline-flex shrink-0 items-start self-stretch pt-2 disabled:text-fg-muted disabled:no-underline"
        data-testid="examples-trigger"
      >
        {t("grid.examples")}
      </PopoverTrigger>
      <PopoverContent aria-label={t("grid.examples")} side="bottom" sideOffset={6} align="end" className="w-96">
        <ul className="flex flex-col">
          {EXAMPLE_KEYS.map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => {
                  onPick(t(key));
                  setOpen(false);
                }}
                className="w-full rounded-lg px-1.5 py-1.5 text-left text-grid text-fg hover:bg-bg"
              >
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
