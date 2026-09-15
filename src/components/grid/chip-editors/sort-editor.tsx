"use client";

/** Sort editor (spec §3.2): one native select bound to sort_by, restyled on the tokens. */
import type { I18nKey } from "@awardgrid/core/i18n";
import { useT } from "@awardgrid/core/i18n/client";
import type { SortBy } from "@awardgrid/core/query/schema";
import { SORT_OPTIONS } from "@/components/grid/state";

const SORT_KEYS: Record<SortBy, I18nKey> = {
  miles_asc: "grid.sort.miles_asc",
  fees_asc: "grid.sort.fees_asc",
  seats_desc: "grid.sort.seats_desc",
  date_asc: "grid.sort.date_asc",
};

export interface SortEditorProps {
  value: SortBy;
  onChange: (value: SortBy) => void;
}

export function SortEditor({ value, onChange }: SortEditorProps) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1 text-grid">
      <span className="t-meta text-fg-muted">{t("grid.chips.sort")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortBy)}
        aria-label={t("grid.chips.sort")}
        className="h-8 w-full rounded-lg border border-line-strong bg-bg px-2 text-grid text-fg"
      >
        {SORT_OPTIONS.map((sort) => (
          <option key={sort} value={sort}>
            {t(SORT_KEYS[sort])}
          </option>
        ))}
      </select>
    </label>
  );
}
