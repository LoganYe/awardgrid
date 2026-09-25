/**
 * An inline notice (spec §18): info for neutral facts, warning for partial or older data, danger for what blocks the
 * task, success for a confirmed change. Each carries an icon and words, never colour alone. Not a live region by
 * default: a notice the user returns to must not be read out again; pass `live` only for a state that just changed.
 *
 * A live region announces changes to what it already holds, not the text it was created with (the rule AskScreen and
 * SettingsScreen follow with their always-mounted regions). So a live notice mounts with an empty body and fills it
 * on the next frame, which is what makes VoiceOver read it.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

export type NoticeTone = "info" | "warning" | "danger" | "success";

const ICON: Record<NoticeTone, IconName> = { info: "info", warning: "warning", danger: "alert", success: "check" };

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** Announce it: only for a state change that happened in this session. */
  live?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function Notice({ tone, children, live = false, className, ...rest }: NoticeProps) {
  const role = live ? (tone === "danger" ? "alert" : "status") : undefined;
  const [filled, setFilled] = useState(!live);
  useEffect(() => {
    if (filled) return;
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [filled]);
  return (
    <div role={role} className={["ag-notice", `ag-notice-${tone}`, className].filter(Boolean).join(" ")} data-testid={rest["data-testid"]}>
      <Icon name={ICON[tone]} />
      <div className="ag-notice-body">{filled ? children : null}</div>
    </div>
  );
}
