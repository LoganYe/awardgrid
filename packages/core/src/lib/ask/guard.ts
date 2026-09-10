/**
 * Whether an answer promises to follow up, which awardgrid cannot do.
 *
 * The system prompt tells Claude that awardgrid does nothing further with a question once it is answered
 * (prompt.ts), but a prompt is a request, not a guarantee. When an answer still offers to keep watching, to
 * notify, or to look again later, the entry shows a fixed note under it saying what the app can and cannot do
 * (design §6.4, "Follow-up promise matched"). The answer text itself is never changed: the person reads what
 * Claude wrote, and the note sits beside it.
 *
 * The patterns follow apps/ios/src/honesty.test.ts, which enforces the same rule on the app's own copy, with
 * forms a model reaches for that app copy does not ("Want me to check again tomorrow?"). A false match costs
 * one extra note; a missed one leaves a promise the app cannot keep, so the list errs toward matching.
 *
 * One widening beyond the design's list (§8.2): contractions accept the typographic apostrophe (U+2019) as well
 * as the ASCII one. This runs over model output, not source code, and "I’ll" is the same promise as "I'll".
 */

const FOLLOW_UP_PATTERNS: readonly RegExp[] = [
  // "I'll keep an eye on this route", "I can notify you", "We will let you know", "awardgrid will check back".
  /\b(?:I|we|awardgrid|the app)(?:['’]ll|\s+will|\s+can|\s+could)\s+(?:keep\s+(?:an\s+eye|watching|checking|monitoring|tracking)|monitor|track|notify|alert|remind|let\s+you\s+know|check\s+(?:again|back))\b/i,
  // "Want me to check again tomorrow?"
  /\b(?:want|shall|should)\s+me\s+to\s+(?:check|look|search|monitor|watch)\s+(?:again|back|later|tomorrow)\b/i,
  // "notify you when seats open", but not "awardgrid cannot notify you when a seat opens".
  /(?<!\b(?:not|never|cannot|can't|can’t|won't|won’t)\s)\b(?:notify|alert|message|email|remind)\s+you\s+(?:when|if|as\s+soon\s+as|once)\b/i,
  /\bset\s+up\s+(?:an?\s+)?(?:alert|notification|reminder)\b/i,
  /\bin\s+the\s+background\b/i,
  // 我会持续关注 / 我们将监控 / 我会通知你
  /(?:我|我们)(?:会|将)(?:持续|继续|一直)?(?:关注|监控|通知你|提醒你)/,
  // 通知你 / 提醒您, but not 无法通知你 or 不能提醒您
  /(?<!不|无法|不能)(?:通知|提醒)(?:你|您)/,
  // 持续关注 / 帮你检查
  /(?:持续|继续|帮你)(?:关注|监控|检查)/,
];

/** True when `text` offers a follow-up awardgrid cannot deliver: watching, notifying, or looking again later. */
export function promisesFollowUp(text: string): boolean {
  return FOLLOW_UP_PATTERNS.some((re) => re.test(text));
}
