/**
 * An icon-only control: a 20 pt glyph in a 44 × 44 pt target (36 with a fine pointer on a wide screen, spec §10).
 * `label` is required: an icon button with no accessible name is not a button anyone can use by voice or reader.
 *
 *   plain     no border (toolbars, a sheet's close button)
 *   outlined  the secondary button's border and height, for an icon action that sits beside buttons
 */
import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";

export type IconButtonVariant = "plain" | "outlined";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  variant?: IconButtonVariant;
  icon: IconName;
  label: string;
}

export function IconButton({ variant = "plain", icon, label, className, type = "button", ...rest }: IconButtonProps) {
  const classes = ["ag-icon-button", variant === "outlined" ? "ag-icon-button-outlined" : null, className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} aria-label={label} className={classes}>
      <Icon name={icon} />
    </button>
  );
}
