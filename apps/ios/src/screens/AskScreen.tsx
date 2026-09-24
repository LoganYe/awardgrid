/**
 * Ask (route #/ask, a full-height page since T15; docs/04 S09): a view of AppServices.ask, which owns the conversation
 * and runs every question.
 *
 * The screen never runs a question itself, so leaving it never stops one (ask-service.ts). It renders the service's
 * state through useSyncExternalStore and calls its methods. What is the screen's own:
 *
 *   - WHICH KEYS ARE ON FILE, read when the screen opens (the SearchScreen pattern). The service reports a missing key
 *     only after ask(), and a composer that looks ready and then refuses would be a small lie. Until both keys have
 *     been read, Ask stays off. A no-key notice the service raised since the screen opened disables the composer too.
 *   - WHAT THE NEXT QUESTION SENDS (T15), said from the service's own builder (`preview`), the one a question uses: the
 *     search on screen, and the selected results only when attached. It can never say results go when only the search
 *     does. Earlier questions that go with it, and results on screen that are incomplete, are said too.
 *   - THE WAIT COUNTER. A one-second interval, running only while a question does and cleared on unmount, re-renders
 *     so "Waiting for Claude (12 s)" counts up from when the request went out. It never estimates what is left.
 *   - ANNOUNCEMENTS. One visually hidden role="status" region says the transitions only (design §6.5): a request
 *     going out, a search starting, and how a question ended, when that happened while the screen was open. A
 *     failure line is role="alert" on the same terms, so reopening the screen does not read old failures out again.
 *   - WHERE THE READER IS. Entries read oldest first, newest at the bottom (S09). Reading at the end, new content
 *     follows into view; reading earlier content, nothing moves, and "New content below" offers the way down.
 *
 * Layout, top to bottom: the header (Back, title, New conversation, which asks first); what the next question sends,
 * with its choices; the conversation, scrolling (the intro and suggestions while it is empty); the composer, above
 * the keyboard, with its one button, Ask or Stop, and the Stop note while a question runs. When native HTTP is
 * missing, only the wiring message is shown.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router";
import type { AskEntry as Entry } from "@awardgrid/core/ask/conversation";
import { MAX_QUESTION_CHARS } from "@awardgrid/core/ask/limits";
import { SEARCH_AWARDS } from "@awardgrid/core/ask/tools";
import { copy, querySubline, routeLabel } from "@awardgrid/core/workspace/present";
import type { AppServices } from "../app/bootstrap";
import { useFocusOnArrival } from "../app/focus";
import { useKeepInView } from "../app/keyboard";
import { type Locale, langTag, useLocale } from "../app/locale";
import { ASK_COPY } from "../ask/ask-copy";
import type { AskNotice, AskState, ContextPreview } from "../ask/ask-service";
import { ANNOUNCEMENTS, includeSearchLabel, searchSummary, toolRunningLabel } from "../ask/labels";
import { AskEntry } from "../components/AskEntry";
import { Button, IconButton, Sheet } from "../components/ui";
import type { KeyStore } from "../native/keychain";
import type { LastSearchEntry } from "../search/last-search";
import "./ask.css";

/** Whether each key is on file: null until the Keychain has been read. */
export interface KeyPresence {
  anthropic: boolean | null;
  seats: boolean | null;
}

const KEYS_NOT_READ: KeyPresence = { anthropic: null, seats: null };

/** Both keys, read as the service reads them when a question starts: a blank key or a store that throws is no key. */
export async function readKeyPresence(services: Pick<AppServices, "anthropicKeys" | "keys">): Promise<{ anthropic: boolean; seats: boolean }> {
  const onFile = async (store: KeyStore): Promise<boolean> => {
    try {
      const key = await store.get();
      return typeof key === "string" && key.trim().length > 0;
    } catch {
      return false;
    }
  };
  const [anthropic, seats] = await Promise.all([onFile(services.anthropicKeys), onFile(services.keys)]);
  return { anthropic, seats };
}

const KEY_NOTICES: ReadonlySet<AskNotice["kind"]> = new Set(["no_anthropic_key", "no_seats_key"]);

/**
 * Which key the composer waits for. The Keychain read when the screen opened decides, and a no-key refusal the
 * service gave since then adds to it. A refusal the screen opened on is from an earlier visit, and the read is newer.
 */
export function missingKeys(state: AskState, atOpen: AskState, keys: KeyPresence): { anthropic: boolean; seats: boolean } {
  const refused = state.notice !== null && state.notice !== atOpen.notice && KEY_NOTICES.has(state.notice.kind) ? state.notice.kind : null;
  return {
    anthropic: keys.anthropic === false || refused === "no_anthropic_key",
    seats: keys.seats === false || refused === "no_seats_key",
  };
}

/** Whether `entry` ended, or ended differently, after the screen opened on `atOpen`. */
export function endedSinceOpen(entry: Entry, atOpen: AskState): boolean {
  if (entry.end === null) return false;
  const before = atOpen.entries.find((e) => e.id === entry.id)?.end ?? null;
  return before === null || before.status !== entry.end.status || before.at !== entry.end.at;
}

/**
 * What the status region says for `state`, given the state the screen opened on. Only a change is announced: a request
 * or a tool call that started after the screen opened, or a question that ended after it opened. A question that
 * ended before, or one the app was closed during, says nothing, and neither does a step between two others.
 */
export function askAnnouncement(state: AskState, atOpen: AskState): string {
  const running = state.running;
  if (running !== null) {
    const { activity } = running;
    const started = atOpen.running?.activity !== activity;
    if (activity.kind === "request") return started ? ANNOUNCEMENTS.waiting : "";
    if (activity.kind === "tool") {
      if (!started) return "";
      // A flight lookup is not a search, so it says what it is instead of borrowing "Searching seats.aero".
      return activity.name === SEARCH_AWARDS ? ANNOUNCEMENTS.searching : toolRunningLabel(activity.name, null);
    }
    // Between steps, or paused, on a question that has started: nothing new to say.
    if (running.entryId !== null) return "";
  }
  const last = state.entries[state.entries.length - 1];
  if (last === undefined || last.end === null || !endedSinceOpen(last, atOpen)) return "";
  switch (last.end.status) {
    case "answered":
    case "truncated":
      return ANNOUNCEMENTS.answered;
    case "stopped":
      return ANNOUNCEMENTS.stopped;
    case "unfinished":
      return "";
    default:
      return ANNOUNCEMENTS.failed;
  }
}

/** "Include my last search: SEA to NRT, HND, 2026-10-01 to 2026-10-30, business", from the query Claude is told about. */
export function lastSearchLabel(last: LastSearchEntry): string {
  const query = last.value.query;
  return includeSearchLabel(
    searchSummary({
      origins: query.origins,
      destinations: query.destinations,
      date_from: query.date_from,
      date_to: query.date_to,
      cabins: query.cabins,
      programs: query.programs ?? null,
      direct_only: query.direct_only,
    }),
  );
}

/** The route element: the services from the shell, and which keys are on file. */
export function AskScreen() {
  const services = useOutletContext<AppServices>();
  const [keys, setKeys] = useState<KeyPresence>(KEYS_NOT_READ);

  useEffect(() => {
    let cancelled = false;
    void readKeyPresence(services).then((found) => {
      if (!cancelled) setKeys(found);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  return <AskView services={services} keys={keys} />;
}

export interface AskViewProps {
  services: Pick<AppServices, "ask" | "lastSearch"> & Partial<Pick<AppServices, "locale" | "settings" | "details">>;
  keys: KeyPresence;
  /** Milliseconds since the epoch, for the wait counter. */
  now?: () => number;
}

/**
 * What the next question sends, from the service's own builder (T15). A stand-in service without one (older tests)
 * is read the way questions were before T15: the last search's query, no results.
 */
function previewOf(services: AskViewProps["services"], includeSearch: boolean, attachRows: boolean): ContextPreview {
  const built = services.ask.preview?.(includeSearch, attachRows);
  if (built) return built;
  const last = services.lastSearch.get();
  const base = { snapshot: null, rows: [], refused: null, earlier: 0, selected: 0 };
  if (!includeSearch || last === null) return { ...base, context: null };
  return { ...base, context: { revision: 0, snapshotId: "", sent: "query_only", query: last.value.query, selectedRefs: [] } };
}

/** Within this many pixels of the end, the reader is "at the newest" and new content follows into view. */
const AT_END_PX = 32;

export function AskView({ services, keys, now = Date.now }: AskViewProps) {
  const locale = useLocale(services as Partial<Pick<AppServices, "locale" | "settings">>);
  const c = ASK_COPY[locale];
  // Messages core and the service write, and a question's steps and endings, are English until T17 (U-039, U-050).
  const english = locale === "en" ? undefined : "en";
  const { ask } = services;
  const navigate = useNavigate();
  // Where Ask was opened from, to hand focus back to on the way out (T15).
  const location = useLocation();
  const [returnFocus] = useState(() => (location.state as { returnFocus?: string } | null)?.returnFocus ?? "search-title");
  const state = useSyncExternalStore(ask.subscribe, ask.state, ask.state);
  const [atOpen] = useState(state);
  const [draft, setDraft] = useState("");
  // On by default whenever there is a search (design §6.2); results are attached only when chosen.
  const [includeSearch, setIncludeSearch] = useState(true);
  const [attachRows, setAttachRows] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [clock, setClock] = useState(now);
  const composer = useRef<HTMLTextAreaElement>(null);
  // The text box and its Ask/Stop button come up above the keyboard together (T11).
  const composerBlock = useRef<HTMLDivElement>(null);
  useKeepInView(composerBlock);
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);

  const running = state.running;
  const questionRunning = running !== null;
  useEffect(() => {
    if (!questionRunning) return;
    // Only re-renders: the wait is always measured from the request's own start time.
    const tick = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(tick);
  }, [questionRunning, now]);

  // Newest at the bottom. Reading at the end, new content follows into view; reading earlier content, nothing moves,
  // and "New content below" says there is more (S09).
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [newContent, setNewContent] = useState(false);
  const last = state.entries[state.entries.length - 1];
  // What can appear at the end: an entry's progress, and the callouts and notices below the conversation.
  const calloutsKey = `${keys.anthropic}:${keys.seats}:${state.full ?? ""}:${state.notice?.kind ?? ""}:${state.notice?.message ?? ""}`;
  const progress = `${state.entries.length}:${last?.texts.join("").length ?? 0}:${last?.steps.length ?? 0}:${last?.end?.status ?? ""}:${running?.activity.kind ?? ""}:${calloutsKey}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
    else setNewContent(true);
  }, [progress]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX;
    if (atEnd.current) setNewContent(false);
  };
  const toNewest = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setNewContent(false);
  };

  // Back to the results, focus on what opened Ask (the Search screen applies it once), as the editor does.
  const back = () => navigate("/", { replace: true, state: { focus: returnFocus } });

  const header = (withNew: boolean) => (
    <header className="ask-header">
      <IconButton icon="chevron-left" label={c.back} onClick={back} />
      <h1 ref={title} tabIndex={-1} className="ask-title">
        {c.title}
      </h1>
      {withNew && state.entries.length > 0 ? (
        <button type="button" className="ag-button ask-new" disabled={questionRunning} onClick={() => setConfirmNew(true)}>
          {c.newConversation}
        </button>
      ) : null}
    </header>
  );

  if (state.wiring !== null) {
    return (
      <div className="ask-screen" lang={langTag(locale)}>
        {/* Nothing but the wiring message: no question can start, and none can be cleared here. */}
        {header(false)}
        <p role="alert" className="ask-callout" lang={english}>
          {state.wiring}
        </p>
      </div>
    );
  }

  const missing = missingKeys(state, atOpen, keys);
  const composerDisabled = missing.anthropic || missing.seats;
  const keysRead = keys.anthropic !== null && keys.seats !== null;
  const cannotStart = composerDisabled || !keysRead || questionRunning || state.full !== null;
  const notice = state.notice !== null && !KEY_NOTICES.has(state.notice.kind) && state.notice.kind !== "wiring" ? state.notice : null;

  // What the next question sends, built by the function the question itself uses (approved rows, T15).
  const withRows = previewOf(services, true, true);
  const selectable = withRows.refused !== null ? 0 : (withRows.context?.selectedRefs.length ?? 0);
  // A selection that cannot go is said, never silently dropped.
  const cannotAttach = withRows.selected > 0 && withRows.refused !== null;
  const hasSearch = previewOf(services, true, false).context !== null;
  const attaching = includeSearch && attachRows && selectable > 0;
  const preview = previewOf(services, includeSearch, attaching);
  const search = preview.context ? `${routeLabel(preview.context.query, locale)} · ${querySubline(preview.context.query, locale)}` : null;
  const sends =
    preview.context === null
      ? c.sendsQuestionOnly
      : preview.context.sent === "query_and_selected_rows"
        ? copy("ai.selected", locale, { count: String(preview.rows.length) })
        : copy("ai.query_only", locale);
  const coverage = preview.context && preview.snapshot ? preview.snapshot.coverage.state : "complete";

  const suggestions = preview.context !== null ? c.suggestionsWithSearch : c.suggestionsWithoutSearch;
  const activity = running?.activity ?? null;
  const waitSeconds = activity?.kind === "request" ? (clock - Date.parse(activity.startedAt)) / 1000 : 0;
  // Oldest first, as a conversation reads (S09), each with the entries before it: the history its requests resent.
  const entries = state.entries.map((entry, i) => ({ entry, earlier: state.entries.slice(0, i) }));

  const send = () => {
    const text = draft;
    const before = ask.state().entries.length;
    setDraft("");
    // Focus stays in the composer after sending (design §6.5), ready for a follow-up.
    composer.current?.focus();
    // Asking is reading the newest again: what the question writes follows into view.
    atEnd.current = true;
    // The snapshot this page said would go: if another is on screen by the time the tap lands, nothing goes.
    void ask.ask(text, includeSearch && preview.context !== null, attaching, preview.context?.snapshotId ?? null).then((after) => {
      // Refused before it started (a missing key, a question too long): the words come back to be fixed.
      if (after.entries.length <= before) setDraft((current) => (current === "" ? text : current));
    });
  };

  const noticeText = (n: AskNotice): { text: string; english: boolean } => {
    const own: Partial<Record<AskNotice["kind"], string>> = {
      busy: c.busy,
      cleared: c.cleared,
      keys_changed: c.keysChanged,
      retry_unavailable: c.retryUnavailable,
      context_changed: c.contextChanged,
      search_changed: c.searchChanged,
    };
    const text = own[n.kind];
    return text ? { text, english: false } : { text: n.message, english: true };
  };

  return (
    <div className="ask-screen" lang={langTag(locale)}>
      {/* Always mounted: a live region only announces changes once it is already in the accessibility tree. */}
      <p role="status" className="sr-only" lang={english}>
        {askAnnouncement(state, atOpen)}
      </p>

      {header(true)}

      <section className="ask-context" data-testid="ai-context" aria-labelledby="ask-context-title">
        <h2 id="ask-context-title" className="ask-context-title">
          {c.contextTitle}
        </h2>
        <p className="ask-context-sends">{sends}</p>
        {search !== null ? <p className="ask-context-search">{c.searchLine(search)}</p> : null}
        {preview.earlier > 0 ? <p className="ask-context-note">{c.sendsEarlier(preview.earlier)}</p> : null}
        {coverage === "partial" ? <p className="ask-context-note">{c.partialNote}</p> : null}
        {coverage === "unknown" ? <p className="ask-context-note">{c.unknownCoverageNote}</p> : null}
        {hasSearch ? (
          <div className="ask-context-choices">
            <label className="ask-check">
              <input type="checkbox" checked={includeSearch} onChange={(e) => setIncludeSearch(e.target.checked)} />
              <span>{c.includeSearch}</span>
            </label>
            {selectable > 0 ? (
              <label className="ask-check">
                <input type="checkbox" checked={attaching} disabled={!includeSearch} onChange={(e) => setAttachRows(e.target.checked)} />
                <span>{c.attachRows(selectable)}</span>
              </label>
            ) : null}
            {cannotAttach && includeSearch ? <p className="ask-context-note">{c.cannotAttach}</p> : null}
          </div>
        ) : null}
      </section>

      <div ref={scroller} className="ask-scroll" onScroll={onScroll}>
        {entries.length === 0 ? (
          <>
            <p className="ask-subline">{c.subline}</p>
            <ul className="ask-suggestions">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  {/* Fills the question box and sends nothing. */}
                  <button type="button" className="ask-suggestion" disabled={composerDisabled} onClick={() => setDraft(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          // Not a live region: the status region above announces the transitions (design §6.5).
          <ol className="ask-entries" data-surface="flat" aria-busy={questionRunning}>
            {entries.map(({ entry, earlier }) => (
              <AskEntry
                key={entry.id}
                entry={entry}
                earlier={earlier}
                bookingUrls={state.bookingUrls}
                retryEntryId={state.retryEntryId}
                activity={running?.entryId === entry.id ? running.activity : null}
                waitSeconds={waitSeconds}
                busy={questionRunning}
                askAgainDisabled={cannotStart}
                announce={endedSinceOpen(entry, atOpen)}
                locale={locale}
                resolveRow={services.details ? (ref) => services.details!.resolve(ref)?.row ?? null : undefined}
                onTryAgain={() => void ask.retry()}
                onAskAgain={(id) => void ask.askAgain(id)}
                onNewConversation={() => setConfirmNew(true)}
              />
            ))}
          </ol>
        )}

        {missing.anthropic ? <ConnectAnthropic locale={locale} /> : null}
        {missing.seats ? <KeyCallout message={c.noSeatsKey} action={c.openSettings} /> : null}
        {state.full !== null ? (
          <div className="ask-callout">
            <p lang={english}>{state.full}</p>
            <button type="button" className="ag-button" disabled={questionRunning} onClick={() => setConfirmNew(true)}>
              {c.newConversation}
            </button>
          </div>
        ) : null}
        {notice !== null ? (
          <p
            role={notice.kind !== "cleared" && notice !== atOpen.notice ? "alert" : undefined}
            className={notice.kind === "cleared" ? "ask-callout ask-callout-neutral" : "ask-callout"}
            lang={noticeText(notice).english ? english : undefined}
          >
            {noticeText(notice).text}
          </p>
        ) : null}

        <div className="ask-conversation">
          <p className="ask-note">{c.conversationNote}</p>
        </div>
      </div>

      {newContent ? (
        <button type="button" className="ag-button ask-new-content" onClick={toNewest}>
          {copy("ai.new_content", locale)}
        </button>
      ) : null}

      <div ref={composerBlock} className="ask-composer">
        <textarea
          ref={composer}
          className="ag-input ask-input"
          aria-label={c.questionLabel}
          maxLength={MAX_QUESTION_CHARS}
          rows={1}
          value={draft}
          disabled={composerDisabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* One button in one place: Ask, or Stop while a question runs. */}
        {running !== null ? (
          <button type="button" className="ag-button ag-button-primary ask-send" disabled={running.stopping} onClick={() => ask.stop()}>
            {c.stop}
          </button>
        ) : (
          <button type="button" className="ag-button ag-button-primary ask-send" disabled={cannotStart || draft.trim().length === 0} onClick={send}>
            {c.ask}
          </button>
        )}
        {running !== null ? <p className="ask-note ask-stop-note">{c.stopNote}</p> : null}
      </div>

      <Sheet open={confirmNew} title={c.confirmNewTitle} closeLabel={c.close} onClose={() => setConfirmNew(false)}>
        <p style={{ margin: 0 }}>{c.confirmNewBody}</p>
        <div className="ask-actions">
          <Button
            variant="danger"
            onClick={() => {
              setConfirmNew(false);
              void ask.newConversation().then(() => composer.current?.focus());
            }}
          >
            {c.newConversation}
          </Button>
          <Button onClick={() => setConfirmNew(false)}>{c.keepConversation}</Button>
        </div>
      </Sheet>
    </div>
  );
}

export const CONNECT_ANTHROPIC: Record<Locale, { title: string; body: string; sent: string; add: string }> = {
  en: {
    title: "Connect Anthropic",
    body: "AI assistance uses your own Anthropic API key. Search, results and watches work without it.",
    sent: "When you ask, your question, the earlier questions and answers in this conversation, the search you include and the seats.aero results Ask reads go to Anthropic, which bills your key.",
    add: "Add an Anthropic key",
  },
  zh: {
    title: "连接 Anthropic",
    body: "AI 辅助使用你自己的 Anthropic API 密钥。查票、结果和关注不需要它。",
    sent: "提问时，你的问题、本次对话中之前的问答、你附带的查询，以及 AI 辅助读取的 seats.aero 结果会发往 Anthropic，并由 Anthropic 按此密钥计费。",
    add: "添加 Anthropic 密钥",
  },
};

/**
 * The first AI entry without an Anthropic key (T11; spec §16: the key waits until here): what connecting means, in
 * the screen's language, and the way to add one. An expected, optional step, not a failure: a plain region with a
 * heading, not an alert. Nothing is sent to Anthropic until a key is added and a question asked.
 */
function ConnectAnthropic({ locale }: { locale: Locale }) {
  const c = CONNECT_ANTHROPIC[locale];
  return (
    <section aria-labelledby="ask-connect-title" className="ask-connect" lang={langTag(locale)}>
      <h2 id="ask-connect-title" className="ask-connect-title">
        {c.title}
      </h2>
      <p>{c.body}</p>
      <p>{c.sent}</p>
      <Link to="/settings/anthropic" className="ag-button ag-button-primary">
        {c.add}
      </Link>
    </section>
  );
}

function KeyCallout({ message, action }: { message: string; action: string }) {
  return (
    <div role="alert" className="ask-callout">
      <p>{message}</p>
      <Link to="/settings" className="ag-button">
        {action}
      </Link>
    </div>
  );
}
