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
import { describeQuery, draftFromQuery } from "@awardgrid/core/workspace/query-editor";
import { snapshot } from "@awardgrid/core/watch";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import manifest from "@awardgrid/core/test-fixtures/uiux/scenarios.json";
import { FAVORITES_NAMESPACE } from "../src/store/favorites-store";
import { DEFAULT_PREFERENCES, WORKSPACE_NAMESPACE } from "../src/workspace/workspace-store";
import { SEEDED_SCENARIOS } from "./seeded";

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
  /**
   * T16: what the scripted Anthropic proposes before it answers, for `ai-pending`; null answers text only. A shape the
   * tool layer validates like any proposal, never a search it runs.
   */
  aiProposal: Record<string, unknown> | null;
}

/** Obviously fake, never a key shape any provider issues, and short enough that the masked form is readable. */
export const FIXTURE_SEATS_KEY = "fixture-not-a-real-key";
export const FIXTURE_ANTHROPIC_KEY = "fixture-not-a-real-anthropic-key";

export { SEEDED_SCENARIOS };

/** Where an unseeded scenario's state comes from. Informational, for the refusal message. */
const SEEDED_BY: Record<string, string> = {};

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
 * The snapshot an earlier launch made: the synthetic query, two hours before the scenario's clock, with the scenario's
 * rows and coverage. Its text is the sentence the editor writes for that query, so the text on screen describes the
 * saved search exactly (the synthetic "…October…" text would read as 18–31 October on the day the snapshot was made,
 * not the 1–30 October it holds).
 */
function savedSnapshot(rows: readonly SyntheticRow[], now: Date, coverage: string) {
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
  let kept = base.rows.filter((r) => wanted.has(`${r.value.program}|${r.value.source_id}|${r.value.date}|${r.value.cabin}`));
  let evidence = base.coverage;
  if (coverage === "partial") {
    // Stopped at the page cap: the pairs are partial, not proven checked to the end.
    evidence = { ...base.coverage, state: "partial", slices: base.coverage.slices.map((sl) => ({ ...sl, state: "partial" as const, reason: "page_cap" as const })) };
  } else if (coverage === "unknown") {
    // A cache from before coverage evidence (or one restoreCoverage could not prove): nothing is claimed.
    evidence = { state: "unknown", scopeKey: base.scopeKey, slices: [] };
  }
  if (coverage === "unknown" && rows.length > 1) {
    // legacy-cache: rows from before time provenance — no basis, so the provider's time is not inferred.
    kept = kept.map((r) => {
      const { time_basis: _basis, ...value } = r.value;
      return { ...r, value, time: { basis: "unknown" as const, providerAt: null, fetchedAt: r.time.fetchedAt } };
    });
  }
  return { ...base, rows: kept, coverage: evidence };
}

/**
 * A workspace saved by an earlier launch, holding that one snapshot. Written in the device format: SlotFileStorage's
 * first slot, `{generation, value}`, value being the WorkspaceStore's saved shape. The workspace spec proves the app
 * restores it.
 */
function savedWorkspace(rows: readonly SyntheticRow[], now: Date, coverage: string): Record<string, string> {
  const snapshot = savedSnapshot(rows, now, coverage);
  const value = { schemaVersion: 1, revision: 1, displayedId: snapshot.id, previousId: null, preferences: DEFAULT_PREFERENCES, snapshots: [snapshot] };
  return { [`${WORKSPACE_NAMESPACE}.a.json`]: JSON.stringify({ generation: 1, value }) };
}

/**
 * Saved results from an earlier launch (T13): one favourite, a copy of that launch's snapshot, saved an hour after it
 * was made, in the device format (SlotFileStorage's first slot; value in FavoritesStore's saved shape).
 */
function savedFavorites(rows: readonly SyntheticRow[], now: Date, coverage: string): Record<string, string> {
  const snapshot = savedSnapshot(rows, now, coverage);
  const favorite = {
    schemaVersion: 1,
    id: "fixture-favorite-1",
    savedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    query: snapshot.query,
    rows: snapshot.rows,
    coverage: snapshot.coverage,
    originalSnapshotId: snapshot.id,
  };
  return { [`${FAVORITES_NAMESPACE}.a.json`]: JSON.stringify({ generation: 1, value: { schemaVersion: 1, items: [favorite] } }) };
}

/**
 * One watch from an earlier launch (T14), in the device format (watches.json, version 2): the synthetic query as its
 * structured conditions, with the state its scenario names.
 *   - watch-baseline: never checked; the check at launch sets the baseline and reports nothing new.
 *   - watch-changes: checked two hours ago, with changes found then and not seen yet; its baseline is what the
 *     transport answers now, so the check at launch is quiet and must keep them.
 *   - watch-failure: checked two hours ago; the check at launch fails (the transport refuses), and the baseline stays.
 */
function savedWatches(id: string, rows: readonly SyntheticRow[], now: Date): Record<string, string> {
  const query = fixtureQuery();
  const described = { ...query, raw_text: describeQuery(query) };
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const checked = id !== "watch-baseline";
  const cells = snapshot(rows as unknown as AvailabilityRow[]);
  const [first, second] = cells;
  const watch = {
    id: "fixture-watch-1",
    name: described.raw_text.length > 60 ? `${described.raw_text.slice(0, 59)}…` : described.raw_text,
    text: described.raw_text,
    draft: draftFromQuery(described),
    review: null,
    lastCheckedAt: checked ? at(2) : null,
    lastAttemptAt: checked ? at(2) : null,
    baseline: checked ? cells : [],
    baselineWindow: checked ? { date_from: query.date_from, date_to: query.date_to } : null,
    dropThresholdPct: 10,
    lastResult: checked ? { at: at(2), status: "checked", firstCheck: false, compared: { date_from: query.date_from, date_to: query.date_to } } : null,
    unseen: id === "watch-changes" ? { new: 1, dropped: 0, cheaper: 1, since: at(2) } : null,
    unseenChanges:
      id === "watch-changes" && first && second
        ? [
            { kind: "new", key: second.key, before: null, after: { miles: second.miles, fees_cents: second.fees_cents }, at: at(2) },
            { kind: "cheaper", key: first.key, before: { miles: first.miles + 10000, fees_cents: first.fees_cents }, after: { miles: first.miles, fees_cents: first.fees_cents }, at: at(2) },
          ]
        : null,
    enabled: true,
    createdAt: at(24),
  };
  return { "watches.json": JSON.stringify({ version: 2, watches: [watch] }) };
}

const scenarios: readonly FixtureScenario[] = manifest.scenarios;

/** Scenarios that open on results a previous launch saved: nothing is fetched to show them. */
const SAVED_RESULTS: ReadonlySet<string> = new Set(["inflight-old", "failed-old", "missing-values", "partial", "coverage-unknown", "legacy-cache", "ai-pending", "ai-stale", "ai-stopped", "long-labels"]);

/**
 * `ai-stopped`: a conversation saved by an earlier launch whose one question was stopped while its request to
 * Anthropic was out. That request may still have completed and been billed; Anthropic never reported its usage; no
 * next step ran. Its counts are lower bounds.
 */
function stoppedConversation(now: Date): Record<string, string> {
  const at = new Date(now.getTime() - 3_600_000).toISOString();
  const entry = {
    id: "fixture-ask-stopped-1",
    question: "Which program has the cheapest seats in this search?",
    includeSearch: true,
    context: { sent: "query_only", snapshotId: "fixture-previous-snapshot", revision: 1, refs: [], earlier: 0 },
    askedAt: at,
    steps: [],
    texts: [],
    usage: { requests: 1, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, lastRequestInputTokens: null, toolCalls: 0, seatsCalls: 0 },
    end: { status: "stopped", committed: false, failure: null, stoppedDuring: "request", at },
  };
  const conversation = { id: "fixture-conversation-stopped", createdAt: at, committed: [], entries: [entry], seenIds: [], bookingUrls: [], flightsMemo: [], pending: null };
  return { "ask.json": JSON.stringify({ version: 1, conversation }) };
}

/** The synthetic search with a later end: what `ai-pending`'s scripted answer proposes, and `ai-stale`'s leftover. */
function widerSearch(): Record<string, unknown> {
  const q = fixtureQuery();
  return {
    origins: q.origins,
    destinations: q.destinations,
    date_from: "2026-10-18",
    date_to: "2026-11-06",
    cabins: q.cabins,
    programs: q.programs ?? null,
    direct_only: q.direct_only,
    max_miles: null,
    min_cabin_pct: q.min_cabin_pct,
    include_filtered: q.include_filtered,
  };
}

/**
 * `ai-stale`: a conversation saved by an earlier launch (ask.json, version 1) whose one answered question left a
 * pending proposal made for revision 0. The workspace saved with it is at revision 1, so the proposal is stale.
 */
function staleConversation(now: Date): Record<string, string> {
  const at = new Date(now.getTime() - 3 * 3_600_000).toISOString();
  const query = { ...fixtureQuery(), raw_text: describeQuery(fixtureQuery()) };
  const wider = widerSearch();
  const proposed = { ...query, ...wider, max_miles: undefined, raw_text: "" };
  const entry = {
    id: "fixture-ask-entry-1",
    question: "Is there anything later in the autumn?",
    includeSearch: true,
    context: { sent: "query_only", snapshotId: "fixture-before-snapshot", revision: 0, refs: [], earlier: 0 },
    askedAt: at,
    steps: [{ kind: "tool", step: { tool: "propose_query_change", outcome: "ok", calls: 0, fromCache: false, fromMemo: false, search: null, program: null, estimate: null } }],
    texts: ["A later window may have seats. I proposed it for you to review."],
    usage: { requests: 2, inputTokens: 240, cacheReadTokens: 0, outputTokens: 48, lastRequestInputTokens: 120, toolCalls: 1, seatsCalls: 0 },
    end: { status: "answered", committed: false, failure: null, stoppedDuring: null, at },
    proposals: [{ id: "fixture-proposal-1", baseRevision: 0, proposed, reason: "A later end date may find seats.", status: "pending", base: query }],
  };
  const conversation = { id: "fixture-conversation-1", createdAt: at, committed: [], entries: [entry], seenIds: [], bookingUrls: [], flightsMemo: [], pending: null };
  return { "ask.json": JSON.stringify({ version: 1, conversation }) };
}

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
        : SAVED_RESULTS.has(scenario.id)
          ? {
              ...savedWorkspace(rows, now, scenario.coverage),
              ...(scenario.id === "ai-stale" ? staleConversation(now) : {}),
              ...(scenario.id === "ai-stopped" ? stoppedConversation(now) : {}),
            }
          : scenario.id === "favorite-snapshot"
            ? savedFavorites(rows, now, scenario.coverage)
            : scenario.id.startsWith("watch-")
              ? savedWatches(scenario.id, rows, now)
              : {},
    failWrites: scenario.id === "storage-failure",
    searchMode: scenario.id === "inflight-old" ? "hold" : scenario.id === "failed-old" || scenario.id === "watch-failure" ? "fail" : "answer",
    aiProposal: scenario.id === "ai-pending" ? { ...widerSearch(), reason: "The person already agreed to a later end date; run it." } : null,
  };
}
