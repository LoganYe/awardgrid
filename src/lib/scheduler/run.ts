/**
 * One standing-query run (kickoff §6): resolve the grid with the OWNER's own key through the
 * Phase-2 facade, snapshot, diff against the baseline, notify, record.
 *
 * Baseline rule (documented here because quiet hours depend on it):
 *   the baseline is the most recent run whose changes are NOT still pending delivery —
 *   a notified run, a clean run with nothing to send, the first run, or a run skipped for
 *   `no_telegram`. Runs skipped for `quiet_hours` / `send_failed` are stepped over, and runs
 *   that took no snapshot (`no_key`, `quota`, `upstream_error`, `invalid_query`, `error`) are
 *   ignored. So a cell that appears at 02:00 during quiet hours is still "new" at 08:00: the
 *   08:00 run diffs against the pre-quiet baseline and sends the accumulated change.
 *
 * First run: there is nothing to diff against, so it notifies nothing and its snapshot becomes
 * the baseline (`skipped_reason = 'first_run'`).
 *
 * `last_run_at` is updated on EVERY outcome, including fetch failures, so a query with an
 * exhausted quota or a broken key re-tries on its next cron slot, not on every 5-minute tick.
 *
 * Claim: the web process ("run now") and the worker (tick) share the database but nothing
 * else, so a run first CLAIMS the saved query with a conditional update of `last_run_at`
 * (`claimRun`). A second runner that arrives within RUN_CLAIM_WINDOW_MS loses the claim and
 * returns `in_progress` without fetching, diffing, sending or writing a query_runs row — one
 * change, one digest, one baseline.
 *
 * Retention: query_runs is bounded per saved query (RUNS_KEEP_PER_QUERY newest rows, never the
 * current baseline) — see `pruneQueryRuns`.
 *
 * Boundaries: the key is resolved inside findGridForUser and never reaches this file; the chat
 * id goes only into `transport.sendMessage`; results and log fields carry ids and codes only.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { encodeQueryParam } from "@/components/grid/state";
import type { Db } from "@/lib/db/client";
import { queryRuns, savedQueries, users, type SavedQuery, type User } from "@/lib/db/schema";
import { parseLocale } from "@/lib/i18n";
import { NoKeyError } from "@/lib/keys";
import type { SendResult } from "@/lib/notify/transport";
import { QueryObject } from "@/lib/query/schema";
import { SeatsAeroError, SeatsAeroHttpError } from "@/lib/seatsaero/client";
import { QuotaExceededError } from "@/lib/seatsaero/quota";
import { findGridForUser } from "@/lib/server/find";
import { defaultFormatDigest } from "./digest";
import { cellsHash, diffSnapshots, parseSnapshot, serializeSnapshot, snapshot } from "./diff";
import { inQuietHours } from "./quiet-hours";
import {
  FETCH_FAILURE_REASONS,
  PENDING_REASONS,
  type CellSnapshot,
  type DiffCounts,
  type QueryRunResult,
  type RunDeps,
  type RunError,
  type SkippedReason,
  type SnapshotDiff,
} from "./types";

/**
 * Two runners of the same saved query closer together than this are treated as concurrent:
 * the second one loses the claim (see the header). Scheduled runs are at least an hour apart
 * (validateCron floor) and a "run now" inside the window would only re-read the cache anyway.
 */
export const RUN_CLAIM_WINDOW_MS = 60_000;

/** Newest query_runs rows kept per saved query (the baseline is always kept on top of these). */
export const RUNS_KEEP_PER_QUERY = 200;

/** Reasons a run row may NOT serve as the diff baseline. */
const NON_BASELINE_REASONS: SkippedReason[] = [...FETCH_FAILURE_REASONS, ...PENDING_REASONS];

/** True when a run row may serve as the diff baseline (see the header). */
export function isBaselineRun(run: Pick<typeof queryRuns.$inferSelect, "notified" | "skippedReason">): boolean {
  if (run.notified) return true;
  const reason = run.skippedReason as SkippedReason | null;
  if (reason === null) return true;
  return !FETCH_FAILURE_REASONS.has(reason) && !PENDING_REASONS.has(reason);
}

/** SQL form of `isBaselineRun`, so the newest eligible row is picked by the index, not in memory. */
function baselineEligible() {
  return or(eq(queryRuns.notified, true), isNull(queryRuns.skippedReason), notInArray(queryRuns.skippedReason, NON_BASELINE_REASONS));
}

/** Most recent baseline-eligible run for a saved query, or null (first run). One indexed row read. */
export function findBaseline(db: Db, savedQueryId: string): typeof queryRuns.$inferSelect | null {
  return (
    db
      .select()
      .from(queryRuns)
      .where(and(eq(queryRuns.savedQueryId, savedQueryId), baselineEligible()))
      .orderBy(desc(queryRuns.ranAt), desc(sql`rowid`))
      .limit(1)
      .get() ?? null
  );
}

/**
 * Claim the saved query for a run starting at `ranAt`: bump `last_run_at` only when the
 * previous run started at least RUN_CLAIM_WINDOW_MS earlier (or never). Returns false when
 * another runner holds the claim. A single conditional UPDATE, so it is atomic across the
 * web and worker processes sharing the SQLite file.
 */
export function claimRun(db: Db, savedQueryId: string, ranAt: string, windowMs = RUN_CLAIM_WINDOW_MS): boolean {
  const cutoff = new Date(Date.parse(ranAt) - windowMs).toISOString();
  const res = db
    .update(savedQueries)
    .set({ lastRunAt: ranAt })
    .where(and(eq(savedQueries.id, savedQueryId), or(isNull(savedQueries.lastRunAt), lt(savedQueries.lastRunAt, cutoff), eq(savedQueries.lastRunAt, cutoff))))
    .run();
  return res.changes > 0;
}

/**
 * Retention: delete this saved query's runs beyond the `keep` newest, never the row that is
 * (or would become) the diff baseline. Returns the number of rows removed.
 */
export function pruneQueryRuns(db: Db, savedQueryId: string, keep = RUNS_KEEP_PER_QUERY): number {
  const newest = db
    .select({ id: queryRuns.id })
    .from(queryRuns)
    .where(eq(queryRuns.savedQueryId, savedQueryId))
    .orderBy(desc(queryRuns.ranAt), desc(sql`rowid`))
    .limit(keep);
  const baseline = findBaseline(db, savedQueryId);
  const conditions = [eq(queryRuns.savedQueryId, savedQueryId), notInArray(queryRuns.id, newest)];
  if (baseline) conditions.push(ne(queryRuns.id, baseline.id));
  return db.delete(queryRuns).where(and(...conditions)).run().changes;
}

/** Should this diff be sent under the saved query's notify rule? */
export function shouldNotify(notifyOn: SavedQuery["notifyOn"], diff: SnapshotDiff): boolean {
  const hasNew = diff.new.length > 0;
  const hasDrop = diff.price_drops.length > 0;
  switch (notifyOn) {
    case "new_cells":
      return hasNew;
    case "price_drop":
      return hasDrop;
    default:
      return hasNew || hasDrop;
  }
}

export function gridUrlFor(appUrl: string, query: QueryObject): string {
  return `${appUrl.replace(/\/+$/, "")}/grid?q=${encodeQueryParam(query)}`;
}

function counts(diff: SnapshotDiff): DiffCounts {
  return { new: diff.new.length, dropped: diff.dropped.length, price_drops: diff.price_drops.length, unchanged: diff.unchanged };
}

/** Map a fetch-stage error to a skipped reason + a non-secret classifier. */
export function classifyFetchError(err: unknown): { reason: SkippedReason; error: RunError } {
  if (err instanceof NoKeyError) return { reason: "no_key", error: { code: "no_key", detail: err.name } };
  if (err instanceof QuotaExceededError) return { reason: "quota", error: { code: "quota", detail: err.name } };
  if (err instanceof SeatsAeroError) {
    const detail = err instanceof SeatsAeroHttpError ? err.kind : err.name;
    return { reason: "upstream_error", error: { code: "upstream_error", detail } };
  }
  const name = err instanceof Error ? err.name : typeof err;
  return { reason: "error", error: { code: "internal", detail: name } };
}

interface RecordInput {
  savedQueryId: string;
  ranAt: string;
  cells: CellSnapshot[];
  hash: string;
  newCells: number;
  droppedCells: number;
  notified: boolean;
  skippedReason: SkippedReason | null;
  /** seats.aero calls this run spent, or null when the number is not knowable (see below). */
  callsUsed: number | null;
}

/** Insert the query_runs row, bump saved_queries.last_run_at and apply retention in one transaction. */
function record(db: Db, input: RecordInput): string {
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(queryRuns)
      .values({
        id,
        savedQueryId: input.savedQueryId,
        ranAt: input.ranAt,
        cellsHash: input.hash,
        cellsJson: serializeSnapshot(input.cells),
        newCells: input.newCells,
        droppedCells: input.droppedCells,
        notified: input.notified,
        skippedReason: input.skippedReason,
        callsUsed: input.callsUsed,
      })
      .run();
    tx.update(savedQueries).set({ lastRunAt: input.ranAt }).where(eq(savedQueries.id, input.savedQueryId)).run();
    pruneQueryRuns(tx, input.savedQueryId);
  });
  return id;
}

/**
 * Run one saved query end to end. Never throws for per-query failures: every outcome is a
 * recorded `query_runs` row plus a QueryRunResult with a code. Only a database failure in the
 * final record step can propagate (the caller's tick catches it).
 */
export async function runSavedQuery(db: Db, savedQuery: SavedQuery, deps: RunDeps): Promise<QueryRunResult> {
  const now = deps.now ?? (() => new Date());
  const ranAt = now().toISOString();
  const base = { savedQueryId: savedQuery.id, userId: savedQuery.userId, ranAt };
  const log = deps.log ?? (() => {});

  const finish = (
    runId: string | null,
    fields: Pick<QueryRunResult, "notified" | "skippedReason" | "cells" | "diff" | "apiCallsUsed" | "servedFromCache" | "error">,
  ): QueryRunResult => {
    const result: QueryRunResult = { ...base, runId, ...fields };
    log("scheduler.run", {
      savedQueryId: result.savedQueryId,
      userId: result.userId,
      notified: result.notified,
      skippedReason: result.skippedReason,
      cells: result.cells,
      apiCallsUsed: result.apiCallsUsed,
      errorCode: result.error?.code ?? null,
    });
    return result;
  };

  /**
   * Record a run that produced no cells. `callsUsed` is 0 for the skips that happen before the
   * facade is called at all, and null for a fetch that threw: the facade may have spent calls on
   * the pages it did complete and does not report how many, so 0 there would understate the
   * quota the run consumed. Null reads back as "not recorded".
   */
  const skip = (reason: SkippedReason, error: RunError | null, callsUsed: number | null = 0): QueryRunResult => {
    const runId = record(db, {
      savedQueryId: savedQuery.id,
      ranAt,
      cells: [],
      hash: "",
      newCells: 0,
      droppedCells: 0,
      notified: false,
      skippedReason: reason,
      callsUsed,
    });
    return finish(runId, { notified: false, skippedReason: reason, cells: 0, diff: null, apiCallsUsed: 0, servedFromCache: false, error });
  };

  // 0. Claim the query against a concurrent runner in another process (web "run now" vs worker).
  if (!claimRun(db, savedQuery.id, ranAt)) {
    return finish(null, { notified: false, skippedReason: "in_progress", cells: 0, diff: null, apiCallsUsed: 0, servedFromCache: false, error: { code: "in_progress", detail: "claimed" } });
  }

  // 1. Owner (the saved query's user — never anyone else's key or chat).
  const user: User | undefined = db.select().from(users).where(eq(users.id, savedQuery.userId)).get();
  if (!user) return skip("error", { code: "internal", detail: "owner_missing" });

  // 2. Query.
  let query: QueryObject;
  try {
    query = QueryObject.parse(JSON.parse(savedQuery.queryJson));
  } catch {
    return skip("invalid_query", { code: "invalid_query", detail: "QueryObject" });
  }

  // 3. Rows through the Phase-2 facade (own key, per-user cache + quota, TTL honoured).
  let cells: CellSnapshot[];
  let apiCallsUsed = 0;
  let servedFromCache = false;
  try {
    const res = await findGridForUser(db, { id: user.id }, query, {
      now,
      // Standing queries diff exactly what the user asked for: never append cached
      // dynamic-priced rows from the include_filtered scope (they are a UI hint only).
      dynamic_rows: false,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.masterKey ? { masterKey: deps.masterKey } : {}),
      ...(deps.ttlMinutes !== undefined ? { ttlMinutes: deps.ttlMinutes } : {}),
    });
    apiCallsUsed = res.grid.meta.api_calls_used;
    servedFromCache = res.grid.meta.served_from_cache;
    cells = snapshot(res.grid.cells.flat().flatMap((c) => c.all));
  } catch (err) {
    const { reason, error } = classifyFetchError(err);
    // A missing key and an exhausted quota are both refused at reservation time, before a single
    // request goes out (src/lib/seatsaero/find.ts), so 0 is exact. Anything else threw after the
    // facade had started fetching and does not report the pages it had already completed — and a
    // run that merely RUNS OUT of headroom mid-way returns a partial result rather than throwing,
    // so it takes the success path with a real count.
    return skip(reason, error, reason === "no_key" || reason === "quota" ? 0 : null);
  }
  const hash = cellsHash(cells);

  // 4. Baseline + diff.
  const baseline = findBaseline(db, savedQuery.id);
  const store = (notified: boolean, skippedReason: SkippedReason | null, diff: SnapshotDiff | null, error: RunError | null) => {
    const runId = record(db, {
      savedQueryId: savedQuery.id,
      ranAt,
      cells,
      hash,
      newCells: diff?.new.length ?? 0,
      droppedCells: diff?.dropped.length ?? 0,
      notified,
      skippedReason,
      callsUsed: apiCallsUsed,
    });
    return finish(runId, { notified, skippedReason, cells: cells.length, diff: diff ? counts(diff) : null, apiCallsUsed, servedFromCache, error });
  };
  if (!baseline) return store(false, "first_run", null, null);

  const diff = diffSnapshots(parseSnapshot(baseline.cellsJson), cells, { dropThresholdPct: savedQuery.dropThresholdPct });

  // 5. Notify decision.
  if (!shouldNotify(savedQuery.notifyOn, diff)) return store(false, null, diff, null);
  if (!user.telegramChatId) return store(false, "no_telegram", diff, null);
  if (inQuietHours(user, now())) return store(false, "quiet_hours", diff, null);

  // 6. Deliver to the owner's chat only. The production transports never throw: a blocked
  //    bot, a rate limit, an outage or a rejected message is `{ ok: false, reason }`, which
  //    must NOT become the baseline — the change is re-sent by the next run (send_failed is a
  //    PENDING reason). A throwing transport is treated the same way.
  const format = deps.format ?? defaultFormatDigest;
  const html = format({ savedQuery, diff, locale: parseLocale(user.locale), gridUrl: gridUrlFor(deps.appUrl, query), now: now() });
  let sent: SendResult;
  try {
    sent = await deps.transport.sendMessage(user.telegramChatId, html);
  } catch (err) {
    const detail = err instanceof Error ? err.name : typeof err;
    return store(false, "send_failed", diff, { code: "send_failed", detail });
  }
  if (!sent || typeof sent !== "object" || sent.ok !== true) {
    const reason = sent && typeof sent === "object" && "reason" in sent && typeof sent.reason === "string" ? sent.reason : "unknown";
    return store(false, "send_failed", diff, { code: "send_failed", detail: reason });
  }
  return store(true, null, diff, null);
}
