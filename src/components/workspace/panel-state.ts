/**
 * The workspace's one side panel (UI/UX v1 T19; docs/04 S10; acceptance A31): none, the assistant, or one option's
 * details. One slot, so the two can never be open together; opening either replaces the other in the same render.
 *
 * The option last opened stays "selected" when the assistant takes the slot, so a question can carry it. Both belong to
 * the snapshot they were opened on: a new snapshot closes an open detail and clears the selection, as iOS does (T10).
 * Nothing here persists.
 */
export interface OptionRef {
  snapshotId: string;
  rowKey: string;
}

export type PanelState =
  | { kind: "none"; selected: OptionRef | null }
  | { kind: "assistant"; selected: OptionRef | null }
  | { kind: "detail"; selected: OptionRef; option: OptionRef };

export type PanelAction = { type: "assistant" } | { type: "detail"; option: OptionRef } | { type: "close" } | { type: "snapshot"; snapshotId: string | null };

export const NO_PANEL: PanelState = { kind: "none", selected: null };

const sameRef = (a: OptionRef | null, b: OptionRef | null) => a !== null && b !== null && a.snapshotId === b.snapshotId && a.rowKey === b.rowKey;

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "assistant":
      return state.kind === "assistant" ? state : { kind: "assistant", selected: state.selected };
    case "detail":
      if (state.kind === "detail" && sameRef(state.option, action.option)) return state;
      return { kind: "detail", selected: action.option, option: action.option };
    case "close":
      return state.kind === "none" ? state : { kind: "none", selected: state.selected };
    case "snapshot": {
      const keep = (ref: OptionRef | null) => (ref !== null && ref.snapshotId === action.snapshotId ? ref : null);
      if (state.kind === "detail") {
        if (keep(state.option)) return state;
        return { kind: "none", selected: null };
      }
      const selected = keep(state.selected);
      return selected === state.selected ? state : { ...state, selected };
    }
  }
}
