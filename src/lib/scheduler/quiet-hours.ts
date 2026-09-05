/**
 * Quiet hours (kickoff §6 "respect quiet hours"). `users.quiet_hours_start/end` are "HH:MM" in
 * the user's `timezone` (IANA, default UTC). Both must be set for a window to exist; the window
 * may cross midnight ("22:00" → "07:00"). Start == end means no window (not "all day").
 */

export interface QuietHoursUser {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm: string): number | null {
  const m = HHMM_RE.exec(hhmm);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
}

/** Minutes since local midnight for `now` in `zone`; falls back to UTC on an unknown zone. */
export function localMinutes(now: Date, zone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: zone || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const minute = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

export function inQuietHours(user: QuietHoursUser, now: Date): boolean {
  if (!user.quietHoursStart || !user.quietHoursEnd) return false;
  const start = toMinutes(user.quietHoursStart);
  const end = toMinutes(user.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const t = localMinutes(now, user.timezone);
  return start < end ? t >= start && t < end : t >= start || t < end;
}
