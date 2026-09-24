/**
 * The Ask page's own words, in English and Chinese (UI/UX v1 T15; docs/04 S09; U-039). The English keeps the design's
 * wording from ./labels.ts where it had one, so the page reads as it did; the Chinese says the same, under the same
 * rules: what is sent is said as what is sent, Stop never claims to recall a request, and nothing promises a check
 * later. `locale-parity.test.ts` checks both languages; `honesty.test.ts` scans both.
 *
 * Still English here, marked so on a Chinese page, until T17 reworks them: a question's steps, how it ended, its
 * failure lines and its meta line (./labels.ts), and messages core writes.
 */
import type { Locale } from "../app/locale";

export interface AskCopy {
  title: string;
  back: string;
  subline: string;
  questionLabel: string;
  ask: string;
  stop: string;
  stopNote: string;
  newConversation: string;
  conversationNote: string;
  confirmNewTitle: string;
  confirmNewBody: string;
  keepConversation: string;
  close: string;
  suggestionsWithSearch: readonly string[];
  suggestionsWithoutSearch: readonly string[];
  openSettings: string;
  noSeatsKey: string;
  busy: string;
  cleared: string;
  keysChanged: string;
  retryUnavailable: string;
  contextChanged: string;
  searchChanged: string;
  attribution: string;
  /** The context line: what the next question sends, from the payload. */
  contextTitle: string;
  /** With the approved "Only the query conditions will be sent." / "Query and {count} selected options will be sent." */
  sendsQuestionOnly: string;
  searchLine: (search: string) => string;
  sendsEarlier: (n: number) => string;
  partialNote: string;
  unknownCoverageNote: string;
  includeSearch: string;
  attachRows: (n: number) => string;
  cannotAttach: string;
  /** On an entry: what went with it. */
  sentNothing: string;
  sentSearch: string;
  sentSearchAndRows: (n: number) => string;
  sentEarlier: (n: number) => string;
  rowGone: string;
  askAgain: string;
  tryAgain: string;
  /** T16: a proposed change to the search (with the approved ai.apply, ai.keep and ai.stale). */
  proposalTitle: string;
  proposalReason: string;
  proposalNoBase: string;
  original: string;
  proposed: string;
  fieldRoute: string;
  fieldDynamic: string;
  yes: string;
  no: string;
  noCap: string;
  included: string;
  notIncluded: string;
  proposalApplied: string;
  proposalKept: string;
  viewResults: string;
  applyNote: string;
  comparedWithShown: string;
}

export const ASK_COPY: Record<Locale, AskCopy> = {
  en: {
    title: "Ask Claude",
    back: "Back",
    subline:
      "Claude answers with your own Anthropic key. When it needs award data, this app searches seats.aero with your own Pro key, which is never sent to Anthropic. Claude sees the earlier questions in this conversation.",
    questionLabel: "Question for Claude",
    ask: "Ask",
    stop: "Stop",
    stopNote: "Stop sends nothing more. It cannot recall a request already sent.",
    newConversation: "New conversation",
    conversationNote: "Answers in this conversation are saved on this device until you start a new conversation.",
    confirmNewTitle: "Start a new conversation?",
    confirmNewBody: "The questions and answers here are removed from this device, and later questions are sent without them. Your searches, results and keys are not affected.",
    keepConversation: "Keep this conversation",
    close: "Close",
    suggestionsWithSearch: [
      "Which program has the cheapest seats in this search?",
      "What are the taxes and fees on the cheapest option?",
      "Are there nonstop options in this window?",
    ],
    suggestionsWithoutSearch: [
      "Cheapest business class from SFO to Tokyo in the next 60 days?",
      "First class from London to New York next month: which programs have seats?",
    ],
    openSettings: "Open Settings",
    noSeatsKey: "Ask searches seats.aero with your own Pro key. Add it in Settings first.",
    busy: "A question is already running. Stop it or wait for the answer.",
    cleared: "Conversation cleared.",
    keysChanged: "A key in Settings changed after this question failed, so its request was not resent. Ask again to use the keys on file now.",
    retryUnavailable: "This request can no longer be resent. Ask again.",
    contextChanged: "The results this question was to be sent with are no longer on screen, so nothing was sent. Choose them again on the Search screen.",
    searchChanged: "The search on screen changed before this question was sent, so nothing was sent. Check what goes with it and ask again.",
    attribution: "Data: seats.aero",
    contextTitle: "Sent with your question",
    sendsQuestionOnly: "Only your question will be sent.",
    searchLine: (search) => `Search: ${search}`,
    sendsEarlier: (n) => `Also the ${n === 1 ? "earlier question and answer" : `${n} earlier questions and answers`} in this conversation.`,
    partialNote: "The results on screen are incomplete, and Claude is told so.",
    unknownCoverageNote: "Whether the results on screen are complete is unknown, and Claude is told so.",
    includeSearch: "Include this search",
    attachRows: (n) => (n === 1 ? "Attach the selected result" : `Attach the ${n} selected results`),
    cannotAttach: "The selected results are not all from the search on screen, so none can be attached. Choose them again from these results.",
    sentNothing: "Sent without a search.",
    sentSearch: "Sent with the search.",
    sentSearchAndRows: (n) => `Sent with the search and ${n === 1 ? "1 result" : `${n} results`}:`,
    sentEarlier: (n) => `The ${n === 1 ? "earlier question" : `${n} earlier questions`} in this conversation went with it.`,
    rowGone: "no longer in the results on this device",
    askAgain: "Ask again",
    tryAgain: "Try again",
    proposalTitle: "Suggested change to your search",
    proposalReason: "Claude's reason:",
    proposalNoBase: "No search went with this question, so this would be a new search.",
    original: "Original",
    proposed: "New",
    fieldRoute: "Route",
    fieldDynamic: "Dynamic pricing",
    yes: "Yes",
    no: "No",
    noCap: "No cap",
    included: "Included",
    notIncluded: "Not included",
    proposalApplied: "Applied. The search runs with these conditions, on your own seats.aero quota.",
    proposalKept: "Kept the current conditions. Nothing was searched.",
    viewResults: "View results",
    applyNote: "Apply runs a new search with these conditions on your own seats.aero quota. The results on screen stay until it finishes. Nothing has been sent yet.",
    comparedWithShown: "Compared with the search on screen, which was not sent to Claude.",
  },
  zh: {
    title: "询问 Claude",
    back: "返回",
    subline: "Claude 使用你自己的 Anthropic 密钥回答。需要奖励票数据时，本应用用你自己的 seats.aero Pro 密钥查询 seats.aero；这个密钥不会发给 Anthropic。Claude 能看到本次对话中之前的问题。",
    questionLabel: "向 Claude 提问",
    ask: "提问",
    stop: "停止",
    stopNote: "停止后不再发送后续步骤，但无法撤回已经发出的请求。",
    newConversation: "新对话",
    conversationNote: "本次对话的回答保存在本机，直到你开始新对话。",
    confirmNewTitle: "开始新对话？",
    confirmNewBody: "这里的问答会从本机移除，之后的问题不再附带它们。你的查询、结果和密钥不受影响。",
    keepConversation: "保留此对话",
    close: "关闭",
    suggestionsWithSearch: ["这次查询里哪个计划的座位最便宜？", "最便宜的选项税费是多少？", "这个日期范围内有直飞吗？"],
    suggestionsWithoutSearch: ["未来 60 天从 SFO 到东京最便宜的商务舱？", "下个月从伦敦到纽约的头等舱：哪些计划有座位？"],
    openSettings: "打开设置",
    noSeatsKey: "AI 辅助用你自己的 seats.aero Pro 密钥查询。请先在设置中添加。",
    busy: "已有问题在进行中。请停止它，或等待回答。",
    cleared: "对话已清除。",
    keysChanged: "这个问题失败后，设置中的密钥已更改，所以没有重新发送。请重新提问，以使用现在保存的密钥。",
    retryUnavailable: "这个请求已无法重新发送。请重新提问。",
    contextChanged: "这个问题要附带的结果已不在屏幕上，所以没有发送任何内容。请在查票页重新选择。",
    searchChanged: "发送前屏幕上的查询已改变，所以没有发送任何内容。请确认随问题发送的内容后再提问。",
    attribution: "数据：seats.aero",
    contextTitle: "随问题发送",
    sendsQuestionOnly: "只发送你的问题。",
    searchLine: (search) => `查询：${search}`,
    sendsEarlier: (n) => `还会发送本次对话中之前的 ${n} 组问答。`,
    partialNote: "屏幕上的结果不完整，也会如实告诉 Claude。",
    unknownCoverageNote: "屏幕上的结果是否完整未知，也会如实告诉 Claude。",
    includeSearch: "附带此查询",
    attachRows: (n) => `附带已选的 ${n} 个结果`,
    cannotAttach: "已选的结果并非都来自屏幕上的查询，因此都不能附带。请在当前结果中重新选择。",
    sentNothing: "发送时未附带查询。",
    sentSearch: "发送时附带了查询。",
    sentSearchAndRows: (n) => `发送时附带了查询和 ${n} 个结果：`,
    sentEarlier: (n) => `本次对话中之前的 ${n} 个问题也一并发送。`,
    rowGone: "已不在本机的结果中",
    askAgain: "重新提问",
    tryAgain: "重试",
    proposalTitle: "修改查询的建议",
    proposalReason: "Claude 的理由：",
    proposalNoBase: "这个问题没有附带查询，所以这会是一次新的查询。",
    original: "原",
    proposed: "新",
    fieldRoute: "航线",
    fieldDynamic: "动态定价",
    yes: "是",
    no: "否",
    noCap: "不限",
    included: "包含",
    notIncluded: "不包含",
    proposalApplied: "已应用。将按这些条件查询，使用你自己的 seats.aero 额度。",
    proposalKept: "已保留原条件，没有查询。",
    viewResults: "查看结果",
    applyNote: "应用后会按这些条件新查一次，使用你自己的 seats.aero 额度。完成前，屏幕上的结果保留。目前尚未发送任何请求。",
    comparedWithShown: "与屏幕上的查询比较；该查询没有发给 Claude。",
  },
};
