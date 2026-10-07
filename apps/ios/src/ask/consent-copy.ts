/**
 * Ask's permission to send data to Anthropic, in English and Chinese (release decision D10; App Review Guideline
 * 5.1.2(i), which asks for explicit permission before personal data goes to a third-party AI).
 *
 * The consent sheet (AskScreen) opens before the first question and names Anthropic, what is sent, what is not, and
 * who bills for it; nothing is sent until the person taps Allow. The Anthropic key page (SettingsScreen) says whether
 * it was given and withdraws it. What is listed as sent is ANTHROPIC_DATA_SENT (./labels.ts) item by item, which is
 * what a question carries (core ask/prompt.ts, loop.ts; LEGAL.md).
 *
 * ANTHROPIC_CONSENT_VERSION is the wording a permission was given for (app/settings-store.ts). Raise it when what is
 * sent changes: every earlier permission then counts as none, and the sheet asks again.
 *
 * `locale-parity.test.ts` checks both languages; `honesty.test.ts` scans both.
 */
import type { Locale } from "../app/locale";

export { ANTHROPIC_CONSENT_VERSION } from "./consent-version";

/** Anthropic's own privacy policy, linked from the sheet. */
export const ANTHROPIC_PRIVACY_URL = "https://www.anthropic.com/legal/privacy";

export interface ConsentCopy {
  sheet: {
    title: string;
    intro: string;
    /** What a question sends, one item each. */
    sent: readonly string[];
    notSent: string;
    terms: string;
    privacyLink: string;
    withdraw: string;
    allow: string;
    notNow: string;
    close: string;
    /** After Not now: said, so a closed sheet is not mistaken for a question on its way. */
    declined: string;
  };
  settings: {
    allowed: string;
    notAllowed: string;
    withdraw: string;
    withdrawn: string;
    withdrawNotSaved: string;
  };
}

export const CONSENT: Record<Locale, ConsentCopy> = {
  en: {
    sheet: {
      title: "Allow Ask to send data to Anthropic?",
      intro: "Ask answers with Claude, an AI model run by Anthropic, on your own Anthropic API key. To answer, this app sends Anthropic:",
      sent: [
        "Your question, and the earlier questions and answers in this conversation",
        "The search you include, and any results you attach",
        "The seats.aero results Ask reads to answer",
      ],
      notSent: "Your seats.aero key is never sent to Anthropic, and nothing is sent until you ask a question.",
      terms: "Anthropic receives this under its own terms and privacy policy, and bills each question to your key.",
      privacyLink: "Anthropic's privacy policy",
      withdraw: "You can withdraw this later on the Anthropic key page in Settings.",
      allow: "Allow and ask",
      notNow: "Not now",
      close: "Close",
      declined: "Nothing was sent to Anthropic.",
    },
    settings: {
      allowed: "You allowed Ask to send data to Anthropic.",
      notAllowed: "Ask has not been allowed to send data to Anthropic. It asks you before your first question.",
      withdraw: "Withdraw permission",
      withdrawn: "Permission withdrawn. Ask sends nothing more until you allow it again, and it cannot recall what was already sent.",
      withdrawNotSaved: "Withdrawn for now, but the change could not be saved on this device. Check this page again after reopening the app.",
    },
  },
  zh: {
    sheet: {
      title: "允许 AI 辅助向 Anthropic 发送数据？",
      intro: "AI 辅助由 Anthropic 运营的 AI 模型 Claude 回答，使用你自己的 Anthropic API 密钥。为了回答，本应用会向 Anthropic 发送：",
      sent: ["你的问题，以及本次对话中之前的问答", "你附带的查询，以及你附上的结果", "AI 辅助为回答而读取的 seats.aero 结果"],
      notSent: "你的 seats.aero 密钥不会发给 Anthropic；在你提问之前，不会发送任何内容。",
      terms: "Anthropic 按其自身的条款和隐私政策接收这些数据，并按你的密钥对每次提问计费。",
      privacyLink: "Anthropic 隐私政策",
      withdraw: "之后可以在设置的 Anthropic 密钥页撤回。",
      allow: "允许并提问",
      notNow: "暂不",
      close: "关闭",
      declined: "没有向 Anthropic 发送任何内容。",
    },
    settings: {
      allowed: "你已允许 AI 辅助向 Anthropic 发送数据。",
      notAllowed: "尚未允许 AI 辅助向 Anthropic 发送数据。首次提问前会先征求你的同意。",
      withdraw: "撤回许可",
      withdrawn: "已撤回许可。在你再次允许之前，AI 辅助不会再发送任何内容；已发送的内容无法撤回。",
      withdrawNotSaved: "本次已撤回，但无法保存到本机。重新打开应用后，请再查看此页。",
    },
  },
};
