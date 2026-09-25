/**
 * The web cache keeps AvailabilityRow.time_basis and provider_updated_at (UI/UX v1 T02, migration 0003, column
 * time_evidence).
 *
 * Without them a cache hit would silently lose which clock computed_last_seen came from, and a stale row could be
 * read as freshly updated by the provider. Rows written before the migration — or rewritten by a build that does
 * not know the column — read back WITHOUT provenance, which the new surfaces show as "provider time unknown"
 * (packages/core/src/lib/workspace/semantics.ts rowTimeEvidence).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "@/lib/db/client";
import { createSqliteAvailabilityCache, decodeTimeEvidence } from "@/lib/db/stores/cache";
import { seedUsers, testDbWithUsers } from "@/lib/db/stores/testing";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";

function row(overrides: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "american",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-05",
    cabin: "J",
    miles: 70000,
    fees_cents: null,
    currency: null,
    seats_left: 2,
    direct: true,
    airlines: ["CX"],
    computed_last_seen: "2026-10-01T10:00:00Z",
    source_id: "id1",
    booking_url: null,
    fetched_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

/** drizzle's better-sqlite3 handle carries its connection as $client; the repo's Db alias does not declare it. */
function closeDb(db: Db): void {
  (db as Db & { $client: { close(): void } }).$client.close();
}

const scope = { origins: ["HKG"], dests: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J" as const, "F" as const] };

describe("time_basis in the SQLite availability cache", () => {
  it("round-trips every basis, and a row without one stays without", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    const rows = [
      row({ date: "2026-10-05", time_basis: "provider_last_seen", provider_updated_at: "2026-09-30T00:00:00Z" }),
      row({ date: "2026-10-06", time_basis: "provider_updated", provider_updated_at: "2026-10-01T10:00:00Z" }),
      row({ date: "2026-10-07", time_basis: "local_fallback" }),
      row({ date: "2026-10-08" }),
    ];
    await cache.putRows("u", rows);
    const back = (await cache.getRows("u", scope)).rows.sort((a, b) => a.date.localeCompare(b.date));
    expect(back).toEqual(rows);
    expect("time_basis" in back[3]!).toBe(false);
  });

  it("ignores provenance written for a different fetch: an older build that rewrote the values without the column", async () => {
    const db = testDbWithUsers(["u"]);
    const cache = createSqliteAvailabilityCache(db);
    await cache.putRows("u", [row({ time_basis: "provider_last_seen", computed_last_seen: "2026-09-20T10:00:00Z" })]);
    // What a pre-0003 upsert does: every value column replaced, time_evidence untouched.
    db.run(sql`UPDATE availability_cache SET computed_last_seen = '2026-10-02T12:00:00.000Z', fetched_at = '2026-10-02T12:00:00.000Z'`);
    const [back] = (await cache.getRows("u", scope)).rows;
    expect(back!.computed_last_seen).toBe("2026-10-02T12:00:00.000Z");
    expect("time_basis" in back!).toBe(false);
  });

  it("treats malformed evidence as none", () => {
    const at = "2026-10-01T12:00:00.000Z";
    expect(decodeTimeEvidence(null, at)).toBeNull();
    expect(decodeTimeEvidence("{", at)).toBeNull();
    expect(decodeTimeEvidence(JSON.stringify({ basis: "provider", updated: null, at }), at)).toBeNull();
    expect(decodeTimeEvidence(JSON.stringify({ basis: "provider_updated", updated: 5, at }), at)).toBeNull();
    expect(decodeTimeEvidence(JSON.stringify({ basis: "provider_updated", updated: null }), at)).toBeNull();
    expect(decodeTimeEvidence(JSON.stringify({ basis: "local_fallback", updated: null, at }), at)).toEqual({ basis: "local_fallback", updated: null });
  });

  it("a later fetch replaces the basis along with the values", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    await cache.putRows("u", [row({ time_basis: "local_fallback" })]);
    await cache.putRows("u", [row({ time_basis: "provider_last_seen", computed_last_seen: "2026-10-02T00:00:00Z" })]);
    const [back] = (await cache.getRows("u", scope)).rows;
    expect(back).toMatchObject({ time_basis: "provider_last_seen", computed_last_seen: "2026-10-02T00:00:00Z" });
  });
});

describe("migration 0003 on a database created before it", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("adds the column in place; old rows keep every value and read back with no basis", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "awardgrid-0003-"));
    dirs.push(root);
    // The migrations folder as it was before 0003: the first three SQL files and a three-entry journal.
    const before = path.join(root, "drizzle-before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    const repoDrizzle = path.resolve(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(repoDrizzle, "meta", "_journal.json"), "utf8"));
    const earlier = journal.entries.filter((e: { idx: number }) => e.idx <= 2);
    expect(earlier.map((e: { tag: string }) => e.tag)).toEqual(["0000_init", "0001_users_theme", "0002_query_runs_calls_used"]);
    for (const e of earlier) copyFileSync(path.join(repoDrizzle, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: earlier }));

    const file = path.join(root, "db.sqlite");
    const old = openDb({ path: file, migrationsFolder: before });
    seedUsers(old, ["u"]);
    old.run(sql`INSERT INTO availability_cache
      (user_id, program, origin, dest, date, cabin, miles, fees_cents, currency, seats_left, direct, airlines, computed_last_seen, source_id, booking_url, fetched_at)
      VALUES ('u', 'american', 'HKG', 'SEA', '2026-10-05', 'J', 70000, NULL, NULL, 2, 1, '["CX"]', '2026-10-01T10:00:00Z', 'id1', NULL, '2026-10-01T12:00:00.000Z')`);
    closeDb(old);

    const upgraded = openDb({ path: file });
    const [back] = (await createSqliteAvailabilityCache(upgraded).getRows("u", scope)).rows;
    closeDb(upgraded);
    expect(back).toEqual(row());
    expect("time_basis" in back!).toBe(false);
  });
});
