/**
 * The e2e users, shared by scripts/seed-e2e.ts (which creates them) and e2e/fixtures.ts (which
 * logs them in). Dependency-free on purpose: Playwright loads this file with its own loader,
 * so nothing here may pull in Next.js or the database.
 *
 * Every password is fake and every seats.aero key is a scenario selector for the DEMO=1 mock
 * (scripts/mock-seatsaero.ts DEMO_KEYS); none of them works anywhere else.
 */

export const E2E_PASSWORD = "demo-password-1";

export type E2eUsername = "demo" | "nokey" | "empty" | "slow" | "slow2" | "slow3" | "slow4" | "partial" | "quota";

/**
 * One slow user per Playwright project (desktop-light, desktop-dark, mobile-light, mobile-dark):
 * a single app process and one cache serve every project, so a second project's search would be
 * answered from the first one's cache and never show the loading state.
 */
export const E2E_SLOW_USERS: readonly E2eUsername[] = ["slow", "slow2", "slow3", "slow4"];

export interface E2eUserSpec {
  username: E2eUsername;
  /** Fake seats.aero key (a DEMO_KEYS scenario value) or null for "no key on file". */
  seatsAeroKey: string | null;
  /** api_usage.calls for today (seats_aero); defaults to 0. */
  quotaCalls?: number;
  /** Seed one standing query with a recorded run. */
  savedQuery?: boolean;
}

/** Calls recorded for the "quota" user today: the default soft limit, so the next search is refused. */
export const E2E_QUOTA_CALLS = 950;
export const E2E_SAVED_QUERY_NAME = "Asia to Seattle, business and first";

/** Mirrors DEMO_KEYS in scripts/mock-seatsaero.ts (kept literal so this file stays import-free). */
export const E2E_USERS: readonly E2eUserSpec[] = [
  { username: "demo", seatsAeroKey: "demo-key-normal", savedQuery: true },
  { username: "nokey", seatsAeroKey: null },
  { username: "empty", seatsAeroKey: "demo-key-empty" },
  { username: "slow", seatsAeroKey: "demo-key-slow" },
  { username: "slow2", seatsAeroKey: "demo-key-slow" },
  { username: "slow3", seatsAeroKey: "demo-key-slow" },
  { username: "slow4", seatsAeroKey: "demo-key-slow" },
  { username: "partial", seatsAeroKey: "demo-key-partial" },
  { username: "quota", seatsAeroKey: "demo-key-normal", quotaCalls: E2E_QUOTA_CALLS },
];
