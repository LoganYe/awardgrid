# Reference snapshots

Markdown snapshots of the official seats.aero Partner API reference pages that the code and
fixtures in this repository were built against, fetched 2026-09-06 from
`https://developers.seats.aero/reference/<page>.md` (append `.md` to any docs page URL).
`live-search.md` is intentionally not included: Live Search is out of scope (kickoff §0.2 #3;
Pro keys cannot use it).

Each file embeds the OpenAPI 3.1 definition; `test/fixtures/seatsaero/*.json` are the 200
examples extracted verbatim from these definitions. Re-fetch and diff these files when
seats.aero updates the API (`updatedAt` is in each file's front matter).
