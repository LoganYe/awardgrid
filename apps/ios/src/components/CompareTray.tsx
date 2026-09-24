/**
 * The comparison bar (UI/UX v1 T12; spec §13 "选中比较条仅在有选择时出现"; docs/04 S05): shown on the Search screen
 * only while something is chosen. It says how many of the four are chosen — across searches, since a choice keeps the
 * snapshot it came from — offers "Compare selected options" once there are two, and clears them. A fifth choice is
 * refused where it was made, and the refusal is said here (the approved "You can compare up to 4 options.").
 * Nothing here fetches.
 */
import { copy } from "@awardgrid/core/workspace/present";
import { MAX_COMPARE } from "@awardgrid/core/workspace/selection";
import { useId, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import type { Locale } from "../app/locale";
import { COMPARE } from "../screens/compare-copy";
import { Button } from "./ui";
import "./compare.css";

/** The id focus returns to when the comparison closes. */
export const COMPARE_OPENER = "compare-open";

export function CompareTray({
  count,
  locale,
  notice,
  inert,
  onClear,
}: {
  count: number;
  locale: Locale;
  notice: string | null;
  /** While an option's details or the comparison are open over the results. */
  inert?: boolean;
  onClear: () => void;
}) {
  const c = COMPARE[locale];
  const title = copy("compare.title", locale);
  const noteId = useId();
  // Its height, for the matrix scroller, which is sized to the space left above it (results.css).
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--compare-tray-h", `${el.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--compare-tray-h");
    };
  }, []);
  return (
    <section ref={bar} className="ag-compare-tray" aria-label={c.tray.label} data-testid="compare-tray" inert={inert || undefined}>
      <p className="ag-compare-tray-count tabular">{c.tray.selected(count, MAX_COMPARE)}</p>
      <div className="ag-compare-tray-actions">
        <Button onClick={onClear}>{c.tray.clear}</Button>
        {count >= 2 ? (
          <Link id={COMPARE_OPENER} to="/compare" className="ag-button ag-button-primary">
            {title}
          </Link>
        ) : (
          // Not yet: unavailable but focusable, since focus comes back here from the comparison.
          <span className="ag-button-wrap">
            <Button id={COMPARE_OPENER} variant="primary" aria-disabled="true" aria-describedby={noteId} onClick={() => {}}>
              {title}
            </Button>
            <span id={noteId} className="ag-control-note">
              {c.needTwo}
            </span>
          </span>
        )}
      </div>
      {/* Always mounted and in the accessibility tree (hidden only visually while empty), so a refusal is announced. */}
      <p role="status" className="ag-compare-tray-status">
        {notice ?? ""}
      </p>
    </section>
  );
}
