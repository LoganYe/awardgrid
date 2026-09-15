import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The core's own test runner. Mirrors the root vitest.config.ts deliberately — same node
 * environment, same TZ=UTC, same no-network rule — because these are the same 281 tests that
 * have always run, moved and not rewritten.
 *
 * The `@` alias is what makes "moved, not rewritten" literally true: every test here imports
 * "@/lib/seatsaero/types" and friends, exactly as it did when this code lived at the repo root.
 * Pointing `@` at this package's own `src` keeps all 25 files byte-identical. The kickoff is
 * blunt about why that matters: a PR that edits any *.test.ts under packages/core is rejected
 * on sight, because these tests encode behaviour that took months to get right.
 *
 * The other half of "no edits" is the directory layout. Nine of these tests reach fixtures by
 * relative path ("../../../test/fixtures/grid/rows"), and query/places.ts reads
 * "../../../data/places.json". Mirroring the repo's shape inside the package — src/lib/…,
 * test/fixtures/…, data/… — makes those specifiers resolve here without touching a line.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules"],
    environment: "node",
    // Tests must never reach the network, and TZ is pinned so date tests do not depend on
    // what time they run (the DST test overrides TZ explicitly).
    env: { TZ: "UTC" },
    testTimeout: 15000,
    clearMocks: true,
  },
});
