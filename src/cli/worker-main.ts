/**
 * `pnpm worker` — the standing-query scheduler + Telegram link poller in one process
 * (kickoff §6, §9 Phase 3; ARCHITECTURE §9.3 / §9.5).
 *
 *   node-cron master task "* * * * *" (UTC, noOverlap, name "awardgrid-tick")
 *     └─▶ tick(db, deps)   — every enabled saved query whose cron is due, sequentially,
 *                            each with its OWNER's key, cache and quota; diff; notify.
 *   TELEGRAM_BOT_TOKEN set  → TelegramTransport (validated with getMe at startup) + the
 *                            getUpdates long-polling loop that handles "/start <token>" / "/unlink".
 *   TELEGRAM_BOT_TOKEN unset → MockTransport ("mock transport" is logged; no poller).
 *
 * Env: MASTER_KEY (required — fails fast, value never logged), DATABASE_PATH, APP_URL,
 * TELEGRAM_BOT_TOKEN, AWARDGRID_DATA_DIR (mock JSONL sink), TELEGRAM_API_BASE (tests/dev).
 *
 * Everything is injected through `WorkerIo` so a test can start the worker over an in-memory
 * database with a fake clock, a fake fetch and a fake scheduler. `worker.ts` is the thin
 * process wrapper that adds SIGTERM/SIGINT handling.
 *
 * Logging: one JSON line per event on stdout. Fields are saved-query ids, user ids, counts,
 * reason codes and error class names ONLY — never a key, token, chat id or username.
 */
import nodeCron, { type ScheduledTask, type TaskOptions } from "node-cron";
import { openDb, type Db } from "@/lib/db/client";
import { sweepSeatsData } from "@/lib/seats-oauth/retention";
import { parseMasterKey } from "@/lib/crypto/aes";
import { createTransportFromEnv, runTelegramLinkPoller, TelegramTransport, type PollerEvent, type Transport } from "@/lib/notify";
import { notifyFormatDigest, tick, type RunDeps, type SchedulerLogFields, type TickSummary } from "@/lib/scheduler";
import { heartbeatPath, writeHeartbeat } from "@/lib/scheduler/heartbeat";

/** The master tick runs every minute; `isDue` decides which saved queries actually run. */
export const MASTER_TICK_CRON = "* * * * *";
export const MASTER_TICK_NAME = "awardgrid-tick";
export const DEFAULT_APP_URL = "http://localhost:3000";

export type WorkerEnv = Partial<
  Record<"TELEGRAM_BOT_TOKEN" | "APP_URL" | "DATABASE_PATH" | "MASTER_KEY" | "AWARDGRID_DATA_DIR" | "TELEGRAM_API_BASE", string>
>;

export type WorkerLog = (event: string, fields?: SchedulerLogFields) => void;

/** Minimal scheduler seam (node-cron's `schedule` satisfies it; tests inject a manual one). */
export type ScheduleFn = (expression: string, fn: () => Promise<unknown> | unknown, options: TaskOptions) => Pick<ScheduledTask, "stop" | "destroy">;

export interface WorkerIo {
  env: WorkerEnv;
  /** Structured log sink; defaults to JSON lines on stdout. */
  log?: WorkerLog;
  /** seats.aero + Telegram transport; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Clock; defaults to the wall clock. */
  now?: () => Date;
  /** Database; defaults to openDb (with migrations) at DATABASE_PATH. */
  db?: Db;
  /** Message transport; defaults to createTransportFromEnv(env). */
  transport?: Transport;
  /** Cron scheduler; defaults to node-cron's schedule(). */
  schedule?: ScheduleFn;
  /** Run one tick immediately after start (default true) so a restart catches up at once. */
  tickOnStart?: boolean;
  /**
   * UI/UX v1 T20: where to write the heartbeat after each tick. Default: beside DATABASE_PATH's file; none for an
   * injected database (tests), unless given here. Null turns it off.
   */
  heartbeatFile?: string | null;
  /** Long-poll seconds for getUpdates (default: the transport's). */
  pollTimeoutSec?: number;
}

export interface WorkerHandle {
  transportKind: Transport["kind"];
  /** Run the master tick now (serialised with the cron's own executions). */
  tickOnce(): Promise<TickSummary | null>;
  /** Stop the cron task and the poller, wait for the in-flight tick, then resolve. */
  stop(): Promise<void>;
  /** Resolves when the worker has fully stopped. */
  done: Promise<void>;
}

/** Thrown at startup for a missing/malformed MASTER_KEY or an unreachable Telegram bot; the message carries no secret. */
export class WorkerStartupError extends Error {
  readonly reason: "master_key" | "telegram";
  constructor(reason: "master_key" | "telegram", cause?: unknown) {
    super(reason === "master_key" ? "MASTER_KEY is missing or malformed" : "Telegram bot token was rejected (getMe failed)");
    this.name = "WorkerStartupError";
    this.reason = reason;
    if (cause instanceof Error) this.cause = cause.name;
  }
}

export function stdoutLog(event: string, fields: SchedulerLogFields = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
}

const defaultSchedule: ScheduleFn = (expression, fn, options) => nodeCron.schedule(expression, fn, options);

export async function startWorker(io: WorkerIo): Promise<WorkerHandle> {
  const log = io.log ?? stdoutLog;
  const now = io.now ?? (() => new Date());
  const fetchImpl = io.fetch ?? fetch;
  const env = io.env;

  // 1. MASTER_KEY — fail fast; the parser's error never contains the value.
  let masterKey: Buffer;
  try {
    masterKey = parseMasterKey(env.MASTER_KEY);
  } catch (err) {
    log("worker.startup_failed", { reason: "master_key", error: err instanceof Error ? err.name : typeof err });
    throw new WorkerStartupError("master_key", err);
  }

  // 2. Database (migrated on open).
  const db = io.db ?? openDb({ path: env.DATABASE_PATH, migrate: true });

  // 3. Transport: Telegram when a token exists (validated with getMe), otherwise mock.
  const transport =
    io.transport ??
    createTransportFromEnv(
      { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, AWARDGRID_DATA_DIR: env.AWARDGRID_DATA_DIR, TELEGRAM_API_BASE: env.TELEGRAM_API_BASE },
      fetchImpl,
    );
  if (transport instanceof TelegramTransport) {
    try {
      await transport.getMe(); // validates the token; the username is deliberately not logged
      log("worker.transport", { kind: "telegram" });
    } catch (err) {
      log("worker.startup_failed", { reason: "telegram", error: err instanceof Error ? err.name : typeof err });
      throw new WorkerStartupError("telegram", err);
    }
  } else {
    log("worker.transport", { kind: transport.kind, message: "mock transport" });
  }

  const appUrl = (env.APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, "");
  const deps: RunDeps = {
    now,
    fetch: fetchImpl,
    transport,
    appUrl,
    masterKey,
    format: notifyFormatDigest,
    log,
  };

  // The heartbeat beside the shared database (UI/UX v1 T20): how the web server learns that scheduled checks run and
  // how the last tick went. Off for an injected database unless a file is given (tests).
  const heartbeatFile = io.heartbeatFile !== undefined ? io.heartbeatFile : io.db ? null : heartbeatPath(env.DATABASE_PATH);
  const beat = (ok: boolean) => {
    if (heartbeatFile && !writeHeartbeat(heartbeatFile, { tickAt: now().toISOString(), ok, transport: transport instanceof TelegramTransport ? "telegram" : "mock" })) {
      log("worker.heartbeat_failed", {});
    }
  };

  // Seats.aero results older than 24 hours, for every account (src/lib/seats-oauth/retention.ts). Counts only.
  const sweepRetention = () => {
    try {
      const purged = sweepSeatsData(db, now());
      if (purged.rows + purged.coverage + purged.routes + purged.runs > 0) log("worker.retention_sweep", { ...purged });
    } catch (err) {
      log("worker.retention_sweep_failed", { error: err instanceof Error ? err.name : typeof err });
    }
  };

  // 4. Master tick, serialised: node-cron's noOverlap covers its own executions and this
  //    promise covers the start-up tick and tickOnce().
  let inFlight: Promise<TickSummary | null> | null = null;
  let stopping = false;
  const runTick = (): Promise<TickSummary | null> => {
    if (inFlight) {
      log("worker.tick_skipped", { reason: "overlap" });
      return inFlight;
    }
    if (stopping) return Promise.resolve(null);
    inFlight = (async () => {
      try {
        // Short-term caching first: what is 24 hours old leaves the database before anything reads it.
        sweepRetention();
        const summary = await tick(db, deps);
        beat(summary.errors.length === 0);
        return summary;
      } catch (err) {
        log("worker.tick_failed", { error: err instanceof Error ? err.name : typeof err });
        beat(false);
        return null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const schedule = io.schedule ?? defaultSchedule;
  const task = schedule(MASTER_TICK_CRON, runTick, { name: MASTER_TICK_NAME, timezone: "UTC", noOverlap: true });
  log("worker.start", { tickCron: MASTER_TICK_CRON, transport: transport.kind });

  // 5. Link poller (real Telegram only).
  const abort = new AbortController();
  let poller: Promise<unknown> = Promise.resolve();
  if (transport instanceof TelegramTransport) {
    poller = runTelegramLinkPoller({
      transport,
      db,
      now,
      stopSignal: abort.signal,
      ...(io.pollTimeoutSec !== undefined ? { timeoutSec: io.pollTimeoutSec } : {}),
      onError: (category) => log("worker.poller_error", { category }),
      onEvent: (event: PollerEvent) => log("worker.poller_event", { type: event.type }),
    })
      .then((r) => log("worker.poller_stopped", { updatesHandled: r.updatesHandled }))
      .catch((err: unknown) => log("worker.poller_failed", { error: err instanceof Error ? err.name : typeof err }));
    log("worker.poller_start");
  }

  if (io.tickOnStart !== false) void runTick();

  let stopped: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopped) return stopped;
    stopping = true;
    stopped = (async () => {
      log("worker.stopping");
      abort.abort();
      await task.stop();
      await task.destroy();
      await (inFlight ?? Promise.resolve());
      await poller;
      log("worker.stopped");
    })();
    return stopped;
  };

  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  return {
    transportKind: transport.kind,
    tickOnce: runTick,
    stop: async () => {
      await stop();
      resolveDone();
    },
    done,
  };
}
