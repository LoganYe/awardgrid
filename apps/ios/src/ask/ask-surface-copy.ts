/**
 * Ask on screens that are not its own, in English and Chinese: the Search header's link and "Ask Claude about this
 * search", the details' Back when they were opened from an answer, Settings' AI group and its row, and the Settings
 * sentences that name Ask or Anthropic (what is sent where, the non-affiliation sentence, the cache note, the line in
 * the seats.aero key's removal sheet).
 *
 * Read only behind `STORE ? … : …` (app/flags.ts). The App Store build compiles Ask out, so this table is not in its
 * bundle (scripts/check-store-bundle.mjs), and those screens use their neutral wording instead (settings-copy.ts,
 * components/results/copy.ts). English sentences ./labels.ts already holds come from there, unchanged.
 */
import type { Locale } from "../app/locale";
import { ASK_ABOUT_SEARCH, CACHE_CLEARED, CACHE_NOTE } from "./labels";

export interface AskSurfaceCopy {
  search: {
    /** The Search header's link to Ask (copy key ai.entry). */
    header: string;
    headerWorking: string;
    /** Next to Watch this search, whenever a result is shown. */
    aboutSearch: string;
    /** The details' Back, when they were opened from an answer's reference (T15). */
    backFromAnswer: string;
  };
  settings: {
    group: string;
    row: string;
    rowNote: string;
    aboutSent: string;
    notAffiliated: string;
    cacheNote: string;
    cacheCleared: string;
    /** The seats.aero key's removal sheet: what it does not touch. */
    seatsKeyKeepsAi: string;
  };
}

export const ASK_SURFACES: Record<Locale, AskSurfaceCopy> = {
  en: {
    search: {
      header: "AI assistance",
      headerWorking: "AI assistance (working)",
      aboutSearch: ASK_ABOUT_SEARCH,
      backFromAnswer: "Return to AI assistance",
    },
    settings: {
      group: "AI (optional)",
      row: "Anthropic API key",
      rowNote: "Only for AI assistance. Search works without it.",
      aboutSent:
        "Searches go to seats.aero with your seats.aero API key. When you use AI assistance, your question, the earlier questions and answers in that conversation, the search you include and the seats.aero results it reads go to Anthropic. Keeping keys on this device does not keep searches off the network.",
      notAffiliated: "AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any loyalty program.",
      cacheNote: CACHE_NOTE,
      cacheCleared: CACHE_CLEARED,
      seatsKeyKeepsAi: "AI assistance keeps its own key.",
    },
  },
  zh: {
    search: {
      header: "AI辅助",
      headerWorking: "AI辅助（进行中）",
      aboutSearch: "就此查询问 AI",
      backFromAnswer: "返回 AI 辅助",
    },
    settings: {
      group: "AI（可选）",
      row: "Anthropic API 密钥",
      rowNote: "仅用于 AI 辅助，没有它也能查票。",
      aboutSent:
        "查票请求会携带你的 seats.aero API 密钥发往 seats.aero。使用 AI 辅助时，你的问题、同一对话中之前的问答、你附带的查询，以及它读取的 seats.aero 结果会发往 Anthropic。密钥保存在本机，不代表查询内容不外发。",
      notAffiliated: "AwardGrid 与 seats.aero、Anthropic、任何航空公司或任何里程计划均无关联，也未获其认可或赞助。",
      cacheNote: "兑换结果在本机缓存 45 分钟，重复查询不消耗 seats.aero 调用。清除后下次查询需重新获取，不影响密钥和 AI 对话。",
      cacheCleared: "缓存结果已清除，密钥未受影响。",
      seatsKeyKeepsAi: "AI 辅助使用自己的密钥，不受影响。",
    },
  },
};
