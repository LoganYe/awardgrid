import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules", "vendor", "build", ".next"],
    environment: "node",
    // Tests must never reach the network (Definition of done); TZ pinned so date tests are stable
    // (the DST test overrides TZ explicitly).
    env: { TZ: "UTC" },
    testTimeout: 15000,
    clearMocks: true,
  },
});
