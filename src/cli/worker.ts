/**
 * `pnpm worker` — process wrapper around `startWorker` (src/cli/worker-main.ts): standing-query
 * scheduler (node-cron master tick every minute, UTC) + Telegram link poller when
 * TELEGRAM_BOT_TOKEN is set (mock transport otherwise). SIGTERM/SIGINT stop the cron task and
 * the poller, wait for the in-flight tick, then exit 0. Exit 1 on a startup failure
 * (missing MASTER_KEY, rejected bot token) — the log line names the reason, never a value.
 */
import { startWorker, stdoutLog, WorkerStartupError } from "@/cli/worker-main";

const env = process.env;

let handle: Awaited<ReturnType<typeof startWorker>>;
try {
  handle = await startWorker({
    env: {
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
      APP_URL: env.APP_URL,
      DATABASE_PATH: env.DATABASE_PATH,
      MASTER_KEY: env.MASTER_KEY,
      AWARDGRID_DATA_DIR: env.AWARDGRID_DATA_DIR,
      TELEGRAM_API_BASE: env.TELEGRAM_API_BASE,
    },
  });
} catch (err) {
  const reason = err instanceof WorkerStartupError ? err.reason : err instanceof Error ? err.name : "unknown";
  stdoutLog("worker.exit", { code: 1, reason });
  process.exit(1);
}

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stdoutLog("worker.signal", { signal });
  // A second signal during shutdown (or a hung poller) must not keep the process alive forever.
  const deadline = setTimeout(() => {
    stdoutLog("worker.exit", { code: 1, reason: "shutdown_timeout" });
    process.exit(1);
  }, 30_000);
  deadline.unref();
  void handle.stop().then(() => {
    clearTimeout(deadline);
    stdoutLog("worker.exit", { code: 0, reason: signal });
    process.exit(0);
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
