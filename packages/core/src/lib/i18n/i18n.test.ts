import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { zh } from "./dictionaries/zh";
import { DEEPLINK_CAVEAT } from "@/lib/grid/deeplinks/index";
import { errorText, hasKey, htmlLang, interpolate, LOCALES, parseLocale, t, translator } from "./index";

/** Words only: lets the UI string and the CSV/CLI constant differ in punctuation, never in wording. */
const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/);

describe("i18n dictionaries", () => {
  it("en and zh have identical key sets", () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("every value is a non-empty string", () => {
    for (const dict of [en, zh]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, key).toBe("string");
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it("placeholders match between en and zh", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("required shared keys exist", () => {
    for (const key of [
      "grid.query_placeholder",
      "grid.empty.no_key",
      "footer.attribution",
      "grid.deeplink_caveat",
      "grid.freshness.stale",
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
    // The placeholder is the canonical example in the current UI language (spec §3.1).
    expect(en["grid.query_placeholder"]).toBe("HKG, SHA, TYO, SEL to SEA, next 30 days, first");
    expect(zh["grid.query_placeholder"]).toBe("香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱");
    expect(en["footer.attribution"]).toBe("Data: seats.aero");
    // The §4.4 caveat under every program link: the UI renders the dictionary key, the CSV /
    // CLI render the lib constant — same words (the UI version is two sentences, spec §3.5).
    expect(wordsOf(en["grid.deeplink_caveat"])).toEqual(wordsOf(DEEPLINK_CAVEAT));
  });

  it("no logos or images are referenced", () => {
    for (const dict of [en, zh]) {
      for (const value of Object.values(dict)) {
        expect(value).not.toMatch(/<img|\.png|\.svg|logo/i);
      }
    }
  });

  it("the same verb runs through a flow (button → toast)", () => {
    expect(en["grid.save_query"]).toBe("Save as standing query");
    expect(en["saved.dialog.saved"]).toBe("Standing query saved");
    expect(en["grid.export_csv"]).toBe("Export CSV");
    expect(en["grid.exported"]).toBe("CSV exported");
    expect(en["settings.telegram.link"]).toBe("Link Telegram");
    expect(en["settings.telegram.linked_now"]).toMatch(/^Telegram linked/);
    expect(en["nav.logout"]).toBe("Log out");
    expect(en["settings.account.logout_all"]).toBe("Log out everywhere");
    expect(zh["grid.save_query"]).toBe("保存为定时查询");
    expect(zh["saved.dialog.saved"]).toBe("定时查询已保存");
  });
});

describe("t()", () => {
  it("translates per locale", () => {
    expect(t("en", "nav.grid")).toBe("Grid");
    expect(t("zh", "nav.grid")).toBe("表格");
    expect(translator("zh")("nav.settings")).toBe("设置");
  });

  it("interpolates {vars} and leaves unknown placeholders alone", () => {
    expect(t("en", "grid.quota", { used: 12, limit: 950 })).toBe("12 / 950 seats.aero calls today");
    expect(interpolate("a {x} {y}", { x: "1" })).toBe("a 1 {y}");
    expect(interpolate("plain")).toBe("plain");
  });

  it("maps API error codes with a safe default", () => {
    expect(errorText("en", "invalid_credentials")).toBe(en["error.invalid_credentials"]);
    expect(errorText("zh", "rate_limited")).toBe(zh["error.rate_limited"]);
    expect(errorText("en", "does_not_exist")).toBe(en["error.unknown"]);
    expect(errorText("en", undefined)).toBe(en["error.unknown"]);
  });
});

describe("locale parsing", () => {
  it("normalises cookie / header values", () => {
    expect(parseLocale("zh")).toBe("zh");
    expect(parseLocale("zh-CN")).toBe("zh");
    expect(parseLocale("ZH_hans")).toBe("zh");
    expect(parseLocale("en-US")).toBe("en");
    expect(parseLocale("fr")).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("")).toBe("en");
  });

  it("html lang tags", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
    expect(LOCALES).toEqual(["en", "zh"]);
  });
});
