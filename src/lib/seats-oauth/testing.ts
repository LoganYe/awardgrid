/**
 * TEST-ONLY: give an account a seats.aero connection without the sign-in, as the e2e and dev seeds do
 * (scripts/seed-e2e.ts). The tokens are obviously fake; nothing here reaches the network.
 */
import type { DbConn } from "@/lib/auth/clock";
import { bearer } from "./access";
import { saveConnection } from "./store";

/** A seeded token's default life: long enough that no test asks the token service unless it means to. */
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

export interface TestConnection {
  access: string;
  refresh: string;
  /** "Bearer seats:ota:…": what seats.aero receives as Partner-Authorization. */
  authorization: string;
}

export function connectForTests(
  db: DbConn,
  userId: string,
  opts: { masterKey: Buffer; label?: string; access?: string; refresh?: string; expiresIn?: number; now?: Date },
): TestConnection {
  const label = opts.label ?? userId;
  const access = opts.access ?? `seats:ota:test-${label}`;
  const refresh = opts.refresh ?? `seats:otr:test-${label}`;
  saveConnection(db, userId, { access, refresh, expiresIn: opts.expiresIn ?? THIRTY_DAYS_S }, { masterKey: opts.masterKey, ...(opts.now ? { now: opts.now } : {}) });
  return { access, refresh, authorization: bearer(access) };
}
