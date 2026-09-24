/**
 * Ask (route #/ask): a view of AppServices.ask, which owns the conversation and runs every question.
 *
 * The screen never runs a question itself, so leaving it never stops one (ask-service.ts). It renders the service's
 * state through useSyncExternalStore and calls its methods. Three things are the screen's own:
 *
 *   - WHICH KEYS ARE ON FILE, read when the screen opens (the SearchScreen pattern). The service reports a missing key
 *     only after ask(), and a composer that looks ready and then refuses would be a small lie. Until both keys have
 *     been read, Ask stays off. A no-key notice the service raised since the screen opened disables the composer too.
 *   - THE WAIT COUNTER. A one-second interval, running only while a question does and cleared on unmount, re-renders
 *     so "Waiting for Claude (12 s)" counts up from when the request went out. It never estimates what is left.
 *   - ANNOUNCEMENTS. One visually hidden role="status" region says the transitions only (design §6.5): a request
 *     going out, a search starting, and how a question ended, when that happened while the screen was open. A
 *     failure line is role="alert" on the same terms, so reopening the screen does not read old failures out again.
 *
 * Layout, top to bottom (design §6.3): title and subline; "Include my last search"; the suggestions, while the
 * conversation is empty (§6.4 "Idle, empty"); the composer with its one button, Ask or Stop, and the Stop note while
 * a question runs; what refused the last action (a missing key, a full conversation, a notice), directly under the
 * composer that action came from; the entries, newest first; New conversation and the note on how long answers are
 * kept. When native HTTP is missing, only the wiring message is shown.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useOutletContext } from "react-router";
import type { AskEntry as Entry } from "@awardgrid/core/ask/conversation";
import { MAX_QUESTION_CHARS } from "@awardgrid/core/ask/limits";
import { SEARCH_AWARDS } from "@awardgrid/core/ask/tools";
import type { AppServices } from "../app/bootstrap";
import { useKeepInView } from "../app/keyboard";
import { type Locale, langTag, useLocale } from "../app/locale";
import type { AskNotice, AskState } from "../ask/ask-service";
import {
  ANNOUNCEMENTS,
  ASK_BUTTON,
  ASK_SUBLINE,
  ASK_TITLE,
  CONVERSATION_NOTE,
  NEW_CONVERSATION,
  NO_SEATS_KEY,
  OPEN_SETTINGS,
  QUESTION_LABEL,
  STOP_BUTTON,
  STOP_NOTE,
  SUGGESTIONS_WITHOUT_SEARCH,
  SUGGESTIONS_WITH_SEARCH,
  includeSearchLabel,
  searchSummary,
  toolRunningLabel,
} from "../ask/labels";
import { AskEntry } from "../components/AskEntry";
import type { KeyStore } from "../native/keychain";
import type { LastSearchEntry } from "../search/last-search";

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
  services: Pick<AppServices, "ask" | "lastSearch">;
  keys: KeyPresence;
  /** Milliseconds since the epoch, for the wait counter. */
  now?: () => number;
}

export function AskView({ services, keys, now = Date.now }: AskViewProps) {
  // The first-AI-entry panel speaks the screen's language; the rest of Ask is English until its rework (T15–T17), and
  // is marked so on a Chinese screen.
  const locale = useLocale(services as Partial<Pick<AppServices, "locale" | "settings">>);
  const { ask } = services;
  const state = useSyncExternalStore(ask.subscribe, ask.state, ask.state);
  const [atOpen] = useState(state);
  const [lastSearch] = useState(() => services.lastSearch.get());
  const [draft, setDraft] = useState("");
  // On by default whenever a last search exists (design §6.2).
  const [includeSearch, setIncludeSearch] = useState(true);
  const [clock, setClock] = useState(now);
  const composer = useRef<HTMLTextAreaElement>(null);
  // The text box and its Ask/Stop button come up above the keyboard together (T11).
  const composerBlock = useRef<HTMLDivElement>(null);
  useKeepInView(composerBlock);

  const running = state.running;
  const questionRunning = running !== null;
  useEffect(() => {
    if (!questionRunning) return;
    // Only re-renders: the wait is always measured from the request's own start time.
    const tick = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(tick);
  }, [questionRunning, now]);

  if (state.wiring !== null) {
    return (
      <div className="ask-screen">
        <p role="alert" className="ask-callout">
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

  const withSearch = lastSearch !== null && includeSearch;
  const suggestions = withSearch ? SUGGESTIONS_WITH_SEARCH : SUGGESTIONS_WITHOUT_SEARCH;
  const activity = running?.activity ?? null;
  const waitSeconds = activity?.kind === "request" ? (clock - Date.parse(activity.startedAt)) / 1000 : 0;
  // Newest first, each with the entries before it in the conversation: the history its requests resent.
  const entries = state.entries.map((entry, i) => ({ entry, earlier: state.entries.slice(0, i) })).reverse();

  const send = () => {
    const text = draft;
    const before = ask.state().entries.length;
    setDraft("");
    // Focus stays in the composer after sending (design §6.5), ready for a follow-up.
    composer.current?.focus();
    void ask.ask(text, withSearch).then((after) => {
      // Refused before it started (a missing key, a question too long): the words come back to be fixed.
      if (after.entries.length <= before) setDraft((current) => (current === "" ? text : current));
    });
  };

  const newConversationButton = (
    <button type="button" className="ag-button" disabled={questionRunning} onClick={() => void ask.newConversation()}>
      {NEW_CONVERSATION}
    </button>
  );

  return (
    <div className="ask-screen" lang={locale === "zh" ? "en" : undefined}>
      {/* Always mounted: a live region only announces changes once it is already in the accessibility tree. */}
      <p role="status" className="sr-only">
        {askAnnouncement(state, atOpen)}
      </p>

      <section data-surface="rich" className="ag-surface">
        <h1 className="ag-title">{ASK_TITLE}</h1>
        <p className="ask-subline">{ASK_SUBLINE}</p>
      </section>

      {lastSearch !== null ? (
        <label className="ask-check">
          <input type="checkbox" checked={includeSearch} onChange={(e) => setIncludeSearch(e.target.checked)} />
          <span>{lastSearchLabel(lastSearch)}</span>
        </label>
      ) : null}

      {entries.length === 0 ? (
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
      ) : null}

      <div ref={composerBlock} className="ask-composer">
        <textarea
          ref={composer}
          className="ag-input"
          aria-label={QUESTION_LABEL}
          maxLength={MAX_QUESTION_CHARS}
          rows={3}
          value={draft}
          disabled={composerDisabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* One button in one place: Ask, or Stop while a question runs. */}
        {running !== null ? (
          <button type="button" className="ag-button ag-button-primary ask-send" disabled={running.stopping} onClick={() => ask.stop()}>
            {STOP_BUTTON}
          </button>
        ) : (
          <button type="button" className="ag-button ag-button-primary ask-send" disabled={cannotStart || draft.trim().length === 0} onClick={send}>
            {ASK_BUTTON}
          </button>
        )}
        {running !== null ? <p className="ask-note">{STOP_NOTE}</p> : null}
      </div>

      {missing.anthropic ? <ConnectAnthropic locale={locale} /> : null}
      {missing.seats ? <KeyCallout message={NO_SEATS_KEY} /> : null}
      {state.full !== null ? (
        <div className="ask-callout">
          <p>{state.full}</p>
          {newConversationButton}
        </div>
      ) : null}
      {notice !== null ? (
        <p role={notice.kind !== "cleared" && notice !== atOpen.notice ? "alert" : undefined} className={notice.kind === "cleared" ? "ask-callout ask-callout-neutral" : "ask-callout"}>
          {notice.message}
        </p>
      ) : null}

      {entries.length > 0 ? (
        // Not a live region: the status region above announces the transitions (design §6.5).
        <ul className="ask-entries" data-surface="flat" aria-busy={questionRunning}>
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
              onTryAgain={() => void ask.retry()}
              onAskAgain={(id) => void ask.askAgain(id)}
              onNewConversation={() => void ask.newConversation()}
            />
          ))}
        </ul>
      ) : null}

      <div className="ask-conversation">
        {entries.length > 0 ? newConversationButton : null}
        <p className="ask-note">{CONVERSATION_NOTE}</p>
      </div>
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

function KeyCallout({ message }: { message: string }) {
  return (
    <div role="alert" className="ask-callout">
      <p>{message}</p>
      <Link to="/settings" className="ag-button">
        {OPEN_SETTINGS}
      </Link>
    </div>
  );
}
