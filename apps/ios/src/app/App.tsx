/**
 * The shell: router, one-time bootstrap, and the chrome every screen shares.
 *
 * `createHashRouter` rather than `createBrowserRouter`. Capacitor serves the app from
 * `capacitor://localhost`, where there is no server to rewrite unknown paths back to index.html —
 * so a browser-history route survives navigation but not a reload or a cold launch into a deep
 * link. A hash route needs no rewrite at all, and still leaves real URLs available for the
 * share/deep-link work in a later phase, which a memory router would foreclose.
 *
 * This is also where watches are checked: once when the app opens and again each time it returns
 * to the foreground, and at no other time. There is no background check (../watch/capabilities.ts).
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NavLink, Outlet, RouterProvider, createHashRouter } from "react-router";
import { type AppServices, bootstrap } from "./bootstrap";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { WatchesScreen } from "../screens/WatchesScreen";

/**
 * Probe build only (VITE_AG_PROBES=1, apps/ios/probes/run-probes.sh): the #/probes screen and the probe transport.
 * In every other build this is the constant false, both imports are dropped, and no probe code or probe host is in
 * the bundle, which R1 checks.
 */
const PROBES = import.meta.env.VITE_AG_PROBES === "1";
const ProbesScreen = PROBES ? lazy(() => import("../probes/ProbesScreen").then((m) => ({ default: m.ProbesScreen }))) : null;

/**
 * How many watches have changes the user has not looked at yet.
 *
 * An external store, not state plus a listener: when the app reloads onto #/watches, the Watches screen
 * mounts in the same commit as this chrome, its effect runs first (child effects before parent effects)
 * and clears the changes before a listener here would exist. `useSyncExternalStore` re-reads after
 * subscribing, so the count cannot be left stale.
 */
function useUnseenCount(services: AppServices): number {
  const subscribe = useCallback((onChange: () => void) => services.onWatchesChanged(onChange), [services]);
  return useSyncExternalStore(subscribe, () => services.watches.all().filter((w) => w.unseen).length);
}

function Chrome({ services }: { services: AppServices }) {
  const unseen = useUnseenCount(services);
  const nav: Array<[string, string]> = [
    ["/", "Search"],
    ["/watches", unseen > 0 ? `Watches (${unseen})` : "Watches"],
    ["/settings", "Settings"],
  ];
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header
        className="chrome-top chrome-x"
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          paddingBottom: 10,
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-raised)",
        }}
      >
        <strong style={{ fontSize: 16 }}>awardgrid</strong>
        <nav style={{ display: "flex", gap: 12 }} aria-label="Main navigation">
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              style={({ isActive }) => ({
                textDecoration: "none",
                color: isActive ? "var(--accent)" : "var(--fg-muted)",
                fontWeight: isActive ? 600 : 400,
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="chrome-x" style={{ flex: 1, paddingTop: 16, paddingBottom: 16 }}>
        <Outlet context={services} />
      </main>

      {/*
        LEGAL.md: "Every screen that shows award data carries the attribution 'Data: seats.aero'".
        It lives in the shell so no screen can forget it.
      */}
      <footer
        className="chrome-bottom chrome-x"
        style={{ paddingTop: 10, borderTop: "1px solid var(--line)", color: "var(--fg-muted)", fontSize: 12, background: "var(--bg-raised)" }}
      >
        Data: seats.aero · your own key, on this device
      </footer>
    </div>
  );
}

export function App() {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A probe build sends seats.aero requests to the local mock (../probes/probe-transport.ts); any other build is unchanged.
    const booted = PROBES ? import("../probes/probe-transport").then((m) => bootstrap(m.probeBootstrapOptions())) : bootstrap();
    booted.then(setServices, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!services) return;
    // Check watches now that the app is open…
    void services.checkWatches();

    // …persist on the way out, and check again on the way back in. `pagehide` and a hidden
    // visibility state are what iOS delivers when the app is backgrounded. The Phase 2 version added
    // an anonymous visibilitychange listener it could never remove; these are named so they are.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void services.persist();
      else void services.checkWatches();
    };
    const onPageHide = () => void services.persist();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [services]);

  // Created once per bootstrap. Re-creating the router on every render would reset navigation.
  const router = useMemo(
    () =>
      services
        ? createHashRouter([
            {
              path: "/",
              element: <Chrome services={services} />,
              children: [
                { index: true, element: <SearchScreen /> },
                { path: "watches", element: <WatchesScreen /> },
                { path: "settings", element: <SettingsScreen /> },
                ...(ProbesScreen
                  ? [
                      {
                        path: "probes",
                        element: (
                          <Suspense fallback={null}>
                            <ProbesScreen />
                          </Suspense>
                        ),
                      },
                    ]
                  : []),
              ],
            },
          ])
        : null,
    [services],
  );

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 18 }}>awardgrid could not start</h1>
        {/*
          The startup assertion in src/native/http.ts lands here. PIVOT §2 asks for exactly this:
          a missing native bridge must fail loudly at launch, not silently at the first search
          where it would look like a seats.aero outage.
        */}
        <p style={{ color: "var(--error)" }}>{error}</p>
      </div>
    );
  }

  if (!services || !router) return <div style={{ padding: 24, color: "var(--fg-muted)" }}>Starting…</div>;

  return <RouterProvider router={router} />;
}
