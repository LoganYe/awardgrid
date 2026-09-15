import { describe, expect, it } from "vitest";
import { DEEPLINK_CAVEAT } from "@awardgrid/core/grid";
import { zh } from "@awardgrid/core/i18n/dictionaries/zh";
import { escapeHtml, formatDigest, formatDropLine, formatMiles, formatNewCellLine, MAX_DIGEST_LINES, shortDate, type DigestCell } from "./format";

const NOW = "2026-09-06T12:00:00.000Z";

function cell(over: Partial<DigestCell> = {}): DigestCell {
  return {
    program: "alaska",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-15",
    cabin: "F",
    miles: 80_000,
    seats_left: 2,
    computed_last_seen: "2026-09-06T10:00:00.000Z",
    ...over,
  };
}

const empty = { new: [], price_drops: [], dropped: [] };

describe("helpers", () => {
  it("escapes &, <, > and quotes", () => {
    expect(escapeHtml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(escapeHtml(null)).toBe("");
  });
  it("formatMiles", () => {
    expect(formatMiles(80_000)).toBe("80k");
    expect(formatMiles(57_500)).toBe("57.5k");
    expect(formatMiles(950)).toBe("950");
    expect(formatMiles(Number.NaN)).toBe("?");
  });
  it("shortDate", () => {
    expect(shortDate("2026-10-15")).toBe("10-15");
    expect(shortDate("oops")).toBe("oops");
  });
});

describe("lines", () => {
  it("new cell line (en)", () => {
    expect(formatNewCellLine(cell(), "en", NOW)).toBe(
      "HKG→SEA 10-15 F <b>80k</b> · 2 seats · Alaska Mileage Plan (2h ago)",
    );
  });
  it("new cell line omits unknown seats and age, keeps unknown programs as codes", () => {
    expect(formatNewCellLine(cell({ seats_left: 0, computed_last_seen: undefined, program: "mystery" }), "en", NOW)).toBe(
      "HKG→SEA 10-15 F <b>80k</b> · mystery",
    );
  });
  it("drop line with percentage", () => {
    expect(formatDropLine({ before: cell({ miles: 95_000 }), after: cell() }, "en", NOW)).toBe(
      "HKG→SEA 10-15 F <b>↓ 95k→80k (-16%)</b> · 2 seats · Alaska Mileage Plan (2h ago)",
    );
  });
  it("zh line", () => {
    expect(formatNewCellLine(cell(), "zh", NOW)).toBe("HKG→SEA 10-15 F <b>80k</b> · 2 座 · Alaska Mileage Plan (2小时前)");
  });
});

describe("formatDigest", () => {
  it("renders title, sections, link, attribution and the fixed caveat (en)", () => {
    const html = formatDigest({
      savedQuery: { name: "HKG-SEA autumn" },
      diff: { new: [cell()], price_drops: [{ before: cell({ miles: 95_000 }), after: cell() }], dropped: [cell(), cell()] },
      locale: "en",
      gridUrl: "https://ag.example/grid?q=1&x=2",
      now: NOW,
    });
    const lines = html.split("\n");
    expect(lines[0]).toBe("<b>awardgrid · HKG-SEA autumn</b>");
    expect(lines[1]).toBe("<b>1 new</b>");
    expect(lines[2]).toContain("HKG→SEA 10-15 F <b>80k</b>");
    expect(lines[3]).toBe("<b>1 cheaper</b>");
    expect(lines[4]).toContain("↓ 95k→80k (-16%)");
    expect(lines[5]).toBe("2 no longer available");
    expect(lines[6]).toBe('<a href="https://ag.example/grid?q=1&amp;x=2">Open grid</a> · Data: seats.aero');
    expect(lines[7]).toBe(`<i>${DEEPLINK_CAVEAT}</i>`);
    expect(html).toContain(DEEPLINK_CAVEAT);
    expect(html).not.toContain("+");
  });

  it("escapes HTML in every dynamic field", () => {
    const html = formatDigest({
      savedQuery: { name: `<script>alert("x")</script> & co` },
      diff: { new: [cell({ origin: "<HKG>", program: "a&b" })], price_drops: [], dropped: [] },
      locale: "en",
      gridUrl: 'https://x/"><img>',
      now: NOW,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(html).toContain("&lt;HKG&gt;→SEA");
    expect(html).toContain("a&amp;b");
    expect(html).toContain('href="https://x/&quot;&gt;&lt;img&gt;"');
    // Only the allowed tags remain.
    const tags = [...html.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(["b", "a", "i"]));
  });

  it("caps cell lines at 15 across sections and adds +N more", () => {
    const news = Array.from({ length: 12 }, (_, i) => cell({ date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
    const drops = Array.from({ length: 6 }, (_, i) => ({
      before: cell({ miles: 100_000, date: `2026-11-${String(i + 1).padStart(2, "0")}` }),
      after: cell({ date: `2026-11-${String(i + 1).padStart(2, "0")}` }),
    }));
    const html = formatDigest({
      savedQuery: { name: "big" },
      diff: { new: news, price_drops: drops, dropped: [] },
      locale: "en",
      gridUrl: "https://ag.example/g",
      now: NOW,
    });
    const cellLines = html.split("\n").filter((l) => l.startsWith("HKG→SEA"));
    expect(cellLines).toHaveLength(MAX_DIGEST_LINES);
    expect(cellLines.filter((l) => l.includes("↓"))).toHaveLength(3);
    expect(html).toContain("\n+3 more\n");
    expect(html).toContain("<b>12 new</b>");
    expect(html).toContain("<b>6 cheaper</b>");
    expect(html.length).toBeLessThan(4096);
  });

  it("zh digest uses Chinese labels and the zh caveat", () => {
    const html = formatDigest({
      savedQuery: { name: "秋季 HKG-SEA" },
      diff: { new: [cell()], price_drops: [], dropped: [cell()] },
      locale: "zh",
      gridUrl: "https://ag.example/g",
      now: NOW,
    });
    expect(html).toContain("<b>awardgrid · 秋季 HKG-SEA</b>");
    expect(html).toContain("<b>1 个新舱位</b>");
    expect(html).toContain("2 座");
    expect(html).toContain("1 个已消失");
    expect(html).toContain(">打开表格</a> · 数据来源：seats.aero");
    expect(html).toContain(`<i>${zh["footer.caveat"]}</i>`);
  });

  it("never exceeds 4096 chars: drops cell lines first, then falls back to the short link when the grid URL itself is too long", () => {
    const news = Array.from({ length: 15 }, (_, i) => cell({ date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
    // A grid URL that leaves room for only a few cell lines.
    const longUrl = `https://ag.example/grid?q=${"A".repeat(3600)}`;
    const html = formatDigest({ savedQuery: { name: "long" }, diff: { new: news, price_drops: [], dropped: [] }, locale: "en", gridUrl: longUrl, now: NOW });
    expect(html.length).toBeLessThanOrEqual(4096);
    expect(html).toContain(`href="${longUrl}"`);
    const cellLines = html.split("\n").filter((l) => l.startsWith("HKG→SEA"));
    expect(cellLines.length).toBeGreaterThan(0);
    expect(cellLines.length).toBeLessThan(15);
    expect(html).toMatch(/\n\+\d+ more\n/);

    // A grid URL that is itself over the limit (a huge raw_text) → the saved-queries page on the same origin.
    const hugeUrl = `https://ag.example/grid?q=${"B".repeat(5000)}`;
    const short = formatDigest({ savedQuery: { name: "huge" }, diff: { new: news, price_drops: [], dropped: [] }, locale: "zh", gridUrl: hugeUrl, now: NOW });
    expect(short.length).toBeLessThanOrEqual(4096);
    expect(short).not.toContain("BBBB");
    expect(short).toContain('href="https://ag.example/queries">打开表格</a>');
    expect(short.split("\n").filter((l) => l.startsWith("HKG→SEA"))).toHaveLength(15);

    // An explicit shortUrl and maxChars are honoured.
    const custom = formatDigest({ savedQuery: { name: "c" }, diff: empty, locale: "en", gridUrl: hugeUrl, shortUrl: "https://s/x", now: NOW, maxChars: 500 });
    expect(custom).toContain('href="https://s/x"');
    expect(custom.length).toBeLessThanOrEqual(500);
  });

  it("empty diff still yields title + link + caveat", () => {
    const html = formatDigest({ savedQuery: { name: "n" }, diff: empty, locale: "en", gridUrl: "https://ag/g", now: NOW });
    expect(html.split("\n")).toHaveLength(3);
  });
});
