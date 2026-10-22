import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openTestDb, type Db } from "./client";
import { users } from "./schema";

/** drizzle's better-sqlite3 handle carries its connection as $client; the repo's Db alias does not declare it. */
function sqliteOf(db: Db): Database.Database {
  return (db as Db & { $client: Database.Database }).$client;
}

describe("db", () => {
  it("applies migrations to an in-memory database", () => {
    const db = openTestDb();
    db.insert(users)
      .values({ id: "u1", username: "alice", passwordHash: "x", createdAt: "2026-09-06T00:00:00Z" })
      .run();
    const rows = db.select().from(users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timezone).toBe("UTC");
  });
  it("overwrites what it deletes (secure_delete), so deleted rows do not stay in the file", () => {
    expect(sqliteOf(openTestDb()).pragma("secure_delete", { simple: true })).toBe(1);
  });
  it("enforces unique usernames", () => {
    const db = openTestDb();
    const v = { id: "u1", username: "alice", passwordHash: "x", createdAt: "t" };
    db.insert(users).values(v).run();
    expect(() => db.insert(users).values({ ...v, id: "u2" }).run()).toThrow();
  });
});
