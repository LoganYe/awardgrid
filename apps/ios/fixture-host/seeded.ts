/**
 * The fixture host's seeded scenarios, on their own with no JSON import, so a Playwright spec (Node's ESM loader,
 * which needs import attributes for JSON) can read the list without loading the host (T21 review REG-1).
 */
/**
 * Scenarios whose defining state this host produces today. Every other id in scenarios.json is refused with the
 * task that adds it, so a test cannot run against a state that is not there. Widen this as tasks land.
 */
export const SEEDED_SCENARIOS: ReadonlySet<string> = new Set([
  "complete",
  "complete-empty",
  "unmonitored",
  "no-seats-key",
  "no-ai-key",
  "quota-low",
  "multi-program",
  "storage-failure",
  "favorite-snapshot",
  "watch-baseline",
  "watch-changes",
  "watch-failure",
  // T16: a question whose answer proposes a wider search, and a proposal left over from before the query changed.
  "ai-pending",
  "ai-stale",
  // T17: a question stopped while its request was out: it may still have completed, and no next step ran.
  "ai-stopped",
  // T18: the Web surface's two isolation accounts (their rows answer the Web's seats.aero stand-in).
  "web-user-a",
  "web-user-b",
  "foundations",
  "inflight-old",
  "failed-old",
  "missing-values",
  "partial",
  "coverage-unknown",
  "legacy-cache",
  // T21: the shell's own translated labels at 200% text (the rows are the base ones; the length is the UI's).
  "long-labels",
]);
