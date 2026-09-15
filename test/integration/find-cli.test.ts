/**
 * Kickoff §9 Phase 1 self-acceptance, run in-process through the same `runFindCli` the
 * `pnpm run find` binary uses: the canonical example query renders from fixtures in < 5 s, and
 * wrong place expansions would be visible in the chips line. No network, no env keys.
 * (find-entrypoint.test.ts covers the real process entrypoint.)
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_API,
  EXIT_OK,
  EXIT_PARSE,
  EXIT_QUOTA,
  USAGE,
  formatChips,
  localISODate,
  redact,
  runFindCli,
  type FindCliIo,
  type FindCliJson,
} from "@/cli/find-main";

const HERE = dirname(fileURLToPath(import.meta.url));
// Moved into the core package in Phase 1 (docs/PIVOT.md §6); read off disk, not imported,
// because the CLI reads the path itself.
const FIXTURE = join(HERE, "..", "..", "packages", "core", "test", "fixtures", "seatsaero", "synthetic-example-query.json");
const EXAMPLE = "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱";
/** The kickoff writes the example three ways (§0.1 ASCII comma, §9 ASCII commas + spaces + bare 头等). */
const SPELLINGS: Array<[string, string]> = [
  ["fullwidth comma", EXAMPLE],
  ["§0.1 ASCII comma", "香港、上海、东京、首尔到西雅图,未来一个月最便宜的头等舱"],
  ["§9 ASCII commas and spaces", "香港,上海,东京,首尔到西雅图 未来一个月 头等"],
];

interface Harness {
  io: FindCliIo;
  stdout: () => string;
  stderr: () => string;
  files: Map<string, string>;
}

/** Fully injected IO: no process env, no real fetch, file writes captured in memory. */
function harness(env: Record<string, string | undefined> = {}): Harness {
  const out: string[] = [];
  const errs: string[] = [];
  const files = new Map<string, string>();
  const io: FindCliIo = {
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => errs.push(s) },
    env,
    fetch: () => Promise.reject(new Error("network is not allowed in tests")),
    writeFile: async (p, c) => {
      files.set(p, c);
    },
  };
  return { io, stdout: () => out.join(""), stderr: () => errs.join(""), files };
}

describe("pnpm run find (in-process)", () => {
  it.each(SPELLINGS)("renders the canonical example (%s) from the synthetic fixture in < 5 s", async (_label, spelling) => {
    const h = harness();
    const started = performance.now();
    const code = await runFindCli([spelling, "--fixture", FIXTURE, "--csv", "out.csv", "--width", "400"], h.io);
    const elapsed = performance.now() - started;
    const text = h.stdout();

    expect(code).toBe(EXIT_OK);
    expect(elapsed).toBeLessThan(5000);

    // Chips: every expansion visible (TYO → NRT HND, SEL → ICN GMP, SHA → PVG SHA), cabin F.
    const chips = text.split("\n")[0] ?? "";
    expect(chips).toContain("origins: HKG PVG SHA NRT HND ICN GMP");
    expect(chips).toContain("destinations: SEA");
    expect(chips).toContain("cabins: F");
    // The fixture starts on 2026-10-01, so "未来一个月" lands on the recorded window.
    expect(chips).toContain("dates: 2026-10-01..2026-10-30");

    // ASCII grid: at least one populated cell ("62k · — · 1 · american · 6小时*").
    expect(text).toContain("k ·");
    // GMP-SEA has no rows and no monitored route in the fixture → "not monitored", never blank.
    expect(text).toContain("n/m");
    expect(text).toContain("Data: seats.aero · calls used:");
    expect(text).toContain("served from cache: no");
    expect(text).toContain("Confirm on the program's site before transferring any points");

    // CSV: header + at least one data row, RFC-4180 CRLF.
    const csv = h.files.get("out.csv");
    expect(csv).toBeDefined();
    const lines = csv!.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/^date,origin,dest,program/);
    expect(lines[1]).toMatch(/^2026-10-\d{2},[A-Z]{3},SEA,\w+,/);
    expect(h.stderr()).toBe("");
  });

  it("every spelling of the example yields identical chips", async () => {
    const outputs: string[] = [];
    for (const [, text] of SPELLINGS) {
      const h = harness();
      expect(await runFindCli([text, "--fixture", FIXTURE, "--json"], h.io)).toBe(EXIT_OK);
      outputs.push((JSON.parse(h.stdout()) as FindCliJson).chips);
    }
    expect(new Set(outputs).size).toBe(1);
  });

  it("--json emits one machine-readable document with the query, grid and footer", async () => {
    const h = harness({ AWARDGRID_FIXTURE: FIXTURE });
    const code = await runFindCli(["HKG to SEA next month", "--json", "--orientation", "routes"], h.io);
    expect(code).toBe(EXIT_OK);
    const doc = JSON.parse(h.stdout()) as FindCliJson;
    expect(doc.query.origins).toEqual(["HKG"]);
    expect(doc.query.cabins).toEqual(["J", "F"]);
    expect(doc.grid.orientation).toBe("routes");
    expect(doc.grid.rows).toEqual(["HKG-SEA"]);
    expect(doc.grid.meta.api_calls_used).toBeGreaterThanOrEqual(1);
    expect(doc.footer).toContain("Data: seats.aero");
    expect(doc.chips).toBe(formatChips(doc.query));
  });

  it("--today overrides the fixture default and --lang picks the legend language", async () => {
    const h = harness();
    const code = await runFindCli(
      ["HKG to SEA next 3 days", "--fixture", FIXTURE, "--today", "2026-10-10", "--lang", "zh"],
      h.io,
    );
    expect(code).toBe(EXIT_OK);
    expect(h.stdout()).toContain("dates: 2026-10-10..2026-10-12");
    expect(h.stdout()).toContain("日期");
  });

  it("exits 2 with a clear message when the query cannot be parsed and no LLM key exists", async () => {
    const h = harness();
    const code = await runFindCli(["cheapest flights over Thanksgiving", "--fixture", FIXTURE], h.io);
    expect(code).toBe(EXIT_PARSE);
    expect(h.stderr()).toContain("Could not parse the query");
    expect(h.stderr()).toContain("ANTHROPIC_API_KEY");
    expect(h.stdout()).toBe("");
  });

  it("exits 2 on bad flags or a missing query, printing usage", async () => {
    const a = harness();
    expect(await runFindCli([], a.io)).toBe(EXIT_PARSE);
    expect(a.stderr()).toContain("usage:");
    const b = harness();
    expect(await runFindCli(["HKG to SEA", "--orientation", "sideways"], b.io)).toBe(EXIT_PARSE);
    expect(b.stderr()).toContain("--orientation");
    // A well-formed but impossible --today is a usage error (exit 2), not an unexpected crash.
    for (const bad of ["2026-13-45", "2026-02-30", "26-1-1"]) {
      const c = harness();
      expect(await runFindCli(["HKG to SEA next month", "--fixture", FIXTURE, "--today", bad], c.io)).toBe(EXIT_PARSE);
      expect(c.stderr()).toContain("--today");
      expect(c.stderr()).toContain("usage:");
      expect(c.stderr()).not.toContain("unexpected error");
    }
  });

  it("the help text tells users to type `pnpm run find` (bare `pnpm find` is pnpm's registry search)", () => {
    expect(USAGE.split("\n")[0]).toMatch(/^usage: pnpm run find /);
  });

  it("exits 4 without touching the network when no seats.aero key is set", async () => {
    const h = harness();
    const code = await runFindCli(["HKG to SEA next month"], h.io);
    expect(code).toBe(EXIT_API);
    expect(h.stderr()).toContain("SEATS_AERO_API_KEY is not set");
    expect(h.stderr()).toContain("per-user stored keys");
  });

  it("exits 4 on an API error and never prints the key", async () => {
    const KEY = "fake-test-key-must-never-print";
    const h = harness({ SEATS_AERO_API_KEY: KEY });
    h.io.fetch = async () => new Response(`forbidden for ${KEY}`, { status: 403 });
    const code = await runFindCli(["HKG to SEA next month"], h.io);
    expect(code).toBe(EXIT_API);
    const all = h.stdout() + h.stderr();
    expect(all).toContain("seats.aero request failed");
    expect(all).not.toContain(KEY);
  });

  it("live mode reuses Get Routes results from the on-disk cache on the next run", async () => {
    const { readFileSync } = await import("node:fs");
    const synthetic = JSON.parse(readFileSync(FIXTURE, "utf8")) as { data: Array<{ Route: { ID: string; OriginAirport: string; DestinationAirport: string; Source: string } }> };
    const KEY = "sk-live-routes-cache-9876";
    // One in-memory "disk" shared by two CLI processes.
    const files = new Map<string, string>();
    const routeHits: string[] = [];
    const live = (): Harness => {
      const h = harness({ SEATS_AERO_API_KEY: KEY, AWARDGRID_CACHE_DIR: "/cache" });
      h.io.readFile = async (p) => {
        const c = files.get(p);
        if (c === undefined) throw new Error("ENOENT");
        return c;
      };
      h.io.writeFile = async (p, c) => {
        files.set(p, c);
      };
      h.io.mkdir = async () => {};
      h.io.fetch = async (input) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname.endsWith("/search")) return new Response(JSON.stringify(synthetic), { status: 200 });
        if (url.pathname.endsWith("/routes")) {
          const source = url.searchParams.get("source") ?? "";
          routeHits.push(source);
          const routes = synthetic.data.filter((a) => a.Route.Source === source).map((a) => ({ ...a.Route, OriginRegion: "Asia", DestinationRegion: "North America", NumDaysOut: 300, Distance: 5000 }));
          return new Response(JSON.stringify(routes), { status: 200 });
        }
        return new Response("nf", { status: 404 });
      };
      return h;
    };
    const args = ["HKG GMP to SEA next month, alaska or united", "--today", "2026-10-01", "--json"];
    const first = live();
    expect(await runFindCli(args, first.io)).toBe(EXIT_OK);
    const doc1 = JSON.parse(first.stdout()) as FindCliJson;
    expect(routeHits).toEqual(["alaska", "united"]);
    expect(doc1.grid.meta.api_calls_used).toBe(3); // 1 search + 2 route lists
    expect(files.get("/cache/routes.json")).toContain('"cli:');
    expect(files.get("/cache/routes.json")).not.toContain(KEY);

    const second = live();
    expect(await runFindCli(args, second.io)).toBe(EXIT_OK);
    const doc2 = JSON.parse(second.stdout()) as FindCliJson;
    expect(routeHits).toEqual(["alaska", "united"]); // no new Get Routes calls
    expect(doc2.grid.meta.api_calls_used).toBe(1);
    expect(doc2.grid.meta.unmonitored_pairs).toEqual(doc1.grid.meta.unmonitored_pairs);
    expect(doc2.footer).not.toContain("route lists");
    expect(doc1.footer).toContain("2 for program route lists");
  });

  it("exits 3 before any request when the daily soft quota cannot cover the estimate", async () => {
    // 7 pairs × 92 days × 26 programs × 4 cabins × ROW_DENSITY ≈ 10k rows → 11 pages; soft limit 1.
    const h = harness({ SEATS_AERO_API_KEY: "fake-test-key-for-quota-test", SEATS_AERO_DAILY_SOFT_LIMIT: "1" });
    let fetched = 0;
    h.io.fetch = async () => {
      fetched += 1;
      return new Response("{}", { status: 500 });
    };
    const code = await runFindCli(
      ["HKG PVG SHA NRT HND ICN GMP to SEA from 2026-10-01 to 2026-12-31 economy business first premium"],
      h.io,
    );
    expect(code).toBe(EXIT_QUOTA);
    expect(fetched).toBe(0);
    expect(h.stderr()).toContain("quota");
    expect(h.stderr()).toContain("resets at");
  });
});

describe("helpers", () => {
  it("redact masks the key everywhere but keeps short/empty secrets untouched", () => {
    expect(redact("key abcdef1234 and abcdef1234", "abcdef1234")).toBe("key ••••1234 and ••••1234");
    expect(redact("nothing", undefined)).toBe("nothing");
    expect(redact("abc", "abc")).toBe("abc");
  });

  it("localISODate uses the local calendar day", () => {
    const d = new Date(2026, 8, 6, 1, 0, 0); // local 2026-09-06 01:00
    expect(localISODate(d)).toBe("2026-09-06");
  });
});
