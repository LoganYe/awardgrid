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
 * Two widenings beyond the design's list (§8.2). Contractions accept the typographic apostrophe (U+2019) as well
 * as the ASCII one: this runs over model output, not source code, and "I’ll" is the same promise as "I'll". And
 * offers the design's list let through are caught: "Would you like me to check again later?", "I will keep you
 * posted", "I'd be happy to monitor this route", 我稍后再帮你查. Each form still needs someone making the offer (I,
 * we, me, awardgrid, 我) or a "for you" (帮你, 为你), so advice to the person ("Check back on the program's site
 * before transferring", 你可以稍后再查看官网) and the system prompt's "it cannot look again later" stay unmarked.
 *
 * Searching again is NOT on its own a promise the app cannot keep: within a conversation the person asks and
 * Claude searches ("Would you like me to search again with a wider date range?", or narration between tool calls,
 * "I'll search again with first class included"). Only an offer to look again at a LATER time is one, so "again"
 * must come with later, tomorrow, soon, next week or in a few days. Negations are left alone in both languages:
 * "track down the flight numbers", "alert you to a caveat", 我不会稍后再帮你查, 我没办法通知你.
 */

/** A later time. Without one, "search again" is a request the conversation itself can fulfil. */
const LATER = String.raw`(?:later|tomorrow|soon|next\s+(?:week|month)|in\s+a\s+(?:few\s+)?(?:days?|hours?|weeks?))`;

/** A negation that may sit a word before the verb in Chinese: 不会, 无法在, 没办法, 不能. */
const ZH_NOT = String.raw`(?:不|无法|不能|没法|没办法)(?:会|要|能|可以|在)?`;

const FOLLOW_UP_PATTERNS: readonly RegExp[] = [
  // "I'll keep an eye on this route", "I can notify you", "We will let you know", "awardgrid will check back",
  // "I will keep you posted", "I'll search again tomorrow".
  new RegExp(
    String.raw`\b(?:I|we|awardgrid|the app)(?:['’]ll|\s+will|\s+can|\s+could)\s+(?:keep\s+(?:an\s+eye|watching|checking|monitoring|tracking)|keep\s+you\s+(?:posted|updated|informed)|monitor|track(?!\s+down)|notify|alert\s+you(?!\s+to\b)|remind|let\s+you\s+know|(?:check|look|search)\s+(?:again\s+)?${LATER}|check\s+back)\b`,
    "i",
  ),
  // "I'd be happy to monitor this route", "I'm glad to keep an eye on it".
  new RegExp(
    String.raw`\b(?:I|we)(?:['’]d|\s+would|['’]m|\s+am|['’]re|\s+are)\s+(?:be\s+)?(?:happy|glad)\s+to\s+(?:keep\s+(?:an\s+eye|watching|checking|monitoring|tracking)|keep\s+you\s+(?:posted|updated|informed)|monitor|track(?!\s+down)|watch|notify|alert\s+you(?!\s+to\b)|remind|let\s+you\s+know|(?:check|look|search)\s+(?:again\s+)?${LATER}|check\s+back)\b`,
    "i",
  ),
  // "Want me to check again tomorrow?", "Would you like me to check again later?", "Would you like me to monitor this route?"
  new RegExp(
    String.raw`\b(?:want|like|shall|should)\s+me\s+to\s+(?:(?:check|look|search)\s+(?:again\s+)?(?:back|${LATER})|(?:monitor|watch)\b|track(?!\s+down)\b)`,
    "i",
  ),
  // "notify you when seats open", but not "awardgrid cannot notify you when a seat opens".
  /(?<!\b(?:not|never|cannot|can't|can’t|won't|won’t)\s)\b(?:notify|alert|message|email|remind)\s+you\s+(?:when|if|as\s+soon\s+as|once)\b/i,
  /\bset\s+up\s+(?:an?\s+)?(?:alert|notification|reminder)\b/i,
  /\bin\s+the\s+background\b/i,
  // 我会持续关注 / 我们将监控 / 我会通知你
  /(?:我|我们)(?:会|将)(?:持续|继续|一直)?(?:关注|监控|通知你|提醒你)/,
  // 通知你 / 提醒您, but not 无法通知你, 不能提醒您 or 我不会通知你
  new RegExp(String.raw`(?<!${ZH_NOT})(?:通知|提醒)(?:你|您)`),
  // 持续关注 / 帮你检查, but not 我不会持续关注
  new RegExp(String.raw`(?<!${ZH_NOT})(?:持续|继续|帮你)(?:关注|监控|检查)`),
  // 我稍后再帮你查 / 明天再为你检查 / 我晚点再看, but not 无法稍后再帮你查, 我不会稍后再帮你查 or 你可以稍后再查看
  new RegExp(
    String.raw`(?<!${ZH_NOT})(?:稍后|晚些|晚点|明天|改天|过几天|以后)再?(?:帮你|为你|帮您|为您)(?:查|检查|看|搜|关注|监控)|我们?(?:会|将|可以)?(?:稍后|晚些|晚点|明天|改天|过几天|以后)再(?:帮你|为你|帮您|为您)?(?:查|检查|看|搜|关注|监控)`,
  ),
];

/** True when `text` offers a follow-up awardgrid cannot deliver: watching, notifying, or looking again later. */
export function promisesFollowUp(text: string): boolean {
  return FOLLOW_UP_PATTERNS.some((re) => re.test(text));
}
