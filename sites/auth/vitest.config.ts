import { defineConfig } from "vitest/config";

/** The same discipline as every package here: node environment, TZ pinned, and no network (seats.aero is a fake). */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" },
    testTimeout: 15000,
    clearMocks: true,
  },
});
