/**
 * The UI/UX Web surface's accounts (plan 04 T18). TEST-ONLY. One per Web scenario, named after it; the fake key
 * "uiux-<scenario>" tells the fixture's seats.aero which scenario to answer.
 */
export const WEB_SCENARIOS = ["complete", "complete-empty", "multi-program", "no-seats-key", "quota-low", "partial", "unmonitored", "web-user-a", "web-user-b"] as const;
export const UIUX_WEB_PASSWORD = "uiux-password-1";
export const webKeyFor = (scenario: string) => `uiux-${scenario}`;
