/**
 * Kickoff §9 Phase-2 self-acceptance, end to end through the real stack:
 * seed (invite → register → AES-encrypted seats.aero connection) → findGridForUser (decrypt →
 * runFind over the SQLite stores) for two users with two different connections.
 *
 *   (a) caches and quotas are independent per user;
 *   (b) neither token appears in any api_usage / cache row — nor anywhere else in the database.
 *
 * No network (fake fetch over the synthetic fixture), no env keys (test MASTER_KEY passed in),
 * fake clock. Reuses the dev seed so the seeded state matches `pnpm exec tsx scripts/seed-dev.ts`.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authenticate } from "@/lib/auth/users";
import { parseMasterKey } from "@/lib/crypto/aes";
import { openTestDb, type Db } from "@/lib/db/client";
import {
  apiUsage,
  availabilityCache,
  cacheCoverage,
  inviteCodes,
  routesCache,
  seatsConnections,
  sessions,
  userKeys,
  users,
} from "@/lib/db/schema";
import { readConnection } from "@/lib/seats-oauth/store";
import { QueryObject } from "@awardgrid/core/query/schema";
import type { Route } from "@awardgrid/core/seatsaero/types";
import { findGridForUser } from "@/lib/server/find";
import { getTodayUsage } from "@/lib/server/usage";
import { DEV_PASSWORD, DEV_USERS, seedDevDb } from "../../scripts/seed-dev";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";

const TEST_MASTER_KEY = parseMasterKey("a".repeat(64));
const NOW = new Date("2026-10-01T12:00:00Z");
const ALICE = DEV_USERS[0]!;
const BOB = DEV_USERS[1]!;

const query = QueryObject.parse({
  origins: [...SYNTHETIC_ORIGINS],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  programs: [...SYNTHETIC_PROGRAMS],
  raw_text: "two users",
  language: "en",
});

function syntheticRoutes(source: string): Route[] {
  return SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
    ID: `${source}-${o}`,
    OriginAirport: o,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

const synthetic = generateSynthetic();

function seatsAeroFake() {
  return fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
}

/** Every table that could conceivably hold key material, as one JSON blob. */
function dumpDatabase(db: Db): string {
  const tables = [users, inviteCodes, sessions, userKeys, seatsConnections, apiUsage, availabilityCache, cacheCoverage, routesCache];
  return JSON.stringify(Object.fromEntries(tables.map((t) => [getTableName(t), db.select().from(t).all()])));
}

async function seeded() {
  const db = openTestDb();
  const out = await seedDevDb(db, { masterKey: TEST_MASTER_KEY, now: () => NOW });
  const alice = out.find((s) => s.user.username === ALICE.username)!.user;
  const bob = out.find((s) => s.user.username === BOB.username)!.user;
  return { db, alice, bob };
}

describe("two seeded users with two seats.aero connections (kickoff §9 Phase 2)", () => {
  it("seed creates both users with distinct encrypted connections and is idempotent", async () => {
    const { db, alice, bob } = await seeded();
    expect(ALICE.seatsAccess).not.toBe(BOB.seatsAccess);
    expect(alice.id).not.toBe(bob.id);

    // Password works through the real argon2 path; the invite was consumed.
    expect((await authenticate(db, { username: "alice", password: DEV_PASSWORD })).id).toBe(alice.id);
    await expect(authenticate(db, { username: "bob", password: "wrong-password" })).rejects.toThrow();
    expect(db.select().from(inviteCodes).all().every((i) => i.usedBy !== null)).toBe(true);

    // Round-trips under the master key, each sealed to its own account.
    expect(readConnection(db, alice.id, TEST_MASTER_KEY)?.tokens.access).toBe(ALICE.seatsAccess);
    expect(readConnection(db, bob.id, TEST_MASTER_KEY)?.tokens.access).toBe(BOB.seatsAccess);
    expect(db.select().from(userKeys).all()).toEqual([]);

    // Re-seeding neither duplicates users nor burns another invite.
    const again = await seedDevDb(db, { masterKey: TEST_MASTER_KEY, now: () => NOW });
    expect(again.map((s) => s.created)).toEqual([false, false]);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(inviteCodes).all()).toHaveLength(2);
  });

  it("(a) caches and quotas are independent; each request carries only its owner's token", async () => {
    const { db, alice, bob } = await seeded();
    const fetch = seatsAeroFake();
    const opts = { fetch, masterKey: TEST_MASTER_KEY, now: () => NOW };

    const a1 = await findGridForUser(db, alice, query, opts);
    const expectedCalls = 1 + SYNTHETIC_PROGRAMS.length; // one search page + Get Routes per program
    expect(a1.grid.meta.served_from_cache).toBe(false);
    expect(a1.grid.meta.api_calls_used).toBe(expectedCalls);
    expect(a1.quota.used).toBe(expectedCalls);
    expect(fetch.calls).toHaveLength(expectedCalls);
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === `Bearer ${ALICE.seatsAccess}`)).toBe(true);

    // Bob's identical query is NOT served from alice's cache: he pays under his own connection.
    const b1 = await findGridForUser(db, bob, query, opts);
    expect(b1.grid.meta.served_from_cache).toBe(false);
    expect(b1.grid.meta.api_calls_used).toBe(expectedCalls);
    const bobCalls = fetch.calls.slice(expectedCalls);
    expect(bobCalls).toHaveLength(expectedCalls);
    expect(bobCalls.every((c) => c.headers["partner-authorization"] === `Bearer ${BOB.seatsAccess}`)).toBe(true);
    expect(bobCalls.some((c) => c.headers["partner-authorization"] === `Bearer ${ALICE.seatsAccess}`)).toBe(false);

    // Same grid content for both (same fixture), separately owned rows.
    expect(b1.grid.cells.length).toBe(a1.grid.cells.length);
    const cacheRows = db.select().from(availabilityCache).all();
    expect(cacheRows.filter((r) => r.userId === alice.id)).toHaveLength(cacheRows.length / 2);
    expect(cacheRows.filter((r) => r.userId === bob.id)).toHaveLength(cacheRows.length / 2);

    // Quotas count independently, in api_usage and in the Settings page's usage view.
    expect(db.select().from(apiUsage).all().map((r) => [r.userId, r.provider, r.calls])).toEqual([
      [alice.id, "seats_aero", expectedCalls],
      [bob.id, "seats_aero", expectedCalls],
    ]);
    expect(getTodayUsage(db, alice.id, { now: NOW }).used).toBe(expectedCalls);
    expect(getTodayUsage(db, bob.id, { now: NOW }).used).toBe(expectedCalls);

    // Within the TTL both are served from their own cache at zero cost.
    const later = { ...opts, now: () => new Date(NOW.getTime() + 20 * 60_000) };
    const a2 = await findGridForUser(db, alice, query, later);
    const b2 = await findGridForUser(db, bob, query, later);
    expect(a2.grid.meta.served_from_cache).toBe(true);
    expect(b2.grid.meta.served_from_cache).toBe(true);
    expect(fetch.calls).toHaveLength(2 * expectedCalls);
    expect(a2.quota.used).toBe(expectedCalls);
    expect(b2.quota.used).toBe(expectedCalls);
  });

  it("(b) neither token appears in any api_usage / cache row, nor anywhere else in the database", async () => {
    const { db, alice, bob } = await seeded();
    const fetch = seatsAeroFake();
    const opts = { fetch, masterKey: TEST_MASTER_KEY, now: () => NOW };
    await findGridForUser(db, alice, query, opts);
    await findGridForUser(db, bob, query, opts);

    const dump = dumpDatabase(db);
    expect(dump.length).toBeGreaterThan(10_000); // the dump really contains the cache rows
    for (const secret of [ALICE.seatsAccess, BOB.seatsAccess, ALICE.seatsRefresh, BOB.seatsRefresh, DEV_PASSWORD, "FAKE-SEATS", "seats:ot"]) {
      expect(dump).not.toContain(secret);
    }
    // The ciphertext is not the plaintext.
    for (const row of db.select().from(seatsConnections).all()) {
      const spec = row.userId === alice.id ? ALICE : BOB;
      expect(Buffer.from(row.ciphertext, "base64").toString("utf8")).not.toContain(spec.seatsAccess);
    }
    // The grid payloads handed to the client carry no key material either.
    const a = await findGridForUser(db, alice, query, opts);
    const payload = JSON.stringify(a);
    expect(payload).not.toContain(ALICE.seatsAccess);
    expect(payload).not.toContain("seats:ot");
  });
});
