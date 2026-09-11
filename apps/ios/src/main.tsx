import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installWebViewFetchGuard } from "./native/webview-fetch-guard";
import "./styles.css";

// Before anything renders: from here on the WebView's own fetch cannot reach api.anthropic.com or seats.aero,
// which this app reaches only over native HTTP (see src/native/webview-fetch-guard.ts for why both hosts).
installWebViewFetchGuard();

// A probe build (VITE_AG_PROBES=1, apps/ios/probes/run-probes.sh) opens on its probes screen, set before the router
// reads the hash. In every other build the condition is the constant false and the line is dropped.
if (import.meta.env.VITE_AG_PROBES === "1") window.location.hash = "#/probes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
