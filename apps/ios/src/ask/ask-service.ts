/**
 * Ask, owned by the app rather than by a screen: the one conversation, the question under way, and every save.
 *
 * The Ask screen renders `state()` and calls the methods below; it never runs a question itself (design §1.2,
 * §2.5). Three behaviours follow from that split:
 *
 *   - LEAVING THE SCREEN NEVER STOPS A QUESTION. Unsubscribing only stops the screen hearing about it. This departs
 *     on purpose from the web drawer's abort-on-close, which protected an operator's shared budget (design §2.5).
 *     Here the person pays, and a question they looked away from is still one they may want answered.
 *   - KEYS ARE READ WHEN A QUESTION STARTS. Both come from the Keychain at that moment, never at launch and never
 *     kept for the next question. Without an Anthropic key no client is built and nothing goes to Anthropic.
 *     Without a seats.aero key the question is refused before it starts. Try again resends only on the keys the
 *     question started with, so a key removed in Settings is never used again.
 *   - EVERY STEP IS ON DISK BEFORE THE NEXT ONE. ask.json is written when a question starts (with its `pending`
 *     marker), as each model request is sent (its count, which that request itself does not wait for), after every
 *     model request and every tool call, and when the question ends, which clears `pending`.
 *     The loop sends nothing until those writes have landed. Before every request and every tool call it awaits
 *     waitUntilVisible (core loop.ts gate), and that wait begins with every write queued so far. Stop still ends
 *     the wait. So the first request goes out with its `pending` marker already on disk, and each request or tool
 *     call after it with what the step before it returned. A write that fails is logged and the question goes on:
 *     a failed save never ends a question. A tool call that spent calls also runs AppServices.persist(), which
 *     saves the cache, the quota and ask.json together, as does every other persist(). A marker still there at the
 *     next launch means the app was closed mid-question, and restore() turns that entry into an unfinished one
 *     instead of dropping it.
 *
 * What a question may do is core's: runQuestion (packages/core/src/lib/ask/loop.ts), with a tool runner over this
 * device's seats.aero stores (./seats-port.ts). Everything the loop needs from the app is built here: the injected
 * clock and timers, visibility from `visibilitychange` (the event App.tsx listens to), the watch runner's idle
 * signal, and both keys as secrets to mask.
 *
 * Native HTTP is checked by restore() and before every question. A failure there affects Ask only: its state
 * carries the wiring message, and Search and Watches do not depend on this service.
 */
import { createAskClient, type AskModel, type CreateAskClientOptions } from "@awardgrid/core/ask/client";
import { canAsk, newConversation as startConversation, type AskEntry, type Conversation, type QuestionUsage } from "@awardgrid/core/ask/conversation";
import { describeAskError, scrubSecrets } from "@awardgrid/core/ask/errors";
import { ASK_MODEL } from "@awardgrid/core/ask/limits";
import { runQuestion, type AskEvent, type AskOutcome, type LoopDeps } from "@awardgrid/core/ask/loop";
import { checkQuestion, type LastSearch } from "@awardgrid/core/ask/prompt";
import { createToolRunner } from "@awardgrid/core/ask/tools";
import { assertNativeHttpAvailable } from "../native/http";
import type { KeyStore } from "../native/keychain";
import type { LastSearchEntry, LastSearchStore } from "../search/last-search";
import type { SearchEngine } from "../search/search";
import type { AskStore } from "../store/ask-store";
import {
  BUSY,
  CLEARED,
  CONTEXT_CHANGED,
  SEARCH_CHANGED,
  KEY_ACCEPTED,
  KEYS_CHANGED,
  NO_ANTHROPIC_KEY,
  NO_KEY_ON_FILE,
  NO_SEATS_KEY,
  RETRY_UNAVAILABLE,
  WIRING,
  keyCheckFromFailure,
  keyReadFailedLabel,
  keySaveFailedLabel,
  type KeyCheckOutcome,
} from "./labels";
import { createSeatsPort } from "./seats-port";
import { ContextError, type ContextRefusal, attachedRows, buildAIContext, entryContext, lastSearchOf as searchOfQuery, readEntryContext, readEntryProposals } from "./context";
import type { AttachedRow } from "@awardgrid/core/ask/prompt";
import type { EntryContext, EntryProposal } from "@awardgrid/core/ask/conversation";
import type { ScopeGate, ToolRun, ToolRunner } from "@awardgrid/core/ask/tools";
import { RequestNotStartedError, type RequestKind } from "../workspace/request-coordinator";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { proposalStatus } from "@awardgrid/core/workspace/proposals";
import type { AIContext, ResultRef, ResultSnapshot, WorkspaceRow } from "@awardgrid/core/workspace/types";

// ---------------------------------------------------------------------------
// What the service needs
// ---------------------------------------------------------------------------

/** Whether awardgrid is visible, and a way to hear when that changes. */
export interface Visibility {
  isHidden(): boolean;
  /** Call `listener` on every change; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

/**
 * `document.visibilityState` and `visibilitychange`, which iOS delivers when the app goes to the background and
 * comes back. Where there is no document (a test run in Node) the app always reads as visible.
 */
export const documentVisibility: Visibility = {
  isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  onChange(listener) {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

export interface AskServiceDeps {
  /** The Anthropic key's Keychain item (../native/anthropic-key.ts). */
  anthropicKeys: KeyStore;
  /** The seats.aero key's Keychain item (../native/keychain.ts). */
  seatsKeys: KeyStore;
  /** The native adapter for api.anthropic.com. It has no rate-limit observer: Anthropic says nothing about seats.aero's quota. */
  anthropicFetch: typeof fetch;
  /** Bootstrap's seats.aero transport: the rate-limit observer over the native adapter. */
  seatsFetch: typeof fetch;
  engine: Pick<SearchEngine, "cache" | "routes" | "quota">;
  store: AskStore;
  /** AppServices.persist: the snapshots and ask.json. Tools call it after a call that moved the quota. */
  persist(): Promise<void>;
  lastSearch: Pick<LastSearchStore, "get">;
  /**
   * The trusted results on screen (T15): the workspace's displayed snapshot and the selection made on it. When given,
   * the search and any attached results come from here, the one snapshot every view shows; `lastSearch` is then unused.
   */
  context?: {
    snapshot(): ResultSnapshot | null;
    selected(): readonly ResultRef[];
    /** Hear when either changes, so a page showing what would be sent is redrawn (the workspace's subscribe). */
    subscribe?(listener: () => void): () => void;
    /**
     * T16: the revision of the search on screen (0 when none): a proposal made about another one is stale. Not the
     * workspace's run counter, which moves when a search starts, before its results replace the ones shown.
     */
    revision?(): number;
  };
  /**
   * T16: run a search the person applied from a proposal, through the workspace (a new revision, the normal Search
   * path and its quota). With `context`, questions get the scope gate and may propose; without this, applying is off.
   */
  runQuery?(query: QueryObject): Promise<unknown>;
  /**
   * T17: queue each tool call with the app's other spending entries (RequestCoordinator). A call still waiting when
   * Stop is pressed never starts: it rejects with RequestNotStartedError and is recorded as stopped, with no calls.
   */
  coordinate?<T>(kind: RequestKind, operation: () => Promise<T>, signal?: AbortSignal, onStart?: () => void): Promise<T>;
  /** The watch run under way, or a resolved promise (AppServices.whenWatchesIdle). */
  whenWatchesIdle(): Promise<void>;
  now: () => Date;
  /** Defaults to documentVisibility. */
  visibility?: Visibility;
  /** Defaults to setTimeout and clearTimeout. */
  timers?: Pick<LoopDeps, "setTimer" | "clearTimer">;
  /**
   * Defaults to core's createAskClient. It receives the key and the Anthropic transport and nothing else, so no
   * `baseURL`: only the probe build points a client anywhere but api.anthropic.com (design §10.2).
   */
  createClient?: (opts: Pick<CreateAskClientOptions, "apiKey" | "fetch">) => AskModel;
  /** Defaults to assertNativeHttpAvailable (../native/http.ts). */
  assertNative?: () => void;
  /** Ids for conversations and entries. Defaults to crypto.randomUUID. */
  newId?: () => string;
}

// ---------------------------------------------------------------------------
// What the screen reads
// ---------------------------------------------------------------------------

export type AskActivity =
  /** Native HTTP and the keys are being checked; nothing has been sent. */
  | { kind: "starting" }
  /** A model request is out. `startedAt` is when it was sent, for a wait timer that counts up. */
  | { kind: "request"; request: number; startedAt: string; resend: boolean }
  /** A tool call is under way. `input` is Claude's, not yet checked by the runner. */
  | { kind: "tool"; name: string; input: unknown }
  /** T17: a tool call waits its turn behind another search, watch run or lookup; nothing has been sent for it yet. */
  | { kind: "queued"; name: string; input: unknown }
  /** awardgrid was hidden before a step, which waits until it is visible again. */
  | { kind: "paused" }
  /** Between steps: nothing is out. The question waits to take its next step, for the last step's save to land or a watch run under way to finish. */
  | { kind: "between" };

export interface AskRunning {
  /** The entry being written, once the question has started; null while keys are checked. */
  entryId: string | null;
  activity: AskActivity;
  /** Stop was pressed and the question has not ended yet. */
  stopping: boolean;
}

export type AskNoticeKind =
  | "busy"
  | "no_anthropic_key"
  | "no_seats_key"
  | "wiring"
  | "not_started"
  | "cleared"
  | "keys_changed"
  | "retry_unavailable"
  /** T15: the results a question was to be sent with are not in the snapshot on screen; nothing was sent. */
  | "context_changed"
  /** T15: the search on screen changed after the page said what would be sent; nothing was sent. */
  | "search_changed";

export interface AskNotice {
  kind: AskNoticeKind;
  message: string;
}

export interface AskState {
  /** Every question in the conversation, oldest first; the screen shows them newest first. */
  entries: readonly AskEntry[];
  running: AskRunning | null;
  /** The entry whose failure Try again resends. Only this session holds that request, so a relaunch clears it. */
  retryEntryId: string | null;
  /** What the last action has to say: a refusal before a question started, or the conversation being cleared. */
  notice: AskNotice | null;
  /** The wiring message when this build cannot make a native request; null otherwise. */
  wiring: string | null;
  /** Why the conversation takes no new question (core canAsk), or null. Computed while nothing runs. */
  full: string | null;
  /** The booking links get_flights returned in this conversation: the only links an answer may make tappable. */
  bookingUrls: ReadonlySet<string>;
}

export interface KeyCheckResult {
  outcome: KeyCheckOutcome;
  ok: boolean;
  message: string;
  /** Anthropic's request ID when a failed check's response carried one. */
  requestId: string | null;
}

/**
 * What the next question would send (T15), built by the same function a question uses, so the screen's context line
 * is the payload's: the snapshot, the context built from it (null when the search is not included or there is none),
 * the rows it attaches, why attaching was refused, and how many earlier questions go with it.
 */
export interface ContextPreview {
  snapshot: ResultSnapshot | null;
  context: AIContext | null;
  rows: readonly WorkspaceRow[];
  refused: ContextRefusal | null;
  earlier: number;
  /** How many results are selected on screen, attachable or not: a refused selection is said, never silently dropped. */
  selected: number;
  /** T16: the workspace's current revision, which a proposal's status is read against; null without a workspace. */
  revision: number | null;
}

/** T16: what applying a proposal did. Only "applied" ran a search, once. */
export type ApplyOutcome = "applied" | "stale" | "gone" | "unavailable";

export interface AskService {
  state(): AskState;
  /** What a question asked now with these choices would send (T15). Sends nothing. Optional for stand-ins in tests. */
  preview?(includeSearch: boolean, attachRows: boolean): ContextPreview;
  subscribe(listener: () => void): () => void;
  isRunning(): boolean;
  /**
   * Ask a question in the current conversation, with the search on screen when `includeSearch` and one exists, and the
   * results selected on it when `attachRows` (T15). `shown` is the snapshot the page said would go (null: none); when
   * the one on screen is no longer it, nothing is sent and the page says so.
   */
  ask(text: string, includeSearch: boolean, attachRows?: boolean, shown?: string | null): Promise<AskState>;
  /** Send nothing more for the question under way. A request or tool call already out still finishes. */
  stop(): void;
  /** Resend the last failed request, only when its outcome offers it (canRetry). */
  retry(): Promise<AskState>;
  /** A new question with an ended entry's text and context choice. */
  askAgain(entryId: string): Promise<AskState>;
  /** Forget the conversation and remove ask.json, and nothing else. */
  newConversation(): Promise<AskState>;
  /**
   * T16: apply a pending proposal: consumed before anything is awaited, so a second tap does nothing; refused when the
   * query has changed since it was made (stale). The search runs through the workspace, as any search does.
   */
  applyProposal?(entryId: string, proposalId: string): Promise<ApplyOutcome>;
  /** T16: keep the current conditions: the proposal is set aside, and nothing else changes. */
  dismissProposal?(entryId: string, proposalId: string): void;
  /** Check the Anthropic key on file with a request that carries no question. `draft` is saved first, when given. */
  checkKey(draft?: string): Promise<KeyCheckResult>;
  /** Read ask.json (once) and check native HTTP. A question the app was closed during becomes unfinished. */
  restore(): Promise<AskState>;
  /** Save ask.json, when there is a conversation. AppServices.persist() calls it. */
  persist(): Promise<void>;
  /** Whether the conversation is still not on disk after the last save (T13): the save report says so. */
  saveFailed?(): boolean;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

type FailedOutcome = Extract<AskOutcome, { status: "failed" }>;

interface Keys {
  anthropic: string;
  seatsAero: string;
}

/** The question under way, from the tap until it ends or is refused. */
interface Active {
  /** Stop. It stays the question's across a Try again, because the loop listens to this one signal. */
  controller: AbortController;
  entryId: string | null;
  activity: AskActivity;
}

/** A started question: what its events and a later Try again need. */
interface Question {
  run: Active;
  conversation: Conversation;
  keys: Keys;
  includeSearch: boolean;
  /** What went with it besides the history (T15), recorded on its entry. */
  context: EntryContext;
}

/** What a question sends beside the history: built, or refused before anything is sent. */
type Prepared =
  | {
      ok: true;
      lastSearch: LastSearch | null;
      attached: AttachedRow[];
      coverage?: ResultSnapshot["coverage"]["state"];
      record: EntryContext;
      /** T16: the search the person authorized with this question (the one sent), or null. */
      authorized: QueryObject | null;
    }
  | { ok: false; refused: ContextRefusal };

type FailedQuestion = Question & { outcome: FailedOutcome };

export function createAskService(deps: AskServiceDeps): AskService {
  const visibility = deps.visibility ?? documentVisibility;
  const setTimer = deps.timers?.setTimer ?? ((ms: number, fire: () => void) => setTimeout(fire, ms));
  const clearTimer = deps.timers?.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const createClient = deps.createClient ?? createAskClient;
  const assertNative = deps.assertNative ?? (() => assertNativeHttpAvailable());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  let conversation: Conversation | null = null;
  let loaded = false;
  let loading: Promise<void> | null = null;
  let active: Active | null = null;
  let failed: FailedQuestion | null = null;
  let notice: AskNotice | null = null;
  let wiring: string | null = null;
  let writes: Promise<void> = Promise.resolve();
  let unsaved = false;
  const listeners = new Set<() => void>();
  let snapshot: AskState = build();
  // What would be sent follows the search on screen: its page is redrawn when that changes (T15).
  deps.context?.subscribe?.(() => emit());

  // ---- State ----

  function build(): AskState {
    return {
      entries: conversation === null ? [] : conversation.entries.map(copyEntry),
      running: active === null ? null : { entryId: active.entryId, activity: active.activity, stopping: active.controller.signal.aborted },
      retryEntryId: failed !== null && failed.outcome.canRetry && failed.conversation === conversation ? failed.run.entryId : null,
      notice,
      wiring,
      full: active === null && conversation !== null ? fullMessage(conversation) : null,
      bookingUrls: new Set(conversation?.bookingUrls ?? []),
    };
  }

  function emit(): void {
    snapshot = build();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        // One broken subscriber must not stop the others, or the question.
        console.error("ask listener failed", errorName(err));
      }
    }
  }

  function setNotice(kind: AskNoticeKind, message: string): void {
    notice = { kind, message };
  }

  function refuse(kind: AskNoticeKind, message: string): AskState {
    setNotice(kind, message);
    emit();
    return snapshot;
  }

  // ---- ask.json ----

  /** Queue a write of ask.json. Requests made while one is queued collapse into one write of the latest state. Never rejects. */
  function save(): Promise<void> {
    unsaved = true;
    writes = writes.then(async () => {
      const current = conversation;
      if (!unsaved || current === null) return;
      unsaved = false;
      try {
        await deps.store.write(current);
      } catch (err) {
        // What the question learned is still in memory, and the next save tries again. Logged by name only.
        unsaved = true;
        console.error("ask.json save failed", errorName(err));
      }
    });
    return writes;
  }

  function removeFile(): Promise<void> {
    unsaved = false;
    writes = writes.then(async () => {
      try {
        await deps.store.remove();
      } catch (err) {
        console.error("ask.json remove failed", errorName(err));
      }
    });
    return writes;
  }

  function ensureLoaded(): Promise<void> {
    if (loaded) return Promise.resolve();
    loading ??= (async () => {
      let saved: Conversation | null = null;
      try {
        saved = await deps.store.read();
      } catch {
        // AskStore reads tolerantly; a store that throws is still no conversation.
      }
      // New conversation may have been pressed while the file was read: the file it cleared does not come back.
      if (loaded) return;
      loaded = true;
      conversation = saved;
      if (saved !== null && markUnfinished(saved, deps.now())) await save();
    })();
    return loading;
  }

  function nativeHttpReady(): boolean {
    try {
      assertNative();
      wiring = null;
      return true;
    } catch {
      wiring = WIRING;
      return false;
    }
  }

  // ---- One question ----

  function loopDeps(question: Question): LoopDeps {
    const { run, keys } = question;
    return {
      now: deps.now,
      setTimer,
      clearTimer,
      isHidden: () => visibility.isHidden(),
      onHidden: (listener) =>
        visibility.onChange(() => {
          if (visibility.isHidden()) listener();
        }),
      // The loop awaits this before every request and tool call, through a wait that Stop ends (core loop.ts gate).
      // So this is where a question waits for its saves: every ask.json write queued so far lands before the next
      // step goes out. save() never rejects and the chain holds store writes only, so this can never wait on the loop.
      waitUntilVisible: async () => {
        await writes;
        if (run.controller.signal.aborted) return;
        // Hidden while the writes landed, after the loop had looked: this wait is a pause too, and is recorded as one.
        // An activity already "paused" is the loop's own record of this same wait (every step start resets it).
        if (visibility.isHidden() && run.activity.kind !== "paused") {
          recordPause(question);
          emit();
        }
        await untilVisible(visibility, run.controller.signal);
        // Visible again. A tool step may still wait on a watch run, and "paused" would then tell the screen
        // awardgrid is away while it is on screen, so the activity goes back to "between" until the step starts.
        if (!run.controller.signal.aborted && run.activity.kind === "paused") {
          run.activity = { kind: "between" };
          emit();
        }
      },
      whenWatchesIdle: () => deps.whenWatchesIdle(),
      secrets: [keys.seatsAero, keys.anthropic],
    };
  }

  /**
   * Earlier questions a request resends: the committed history's questions. Each begins with one user turn whose
   * first block is text (buildUserTurn); a tool round adds user turns of tool results, which are not questions.
   */
  function earlierCount(): number {
    if (conversation === null) return 0;
    return conversation.committed.filter((m) => m.role === "user" && (typeof m.content === "string" || m.content[0]?.type === "text")).length;
  }

  /**
   * The context for a question, from the trusted snapshot on screen (T15). `refs` are the results to attach: the
   * selection now, or, for Ask again, the ones that question was sent with. Without the workspace (older wiring and
   * tests), the last search's query alone, as before T15.
   */
  function prepare(includeSearch: boolean, refs: readonly ResultRef[] | null): Prepared {
    const earlier = earlierCount();
    if (!includeSearch) return { ok: true, lastSearch: null, attached: [], record: entryContext(null, earlier), authorized: null };
    if (!deps.context) {
      const lastSearch = lastSearchOf(deps.lastSearch.get());
      return {
        ok: true,
        lastSearch,
        attached: [],
        record: lastSearch === null ? entryContext(null, earlier) : { sent: "query_only", snapshotId: null, revision: null, refs: [], earlier },
        authorized: null,
      };
    }
    const snapshot = deps.context.snapshot();
    if (snapshot === null) {
      if (refs !== null && refs.length > 0) return { ok: false, refused: "context_snapshot_mismatch" };
      return { ok: true, lastSearch: null, attached: [], record: entryContext(null, earlier), authorized: null };
    }
    try {
      const built = buildAIContext(snapshot, refs ?? [], refs !== null && refs.length > 0);
      return {
        ok: true,
        lastSearch: searchOfQuery(built.context.query),
        attached: attachedRows(built.rows, deps.now()),
        coverage: snapshot.coverage.state,
        record: entryContext(built.context, earlier),
        authorized: built.context.query,
      };
    } catch (err) {
      if (err instanceof ContextError) return { ok: false, refused: err.code };
      throw err;
    }
  }

  function preview(includeSearch: boolean, attachRows: boolean): ContextPreview {
    const earlier = earlierCount();
    const snapshot = deps.context?.snapshot() ?? null;
    const selected = deps.context?.selected().length ?? 0;
    const revision = deps.context?.revision?.() ?? null;
    if (!includeSearch || snapshot === null) return { snapshot, context: null, rows: [], refused: null, earlier, selected, revision };
    try {
      const built = buildAIContext(snapshot, attachRows ? (deps.context?.selected() ?? []) : [], attachRows);
      return { snapshot, context: built.context, rows: built.rows, refused: null, earlier, selected, revision };
    } catch (err) {
      if (err instanceof ContextError) return { snapshot, context: null, rows: [], refused: err.code, earlier, selected, revision };
      throw err;
    }
  }

  async function start(run: Active, text: string, includeSearch: boolean, refs: readonly ResultRef[] | null, shown: string | null | undefined): Promise<void> {
    await ensureLoaded();
    if (!nativeHttpReady()) return setNotice("wiring", WIRING);
    // Refusals about the question itself come first: they need no key, and a key message would not be the reason.
    const checked = checkQuestion(text);
    if (!checked.ok) return setNotice("not_started", checked.message);
    const room = canAsk(conversation);
    if (!room.ok) return setNotice("not_started", room.message);

    const anthropic = await readKey(deps.anthropicKeys);
    if (anthropic === null) return setNotice("no_anthropic_key", NO_ANTHROPIC_KEY);
    const seatsAero = await readKey(deps.seatsKeys);
    if (seatsAero === null) return setNotice("no_seats_key", NO_SEATS_KEY);
    // Stop pressed while the keys were read: nothing has been sent, and nothing will be.
    if (run.controller.signal.aborted) return;

    const keys: Keys = { anthropic, seatsAero };
    let model: AskModel;
    try {
      model = createClient({ apiKey: anthropic, fetch: deps.anthropicFetch });
    } catch (err) {
      // createAskClient refuses a missing key or a transport that is not the native adapter. Neither sent anything.
      const failure = describeAskError(err, { elapsedMs: 0, hidden: false, secrets: [seatsAero, anthropic] });
      if (failure.code === "anthropic_key_missing") return setNotice("no_anthropic_key", NO_ANTHROPIC_KEY);
      wiring = WIRING;
      return setNotice("wiring", WIRING);
    }

    // The page said what would go; if the search on screen has changed since, nothing goes (T15).
    if (includeSearch && shown !== undefined && deps.context && (deps.context.snapshot()?.id ?? null) !== shown) return setNotice("search_changed", SEARCH_CHANGED);
    // Built from the snapshot on screen at the moment of asking; a reference it does not hold sends nothing.
    const prepared = prepare(includeSearch, refs);
    if (!prepared.ok) return setNotice("context_changed", CONTEXT_CHANGED);
    const { lastSearch, attached, coverage, record, authorized } = prepared;
    const conv = conversation ?? startConversation({ id: newId(), now: deps.now });
    const question: Question = { run, conversation: conv, keys, includeSearch: lastSearch !== null, context: record };
    const port = createSeatsPort({ fetchImpl: deps.seatsFetch, engine: deps.engine, keys, persist: () => deps.persist(), now: deps.now });
    // T16: with the workspace, searches stay inside what the person included, and anything else is only proposed.
    const baseRevision = deps.context?.revision?.() ?? 0;
    const gate: ScopeGate | undefined = deps.context
      ? {
          authorized,
          propose: (query, reason) => {
            const entry = entryOf(question);
            if (entry === undefined) return { ok: false, message: "This proposal could not be recorded." };
            const proposal: EntryProposal = { id: newId(), baseRevision, proposed: query, reason, status: "pending", base: authorized };
            entry.proposals = [...(entry.proposals ?? []), proposal];
            void save();
            emit();
            return { ok: true, id: proposal.id };
          },
        }
      : undefined;
    const runner = createToolRunner(port, conv, gate);
    // T17: each tool call waits its turn behind a search, a watch run or a lookup; the question itself is not queued
    // (it waits for watch runs, and a queued question would wait for itself).
    const tools: ToolRunner = deps.coordinate
      ? {
          run: (block) =>
            deps.coordinate!("ask", () => runner.run(block), run.controller.signal, () => {
              // Its turn came: only now is it said to be running.
              if (run.activity.kind === "queued") {
                run.activity = { kind: "tool", name: run.activity.name, input: run.activity.input };
                emit();
              }
            }).catch((err: unknown) => {
              if (err instanceof RequestNotStartedError) return notStartedRun(block);
              throw err;
            }),
          usage: () => runner.usage(),
        }
      : runner;
    const outcome = await runQuestion({
      model,
      tools,
      proposals: gate !== undefined,
      conversation: conv,
      question: text,
      lastSearch,
      attached,
      coverage,
      deps: loopDeps(question),
      onEvent: (event) => onEvent(question, event),
      signal: run.controller.signal,
    });
    settle(question, outcome);
  }

  /**
   * The loop's events, applied to the entry as they happen, so the screen and ask.json follow the question step by
   * step. The entry is created on question_started, not before: canAsk counts entries, and the loop checks it first.
   */
  function onEvent(question: Question, event: AskEvent): void {
    const { run, conversation: conv } = question;
    if (event.type === "question_started") {
      const entry: AskEntry = {
        id: newId(),
        question: event.question,
        includeSearch: question.includeSearch,
        context: question.context,
        askedAt: event.at,
        steps: [],
        texts: [],
        usage: emptyUsage(),
        end: null,
      };
      conv.entries.push(entry);
      conv.pending = { entryId: entry.id, startedAt: event.at };
      conversation = conv;
      // The conversation has moved on, so an earlier failure's request is no longer resent.
      failed = null;
      run.entryId = entry.id;
      run.activity = { kind: "between" };
      void save();
      emit();
      return;
    }
    const entry = entryOf(question);
    if (entry === undefined) return;
    switch (event.type) {
      case "paused":
        recordPause(question);
        break;
      case "request_started":
        entry.usage.requests += 1;
        run.activity = { kind: "request", request: event.request, startedAt: deps.now().toISOString(), resend: event.resend };
        // A request that may be billed is counted on disk too. The loop emits this as it sends, after the gate that
        // waits for saves, so the request can go out before this write lands: a count read back from an unfinished
        // entry is a lower bound, and labels.ts entryMetaLine words it as one.
        void save();
        break;
      case "request_finished":
        entry.usage.inputTokens += event.usage.inputTokens;
        entry.usage.cacheReadTokens += event.usage.cacheReadTokens;
        entry.usage.outputTokens += event.usage.outputTokens;
        entry.usage.lastRequestInputTokens = event.usage.inputTokens;
        entry.texts.push(...event.texts);
        run.activity = { kind: "between" };
        // A request that may be billed: what it returned is on disk before the tool call it asked for runs.
        void save();
        break;
      case "tool_started":
        // With the request queue, a tool call first waits its turn: said as waiting until it starts (T17).
        run.activity = deps.coordinate ? { kind: "queued", name: event.name, input: event.input } : { kind: "tool", name: event.name, input: event.input };
        break;
      case "tool_finished":
        entry.steps.push({ kind: "tool", step: event.step });
        entry.usage.toolCalls += 1;
        entry.usage.seatsCalls += event.step.calls;
        run.activity = { kind: "between" };
        // After every tool call: the ids, links and flights it added belong to the conversation on disk too.
        void save();
        break;
      case "ended":
        end(question, event.outcome);
        break;
    }
    emit();
  }

  /** Record how the question ended, clear its `pending` marker, and save. */
  function end(question: Question, outcome: AskOutcome): void {
    if (outcome.status === "not_started") return;
    const entry = entryOf(question);
    if (entry === undefined) return;
    entry.usage = { ...outcome.usage };
    entry.texts = [...outcome.texts];
    entry.end = {
      status: outcome.status,
      committed: outcome.committed,
      failure: outcome.status === "failed" ? outcome.failure : null,
      stoppedDuring: outcome.status === "stopped" ? outcome.during : null,
      at: deps.now().toISOString(),
    };
    if (question.conversation.pending?.entryId === entry.id) question.conversation.pending = null;
    failed = outcome.status === "failed" ? { ...question, outcome } : null;
    void save();
  }

  function settle(question: Question, outcome: AskOutcome): void {
    if (outcome.status === "not_started") return setNotice("not_started", outcome.message);
    // runQuestion emits `ended` before it resolves; an outcome that arrives without one is still recorded.
    if (entryOf(question)?.end === null) end(question, outcome);
  }

  function entryOf(question: Question): AskEntry | undefined {
    return question.conversation.entries.find((entry) => entry.id === question.run.entryId);
  }

  /** A wait for awardgrid to be visible before a step: a step of the entry's own, and what the screen shows meanwhile. */
  function recordPause(question: Question): void {
    const entry = entryOf(question);
    if (entry === undefined || entry.end !== null) return;
    entry.steps.push({ kind: "paused" });
    question.run.activity = { kind: "paused" };
  }

  /**
   * Try again found a key missing, so nothing was sent and the failure can still be resent once that same key is
   * back. Not after Stop: it aborted the one signal the question's loop listens to, so a resend would end at once.
   */
  function keepRetry(question: FailedQuestion, kind: AskNoticeKind, message: string): void {
    if (!question.run.controller.signal.aborted) failed = question;
    setNotice(kind, message);
  }

  async function resend(question: FailedQuestion, entry: AskEntry): Promise<void> {
    const anthropic = await readKey(deps.anthropicKeys);
    if (anthropic === null) return keepRetry(question, "no_anthropic_key", NO_ANTHROPIC_KEY);
    const seatsAero = await readKey(deps.seatsKeys);
    if (seatsAero === null) return keepRetry(question, "no_seats_key", NO_SEATS_KEY);
    // The failed request's client holds the key it was built with. A key changed since is never resent on.
    if (anthropic !== question.keys.anthropic || seatsAero !== question.keys.seatsAero) return setNotice("keys_changed", KEYS_CHANGED);
    // Stop pressed while the keys were read: nothing is resent, and the entry keeps its failure.
    if (question.run.controller.signal.aborted) return;

    const failedEnd = entry.end;
    entry.end = null;
    question.conversation.pending = { entryId: entry.id, startedAt: entry.askedAt };
    void save();
    emit();
    let outcome: AskOutcome;
    try {
      outcome = await question.outcome.retryLastRequest();
    } catch {
      // The loop refused to resend (the conversation moved on, or this failure was already resent). Nothing went out.
      entry.end = failedEnd;
      question.conversation.pending = null;
      void save();
      return setNotice("retry_unavailable", RETRY_UNAVAILABLE);
    }
    settle(question, outcome);
  }

  // ---- The API ----

  async function ask(text: string, includeSearch: boolean, attachRows = false, again: readonly ResultRef[] | null = null, shown?: string | null): Promise<AskState> {
    if (active !== null) return refuse("busy", BUSY);
    // The selection is read now, with the snapshot, so what is attached is what was on screen when Ask was pressed.
    const refs = again ?? (includeSearch && attachRows ? [...(deps.context?.selected() ?? [])] : null);
    const run: Active = { controller: new AbortController(), entryId: null, activity: { kind: "starting" } };
    active = run;
    notice = null;
    emit();
    try {
      await start(run, text, includeSearch, refs, shown);
    } finally {
      if (active === run) active = null;
      clearBusy();
      emit();
    }
    // Resolve once the question's last state is on disk, not merely queued.
    await writes;
    return snapshot;
  }

  /** "A question is already running" answered a tap during this question; once it has ended, it is no longer true. */
  function clearBusy(): void {
    if (notice?.kind === "busy") notice = null;
  }

  async function retry(): Promise<AskState> {
    if (active !== null) return refuse("busy", BUSY);
    const question = failed;
    const entry = question === null ? undefined : entryOf(question);
    if (question === null || entry === undefined || !question.outcome.canRetry || question.conversation !== conversation) {
      emit();
      return snapshot;
    }
    // Taken before any await, so a second tap cannot resend the same request twice.
    failed = null;
    active = question.run;
    question.run.activity = { kind: "starting" };
    notice = null;
    emit();
    try {
      await resend(question, entry);
    } finally {
      if (active === question.run) active = null;
      clearBusy();
      emit();
    }
    await writes;
    return snapshot;
  }

  async function askAgain(entryId: string): Promise<AskState> {
    if (active !== null) return refuse("busy", BUSY);
    await ensureLoaded();
    const entry = conversation?.entries.find((e) => e.id === entryId);
    if (entry === undefined || entry.end === null) {
      emit();
      return snapshot;
    }
    // The same choice, and the same results: the ones it was sent with, which must still be on screen (T15).
    const sentWith = readEntryContext(entry.context);
    const refs = sentWith?.sent === "query_and_selected_rows" ? sentWith.refs : null;
    return ask(entry.question, entry.includeSearch, refs !== null, refs);
  }

  /**
   * A proposal on an entry of this conversation: the validated copy (what the card shows, and what runs) and the
   * stored record (whose status is saved). None when the id is missing, unreadable, or not unique: ask.json may come
   * from elsewhere, and a hidden record must never run in place of the one on screen.
   */
  function findProposal(entryId: string, proposalId: string): { valid: EntryProposal; stored: EntryProposal } | undefined {
    const entry = conversation?.entries.find((e) => e.id === entryId);
    const stored = (Array.isArray(entry?.proposals) ? entry.proposals : []).filter((p) => p && typeof p === "object" && p.id === proposalId);
    const valid = readEntryProposals(entry?.proposals).filter((p) => p.id === proposalId);
    if (stored.length !== 1 || valid.length !== 1) return undefined;
    return { valid: valid[0]!, stored: stored[0]! };
  }

  async function applyProposal(entryId: string, proposalId: string): Promise<ApplyOutcome> {
    const found = findProposal(entryId, proposalId);
    if (found === undefined || found.stored.status !== "pending" || found.valid.status !== "pending") return "gone";
    if (!deps.runQuery || !deps.context?.revision) return "unavailable";
    if (proposalStatus(found.valid, deps.context.revision()) === "stale") {
      emit();
      return "stale";
    }
    // Consumed before anything is awaited: a second tap finds it applied and sends nothing.
    found.stored.status = "applied";
    void save();
    emit();
    // What runs is the validated query the card showed.
    await deps.runQuery(found.valid.proposed);
    return "applied";
  }

  function dismissProposal(entryId: string, proposalId: string): void {
    const found = findProposal(entryId, proposalId);
    if (found === undefined || found.stored.status !== "pending") return;
    found.stored.status = "dismissed";
    void save();
    emit();
  }

  async function newConversation(): Promise<AskState> {
    if (active !== null) return refuse("busy", BUSY);
    // A read of ask.json still under way must not bring back the conversation being cleared.
    loaded = true;
    conversation = null;
    failed = null;
    setNotice("cleared", CLEARED);
    const removal = removeFile();
    emit();
    await removal;
    return snapshot;
  }

  async function checkKey(draft?: string): Promise<KeyCheckResult> {
    const result = (outcome: KeyCheckOutcome, message: string, requestId: string | null = null): KeyCheckResult => ({
      outcome,
      ok: outcome === "accepted",
      message,
      requestId,
    });
    // Save first, so a key pasted while offline is kept; the check follows (design §7).
    if (draft !== undefined) {
      try {
        await deps.anthropicKeys.set(draft);
      } catch (err) {
        return result("keychain", keySaveFailedLabel(scrubSecrets(errorText(err), [draft, draft.trim()])));
      }
    }
    if (!nativeHttpReady()) {
      emit();
      return result("wiring", WIRING);
    }
    let key: string | null;
    try {
      key = await deps.anthropicKeys.get();
    } catch (err) {
      // The store's own words, masked of every key this check knows, as a failed save's are.
      return result("keychain", keyReadFailedLabel(scrubSecrets(errorText(err), [draft, draft?.trim(), await readKey(deps.seatsKeys)])));
    }
    if (!key) return result("no_key", NO_KEY_ON_FILE);
    const secrets = [await readKey(deps.seatsKeys), key];
    const startedAt = deps.now().getTime();
    try {
      await createClient({ apiKey: key, fetch: deps.anthropicFetch }).checkKey(ASK_MODEL);
      return result("accepted", KEY_ACCEPTED);
    } catch (err) {
      const failure = describeAskError(err, { elapsedMs: deps.now().getTime() - startedAt, hidden: visibility.isHidden(), secrets });
      const mapped = keyCheckFromFailure(failure);
      return result(mapped.outcome, mapped.message, failure.requestId);
    }
  }

  async function restore(): Promise<AskState> {
    nativeHttpReady();
    await ensureLoaded();
    emit();
    return snapshot;
  }

  async function persist(): Promise<void> {
    // Nothing read yet means nothing changed here, and the file on disk must not be overwritten.
    if (!loaded || conversation === null) return writes;
    return save();
  }

  return {
    saveFailed: () => unsaved,
    state: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isRunning: () => active !== null,
    preview,
    ask: (text, includeSearch, attachRows, shown) => ask(text, includeSearch, attachRows, null, shown),
    stop() {
      if (active === null || active.controller.signal.aborted) return;
      active.controller.abort();
      emit();
    },
    retry,
    askAgain,
    newConversation,
    applyProposal,
    dismissProposal,
    checkKey,
    restore,
    persist,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** T17: a tool call Stop ended while it waited its turn: never started, nothing sent, said to Claude as such. */
function notStartedRun(block: { id: string; name: string }): ToolRun {
  return {
    result: {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify({ error: "stopped", message: "The person pressed Stop before this call started; nothing was sent." }),
      is_error: true,
    },
    step: { tool: String(block.name), outcome: "stopped", calls: 0, fromCache: false, fromMemo: false, search: null, program: null, estimate: null },
  };
}

/** Entries a closed app left running become unfinished, and the marker is cleared. Returns whether anything changed. */
function markUnfinished(conversation: Conversation, now: Date): boolean {
  let changed = conversation.pending !== null;
  for (const entry of conversation.entries) {
    if (entry.end !== null) continue;
    // Not committed: the history on disk is only ever written with a question's end, which this one never reached.
    entry.end = { status: "unfinished", committed: false, failure: null, stoppedDuring: null, at: now.toISOString() };
    changed = true;
  }
  conversation.pending = null;
  return changed;
}

/** Resolves once awardgrid is visible, at once when it already is, and at Stop. Either way it stops listening. */
function untilVisible(visibility: Visibility, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!visibility.isHidden() || signal.aborted) return resolve();
    let off = () => {};
    const done = () => {
      off();
      signal.removeEventListener("abort", done);
      resolve();
    };
    off = visibility.onChange(() => {
      if (!visibility.isHidden()) done();
    });
    signal.addEventListener("abort", done);
  });
}

/** A key on file, or null. A store that throws has no key to give. */
async function readKey(store: KeyStore): Promise<string | null> {
  try {
    const key = await store.get();
    return typeof key === "string" && key.trim().length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** The part of the last grid search Claude is told about (core prompt.ts LastSearch). */
function lastSearchOf(entry: LastSearchEntry | null): LastSearch | null {
  if (entry === null) return null;
  const query = entry.value.query;
  return {
    origins: query.origins,
    destinations: query.destinations,
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: query.cabins,
    programs: query.programs ?? null,
    direct_only: query.direct_only,
  };
}

function fullMessage(conversation: Conversation): string | null {
  const room = canAsk(conversation);
  return room.ok ? null : room.message;
}

function emptyUsage(): QuestionUsage {
  return { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, lastRequestInputTokens: null, toolCalls: 0, seatsCalls: 0 };
}

/** A copy the screen can hold: the service keeps changing its own entries while a question runs. */
function copyEntry(entry: AskEntry): AskEntry {
  return {
    ...entry,
    steps: [...entry.steps],
    texts: [...entry.texts],
    usage: { ...entry.usage },
    end: entry.end === null ? null : { ...entry.end },
    ...(Array.isArray(entry.proposals) ? { proposals: entry.proposals.map((p) => ({ ...p })) } : {}),
  };
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function errorText(err: unknown): string {
  try {
    return err instanceof Error ? err.message || err.name : String(err);
  } catch {
    return "the error could not be read as text";
  }
}
