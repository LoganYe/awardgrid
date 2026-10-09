"use client";

import { useT } from "@awardgrid/core/i18n/client";
import { cn } from "@/lib/utils";

/** seats.aero's own site: where the attribution links. */
export const SEATS_AERO_HOME = "https://seats.aero";

/**
 * "Data: seats.aero", with the name linking to seats.aero, beside every place that shows seats.aero's results: the
 * grid, the workspace, an option's details, a standing query's changes and Ask's answers. The footer carries the same
 * words on every page; this line keeps them next to the data itself, as seats.aero asks of an OAuth client.
 */
export function SeatsAttribution({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn("t-meta text-fg-muted", className)} data-testid="seats-attribution">
      {t("attribution.data_prefix")}
      <a href={SEATS_AERO_HOME} target="_blank" rel="noopener noreferrer" className="link">
        seats.aero
      </a>
    </p>
  );
}
