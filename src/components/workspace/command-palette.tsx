"use client";
/**
 * The command palette (UI/UX v1 T19; docs/04 S10: 560 wide, at most 90vw; search 48; options 44): the workspace's own
 * actions (./commands.ts), found by typing in either language. Opened by Cmd/Ctrl+K or the visible Commands button.
 * A modal dialog: focus stays in it, arrows move through the options, Enter runs one (never mid-composition), Esc or
 * the backdrop closes it and focus returns to what opened it.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@awardgrid/core/i18n/client";
import { filterCommands, type CommandId, type WorkspaceCommand } from "./commands";

export interface CommandPaletteProps {
  open: boolean;
  commands: readonly WorkspaceCommand[];
  onRun: (id: CommandId) => void;
  onClose: () => void;
}

export function CommandPalette({ open, commands, onRun, onClose }: CommandPaletteProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<Palette commands={commands} onRun={onRun} onClose={onClose} />, document.body);
}

function Palette({ commands, onRun, onClose }: Omit<CommandPaletteProps, "open">) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => filterCommands(commands, text), [commands, text]);
  const index = Math.min(active, Math.max(shown.length - 1, 0));
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  useEffect(() => {
    const previous = document.activeElement;
    opener.current = previous instanceof HTMLElement ? previous : null;
    input.current?.focus();
    return () => {
      const back = opener.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // The active option stays in view as the arrows move it (focus stays in the search field) (T19 review LAY-8).
  const activeId = shown.length > 0 ? optionId(index) : null;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const run = (command: WorkspaceCommand | undefined) => {
    if (!command || command.disabled) return;
    onClose();
    // After the dialog has gone and handed focus back, so a command that moves focus (the query) keeps it.
    window.setTimeout(() => onRun(command.id), 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length === 0) return;
      setActive((index + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(shown[index]);
      return;
    }
    // Focus stays in the dialog: the search field is its one stop.
    if (event.key === "Tab") {
      event.preventDefault();
      input.current?.focus();
    }
  };

  return (
    <>
      <div className="ag-ws-palette-scrim ag-ws-tokens" aria-hidden onClick={onClose} />
      <div className="ag-ws-palette ag-ws-tokens" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown} data-testid="command-palette">
        <h2 id={`${id}-title`} className="sr-only">
          {t("workspace.commands")}
        </h2>
        <input
          ref={input}
          className="ag-ws-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId ?? undefined}
          aria-label={t("workspace.palette_search")}
          placeholder={t("workspace.palette_search")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <ul id={listId} role="listbox" className="ag-ws-palette-list" aria-label={t("workspace.commands")}>
          {shown.map((command, i) => (
            <li
              key={command.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === index}
              aria-disabled={command.disabled || undefined}
              className="ag-ws-palette-option"
              data-command={command.id}
              onMouseMove={() => setActive(i)}
              onClick={() => run(command)}
            >
              <span>{command.label}</span>
              {command.disabled ? <span className="ag-ws-palette-unavailable">{t("workspace.palette_unavailable")}</span> : null}
              {command.hint ? (
                <kbd className="ag-ws-kbd" aria-hidden>
                  {command.hint}
                </kbd>
              ) : null}
            </li>
          ))}
        </ul>
        {shown.length === 0 ? (
          <p className="ag-ws-palette-empty" role="status">
            {t("workspace.palette_empty")}
          </p>
        ) : null}
        <p className="ag-ws-palette-note">{t("workspace.palette_note")}</p>
      </div>
    </>
  );
}
