import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules", "vendor", "build", ".next"],
    environment: "node",
    // Tests must never reach the network (Definition of done).
    env: { AWARDGRID_TEST: "1", TZ: "UTC" },
    testTimeout: 15000,
    clearMocks: true,
  },
});
