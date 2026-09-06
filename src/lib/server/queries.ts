/**
 * Saved (standing) queries — the data layer behind /api/queries, /api/telegram and the
 * /queries page (kickoff §6, §12 defaults: every 3 h, notify on both, 10 % drop).
 *
 * Every function takes the CALLING user's id and scopes by it: another user's saved query is
 * indistinguishable from a missing one (null → 404). Runs use the owner's own key through the
 * scheduler's runNow; nothing here decrypts keys, and no log line carries a key, chat id,
 * username or token (§0.2 #8, §10).
 *
 * Integration seam (bottom of the file): thin adapters over the scheduler (`runNow`,
 * `validateCron`, `DEFAULT_CRON`) and the notifier (`createTelegramLinkToken`,
 * `unlinkTelegram`, `createTransportFromEnv`) so the routes depend on one module.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { parse as parseCron, validate as validateCronExpr } from "node-cron";
import type { Db } from "@/lib/db/client";
import { NOTIFY_ON, queryRuns, savedQueries, users, type NotifyOn, type QueryRun, type SavedQuery } from "@/lib/db/schema";
import { createSqliteQuotaStore } from "@/lib/db/stores/quota";
import type { AvailabilityRow } from "@/lib/grid/types";
import { NoKeyError } from "@/lib/keys";
import { TelegramTransport, createTelegramLinkToken, createTransportFromEnv as notifyTransportFromEnv, unlinkTelegram } from "@/lib/notify";
import { Cabin, QueryObject } from "@/lib/query/schema";
import {
  DEFAULT_CRON,
  FETCH_FAILURE_REASONS,
  PENDING_REASONS,
  describeCron,
  diffSnapshots,
  nextRunAt,
  parseCellKey,
  parseSnapshot,
  notifyFormatDigest,
  runNow as schedulerRunNow,
  validateCron as schedulerValidateCron,
  type CellSnapshot,
  type CronDescription,
  type RunDeps,
  type SkippedReason,
} from "@/lib/scheduler";
import { Quota, softLimitFromEnv } from "@/lib/seatsaero/quota";

export { NOTIFY_ON, type NotifyOn };

// ---------------------------------------------------------------------------
// Limits (kickoff §12 + route validation contract)
// ---------------------------------------------------------------------------

export const NAME_MIN = 1;
export const NAME_MAX = 60;
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 90;
export const DEFAULT_DROP_THRESHOLD_PCT = 10;
export const DEFAULT_NOTIFY_ON: NotifyOn = "both";
/** Last N runs returned by GET /api/queries/[id]/runs. */
export const RUNS_LIMIT = 20;

// ---------------------------------------------------------------------------
// Wire shapes (shared with the client components — plain JSON, snake_case like QueryObject)
// ---------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  ran_at: string;
  new_cells: number;
  dropped_cells: number;
  notified: boolean;
  skipped_reason: string | null;
  /**
   * seats.aero calls this run spent, from `query_runs.calls_used`. Null means "not recorded",
   * not zero: rows written before the column existed carry null, and so does a run whose fetch
   * threw part-way (the facade does not report the calls it had already spent). The UI prints
   * "calls not recorded" for null rather than inventing a number.
   */
  calls_used: number | null;
}

export interface SavedQuerySummary {
  id: string;
  name: string;
  query: QueryObject;
  schedule_cron: string;
  notify_on: NotifyOn;
  drop_threshold_pct: number;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
  last_run: RunSummary | null;
  /**
   * When this query is next due, as ISO — `nextRunAt(schedule_cron, last_run_at ?? now)`. It is
   * in the past when a query is overdue (the worker was down, or the query is paused); the UI
   * renders that as "due now". Null when the expression matches nothing in the next year.
   */
  next_run_at: string | null;
  /** Shape of the schedule for the human label; the UI picks the i18n key (never English here). */
  schedule_label: CronDescription;
}

export function toRunSummary(run: QueryRun): RunSummary {
  return {
    id: run.id,
    ran_at: run.ranAt,
    new_cells: run.newCells,
    dropped_cells: run.droppedCells,
    notified: run.notified,
    skipped_reason: run.skippedReason ?? null,
    calls_used: run.callsUsed ?? null,
  };
}

/**
 * Parse the stored QueryObject. A row whose JSON no longer validates (schema drift) is still
 * listed so the user can delete it, with a minimal placeholder query instead of a crash.
 */
function parseStoredQuery(json: string): QueryObject {
  try {
    const parsed = QueryObject.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    origins: ["XXX"],
    destinations: ["XXX"],
    date_from: today,
    date_to: today,
    cabins: ["J"],
    direct_only: false,
    include_filtered: false,
    sort_by: "miles_asc",
    raw_text: "",
    language: "en",
  };
}

function toSummary(row: SavedQuery, lastRun: QueryRun | null, now: Date = new Date()): SavedQuerySummary {
  return {
    id: row.id,
    name: row.name,
    query: parseStoredQuery(row.queryJson),
    schedule_cron: row.scheduleCron,
    notify_on: row.notifyOn,
    drop_threshold_pct: row.dropThresholdPct,
    enabled: row.enabled,
    created_at: row.createdAt,
    last_run_at: row.lastRunAt,
    last_run: lastRun ? toRunSummary(lastRun) : null,
    next_run_at: nextRunAt(row.scheduleCron, row.lastRunAt ?? now.toISOString()),
    schedule_label: describeCron(row.scheduleCron),
  };
}

// ---------------------------------------------------------------------------
// CRUD (always scoped by userId)
// ---------------------------------------------------------------------------

export interface ClockOpts {
  now?: () => Date;
}

function latestRun(db: Db, savedQueryId: string): QueryRun | null {
  return (
    db
      .select()
      .from(queryRuns)
      .where(eq(queryRuns.savedQueryId, savedQueryId))
      .orderBy(desc(queryRuns.ranAt), desc(sql`rowid`))
      .limit(1)
      .get() ?? null
  );
}

/** The user's saved queries, newest first, each with its most recent run (or null). */
export function listSavedQueries(db: Db, userId: string, opts: ClockOpts = {}): SavedQuerySummary[] {
  const now = (opts.now ?? (() => new Date()))();
  const rows = db.select().from(savedQueries).where(eq(savedQueries.userId, userId)).orderBy(desc(savedQueries.createdAt)).all();
  return rows.map((row) => toSummary(row, latestRun(db, row.id), now));
}

/** One saved query when it belongs to `userId`; null otherwise (the route answers 404). */
export function getSavedQuery(db: Db, userId: string, id: string, opts: ClockOpts = {}): SavedQuerySummary | null {
  const row = db
    .select()
    .from(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
    .get();
  return row ? toSummary(row, latestRun(db, row.id), (opts.now ?? (() => new Date()))()) : null;
}

export interface CreateSavedQueryInput {
  name: string;
  query: QueryObject;
  schedule_cron?: string;
  notify_on?: NotifyOn;
  drop_threshold_pct?: number;
}

/** Insert with the §12 defaults; validation (cron, ranges) happens in the route via zod. */
export function createSavedQuery(db: Db, userId: string, input: CreateSavedQueryInput, opts: ClockOpts = {}): SavedQuerySummary {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const id = randomUUID();
  db.insert(savedQueries)
    .values({
      id,
      userId,
      name: input.name,
      queryJson: JSON.stringify(input.query),
      scheduleCron: input.schedule_cron ?? DEFAULT_CRON,
      notifyOn: input.notify_on ?? DEFAULT_NOTIFY_ON,
      dropThresholdPct: input.drop_threshold_pct ?? DEFAULT_DROP_THRESHOLD_PCT,
      enabled: true,
      createdAt: now,
      lastRunAt: null,
    })
    .run();
  return getSavedQuery(db, userId, id, opts)!;
}

export interface UpdateSavedQueryInput {
  enabled?: boolean;
  name?: string;
  /** The parsed chips. Replaces `query_json` wholesale — the edit drawer sends the whole object. */
  query?: QueryObject;
  schedule_cron?: string;
  notify_on?: NotifyOn;
  drop_threshold_pct?: number;
}

/** Patch the user's own row; null when the id is not theirs (or does not exist). */
export function updateSavedQuery(db: Db, userId: string, id: string, patch: UpdateSavedQueryInput): SavedQuerySummary | null {
  if (!getSavedQuery(db, userId, id)) return null;
  const set: Partial<typeof savedQueries.$inferInsert> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.query !== undefined) set.queryJson = JSON.stringify(patch.query);
  if (patch.schedule_cron !== undefined) set.scheduleCron = patch.schedule_cron;
  if (patch.notify_on !== undefined) set.notifyOn = patch.notify_on;
  if (patch.drop_threshold_pct !== undefined) set.dropThresholdPct = patch.drop_threshold_pct;
  if (Object.keys(set).length > 0) {
    db.update(savedQueries)
      .set(set)
      .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
      .run();
  }
  return getSavedQuery(db, userId, id);
}

/** True when a row was deleted (runs cascade). */
export function deleteSavedQuery(db: Db, userId: string, id: string): boolean {
  const res = db
    .delete(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
    .run();
  return res.changes > 0;
}

/** Last `limit` runs (newest first) of the user's own query; null when it is not theirs. */
export function listRuns(db: Db, userId: string, id: string, limit = RUNS_LIMIT): RunSummary[] | null {
  if (!getSavedQuery(db, userId, id)) return null;
  const rows = db
    .select()
    .from(queryRuns)
    .where(eq(queryRuns.savedQueryId, id))
    .orderBy(desc(queryRuns.ranAt), desc(sql`rowid`))
    .limit(limit)
    .all();
  return rows.map(toRunSummary);
}

// ---------------------------------------------------------------------------
// Last-run diff (Phase 6 §4: the expanded row renders new / dropped cells with the real
// grid-cell component)
// ---------------------------------------------------------------------------

/**
 * Rows rebuilt from `query_runs.cells_json`. The snapshot the scheduler stores is deliberately
 * small — key ("program|origin|dest|date|cabin"), miles, fees, seats and the freshness
 * timestamp — so the fields a live grid row also carries are filled with honest blanks:
 *   currency null, direct false, airlines [], source_id "", booking_url null,
 *   fetched_at = computed_last_seen.
 * That is enough for the cell component (miles, fees, seats, program name, freshness mark and
 * age); "show flights" and the booking link are NOT available for a historical diff cell, and
 * a dropped cell no longer exists upstream at all. Extending the snapshot means a schema
 * change, which Phase 6 does not take.
 */
export type RunDiffRow = AvailabilityRow;

/** One cell that got cheaper between the baseline and the last run. */
export interface RunDiffPriceDrop {
  /** The cell as the last run sees it, i.e. at the NEW (lower) price. */
  row: RunDiffRow;
  /** What the baseline asked for the same cell, in miles. */
  before_miles: number;
  /** How far it fell, as a percentage of the baseline miles (2 decimals). */
  pct: number;
}

export interface RunDiffRows {
  /** Cells the last run saw that the baseline did not. */
  new: RunDiffRow[];
  /** Cells the baseline had that the last run no longer sees. */
  dropped: RunDiffRow[];
  /**
   * Cells present in both, at least `drop_threshold_pct` cheaper than the baseline. The
   * scheduler notifies on these (src/lib/scheduler/run.ts `shouldNotify`), so the page has to
   * show them: a run whose only change is a price drop is not "no change".
   */
  price_drops: RunDiffPriceDrop[];
}

/** Reasons whose run row may NOT serve as the diff baseline (mirrors src/lib/scheduler/run.ts). */
const NON_BASELINE_REASONS: SkippedReason[] = [...FETCH_FAILURE_REASONS, ...PENDING_REASONS];

/** One stored cell → a grid row, or null when the key is not the five-part shape. */
export function rowFromSnapshot(cell: CellSnapshot): RunDiffRow | null {
  const parts = parseCellKey(cell.key);
  if (!parts) return null;
  const cabin = Cabin.safeParse(parts.cabin);
  if (!cabin.success) return null;
  return {
    program: parts.program,
    origin: parts.origin,
    dest: parts.dest,
    date: parts.date,
    cabin: cabin.data,
    miles: cell.miles,
    fees_cents: cell.fees_cents,
    currency: null,
    seats_left: cell.seats_left,
    direct: false,
    airlines: [],
    computed_last_seen: cell.computed_last_seen,
    source_id: "",
    booking_url: null,
    fetched_at: cell.computed_last_seen,
  };
}

function rowsFromSnapshot(cells: readonly CellSnapshot[]): RunDiffRow[] {
  return cells.map(rowFromSnapshot).filter((row): row is RunDiffRow => row !== null);
}

/**
 * The new / dropped cells of the MOST RECENT run of the user's own query, rebuilt from the
 * stored snapshots; null when the query is not theirs (or does not exist), so the route answers
 * 404 exactly as it does for the rest of /api/queries/[id].
 *
 * The baseline is picked the way the scheduler picks it (src/lib/scheduler/run.ts): the newest
 * earlier run that is not a fetch failure and not still pending delivery. Both arrays are empty
 * when there is nothing to compare — no runs, a first run, or a run that took no snapshot
 * (quota, no key, upstream error) — never a full list of "dropped" cells that never dropped.
 */
export function lastRunDiff(db: Db, userId: string, id: string): RunDiffRows | null {
  const saved = getSavedQuery(db, userId, id);
  if (!saved) return null;
  const empty: RunDiffRows = { new: [], dropped: [], price_drops: [] };
  const last = latestRun(db, id);
  if (!last) return empty;
  const reason = last.skippedReason as SkippedReason | null;
  if (reason !== null && FETCH_FAILURE_REASONS.has(reason)) return empty;

  const baseline =
    db
      .select()
      .from(queryRuns)
      .where(
        and(
          eq(queryRuns.savedQueryId, id),
          lt(queryRuns.ranAt, last.ranAt),
          or(eq(queryRuns.notified, true), isNull(queryRuns.skippedReason), notInArray(queryRuns.skippedReason, NON_BASELINE_REASONS)),
        ),
      )
      .orderBy(desc(queryRuns.ranAt), desc(sql`rowid`))
      .limit(1)
      .get() ?? null;
  if (!baseline) return empty;

  const diff = diffSnapshots(parseSnapshot(baseline.cellsJson), parseSnapshot(last.cellsJson), {
    dropThresholdPct: saved.drop_threshold_pct,
  });
  return {
    new: rowsFromSnapshot(diff.new),
    dropped: rowsFromSnapshot(diff.dropped),
    price_drops: diff.price_drops
      .map((drop) => {
        const row = rowFromSnapshot(drop.after);
        return row ? { row, before_miles: drop.before.miles, pct: drop.pct } : null;
      })
      .filter((d): d is RunDiffPriceDrop => d !== null),
  };
}

// ---------------------------------------------------------------------------
// Cron helpers shared by the route validation and the UI (pure)
// ---------------------------------------------------------------------------

export type CronValidation = { ok: true } | { ok: false; reason: "invalid" | "too_frequent" };

// ---------------------------------------------------------------------------
// Telegram status (read side; the link/unlink writes live behind the seam below)
// ---------------------------------------------------------------------------

export interface TelegramStatus {
  linked: boolean;
  /** True when no bot token is configured: links cannot be completed, messages are mocked. */
  mock: boolean;
}

export function telegramLinked(db: Db, userId: string): boolean {
  const row = db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, userId)).get();
  return typeof row?.chat === "string" && row.chat.length > 0;
}

export function telegramConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  return token !== undefined && token.length > 0;
}

/** Bot username: TELEGRAM_BOT_USERNAME wins; otherwise one cached getMe per process. */
let cachedBotUsername: string | null = null;
export function resetBotUsernameCache(): void {
  cachedBotUsername = null;
}

export async function resolveBotUsername(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const fromEnv = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (fromEnv) return fromEnv;
  if (cachedBotUsername) return cachedBotUsername;
  const transport = createTransportFromEnv(env);
  if (!transport) return null;
  try {
    const me = await transport.getMe();
    cachedBotUsername = me.username ?? null;
  } catch (err) {
    // Name only — the token never appears on the error, and it is not echoed here either.
    console.error("[telegram] getMe failed:", err instanceof Error ? err.name : "error");
    cachedBotUsername = null;
  }
  return cachedBotUsername;
}

// ===========================================================================
// Integration seam — adapters over src/lib/scheduler and src/lib/notify (other engineers).
// The routes only depend on the names exported here.
// ===========================================================================

export { DEFAULT_CRON, createTelegramLinkToken, unlinkTelegram };

/**
 * The scheduler's cron rule (its own parser AND node-cron must accept the expression) plus an
 * API-level floor: a single value in the minute field, so a standing query fires at most once
 * an hour — every run spends the owner's own quota.
 */
export function validateCron(expr: string): CronValidation {
  const trimmed = expr.trim();
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.split(/\s+/).length !== 5) return { ok: false, reason: "invalid" };
  if (!schedulerValidateCron(trimmed).valid || !validateCronExpr(trimmed)) return { ok: false, reason: "invalid" };
  let minutes: number[];
  try {
    minutes = parseCron(trimmed).minute;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (minutes.length !== 1) return { ok: false, reason: "too_frequent" };
  return { ok: true };
}

/** The bot's own identity (getMe) when a real token is configured; null in mock mode. */
export interface BotIdentityTransport {
  getMe(): Promise<{ username: string }>;
}

export function createTransportFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): BotIdentityTransport | null {
  const transport = notifyTransportFromEnv({ TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE: env.TELEGRAM_API_BASE }, fetchImpl);
  return transport instanceof TelegramTransport ? transport : null;
}

/** Thrown by runNow when another process (the worker's tick) is already running this query (→ 409). */
export class RunInProgressError extends Error {
  constructor() {
    super("a run of this saved query is already in progress");
    this.name = "RunInProgressError";
  }
}

/** Thrown by runNow when the owner's daily seats.aero quota is exhausted (→ 429 + resetAt). */
export class RunQuotaError extends Error {
  readonly resetAt: Date;
  constructor(resetAt: Date) {
    super("seats.aero daily quota reached");
    this.name = "RunQuotaError";
    this.resetAt = resetAt;
  }
}

export interface RunNowDeps extends ClockOpts {
  fetch?: typeof fetch;
  masterKey?: Buffer;
  /** Message delivery; defaults to the env-selected Telegram or mock transport. */
  transport?: RunDeps["transport"];
  /** Public origin for the grid link in the digest; defaults to APP_URL. */
  appUrl?: string;
  env?: Record<string, string | undefined>;
}

/**
 * "Run now": the scheduler's runNow with the OWNER's key, transport from env, run recorded.
 * A run the scheduler skipped for a missing key, an exhausted quota or a concurrent run in the
 * worker is surfaced as NoKeyError / RunQuotaError / RunInProgressError so the API can answer
 * 409 / 429 / 409; every other outcome (including upstream errors, quiet hours, first run)
 * comes back as the recorded run's summary.
 */
export async function runNow(db: Db, savedQueryId: string, deps: RunNowDeps = {}): Promise<RunSummary> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const transport =
    deps.transport ??
    notifyTransportFromEnv({ TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE: env.TELEGRAM_API_BASE, AWARDGRID_DATA_DIR: env.AWARDGRID_DATA_DIR });
  const appUrl = (deps.appUrl ?? env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const result = await schedulerRunNow(db, savedQueryId, {
    transport,
    appUrl,
    now,
    format: notifyFormatDigest,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.masterKey ? { masterKey: deps.masterKey } : {}),
  });
  if (!result) throw new Error("saved query not found");
  if (result.error?.code === "in_progress" || result.runId === null) throw new RunInProgressError();
  if (result.error?.code === "no_key") throw new NoKeyError("seats_aero");
  if (result.error?.code === "quota") {
    const quota = new Quota({ store: createSqliteQuotaStore(db), now, softLimit: softLimitFromEnv() });
    throw new RunQuotaError(quota.resetAt());
  }
  // This process just ran the query, so the call count IS known here (it is not persisted).
  const row = db.select().from(queryRuns).where(eq(queryRuns.id, result.runId)).get();
  if (row) return { ...toRunSummary(row), calls_used: result.apiCallsUsed };
  return {
    calls_used: result.apiCallsUsed,
    id: result.runId,
    ran_at: result.ranAt,
    new_cells: result.diff?.new ?? 0,
    dropped_cells: result.diff?.dropped ?? 0,
    notified: result.notified,
    skipped_reason: result.skippedReason,
  };
}
