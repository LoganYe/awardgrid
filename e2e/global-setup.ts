/**
 * Playwright globalSetup: make sure a production build exists. Note that Playwright starts the
 * `webServer` entries BEFORE globalSetup, so e2e/start-app.sh performs the same check first;
 * this remains as the documented, explicit guard (and covers reuseExistingServer edge cases).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export default function globalSetup(): void {
  const root = path.resolve(import.meta.dirname, "..");
  if (existsSync(path.join(root, ".next", "BUILD_ID"))) return;
  console.log("e2e: .next/BUILD_ID missing — running `next build` (run `pnpm build` beforehand to skip this)");
  const result = spawnSync("pnpm", ["exec", "next", "build"], { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`next build failed with status ${result.status}`);
}
