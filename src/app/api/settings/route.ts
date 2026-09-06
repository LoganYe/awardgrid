/**
 * PUT /api/settings { locale?, timezone?, quietHoursStart?, quietHoursEnd?, theme? }
 *   → 200 { settings: { locale, timezone, quietHoursStart, quietHoursEnd, theme } }
 *   → 400 { error: "invalid_body" | "invalid_locale" | "invalid_timezone" | "invalid_quiet_hours" | "invalid_theme" }
 *   → 401 { error: "unauthorized" }
 * When `locale` changes the `ag_locale` cookie is set too, so the server layout re-renders in
 * the new language on the next request. Quiet hours: both or neither (one side alone is
 * rejected), `null` clears. `theme` ("system" | "light" | "dark", Phase 6.1) is persisted on the
 * user so a new device starts from it; the `ag_theme` cookie (written by the toggle) wins on the
 * current device, so this handler does not touch cookies for it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SettingsValidationError, THEMES, updateUserSettings } from "@/lib/auth";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES } from "@/lib/i18n";
import { getServerDb } from "@/lib/server/db";
import { hasJsonContentType, jsonError } from "@/lib/server/http";
import { userFromRequest } from "../keys/session";

export const runtime = "nodejs";

export type SettingsErrorCode = "invalid_locale" | "invalid_timezone" | "invalid_quiet_hours" | "invalid_theme";

export interface SettingsResponse {
  settings: {
    locale: string;
    timezone: string;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    theme: "system" | "light" | "dark";
  };
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const PutBody = z
  .object({
    locale: z.enum(LOCALES).optional(),
    timezone: z.string().min(1).max(64).optional(),
    quietHoursStart: HHMM.nullable().optional(),
    quietHoursEnd: HHMM.nullable().optional(),
    theme: z.enum(THEMES).optional(),
  })
  .strict();

function settingsError(error: SettingsErrorCode): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");

  if (!hasJsonContentType(request)) return jsonError(400, "invalid_body");
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid_body");
  }
  const parsed = PutBody.safeParse(raw);
  if (!parsed.success) {
    // Distinguish malformed quiet-hour strings from an unknown/malformed body shape.
    const paths = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")));
    if (paths.has("quietHoursStart") || paths.has("quietHoursEnd")) return settingsError("invalid_quiet_hours");
    if (paths.has("locale")) return settingsError("invalid_locale");
    if (paths.has("timezone")) return settingsError("invalid_timezone");
    if (paths.has("theme")) return settingsError("invalid_theme");
    return jsonError(400, "invalid_body");
  }
  const patch = parsed.data;

  // Quiet hours are a pair: after this update both must be set or both null.
  const nextStart = patch.quietHoursStart === undefined ? user.quietHoursStart : patch.quietHoursStart;
  const nextEnd = patch.quietHoursEnd === undefined ? user.quietHoursEnd : patch.quietHoursEnd;
  if ((nextStart === null) !== (nextEnd === null)) return settingsError("invalid_quiet_hours");

  let updated;
  try {
    updated = updateUserSettings(db, user.id, patch);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      if (err.field === "locale") return settingsError("invalid_locale");
      if (err.field === "timezone") return settingsError("invalid_timezone");
      return settingsError("invalid_quiet_hours");
    }
    throw err;
  }

  const body: SettingsResponse = {
    settings: {
      locale: updated.locale,
      timezone: updated.timezone,
      quietHoursStart: updated.quietHoursStart,
      quietHoursEnd: updated.quietHoursEnd,
      theme: updated.theme,
    },
  };
  const response = NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  if (patch.locale !== undefined) {
    // Same shape as the client-side toggle writes (readable by the layout; not a secret).
    response.cookies.set(LOCALE_COOKIE, patch.locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  return response;
}
