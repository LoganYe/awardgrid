import { describe, expect, it } from "vitest";
import { NOW, makeQuery, makeRow } from "../../../test/fixtures/grid/rows";
import { UTF8_BOM, csvField, toCsv, toCsvCells } from "@/lib/grid/csv";
import { buildGrid } from "@/lib/grid/pivot";

describe("csvField", () => {
  it("quotes only when needed and doubles quotes (RFC 4180)", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe("");
    expect(csvField(false)).toBe("false");
  });
});

describe("toCsv", () => {
  const rows = [
    makeRow({ program: "alaska", miles: 80_000, booking_url: "https://example.test/book?a=1,2" }),
    makeRow({
      program: "united",
      miles: 70_000,
      fees_cents: null,
      currency: null,
      airlines: ["UA", "NH"],
    }),
  ];
  const grid = buildGrid(rows, makeQuery({ date_to: "2026-10-15" }), { now: NOW });

  it("emits a header plus one line per row with the best flag, CRLF terminated", () => {
    const csv = toCsv(grid);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "date,origin,dest,program,program_name,cabin,miles,fees_cents,currency,seats_left,direct,airlines,last_seen,best,booking_url",
    );
    expect(lines[1]).toBe(
      "2026-10-15,HKG,SEA,united,United MileagePlus,J,70000,,,2,true,UA NH,2026-10-01T10:00:00.000Z,true,",
    );
    expect(lines[2]).toBe(
      '2026-10-15,HKG,SEA,alaska,Alaska Mileage Plan,J,80000,5600,USD,2,true,AS,2026-10-01T10:00:00.000Z,false,"https://example.test/book?a=1,2"',
    );
    expect(lines[3]).toBe("");
    expect(csv.startsWith(UTF8_BOM)).toBe(false);
  });

  it("prepends a BOM on request", () => {
    const csv = toCsv(grid, { bom: true });
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.slice(1).startsWith("date,")).toBe(true);
  });

  it("works from the routes orientation with identical output", () => {
    const routes = buildGrid(rows, makeQuery({ date_to: "2026-10-15" }), {
      now: NOW,
      orientation: "routes",
    });
    expect(toCsv(routes)).toBe(toCsv(grid));
  });
});

describe("toCsvCells", () => {
  it("one line per cell including empty and unmonitored cells", () => {
    const q = makeQuery({ origins: ["HKG", "PVG"], date_to: "2026-10-15" });
    const grid = buildGrid([makeRow({ program: "alaska" })], q, {
      now: NOW,
      unmonitored_pairs: [{ origin: "PVG", dest: "SEA" }],
    });
    const lines = toCsvCells(grid).split("\r\n");
    expect(lines[0]?.startsWith("date,origin,dest,status,program,")).toBe(true);
    expect(lines[1]).toBe(
      "2026-10-15,HKG,SEA,ok,alaska,Alaska Mileage Plan,J,80000,5600,USD,2,true,AS,2026-10-01T10:00:00.000Z,1,1,",
    );
    expect(lines[2]).toBe("2026-10-15,PVG,SEA,unmonitored,,,,,,,,,,,0,0,");
    expect(lines).toHaveLength(4);
  });

  it("programs_available counts distinct programs, not (program, cabin) rows", () => {
    const q = makeQuery({ date_to: "2026-10-15" });
    // One program with J and F available = 2 rows, 1 program; a second program adds a third row.
    const grid = buildGrid(
      [makeRow({ program: "alaska", cabin: "J" }), makeRow({ program: "alaska", cabin: "F", miles: 120_000 }), makeRow({ program: "american", cabin: "J", miles: 90_000 })],
      q,
      { now: NOW },
    );
    const lines = toCsvCells(grid).split("\r\n");
    const header = lines[0]!.split(",");
    const fields = lines[1]!.split(",");
    expect(fields[header.indexOf("programs_available")]).toBe("2");
    expect(fields[header.indexOf("rows_available")]).toBe("3");
  });
});
