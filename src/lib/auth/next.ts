/**
 * The ONLY auth file that touches next/*. Kept tiny; only `getCurrentUser`'s per-request
 * memoisation is unit-tested (next.test.ts), because that is the one thing here that is not a
 * plain call — everything else it reaches is a plain function with tests in session.ts / users.ts.
 *
 * Next 16: `cookies()` from next/headers is async; `redirect()` throws, so it must not sit
 * inside a try/catch. Cookie mutation is only allowed in Server Functions and Route Handlers.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";
import { cache } from "react";
import { SESSION_COOKIE, cookieOptions, cookieSecureFromEnv, getSessionUser } from "@/lib/auth/session";
import type { User } from "@/lib/auth/users";
import { getDb } from "@/lib/db/client";

/**
 * The signed-in user for the current request, or null. Safe in pages, layouts and handlers.
 *
 * Wrapped in React `cache()`: the root layout (src/app/layout.tsx:34) asks for the user on every
 * request and the page it renders asks again, so unmemoised every hit pays two identical
 * better-sqlite3 session reads — and, when the session expires between them, `getSessionUser`
 * deletes the row on the first read (session.ts:55-58), so the layout and the page could answer
 * differently inside one request. One request, one lookup, one answer.
 *
 * Only React's "react-server" build memoises; the default build's `cache()` is a passthrough, so
 * this is a no-op in a route handler and in vitest. next.test.ts installs the same async
 * dispatcher Next's Flight server installs rather than hand-writing a stand-in for it.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(getDb(), token);
});

/** Like getCurrentUser but redirects to /login when nobody is signed in. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Attach the session cookie to a Route Handler response. */
export function withSessionCookie(response: NextResponse, token: string, expiresAt: Date): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt, { secure: cookieSecureFromEnv() }));
  return response;
}

/** Expire the session cookie on a Route Handler response (call revokeSession separately). */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0), { secure: cookieSecureFromEnv() }), maxAge: 0 });
  return response;
}

/** Server Function variant of withSessionCookie (uses the request cookie store). */
export async function setSessionCookieInAction(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt, { secure: cookieSecureFromEnv() }));
}

/** Server Function variant of clearSessionCookie. */
export async function clearSessionCookieInAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The raw cookie token of the current request (for revokeSession on logout), or null. */
export async function currentSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
