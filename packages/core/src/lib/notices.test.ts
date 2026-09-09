import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { t } from "@/lib/i18n";
import { NOTICE_CODES, isNotice, notice, noticeKey, noticeText, noticesToText } from "@/lib/notices";

describe("notices", () => {
  it("every notice code has an English and a Chinese string with matching placeholders", () => {
    for (const code of NOTICE_CODES) {
      const key = noticeKey(code);
      expect(typeof en[key], key).toBe("string");
      expect(typeof zh[key], key).toBe("string");
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(zh[key]), key).toEqual(ph(en[key]));
    }
  });

  it("noticeText renders the English template; t() renders the same notice in Chinese", () => {
    const n = notice("find.truncated_search", { pages: 3 });
    expect(noticeText(n)).toBe("Results may be incomplete: stopped after 3 page(s) of Cached Search to protect the daily quota.");
    expect(t("zh", noticeKey(n.code), n.vars)).toContain("3");
    expect(t("zh", noticeKey(n.code), n.vars)).not.toMatch(/Results may be incomplete/);
    expect(noticesToText([notice("parse.llm_retry")])).toEqual(["the language model needed a retry to produce a valid answer"]);
  });

  it("isNotice accepts only known codes with scalar vars (API responses are untrusted)", () => {
    expect(isNotice({ code: "parse.empty" })).toBe(true);
    expect(isNotice({ code: "parse.range_truncated", vars: { days: 92, date_from: "2026-10-01" } })).toBe(true);
    expect(isNotice({ code: "nope" })).toBe(false);
    expect(isNotice({ code: "parse.empty", vars: { x: { y: 1 } } })).toBe(false);
    expect(isNotice("parse.empty")).toBe(false);
    expect(isNotice(null)).toBe(false);
  });
});
