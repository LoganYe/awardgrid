import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Plain <select> styled like the Input primitive. Used for long option lists (400+ IANA
 * zones) where the native picker is lighter and better on mobile than a custom popover.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
