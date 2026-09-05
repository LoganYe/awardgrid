/**
 * The real process entrypoint (src/cli/find.ts via tsx), spawned once against the fixture so
 * the wiring in find.ts — not only runFindCli — is exercised. No network: fixture mode never
 * fetches, and the env is stripped of every key. Runs the same binary `pnpm run find` runs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE = join(ROOT, "test", "fixtures", "seatsaero", "synthetic-example-query.json");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

describe("src/cli/find.ts entrypoint", () => {
  it.skipIf(!existsSync(TSX))("runs the kickoff §9 query from the fixture and exits 0", () => {
    // A stripped env: no ANTHROPIC/SEATS keys can leak into the child even if the shell has them.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TZ: "UTC", NODE_ENV: "test" };
    const res = spawnSync(TSX, ["src/cli/find.ts", "香港,上海,东京,首尔到西雅图 未来一个月 头等", "--fixture", FIXTURE, "--width", "400"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("origins: HKG PVG SHA NRT HND ICN GMP");
    expect(res.stdout).toContain("Data: seats.aero");
    expect(res.stderr).toBe("");
  });
});
