import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The content column for Queries, Settings, Legal and other reading pages (spec §2): at most
 * 880 px, left-aligned inside the 16 px page gutters. The grid page does not use it (full-bleed).
 * Server- and client-safe.
 */
export function PageColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex w-full max-w-content flex-col gap-6", className)}>{children}</div>;
}
