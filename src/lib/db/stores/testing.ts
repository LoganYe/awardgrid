/**
 * Test-only helpers for the SQLite stores. Foreign keys are ON in openDb(), so every
 * user_id used by a store must exist in `users` first.
 */
import type { Db } from "@/lib/db/client";
import { openTestDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export function seedUsers(db: Db, ids: readonly string[]): void {
  db.insert(users)
    .values(ids.map((id) => ({ id, username: id, passwordHash: "test-hash", createdAt: "2026-09-06T00:00:00.000Z" })))
    .run();
}

/** Fresh in-memory database with the given users present. */
export function testDbWithUsers(ids: readonly string[]): Db {
  const db = openTestDb();
  seedUsers(db, ids);
  return db;
}
