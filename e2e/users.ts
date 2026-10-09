/**
 * The e2e users, shared by scripts/seed-e2e.ts (which creates them) and e2e/fixtures.ts (which
 * logs them in). Dependency-free on purpose: Playwright loads this file with its own loader,
 * so nothing here may pull in Next.js or the database.
 *
 * Every password is fake, and every seats.aero connection is a pair of fake tokens whose value selects a scenario on
 * the DEMO=1 mock (scripts/mock-seatsaero.ts DEMO_KEYS, SEEDED_TOKEN_PREFIX); none of them works anywhere else.
 */

export const E2E_PASSWORD = "demo-password-1";

/**
 * The seeded connection's access token is this prefix and the scenario value ("seats:ota:seeded-demo-key-normal"),
 * its refresh token the same with "seats:otr:". Mirrors scripts/mock-seatsaero.ts SEEDED_TOKEN_PREFIX, which accepts
 * these without having issued them (kept literal so this file stays import-free).
 */
export const SEEDED_ACCESS_PREFIX = "seats:ota:seeded-";
export const SEEDED_REFRESH_PREFIX = "seats:otr:seeded-";

export type E2eUsername =
  | "demo"
  | "linked"
  | "nokey"
  | "connect"
  | "rekey"
  | "empty"
  | "slow"
  | "slow2"
  | "slow3"
  | "slow4"
  | "slow5"
  | "slow6"
  | "slow7"
  | "slow8"
  | "partial"
  | "quota"
  | "mixed";

/**
 * One slow user per Playwright project (desktop-light, desktop-dark, mobile-light, mobile-dark):
 * a single app process and one cache serve every project, so a second project's search would be
 * answered from the first one's cache and never show the loading state.
 *
 * The availability cache is keyed by user, so every test that needs the loading state needs its
 * own set: grid.spec.ts (the 6.2 skeleton) takes the first four, chips.spec.ts (the 6.3 skeleton
 * in the chips' shape) the second four. Sharing one set would let whichever spec runs first warm
 * the cache and leave the other with an instant answer.
 */
export const E2E_SLOW_USERS: readonly E2eUsername[] = ["slow", "slow2", "slow3", "slow4"];
export const E2E_CHIP_SLOW_USERS: readonly E2eUsername[] = ["slow5", "slow6", "slow7", "slow8"];

export interface E2eUserSpec {
  username: E2eUsername;
  /**
   * The DEMO_KEYS scenario the account's seeded seats.aero connection selects (its tokens are SEEDED_ACCESS_PREFIX /
   * SEEDED_REFRESH_PREFIX + this value), or null for "not connected".
   */
  seatsScenario: string | null;
  /** api_usage.calls for today (seats_aero); defaults to 0. */
  quotaCalls?: number;
  /** Seed one standing query with a recorded run. */
  savedQuery?: boolean;
  /**
   * Fake Telegram chat id, so the Settings page renders its "linked" state (e2e/settings.spec.ts).
   * Nothing is ever sent: the app runs with an empty TELEGRAM_BOT_TOKEN, so the transport is the
   * mock one.
   */
  telegramChatId?: string;
  /** The account's pasted seats.aero key was removed by migration 0005: Settings and the grid say so once. */
  reconnectNotice?: boolean;
  /** Quiet hours to seed on the account, as "HH:MM" (both or neither). */
  quietHours?: { start: string; end: string; timezone: string };
}

/** Calls recorded for the "quota" user today: the default soft limit, so the next search is refused. */
export const E2E_QUOTA_CALLS = 950;
export const E2E_SAVED_QUERY_NAME = "Asia to Seattle, business and first";

/** Mirrors DEMO_KEYS in scripts/mock-seatsaero.ts (kept literal so this file stays import-free). */
export const E2E_USERS: readonly E2eUserSpec[] = [
  { username: "demo", seatsScenario: "demo-key-normal", savedQuery: true },
  // Telegram already linked, with quiet hours set: the second Settings state (§5.2).
  {
    username: "linked",
    seatsScenario: "demo-key-normal",
    telegramChatId: "5550000001",
    quietHours: { start: "22:00", end: "07:00", timezone: "Asia/Shanghai" },
  },
  { username: "nokey", seatsScenario: null },
  // Connects and disconnects through the mock's consent page and token service (e2e/settings.spec.ts).
  { username: "connect", seatsScenario: null },
  // Had a pasted seats.aero key that the move to Login with Seats.aero removed: the one-time notice.
  { username: "rekey", seatsScenario: null, reconnectNotice: true },
  { username: "empty", seatsScenario: "demo-key-empty" },
  { username: "slow", seatsScenario: "demo-key-slow" },
  { username: "slow2", seatsScenario: "demo-key-slow" },
  { username: "slow3", seatsScenario: "demo-key-slow" },
  { username: "slow4", seatsScenario: "demo-key-slow" },
  { username: "slow5", seatsScenario: "demo-key-slow" },
  { username: "slow6", seatsScenario: "demo-key-slow" },
  { username: "slow7", seatsScenario: "demo-key-slow" },
  { username: "slow8", seatsScenario: "demo-key-slow" },
  { username: "partial", seatsScenario: "demo-key-partial" },
  // The Mixed cabin chip (issue #18) runs the query twice, at two different min_cabin_pct
  // scopes. On `demo` those two extra calls moved the quota readout in every published capture
  // taken after them, so the one test that spends them has an account nobody photographs.
  { username: "mixed", seatsScenario: "demo-key-normal" },
  { username: "quota", seatsScenario: "demo-key-normal", quotaCalls: E2E_QUOTA_CALLS },
];
