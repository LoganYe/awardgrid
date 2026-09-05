import { describe, expect, it } from "vitest";
import { openTestDb } from "./client";
import { users } from "./schema";

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
  it("enforces unique usernames", () => {
    const db = openTestDb();
    const v = { id: "u1", username: "alice", passwordHash: "x", createdAt: "t" };
    db.insert(users).values(v).run();
    expect(() => db.insert(users).values({ ...v, id: "u2" }).run()).toThrow();
  });
});
