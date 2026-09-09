/**
 * The shell: router, one-time bootstrap, and the chrome every screen shares.
 *
 * `createHashRouter` rather than `createBrowserRouter`. Capacitor serves the app from
 * `capacitor://localhost`, where there is no server to rewrite unknown paths back to index.html —
 * so a browser-history route survives navigation but not a reload or a cold launch into a deep
 * link. A hash route needs no rewrite at all, and still leaves real URLs available for the
 * share/deep-link work in a later phase, which a memory router would foreclose.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, RouterProvider, createHashRouter } from "react-router";
import { type AppServices, bootstrap } from "./bootstrap";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

function Chrome({ services }: { services: AppServices }) {
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
          {[
            ["/", "Search"],
            ["/settings", "Settings"],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to!}
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
    bootstrap().then(setServices, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Persist on the way out. `pagehide` rather than `beforeunload`: iOS fires the former when the
  // app is backgrounded, which is the moment that actually matters on a phone.
  useEffect(() => {
    if (!services) return;
    const flush = () => void services.persist();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => window.removeEventListener("pagehide", flush);
  }, [services]);

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

  if (!services) return <div style={{ padding: 24, color: "var(--fg-muted)" }}>Starting…</div>;

  const router = createHashRouter([
    {
      path: "/",
      element: <Chrome services={services} />,
      children: [
        { index: true, element: <SearchScreen /> },
        { path: "settings", element: <SettingsScreen /> },
      ],
    },
  ]);

  return <RouterProvider router={router} />;
}
