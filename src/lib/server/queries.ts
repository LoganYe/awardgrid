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
import { and, desc, eq, sql } from "drizzle-orm";
import { parse as parseCron, validate as validateCronExpr } from "node-cron";
import type { Db } from "@/lib/db/client";
import { NOTIFY_ON, queryRuns, savedQueries, users, type NotifyOn, type QueryRun, type SavedQuery } from "@/lib/db/schema";
import { createSqliteQuotaStore } from "@/lib/db/stores/quota";
import { NoKeyError } from "@/lib/keys";
import { TelegramTransport, createTelegramLinkToken, createTransportFromEnv as notifyTransportFromEnv, unlinkTelegram } from "@/lib/notify";
import { QueryObject } from "@/lib/query/schema";
import { DEFAULT_CRON, notifyFormatDigest, runNow as schedulerRunNow, validateCron as schedulerValidateCron, type RunDeps } from "@/lib/scheduler";
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
}

export function toRunSummary(run: QueryRun): RunSummary {
  return {
    id: run.id,
    ran_at: run.ranAt,
    new_cells: run.newCells,
    dropped_cells: run.droppedCells,
    notified: run.notified,
    skipped_reason: run.skippedReason ?? null,
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

function toSummary(row: SavedQuery, lastRun: QueryRun | null): SavedQuerySummary {
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
export function listSavedQueries(db: Db, userId: string): SavedQuerySummary[] {
  const rows = db.select().from(savedQueries).where(eq(savedQueries.userId, userId)).orderBy(desc(savedQueries.createdAt)).all();
  return rows.map((row) => toSummary(row, latestRun(db, row.id)));
}

/** One saved query when it belongs to `userId`; null otherwise (the route answers 404). */
export function getSavedQuery(db: Db, userId: string, id: string): SavedQuerySummary | null {
  const row = db
    .select()
    .from(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
    .get();
  return row ? toSummary(row, latestRun(db, row.id)) : null;
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
  return getSavedQuery(db, userId, id)!;
}

export interface UpdateSavedQueryInput {
  enabled?: boolean;
  name?: string;
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
  const row = db.select().from(queryRuns).where(eq(queryRuns.id, result.runId)).get();
  if (row) return toRunSummary(row);
  return {
    id: result.runId,
    ran_at: result.ranAt,
    new_cells: result.diff?.new ?? 0,
    dropped_cells: result.diff?.dropped ?? 0,
    notified: result.notified,
    skipped_reason: result.skippedReason,
  };
}
