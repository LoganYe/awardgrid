/**
 * The native half of "Connect seats.aero": ios/App/App/SeatsAuthPlugin.swift, registered by AppViewController.
 *
 * `authorize(url)` opens seats.aero's consent page in an ASWebAuthenticationSession (the system's sign-in sheet, which
 * shares Safari's cookies, so a person already signed in to seats.aero is not asked to sign in again) and resolves with
 * the URL the session caught on the app's scheme, com.dowhiz.awardgrid://oauth/seats?…. The plugin refuses any
 * address but https://seats.aero/oauth2/consent. Everything else (the state, the exchange, the Keychain) is TypeScript,
 * where it is tested (./connect.ts).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface SeatsAuthNative {
  authorize(options: { url: string }): Promise<{ url: string }>;
}

export const SeatsAuth = registerPlugin<SeatsAuthNative>("SeatsAuth");

/**
 * What the sign-in sheet ended with: the callback URL, or why there is none. "canceled": the person closed the sheet.
 * "unavailable": no native plugin (a browser, the UI/UX host). "failed": anything else.
 */
export type AuthorizeResult = { ok: true; url: string } | { ok: false; reason: "canceled" | "unavailable" | "failed" };

export interface AuthorizeDeps {
  isAvailable: () => boolean;
  plugin: SeatsAuthNative;
}

const nativeDeps: AuthorizeDeps = { isAvailable: () => Capacitor.isPluginAvailable("SeatsAuth"), plugin: SeatsAuth };

export async function authorizeWithSeats(url: string, deps: AuthorizeDeps = nativeDeps): Promise<AuthorizeResult> {
  if (!deps.isAvailable()) return { ok: false, reason: "unavailable" };
  try {
    const { url: callback } = await deps.plugin.authorize({ url });
    return typeof callback === "string" && callback.length > 0 ? { ok: true, url: callback } : { ok: false, reason: "failed" };
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    return { ok: false, reason: code === "canceled" ? "canceled" : "failed" };
  }
}
