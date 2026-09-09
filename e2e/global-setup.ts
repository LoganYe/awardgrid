/**
 * Playwright globalSetup: make sure a production build exists, and that the server the tests are
 * about to drive is actually serving THAT build.
 *
 * Playwright starts the `webServer` entries BEFORE globalSetup, so e2e/start-app.sh performs the
 * build check first; this remains as the documented, explicit guard.
 *
 * The second check exists because the first one is not enough, and the gap cost two long debugging
 * sessions before it was written down. `playwright.config.ts` sets `reuseExistingServer: !isCI`, so
 * locally Playwright adopts whatever already answers on the app port. If that process was started
 * against an EARLIER build and `.next/` has since been rebuilt, its HTML references chunk filenames
 * that no longer exist on disk: every stylesheet 404s, the pages render unstyled, and the suite
 * fails in ways that look exactly like a design regression — muted text computing to pure white,
 * strict-mode violations from a DOM that never got its CSS. The build on disk is fine; the server
 * is the stale thing. Failing here, with that sentence, is worth more than 160 mystery failures.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { APP_URL } from "../playwright.config";

export default async function globalSetup(): Promise<void> {
  const root = path.resolve(import.meta.dirname, "..");
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("e2e: .next/BUILD_ID missing — running `next build` (run `pnpm build` beforehand to skip this)");
    const result = spawnSync("pnpm", ["exec", "next", "build"], { cwd: root, stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`next build failed with status ${result.status}`);
  }

  await assertServerServesCurrentBuild();
}

/**
 * Fetch a page and confirm every stylesheet it references still resolves. A stale reused server
 * fails this immediately; a correct one costs one request per stylesheet.
 */
async function assertServerServesCurrentBuild(): Promise<void> {
  let html: string;
  try {
    const res = await fetch(`${APP_URL}/login`);
    if (!res.ok) throw new Error(`GET /login returned ${res.status}`);
    html = await res.text();
  } catch (err) {
    // The webServer step already waited for the port, so this is not "not up yet".
    throw new Error(`e2e: could not read ${APP_URL}/login to verify the running build — ${String(err)}`);
  }

  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
  if (hrefs.length === 0) return; // No stylesheet to check; nothing to assert.

  const stale: string[] = [];
  for (const href of hrefs) {
    const url = href.startsWith("http") ? href : `${APP_URL}${href}`;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) stale.push(`${href} → ${res.status}`);
    } catch (err) {
      stale.push(`${href} → ${String(err)}`);
    }
  }

  if (stale.length > 0) {
    throw new Error(
      [
        `e2e: the server on ${APP_URL} is serving a STALE build — its stylesheets no longer exist:`,
        ...stale.map((s) => `  ${s}`),
        "",
        "playwright.config.ts sets reuseExistingServer locally, so Playwright adopted a `next start`",
        "left over from an earlier run, and `.next/` has been rebuilt underneath it. Every page would",
        "render unstyled and the failures would look like a design regression rather than a stale",
        "process.",
        "",
        "Fix: stop that server and re-run. Take care to stop the right one —",
        "docs/DEPLOYMENT.md runs the LIVE site with `next start` on 127.0.0.1:3000 behind a Cloudflare",
        "Tunnel, which is NOT the e2e app and must be left alone.",
      ].join("\n"),
    );
  }
}
