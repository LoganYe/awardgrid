"use client";

/** Cabins editor (spec §3.2): four toggles, at least one on. The last one on cannot be switched off. */
import type { I18nKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { Cabin } from "@/lib/query/schema";
import { cn } from "@/lib/utils";
import { EditorNote } from "@/components/grid/chip-editors/chip-popover";
import { ALL_CABINS } from "@/components/grid/state";

/** Spec §3.2 order: "J / F / W / Y toggles" — the same constant the toolbar's toggle uses. */
export const CABIN_TOGGLES: readonly Cabin[] = ALL_CABINS;

const CABIN_KEYS: Record<Cabin, I18nKey> = {
  Y: "grid.cabin.Y",
  W: "grid.cabin.W",
  J: "grid.cabin.J",
  F: "grid.cabin.F",
};

export interface CabinsEditorProps {
  cabins: readonly Cabin[];
  onChange: (cabins: Cabin[]) => void;
}

export function CabinsEditor({ cabins, onChange }: CabinsEditorProps) {
  const t = useT();
  const last = cabins.length === 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {CABIN_TOGGLES.map((cabin) => {
          const on = cabins.includes(cabin);
          return (
            <button
              key={cabin}
              type="button"
              aria-pressed={on}
              disabled={on && last}
              onClick={() => onChange(on ? cabins.filter((c) => c !== cabin) : CABIN_TOGGLES.filter((c) => c === cabin || cabins.includes(c)))}
              className={cn(
                "inline-flex h-8 min-w-8 items-center gap-1.5 rounded-lg border px-2 text-grid",
                on ? "border-line-strong bg-bg text-fg" : "border-line text-fg-muted hover:bg-bg",
                on && last && "disabled:border-line-strong disabled:bg-bg disabled:text-fg",
              )}
            >
              <span className="font-medium">{cabin}</span>
              <span className="t-meta text-fg-muted">{t(CABIN_KEYS[cabin])}</span>
            </button>
          );
        })}
      </div>
      <EditorNote tone={cabins.length === 0 ? "error" : "muted"}>{t("grid.chips.at_least_one_cabin")}</EditorNote>
    </div>
  );
}
