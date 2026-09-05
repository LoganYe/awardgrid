# awardgrid

Private, friends-only award-flight grid. One natural-language question
(Chinese or English) → one table of X origins × Y destinations × Z days,
each cell the cheapest award seat (miles · fees · seats left · program · freshness)
with a link to the program's own search page.

- Data: **seats.aero** Partner API — every user brings their **own** Pro key.
- Advisory "Ask" lane: Claude Agent SDK + the MIT-licensed
  [travel-hacking-toolkit](https://github.com/borski/travel-hacking-toolkit) (pruned, no credential skills).
- Non-commercial. No scraping. No shared keys. No logos. See `LEGAL.md`.

> Status: under construction — see `FINAL_REPORT.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
