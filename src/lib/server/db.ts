/**
 * Single indirection between route handlers / server components and the process-wide
 * SQLite handle, so tests can `vi.mock("@/lib/server/db")` and hand out an openTestDb().
 * Only used inside the Next.js app; the CLI/worker call getDb() directly.
 */
import { getDb, type Db } from "@/lib/db/client";

export type { Db };

export function getServerDb(): Db {
  return getDb();
}
