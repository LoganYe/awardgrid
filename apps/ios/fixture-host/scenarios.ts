/**
 * TEST-ONLY: the environment each synthetic scenario gives the real app.
 *
 * The scenario list and the rows are the handoff pack's synthetic JSON, copied verbatim into
 * packages/core/test/fixtures/uiux/. Every value is invented; none is a seats.aero payload or a real fare.
 *
 * A scenario is only usable once the state it names can really be produced. Each id is either SEEDED (its
 * defining state is applied below) or refused with the task that will seed it. A scenario is never booted as
 * "the base environment with a different name": a test asserting that something is absent would otherwise
 * pass without testing anything (docs/02 D10, no silent fallback).
 */
import availability from "@awardgrid/core/test-fixtures/uiux/availability-rows.json";
import { fixtureQuery, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { describeQuery } from "@awardgrid/core/workspace/query-editor";
import manifest from "@awardgrid/core/test-fixtures/uiux/scenarios.json";
import { DEFAULT_PREFERENCES, WORKSPACE_NAMESPACE } from "../src/workspace/workspace-store";

/** The row shape in availability-rows.json: core's AvailabilityRow fields, as plain JSON. */
export interface SyntheticRow {
  program: string;
  origin: string;
  dest: string;
  date: string;
  cabin: "Y" | "W" | "J" | "F";
  miles: number;
  fees_cents: number | null;
  currency: string | null;
  seats_left: number;
  direct: boolean;
  airlines: string[];
  computed_last_seen: string | null;
  source_id: string;
  booking_url: string | null;
  fetched_at: string;
  include_filtered: boolean;
  min_cabin_pct: number;
}

export interface FixtureScenario {
  id: string;
  coverage: string;
  rowIndexes: number[];
  purpose: string;
  rowOverrides?: Record<string, Partial<SyntheticRow>>;
}

/** A route seats.aero's Get Routes would list for a program: the pair is monitored. */
export interface SyntheticRoute {
  program: string;
  origin: string;
  dest: string;
}

export interface FixtureEnvironment {
  scenario: FixtureScenario;
  /** The fixed clock every scenario runs on (scenarios.json `now`). */
  now: Date;
  /** A fake seats.aero key, or null when the scenario is about having none. Never a real key. */
  seatsKey: string | null;
  /** A fake Anthropic key for the AI scenarios only. Ordinary search never needs one. */
  anthropicKey: string | null;
  /** The synthetic rows the fake transport serves, overrides applied. */
  rows: SyntheticRow[];
  /** What Get Routes lists. A pair missing here is unmonitored. */
  routes: SyntheticRoute[];
  /** Files present before launch (e.g. a quota snapshot), written straight into the host's file store. */
  files: Record<string, string>;
  /** Every write through the file store fails, as a full or read-only disk would. */
  failWrites: boolean;
  /**
   * How the stand-in answers a Cached Search / Bulk Availability request: with the rows, never (a search still in
   * flight), or with a 500 (a search that failed). Get Routes always answers.
   */
  searchMode: "answer" | "hold" | "fail";
}

/** Obviously fake, never a key shape any provider issues, and short enough that the masked form is readable. */
export const FIXTURE_SEATS_KEY = "fixture-not-a-real-key";
export const FIXTURE_ANTHROPIC_KEY = "fixture-not-a-real-anthropic-key";

/**
 * Scenarios whose defining state this host produces today. Every other id in scenarios.json is refused with the
 * task that adds it, so a test cannot run against a state that is not there. Widen this as tasks land.
 */
export const SEEDED_SCENARIOS: ReadonlySet<string> = new Set([
  "complete",
  "complete-empty",
  "unmonitored",
  "no-seats-key",
  "no-ai-key",
  "quota-low",
  "multi-program",
  "storage-failure",
  "foundations",
  "inflight-old",
  "failed-old",
]);

/** Where an unseeded scenario's state comes from. Informational, for the refusal message. */
const SEEDED_BY: Record<string, string> = {
  // T03 built the evidence; these states become visible once result cards show coverage.
  partial: "T07 (coverage on result cards)",
  "coverage-unknown": "T07 (coverage on result cards)",
  "legacy-cache": "T07 (coverage on result cards)",
  "favorite-snapshot": "T13 (favourites)",
  "watch-baseline": "T14 (watch migration)",
  "watch-changes": "T14 (watch migration)",
  "watch-failure": "T14 (watch migration)",
  "ai-pending": "T16 (proposals)",
  "ai-stale": "T16 (proposals)",
  "ai-stopped": "T17 (request coordination)",
  "long-labels": "T21 (text scaling)",
  "web-user-a": "T18 (web surface)",
  "web-user-b": "T18 (web surface)",
};

export class UnknownScenarioError extends Error {
  constructor(id: string | null) {
    super(id ? `Unknown synthetic scenario: ${id}` : "No scenario given (?scenario=<id> from scenarios.json).");
    this.name = "UnknownScenarioError";
  }
}

export class UnseededScenarioError extends Error {
  constructor(id: string) {
    super(`Scenario "${id}" is not seeded by the fixture host yet (${SEEDED_BY[id] ?? "no task named"}).`);
    this.name = "UnseededScenarioError";
  }
}

const CABIN_LETTERS: ReadonlySet<string> = new Set(["Y", "W", "J", "F"]);

function syntheticRow(index: number): SyntheticRow {
  const raw = availability.rows[index] as (Omit<SyntheticRow, "cabin"> & { cabin: string }) | undefined;
  if (!raw) throw new Error(`availability-rows.json has no row ${index}.`);
  if (!CABIN_LETTERS.has(raw.cabin)) throw new Error(`availability-rows.json row ${index} has cabin "${raw.cabin}".`);
  return { ...raw, cabin: raw.cabin as SyntheticRow["cabin"] };
}

/** Every pair the synthetic query covers, per program the query names: the monitored catalog. */
function queryRoutes(rows: readonly SyntheticRow[]): SyntheticRoute[] {
  const routes = new Map<string, SyntheticRoute>();
  const programs = availability.query.programs;
  for (const program of programs)
    for (const origin of availability.query.origins)
      for (const dest of availability.query.destinations) routes.set(`${program}|${origin}|${dest}`, { program, origin, dest });
  for (const row of rows) routes.set(`${row.program}|${row.origin}|${row.dest}`, { program: row.program, origin: row.origin, dest: row.dest });
  return [...routes.values()];
}

/** The quota file the app restores at launch, with today's calls already at the soft limit. */
function quotaAtSoftLimit(now: Date): string {
  const day = now.toISOString().slice(0, 10);
  // apps/ios/src/store/quota-store.ts QuotaSnapshot, version 1. 950 = core DEFAULT_SOFT_LIMIT: no headroom.
  return JSON.stringify({ version: 1, days: { [day]: 950 } });
}

/**
 * A workspace saved by an earlier launch, holding one snapshot of the synthetic query made two hours before the
 * scenario's clock, with the scenario's rows. Its text is the sentence the editor writes for that query, so the text
 * on screen describes the saved search exactly (the synthetic "…October…" text would read as 18–31 October on the
 * day the snapshot was made, not the 1–30 October it holds). Written in the device format: SlotFileStorage's first slot,
 * `{generation, value}`, value being the WorkspaceStore's saved shape. The workspace spec proves the app restores it.
 */
function savedWorkspace(rows: readonly SyntheticRow[], now: Date): Record<string, string> {
  const wanted = new Set(rows.map((r) => `${r.program}|${r.source_id}|${r.date}|${r.cabin}`));
  const query = fixtureQuery();
  const described = { ...query, raw_text: describeQuery(query) };
  const base = fixtureSnapshot({
    id: "fixture-previous-snapshot",
    revision: 1,
    query: described,
    createdAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    receipt: { sentCalls: 2, fromCache: false },
  });
  const snapshot = { ...base, rows: base.rows.filter((r) => wanted.has(`${r.value.program}|${r.value.source_id}|${r.value.date}|${r.value.cabin}`)) };
  const value = { schemaVersion: 1, revision: 1, displayedId: snapshot.id, previousId: null, preferences: DEFAULT_PREFERENCES, snapshots: [snapshot] };
  return { [`${WORKSPACE_NAMESPACE}.a.json`]: JSON.stringify({ generation: 1, value }) };
}

const scenarios: readonly FixtureScenario[] = manifest.scenarios;

export function environmentFor(id: string | null): FixtureEnvironment {
  const scenario = id ? scenarios.find((s) => s.id === id) : undefined;
  if (!scenario) throw new UnknownScenarioError(id);
  if (!SEEDED_SCENARIOS.has(scenario.id)) throw new UnseededScenarioError(scenario.id);
  const now = new Date(manifest.now);
  const rows = scenario.rowIndexes.map((index) => ({ ...syntheticRow(index), ...(scenario.rowOverrides?.[String(index)] ?? {}) }));
  return {
    scenario,
    now,
    seatsKey: scenario.id === "no-seats-key" ? null : FIXTURE_SEATS_KEY,
    anthropicKey: scenario.id.startsWith("ai-") ? FIXTURE_ANTHROPIC_KEY : null,
    rows,
    // "unmonitored": the provider's catalog does not list the pair at all ("explicit routes catalog").
    routes: scenario.id === "unmonitored" ? [] : queryRoutes(rows),
    files:
      scenario.id === "quota-low"
        ? { "quota.json": quotaAtSoftLimit(now) }
        : scenario.id === "inflight-old" || scenario.id === "failed-old"
          ? savedWorkspace(rows, now)
          : {},
    failWrites: scenario.id === "storage-failure",
    searchMode: scenario.id === "inflight-old" ? "hold" : scenario.id === "failed-old" ? "fail" : "answer",
  };
}
