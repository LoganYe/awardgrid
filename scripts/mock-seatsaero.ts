/**
 * Local mock of the seats.aero Partner API for development and demos — serves the recorded
 * fixtures so the whole app can be tried without a real key or a single quota call.
 *
 *   pnpm exec tsx scripts/mock-seatsaero.ts            # listens on 127.0.0.1:3999
 *   SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev
 *
 * Any non-empty Partner-Authorization header is accepted (so the seeded fake keys "work").
 * Dates in the synthetic fixture are shifted so that the fixture's first date == today,
 * making "next month" queries land on data. Endpoints: /partnerapi/search, /availability,
 * /trips/{id}, /routes. Never use this in production; it is not reachable from the image.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => JSON.parse(readFileSync(path.join(root, "test/fixtures/seatsaero", f), "utf8"));
const synthetic = read("synthetic-example-query.json") as { data: Record<string, unknown>[] };
const trips = read("trips__id.json");
const PORT = Number(process.env.MOCK_SEATS_PORT ?? 3999);

const dayMs = 86_400_000;
const todayIso = new Date().toISOString().slice(0, 10);
const firstFixtureDate = [...new Set(synthetic.data.map((r) => String(r.Date)))].sort()[0]!;
const shiftDays = Math.round((Date.parse(todayIso) - Date.parse(firstFixtureDate)) / dayMs);
const shift = (iso: string) => new Date(Date.parse(iso) + shiftDays * dayMs).toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

type Row = Record<string, unknown> & { ID: string; Date: string; Source: string; Route: { ID: string; OriginAirport: string; DestinationAirport: string } };
const rows: Row[] = (synthetic.data as Row[]).map((r) => ({
  ...r,
  Date: shift(String(r.Date)),
  ParsedDate: `${shift(String(r.Date))}T00:00:00Z`,
  // keep freshness spread realistic: 30 min .. 8 h before now
  UpdatedAt: new Date(Date.now() - (30 + (hash(String(r.ID)) % 450)) * 60_000).toISOString(),
  CreatedAt: nowIso,
}));

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function list(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const auth = req.headers["partner-authorization"];
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!auth || String(auth).trim() === "") return json(401, {});
  const p = url.pathname;
  console.log(`${req.method} ${p}${url.search}`);

  if (p === "/partnerapi/search" || p === "/partnerapi/availability") {
    const origins = list(url.searchParams.get("origin_airport"));
    const dests = list(url.searchParams.get("destination_airport"));
    const source = url.searchParams.get("source");
    const sources = list(url.searchParams.get("sources")).map((s) => s.toLowerCase());
    const from = url.searchParams.get("start_date");
    const to = url.searchParams.get("end_date");
    const cabins = list(url.searchParams.get("cabins")).map((c) => c.toLowerCase());
    const cabin = url.searchParams.get("cabin");
    const direct = url.searchParams.get("only_direct_flights") === "true";
    const take = Math.min(1000, Math.max(10, Number(url.searchParams.get("take") ?? 500)));
    const skip = Number(url.searchParams.get("skip") ?? 0);
    const letter: Record<string, string> = { economy: "Y", premium: "W", business: "J", first: "F" };
    const wanted = (cabin ? [cabin] : cabins).map((c) => letter[c]).filter(Boolean);
    const out = rows.filter((r) => {
      const route = r.Route as { OriginAirport: string; DestinationAirport: string };
      if (origins.length && !origins.includes(route.OriginAirport)) return false;
      if (dests.length && !dests.includes(route.DestinationAirport)) return false;
      if (source && r.Source !== source) return false;
      if (sources.length && !sources.includes(String(r.Source))) return false;
      if (from && String(r.Date) < from) return false;
      if (to && String(r.Date) > to) return false;
      if (wanted.length && !wanted.some((L) => r[`${L}Available`] === true && (!direct || r[`${L}Direct`] === true))) return false;
      return true;
    });
    const page = out.slice(skip, skip + take);
    return json(200, { data: page, count: page.length, hasMore: skip + take < out.length, cursor: 1700000000 });
  }
  if (p.startsWith("/partnerapi/trips/")) {
    const id = p.slice("/partnerapi/trips/".length);
    const row = rows.find((r) => r.ID === id);
    if (!row) return json(404, {});
    const route = row.Route as { OriginAirport: string; DestinationAirport: string };
    const data = (trips.data as Record<string, unknown>[]).map((t, i) => ({
      ...t,
      AvailabilityID: id,
      Source: row.Source,
      Cabin: "first",
      MileageCost: Number(row.FMileageCost ?? row.JMileageCost ?? 70000) + i * 5000,
      RemainingSeats: Number(row.FRemainingSeats ?? 1),
      DepartsAt: `${row.Date}T13:00:00Z`,
      ArrivesAt: `${row.Date}T22:00:00Z`,
      AvailabilitySegments: [
        { ...(t.AvailabilitySegments as Record<string, unknown>[])[0], OriginAirport: route.OriginAirport, DestinationAirport: route.DestinationAirport, FlightNumber: "XX123", DepartsAt: `${row.Date}T13:00:00Z`, ArrivesAt: `${row.Date}T22:00:00Z`, Order: 0 },
      ],
      Stops: 0,
      FlightNumbers: "XX123",
      Carriers: String(row.FAirlines ?? row.JAirlines ?? "XX").split(",")[0]?.trim() ?? "XX",
    }));
    return json(200, { data, booking_links: [{ label: `Book via ${row.Source}`, link: "https://example.com/mock-booking", primary: true }] });
  }
  if (p === "/partnerapi/routes") {
    const source = url.searchParams.get("source");
    const seen = new Map<string, unknown>();
    for (const r of rows) {
      if (source && r.Source !== source) continue;
      const route = r.Route as { ID: string };
      seen.set(route.ID, r.Route);
    }
    return json(200, [...seen.values()]);
  }
  json(404, {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock seats.aero on http://127.0.0.1:${PORT}/partnerapi/ (fixture dates shifted by ${shiftDays} days; ${rows.length} rows)`);
});
