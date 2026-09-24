/**
 * A labelled text field (spec §10, docs/04): the label sits OUTSIDE the control, help and error sit below it, and
 * both are part of the field's accessible description. An error marks the field invalid and says what is wrong in
 * words, so colour is never the only signal. 48 pt tall on a phone; 16 px text so iOS does not zoom on focus.
 */
import { type InputHTMLAttributes, useId } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  help?: string | null;
  error?: string | null;
  /** Stable id when a caller needs to focus or reference the input. */
  id?: string;
}

export function TextField({ label, help, error, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? `${auto}-input`;
  const helpId = help ? `${auto}-help` : null;
  const errorId = error ? `${auto}-error` : null;
  const describedBy = [rest["aria-describedby"], errorId, helpId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ag-field">
      <label className="ag-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className={["ag-input", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <p id={errorId!} className="ag-field-error">
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId!} className="ag-field-help">
          {help}
        </p>
      ) : null}
    </div>
  );
}
