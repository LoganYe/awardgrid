/**
 * A condition chip (spec §10): a 36 pt visual face inside a 44 pt touch slot, so rows of chips never have
 * overlapping targets even though they look compact. A selected chip shows a check mark AND a filled face — the
 * state is never colour alone — and reports aria-pressed.
 *
 *   toggle  a query condition (the default)
 *   filter  narrows what is already loaded; quieter text until selected
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icons";

export type ChipVariant = "toggle" | "filter";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ChipVariant;
  /** A toggle chip's state. Leave undefined for a chip that opens something rather than toggling. */
  selected?: boolean;
  /** Trailing content inside the face, e.g. a chevron for a chip that opens a picker. */
  trailing?: ReactNode;
  children: ReactNode;
}

export function Chip({ variant = "toggle", selected, trailing, className, children, type = "button", ...rest }: ChipProps) {
  const classes = ["ag-chip", variant === "filter" ? "ag-chip-filter" : null, className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} aria-pressed={selected} className={classes}>
      <span className="ag-chip-face">
        {selected ? <Icon name="check" size={16} /> : null}
        <span>{children}</span>
        {trailing}
      </span>
    </button>
  );
}
