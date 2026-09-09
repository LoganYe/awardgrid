"use client";

/**
 * Loading skeleton in the grid's REAL shape (spec §3.7): rows are the dates from the Dates
 * chip, columns are the route pairs from the Origins × Destinations chips. It renders the same
 * GridTable component in `loading` mode, so row height, column width, sticky headers and cell
 * line positions are literally the ones the results land in — nothing jumps when they arrive.
 * The shimmer is a single pass and becomes static under prefers-reduced-motion (grid-styles.css).
 */
import { useMemo } from "react";
import type { CellLayout, Orientation } from "@awardgrid/core/grid/types";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { GridTable, skeletonGridFor } from "@/components/grid/grid-table";

export interface GridSkeletonProps {
  query: QueryObject;
  orientation: Orientation;
  now: number;
  /** Forwarded so the skeleton's rows are the height the results land at (spec §3.7). */
  layout?: CellLayout;
}

export function GridSkeleton({ query, orientation, now, layout }: GridSkeletonProps) {
  const grid = useMemo(
    () => (query.origins.length > 0 && query.destinations.length > 0 ? skeletonGridFor(query, orientation, now) : null),
    [query, orientation, now],
  );
  if (!grid) return null;
  return <GridTable grid={grid} now={now} selected={null} onSelect={() => undefined} layout={layout} loading />;
}
