/**
 * `pnpm run find "<query>"` — the fast lane end to end, in one process (kickoff §9 Phase 1).
 * (`run` is required: pnpm ≥ 10 reserves the bare `find` command for registry search, and
 * built-ins win over package.json scripts — see DECISIONS.md.)
 *
 *   NL text ──parseQuery──▶ QueryObject ──runFind──▶ AvailabilityRow[] ──buildGrid──▶ Grid
 *                                                                          └─▶ ASCII / CSV / JSON
 *
 * Everything is injected through `FindCliIo` (stdout, env, fetch, clock, file writer) so the
 * integration test runs the exact same code path without spawning a process or touching
 * the network. `find.ts` is the thin process wrapper.
 *
 * Keys: the CLI uses the caller's OWN seats.aero key from `SEATS_AERO_API_KEY` (the web app
 * uses per-user encrypted keys instead — there is no shared key, kickoff §0.2 #2). The key
 * is never printed; every message that reaches stdout/stderr is passed through `redact`.
 */
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  ParseError,
  parseQuery,
  resolveParserModel,
  type ParseQueryResult,
  type ParserClient,
} from "@/lib/query";
import type { QueryObject } from "@/lib/query";
import {
  InMemoryAvailabilityCache,
  InMemoryQuotaStore,
  Quota,
  QuotaExceededError,
  RoutesCatalog,
  SEATS_SOURCES,
  SeatsAeroError,
  SearchResponse,
  runFind,
  softLimitFromEnv,
  type Route,
  type SearchResponse as SearchResponseT,
} from "@/lib/seatsaero";
import { buildGrid, renderAscii, toCsv, type Grid, type Orientation } from "@/lib/grid";
import type { Lang } from "@/lib/grid/freshness";
import { FileRoutesStore, cliUserId, defaultRoutesCachePath } from "@/cli/routes-store";

/** Exit codes: 0 ok · 2 parse problem · 3 quota · 4 API/config error · 1 unexpected. */
export const EXIT_OK = 0;
export const EXIT_UNEXPECTED = 1;
export const EXIT_PARSE = 2;
export const EXIT_QUOTA = 3;
export const EXIT_API = 4;

/** The caveat every grid carries (kickoff §4.4). */
export const STALE_CAVEAT =
  "Confirm on the program's site before transferring any points — cached data can be stale and awards disappear.";

export const USAGE = `usage: pnpm run find "<query>" [--today YYYY-MM-DD] [--fixture path.json] [--csv out.csv]
                           [--orientation dates|routes] [--lang zh|en] [--width N] [--json]

  Note the "run": a bare "pnpm find" is pnpm's own registry search, not this tool.

  Data source: your OWN seats.aero Pro key in SEATS_AERO_API_KEY (the web app stores keys
  per user instead). With --fixture (or AWARDGRID_FIXTURE) a recorded Cached Search JSON is
  served from memory and no key or network is needed. ANTHROPIC_API_KEY is used only when
  the query cannot be parsed deterministically.
`;

/** Placeholder key for fixture mode: runFind refuses an empty key and the fake fetch ignores it. */
const FIXTURE_KEY = "fixture-mode-no-key";
/**
 * The CLI user in fixture mode. In live mode the user is derived from the key (cliUserId) so
 * the on-disk routes cache is per key. Quota and availability cache stay in-memory per process.
 */
const FIXTURE_USER = "cli:fixture";

export interface FindCliIo {
  stdout: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
  env: Record<string, string | undefined>;
  /** Real fetch for live mode; ignored in fixture mode (the fixture provides its own). */
  fetch?: typeof fetch;
  /** Clock for freshness/quota; defaults to now (live) or noon UTC of `--today` (fixture). */
  now?: () => Date;
  /** File IO, injectable for tests. */
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
  /** Parser LLM client factory; defaults to a real Anthropic client when the env has a key. */
  llmClient?: (apiKey: string) => ParserClient;
}

export interface FindCliArgs {
  query: string;
  today?: string;
  fixture?: string;
  csv?: string;
  orientation: Orientation;
  /** Legend/age language; defaults to the detected query language. */
  lang?: Lang;
  width?: number;
  json: boolean;
}

export function parseCliArgs(argv: readonly string[]): FindCliArgs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      today: { type: "string" },
      fixture: { type: "string" },
      csv: { type: "string" },
      orientation: { type: "string", default: "dates" },
      lang: { type: "string" },
      width: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const query = positionals.join(" ").trim();
  if (query.length === 0) throw new CliUsageError("missing query text");
  if (values.orientation !== "dates" && values.orientation !== "routes") {
    throw new CliUsageError(`--orientation must be "dates" or "routes", got "${values.orientation}"`);
  }
  if (values.lang !== undefined && values.lang !== "zh" && values.lang !== "en") {
    throw new CliUsageError(`--lang must be "zh" or "en", got "${values.lang}"`);
  }
  if (values.today !== undefined && !isCalendarDate(values.today)) {
    throw new CliUsageError(`--today must be a valid YYYY-MM-DD date, got "${values.today}"`);
  }
  let width: number | undefined;
  if (values.width !== undefined) {
    width = Number.parseInt(values.width, 10);
    if (!Number.isFinite(width) || width < 20) throw new CliUsageError(`--width must be an integer >= 20`);
  }
  return {
    query,
    today: values.today,
    fixture: values.fixture,
    csv: values.csv,
    orientation: values.orientation,
    lang: values.lang,
    width,
    json: values.json,
  };
}

/** YYYY-MM-DD that is also a real calendar day (2026-13-45 and 2026-02-30 are usage errors, not crashes). */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  return d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3]);
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * One-line "chips" summary of the parsed QueryObject. The kickoff's self-acceptance requires
 * a wrong expansion (e.g. a missing HND) to be VISIBLE, so every list is printed in full.
 */
export function formatChips(q: QueryObject): string {
  const flags = [
    q.direct_only ? "direct_only" : null,
    q.max_miles !== undefined ? `max_miles=${q.max_miles}` : null,
    `sort=${q.sort_by}`,
    `lang=${q.language}`,
  ].filter((f): f is string => f !== null);
  return [
    `origins: ${q.origins.join(" ")}`,
    `destinations: ${q.destinations.join(" ")}`,
    `dates: ${q.date_from}..${q.date_to}`,
    `cabins: ${q.cabins.join(" ")}`,
    `programs: ${q.programs && q.programs.length > 0 ? q.programs.join(" ") : "all"}`,
    `flags: ${flags.join(" ")}`,
  ].join(" | ");
}

/** Replace every occurrence of `secret` (when long enough to be a key) with a masked form. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join(`••••${secret.slice(-4)}`);
}

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

export interface LoadedFixture {
  response: SearchResponseT;
  /** Earliest `Date` in the fixture, used as the default `--today`. */
  earliest_date: string | null;
}

export async function loadFixture(path: string, read: (p: string) => Promise<string>): Promise<LoadedFixture> {
  const parsed = SearchResponse.safeParse(JSON.parse(await read(path)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CliUsageError(
      `fixture ${path} is not a seats.aero Cached Search response (${issue?.path.join(".")}: ${issue?.message})`,
    );
  }
  const dates = parsed.data.data.map((a) => a.Date.slice(0, 10)).sort();
  return { response: { ...parsed.data, hasMore: false }, earliest_date: dates[0] ?? null };
}

/**
 * A fetch that serves the fixture for /search and /availability (one page, `hasMore: false`)
 * and answers Get Routes from the routes embedded in the fixture rows, so "not monitored"
 * detection works offline exactly as it would against the API. Everything else is 404.
 */
export function fixtureFetch(fixture: SearchResponseT): typeof fetch {
  const routesBySource = new Map<string, Map<string, Route>>();
  for (const av of fixture.data) {
    const bucket = routesBySource.get(av.Source) ?? new Map<string, Route>();
    // Get Routes documents every field; an embedded route may omit the region/distance ones,
    // and only the airport pair matters for "not monitored" detection.
    bucket.set(av.Route.ID, {
      ...av.Route,
      OriginRegion: av.Route.OriginRegion ?? "",
      DestinationRegion: av.Route.DestinationRegion ?? "",
      NumDaysOut: av.Route.NumDaysOut ?? 0,
      Distance: av.Route.Distance ?? 0,
    });
    routesBySource.set(av.Source, bucket);
  }
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    if (path.endsWith("/search") || path.endsWith("/availability")) return json(fixture);
    if (path.endsWith("/routes")) {
      const source = url.searchParams.get("source") ?? "";
      return json([...(routesBySource.get(source)?.values() ?? [])]);
    }
    return json({ error: "not in fixture" }, 404);
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface FindCliJson {
  query: QueryObject;
  chips: string;
  warnings: string[];
  used_llm: boolean;
  grid: Grid;
  footer: string;
  caveat: string;
}

/** Runs the whole pipeline; returns the process exit code. Never throws for expected failures. */
export async function runFindCli(argv: readonly string[], io: FindCliIo): Promise<number> {
  const out = (s: string) => io.stdout.write(s);
  const err = (s: string) => (io.stderr ?? io.stdout).write(s);
  const secret = io.env.SEATS_AERO_API_KEY;
  const readFileFn = io.readFile ?? ((p: string) => readFile(p, "utf8"));
  const writeFileFn = io.writeFile ?? ((p: string, c: string) => writeFile(p, c, "utf8"));

  let args: FindCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (e) {
    err(`${redact(messageOf(e), secret)}\n\n${USAGE}`);
    return EXIT_PARSE;
  }

  try {
    // ---- data source -------------------------------------------------------
    const fixturePath = args.fixture ?? io.env.AWARDGRID_FIXTURE;
    const fixture = fixturePath ? await loadFixture(fixturePath, readFileFn) : null;

    // `today` drives relative dates ("next month"); in fixture mode it defaults to the
    // fixture's first date so a relative query lands on the recorded window.
    const clock =
      io.now ??
      (fixture
        ? () => new Date(`${args.today ?? fixture.earliest_date ?? localISODate(new Date())}T12:00:00Z`)
        : () => new Date());
    const today = args.today ?? (fixture?.earliest_date ?? localISODate(clock()));

    // ---- parse -------------------------------------------------------------
    const anthropicKey = io.env.ANTHROPIC_API_KEY;
    const llmClient = anthropicKey
      ? (io.llmClient ?? ((key: string) => new Anthropic({ apiKey: key })))(anthropicKey)
      : undefined;
    let parsed: ParseQueryResult;
    try {
      parsed = await parseQuery(args.query, {
        today,
        llmClient,
        model: resolveParserModel(io.env),
      });
    } catch (e) {
      if (e instanceof ParseError) {
        const missing = e.missing.length > 0 ? ` (missing: ${e.missing.join(", ")})` : "";
        const hint =
          !anthropicKey && e.missing.length > 0
            ? "\nSet ANTHROPIC_API_KEY to let the language-model parser fill these in, or rephrase the query.\n"
            : "\n";
        err(`Could not parse the query${missing}: ${redact(e.message, secret)}${hint}`);
        return EXIT_PARSE;
      }
      throw e;
    }
    const query = parsed.query;
    const lang: Lang = args.lang ?? (query.language === "zh" ? "zh" : "en");
    const chips = formatChips(query);
    if (!args.json) {
      out(`${chips}\n`);
      if (parsed.used_llm) out(`(places/dates completed by the language model — check the chips above)\n`);
      for (const w of parsed.warnings) out(`warning: ${w}\n`);
    }

    // ---- fetch -------------------------------------------------------------
    let apiKey: string;
    let fetchFn: typeof fetch | undefined;
    if (fixture) {
      apiKey = FIXTURE_KEY;
      fetchFn = fixtureFetch(fixture.response);
    } else {
      if (!secret || secret.trim() === "") {
        err(
          "SEATS_AERO_API_KEY is not set. The CLI needs your own seats.aero Pro key (the web app uses\n" +
            "per-user stored keys instead). Or pass --fixture <cached-search.json> to run offline.\n",
        );
        return EXIT_API;
      }
      apiKey = secret;
      fetchFn = io.fetch;
    }

    const quota = new Quota({ store: new InMemoryQuotaStore(), softLimit: softLimitFromEnv(io.env), now: clock });
    // Live mode persists Get Routes results for 7 days (routes.ts TTL) so repeated runs do not
    // re-spend up to 26 calls per empty pair; fixture mode keeps everything in memory.
    const routesStore = fixture
      ? undefined
      : new FileRoutesStore({
          path: defaultRoutesCachePath(io.env),
          readFile: readFileFn,
          writeFile: writeFileFn,
          ...(io.mkdir ? { mkdir: io.mkdir } : {}),
        });
    const result = await runFind({
      query,
      userId: fixture ? FIXTURE_USER : cliUserId(apiKey),
      apiKey,
      ...(fetchFn ? { fetch: fetchFn } : {}),
      quota,
      cache: new InMemoryAvailabilityCache(),
      routes: new RoutesCatalog({ now: clock, ...(routesStore ? { store: routesStore } : {}) }),
      now: clock,
      maxRoutesCalls: SEATS_SOURCES.length,
    });

    // ---- grid --------------------------------------------------------------
    const now = clock();
    const grid = buildGrid(result.rows, query, {
      orientation: args.orientation,
      now,
      unmonitored_pairs: result.unmonitored_pairs,
      api_calls_used: result.api_calls_used,
      served_from_cache: result.served_from_cache,
    });
    const routeNote = result.routes_calls_used > 0 ? ` (${result.routes_calls_used} for program route lists, cached 7 days)` : "";
    const footer =
      `Data: seats.aero · calls used: ${result.api_calls_used}${routeNote} · served from cache: ${result.served_from_cache ? "yes" : "no"}` +
      (fixture ? " · source: fixture" : "");

    if (args.csv) await writeFileFn(args.csv, toCsv(grid));

    if (args.json) {
      const doc: FindCliJson = {
        query,
        chips,
        warnings: [...parsed.warnings, ...result.warnings],
        used_llm: parsed.used_llm,
        grid,
        footer,
        caveat: STALE_CAVEAT,
      };
      out(`${JSON.stringify(doc, null, 2)}\n`);
      return EXIT_OK;
    }

    out(`\n${renderAscii(grid, { now, lang, ...(args.width !== undefined ? { width: args.width } : {}) })}`);
    for (const w of result.warnings) out(`warning: ${redact(w, secret)}\n`);
    out(`${footer}\n${STALE_CAVEAT}\n`);
    if (args.csv) out(`CSV written to ${args.csv}\n`);
    return EXIT_OK;
  } catch (e) {
    const message = redact(messageOf(e), secret);
    if (e instanceof CliUsageError) {
      err(`${message}\n\n${USAGE}`);
      return EXIT_PARSE;
    }
    if (e instanceof QuotaExceededError) {
      err(`${message}\n`);
      return EXIT_QUOTA;
    }
    if (e instanceof SeatsAeroError) {
      err(`seats.aero request failed: ${message}\n`);
      return EXIT_API;
    }
    err(`unexpected error: ${message}\n`);
    return EXIT_UNEXPECTED;
  }
}

/** The user's LOCAL calendar day (a query typed at 01:00 CST means "today" there, not UTC's yesterday). */
export function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
