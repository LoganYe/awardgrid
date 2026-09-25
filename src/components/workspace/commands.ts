/**
 * The command palette's list (UI/UX v1 T19; docs/04 S10): the workspace's own actions only — focus the query, run it,
 * change the view, open or close a panel, go to another page, turn shortcuts on or off. Nothing runs a shell command,
 * nothing opens an address that was typed, and a search runs only through the same Find the query bar uses.
 */
export type CommandId =
  | "focus_query"
  | "run_query"
  | "view_list"
  | "view_calendar"
  | "view_matrix"
  | "open_assistant"
  | "close_panel"
  | "go_saved"
  | "go_queries"
  | "go_settings"
  | "toggle_shortcuts";

export interface WorkspaceCommand {
  id: CommandId;
  label: string;
  /** The shortcut or key that does the same, shown beside it. */
  hint?: string;
  /** Other words it answers to (the other language's name, a synonym). */
  keywords?: readonly string[];
  disabled?: boolean;
}

const normalise = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** The commands whose label or keywords contain every word typed, in the list's own order; all of them for no text. */
export function filterCommands(commands: readonly WorkspaceCommand[], text: string): WorkspaceCommand[] {
  const words = normalise(text).split(" ").filter(Boolean);
  if (words.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = normalise([command.label, ...(command.keywords ?? [])].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}
