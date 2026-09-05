/**
 * `pnpm run find "<query>" [--today YYYY-MM-DD] [--fixture path.json] [--csv out.csv]
 *                         [--orientation dates|routes] [--lang zh|en] [--width N] [--json]`
 * (`pnpm run` is required: bare `pnpm find` is pnpm's registry search — DECISIONS.md.)
 *
 * Thin process wrapper around `runFindCli` (src/cli/find-main.ts) so the integration test can
 * drive the same pipeline in-process. Exit codes: 0 ok · 2 parse problem · 3 quota · 4 API.
 */
import { runFindCli } from "@/cli/find-main";

const code = await runFindCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});
process.exitCode = code;
