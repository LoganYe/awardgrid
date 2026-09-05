import { openDb, resolveDbPath } from "@/lib/db/client";

// openDb runs the migrations as a side effect when asked to; nothing else to do here.
openDb({ migrate: true });
console.log(`migrated ${resolveDbPath()}`);
