/**
 * An on/off switch (reference query-editor.png "仅直飞"; spec §10 states). A button with role="switch" and
 * aria-checked: a 48 × 28 track in a 44 pt target, the thumb moves AND the track fills with the accent when on, so the
 * state is never colour alone. Name it with a <label htmlFor> or aria-labelledby.
 */
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "children"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ checked, onChange, className, type = "button", ...rest }: SwitchProps) {
  return (
    <button
      {...rest}
      type={type}
      role="switch"
      aria-checked={checked}
      className={["ag-switch", className].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className="ag-switch-track" aria-hidden="true">
        <span className="ag-switch-thumb" />
      </span>
    </button>
  );
}
