/**
 * The workspace's keyboard shortcuts (UI/UX v1 T19; spec §17; acceptance A32), decided apart from React so every rule
 * is tested:
 *
 *   /                 focus the query — only when nothing is being typed, and never mid-composition (IME)
 *   Cmd/Ctrl+K        the command palette (the platform's own modifier only)
 *   Cmd/Ctrl+Enter    run the query being edited — only from inside the query (the caller checks where focus is)
 *
 * Every one has a visible alternative (the query fields themselves, the Commands button, Find), and all of them can be
 * turned off. Esc (close the top-most layer) and the arrows inside the matrix are the widgets' own keys, not shortcuts,
 * so they stay. Nothing here captures a browser or assistive-technology key with Alt, or a plain letter.
 */
export type WorkspaceShortcut = "focus_query" | "palette" | "submit";

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** KeyboardEvent.isComposing: a key that is part of an IME composition. */
  isComposing: boolean;
  /** 229: the key an IME reports while it owns the keyboard (Safari sends it without isComposing). */
  keyCode?: number;
  target: EventTarget | null;
}

const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

/** Whether a key pressed at `target` is typing: a text field, a select, anything editable, or a text-entry role. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUTS.has(((el as HTMLInputElement).type ?? "").toLowerCase());
  if (el.isContentEditable || el.closest("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']")) return true;
  const role = el.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/**
 * The shortcut this key press asks for, or null. `enabled` is the person's setting; `mac` picks the platform's own
 * modifier: Cmd on a Mac, where Control+K is the text fields' "delete to the end of the line" and stays theirs; Ctrl
 * elsewhere (T19 review LAY-7).
 */
export function shortcutFor(e: KeyInput, enabled: boolean, mac: boolean): WorkspaceShortcut | null {
  if (!enabled) return null;
  if (e.isComposing || e.keyCode === 229) return null;
  const chord = !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
  if (chord && !e.shiftKey && e.key.toLowerCase() === "k") return "palette";
  if (chord && e.key === "Enter") return "submit";
  if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) return "focus_query";
  return null;
}

/** The chord as this platform writes it, for the visible hints. */
export function chordLabel(key: string, mac: boolean): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}
