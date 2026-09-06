"use client";

/**
 * Programs editor (spec §3.2): a searchable multi-select over every seats.aero program, with
 * "All" on by default. The long program name is the label, the short name is muted beside it;
 * text only, no logos and no brand colors. An empty selection means "every program the key can
 * reach", which is what the chip reads as "all 26"; the row beside "All" states the bare count
 * ("26 programs"), so the two never read as "All all 26".
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";
import { cn } from "@/lib/utils";
import { isAllPrograms, programsList, selectAllPrograms, toggleProgram } from "@/components/grid/chips-model";

export interface ProgramsEditorProps {
  /** Selected source codes; an empty list is "all programs". */
  programs: readonly string[];
  onChange: (programs: string[] | null) => void;
}

export function ProgramsEditor({ programs, onChange }: ProgramsEditorProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  // One definition of "All" for the editor, the chip summary and the modified diff.
  const all = isAllPrograms({ programs });
  const rows = programsList({ search, selected: all ? SEATS_SOURCES : programs });

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("grid.chips.search_programs")}
        aria-label={t("grid.chips.search_programs")}
        autoComplete="off"
        className="h-8"
      />
      <button
        type="button"
        aria-pressed={all}
        onClick={() => onChange(selectAllPrograms())}
        className={cn("flex h-8 items-center gap-2 rounded-lg border px-2 text-grid", all ? "border-line-strong bg-bg text-fg" : "border-line text-fg-muted hover:bg-bg")}
      >
        {t("grid.chips.programs_clear")}
        <span className="t-meta text-fg-muted">{t("grid.chips.programs_total", { n: SEATS_SOURCES.length })}</span>
      </button>
      <ul className="max-h-56 overflow-y-auto" aria-label={t("grid.chips.programs")}>
        {rows.map((row) => (
          <li key={row.code}>
            <button
              type="button"
              aria-pressed={row.selected}
              onClick={() => onChange(toggleProgram(all ? SEATS_SOURCES : programs, row.code))}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-1.5 text-left text-grid hover:bg-bg"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none",
                  row.selected ? "border-line-strong bg-fg text-bg" : "border-line-strong bg-bg text-transparent",
                )}
              >
                ✓
              </span>
              <span className="truncate">{row.name}</span>
              <span className="ml-auto shrink-0 t-meta text-fg-muted">{row.short}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
