import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dowhiz.awardgrid.phase0",
  appName: "awardgrid Phase 0",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      // FALSE ON PURPOSE, and this is the load-bearing line of the spike.
      //
      // `enabled: true` monkey-patches window.fetch and XMLHttpRequest to route through the
      // native bridge. PIVOT §2 rejects relying on that patch: it "does not honour
      // AbortSignal on native, and silently falls back to WebView fetch in some call shapes —
      // a fallback that surfaces as a CORS error in production, on a device."
      //
      // Keeping it false buys two things:
      //   1. window.fetch stays the genuine WKWebView fetch, so probe P1 is a real control
      //      rather than a patched impostor, and the P1/P2 differential means something.
      //   2. Nothing reaches seats.aero except through src/nativeFetch.ts, explicitly.
      enabled: false,
    },
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
