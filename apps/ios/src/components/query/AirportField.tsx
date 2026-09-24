/**
 * Departure or arrival airports (docs/04 S02; spec §12): the chosen airports as removable chips, then a combobox
 * that offers places from the bundled seed. A city is offered with its airports spelled out ("Tokyo · All airports:
 * NRT, HND") and adds them all; each airport is offered on its own, including one that shares its city's code (SHA,
 * Hongqiao). Options are 56 pt rows: name, a second line, the code on the right. Typing, moving through options and
 * choosing one send nothing.
 *
 * Keyboard: the ARIA combobox pattern — arrows move the active option (scrolled into view, ringed), Enter picks it
 * (or the first), Esc closes the list; keys pressed while an input method is composing belong to the IME. "No match"
 * is announced from a status line outside the list, and the list reports itself collapsed. The typed text is the
 * screen's, so text typed but never chosen counts as a change and is caught at submit. Removing a chip moves focus
 * to the next chip, the previous one, or the input.
 */
import { type EditorLanguage, placeName, placeOptions } from "@awardgrid/core/workspace/query-editor";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";
import { EDITOR } from "./labels";

export interface AirportFieldProps {
  id: string;
  label: string;
  codes: readonly string[];
  onChange: (codes: string[]) => void;
  /** What is typed in the box but not chosen yet. */
  text: string;
  onTextChange: (text: string) => void;
  error?: string | null;
  lang?: EditorLanguage;
}

interface Offer {
  key: string;
  airports: string[];
  title: string;
  detail: string | null;
  code: string;
}

export function AirportField({ id, label, codes, onChange, text, onTextChange, error, lang = "en" }: AirportFieldProps) {
  const auto = useId();
  const listId = `${auto}-list`;
  const helpId = `${auto}-help`;
  const errorId = `${auto}-error`;
  const statusId = `${auto}-status`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const chips = useRef(new Map<string, HTMLButtonElement>());

  const offers: Offer[] = useMemo(() => {
    const found = placeOptions(text, lang).map((o) => ({
      key: `${o.kind}-${o.code}`,
      airports: o.airports,
      title: o.name === o.code ? o.code : o.name,
      detail: o.kind === "metro" ? EDITOR.allAirports(o.airports) : o.name === o.code ? null : o.code,
      code: o.code,
    }));
    const typed = text.trim().toUpperCase();
    if (found.length === 0 && /^[A-Z]{3}$/.test(typed)) found.push({ key: `code-${typed}`, airports: [typed], title: EDITOR.typedCode(typed), detail: null, code: typed });
    return found;
  }, [text, lang]);

  const typing = open && text.trim() !== "";
  const showList = typing && offers.length > 0;

  useEffect(() => {
    if (showList) document.getElementById(`${auto}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, showList, auto]);

  const choose = (offer: Offer | undefined) => {
    if (!offer) return;
    onChange([...new Set([...codes, ...offer.airports])]);
    onTextChange("");
    setOpen(false);
    setActive(0);
  };

  const remove = (code: string) => {
    const at = codes.indexOf(code);
    const rest = codes.filter((c) => c !== code);
    onChange(rest);
    // Focus goes to the chip that takes its place, the one before it, or the input.
    const next = rest[at] ?? rest[at - 1];
    window.requestAnimationFrame(() => (next ? chips.current.get(next)?.focus() : document.getElementById(id)?.focus()));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an input method is composing (pinyin for a Chinese city name), these keys are the IME's.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (offers.length > 0) setActive((i) => (i + (event.key === "ArrowDown" ? 1 : -1) + offers.length) % offers.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showList) choose(offers[active] ?? offers[0]);
    } else if (event.key === "Escape" && showList) {
      // Closing the list is this key's job here; the page does not also treat it as "leave".
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const describedBy = [error ? errorId : null, helpId, statusId].filter(Boolean).join(" ");

  return (
    <div className="ag-field query-field" role="group" aria-labelledby={`${auto}-label`}>
      <span id={`${auto}-label`} className="ag-field-label">
        {label}
      </span>
      <div className={["query-airports", error ? "query-airports-invalid" : null].filter(Boolean).join(" ")}>
        {codes.length > 0 ? (
          <div className="ag-chip-row">
            {codes.map((code) => {
              const name = placeName(code, lang, undefined, "airport");
              return (
                <button
                  key={code}
                  ref={(el) => {
                    if (el) chips.current.set(code, el);
                    else chips.current.delete(code);
                  }}
                  type="button"
                  className="ag-chip query-airport-chip"
                  aria-label={EDITOR.removeAirport(code, name)}
                  onClick={() => remove(code)}
                >
                  <span className="ag-chip-face">
                    <span>
                      <strong>{code}</strong> {name === code ? null : name}
                    </span>
                    <Icon name="close" size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <label className="sr-only" htmlFor={id}>
          {`${label}: ${EDITOR.addAirport}`}
        </label>
        <input
          id={id}
          className="ag-input query-airport-input"
          placeholder={EDITOR.addAirport}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && offers[active] ? `${auto}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={text}
          onChange={(e) => {
            onTextChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
      </div>
      <ul id={listId} role="listbox" aria-label={label} className="query-options" hidden={!showList}>
        {showList
          ? offers.map((offer, i) => (
              <li
                key={offer.key}
                id={`${auto}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className="query-option"
                // mousedown, so the input's blur does not close the list before the choice lands
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(offer);
                }}
              >
                <span className="query-option-text">
                  <span className="query-option-title">{offer.title}</span>
                  {offer.detail ? <span className="query-option-detail">{offer.detail}</span> : null}
                </span>
                <span className="query-option-code">{offer.code}</span>
              </li>
            ))
          : null}
      </ul>
      {/* Always mounted, so a "no match" is announced when it appears. */}
      <p id={statusId} role="status" className={typing && offers.length === 0 ? "query-option-empty" : "sr-only"}>
        {typing && offers.length === 0 ? EDITOR.noPlaceMatch : ""}
      </p>
      {error ? (
        <p id={errorId} className="ag-field-error">
          {error}
        </p>
      ) : null}
      <p id={helpId} className="ag-field-help">
        {EDITOR.addAirportHelp}
      </p>
    </div>
  );
}
