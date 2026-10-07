/**
 * Sample mode's words on the screens, in English and Chinese (release plan step 17). The banner's sentence itself is
 * the approved `demo.synthetic` (core present.ts COPY), under the title here; the time line on every sample row is
 * core's SAMPLE_TIME_LABEL. locale-parity.test.ts holds both languages to the same keys.
 *
 * Statically imported by the screens, so it is in the main bundle; the sample data and its transport are not
 * (./boot.ts and what it imports load only in sample mode).
 */
import { CAN_CONNECT, STORE } from "../app/flags";
import type { Locale } from "../app/locale";

export interface SampleCopy {
  /** The welcome's first action. */
  tryIt: string;
  /** While the switch is under way. */
  opening: string;
  /** The banner's title, over the approved demo.synthetic sentence. */
  title: string;
  exit: string;
  exiting: string;
  /** A switch that could not be made, with the storage's own words after it. */
  switchFailed: (message: string) => string;
  /** Where "Data: seats.aero" would be, over sample rows. */
  attribution: string;
  /** Where a program link would be, on an option's details and in the comparison. */
  noLinks: string;
  /** Under a search that reaches past what sample data covers. */
  coverage: (airports: number) => string;
  /** The one-tap structured search: Hong Kong to Seattle, the next 30 days, business. */
  trySearch: string;
  /** Settings › seats.aero account, in sample mode. */
  connectHint: string;
  /** The seats.aero row's value in Settings, in sample mode (never the placeholder's last four). */
  settingsValue: string;
  /**
   * Settings › About's first sentence, in sample mode, in place of the account's "Searches go to seats.aero with your
   * seats.aero API key…": what is true over sample data. Its data line is `attribution`, as on every sample screen.
   * A build with no way to connect (CONNECT "0") does not offer one.
   */
  aboutSent: string;
  /** The comparison's source-time field, in sample mode. */
  compareField: string;
  /** The query editor's note under its submit button, in sample mode. */
  editorNote: string;
  /** Watches' rule about checks close together, in sample mode (the live one is about seats.aero's cache). */
  watchSkipSoon: string;
  /** Saved › Search again's confirmation, in sample mode (the live one is about seats.aero requests). */
  savedSearchAgain: string;
}

export const SAMPLE: Record<Locale, SampleCopy> = {
  en: {
    tryIt: "Try with sample data",
    opening: "Opening sample data",
    title: "Sample data",
    exit: "Exit sample data",
    exiting: "Leaving sample data",
    switchFailed: (message) => `Could not switch: ${message}`,
    attribution: "Sample data · on this device",
    noLinks: "Sample options have no booking links.",
    coverage: (airports) => `Sample data covers the ${airports} airports AwardGrid recognises, for the next 12 months.`,
    trySearch: "Try Hong Kong to Seattle, next 30 days, business",
    connectHint: "Exit sample data to connect your account.",
    settingsValue: "Sample data",
    aboutSent: CAN_CONNECT
      ? "Sample data is made on this device, and nothing is sent. Connecting a seats.aero account is optional."
      : "Sample data is made on this device, and nothing is sent.",
    compareField: "Data",
    // The App Store build has no AI at all (app/flags.ts STORE), so it does not say what it does not use.
    editorNote: STORE ? "Searches the sample data on this device" : "Searches the sample data on this device · No AI",
    watchSkipSoon: "A check sooner than 45 minutes after the previous one is skipped.",
    savedSearchAgain: "It searches the sample data on this device. Nothing is sent.",
  },
  zh: {
    tryIt: "试用示例数据",
    opening: "正在打开示例数据",
    title: "示例数据",
    exit: "退出示例数据",
    exiting: "正在退出示例数据",
    switchFailed: (message) => `无法切换：${message}`,
    attribution: "示例数据 · 仅在本机",
    noLinks: "示例选项没有预订链接。",
    coverage: (airports) => `示例数据涵盖 AwardGrid 能识别的 ${airports} 个机场，以及未来 12 个月。`,
    trySearch: "试试 香港到西雅图，未来30天，商务舱",
    connectHint: "退出示例数据后即可连接你的账户。",
    settingsValue: "示例数据",
    aboutSent: CAN_CONNECT ? "示例数据在本机生成，不会发送任何内容。连接 seats.aero 账户是可选的。" : "示例数据在本机生成，不会发送任何内容。",
    compareField: "数据",
    editorNote: STORE ? "在本机示例数据中查询" : "在本机示例数据中查询 · 不使用 AI",
    watchSkipSoon: "距离上一次检查不到 45 分钟的检查会跳过。",
    savedSearchAgain: "会在本机示例数据中查询，不发送任何请求。",
  },
};
