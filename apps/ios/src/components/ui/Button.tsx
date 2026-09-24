/**
 * Buttons (spec §10; docs/04 "全局组件与状态").
 *
 *   primary    the one filled accent action on a screen
 *   secondary  surface fill, control border, text colour
 *   quiet      text-only accent action (no border), still a full-size target
 *   danger     secondary shape, danger text
 *
 * Every size comes from the tokens: 48 tall on a phone, 40 with a fine pointer on a wide screen, never below the
 * 44 pt touch floor on a touch screen. A disabled button keeps its reason visible and attached (aria-describedby)
 * instead of fading away; a loading button keeps its label, so its width does not jump, and says it is busy. Loading is
 * aria-disabled rather than disabled, so focus stays on the button while its work runs; clicks are ignored.
 */
import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useId } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Why the button cannot be used right now. Shown under it whenever it is disabled. */
  disabledReason?: string | null;
  /** Work is under way. The label stays in place; the button keeps focus, ignores clicks and reports aria-busy. */
  loading?: boolean;
  /** What a screen reader hears while loading, e.g. "Searching". */
  loadingLabel?: string;
  /** Stretch to the container's width. */
  block?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ag-button ag-button-primary",
  secondary: "ag-button",
  quiet: "ag-button ag-button-quiet",
  danger: "ag-button ag-button-danger",
};

export function Button({
  variant = "secondary",
  disabledReason,
  loading = false,
  loadingLabel,
  block = false,
  disabled,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  const noteId = useId();
  const showReason = Boolean(disabled && disabledReason);
  const describedBy = [rest["aria-describedby"], showReason ? noteId : null].filter(Boolean).join(" ") || undefined;
  const classes = [VARIANT_CLASS[variant], block ? "ag-button-block" : null, className].filter(Boolean).join(" ");
  const button = (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={loading && !disabled ? true : rest["aria-disabled"]}
      aria-busy={loading || undefined}
      onClick={loading ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
      aria-describedby={describedBy}
    >
      <span className="ag-button-label">{children}</span>
      {loading ? (
        <>
          <span className="ag-button-busy" aria-hidden="true" />
          {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        </>
      ) : null}
    </button>
  );
  if (!showReason) return button;
  return (
    <span className={block ? "ag-button-wrap ag-button-wrap-block" : "ag-button-wrap"}>
      {button}
      <span id={noteId} className="ag-control-note">
        {disabledReason}
      </span>
    </span>
  );
}
