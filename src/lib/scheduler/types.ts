/**
 * Shared types for the standing-query scheduler (kickoff §6, §9 Phase 3).
 *
 * The scheduler never talks to Telegram itself: it receives a `Transport` (src/lib/notify
 * satisfies it; tests pass a recorder) and a `DigestFormatter` (src/lib/notify/format.ts's
 * `formatDigest`; a plain fallback lives in ./digest.ts). Nothing here carries a key, a chat id
 * or a username except the `chatId` argument of `Transport.sendMessage`, which is passed
 * straight through and never logged.
 */
import type { SavedQuery } from "@/lib/db/schema";
import type { Locale } from "@awardgrid/core/i18n";
import type { SendResult } from "@/lib/notify/transport";

// ---------------------------------------------------------------------------
// Snapshot + diff
// ---------------------------------------------------------------------------

/*
 * The four snapshot/diff types moved to packages/core in Phase 4 so every shell can reach the
 * diff logic (docs/PIVOT.md §3). They are re-exported here so nothing in the web app that already
 * imports them from this module had to change.
 */
import type { CellSnapshot, DiffOptions, PriceDrop, SnapshotDiff } from "@awardgrid/core/watch/types";

export type { CellSnapshot, DiffOptions, PriceDrop, SnapshotDiff };

// ---------------------------------------------------------------------------
// Transport + formatter contracts (satisfied by src/lib/notify)
// ---------------------------------------------------------------------------

/**
 * Minimal delivery channel. `text` is Telegram-flavoured HTML (parse_mode HTML). The result is
 * src/lib/notify's SendResult: the production transports NEVER throw — a blocked bot (403), a
 * rate limit (429), an outage (5xx) or a rejected message (400) all come back as
 * `{ ok: false, reason }` — so the scheduler must inspect it, not just await it.
 */
export interface Transport {
  sendMessage(chatId: string, text: string): Promise<SendResult>;
}

export interface DigestInput {
  savedQuery: SavedQuery;
  diff: SnapshotDiff;
  locale: Locale;
  /** Absolute URL of the grid for this saved query (`<appUrl>/grid?q=...`). */
  gridUrl: string;
  /** The run's clock reading; formatters use it for "(2h ago)" ages. */
  now: Date;
}

/** `formatDigest({ savedQuery, diff, locale, gridUrl, now }) → HTML string` (see ./notify-digest.ts). */
export type DigestFormatter = (input: DigestInput) => string;

// ---------------------------------------------------------------------------
// Run results
// ---------------------------------------------------------------------------

/**
 * `query_runs.skipped_reason` values.
 *   first_run       nothing to diff against yet — the snapshot becomes the baseline
 *   baseline_expired  the last baseline is older than 24 hours, or was purged (Disconnect, a revoked grant): its
 *                   seats.aero cells are gone (src/lib/seats-oauth/retention.ts), so nothing is compared or sent
 *                   and this run's snapshot becomes the new baseline
 *   invalid_query   query_json no longer parses as a QueryObject
 *   no_key          the owner has no seats.aero account connected (kickoff §5: no fallback access)
 *   quota           the owner's daily quota headroom is exhausted (kickoff §6)
 *   upstream_error  seats.aero HTTP / network / schema error
 *   no_telegram     there is something to send but the owner has not linked a chat
 *   quiet_hours     there is something to send but the owner is in quiet hours (sent later)
 *   send_failed     the transport threw or returned `{ ok: false }`; retried on the next run
 *   in_progress     another process (web "run now" vs worker tick) claimed this query within
 *                   RUN_CLAIM_WINDOW_MS; nothing was fetched and NO query_runs row is written
 *   error           anything unexpected (name only, never a message with secrets)
 * `null` means the run completed and there was nothing to notify about.
 */
export type SkippedReason =
  | "first_run"
  | "baseline_expired"
  | "invalid_query"
  | "no_key"
  | "quota"
  | "upstream_error"
  | "no_telegram"
  | "quiet_hours"
  | "send_failed"
  | "in_progress"
  | "error";

/** Reasons that mean no snapshot was taken (excluded from baseline selection). */
export const FETCH_FAILURE_REASONS: ReadonlySet<SkippedReason> = new Set<SkippedReason>([
  "invalid_query",
  "no_key",
  "quota",
  "upstream_error",
  "in_progress",
  "error",
]);

/**
 * Reasons that mean a notification is still PENDING: the run's changes were not delivered, so
 * it must not become the baseline — the next successful run diffs against the older baseline
 * and sends the accumulated changes.
 */
export const PENDING_REASONS: ReadonlySet<SkippedReason> = new Set<SkippedReason>(["quiet_hours", "send_failed"]);

export type RunErrorCode = "invalid_query" | "no_key" | "quota" | "upstream_error" | "send_failed" | "in_progress" | "internal";

export interface RunError {
  code: RunErrorCode;
  /** Non-secret classifier: an error class name or a seats.aero HTTP kind. Never a message. */
  detail: string;
}

export interface DiffCounts {
  new: number;
  dropped: number;
  price_drops: number;
  unchanged: number;
}

export interface QueryRunResult {
  savedQueryId: string;
  userId: string;
  /** The query_runs row id; null only for `in_progress` (no row is written for a refused claim). */
  runId: string | null;
  ranAt: string;
  notified: boolean;
  skippedReason: SkippedReason | null;
  /** Cells in the snapshot taken by this run (0 when the fetch failed). */
  cells: number;
  /** Diff counts against the baseline, or null when there was no baseline / no snapshot. */
  diff: DiffCounts | null;
  apiCallsUsed: number;
  servedFromCache: boolean;
  error: RunError | null;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type SchedulerLogFields = Record<string, string | number | boolean | null>;

export interface RunDeps {
  /** Clock; inject in tests. */
  now?: () => Date;
  /** seats.aero transport; inject a fake in tests. */
  fetch?: typeof fetch;
  /** Message delivery (src/lib/notify's Telegram or mock transport). */
  transport: Transport;
  /** Public origin of the web app, e.g. "https://awardgrid.example"; used for the grid link. */
  appUrl: string;
  /** MASTER_KEY override for tests; production reads process.env.MASTER_KEY. */
  masterKey?: Buffer;
  /** Cache TTL override (minutes). */
  ttlMinutes?: number;
  /** Digest formatter; defaults to the plain fallback in ./digest.ts. Wire src/lib/notify's formatDigest here. */
  format?: DigestFormatter;
  /** Structured log sink. Fields never include keys, chat ids or usernames. */
  log?: (event: string, fields: SchedulerLogFields) => void;
}
