import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One settings section (spec §5, docs/UI_PLAN.md §6.8): a 16/24 heading and space, nothing else.
 * No card, no border, no shadow — the heading and the 24 px gap between sections are what
 * separate them. Server-safe (no hooks); `data-settings-section` is what e2e/settings.spec.ts
 * measures the (absent) border on.
 */
export function SettingsSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      aria-labelledby={`${id}-heading`}
      className={cn("flex scroll-mt-topbar flex-col gap-2", className)}
    >
      <h2 id={`${id}-heading`} className="t-section">
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A one-line inline notice under a control: an error in `--error`, a confirmation in `--fg`. */
export function SettingsNotice({ kind, children, id }: { kind: "ok" | "error"; children: ReactNode; id?: string }) {
  return (
    <p
      id={id}
      role={kind === "error" ? "alert" : "status"}
      data-notice={kind}
      className={cn("t-meta", kind === "error" ? "text-error" : "text-fg")}
    >
      {children}
    </p>
  );
}
