/**
 * The worker's heartbeat (UI/UX v1 T20; A33): written beside the shared database after each tick, read by the web
 * server; unreadable or absent means "not confirmed", never "running".
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "@/lib/db/client";
import { startWorker, type ScheduleFn } from "@/cli/worker-main";
import { heartbeatPath, readHeartbeat, writeHeartbeat } from "./heartbeat";

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ag-heartbeat-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("heartbeat file", () => {
  it("sits beside the database file, and there is none for an in-memory database", () => {
    expect(heartbeatPath("/data/awardgrid.db")).toBe("/data/awardgrid.db.worker-heartbeat.json");
    expect(heartbeatPath(":memory:")).toBeNull();
  });

  it("round-trips, atomically, and nothing unreadable passes for a heartbeat", () => {
    const file = path.join(tmp(), "db.worker-heartbeat.json");
    expect(readHeartbeat(file)).toBeNull();
    expect(readHeartbeat(null)).toBeNull();
    expect(writeHeartbeat(file, { tickAt: "2026-10-18T08:30:00.000Z", ok: true, transport: "mock" })).toBe(true);
    expect(readHeartbeat(file)).toEqual({ version: 1, tickAt: "2026-10-18T08:30:00.000Z", ok: true, transport: "mock" });
    for (const bad of ["{not json", "null", JSON.stringify({ version: 2, tickAt: "2026-10-18T08:30:00Z", ok: true, transport: "mock" }), JSON.stringify({ version: 1, tickAt: "yesterday", ok: true, transport: "mock" }), JSON.stringify({ version: 1, tickAt: "2026-10-18T08:30:00Z", ok: "yes", transport: "mock" }), JSON.stringify({ version: 1, tickAt: "2026-10-18T08:30:00Z", ok: true, transport: "sms" })]) {
      writeFileSync(file, bad);
      expect(readHeartbeat(file)).toBeNull();
    }
  });

  it("a write that cannot happen says so and never throws", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "not-a-dir"), "x");
    expect(writeHeartbeat(path.join(dir, "not-a-dir", "hb.json"), { tickAt: "2026-10-18T08:30:00Z", ok: true, transport: "mock" })).toBe(false);
  });
});

const recorderSchedule: ScheduleFn = () => ({ stop: () => {}, destroy: () => {} });

describe("the worker's heartbeat", () => {
  it("is written after a tick, with the time, the outcome and the delivery kind; an injected database writes none by default", async () => {
    const file = path.join(tmp(), "runtime.db.worker-heartbeat.json");
    const at = new Date("2026-10-18T08:31:00.000Z");
    const worker = await startWorker({ env: { MASTER_KEY: "ab".repeat(32) }, db: openTestDb(), schedule: recorderSchedule, tickOnStart: false, now: () => at, heartbeatFile: file, log: () => {} });
    await worker.tickOnce();
    await worker.stop();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, tickAt: "2026-10-18T08:31:00.000Z", ok: true, transport: "mock" });

    const quiet = tmp();
    const other = await startWorker({ env: { MASTER_KEY: "ab".repeat(32), DATABASE_PATH: path.join(quiet, "x.db") }, db: openTestDb(), schedule: recorderSchedule, tickOnStart: false, log: () => {} });
    await other.tickOnce();
    await other.stop();
    expect(readHeartbeat(heartbeatPath(path.join(quiet, "x.db")))).toBeNull();
  });
});
