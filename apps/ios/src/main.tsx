import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installWebViewFetchGuard } from "./native/webview-fetch-guard";
import "./styles.css";

// Before anything renders: from here on the WebView's own fetch cannot reach api.anthropic.com or seats.aero,
// which this app reaches only over native HTTP (see src/native/webview-fetch-guard.ts for why both hosts).
installWebViewFetchGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
