/**
 * `pnpm admin <command>` — invite codes, user listing, session revocation (kickoff §5, §9).
 * Thin wrapper: parse argv → open the SQLite file (DATABASE_PATH) → run the command from
 * src/cli/admin-lib.ts. Never prints hashes, keys or tokens.
 */
import { AdminUsageError, USAGE, parseAdminArgs, runAdminCommand } from "@/cli/admin-lib";
import { openDb } from "@/lib/db/client";

let exitCode: number;
try {
  const cmd = parseAdminArgs(process.argv.slice(2));
  const db = openDb();
  exitCode = runAdminCommand(db, cmd, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} catch (err) {
  if (err instanceof AdminUsageError) {
    process.stderr.write(`awardgrid admin: ${err.message}\n\n${USAGE}\n`);
    exitCode = 2;
  } else {
    process.stderr.write(`awardgrid admin: ${err instanceof Error ? err.message : "unexpected error"}\n`);
    exitCode = 1;
  }
}
process.exitCode = exitCode;
