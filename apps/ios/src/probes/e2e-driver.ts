/**
 * E2e build only (VITE_AG_PROBES=e2e): step 7 part B's Simulator scenarios, run through the app's own services.
 *
 * App.tsx imports this file behind that constant and main.tsx opens #/ask, so in any other build none of it is in the
 * bundle (R1). apps/ios/probes/run-probes.sh --e2e builds this bundle, arms one phase per launch on the probe server,
 * and performs what the app cannot do to itself: screenshots, leaving and returning, terminating and relaunching.
 * Results are in docs/PHASE5.md §2.
 *
 * Nothing is tapped. The driver calls AppServices the way the screens do (ask, stop, retry, newConversation), and the
 * Search screen's Run button is pressed with element.click(), because a grid search is the screen's own code and not
 * a service call. What the screens show is read back from the DOM. Every Anthropic request goes to the probe server
 * (probe-transport.ts withAnthropicProbe), every seats.aero request to the mock (withSeatsMock), and both keys are
 * fake and held in memory.
 *
 * The channel to the host is the probe server. The app posts each result to /log. For a screenshot or a count of the
 * mock's log lines it posts `host:<action>:<name>` and waits until the host reports it done (GET /host-done); the host
 * side is apps/ios/probes/e2e-host.mjs. The verdicts are decided afterwards from the server's log, the mock's log and
 * these posts (probe-log.mjs summary-e2e), not here: an app cannot certify its own networking (docs/PHASE0.md §2).
 */
import { DEFAULT_MIN_CABIN_PCT, QueryObject } from "@awardgrid/core/query/schema";
import { planFind } from "@awardgrid/core/seatsaero/find";
import type { AskEntry } from "@awardgrid/core/ask/conversation";
import type { SearchEcho } from "@awardgrid/core/ask/tools";
import type { AppServices } from "../app/bootstrap";
import type { AskState } from "../ask/ask-service";
import { stepLabel } from "../ask/labels";
import { createNativeFetch } from "../native/http";
import { LOCAL_USER } from "../search/search";
import { PROBE_SERVER } from "./probe-transport";

type Values = Record<string, unknown>;

/** The same fake key step 3 used: Anthropic would reject it before any model ran, and here it only reaches the probe server. */
const PROBE_KEY = "sk-ant-probe-invalid-000000";
/** scripts/mock-seatsaero.ts --demo routes its scenarios by the key's value. */
const SEATS_NORMAL = "demo-key-normal";
const SEATS_PARTIAL = "demo-key-partial";

const GRID_QUERY = "HKG, SHA to SEA, next 30 days, business and first";
/** One pair the demo data has rows for, and one it has none for, so an empty cell has to say why. */
const EMPTY_CELL_QUERY = "HKG, ICN to SEA, next 30 days, business";
const TOKYO_QUESTION = "Cheapest business class from SEA to Tokyo (東京) in October?";
const SEARCH_QUESTION = "Which program has the cheapest seats in this search?";
const FOLLOW_UP = "What are the taxes and fees on the cheapest option?";

let started = false;
const control = createNativeFetch();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const round = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// The channel to the host
// ---------------------------------------------------------------------------

async function post(probe: string, values: Values = {}, pass: boolean | null = null): Promise<Values | null> {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ probe, pass, values, at: new Date().toISOString() }) };
  try {
    const res = await fetch(`${PROBE_SERVER}/log`, init);
    if (res.ok) return (await res.json()) as Values;
  } catch {
    // The native adapter next.
  }
  try {
    const res = await control(`${PROBE_SERVER}/log`, init);
    if (res.ok) return (await res.json()) as Values;
  } catch {
    // Nothing more to try; the host's own timeout reports the silence.
  }
  return null;
}

/** Ask the host for something, and wait until it says it is done. */
async function host(action: "shot" | "mocklines", name: string, timeoutMs = 120_000): Promise<Values> {
  await post(`host:${action}:${name}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PROBE_SERVER}/host-done?name=${encodeURIComponent(name)}`);
      const reply = (await res.json()) as Values;
      if (reply.done === true) return reply;
    } catch {
      // Poll again.
    }
    await sleep(250);
  }
  throw new Error(`the host did not finish ${action} ${name} within ${timeoutMs} ms`);
}

async function mockLines(name: string): Promise<number | null> {
  const reply = await host("mocklines", name);
  const n = Number(reply.mock_lines);
  return Number.isFinite(n) ? n : null;
}

/** Let React commit and the WebView paint, then record the page and ask the host for a screenshot. */
async function shot(name: string, extra: Values = {}): Promise<void> {
  await settle();
  await post(`dom:${name}`, { ...extra, ...domFacts() });
  await host("shot", name);
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await sleep(400);
}

async function waitFor<T>(what: string, read: () => T | null | undefined | false, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function errorFacts(err: unknown): Values {
  return err instanceof Error ? { name: err.name, message: err.message.replace(/sk-ant-[A-Za-z0-9_-]*/g, "sk-ant-****").slice(0, 400) } : { thrown: String(err).slice(0, 400) };
}

// ---------------------------------------------------------------------------
// The DOM, as a person and VoiceOver meet it
// ---------------------------------------------------------------------------

/** Text as the accessibility tree has it: aria-hidden subtrees left out, visually hidden text kept, blocks apart. */
function textOf(node: Node | null): string {
  if (node === null) return "";
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      parts.push(n.textContent ?? "");
      return;
    }
    let block = false;
    if (n instanceof Element) {
      if (n.getAttribute("aria-hidden") === "true") return;
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) return;
      block = !getComputedStyle(n).display.startsWith("inline");
    }
    if (block) parts.push(" ");
    n.childNodes.forEach(walk);
    if (block) parts.push(" ");
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** An approximation of the accessible name computation, enough to tell two controls apart. */
function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) return labelledBy.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(" ").trim();
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = el.labels ? [...el.labels].map(textOf).filter(Boolean) : [];
    if (labels.length > 0) return labels.join(" ");
    return (el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "").trim();
  }
  return textOf(el) || (el.getAttribute("title") ?? "").trim();
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  if (el instanceof HTMLAnchorElement) return el.hasAttribute("href") ? "link" : "generic";
  if (el instanceof HTMLButtonElement) return "button";
  if (el instanceof HTMLTextAreaElement) return "textbox";
  if (el instanceof HTMLSelectElement) return "combobox";
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox") return "checkbox";
    if (el.type === "radio") return "radio";
    if (el.type === "password") return "textbox (password field)";
    return "textbox";
  }
  return el.tagName.toLowerCase();
}

function box(el: Element): Values {
  const r = el.getBoundingClientRect();
  return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) };
}

const INTERACTIVE = "a[href], button, input, textarea, select, [role='button'], [role='link'], [role='checkbox'], [tabindex]:not([tabindex='-1'])";

function interactiveElements(): Values[] {
  return [...document.querySelectorAll(INTERACTIVE)].map((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const disabled = (el as HTMLButtonElement).disabled === true;
    const inline = el instanceof HTMLAnchorElement && !el.classList.contains("ag-button") && !el.classList.contains("ag-nav-link");
    return {
      role: roleOf(el),
      name: accessibleName(el),
      tag: el.tagName.toLowerCase(),
      type: el instanceof HTMLInputElement ? el.type : null,
      className: typeof el.className === "string" ? el.className : null,
      disabled,
      inline_link: inline,
      rendered: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      box: box(el),
    };
  });
}

/** 44 pt targets: the controls design §6.5 names (buttons, link-as-buttons, fields, the checkbox row), with their boxes. */
function targets(): Values[] {
  const selector = ".ag-button, .ask-suggestion, .ask-check, .ag-input, .ag-nav-link, .ask-screen button, .settings-section button";
  const seen = new Set<Element>();
  return [...document.querySelectorAll(selector)]
    .filter((el) => (seen.has(el) ? false : (seen.add(el), true)))
    .map((el) => ({ name: accessibleName(el) || textOf(el), role: roleOf(el), className: typeof el.className === "string" ? el.className : null, box: box(el) }));
}

function regions(role: string): Values[] {
  return [...document.querySelectorAll(`[role='${role}']`)].map((el) => ({ className: typeof el.className === "string" ? el.className : null, text: textOf(el) }));
}

/** Everything A4 and A5 read from one state of the page. */
function domFacts(): Values {
  const se = document.scrollingElement ?? document.documentElement;
  const vw = window.innerWidth;
  const offenders: Values[] = [];
  let maxRight = 0;
  for (const el of document.body.querySelectorAll("*")) {
    // The grid scrolls sideways inside its own container, and visually hidden text is 1 px parked off to the side.
    if (el.closest(".ag-scroll") || el.closest(".sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    maxRight = Math.max(maxRight, r.right);
    if (r.right > vw + 0.5 && offenders.length < 10) offenders.push({ tag: el.tagName.toLowerCase(), className: typeof el.className === "string" ? el.className : null, text: textOf(el).slice(0, 60), box: box(el) });
  }
  const header = document.querySelector("header");
  const footer = document.querySelector("footer");
  const navLinks = [...document.querySelectorAll("nav a")];
  const navTops = [...new Set(navLinks.map((a) => Math.round(a.getBoundingClientRect().top)))];
  return {
    href: location.hash,
    viewport: { innerWidth: vw, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    scroll: { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth, scrollHeight: se.scrollHeight, clientHeight: se.clientHeight, scrollTop: Math.round(se.scrollTop), bodyScrollWidth: document.body.scrollWidth },
    max_right: round(maxRight),
    beyond_viewport: offenders,
    header: header ? { box: box(header), scrollWidth: header.scrollWidth, clientWidth: header.clientWidth, brand: header.querySelector("strong") ? box(header.querySelector("strong")!) : null } : null,
    nav: navLinks.map((a) => ({ text: textOf(a), box: box(a) })),
    nav_rows: navTops.length,
    footer: footer ? { text: textOf(footer), box: box(footer), in_viewport: footer.getBoundingClientRect().top >= 0 && footer.getBoundingClientRect().bottom <= window.innerHeight + 0.5 } : null,
    targets: targets(),
    interactive: interactiveElements(),
    status_regions: regions("status"),
    alerts: regions("alert"),
    busy: [...document.querySelectorAll("[aria-busy]")].map((el) => ({ className: typeof el.className === "string" ? el.className : null, value: el.getAttribute("aria-busy") })),
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const askScreen = () => document.querySelector(".ask-screen");
const composer = () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label]");

async function go(hash: string, ready: () => Element | null): Promise<void> {
  if (location.hash !== hash) location.hash = hash;
  await waitFor(`${hash} to render`, () => location.hash === hash && ready());
}

/** Open Ask again, so the screen reads the keys (and the last search) as they are now. */
async function reopenAsk(): Promise<void> {
  await go("#/settings", () => document.querySelector(".settings-section"));
  await go("#/ask", askScreen);
  await settle();
}

function quotaLine(): string | null {
  const span = [...document.querySelectorAll("span")].find((s) => (s.textContent ?? "").startsWith("seats.aero calls today:"));
  return span ? textOf(span) : null;
}

/**
 * Type a search into the Search screen and run it, then read the grid it shows. Since UI/UX v1 T07 a search's results
 * are cards and the grid is the Matrix view (U-028, brought up to date in T22): once results are on screen the text
 * search is behind the query summary, and each empty slot of the grid carries its reason as data-state (complete: no
 * matches; partial: not checked to the end; unmonitored; unknown). The facts keep their Phase 5 names; calls_line now
 * begins with the option count, and grid_message is the coverage notices.
 */
async function gridSearch(text: string): Promise<Values> {
  await go("#/", () => document.querySelector("#q") ?? document.querySelector("[data-testid='query-summary'] a"));
  if (!document.querySelector("#q")) document.querySelector<HTMLAnchorElement>("[data-testid='query-summary'] a")?.click();
  const box = await waitFor("the text search", () => document.querySelector<HTMLTextAreaElement>("#q"));
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const run = () => document.querySelector<HTMLButtonElement>("[data-testid='text-search-run']");
  const results = () => document.querySelector<HTMLElement>(".ag-results[data-run]");
  const before = Number(results()?.dataset.revision ?? -1);
  await waitFor("the query in the box and Run enabled", () => document.querySelector<HTMLTextAreaElement>("#q")?.value === text && run() && !run()!.disabled);
  const started = performance.now();
  run()!.click();
  await waitFor(
    "the search to finish",
    () => {
      if (document.querySelector("#q-error, .ag-results [role='alert']")) return true;
      const el = results();
      return el !== null && el.dataset.busy === "false" && el.dataset.run !== "running" && Number(el.dataset.revision) > before;
    },
    120_000,
  );
  const ms = Math.round(performance.now() - started);
  [...document.querySelectorAll<HTMLElement>("[role='radio']")].find((r) => textOf(r) === "Matrix")?.click();
  await settle();
  return { query: text, ms, ...gridFacts() };
}

function gridFacts(): Values {
  const table = document.querySelector("table.ag-mx-grid");
  const slots = table ? [...table.querySelectorAll(".ag-mx-slot")] : [];
  const empty = (state: string) => slots.filter((slot) => slot.getAttribute("data-state") === state).length;
  const main = document.querySelector(".app-main") ?? document.querySelector("main");
  return {
    table: table !== null,
    columns: table ? [...table.querySelectorAll("thead th")].map((th) => textOf(th)) : [],
    rows: table ? [...table.querySelectorAll("tbody th")].map((th) => textOf(th)) : [],
    cells_total: table ? table.querySelectorAll("tbody td").length : 0,
    cells_with_miles: table ? table.querySelectorAll("tbody td .ag-mx-miles").length : 0,
    not_monitored: empty("unmonitored"),
    not_checked: empty("partial"),
    dash: empty("complete"),
    // The coverage notices (docs/04's stable test id), where Phase 5 read the grid's own message.
    grid_message: [...(main?.querySelectorAll("[data-testid='coverage-notice']") ?? [])].map((p) => textOf(p)),
    alerts: [...(main?.querySelectorAll("[role='alert']") ?? [])].map((p) => textOf(p)),
    // The status line's first part ("4 options · 1 seats.aero call", or how old a cached answer is); in Phase 5 it
    // was the grid's own calls line, without the option count (T22 review PROD-5).
    calls_line: [...(main?.querySelectorAll(".ag-results-status > span:first-child") ?? [])].map((d) => textOf(d)),
    quota_line: quotaLine(),
    ask_about_search_link: [...document.querySelectorAll("a")].some((a) => textOf(a) === "Ask Claude about this search"),
  };
}

/** The newest entry as the Ask screen shows it. */
function entryDom(): Values | null {
  const li = document.querySelector(".ask-entries > li");
  if (!li) return null;
  const texts = (selector: string) => [...li.querySelectorAll(selector)].map((el) => textOf(el));
  const answers = [...li.querySelectorAll(".ask-answer")];
  const attribution = li.querySelector(".ask-attribution");
  const lastAnswer = answers.at(-1);
  return {
    question: texts(".ask-question")[0] ?? null,
    steps: texts(".ask-steps > li"),
    activity: texts(".ask-activity"),
    answers: answers.map((a) => textOf(a).slice(0, 300)),
    attribution: attribution ? textOf(attribution) : null,
    attribution_after_answer: Boolean(attribution && lastAnswer && lastAnswer.compareDocumentPosition(attribution) & Node.DOCUMENT_POSITION_FOLLOWING),
    meta: texts(".ask-meta"),
    ending: texts(".ask-ending"),
    failure: [...li.querySelectorAll(".ask-failure")].map((el) => ({ role: el.getAttribute("role"), text: textOf(el) })),
    actions: [...li.querySelectorAll(".ask-actions a, .ask-actions button")].map((el) => ({ role: roleOf(el), name: accessibleName(el), disabled: (el as HTMLButtonElement).disabled === true })),
    hint: texts(".ask-hint"),
    notes: texts(".ask-note"),
  };
}

function entryFacts(entry: AskEntry | undefined): Values | null {
  if (!entry) return null;
  return {
    id: entry.id,
    question: entry.question,
    includeSearch: entry.includeSearch,
    steps: entry.steps.map((step) => ({ label: stepLabel(step), ...(step.kind === "tool" ? { tool: step.step.tool, outcome: step.step.outcome, calls: step.step.calls, fromCache: step.step.fromCache, search: step.step.search } : { kind: step.kind }) })),
    texts: entry.texts.map((t) => t.slice(0, 300)),
    usage: entry.usage,
    end: entry.end,
  };
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

/** Replace the probe server's queue. Items are `script:k=v` with their own labels (probe-server.mjs). */
async function queue(...items: string[]): Promise<void> {
  const res = await control(`${PROBE_SERVER}/reset?${new URLSearchParams({ script: items.join(",") }).toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /reset answered ${res.status}: ${await res.text()}`);
}

function waitState(services: AppServices, what: string, test: (state: AskState) => boolean, timeoutMs = 120_000): Promise<AskState> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const state = services.ask.state();
      if (!test(state)) return false;
      done();
      resolve(state);
      return true;
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`timed out waiting for ${what}`));
    }, timeoutMs);
    const off = services.ask.subscribe(() => void check());
    const done = () => {
      clearTimeout(timer);
      off();
    };
    check();
  });
}

const last = (state: AskState) => state.entries.at(-1);

/** What planFind plans for a search step's query: the requests the mock's log should show. */
function planned(services: AppServices, search: SearchEcho | null): Values | null {
  if (search === null) return null;
  const parsed = QueryObject.safeParse({
    origins: search.origins,
    destinations: search.destinations,
    date_from: search.date_from,
    date_to: search.date_to,
    cabins: search.cabins,
    ...(search.programs && search.programs.length > 0 ? { programs: search.programs } : {}),
    direct_only: search.direct_only,
    include_filtered: false,
    min_cabin_pct: DEFAULT_MIN_CABIN_PCT,
    ...(search.max_miles === null ? {} : { max_miles: search.max_miles }),
    sort_by: "miles_asc",
    raw_text: "",
    language: "en",
  });
  if (!parsed.success) return { error: parsed.error.message };
  const plan = planFind(parsed.data, { routesKnown: services.engine.routes.knowledgeFor(LOCAL_USER) });
  return { mode: plan.mode, estimated_calls: plan.estimated_calls, requests: plan.requests.map((r) => ({ kind: r.kind, pages: r.pages, params: r.params })) };
}

async function setKeys(services: AppServices, anthropic: string | null, seats: string | null): Promise<void> {
  if (anthropic === null) await services.anthropicKeys.clear();
  else await services.anthropicKeys.set(anthropic);
  if (seats === null) await services.keys.clear();
  else await services.keys.set(seats);
}

/** Leave the device as the normal app expects it: no conversation, no cache, no watches, today's count at zero. */
async function cleanSlate(services: AppServices): Promise<void> {
  if (services.ask.isRunning()) {
    services.ask.stop();
    await waitState(services, "the question to end", (s) => s.running === null);
  }
  for (const watch of [...services.watches.all()]) services.watches.remove(watch.id);
  services.notifyWatchesChanged();
  await services.ask.newConversation();
  await services.clearCache();
  services.quotaStore.restore(null);
  await services.snapshots.saveQuota(services.quotaStore.snapshot(new Date()));
  await services.persist();
}

function scrollToEntry(): void {
  document.querySelector(".ask-entries > li")?.scrollIntoView({ block: "start" });
}

// ---------------------------------------------------------------------------
// Phases: one per launch
// ---------------------------------------------------------------------------

/** A5 with no keys, then A3: no Anthropic key. Ask refuses before anything is sent, and a grid search still works. */
async function phaseA3(services: AppServices): Promise<void> {
  // A5's state with both keys missing: two notices, each with its own Open Settings link.
  await setKeys(services, null, null);
  await reopenAsk();
  await waitFor("both no-key notices", () => document.querySelectorAll(".ask-screen [role='alert']").length === 2 && document.querySelectorAll(".ask-screen [role='alert']"));
  await shot("a5-ask-no-keys");

  await setKeys(services, null, SEATS_NORMAL);
  await reopenAsk();
  await waitFor("the no-key notice", () => (askScreen()?.textContent ?? "").includes("Ask needs your own Anthropic API key"));
  const askButton = [...document.querySelectorAll(".ask-send")][0] as HTMLButtonElement | undefined;
  await post("A3-ask", {
    anthropic_key_on_file: (await services.anthropicKeys.get()) !== null,
    seats_key_on_file: (await services.keys.get()) !== null,
    alerts: regions("alert"),
    composer_disabled: composer()?.disabled ?? null,
    ask_button: askButton ? { text: textOf(askButton), disabled: askButton.disabled } : null,
    suggestions_disabled: [...document.querySelectorAll<HTMLButtonElement>(".ask-suggestion")].map((b) => b.disabled),
    ask_state: { entries: services.ask.state().entries.length, notice: services.ask.state().notice, running: services.ask.isRunning() },
  });
  await shot("a3-ask-no-anthropic-key");

  const before = await mockLines("a3-search-before");
  const grid = await gridSearch(GRID_QUERY);
  const after = await mockLines("a3-search-after");
  await post("A3-search", { ...grid, mock_lines: { before, after }, anthropic_key_on_file: (await services.anthropicKeys.get()) !== null });
  document.querySelector("main div.tabular")?.scrollIntoView({ block: "start" });
  await shot("a3-search-grid");
  await cleanSlate(services);
}

/** E1 (a question end to end), E2 (empty-cell reasons), and E3 up to Stop; the host then relaunches for E3's second half. */
async function phaseE1(services: AppServices): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  await go("#/", () => document.querySelector("#q"));
  await waitFor("the quota line", quotaLine);
  await post("E1-before", { quota: await services.engine.quotaView(), quota_line: quotaLine() });

  // ---- E1 ----
  await reopenAsk();
  await queue("tool_use_search:label=E1-r1", "text:label=E1-r2");
  const e1Before = await mockLines("e1-before");
  const t1 = performance.now();
  const e1 = await services.ask.ask(TOKYO_QUESTION, false);
  const e1Ms = Math.round(performance.now() - t1);
  const e1After = await mockLines("e1-after");
  await settle();
  const e1Entry = last(e1);
  const e1Search = e1Entry?.steps.find((s) => s.kind === "tool");
  await post("E1", {
    ms: e1Ms,
    entry: entryFacts(e1Entry),
    dom: entryDom(),
    planned: planned(services, e1Search?.kind === "tool" ? e1Search.step.search : null),
    mock_lines: { before: e1Before, after: e1After },
  });
  scrollToEntry();
  await shot("e1-answered");
  await go("#/", () => document.querySelector("#q"));
  await waitFor("the quota line", quotaLine);
  await post("E1-search-quota", { quota: await services.engine.quotaView(), quota_line: quotaLine() });
  await shot("e1-search-quota");

  // ---- E2 ----
  await services.ask.newConversation();
  await services.clearCache();
  await setKeys(services, PROBE_KEY, SEATS_PARTIAL);
  await reopenAsk();
  await queue("tool_use_search:label=E2-r1", "text:label=E2-r2");
  const e2Before = await mockLines("e2-ask-before");
  const e2 = await services.ask.ask(TOKYO_QUESTION, false);
  const e2After = await mockLines("e2-ask-after");
  await settle();
  const e2Entry = last(e2);
  const e2Search = e2Entry?.steps.find((s) => s.kind === "tool");
  await post("E2-ask", { entry: entryFacts(e2Entry), dom: entryDom(), planned: planned(services, e2Search?.kind === "tool" ? e2Search.step.search : null), mock_lines: { before: e2Before, after: e2After } });
  scrollToEntry();
  await shot("e2-ask");

  const gridBefore = await mockLines("e2-grid-before");
  const partial = await gridSearch(EMPTY_CELL_QUERY);
  const gridAfter = await mockLines("e2-grid-after");
  await post("E2-grid", { ...partial, key: SEATS_PARTIAL, mock_lines: { before: gridBefore, after: gridAfter } });
  (document.querySelector("main div.tabular") ?? document.querySelector("main [role='alert']"))?.scrollIntoView({ block: "start" });
  await shot("e2-grid");

  // The same search with the normal key, for comparison: what the grid shows when every Get Routes call succeeds.
  await services.clearCache();
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  const normalBefore = await mockLines("e2-grid-normal-before");
  const normal = await gridSearch(EMPTY_CELL_QUERY);
  const normalAfter = await mockLines("e2-grid-normal-after");
  await post("E2-grid-normal-key", { ...normal, key: SEATS_NORMAL, mock_lines: { before: normalBefore, after: normalAfter } });
  (document.querySelector("main div.tabular") ?? document.querySelector("main [role='alert']"))?.scrollIntoView({ block: "start" });
  await shot("e2-grid-normal-key");

  // ---- E3, up to Stop ----
  await services.ask.newConversation();
  await services.clearCache();
  await reopenAsk();
  await queue("text:label=E3-q1");
  const q1 = await services.ask.ask(TOKYO_QUESTION, false);
  await post("E3-q1", { entry: entryFacts(last(q1)) });
  // `text` has 8 events: at one per second the second request's replay lasts 7 s, and Stop comes 2 s in.
  await queue("tool_use_search:label=E3-q2-r1", "text:every=1000:label=E3-q2-r2");
  const pending = services.ask.ask(FOLLOW_UP, false);
  const second = await waitState(services, "the second request of question 2", (s) => s.running?.activity.kind === "request" && s.running.activity.request === 2);
  const startedAt = second.running?.activity.kind === "request" ? second.running.activity.startedAt : null;
  await sleep(2_000);
  const stopAt = new Date().toISOString();
  services.ask.stop();
  const stopped = await pending;
  await settle();
  await post("E3-stop", { request_started_at: startedAt, stop_at: stopAt, entry: entryFacts(last(stopped)), entries: stopped.entries.length, dom: entryDom() });
  scrollToEntry();
  await shot("e3-stopped");
  await post("e3_ready_for_relaunch", { entries: stopped.entries.map((e) => ({ id: e.id, status: e.end?.status ?? null, committed: e.end?.committed ?? null })) });
}

/** E3 after the relaunch, then E4, E5, E6, and A5's too-large failure. */
async function phaseE3Relaunch(services: AppServices): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  await reopenAsk();
  const restored = await waitState(services, "the restored conversation", (s) => s.entries.length >= 2);
  await post("E3-relaunch", { entries: restored.entries.map(entryFacts), retryEntryId: restored.retryEntryId, dom: entryDom() });
  scrollToEntry();
  await shot("e3-after-relaunch");
  await queue("text:label=E3-q3");
  const q3 = await services.ask.ask(SEARCH_QUESTION, false);
  await post("E3-q3", { entry: entryFacts(last(q3)), entries: q3.entries.length });

  // ---- E4: a 529, then Try again ----
  await services.ask.newConversation();
  await reopenAsk();
  await queue("status=529:label=E4-r1", "text:label=E4-r2");
  const failed = await services.ask.ask(TOKYO_QUESTION, false);
  await settle();
  await post("E4-failed", { entry: entryFacts(last(failed)), retryEntryId: failed.retryEntryId, is_retry_entry: failed.retryEntryId === last(failed)?.id, dom: entryDom() });
  scrollToEntry();
  await shot("e4-overloaded");
  const retried = await services.ask.retry();
  await settle();
  await post("E4-retried", { entry: entryFacts(last(retried)), dom: entryDom() });
  scrollToEntry();
  await shot("e4-after-retry");

  // ---- E5: the spend limit, then a rate limit ----
  await services.ask.newConversation();
  await queue("status=429:spend=1:label=E5-spend");
  const spend = await services.ask.ask(TOKYO_QUESTION, false);
  await settle();
  await post("E5-spend", { entry: entryFacts(last(spend)), retryEntryId: spend.retryEntryId, dom: entryDom() });
  scrollToEntry();
  await shot("e5-spend");
  await services.ask.newConversation();
  await queue("status=429:retry_after=7:label=E5-rate");
  const rate = await services.ask.ask(TOKYO_QUESTION, false);
  await settle();
  await post("E5-rate", { entry: entryFacts(last(rate)), retryEntryId: rate.retryEntryId, is_retry_entry: rate.retryEntryId === last(rate)?.id, dom: entryDom() });
  scrollToEntry();
  await shot("e5-rate-limit");

  // ---- E6: a follow-up ----
  await services.ask.newConversation();
  await services.clearCache();
  await queue("tool_use_search:label=E6-q1-r1", "text:label=E6-q1-r2");
  const e6q1 = await services.ask.ask(TOKYO_QUESTION, false);
  await queue("text:label=E6-q2-r1");
  const e6q2 = await services.ask.ask(FOLLOW_UP, false);
  await settle();
  await post("E6", { q1: entryFacts(last(e6q1)), q2: entryFacts(last(e6q2)), entries: e6q2.entries.length, dom: entryDom() });
  scrollToEntry();
  await shot("e6-follow-up");

  // A5's state with a failure that points at a new conversation: its own New conversation button beside the screen's.
  await services.ask.newConversation();
  await queue("status=413:label=A5-too-large");
  const tooLarge = await services.ask.ask(TOKYO_QUESTION, false);
  await settle();
  await post("A5-too-large", { entry: entryFacts(last(tooLarge)), dom: entryDom() });
  scrollToEntry();
  await shot("a5-too-large");
  await cleanSlate(services);
}

/** E7: a 40 s first request; the host opens Settings 3 s in and comes back at 30 s. */
async function phaseE7(services: AppServices): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  await reopenAsk();
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const visibility: Values[] = [];
  const onVisibility = () => visibility.push({ state: document.visibilityState, at_ms: at() });
  document.addEventListener("visibilitychange", onVisibility);
  const terminals: Values[] = [];
  const activity: Values[] = [];
  let lastEnd: string | null = null;
  let lastActivity = "";
  const off = services.ask.subscribe(() => {
    const state = services.ask.state();
    const kind = state.running?.activity.kind ?? "none";
    const request = state.running?.activity.kind === "request" ? state.running.activity.request : null;
    const key = `${kind}:${request}`;
    if (key !== lastActivity) {
      lastActivity = key;
      activity.push({ kind, request, at_ms: at(), visibility: document.visibilityState });
    }
    const end = last(state)?.end ?? null;
    const endKey = end === null ? null : `${end.status}@${end.at}`;
    if (endKey !== null && endKey !== lastEnd) terminals.push({ status: end?.status, at_ms: at(), visibility: document.visibilityState });
    lastEnd = endKey;
  });
  // 13 events, 12 gaps of 3,333 ms: the first replay ends about 40 s after it starts, with a ping each second.
  await queue("tool_use_search:every=3333:ping=1000:label=E7-r1", "text:label=E7-r2");
  const asked = services.ask.ask(TOKYO_QUESTION, false);
  await post("e7_asked", {});
  const final = await asked;
  // Keep listening, so a second terminal state would be recorded if one ever came.
  await sleep(5_000);
  off();
  document.removeEventListener("visibilitychange", onVisibility);
  await settle();
  await post("E7", { terminals, terminal_count: terminals.length, activity, visibility, entry: entryFacts(last(final)), dom: entryDom() });
  scrollToEntry();
  await shot("e7-after-return");
  await cleanSlate(services);
}

/** E8, first half: a slow replay, which the host ends by terminating the app. */
async function phaseE8(services: AppServices): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  await reopenAsk();
  await queue("text:every=5000:label=E8");
  void services.ask.ask(TOKYO_QUESTION, false);
  const out = await waitState(services, "the request to go out", (s) => s.running?.activity.kind === "request");
  await post("e8_request_out", { entry: entryFacts(last(out)) });
}

/** E8, second half: after the relaunch. */
async function phaseE8Relaunch(services: AppServices): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  await reopenAsk();
  const restored = await waitState(services, "the restored conversation", (s) => s.entries.length >= 1);
  await settle();
  await post("E8", { entries: restored.entries.map(entryFacts), retryEntryId: restored.retryEntryId, dom: entryDom() });
  scrollToEntry();
  await shot("e8-unfinished");
  await cleanSlate(services);
}

/** A4 (and A5's states) on one device: Settings, Ask idle, the nav with Watches (12) and Ask (working), Ask answered. */
async function phaseLayout(services: AppServices, device: string): Promise<void> {
  await setKeys(services, PROBE_KEY, SEATS_NORMAL);
  const grid = await gridSearch(GRID_QUERY);
  await post(`A4-${device}-search`, grid);

  await go("#/settings", () => document.querySelector(".settings-section"));
  await waitFor("the key on file", () => (document.querySelector(".settings-section")?.textContent ?? "").includes("On file:"));
  document.querySelector(".settings-section")?.scrollIntoView({ block: "start" });
  await shot(`a4-${device}-settings-anthropic`);

  await go("#/ask", askScreen);
  await waitFor("the context checkbox and an enabled composer", () => document.querySelector(".ask-check") && composer() && !composer()!.disabled);
  window.scrollTo(0, 0);
  await shot(`a4-${device}-ask-idle`);

  const now = new Date().toISOString();
  for (let i = 1; i <= 12; i++) {
    services.watches.add({
      id: `e2e-watch-${i}`,
      name: `Layout check ${i}`,
      text: `SFO to NRT, next ${i + 10} days, business`,
      lastCheckedAt: null,
      baseline: [],
      dropThresholdPct: 10,
      unseen: { new: 1, dropped: 0, cheaper: 0, since: now },
      enabled: false,
      createdAt: now,
    });
  }
  services.notifyWatchesChanged();
  // 8 events 2 s apart: long enough to photograph the running state.
  await queue(`text:every=2000:label=A4-${device}`);
  const asked = services.ask.ask(SEARCH_QUESTION, true);
  await waitState(services, "the request to go out", (s) => s.running?.activity.kind === "request");
  await waitFor("the nav to say so", () => {
    const nav = textOf(document.querySelector("nav"));
    return nav.includes("Ask (working)") && nav.includes("Watches (12)");
  });
  window.scrollTo(0, 0);
  await shot(`a4-${device}-nav-working`);
  scrollToEntry();
  await shot(`a4-${device}-ask-running-entry`);

  await asked;
  await settle();
  window.scrollTo(0, 0);
  await shot(`a4-${device}-ask-answered`);
  scrollToEntry();
  await shot(`a4-${device}-ask-answered-entry`, { entry: entryDom() });
  window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0);
  await shot(`a4-${device}-footer`);
  await cleanSlate(services);
}

type Phase = (services: AppServices, arg: string) => Promise<void>;

const PHASES: Record<string, Phase> = {
  a3: phaseA3,
  e1: phaseE1,
  e3_relaunch: phaseE3Relaunch,
  e7: phaseE7,
  e8: phaseE8,
  e8_relaunch: phaseE8Relaunch,
  layout: phaseLayout,
};

export async function startE2E(services: AppServices): Promise<void> {
  if (started) return;
  started = true;
  const hello = await post("start", { href: location.href, visibility: document.visibilityState, user_agent: navigator.userAgent });
  const phase = typeof hello?.phase === "string" ? hello.phase : null;
  if (hello?.armed !== true || phase === null) {
    // Not armed by run-probes.sh for this launch: nothing is sent to either server.
    await post("e2e-not-armed", { reply: hello });
    return;
  }
  const [name = "", arg = ""] = phase.split(":");
  const run = PHASES[name];
  if (run === undefined) {
    await post(`phase-done:${phase}`, { harness_error: `unknown phase ${phase}` }, false);
    return;
  }
  try {
    await run(services, arg);
    await post(`phase-done:${phase}`, {}, true);
  } catch (err) {
    await post(`phase-done:${phase}`, { harness_error: errorFacts(err), dom: domFacts() }, false);
  }
}
