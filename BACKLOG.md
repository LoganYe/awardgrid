# BACKLOG

Ideas explicitly **out of scope** for v0.1.0 (§0.3 "never expand scope"). One line each.

- Deeplinks for programs other than AA (Alaska/Atmos Rewards, Aeroplan, United, Flying Blue, …): currently stubbed to the seats.aero booking URL or program homepage. (Decided: AA only in v1.)
- `cpp_desc` sort (cents-per-point) — needs a Duffel cash reference fare per cell; the `sort_by` type already reserves it.
- Release-window mode: see "Release-window mode" section below.
- Round-trip / multi-city queries (v1 is one-way grid only).
- Multiple passengers (`RemainingSeats` is shown; no pax filter).

## Release-window mode (documented, not built)

Most programs open award inventory ~330–360 days out at a fixed local time
(e.g. JAL ~10:00 JST, ANA ~09:00 JST, AA/Alaska ~331 days, United ~337 days).
A "release-window" standing query would, once a day just after the program's
release time, run Cached Search for only the newly opened date on each
monitored route — roughly **1 seats.aero call per route per day** — and push
the new cells immediately. Needs a per-program release-time table and a
worker schedule expressed in the program's local timezone.
