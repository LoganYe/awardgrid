import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dowhiz.awardgrid",
  appName: "AwardGrid",
  webDir: "dist",
  // The bridge's console log prints every plugin call and its answer: the tokens the Keychain hands back, and every
  // seats.aero response the native HTTP adapter carries. "debug" keeps that to a Debug build of the native app (Xcode's
  // Run on the developer's own phone); a Release build, which is every TestFlight and App Store build, prints none of
  // it. Written out rather than left to Capacitor's default, so a change of default cannot turn it on in Release.
  loggingBehavior: "debug",
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
    // "never": the page pads its own chrome with env(safe-area-inset-*) (viewport-fit=cover in index.html), so the
    // web view must not inset it as well. "always" did both, and left a page one screen tall scrollable by the
    // inset: an empty band above the title on an iPhone, or the title under an iPad window's controls, depending on
    // launch timing. AppViewController.swift sets the same and adds the window controls to the safe area (PR-D).
    contentInset: "never",
  },
};

export default config;
