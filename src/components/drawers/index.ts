/** The shared drawer shell, its state slot and the cell → standing-query prefill (spec §3.5, §3.6, §6). */
export { DrawerShell, type DrawerShellProps } from "@/components/drawers/drawer-shell";
export { BottomSheetHandle, type BottomSheetHandleProps } from "@/components/drawers/bottom-sheet";
export { BOTTOM_SHEET_DISMISS_PX, DRAG_SLOP_PX, dragOffset, dragOutcome, isDrag, type DragOutcome, type DragSample } from "@/components/drawers/drag";
export {
  CLOSED_DRAWER_STATE,
  cellKeyOf,
  drawerMode,
  drawerReducer,
  isAskOpen,
  isModalMode,
  openCellKey,
  parseCellKey,
  selectedCellKey,
  useDrawerState,
  type CellAddress,
  type DrawerAction,
  type DrawerMode,
  type DrawerOpen,
  type DrawerState,
  type MobilePresentation,
  type UseDrawerState,
} from "@/components/drawers/use-drawer-state";
export { PREFILL_WINDOW_DAYS, prefillFromCell, prefillNameFromCell, type PrefillCell, type QueryPrefill } from "@/components/drawers/prefill";
