/**
 * Departure dates (docs/04 S02; spec §12; docs/02 D06): a fixed pair of calendar dates, or the next N days counted in
 * UTC from today and including it. Both modes show what they mean — a fixed pair its day count against core's cap,
 * the relative rule the exact range it resolves to — and "Next days" offers 30 and 60 as quick picks. Switching
 * modes keeps the range the person was looking at (and each mode remembers its last value), so arrowing through the
 * mode control never throws a range away. Nothing here sends anything.
 */
import { MAX_SPAN_DAYS, resolveDates, spanDays } from "@awardgrid/core/workspace/query-editor";
import { isRealDate } from "@awardgrid/core/workspace/semantics";
import type { DateRule, ISODate } from "@awardgrid/core/workspace/types";
import { useId, useRef } from "react";
import { Chip, SegmentedControl, TextField } from "../ui";
import { EDITOR } from "./labels";

export interface DateRuleFieldProps {
  /** Id of the first control, which takes focus when this field has the first error. */
  id: string;
  value: DateRule;
  onChange: (rule: DateRule) => void;
  today: ISODate;
  error?: string | null;
}

const QUICK_DAYS = [30, 60] as const;

type FixedRule = Extract<DateRule, { kind: "fixed" }>;
type RelativeRule = Extract<DateRule, { kind: "relative_days" }>;

export function DateRuleField({ id, value, onChange, today, error }: DateRuleFieldProps) {
  const auto = useId();
  const errorId = `${auto}-error`;
  const mode = value.kind === "fixed" ? "fixed" : "relative";
  // The last value of each mode, so switching back restores it.
  const lastFixed = useRef<FixedRule | null>(value.kind === "fixed" ? value : null);
  const lastRelative = useRef<RelativeRule | null>(value.kind === "relative_days" ? value : null);

  const change = (rule: DateRule) => {
    if (rule.kind === "fixed") lastFixed.current = rule;
    else lastRelative.current = rule;
    onChange(rule);
  };

  const switchTo = (next: "fixed" | "relative") => {
    if (next === mode) return;
    if (next === "fixed") {
      if (lastFixed.current) return change(lastFixed.current);
      // The range the relative rule resolves to today, when it can be resolved.
      try {
        const range = resolveDates(value, today);
        return change({ kind: "fixed", from: range.from, to: range.to });
      } catch {
        return change({ kind: "fixed", from: today, to: today });
      }
    }
    if (lastRelative.current) return change(lastRelative.current);
    const span = value.kind === "fixed" && isRealDate(value.from) && isRealDate(value.to) && value.to >= value.from ? spanDays(value.from, value.to) : 30;
    change({ kind: "relative_days", days: Math.min(span, MAX_SPAN_DAYS), clock: "UTC" });
  };

  let note: string | null = null;
  if (value.kind === "relative_days") {
    try {
      const range = resolveDates(value, today);
      note = EDITOR.relativeRange(range.from, range.to);
    } catch {
      note = null;
    }
  } else if (isRealDate(value.from) && isRealDate(value.to) && value.to >= value.from) {
    note = EDITOR.dayCount(spanDays(value.from, value.to), MAX_SPAN_DAYS);
  }
  const describedBy = error ? errorId : undefined;

  return (
    <div className="ag-field query-field" role="group" aria-labelledby={`${auto}-label`}>
      <div className="query-field-head">
        <span id={`${auto}-label`} className="ag-field-label">
          {EDITOR.dates}
        </span>
        <span className="ag-field-help">{EDITOR.datesHelp}</span>
      </div>
      <SegmentedControl<"fixed" | "relative">
        label={EDITOR.dateMode}
        value={mode}
        onChange={switchTo}
        options={[
          { value: "fixed", label: EDITOR.fixed },
          { value: "relative", label: EDITOR.relative },
        ]}
      />
      {value.kind === "fixed" ? (
        <>
          <div className="query-date-pair">
            <TextField
              id={id}
              label={EDITOR.start}
              type="date"
              value={value.from}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              onChange={(e) => change({ ...value, from: e.target.value })}
            />
            <TextField
              label={EDITOR.end}
              type="date"
              value={value.to}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              onChange={(e) => change({ ...value, to: e.target.value })}
            />
          </div>
          {note ? <p className="ag-field-help">{note}</p> : null}
        </>
      ) : (
        <>
          <div className="ag-chip-row" role="group" aria-label={EDITOR.quickDays}>
            {QUICK_DAYS.map((days) => (
              <Chip key={days} variant="filter" selected={value.days === days} onClick={() => change({ kind: "relative_days", days, clock: "UTC" })}>
                {EDITOR.nextDays(days)}
              </Chip>
            ))}
          </div>
          <TextField
            id={id}
            label={EDITOR.days}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SPAN_DAYS}
            value={Number.isFinite(value.days) ? String(value.days) : ""}
            help={note}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(e) => change({ ...value, days: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
          />
        </>
      )}
      {error ? (
        <p id={errorId} className="ag-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
