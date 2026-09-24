/**
 * A segmented control (spec §10: 44 pt frame, equal segments, the selected one changes BOTH its fill and its text
 * weight). Built as a radio group: one Tab stop (the checked segment), arrows / Home / End move the selection, as the
 * WAI-ARIA radio group pattern expects; a disabled option is skipped. Changing the selection is a local view change;
 * it never fetches.
 */
import { type KeyboardEvent, useRef } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown but not selectable; the arrows skip it. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Only the option equal to `value` is checked; none is when `value` matches nothing. The group's one tab stop is
  // the checked option, or the first enabled one when the checked option is disabled or missing, so the group can
  // always be reached with Tab.
  const checkedIndex = options.findIndex((o) => o.value === value);
  const firstEnabled = options.findIndex((o) => !o.disabled);
  const tabStop = checkedIndex >= 0 && !options[checkedIndex]!.disabled ? checkedIndex : firstEnabled;
  const index = checkedIndex >= 0 ? checkedIndex : Math.max(0, tabStop);

  /** From `start`, step by `step` to the first enabled option (wrapping); stays put if there is none. */
  const move = (start: number, step: 1 | -1) => {
    for (let n = 0; n < options.length; n++) {
      const i = (((start + step * n) % options.length) + options.length) % options.length;
      if (options[i]!.disabled) continue;
      onChange(options[i]!.value);
      refs.current[i]?.focus();
      return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(index + 1, 1),
      ArrowDown: () => move(index + 1, 1),
      ArrowLeft: () => move(index - 1, -1),
      ArrowUp: () => move(index - 1, -1),
      Home: () => move(0, 1),
      End: () => move(options.length - 1, -1),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div role="radiogroup" aria-label={label} className={["ag-segmented", className].filter(Boolean).join(" ")}>
      {options.map((option, i) => {
        const checked = i === checkedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={option.disabled}
            className="ag-segment"
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
