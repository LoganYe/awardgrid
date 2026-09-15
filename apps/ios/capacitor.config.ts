import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dowhiz.awardgrid",
  appName: "awardgrid",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      // FALSE, deliberately, and this is load-bearing rather than tidy.
      //
      // `true` monkey-patches window.fetch and XMLHttpRequest to route through the native
      // bridge. PIVOT §2 rejects relying on that patch: it "silently falls back to WebView
      // fetch in some call shapes — a fallback that surfaces as a CORS error in production, on
      // a device". Phase 0 confirmed the consequence: a WebView fetch to seats.aero fails with
      // `TypeError: Load failed` while the same URL over the bridge returns a readable response.
      //
      // Leaving it off means every seats.aero byte must go through src/native/http.ts
      // explicitly. Nothing reaches the API by accident, and the startup assertion there fails
      // loudly if the bridge is ever missing.
      enabled: false,
    },
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
