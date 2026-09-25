/**
 * One question in the conversation, as the person reads it (design §6.3, §6.4).
 *
 * Top to bottom: the question; the steps that finished, in order; what is under way now, while this is the
 * question running; Claude's answer texts; "Data: seats.aero" whenever the answer may rest on seats.aero data, its own
 * or an earlier committed question's that its requests resent; the meta line once the question has ended, worded as
 * lower bounds for a question awardgrid was closed during; how it ended; the actions that fit that ending; and the
 * follow-up note when an answer offers what awardgrid cannot do.
 *
 * Every sentence comes from ../ask/labels.ts. This component decides only which ones apply:
 *
 *   - A failure's line carries Anthropic's request ID when its response had one. It is role="alert" when the
 *     failure is news (`announce`): the Ask screen turns that off for a failure it opened on, so returning to the
 *     screen does not read every earlier failure out again (design §6.5, transitions only).
 *   - Try again is offered only on the entry the service can still resend (AskState.retryEntryId): only this
 *     session holds that request, so a failure read back from ask.json never offers it.
 *   - Ask again is offered on every entry that ended without a whole answer. It asks the same question anew.
 *   - A failure whose sentence points at Settings or at a new conversation gets that way on beside Ask again.
 */
import { Link } from "react-router";
import type { AskEntry as Entry } from "@awardgrid/core/ask/conversation";
import { resultName } from "@awardgrid/core/workspace/present";
import type { ResultRef, WorkspaceRow } from "@awardgrid/core/workspace/types";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { Locale } from "../app/locale";
import { ASK_COPY } from "../ask/ask-copy";
import type { AskActivity } from "../ask/ask-service";
import { readEntryContext, readEntryProposals } from "../ask/context";
import { proposalStatus } from "@awardgrid/core/workspace/proposals";
import { QueryChangeProposal } from "./QueryChangeProposal";
import { failureView, showsAttribution, showsFollowUpNote } from "../ask/labels";
import { ENTRY_LABELS, type EntryLabels } from "../ask/entry-labels";
import { AnswerText } from "./AnswerText";

export interface AskEntryProps {
  entry: Entry;
  /**
   * The conversation's entries before this one, oldest first. The committed ones are the history this entry's requests
   * resent, so seats.aero data one of them carried is data this answer may rest on (labels.ts showsAttribution).
   */
  earlier: readonly Entry[];
  /** The conversation's booking links: the only links an answer may make tappable. */
  bookingUrls: ReadonlySet<string>;
  /** AskState.retryEntryId: the one entry whose failed request can be resent. */
  retryEntryId: string | null;
  /** What the question is doing now, when this entry is the question running; null otherwise. */
  activity?: AskActivity | null;
  /** Seconds since the model request under way went out. */
  waitSeconds?: number;
  /** Try again and New conversation are off while a question runs. */
  busy?: boolean;
  /** Ask again is off whenever a new question cannot start: a question runs, a key is missing, or the conversation is full. */
  askAgainDisabled?: boolean;
  /** Whether a failure line is role="alert". Off for a failure that was already there when the screen opened. */
  announce?: boolean;
  onTryAgain?: () => void;
  onAskAgain?: (entryId: string) => void;
  onNewConversation?: () => void;
  /** The page's language (T15). A question's steps, endings, failures and meta line stay English until T17, marked so. */
  locale?: Locale;
  /** The trusted row a reference names, from the workspace (T15); null when it is no longer there. */
  resolveRow?: (ref: ResultRef) => WorkspaceRow | null;
  /** T16: the revision of the search on screen, which each proposal's status is read against. */
  revision?: number | null;
  /** T16: the search on screen, which a proposal made with no search is compared with, locally. */
  shownQuery?: QueryObject | null;
  onApplyProposal?: (entryId: string, proposalId: string) => void;
  onKeepProposal?: (entryId: string, proposalId: string) => void;
}

export function AskEntry({
  entry,
  earlier,
  bookingUrls,
  retryEntryId,
  activity = null,
  waitSeconds = 0,
  busy = false,
  askAgainDisabled = false,
  announce = true,
  onTryAgain,
  onAskAgain,
  onNewConversation,
  locale = "en",
  resolveRow,
  revision = null,
  shownQuery = null,
  onApplyProposal,
  onKeepProposal,
}: AskEntryProps) {
  const c = ASK_COPY[locale];
  // A question's lines in the page's language (T17); only core's own words stay English, marked.
  const L = ENTRY_LABELS[locale];
  const english = locale === "en" ? undefined : "en";
  // What went with this question, as recorded from its payload; nothing is said for entries from before T15.
  const sentWith = readEntryContext(entry.context);
  // Changes Claude proposed (T16), read as this version can; each waits for the person.
  const proposals = readEntryProposals(entry.proposals);
  const end = entry.end;
  const failure = end?.status === "failed" && end.failure ? failureView(end.failure, entry.id === retryEntryId) : null;
  // A failed entry's sentence is its failure line; every other ending has its own line, and an answer has none.
  const ending = failure === null ? L.endLabel(entry) : null;
  // The failure in the page's language; core's own words follow it, marked English, when they are not the sentence.
  const failureText = end?.status === "failed" && end.failure ? L.failure(end.failure) : null;
  const lastStep = entry.steps[entry.steps.length - 1];

  const askAgain = (
    <button type="button" className="ag-button" disabled={askAgainDisabled} onClick={() => onAskAgain?.(entry.id)}>
      {c.askAgain}
    </button>
  );

  return (
    <li className="ag-surface ask-entry">
      <h2 className="ask-question">{entry.question}</h2>

      {sentWith ? (
        <div className="ask-sent">
          <p>{sentWith.sent === "none" ? c.sentNothing : sentWith.sent === "query_only" ? c.sentSearch : c.sentSearchAndRows(sentWith.refs.length)}</p>
          {sentWith.refs.length > 0 ? (
            <ol className="ask-sent-rows">
              {sentWith.refs.map((ref, i) => {
                // The card as awardgrid has it, never the model's numbers; a link the details page resolves again.
                const row = resolveRow?.(ref) ?? null;
                const id = `ask-ref-${entry.id}-${i}`;
                return (
                  <li key={`${ref.snapshotId}/${ref.rowKey}`}>
                    {row ? (
                      // The whole row is the link, a full-size target, named with its reference.
                      <Link id={id} className="ask-ref-link" to={`/detail/${encodeURIComponent(ref.snapshotId)}/${encodeURIComponent(ref.rowKey)}`} state={{ returnFocus: id, from: "ask" }}>
                        <span className="ask-ref">R{i + 1}</span>
                        <span>{resultName(row.value, locale)}</span>
                      </Link>
                    ) : (
                      <span className="ask-ref-gone">
                        <span className="ask-ref">R{i + 1}</span>
                        <span>{c.rowGone}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {sentWith.earlier > 0 ? <p>{c.sentEarlier(sentWith.earlier)}</p> : null}
        </div>
      ) : null}

      {entry.steps.length > 0 ? (
        <ol className="ask-steps">
          {entry.steps.map((step, i) => (
            <li key={i}>{L.stepLabel(step, { searchIncluded: sentWith ? sentWith.sent !== "none" : entry.includeSearch })}</li>
          ))}
        </ol>
      ) : null}

      {activity !== null ? (
        <ActivityLine activity={activity} waitSeconds={waitSeconds} pausedStepShown={lastStep?.kind === "paused"} labels={L} />
      ) : null}

      {entry.texts.map((text, i) => (
        <AnswerText key={i} text={text} bookingUrls={bookingUrls} />
      ))}

      {proposals.map((p) => (
        <QueryChangeProposal
          key={p.id}
          proposal={p}
          shown={p.base === null && revision === p.baseRevision ? shownQuery : null}
          status={revision === null ? p.status : proposalStatus(p, revision)}
          locale={locale}
          onApply={() => onApplyProposal?.(entry.id, p.id)}
          onKeep={() => onKeepProposal?.(entry.id, p.id)}
        />
      ))}

      {showsAttribution(entry, earlier) || (sentWith !== null && sentWith.refs.length > 0) ? <p className="ask-attribution">{c.attribution}</p> : null}

      {end !== null ? (
        <p className="ask-meta tabular">
          {L.entryMetaLine(entry)}
        </p>
      ) : null}

      {ending !== null ? (
        <p className="ask-ending">
          {ending}
        </p>
      ) : null}

      {failure !== null ? (
        <>
          <div role={announce ? "alert" : undefined} className="ask-failure">
            <p>{failureText?.text ?? failure.message}</p>
            {failureText?.detail ? <p lang={english}>{failureText.detail}</p> : null}
            {end?.failure?.requestId ? <p className="tabular">{L.requestIdLine(end.failure.requestId)}</p> : null}
          </div>
          <div className="ask-actions">
            {failure.action === "try_again" ? (
              <button type="button" className="ag-button ag-button-primary" disabled={busy} onClick={() => onTryAgain?.()}>
                {c.tryAgain}
              </button>
            ) : null}
            {askAgain}
            {failure.goTo === "settings" ? (
              <Link to="/settings" className="ag-button">
                {c.openSettings}
              </Link>
            ) : null}
            {failure.goTo === "new_conversation" ? (
              <button type="button" className="ag-button" disabled={busy} onClick={() => onNewConversation?.()}>
                {c.newConversation}
              </button>
            ) : null}
          </div>
          {failure.hint !== null ? (
            <p className="ask-hint">
              {L.tryAgainHint}
            </p>
          ) : null}
        </>
      ) : null}

      {failure === null && end !== null && end.status !== "answered" ? <div className="ask-actions">{askAgain}</div> : null}

      {showsFollowUpNote(entry) ? (
        <p className="ask-note">
          {L.followUpNote}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What the running question is doing. The wait counts up and is hidden from VoiceOver, which reads the same words
 * without the number; the status region announces the transition itself (design §6.5). A pause is already the
 * entry's last step when the service records it, so it is not written a second time.
 */
function ActivityLine({ activity, waitSeconds, pausedStepShown, labels }: { activity: AskActivity; waitSeconds: number; pausedStepShown: boolean; labels: EntryLabels }) {
  switch (activity.kind) {
    case "request":
      return (
        <p className="ask-activity tabular">
          <span className="sr-only">{labels.announcements.waiting}</span>
          <span aria-hidden="true">{labels.waitingLabel(waitSeconds)}</span>
        </p>
      );
    case "tool":
      return <p className="ask-activity">{labels.toolRunningLabel(activity.name, activity.input)}</p>;
    case "paused":
      return pausedStepShown ? null : <p className="ask-activity">{labels.pausedStep}</p>;
    case "queued":
      return <p className="ask-activity">{labels.queuedStep}</p>;
    default:
      return null;
  }
}
