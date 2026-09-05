import { describe, expect, it } from "vitest";
import { FileRoutesStore, cliUserId, defaultRoutesCachePath } from "@/cli/routes-store";
import type { RoutesEntry } from "@/lib/seatsaero/routes";

/** In-memory "disk" shared between store instances, like two CLI processes sharing one file. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs: string[] = [];
  const io = {
    readFile: async (p: string) => {
      const c = files.get(p);
      if (c === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return c;
    },
    writeFile: async (p: string, c: string) => {
      files.set(p, c);
    },
    mkdir: async (d: string) => {
      dirs.push(d);
    },
  };
  return { files, dirs, io };
}

const entry: RoutesEntry = {
  routes: [{ ID: "r1", OriginAirport: "HKG", OriginRegion: "Asia", DestinationAirport: "SEA", DestinationRegion: "North America", NumDaysOut: 300, Distance: 6500, Source: "alaska" }],
  fetched_at: "2026-10-01T00:00:00.000Z",
};

describe("FileRoutesStore", () => {
  it("persists entries per (user, source) across instances and creates the directory", async () => {
    const d = disk();
    const a = new FileRoutesStore({ path: "/cache/awardgrid/routes.json", ...d.io });
    expect(await a.get("cli:a", "alaska")).toBeNull();
    await a.put("cli:a", "alaska", entry);
    expect(d.dirs).toEqual(["/cache/awardgrid"]);
    expect(d.files.has("/cache/awardgrid/routes.json")).toBe(true);

    const b = new FileRoutesStore({ path: "/cache/awardgrid/routes.json", ...d.io });
    expect(await b.get("cli:a", "alaska")).toEqual(entry);
    expect(await b.get("cli:a", "united")).toBeNull();
    expect(await b.get("cli:other-key", "alaska")).toBeNull(); // per key, never shared
  });

  it("treats a missing or corrupt file as an empty cache", async () => {
    const d = disk({ "/x/routes.json": "{not json" });
    const s = new FileRoutesStore({ path: "/x/routes.json", ...d.io });
    expect(await s.get("u", "alaska")).toBeNull();
    const wrongShape = new FileRoutesStore({ path: "/y/routes.json", ...disk({ "/y/routes.json": JSON.stringify({ u: { alaska: { nope: 1 } } }) }).io });
    expect(await wrongShape.get("u", "alaska")).toBeNull();
  });

  it("cliUserId is a stable hash that reveals nothing about the key", () => {
    const id = cliUserId("pro_key_topsecret_1234");
    expect(id).toMatch(/^cli:[0-9a-f]{16}$/);
    expect(id).toBe(cliUserId("pro_key_topsecret_1234"));
    expect(id).not.toBe(cliUserId("pro_key_topsecret_1235"));
    expect(id).not.toContain("1234");
  });

  it("defaultRoutesCachePath honours AWARDGRID_CACHE_DIR, then XDG_CACHE_HOME", () => {
    expect(defaultRoutesCachePath({ AWARDGRID_CACHE_DIR: "/tmp/ag" })).toBe("/tmp/ag/routes.json");
    expect(defaultRoutesCachePath({ XDG_CACHE_HOME: "/xdg" })).toBe("/xdg/awardgrid/routes.json");
    expect(defaultRoutesCachePath({})).toMatch(/\.cache\/awardgrid\/routes\.json$/);
  });
});
