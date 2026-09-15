/**
 * One question in the conversation, as the person reads it (design §6.3, §6.4).
 *
 * Top to bottom: the question; the steps that finished, in order; what is under way now, while this is the
 * question running; Claude's answer texts; "Data: seats.aero" whenever the answer may rest on seats.aero data; the
 * meta line once the question has ended; how it ended; the actions that fit that ending; and the follow-up note
 * when an answer offers what awardgrid cannot do.
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
import type { AskActivity } from "../ask/ask-service";
import {
  ANNOUNCEMENTS,
  ASK_AGAIN,
  ATTRIBUTION,
  FOLLOW_UP_NOTE,
  NEW_CONVERSATION,
  OPEN_SETTINGS,
  PAUSED_STEP,
  TRY_AGAIN,
  endLabel,
  failureView,
  metaLine,
  showsAttribution,
  showsFollowUpNote,
  stepLabel,
  toolRunningLabel,
  waitingLabel,
} from "../ask/labels";
import { AnswerText } from "./AnswerText";

export interface AskEntryProps {
  entry: Entry;
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
}

export function AskEntry({
  entry,
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
}: AskEntryProps) {
  const end = entry.end;
  const failure = end?.status === "failed" && end.failure ? failureView(end.failure, entry.id === retryEntryId) : null;
  // A failed entry's sentence is its failure line; every other ending has its own line, and an answer has none.
  const ending = failure === null ? endLabel(entry) : null;
  const lastStep = entry.steps[entry.steps.length - 1];

  const askAgain = (
    <button type="button" className="ag-button" disabled={askAgainDisabled} onClick={() => onAskAgain?.(entry.id)}>
      {ASK_AGAIN}
    </button>
  );

  return (
    <li className="ag-surface ask-entry">
      <h2 className="ask-question">{entry.question}</h2>

      {entry.steps.length > 0 ? (
        <ol className="ask-steps">
          {entry.steps.map((step, i) => (
            <li key={i}>{stepLabel(step)}</li>
          ))}
        </ol>
      ) : null}

      {activity !== null ? <ActivityLine activity={activity} waitSeconds={waitSeconds} pausedStepShown={lastStep?.kind === "paused"} /> : null}

      {entry.texts.map((text, i) => (
        <AnswerText key={i} text={text} bookingUrls={bookingUrls} />
      ))}

      {showsAttribution(entry) ? <p className="ask-attribution">{ATTRIBUTION}</p> : null}

      {end !== null ? <p className="ask-meta tabular">{metaLine(entry.usage)}</p> : null}

      {ending !== null ? <p className="ask-ending">{ending}</p> : null}

      {failure !== null ? (
        <>
          <div role={announce ? "alert" : undefined} className="ask-failure">
            <p>{failure.message}</p>
            {failure.requestIdLine !== null ? <p className="tabular">{failure.requestIdLine}</p> : null}
          </div>
          <div className="ask-actions">
            {failure.action === "try_again" ? (
              <button type="button" className="ag-button ag-button-primary" disabled={busy} onClick={() => onTryAgain?.()}>
                {TRY_AGAIN}
              </button>
            ) : null}
            {askAgain}
            {failure.goTo === "settings" ? (
              <Link to="/settings" className="ag-button">
                {OPEN_SETTINGS}
              </Link>
            ) : null}
            {failure.goTo === "new_conversation" ? (
              <button type="button" className="ag-button" disabled={busy} onClick={() => onNewConversation?.()}>
                {NEW_CONVERSATION}
              </button>
            ) : null}
          </div>
          {failure.hint !== null ? <p className="ask-hint">{failure.hint}</p> : null}
        </>
      ) : null}

      {failure === null && end !== null && end.status !== "answered" ? <div className="ask-actions">{askAgain}</div> : null}

      {showsFollowUpNote(entry) ? <p className="ask-note">{FOLLOW_UP_NOTE}</p> : null}
    </li>
  );
}

/**
 * What the running question is doing. The wait counts up and is hidden from VoiceOver, which reads the same words
 * without the number; the status region announces the transition itself (design §6.5). A pause is already the
 * entry's last step when the service records it, so it is not written a second time.
 */
function ActivityLine({ activity, waitSeconds, pausedStepShown }: { activity: AskActivity; waitSeconds: number; pausedStepShown: boolean }) {
  switch (activity.kind) {
    case "request":
      return (
        <p className="ask-activity tabular">
          <span className="sr-only">{ANNOUNCEMENTS.waiting}</span>
          <span aria-hidden="true">{waitingLabel(waitSeconds)}</span>
        </p>
      );
    case "tool":
      return <p className="ask-activity">{toolRunningLabel(activity.name, activity.input)}</p>;
    case "paused":
      return pausedStepShown ? null : <p className="ask-activity">{PAUSED_STEP}</p>;
    default:
      return null;
  }
}
