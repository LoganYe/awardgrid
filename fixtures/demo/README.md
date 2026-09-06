# fixtures/demo — synthetic demo dataset

**Every value in this folder is invented.** No award price, seat count, tax, flight number,
timestamp or booking link here was observed on seats.aero or any airline. The numbers are
seeded pseudo-random noise (mulberry32, no `Math.random`) shaped to *look* like thirty days of
business- and first-class awards from Hong Kong, Shanghai, Tokyo and Seoul to Seattle, so the
UI, the screenshot suite and manual walks can run with **no network and no key**. Do not quote
anything from these files as a real redemption.

The shapes are the official Partner API ones (`src/lib/seatsaero/types.ts`); unit tests that
assert API correctness keep using the docs-derived fixtures in `test/fixtures/seatsaero/`.

## Files

| File | Served as | Contents |
|---|---|---|
| `availability.json` | `GET /partnerapi/search`, `/availability` | `{ _synthetic: true, _anchor: "2026-10-01", _generated_by, _query, data: Availability[] }` |
| `trips.json` | `GET /partnerapi/trips/{id}` | `{ [availabilityId]: TripsResponse }` — 2–3 trips with segments per availability |
| `routes.json` | `GET /partnerapi/routes?source=` | `{ [source]: Route[] }` — every monitored pair per program, `NumDaysOut` 330 |
| `generate.ts` | — | the deterministic generator (exports `generateDemo()`, `renderDemoFiles()`, the `DEMO_*` constants) |

Demo-only fields on availability rows (the app may ignore them; the schema is passthrough):

- `_demo_updated_minutes_ago` — freshness as minutes before "now" (20 min … 3 days). The mock
  rewrites `UpdatedAt` from it at serve time so the freshness spread is always relative to today.
- `_demo_dynamic: true` — a dynamic-priced row. The mock returns it **only** when
  `include_filtered=true`.

## Canonical query and shape

Origins HKG, PVG, SHA, NRT, HND, ICN → SEA; 30 consecutive days from the anchor `2026-10-01`
(the mock shifts every date so the first day == today); cabins J and F only; programs
`american`, `alaska`, `united`, `aeroplan`, `singapore`, `jetblue`, `flyingblue` (real seats.aero
source codes only, names as plain text). Per pair-day: J on ~45 %, F on ~15 %; 1–3 programs per
available pair-day; J 55k–120k and F 70k–160k miles, program-dependent; `RemainingSeats` 0–4
(0 = unknown); `Airlines` like `"AS"` or `"JL, AS"`; `Direct` mixed.

## Scenario keys (mock server, `DEMO=1`)

`pnpm demo` starts `scripts/mock-seatsaero.ts` on this dataset. The **value** of the
`Partner-Authorization` header selects a scenario, so an e2e harness seeds users with different
fake keys and never touches the app:

| Key | Behaviour |
|---|---|
| `demo-key-normal` (or any other non-empty value) | full dataset |
| `demo-key-empty` | `/search` and `/availability` answer 200 with `data: []` |
| `demo-key-error` | `/search` answers HTTP 500 `{}` |
| `demo-key-slow` | normal, every response delayed 1 500 ms (loading states) |
| `demo-key-partial` | `/search` omits every `aeroplan` row; `/routes?source=aeroplan` and `/availability?source=aeroplan` answer 500 ("one program not fetched") |

Cell states the dataset exercises: available (up to three programs), no availability (fetched,
empty pair-days), **not monitored** (ICN→SEA has no rows and is absent from every `/routes`
list), not fetched (`demo-key-partial`), filtered / dynamic (`_demo_dynamic` rows), loading
(`demo-key-slow`), and freshness from fresh (20 min) through aging to stale (3 days).

## Regenerate

```sh
pnpm exec tsx fixtures/demo/generate.ts
```

The output is byte-identical on every run; `scripts/demo-dataset.test.ts` fails if the committed
files drift from the generator. Change the seed or the constants in `generate.ts`, rerun, commit.
