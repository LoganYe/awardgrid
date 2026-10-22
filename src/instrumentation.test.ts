/**
 * src/instrumentation.ts: with Login with Seats.aero paused (SEATS_OAUTH_WEB=off, or a value the switch does not know)
 * the Node.js server opens the database when it starts, so the pause's purge does not wait for a request; otherwise it
 * does nothing. The database module is mocked: nothing is opened here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getServerDb = vi.fn();
vi.mock("@/lib/server/db", () => ({ getServerDb }));

const { register } = await import("./instrumentation");

const saved = process.env.NEXT_RUNTIME;

beforeEach(() => {
  getServerDb.mockReset();
});

afterEach(() => {
  delete process.env.SEATS_OAUTH_WEB;
  if (saved === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = saved;
  vi.restoreAllMocks();
});

describe("register", () => {
  it("opens the database at startup on the Node.js server while the sign-in is paused", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SEATS_OAUTH_WEB = "off";
    await register();
    expect(getServerDb).toHaveBeenCalledTimes(1);
  });

  it("does nothing with the switch on, or outside the Node.js server", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    process.env.SEATS_OAUTH_WEB = "on";
    await register();
    process.env.NEXT_RUNTIME = "edge";
    process.env.SEATS_OAUTH_WEB = "off";
    await register();
    expect(getServerDb).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("a value the switch does not know pauses too: a warning that names the variable, not the value, then the purge", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SEATS_OAUTH_WEB = "Disabled";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn.mock.calls).toEqual([["[seats-oauth] SEATS_OAUTH_WEB is neither on nor off; Login with Seats.aero is paused"]]);
    expect(getServerDb).toHaveBeenCalledTimes(1);
  });

  it("a database that does not open does not stop the server: the error's name is logged, the first request tries again", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SEATS_OAUTH_WEB = "off";
    getServerDb.mockImplementation(() => {
      throw new TypeError("SQLITE_CANTOPEN /secret/path");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    expect(error.mock.calls).toEqual([["[seats-oauth] paused: startup purge failed:", "TypeError"]]);
  });
});
