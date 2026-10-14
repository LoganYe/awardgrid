/**
 * The App Store build's launch (./flags.ts STORE; ./bootstrap.ts ASK_KIT): there is no Ask at all. Bootstrap never
 * loads Ask's parts (../ask/kit.ts), builds no Anthropic transport, reads no Anthropic key and no ask.json, and the
 * services it returns have neither `ask` nor `anthropicKeys`; saves and the short-term sweep run without them. Sample
 * mode's options name neither. The default build is booted the same way beside it and keeps both, so a case that
 * passes only because nothing booted cannot pass.
 *
 * Each case stubs the environment and imports the modules afresh, so ASK_KIT is read as a build would read it.
 * scripts/check-store-bundle.mjs checks the bundle itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { LIVE_ONLY } from "./data-source";
import { type KeyStore, MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";

const NOW = new Date("2026-10-13T00:00:00.000Z");

/** How many times Ask's kit was loaded since the last `load`. */
const kit = vi.hoisted(() => ({ loaded: 0 }));
vi.mock("../ask/kit", async (importOriginal) => {
  kit.loaded += 1;
  return importOriginal();
});

/** The app's modules as a build of this flavour sees them. */
async function load(store: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_AG_STORE", store ? "1" : "");
  kit.loaded = 0;
  const [bootstrap, sample] = await Promise.all([import("./bootstrap"), import("../sample/boot")]);
  return { bootstrap: bootstrap.bootstrap, sampleBootstrapOptions: sample.sampleBootstrapOptions };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** A key store that fails the test if it is read: the Anthropic Keychain item stands in for it. */
function untouchable(): KeyStore & { touched: number } {
  const store = {
    touched: 0,
    async get() {
      store.touched += 1;
      return "sk-ant-api03-never-read";
    },
    async set() {
      store.touched += 1;
    },
    async clear() {
      store.touched += 1;
    },
  };
  return store;
}

const seatsAero = fakeFetch(async () => new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200, headers: { "content-type": "application/json" } }));

async function boot(store: boolean) {
  const { bootstrap } = await load(store);
  const keys = new MemoryKeyStore();
  await keys.set("seats-key-for-the-test");
  const anthropicKeys = untouchable();
  const anthropicFetch = vi.fn(async () => new Response("{}"));
  const files = new MemoryFileStore();
  // A conversation an earlier, internal build left behind: the App Store build does not read it.
  files.files.set("ask.json", JSON.stringify({ version: 1, conversation: null }));
  const services = await bootstrap({
    keys,
    anthropicKeys,
    anthropicFetch,
    assertNative: () => {},
    snapshots: new SnapshotStore(files),
    now: () => NOW,
    fetchImpl: seatsAero,
    oauth: null,
    // The App Store build keeps results for 24 hours at most: the sweep that would clear an Ask conversation runs.
    shortTermMs: 86_400_000,
  });
  return { services, anthropicKeys, anthropicFetch, files };
}

// Each test boots the whole app; on a busy machine that outlasts the 15 s default.
describe("the App Store build has no Ask service", { timeout: 60_000 }, () => {
  it("never loads Ask's parts, reads no Anthropic key, and its services have neither ask nor anthropicKeys", async () => {
    const { services, anthropicKeys, anthropicFetch } = await boot(true);
    expect(kit.loaded).toBe(0);
    expect("ask" in services).toBe(false);
    expect("anthropicKeys" in services).toBe(false);
    expect(services.ask).toBeUndefined();
    expect(anthropicKeys.touched).toBe(0);
    expect(anthropicFetch).not.toHaveBeenCalled();
  });

  it("saves and sweeps without an Ask part, and writes no ask.json", async () => {
    const { services, anthropicKeys, anthropicFetch, files } = await boot(true);
    const before = files.files.get("ask.json");
    expect(await services.persist()).toEqual({ ok: true });
    await services.sweepShortTerm();
    expect(services.saveStatus.get()).toBeNull();
    expect(files.files.get("ask.json")).toBe(before);
    expect(anthropicKeys.touched).toBe(0);
    expect(anthropicFetch).not.toHaveBeenCalled();
  });

  it("the default build, booted the same way, has both, and loads Ask's parts once", async () => {
    const { services, anthropicKeys } = await boot(false);
    expect(kit.loaded).toBe(1);
    expect(services.ask).toBeDefined();
    expect(services.anthropicKeys).toBe(anthropicKeys);
    // Launch still reads no Anthropic key (Ask reads it when a question starts).
    expect(anthropicKeys.touched).toBe(0);
    expect(await services.persist()).toEqual({ ok: true });
  });

  it("sample mode's options name no Anthropic key or transport in the App Store build, and do in the default one", async () => {
    for (const store of [true, false]) {
      const { sampleBootstrapOptions } = await load(store);
      const files = new MemoryFileStore();
      const options = await sampleBootstrapOptions({ snapshots: new SnapshotStore(files), now: () => NOW }, files, LIVE_ONLY);
      for (const name of ["anthropicKeys", "anthropicFetch", "assertNative"]) expect(name in options, `${name}, store: ${store}`).toBe(!store);
    }
  });
});
