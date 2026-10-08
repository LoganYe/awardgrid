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
 *
 * And where the app's data source is read, before bootstrap (./data-source.ts): the person's own seats.aero account, or
 * sample mode's labelled sample data. Switching boots the app again in place, on Search.
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Navigate, NavLink, Outlet, type RouteObject, RouterProvider, createHashRouter, useLocation } from "react-router";
import { type AppServices, type BootstrapOptions, bootstrap } from "./bootstrap";
import { SampleDataContext, type SampleStart, isSample, resolveBoot, runSampleStart } from "./data-source";
import { RESULTS } from "../components/results/copy";
import { Button, Icon, type IconName, applyThemePreference } from "../components/ui";
import { FAVORITES } from "../screens/favorites-copy";
import { WithTail } from "./WithTail";
import { installKeyboardInset } from "./keyboard";
import { installAppearanceBridge, postAppearance } from "../native/appearance";
import { installSystemTextSize } from "../native/text-size";
import { type Locale, langTag, useLocale } from "./locale";
import { TraySlot } from "./tray-slot";
import { SeatsAttribution } from "../components/SeatsAttribution";
import { SampleBanner } from "../components/SampleBanner";
import { SAMPLE } from "../sample/sample-copy";
import { CAN_CONNECT } from "./flags";
import { CompareScreen } from "../screens/CompareScreen";
import { QueryEditorScreen } from "../screens/QueryEditorScreen";
import { DetailScreen } from "../screens/DetailScreen";
import { EnterSample } from "../screens/OnboardingScreen";
import { FavoritesScreen, SavedScreen } from "../screens/FavoritesScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SeatsConnectScreen } from "../screens/SeatsConnectScreen";
import { SeatsKeyScreen } from "../screens/SeatsKeyScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { WatchesScreen } from "../screens/WatchesScreen";

/**
 * Probe build only (VITE_AG_PROBES=1, apps/ios/probes/run-probes.sh): the #/probes screen and the probe transport.
 * In every other build this is the constant false, both imports are dropped, and no probe code or probe host is in
 * the bundle, which R1 checks.
 */
const PROBES = import.meta.env.VITE_AG_PROBES === "1";
const ProbesScreen = PROBES ? lazy(() => import("../probes/ProbesScreen").then((m) => ({ default: m.ProbesScreen }))) : null;
// The license texts load only when their page opens (release handoff §3.5), not with every launch.
const AcknowledgementsScreen = lazy(() => import("../screens/AcknowledgementsScreen").then((m) => ({ default: m.AcknowledgementsScreen })));
/**
 * E2e build only (VITE_AG_PROBES=e2e, apps/ios/probes/run-probes.sh --e2e): the app as shipped, with its transports
 * pointed at the probe server and the seats.aero mock, and a driver that runs step 7's Simulator scenarios through the
 * services. In every other build this is the constant false as well, and R1 checks the same way.
 */
const E2E = import.meta.env.VITE_AG_PROBES === "e2e";
/**
 * Ask (AI assistance) and the Anthropic key page, loaded when first opened. The App Store build (./flags.ts STORE) has
 * neither: both are the constant null there, so their modules and their words are not in its bundle
 * (scripts/check-store-bundle.mjs), and their routes do not exist — `#/ask` lands on Search (the catch-all below).
 *
 * The condition is written out here rather than read from ./flags.ts, as PROBES is above: the bundler drops a
 * dynamic import only when its condition is a constant in the same file. Through an imported constant the code is
 * still removed, but the two chunks would be written to dist/ anyway, unreferenced (flags.test.ts keeps the two
 * conditions the same).
 */
const ASK_BUILT = import.meta.env.VITE_AG_STORE !== "1";
const AskScreen = ASK_BUILT ? lazy(() => import("../screens/AskScreen").then((m) => ({ default: m.AskScreen }))) : null;
const AnthropicKeyScreen = ASK_BUILT ? lazy(() => import("../screens/AnthropicKeyScreen").then((m) => ({ default: m.AnthropicKeyScreen }))) : null;
/**
 * Which connect page this build routes (VITE_AG_CONNECT, ./flags.ts OAUTH), written out as ASK_BUILT is: "oauth", the
 * App Store build's flavour (`npm run build:store` sets it), routes SeatsConnectScreen, seats.aero's own sign-in with no
 * paste field; any other value routes SeatsKeyScreen, the paste field. Both pages are imported statically above and
 * used only in the two branches of the route below, so a build keeps the one it routes and drops the other with its
 * words (oauth-copy.ts, seats-key-copy.ts). Neither is a lazy chunk: a lazy connect page sharing Settings' modules with
 * the entry made the bundler split them into chunks of their own, and constants such as STORE are not folded across
 * chunks, so Ask's sentences would have stayed in the store bundle. scripts/check-store-bundle.mjs fails the store
 * build if any of the paste field's words remain, or if the OAuth page's do not.
 */
const OAUTH_BUILT = import.meta.env.VITE_AG_CONNECT === "oauth";

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
 * The two bare pages shown before the app has its screens ("Starting…", and the error when it cannot start): 24 pt
 * inside the safe area. The web view does not inset the page (PR-D, capacitor.config.ts contentInset "never"), so
 * without it their text sat under the status bar, or an iPad window's controls, while the app was starting.
 */
const BARE_PAGE = {
  padding:
    "calc(env(safe-area-inset-top) + 24px) calc(env(safe-area-inset-right) + 24px) calc(env(safe-area-inset-bottom) + 24px) calc(env(safe-area-inset-left) + 24px)",
} as const;

/**
 * The chrome's pages that show results, and so carry their source at their end: "Data: seats.aero", or in sample mode
 * "Sample data · on this device".
 */
export function showsSeatsData(place: string): boolean {
  return place === "/watches" || place === "/saved" || place.startsWith("/saved/");
}

/**
 * The tab chrome (UI/UX v1 T07; docs/04 S01; reference results-light.png): the screen in a scrolling area, and a
 * bottom tab bar — Search, Watches, Saved (T13), Settings — above the home indicator. AI assistance
 * is reached from the Search header, which also says when a question is under way. The page itself never scrolls (the
 * shell's html/body overflow rule would stop sticky headers), the area above the bar does.
 *
 * LEGAL.md: "Every screen that shows award data carries the attribution 'Data: seats.aero'", with "seats.aero" linking to
 * its site. The Search screen says it in its status line; Watches and Saved carry it at the end of their content.
 * Sample mode (release plan step 17) shows its banner at the top of every tab instead (Search under its sticky header),
 * and "Sample data · on this device" where the attribution would be: its rows are not seats.aero's.
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
  const sample = isSample(services);
  const tabs: Array<{ to: string; icon: IconName; label: string; badge: number }> = [
    { to: "/", icon: "search", label: t.tabs.search, badge: 0 },
    { to: "/watches", icon: "bell", label: t.tabs.watches, badge: unseen },
    { to: "/saved", icon: "bookmark", label: t.tabs.saved, badge: 0 },
    { to: "/settings", icon: "gear", label: t.tabs.settings, badge: 0 },
  ];
  return (
    <TraySlot.Provider value={traySlot}>
    <div className="app-shell">
      {/* The pages that scroll as one keep the top inset outside their scrolling area, so what scrolls stops below the
          status bar (or an iPad window's controls) instead of running under it; Search's sticky header carries its own. */}
      {onSearch ? null : <div className="app-status-area" aria-hidden="true" />}
      <main ref={main} className={onSearch ? "app-main" : "app-main app-page chrome-x"} onScroll={(e) => positions.current.set(place, e.currentTarget.scrollTop)}>
        {/* Sample mode's banner on every tab; the Search screen draws its own under its sticky header. */}
        {onSearch ? null : <SampleBanner services={services} locale={locale} />}
        <Outlet context={services} />
        {/* Only over seats.aero's data: Watches and Saved. Search says it in its status line; Settings and its pages show
            none of it. Over sample data, the sample line instead, with no link: the rows are made up on this device. */}
        {showsSeatsData(place) ? (
          sample ? (
            <p className="app-attribution ag-sample-source">{SAMPLE[locale].attribution}</p>
          ) : (
            <SeatsAttribution className="app-attribution" text={t.attribution} locale={locale} />
          )
        ) : null}
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

/**
 * The app's routes, for this build's flavour (./flags.ts): Ask and the Anthropic key page only where the build has Ask,
 * the seats.aero connection page only where it has a connection, and a catch-all that opens Search for any other
 * address. A function of the services so flags.test.ts and store-flavour.test.ts can read the table without a device.
 */
export function appRoutes(services: AppServices): RouteObject[] {
  return [
    {
      path: "/edit",
      element: <FullPage services={services} />,
      children: [{ index: true, element: <QueryEditorScreen /> }],
    },
    // AI assistance, a full-height page (T15, docs/04 S09): its own header, context, conversation and composer.
    // Not in the App Store build (STORE), where AskScreen is null.
    ...(AskScreen
      ? [
          {
            path: "/ask",
            element: <FullPage services={services} />,
            children: [
              {
                index: true,
                element: (
                  <Suspense fallback={null}>
                    <AskScreen />
                  </Suspense>
                ),
              },
            ],
          },
        ]
      : []),
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
        // The seats.aero connection page, unless this build has no connection (VITE_AG_CONNECT=0): seats.aero's own
        // sign-in in the OAuth flavour (VITE_AG_CONNECT=oauth, the App Store build), the key field otherwise. The
        // condition is OAUTH_BUILT itself, a build-time constant, so the page a build does not route is dropped.
        ...(CAN_CONNECT
          ? [
              {
                path: "settings/seats",
                element: OAUTH_BUILT ? <SeatsConnectScreen /> : <SeatsKeyScreen />,
              },
            ]
          : []),
        ...(AnthropicKeyScreen
          ? [
              {
                path: "settings/anthropic",
                element: (
                  <Suspense fallback={null}>
                    <AnthropicKeyScreen />
                  </Suspense>
                ),
              },
            ]
          : []),
        {
          path: "settings/acknowledgements",
          element: (
            <Suspense fallback={null}>
              <AcknowledgementsScreen />
            </Suspense>
          ),
        },
        // The first run's "View an example" became sample mode (release plan step 17): an old link enters it.
        { path: "example", element: <EnterSample /> },
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
    // Any other address — a page this build does not have (#/ask in the App Store build), or an old link —
    // opens Search instead of the router's error page.
    { path: "*", element: <Navigate to="/" replace /> },
  ];
}

export function App({ bootstrapOptions, onReady }: AppProps = {}) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once, at boot: a new options object on a later render must not boot a second set of services.
  const boot = useRef({ bootstrapOptions, onReady });
  // Each switch between the account and sample data boots again (./data-source.ts): the services, the router and every
  // screen are new, on the data the person chose.
  const [generation, setGeneration] = useState(0);
  const current = useRef<AppServices | null>(null);
  const switched = useRef(false);
  // A plan's "Try with sample data" (release plan step 18): searched on the sample data once it has booted.
  const pendingStart = useRef<SampleStart | null>(null);

  useEffect(() => {
    let live = true;
    const hooks = {
      // Entering sample mode saves what the account's services hold first, as leaving the app would.
      beforeSwitch: async () => current.current?.persist(),
      reboot: (start?: SampleStart) => {
        // The new router starts on Search, without a history entry for the page the switch was made from.
        window.history.replaceState(null, "", "#/");
        switched.current = true;
        pendingStart.current = start ?? null;
        current.current = null;
        setServices(null);
        setGeneration((n) => n + 1);
      },
    };
    // A probe build sends seats.aero requests to the local mock (../probes/probe-transport.ts); any other build is unchanged.
    const booted = PROBES
      ? import("../probes/probe-transport").then((m) => bootstrap(m.probeBootstrapOptions()))
      : E2E
        ? import("../probes/probe-transport").then((m) => bootstrap(m.e2eBootstrapOptions()))
        : resolveBoot(boot.current.bootstrapOptions ?? {}, hooks).then(bootstrap);
    booted.then(
      (ready) => {
        if (!live) return;
        current.current = ready;
        setServices(ready);
        boot.current.onReady?.(ready);
        // Only ever on the sample data it was chosen for; a run the workspace shows (and says why it failed) like any other.
        const start = pendingStart.current;
        pendingStart.current = null;
        if (start && isSample(ready)) void runSampleStart(ready, start).catch(() => undefined);
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [generation]);

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
    // The OAuth flavour first removes whatever passed its 24-hour limit while the app was away (launch already has).
    // In sample mode entered from such an account, the account's own files are swept too (./data-source.ts
    // sweepAccount): now, since its services are not running, and with every sweep after.
    const sweepAccount = services.dataSource?.sweepAccount;
    if (sweepAccount) void sweepAccount();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void services.persist();
      else {
        if (sweepAccount) void sweepAccount();
        void services.sweepShortTerm().then(() => services.checkWatches());
      }
    };
    const onPageHide = () => void services.persist();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    // …and hourly while it stays open, so nothing outlives the limit on a screen left showing.
    const sweepBoth = () => {
      if (sweepAccount) void sweepAccount();
      void services.sweepShortTerm();
    };
    const sweep = services.shortTermMs != null || sweepAccount ? window.setInterval(sweepBoth, 60 * 60_000) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      if (sweep !== null) window.clearInterval(sweep);
    };
  }, [services]);

  // Created once per bootstrap. Re-creating the router on every render would reset navigation.
  const router = useMemo(() => (services ? createHashRouter(appRoutes(services)) : null), [services]);
  // After a switch, focus goes to the Search screen's title, where the new data starts.
  useEffect(() => {
    if (!router || !switched.current) return;
    switched.current = false;
    const frame = window.requestAnimationFrame(() => document.getElementById("search-title")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [router]);

  if (error) {
    return (
      <div style={BARE_PAGE}>
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

  if (!services || !router) return <div style={{ ...BARE_PAGE, color: "var(--fg-muted)" }}>Starting…</div>;

  return (
    <SampleDataContext.Provider value={isSample(services)}>
      <ShellEffects services={services} />
      <RouterProvider router={router} />
    </SampleDataContext.Provider>
  );
}
