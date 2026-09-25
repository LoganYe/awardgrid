/**
 * The shell's icons: 20 pt line glyphs drawn in currentColor, so they take the control's text colour in both
 * themes. Decorative by default (aria-hidden); the control that holds one carries the accessible name. Hand-drawn
 * rather than a new dependency (docs/uiux-v1 D13: no new packages for what a few paths do).
 */
import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "bell"
  | "bookmark"
  | "gear"
  | "sparkle"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "close"
  | "check"
  | "more"
  | "external"
  | "info"
  | "warning"
  | "alert"
  | "plus"
  | "filter"
  | "grid"
  | "arrow-up";

const PATHS: Record<IconName, string> = {
  search: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm4.1 9.6 3.9 3.9",
  bell: "M10 3a4.5 4.5 0 0 0-4.5 4.5v2.7L4 13h12l-1.5-2.8V7.5A4.5 4.5 0 0 0 10 3Zm-1.8 12.5a1.9 1.9 0 0 0 3.6 0",
  bookmark: "M6 3h8v14l-4-3-4 3V3Z",
  gear: "M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0-4.5v2m0 11v2m7.5-7.5h-2m-11 0h-2m12.8-5.3-1.4 1.4m-7.8 7.8-1.4 1.4m10.6 0-1.4-1.4M5.1 5.1l-1.4-1.4",
  sparkle: "M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6L10 2.5Z",
  "chevron-down": "m5 7.5 5 5 5-5",
  "chevron-right": "m7.5 5 5 5-5 5",
  "chevron-left": "m12.5 5-5 5 5 5",
  close: "m5 5 10 10M15 5 5 15",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
  more: "M4.5 10h.01M10 10h.01M15.5 10h.01",
  external: "M11 4h5v5m0-5-7 7M8.5 5H4.5v10.5H15V11.5",
  info: "M10 2.75a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5ZM10 9v4.5M10 6.5h.01",
  warning: "M10 3 18 16.5H2L10 3Zm0 5v3.5m0 2.5h.01",
  alert: "M10 2.75a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5ZM7.5 7.5l5 5m0-5-5 5",
  plus: "M10 4v12M4 10h12",
  filter: "M3.5 5.5h13M6 10h8m-5.5 4.5h3",
  grid: "M3.5 3.5h13v13h-13v-13Zm0 4.3h13m-13 4.4h13M7.8 3.5v13m4.4-13v13",
  "arrow-up": "M10 16V4m-5 5 5-5 5 5",
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Drawn size in CSS px; the glyphs are designed on a 20 grid. */
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
