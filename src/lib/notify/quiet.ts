/**
 * Quiet hours (kickoff §6 "respect quiet hours"). Both bounds are "HH:MM" wall-clock times in
 * the user's IANA zone (users.timezone). Semantics:
 *   - either bound missing/invalid, or start === end → quiet hours off
 *   - start < end  → quiet when start <= local < end          (e.g. 13:00–15:00)
 *   - start > end  → quiet when local >= start OR local < end (crosses midnight, 22:00–07:00)
 * An unknown zone falls back to UTC and sets `timezoneInvalid` so the caller can surface it.
 */

export interface QuietHoursConfig {
  quietHoursStart: string | null | undefined;
  quietHoursEnd: string | null | undefined;
  timezone: string | null | undefined;
}

export interface QuietHoursEvaluation {
  quiet: boolean;
  /** Minutes since local midnight in the resolved zone. */
  localMinutes: number;
  /** Zone actually used ("UTC" when the configured zone was invalid or missing). */
  timezone: string;
  /** True when the configured zone was not a valid IANA name and UTC was used instead. */
  timezoneInvalid: boolean;
  /** True when the config enables quiet hours at all. */
  enabled: boolean;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "22:30" → 1350; null for anything else. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = HHMM.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes since midnight of `now` in `zone` (assumed valid). */
export function localMinutesInZone(now: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }
  return hour * 60 + minute;
}

export function evaluateQuietHours(config: QuietHoursConfig, now: string | number | Date): QuietHoursEvaluation {
  const timezoneInvalid = !!config.timezone && !isValidTimeZone(config.timezone);
  const timezone = !timezoneInvalid && config.timezone ? config.timezone : "UTC";
  const date = now instanceof Date ? now : new Date(now);
  const localMinutes = Number.isNaN(date.getTime()) ? 0 : localMinutesInZone(date, timezone);

  const start = parseHHMM(config.quietHoursStart);
  const end = parseHHMM(config.quietHoursEnd);
  const enabled = start !== null && end !== null && start !== end;
  let quiet = false;
  if (enabled && start !== null && end !== null) {
    quiet = start < end ? localMinutes >= start && localMinutes < end : localMinutes >= start || localMinutes < end;
  }
  return { quiet, localMinutes, timezone, timezoneInvalid, enabled };
}

/** True when a notification should be held back right now. */
export function inQuietHours(config: QuietHoursConfig, now: string | number | Date): boolean {
  return evaluateQuietHours(config, now).quiet;
}
