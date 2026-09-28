/**
 * The words on the next version's App Store screenshots (docs/release/appstore/next/<locale>/<shot>.png): the caption
 * of each shot and the label in the corner of every image. ./appstore-screenshots-next.spec.ts renders them into the
 * images. They are public copy, so scripts/growth/store-captions-next.test.ts checks each one against the
 * public-claims gate and the committed images' size on every run of the root tests, without rendering anything.
 */

export type Shot = "01-matrix" | "02-text" | "03-details" | "04-calendar" | "05-compare" | "06-watches" | "07-key" | "08-ask";

export const SHOTS: readonly Shot[] = ["01-matrix", "02-text", "03-details", "04-calendar", "05-compare", "06-watches", "07-key", "08-ask"];

/** The size of every image: the 6.9-inch iPhone at 3× (440×956 pt). */
export const IMAGE_SIZE = { width: 1320, height: 2868 } as const;

export const STORE_SHOTS_NEXT = {
  "en-US": {
    sample: "Sample data",
    captions: {
      "01-matrix": "Routes × dates in one table",
      "02-text": "Type routes and dates in English or Chinese",
      "03-details": "Each option: miles, fees, seats left, program, data age",
      "04-calendar": "Every date at a glance",
      "05-compare": "Compare up to four options",
      "06-watches": "Watches are checked when you open the app",
      "07-key": "Needs your own seats.aero Pro key",
      "08-ask": "Optional: Ask uses your own AI key",
    } satisfies Record<Shot, string>,
  },
  "zh-Hans": {
    sample: "示例数据",
    captions: {
      "01-matrix": "航线 × 日期，一张表看清",
      "02-text": "中文或英文输入航线和日期",
      "03-details": "每个选项：里程、税费、余座、兑换计划、数据时间",
      "04-calendar": "按日历看每一天",
      "05-compare": "最多四个选项并排比较",
      "06-watches": "打开 App 时检查关注",
      "07-key": "需要你自己的 seats.aero Pro 密钥",
      "08-ask": "可选：Ask 用你自己的 AI 密钥",
    } satisfies Record<Shot, string>,
  },
} as const;

export type StoreShotLocale = keyof typeof STORE_SHOTS_NEXT;
