"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n/client";
import type { Cabin, QueryObject, SortBy } from "@/lib/query/schema";
import type { Provenance } from "@/lib/query/deterministic";
import { SEATS_SOURCES, SOURCE_NAMES } from "@/lib/seatsaero/types";
import { cn } from "@/lib/utils";
import { ALL_CABINS, SORT_OPTIONS, isCommittableDate, localToday, normalizeIata, siblingAirports, type ChipAction } from "@/components/grid/state";

export interface ChipsProps {
  query: QueryObject;
  provenance: Record<string, Provenance>;
  disabled?: boolean;
  onChange: (action: ChipAction) => void;
}

const CABIN_KEYS: Record<Cabin, "grid.cabin.Y" | "grid.cabin.W" | "grid.cabin.J" | "grid.cabin.F"> = {
  Y: "grid.cabin.Y",
  W: "grid.cabin.W",
  J: "grid.cabin.J",
  F: "grid.cabin.F",
};

const SORT_KEYS: Record<SortBy, "grid.sort.miles_asc" | "grid.sort.fees_asc" | "grid.sort.seats_desc" | "grid.sort.date_asc"> = {
  miles_asc: "grid.sort.miles_asc",
  fees_asc: "grid.sort.fees_asc",
  seats_desc: "grid.sort.seats_desc",
  date_asc: "grid.sort.date_asc",
};

/** Subtle provenance badge next to a chip group (deterministic / LLM / default). */
function ProvenanceBadge({ value }: { value: Provenance | undefined }) {
  const t = useT();
  if (!value) return null;
  const key = value === "llm" ? "grid.provenance.llm" : value === "default" ? "grid.provenance.default" : "grid.provenance.deterministic";
  return (
    <span
      className={cn(
        "rounded px-1 text-[10px] leading-4 uppercase tracking-wide",
        value === "llm" ? "bg-aging/15 text-aging" : "bg-muted text-muted-foreground",
      )}
      title={t(key)}
    >
      {value === "llm" ? "LLM" : value === "default" ? "def" : "det"}
    </span>
  );
}

function Group({ label, provenance, children }: { label: string; provenance?: Provenance; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        <ProvenanceBadge value={provenance} />
      </span>
      {children}
    </div>
  );
}

/** Removable airport chip with an "add" input (upper-cased, validated as IATA). */
function AirportChips({
  codes,
  disabled,
  onAdd,
  onRemove,
}: {
  codes: readonly string[];
  disabled: boolean;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const code = normalizeIata(draft);
    if (!code) {
      setInvalid(draft.trim().length > 0);
      return;
    }
    onAdd(code);
    setDraft("");
    setInvalid(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    }
  }

  const siblings = siblingAirports(codes);

  return (
    <>
      {codes.map((code) => (
        <Badge key={code} variant="secondary" className="gap-1 pr-1 font-mono">
          {code}
          <button
            type="button"
            disabled={disabled || codes.length <= 1}
            onClick={() => onRemove(code)}
            aria-label={`${t("grid.chips.remove")} ${code}`}
            className="rounded-sm opacity-70 hover:opacity-100 disabled:opacity-30"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      {siblings.map((code) => (
        <button
          key={`sibling-${code}`}
          type="button"
          disabled={disabled}
          onClick={() => onAdd(code)}
          aria-label={t("grid.chips.add_sibling", { code })}
          title={t("grid.chips.add_sibling", { code })}
          className="inline-flex h-6 items-center gap-0.5 rounded-md border border-dashed border-border px-1.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <PlusIcon className="size-3" />
          {code}
        </button>
      ))}
      <Input
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value.toUpperCase());
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit()}
        placeholder="+ IATA"
        aria-label={t("grid.chips.add_airport")}
        aria-invalid={invalid || undefined}
        maxLength={3}
        className="h-6 w-20 px-1.5 font-mono text-xs uppercase"
      />
      {invalid && <span className="text-xs text-destructive">{t("grid.chips.invalid_airport")}</span>}
    </>
  );
}

/**
 * A text-like input that only reports a value on blur / Enter (never per keystroke). Browsers
 * fire `change` on <input type="date"> for every edited segment once all are filled, and on
 * number inputs per digit, so committing eagerly would dispatch a seats.aero search for
 * "0002-10-15" or "8 → 80 → 800". Escape restores the last committed value.
 */
function CommittedInput({
  value,
  onCommit,
  ...rest
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);
  // A commit (or an external edit, e.g. the other date bound clamping this one) changes `value`:
  // resync the draft during render (React's "adjust state on prop change" pattern).
  if (committed !== value) {
    setCommitted(value);
    setDraft(value);
  }

  function commit() {
    if (draft !== value) onCommit(draft);
    // A rejected or no-op commit snaps the field back to the committed value.
    setDraft(value);
  }

  return (
    <Input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(value);
        }
      }}
    />
  );
}

function ProgramsPicker({ query, disabled, onChange }: { query: QueryObject; disabled: boolean; onChange: (a: ChipAction) => void }) {
  const t = useT();
  const selected = query.programs ?? [];
  const all = selected.length === 0;
  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted">
        {all ? t("grid.chips.programs_all") : t("grid.chips.programs_selected", { n: selected.length, total: SEATS_SOURCES.length })}
      </summary>
      <div className="absolute left-0 z-20 mt-1 grid max-h-72 w-72 grid-cols-1 gap-0.5 overflow-y-auto rounded-md border border-border bg-popover p-2 text-xs shadow-md">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ type: "set_programs", programs: null })}
          className={cn("rounded px-1.5 py-0.5 text-left hover:bg-muted", all && "font-medium")}
        >
          {t("grid.chips.programs_clear")}
        </button>
        {SEATS_SOURCES.map((code) => {
          const on = selected.includes(code);
          return (
            <label key={code} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-muted">
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => onChange({ type: "toggle_program", program: code })} />
              <span>{SOURCE_NAMES[code]}</span>
              <span className="ml-auto font-mono text-muted-foreground">{code}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

/**
 * The parsed QueryObject as editable chips (kickoff §4.2 hard UX requirement). Every edit
 * dispatches a ChipAction; the page re-runs /api/find with the new query.
 */
export function Chips({ query, provenance, disabled = false, onChange }: ChipsProps) {
  const t = useT();
  return (
    <section aria-label={t("grid.chips.title")} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5 text-sm">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:gap-x-6">
        <Group label={t("grid.chips.origins")} provenance={provenance.origins}>
          <AirportChips
            codes={query.origins}
            disabled={disabled}
            onAdd={(code) => onChange({ type: "add_origin", code })}
            onRemove={(code) => onChange({ type: "remove_origin", code })}
          />
        </Group>
        <Group label={t("grid.chips.destinations")} provenance={provenance.destinations}>
          <AirportChips
            codes={query.destinations}
            disabled={disabled}
            onAdd={(code) => onChange({ type: "add_destination", code })}
            onRemove={(code) => onChange({ type: "remove_destination", code })}
          />
        </Group>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-6">
        <Group label={t("grid.chips.dates")} provenance={provenance.date_from}>
          <CommittedInput
            type="date"
            value={query.date_from}
            min={localToday()}
            disabled={disabled}
            onCommit={(v) => isCommittableDate(v) && onChange({ type: "set_dates", date_from: v })}
            className="h-6 w-36 px-1.5 font-mono text-xs"
            aria-label={t("grid.missing.date_from")}
          />
          <span className="text-muted-foreground">→</span>
          <CommittedInput
            type="date"
            value={query.date_to}
            min={localToday()}
            disabled={disabled}
            onCommit={(v) => isCommittableDate(v) && onChange({ type: "set_dates", date_to: v })}
            className="h-6 w-36 px-1.5 font-mono text-xs"
            aria-label={t("grid.missing.date_to")}
          />
        </Group>
        <Group label={t("grid.chips.cabins")} provenance={provenance.cabins}>
          {ALL_CABINS.map((cabin) => {
            const on = query.cabins.includes(cabin);
            return (
              <button
                key={cabin}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                title={t(CABIN_KEYS[cabin])}
                onClick={() => onChange({ type: "toggle_cabin", cabin })}
                className={cn(
                  "h-6 min-w-7 rounded-md border px-1.5 font-mono text-xs transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {cabin}
              </button>
            );
          })}
        </Group>
        <Group label={t("grid.chips.direct_only")} provenance={provenance.direct_only}>
          <Switch size="sm" checked={query.direct_only} disabled={disabled} onCheckedChange={(v) => onChange({ type: "set_direct_only", value: v })} aria-label={t("grid.chips.direct_only")} />
        </Group>
        <Group label={t("grid.include_filtered")}>
          <Switch size="sm" checked={query.include_filtered} disabled={disabled} onCheckedChange={(v) => onChange({ type: "set_include_filtered", value: v })} aria-label={t("grid.include_filtered")} />
        </Group>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-6">
        <Group label={t("grid.chips.max_miles")} provenance={provenance.max_miles}>
          <CommittedInput
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            value={query.max_miles === undefined ? "" : String(query.max_miles)}
            disabled={disabled}
            placeholder={t("grid.chips.max_miles_placeholder")}
            onCommit={(v) => onChange({ type: "set_max_miles", value: v.trim() === "" ? null : Number(v) })}
            className="h-6 w-28 px-1.5 font-mono text-xs"
            aria-label={t("grid.chips.max_miles")}
          />
        </Group>
        <Group label={t("grid.chips.sort")} provenance={provenance.sort_by}>
          <select
            value={query.sort_by}
            disabled={disabled}
            onChange={(e) => onChange({ type: "set_sort", value: e.target.value as SortBy })}
            aria-label={t("grid.chips.sort")}
            className="h-6 rounded-md border border-input bg-transparent px-1.5 text-xs"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(SORT_KEYS[s])}
              </option>
            ))}
          </select>
        </Group>
        <Group label={t("grid.chips.programs")} provenance={provenance.programs}>
          <ProgramsPicker query={query} disabled={disabled} onChange={onChange} />
        </Group>
        {query.raw_text && (
          <span className="ml-auto hidden max-w-xs truncate text-xs text-muted-foreground md:inline" title={query.raw_text}>
            “{query.raw_text}”
          </span>
        )}
      </div>
    </section>
  );
}
