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
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NavLink, Outlet, RouterProvider, createHashRouter, useLocation } from "react-router";
import { type AppServices, type BootstrapOptions, bootstrap } from "./bootstrap";
import { RESULTS } from "../components/results/copy";
import { Button, Icon, type IconName, applyThemePreference } from "../components/ui";
import { FAVORITES } from "../screens/favorites-copy";
import { WithTail } from "./WithTail";
import { installKeyboardInset } from "./keyboard";
import { installAppearanceBridge, postAppearance } from "../native/appearance";
import { installSystemTextSize } from "../native/text-size";
import { type Locale, langTag, useLocale } from "./locale";
import { TraySlot } from "./tray-slot";
import { AskScreen } from "../screens/AskScreen";
import { CompareScreen } from "../screens/CompareScreen";
import { QueryEditorScreen } from "../screens/QueryEditorScreen";
import { DetailScreen } from "../screens/DetailScreen";
import { ExampleScreen } from "../screens/OnboardingScreen";
import { FavoritesScreen, SavedScreen } from "../screens/FavoritesScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { AnthropicKeyScreen, SeatsKeyScreen, SettingsScreen } from "../screens/SettingsScreen";
import { WatchesScreen } from "../screens/WatchesScreen";

/**
 * Probe build only (VITE_AG_PROBES=1, apps/ios/probes/run-probes.sh): the #/probes screen and the probe transport.
 * In every other build this is the constant false, both imports are dropped, and no probe code or probe host is in
 * the bundle, which R1 checks.
 */
const PROBES = import.meta.env.VITE_AG_PROBES === "1";
const ProbesScreen = PROBES ? lazy(() => import("../probes/ProbesScreen").then((m) => ({ default: m.ProbesScreen }))) : null;
/**
 * E2e build only (VITE_AG_PROBES=e2e, apps/ios/probes/run-probes.sh --e2e): the app as shipped, with its transports
 * pointed at the probe server and the seats.aero mock, and a driver that runs step 7's Simulator scenarios through the
 * services. In every other build this is the constant false as well, and R1 checks the same way.
 */
const E2E = import.meta.env.VITE_AG_PROBES === "e2e";

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
  const count = () => services.watches.all().filter((w) => w.unseen).length;
  // The same read serves a server render, which app-chrome.test.ts uses; the app itself renders only on the device.
  return useSyncExternalStore(subscribe, count, count);
}

/** Whether a question is under way. The service runs it, not the Ask screen, so the Search header says so. */
export function useAskRunning(services: Pick<AppServices, "ask">): boolean {
  return useSyncExternalStore(services.ask.subscribe, services.ask.isRunning, services.ask.isRunning);
}

/**
 * A full-height page outside the tab chrome (UI/UX v1 T06: the query editor, docs/04 S02). It shows no award data,
 * so it carries no data attribution; the screens it returns to do.
 */
export function FullPage({ services }: { services: AppServices }) {
  return (
    <main>
      <Outlet context={services} />
    </main>
  );
}

/**
 * The tab chrome (UI/UX v1 T07; docs/04 S01; reference results-light.png): the screen in a scrolling area, and a
 * bottom tab bar — Search, Watches, Saved (T13), Settings — above the home indicator. AI assistance
 * is reached from the Search header, which also says when a question is under way. The page itself never scrolls (the
 * shell's html/body overflow rule would stop sticky headers), the area above the bar does.
 *
 * LEGAL.md: "Every screen that shows award data carries the attribution 'Data: seats.aero'". The Search screen says it
 * in its status line; every other screen in the chrome carries it at the end of its content.
 */
export function Chrome({ services }: { services: AppServices }) {
  const unseen = useUnseenCount(services);
  const locale = useLocale(services);
  const t = RESULTS[locale];
  const { pathname } = useLocation();
  // An option's details (T10) open over the Search screen, which stays as it is underneath: same scroll, same chrome.
  // The comparison (T12) opens over the Search screen the same way.
  const detailOpen = pathname.startsWith("/detail/") || pathname === "/compare";
  const place = detailOpen ? "/" : pathname;
  const onSearch = place === "/";
  // One scrolling area serves every tab, so each tab's position is kept and restored when it is shown again.
  const main = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const shownPath = useRef(place);
  useLayoutEffect(() => {
    const el = main.current;
    if (!el || shownPath.current === place) return;
    positions.current.set(shownPath.current, el.scrollTop);
    el.scrollTop = positions.current.get(place) ?? 0;
    shownPath.current = place;
  }, [place]);
  const [traySlot, setTraySlot] = useState<HTMLDivElement | null>(null);
  const saveProblem = useSyncExternalStore(services.saveStatus.subscribe, services.saveStatus.get, services.saveStatus.get);
  const tabs: Array<{ to: string; icon: IconName; label: string; badge: number }> = [
    { to: "/", icon: "search", label: t.tabs.search, badge: 0 },
    { to: "/watches", icon: "bell", label: t.tabs.watches, badge: unseen },
    { to: "/saved", icon: "bookmark", label: t.tabs.saved, badge: 0 },
    { to: "/settings", icon: "gear", label: t.tabs.settings, badge: 0 },
  ];
  return (
    <TraySlot.Provider value={traySlot}>
    <div className="app-shell">
      <main ref={main} className={onSearch ? "app-main" : "app-main app-page chrome-x"} onScroll={(e) => positions.current.set(place, e.currentTarget.scrollTop)}>
        <Outlet context={services} />
        {/* Not on Search (its status line says it), Settings (its About says it) or the example (made up, not seats.aero's). */}
        {onSearch || place === "/settings" || place === "/example" ? null : <p className="app-attribution">{t.attribution}</p>}
      </main>
      <SaveProblemBar services={services} problem={saveProblem} locale={locale} />
      {/* The comparison bar (T12) sits here, above the tab bar and outside the scrolling area, so it never covers a
          result, a focused control or the matrix (SearchScreen portals it in). */}
      <div ref={setTraySlot} className="app-tray-slot" />
      <nav className="app-tabs" aria-label={t.tabsLabel} lang={langTag(locale)} inert={detailOpen || undefined}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === "/"} className="app-tab">
            <Icon name={tab.icon} />
            <span className="app-tab-label">{tab.label}</span>
            {tab.badge > 0 ? (
              <>
                <span className="app-tab-badge" aria-hidden="true">
                  {tab.badge}
                </span>
                <span className="sr-only">{t.unseen(tab.badge)}</span>
              </>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
    </TraySlot.Provider>
  );
}

/**
 * What the whole app follows, whichever route is shown (T11): the appearance and language chosen in Settings, on
 * <html> so a sheet or anything else outside a screen's own root has them too, and the keyboard's height.
 */
export function ShellEffects({ services }: { services: Pick<AppServices, "settings" | "locale"> }) {
  const locale = useLocale(services);
  const theme = useSyncExternalStore(services.settings.subscribe, services.settings.theme, services.settings.theme);
  useLayoutEffect(() => {
    applyThemePreference(theme);
    // The native side paints what shows around the page with the same appearance (T22, U-042).
    postAppearance(theme);
  }, [theme]);
  useEffect(() => installAppearanceBridge(() => services.settings.theme()), [services]);
  useLayoutEffect(() => {
    document.documentElement.lang = langTag(locale);
  }, [locale]);
  useEffect(() => installKeyboardInset(), []);
  // Dynamic Type drives the page's text scale, 100–200% (T22; A35's native half).
  useEffect(() => installSystemTextSize(), []);
  return null;
}

/**
 * A save that failed (T13, U-046): one short line above the tab bar, the storage's own words behind "Details", and
 * "Try saving again", which shows it is working and says how it went. It gives way to the keyboard, as the tab bar
 * does, so it never takes the screen. When a retry succeeds the bar goes, and focus goes to the page's title.
 */
function SaveProblemBar({ services, problem, locale }: { services: AppServices; problem: ReturnType<AppServices["saveStatus"]["get"]>; locale: Locale }) {
  const f = FAVORITES[locale];
  const [trying, setTrying] = useState(false);
  const [said, setSaid] = useState("");
  const retry = async () => {
    setTrying(true);
    setSaid("");
    const report = await services.persist();
    setTrying(false);
    window.requestAnimationFrame(() => {
      setSaid(report.ok ? f.saveFixed : f.saveRetried);
      if (report.ok) document.querySelector<HTMLElement>("main h1")?.focus();
    });
  };
  return (
    <>
      {/* Always in the tree, so the outcome of a retry is announced even when the bar has gone. */}
      <p role="status" className="sr-only">
        {said}
      </p>
      {problem ? (
        <div className="app-save-problem" role="alert" lang={langTag(locale)}>
          <p>{f.saveProblemShort}</p>
          <Button onClick={() => void retry()} loading={trying} loadingLabel={f.saveProblemRetry}>
            {f.saveProblemRetry}
          </Button>
          <details className="app-save-problem-details">
            <summary>{f.saveProblemDetails}</summary>
            <p>
              <WithTail text={f.saveProblem(problem.message)} tail={problem.message} tailLang={locale === "en" ? undefined : "en"} />
            </p>
          </details>
        </div>
      ) : null}
    </>
  );
}

/** The Search screen with no option's details open: nothing over the results. */
function NoDetail() {
  return null;
}

export interface AppProps {
  /**
   * The ports to boot with. Only the UI/UX test host (apps/ios/fixture-host) passes these; main.tsx renders
   * `<App />`, so production boots with bootstrap()'s own native defaults exactly as before.
   */
  bootstrapOptions?: BootstrapOptions;
  /** Told once the services exist. Test host only, for the same reason. */
  onReady?: (services: AppServices) => void;
}

export function App({ bootstrapOptions, onReady }: AppProps = {}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once, at boot: a new options object on a later render must not boot a second set of services.
  const boot = useRef({ bootstrapOptions, onReady });

  useEffect(() => {
    // A probe build sends seats.aero requests to the local mock (../probes/probe-transport.ts); any other build is unchanged.
    const booted = PROBES
      ? import("../probes/probe-transport").then((m) => bootstrap(m.probeBootstrapOptions()))
      : E2E
        ? import("../probes/probe-transport").then((m) => bootstrap(m.e2eBootstrapOptions()))
        : bootstrap(boot.current.bootstrapOptions);
    booted.then(
      (ready) => {
        setServices(ready);
        boot.current.onReady?.(ready);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    if (!services) return;
    // An e2e build starts its driver here, once the services exist. In any other build the line is dropped whole,
    // so the effect ships byte-identical (R1, docs/PHASE5.md §2).
    if (E2E) void import("../probes/e2e-driver").then((m) => m.startE2E(services));
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
              path: "/edit",
              element: <FullPage services={services} />,
              children: [{ index: true, element: <QueryEditorScreen /> }],
            },
            // AI assistance, a full-height page (T15, docs/04 S09): its own header, context, conversation and composer.
            {
              path: "/ask",
              element: <FullPage services={services} />,
              children: [{ index: true, element: <AskScreen /> }],
            },
            {
              path: "/",
              element: <Chrome services={services} />,
              children: [
                {
                  // The Search screen, and an option's details over it (T10).
                  element: <SearchScreen />,
                  children: [
                    { index: true, Component: NoDetail },
                    { path: "detail/:snapshotId/:rowKey", element: <DetailScreen /> },
                    // The comparison (T12), over the results like the details, so they are as they were on return.
                    { path: "compare", element: <CompareScreen /> },
                  ],
                },
                { path: "watches", element: <WatchesScreen /> },
                { path: "saved", element: <FavoritesScreen /> },
                { path: "saved/:id", element: <SavedScreen /> },
                { path: "settings", element: <SettingsScreen /> },
                { path: "settings/seats", element: <SeatsKeyScreen /> },
                { path: "settings/anthropic", element: <AnthropicKeyScreen /> },
                { path: "example", element: <ExampleScreen /> },
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

  return (
    <>
      <ShellEffects services={services} />
      <RouterProvider router={router} />
    </>
  );
}
