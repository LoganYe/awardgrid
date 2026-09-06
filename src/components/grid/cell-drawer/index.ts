/** The cell drawer (spec §3.5): the panel, its program rows, flight rows and action block. */
export { CellDrawer, formatDrawerDate, sortByMiles, type CellDrawerProps } from "@/components/grid/cell-drawer/cell-drawer";
export { ProgramRow, type ProgramRowProps } from "@/components/grid/cell-drawer/program-row";
export { FlightsList, localDate, localTime, type FlightsListProps, type FlightsState } from "@/components/grid/cell-drawer/flights-list";
export { CellActions, type CellActionsProps } from "@/components/grid/cell-drawer/actions";
export { buildCopyDetails, copyText, drawerFees, FEES_PENDING, type CopyDetailsInput } from "@/components/grid/cell-drawer/copy-details";
