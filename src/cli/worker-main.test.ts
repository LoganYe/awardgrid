/**
 * startWorker wiring: fail-fast on MASTER_KEY, Telegram branch (getMe at startup, the link
 * poller runs and stops with the worker), rejected token. No network: a fake fetch answers the
 * Bot API; the cron seam is a recorder. Nothing logged may contain the token.
 */
import { describe, expect, it } from "vitest";
import { openTestDb } from "@/lib/db/client";
import { fakeFetch, jsonResponse, textResponse } from "../../test/fixtures/seatsaero/helpers";
import { startWorker, WorkerStartupError, type ScheduleFn } from "./worker-main";

const MASTER_HEX = "ab".repeat(32);
const TOKEN = "123456:ABC-DEF_secret-bot-token";
const API_BASE = "https://tg.test";

const recorderSchedule: ScheduleFn = () => ({ stop: () => {}, destroy: () => {} });

function collect() {
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const log = (event: string, fields: Record<string, string | number | boolean | null> = {}) => logs.push({ event, fields });
  return { logs, log };
}

describe("startWorker", () => {
  it("fails fast without MASTER_KEY; the log names the reason only", async () => {
    const { logs, log } = collect();
    await expect(startWorker({ env: {}, db: openTestDb(), schedule: recorderSchedule, log })).rejects.toBeInstanceOf(WorkerStartupError);
    expect(logs).toEqual([{ event: "worker.startup_failed", fields: { reason: "master_key", error: "MasterKeyError" } }]);
  });

  it("with a bot token: validates via getMe, long-polls getUpdates, and stop() ends the poller", async () => {
    const { logs, log } = collect();
    let polls = 0;
    const fetch = fakeFetch(async (req) => {
      if (req.url.pathname.endsWith("/getMe")) return jsonResponse({ ok: true, result: { id: 1, is_bot: true, first_name: "b", username: "awardgrid_bot" } });
      if (req.url.pathname.endsWith("/getUpdates")) {
        polls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return jsonResponse({ ok: true, result: [] });
      }
      return textResponse("nope", 404);
    });
    const worker = await startWorker({
      env: { MASTER_KEY: MASTER_HEX, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: API_BASE },
      db: openTestDb(),
      fetch,
      schedule: recorderSchedule,
      tickOnStart: false,
      pollTimeoutSec: 0,
      log,
    });
    expect(worker.transportKind).toBe("telegram");
    expect(fetch.calls.some((c) => c.url.pathname.endsWith("/getMe"))).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(polls).toBeGreaterThan(0);

    await worker.stop();
    await worker.done;
    const pollsAtStop = polls;
    await new Promise((r) => setTimeout(r, 30));
    expect(polls).toBe(pollsAtStop);

    const events = logs.map((l) => l.event);
    expect(events).toContain("worker.transport");
    expect(events).toContain("worker.poller_start");
    expect(events).toContain("worker.poller_stopped");
    expect(events.at(-1)).toBe("worker.stopped");
    expect(logs.find((l) => l.event === "worker.transport")?.fields).toEqual({ kind: "telegram" });
    const text = JSON.stringify(logs);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("awardgrid_bot");
  });

  it("a rejected token (getMe 401) fails startup without leaking the token", async () => {
    const { logs, log } = collect();
    const fetch = fakeFetch(() => jsonResponse({ ok: false, error_code: 401, description: "Unauthorized" }, 401));
    let caught: unknown;
    try {
      await startWorker({ env: { MASTER_KEY: MASTER_HEX, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: API_BASE }, db: openTestDb(), fetch, schedule: recorderSchedule, log });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerStartupError);
    expect((caught as WorkerStartupError).reason).toBe("telegram");
    expect(String((caught as Error).message)).not.toContain(TOKEN);
    expect(logs.at(-1)).toMatchObject({ event: "worker.startup_failed", fields: { reason: "telegram" } });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });
});
