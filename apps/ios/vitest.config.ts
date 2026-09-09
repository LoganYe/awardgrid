import { defineConfig } from "vitest/config";

/**
 * Same discipline as the root and the core package: node environment, TZ pinned so no test
 * depends on what time it runs, and no network.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "ios"],
    environment: "node",
    env: { TZ: "UTC" },
    testTimeout: 15000,
    clearMocks: true,
  },
});
