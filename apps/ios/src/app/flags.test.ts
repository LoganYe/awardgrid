/**
 * The build's flavour flags (./flags.ts): what each environment value gives, the guard vite.config.ts puts in front
 * of a build, and the one place the store condition is written out instead of read from ./flags.ts (App.tsx, so the
 * bundler drops the Ask chunks), which must say the same thing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkFlavour } from "../../vite.config";

async function flagsWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import("./flags");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the flavour flags", () => {
  it("default: Ask is built, and an account is connected with its API key", async () => {
    const flags = await flagsWith({ VITE_AG_STORE: "", VITE_AG_CONNECT: "" });
    expect(flags.STORE).toBe(false);
    expect(flags.CONNECT).toBe("key");
    expect(flags.CAN_CONNECT).toBe(true);
    expect(flags.OAUTH).toBe(false);
    expect(flags.SEATS_CLIENT_ID).toBe("");
  });

  it("VITE_AG_STORE=1 is the App Store build; nothing else turns it on", async () => {
    expect((await flagsWith({ VITE_AG_STORE: "1" })).STORE).toBe(true);
    expect((await flagsWith({ VITE_AG_STORE: "true" })).STORE).toBe(false);
    expect((await flagsWith({ VITE_AG_STORE: "0" })).STORE).toBe(false);
  });

  it("VITE_AG_CONNECT: key, 0 (no connection at all) or oauth (seats.aero's own sign-in)", async () => {
    const none = await flagsWith({ VITE_AG_CONNECT: "0" });
    expect([none.CONNECT, none.CAN_CONNECT, none.OAUTH]).toEqual(["0", false, false]);
    const key = await flagsWith({ VITE_AG_CONNECT: "key" });
    expect([key.CONNECT, key.CAN_CONNECT, key.OAUTH]).toEqual(["key", true, false]);
    const oauth = await flagsWith({ VITE_AG_CONNECT: "oauth" });
    expect([oauth.CONNECT, oauth.CAN_CONNECT, oauth.OAUTH]).toEqual(["oauth", true, true]);
    expect(key.CONNECT_MODES).toEqual(["key", "oauth", "0"]);
  });

  it("VITE_AG_SEATS_CLIENT_ID is the OAuth client's ID, trimmed, and empty unless set", async () => {
    expect((await flagsWith({ VITE_AG_SEATS_CLIENT_ID: "  abc-123  " })).SEATS_CLIENT_ID).toBe("abc-123");
    expect((await flagsWith({ VITE_AG_SEATS_CLIENT_ID: "" })).SEATS_CLIENT_ID).toBe("");
  });

  it("OAUTH is a literal test of the environment, and App.tsx writes the same test out for the lazy OAuth connect page", () => {
    const here = import.meta.dirname;
    const flags = readFileSync(path.join(here, "flags.ts"), "utf8");
    const app = readFileSync(path.join(here, "App.tsx"), "utf8");
    expect(flags).toContain('export const OAUTH: boolean = import.meta.env.VITE_AG_CONNECT === "oauth";');
    expect(app).toContain('const OAUTH_BUILT = import.meta.env.VITE_AG_CONNECT === "oauth";');
    expect(app).toMatch(/const SeatsConnectScreen = OAUTH_BUILT \? lazy\(\(\) => import\("\.\.\/screens\/SeatsConnectScreen"\)/);
    expect(app.match(/screens\/SeatsConnectScreen"/g)).toHaveLength(1);
  });

  it("App.tsx writes the store condition out for its lazy Ask pages, and it is the same condition as STORE's", () => {
    const here = import.meta.dirname;
    const flags = readFileSync(path.join(here, "flags.ts"), "utf8");
    const app = readFileSync(path.join(here, "App.tsx"), "utf8");
    expect(flags).toContain('export const STORE: boolean = import.meta.env.VITE_AG_STORE === "1";');
    expect(app).toContain('const ASK_BUILT = import.meta.env.VITE_AG_STORE !== "1";');
    // Both lazy pages hang on that constant, and nothing else in App.tsx imports them.
    expect(app).toMatch(/const AskScreen = ASK_BUILT \? lazy\(\(\) => import\("\.\.\/screens\/AskScreen"\)/);
    expect(app).toMatch(/const AnthropicKeyScreen = ASK_BUILT \? lazy\(\(\) => import\("\.\.\/screens\/AnthropicKeyScreen"\)/);
    expect(app.match(/screens\/AskScreen"/g)).toHaveLength(1);
    expect(app.match(/screens\/AnthropicKeyScreen"/g)).toHaveLength(1);
  });
});

describe("vite.config.ts refuses a flavour it does not know", () => {
  it("accepts the known values, for a build and for the dev server", () => {
    const envs: Array<Record<string, string>> = [
      {},
      { VITE_AG_STORE: "1" },
      { VITE_AG_STORE: "" },
      { VITE_AG_CONNECT: "key" },
      { VITE_AG_CONNECT: "0" },
      { VITE_AG_STORE: "1", VITE_AG_CONNECT: "0" },
      // A development build of the OAuth flavour may lack a client ID (its Connect button says it cannot connect).
      { VITE_AG_CONNECT: "oauth" },
      { VITE_AG_STORE: "1", VITE_AG_CONNECT: "oauth", VITE_AG_SEATS_CLIENT_ID: "client-123" },
    ];
    for (const env of envs) {
      expect(() => checkFlavour(env, "build"), JSON.stringify(env)).not.toThrow();
    }
    expect(() => checkFlavour({ VITE_AG_STORE: "1", VITE_AG_CONNECT: "oauth" }, "serve")).not.toThrow();
  });

  it("refuses a typo, an App Store build of the OAuth flavour without a client ID, and a client ID that is not one", () => {
    expect(() => checkFlavour({ VITE_AG_STORE: "yes" }, "build")).toThrow(/VITE_AG_STORE/);
    expect(() => checkFlavour({ VITE_AG_CONNECT: "none" }, "build")).toThrow(/VITE_AG_CONNECT/);
    expect(() => checkFlavour({ VITE_AG_STORE: "1", VITE_AG_CONNECT: "oauth" }, "build")).toThrow(/VITE_AG_SEATS_CLIENT_ID/);
    expect(() => checkFlavour({ VITE_AG_STORE: "1", VITE_AG_CONNECT: "oauth", VITE_AG_SEATS_CLIENT_ID: "   " }, "build")).toThrow(/VITE_AG_SEATS_CLIENT_ID/);
    expect(() => checkFlavour({ VITE_AG_CONNECT: "oauth", VITE_AG_SEATS_CLIENT_ID: "has space" }, "build")).toThrow(/VITE_AG_SEATS_CLIENT_ID/);
  });
});
