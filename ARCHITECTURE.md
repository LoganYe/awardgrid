# awardgrid — ARCHITECTURE

Research-backed architecture notes. Every identifier below is copied verbatim from the referenced
documentation (local snapshots under `docs/reference/seatsaero/`, `code.claude.com/docs/en/agent-sdk/*.md`,
`platform.claude.com/docs/en/*.md`, npm registry metadata, and the vendored toolkit at
`vendor/travel-hacking-toolkit`, pinned at `258474343840fa5d3c4bd5be2b8b1de50e6a12e2`, 2026-08-31).
Anything not verified is labelled **UNVERIFIED** rather than guessed (§0.2 #7 of the kickoff prompt).

Resolution rule used throughout (kickoff §0.3): **docs win on API/SDK facts; the kickoff prompt wins on
scope and boundaries.** Every conflict is listed in §7 and mirrored in `DECISIONS.md`.

---

## 1. Overview — two lanes plus a scheduler

1. One Next.js (App Router) app + one `pnpm worker` process share a single SQLite file (Drizzle ORM).
2. **Fast lane (`find`)** is deterministic: NL text → deterministic parser → (only if dates/places are unresolved) one Claude Messages API call with a strict JSON-schema output → `QueryObject`.
3. `QueryObject` → seats.aero **Cached Search** (multi-airport, date range) or **Bulk Availability** (one program, region-wide) chosen by estimated call count → per-user cache (TTL 45 min) → pivot → grid.
4. The LLM never fetches award data; only the seats.aero client does, always with the **calling user's own** Pro key (no server key, per-user cache, per-user quota 1,000/day, hard stop at 950).
5. **Get Trips** runs only on cell expand; **Get Routes** (verified to exist, §2.4) marks unmonitored pairs as "not monitored by seats.aero".
6. **Slow lane (`ask`)** spawns one Claude Agent SDK `query()` subprocess per request with the pruned `travel-hacker` plugin loaded via `plugins: [{ type: "local", path }]` and that user's decrypted keys injected through the SDK `env` option (which *replaces* the subprocess environment).
7. The ask lane is read-only and advisory: `permissionMode: "dontAsk"`, explicit `allowedTools`, `maxTurns`, `maxBudgetUsd`, an `AbortController` 120 s timeout, and `total_cost_usd` accumulated per user per day ($2 cap).
8. **Scheduler**: `node-cron` (v4) in the worker re-runs saved `QueryObject`s (default every 3 h), diffs cells on `(program, origin, dest, date, cabin)`, and pushes Telegram messages to each user's own linked chat (quiet hours respected, quota-aware skipping).
9. Secrets: per-user keys AES-256-GCM encrypted with `MASTER_KEY`; UI shows last 4 only; keys never logged; gitleaks in CI.
10. Deploy: Docker Compose (app + worker + volume) behind Tailscale/Cloudflare Access — note Docker is **not installed on the development host**, so compose smoke is a "Needs human action" item.

---

## 2. Verified seats.aero endpoints

Common facts (verified in `cached-search.md`, `get-availability.md`, `get-trips.md`, `getting-started-p.md`, `overview.md`, `concepts-copy.md`):

- Server base URL: `https://seats.aero/partnerapi/` (OpenAPI 3.1.0, `info.title` "partner-api", version "1.0").
- Auth: API key in the HTTP header named exactly **`Partner-Authorization`** (securityScheme `sec0`, `type: apiKey`, `in: header`). **No `Bearer` prefix for personal Pro keys.** (`Bearer` is documented only for OAuth access tokens starting with `seats:ota`, which awardgrid does not use.)
- GET requests take query parameters; all responses are JSON. Only a `400` error response is documented (empty object `{}`); no 401/403/429 schemas exist in the docs.
- Terms: Pro users, **non-commercial only**, **up to 1,000 API calls per day at no cost**; key generated in the API tab of `https://seats.aero/settings`. The 1,000/day limit is **per user account**, shared across the personal key and any OAuth apps.
- **Live Search (`POST /live`) cannot be used by Pro users** (commercial agreement required) — out of scope by kickoff §0.2 #3 and by the docs.
- Pagination (Concepts, "All Seats.aero APIs"): first call without `cursor`; read `cursor` from the **first** response and pass it on every subsequent call; set `skip` = number of results already retrieved; stop when `hasMore` is false. `cursor` is currently a Unix timestamp — treat as an opaque int32. Objects may shift/duplicate across pages: **deduplicate by `ID`**.
- `min_cabin_pct` (int32 0–100, default 100) is accepted by Cached Search, Bulk Availability and Get Trips (not Live Search); default excludes any mixed-cabin distance; e.g. 75 permits up to 25% in a lower cabin. Trips may carry an optional `MixedCabinPct` (int32 1–100, "Percentage of the itinerary's distance flown below the reported Cabin. Omitted when no distance is flown below that cabin.").

### 2.1 Cached Search — `GET /search` (operationId `cached-search`)

Primary endpoint for the fast lane ("use Cached Search when you have specific airports and dates in mind, across all programs").

| Query param | Type | Required | Default | Documented meaning |
|---|---|---|---|---|
| `origin_airport` | string | **yes** | – | comma-delimited origins, e.g. `"SFO,LAX"` |
| `destination_airport` | string | **yes** | – | comma-delimited destinations, e.g. `"FRA,LHR"` |
| `start_date` | string | no | – | `YYYY-MM-DD`; results must depart between start_date and end_date |
| `end_date` | string | no | – | `YYYY-MM-DD` |
| `cursor` | int32 | no | – | cursor from a previous search call |
| `take` | int32 | no | 500 | max results; **must be >= 10 and <= 1000** |
| `order_by` | string | no | (date, then cabins) | only documented value: `lowest_mileage` (cheapest first). Default = departure date, then available cabins with premium ranked first |
| `skip` | int32 | no | – | how many results to skip |
| `include_trips` | boolean | no | false | populates `AvailabilityTrips`; "may degrade response time and sizing" |
| `only_direct_flights` | boolean | no | false | only results with a direct flight; respects the cabin parameter |
| `carriers` | string | no | – | comma-separated carrier codes e.g. `"DL,AA"` |
| `include_filtered` | boolean | no | false | "Return results that only have raw (filtered) results. Enable this when using the raw fields to prevent dynamic price filtering." |
| `sources` | string | no | – | comma-delimited program codes e.g. `"aeroplan,united"` |
| `minify_trips` | boolean | no | – | with `include_trips`, returns reduced trip fields |
| `cabins` | string | no | – | comma-delimited cabin names e.g. `"economy,business"`; "Must not be provided if \"cabin\" was provided" |
| `min_cabin_pct` | int32 0–100 | no | 100 | see common facts |

Not defined on this endpoint (despite the kickoff prompt): `cabin` (singular — referenced in three descriptions but not declared; it is declared only on Bulk Availability), `disable_live_filtering`. **awardgrid sends only the 16 parameters above.**

Response envelope (exact top-level fields): `data` (array), `count` (integer), `hasMore` (boolean), `cursor` (integer). No `moreURL`.

Fields consumed from each `data[]` item (the "Availability" object — one per route + departure date + program):

- Identity: `ID` (string; used for Get Trips and dedupe), `RouteID`, `Route` `{ ID, OriginAirport, OriginRegion, DestinationAirport, DestinationRegion, NumDaysOut (int), Distance (int), Source }`, `Date` (`"YYYY-MM-DD"`), `ParsedDate` (RFC3339), `Source` (program code).
- Per cabin, prefixes `Y` (economy) / `W` (premium economy) / `J` (business) / `F` (first): `{Y,W,J,F}Available` (boolean), `{Y,W,J,F}MileageCost` (**string**, e.g. `"12500"`, `"0"` when unavailable), `{Y,W,J,F}RemainingSeats` (integer, 0 when unknown), `{Y,W,J,F}Airlines` (string, comma+space separated e.g. `"AA, B6"`, `""` when none), `{Y,W,J,F}Direct` (boolean). The docs' own example contains rows where all five `F*` fields are `null` → **every per-cabin field is modelled as nullable**.
- Summary semantics (Concepts): `*MileageCost` = cheapest across flights that day, `*RemainingSeats` = max across flights.
- Timestamps: `CreatedAt`, `UpdatedAt` (strings, e.g. `"2023-07-10T13:52:23.343425Z"`).
- `AvailabilityTrips`: `array | null`; null unless `include_trips=true`; items use the Get Trips item schema.
- **Not present on Availability objects:** any taxes/fees field, any currency field, any booking link. `TotalTaxes` / `TaxesCurrency` / `booking_links[]` exist only on the Get Trips response. Consequence for the kickoff data model: `availability_cache.fees_cents`, `currency` and `booking_url` are **nullable and filled only after a cell is expanded** (Get Trips); an unexpanded cell renders fees as "—" and `sort_by: "fees_asc"` sorts only cells whose trips were fetched (others sink to the bottom). **Amended by #52:** what Get Trips priced is now written back onto that cell's cached row (`cacheFeesFromTrips`), so an expanded cell keeps its fee, currency and booking link for the life of the cached row — across renders, reloads and the CSV — instead of only for the render the drawer was open in. The columns are still filled ONLY by an expand (or an observed `{cabin}TotalTaxes`), and a Cached Search refresh rewrites the scope and takes the learned fee with it; the row's `computed_last_seen` is deliberately NOT touched by the write (DECISIONS "#52"). `include_trips=true` on Cached Search would populate fees in one call but "may degrade response time and sizing" — kept as an opt-in executor flag, off by default.

Call-count semantics: **not documented** beyond "1,000 API calls per day". awardgrid counts **every HTTP request** (each page, each retry that reaches the server) as one call. With `take=1000` an X×Y×92-day query is usually one page per pair-set; the executor paginates while `hasMore` is true and stops when the quota guard trips.

### 2.2 Bulk Availability — `GET /availability` (operationId `get-availability`)

"Use this endpoint for broad availability searches across regions. If you have specific airports and dates in mind, you should use Cached Search instead." Exactly one program per call.

| Query param | Type | Required | Default | Documented meaning |
|---|---|---|---|---|
| `source` | string | **yes** | – | the mileage program |
| `cabin` | string | no | – | one of `economy`, `premium`, `business`, `first` |
| `start_date` / `end_date` | string | no | – | "Only returns results between start_date and end_date when specified" (format not stated here; Cached Search says `YYYY-MM-DD`) |
| `origin_region` / `destination_region` | string | no | – | one of `North America`, `South America`, `Africa`, `Asia`, `Europe`, `Oceania` (URL-encode the space) |
| `take` | int32 | no | 500 | >= 10 and <= 1000 |
| `cursor` | int32 | no | – | from previous response |
| `skip` | int32 | no | 0 | results already retrieved |
| `include_filtered` | boolean | no | false | same wording as Cached Search |
| `min_cabin_pct` | int32 0–100 | no | 100 | |

Response: the OpenAPI 200 schema is **empty** (`properties: {}`, example `{}`); prose says "Similar to Cached Search, this endpoint returns an array of summary availability objects." awardgrid parses Bulk responses with the **same lenient Availability zod schema as Cached Search** (`{ data, count, hasMore, cursor }`) and treats any deviation found in smoke fixtures as a recorded gap. Local filtering to the query's airports/dates happens after fetch.

Call-count semantics: one call per page; the executor picks Bulk when `programs.length × pages(Bulk)` < estimated Cached Search pages (e.g. many origin×destination pairs within one region for one program).

### 2.3 Get Trips — `GET /trips/{id}` (operationId `get-trips`)

- Path `id` (string, required) = `Availability.ID` from Cached Search or Bulk Availability.
- Query: `include_filtered` (boolean, default false: "Include expensive dynamically-priced results that may have been filtered out."), `min_cabin_pct` (int32 0–100, default 100).
- 200 body: `{ data: Trip[], origin_coordinates: {Lat, Lon}, destination_coordinates: {Lat, Lon}, booking_links: [{ label: string, link: string, primary: boolean }] }`. 404 has an empty body.
- Trip fields consumed: `ID`, `RouteID`, `AvailabilityID`, `Cabin` (e.g. `"business"`), `MileageCost` (**integer** here, unlike the string on Availability), `TotalTaxes` (integer; Concepts example: 70,000 miles + $12.90 ⇔ `TotalTaxes: 1290`, so minor units by example — the unit is not stated in the schema), `TaxesCurrency` (string, may be `""`), `TaxesCurrencySymbol`, `AllianceCost`, `RemainingSeats`, `Stops`, `TotalDuration` (integer; **unit not documented** — the toolkit says minutes, the example does not reconcile cleanly), `Carriers` (`"CM, TK"`), `FlightNumbers` (`"CM326, TK800"`), `DepartsAt`, `ArrivesAt`, `Source`, optional `MixedCabinPct`, `AvailabilitySegments[]` (`FlightNumber`, `Distance`, `FareClass`, `AircraftName`, `AircraftCode`, `OriginAirport`, `DestinationAirport`, `DepartsAt`, `ArrivesAt`, `Order`, `Source`, ids).
- Time semantics (Concepts): `DepartsAt`/`ArrivesAt` carry a `Z` suffix but are **airport local times** — never convert them as UTC.
- `booking_links[]` is per-availability (top level), `primary: true` marks the sourcing program → used as the "Open in program" deeplink when present (kickoff §4.4), AA parameterized link otherwise.
- Not all programs return trip data or seat counts (Concepts) → empty `data` is a valid state ("no flight-level detail from this program").
- Call count: one call per expand; cached per `Availability.ID` for the same TTL.

### 2.4 Get Routes — `GET /routes` (operationId `get-routes-1`)

**Verified to exist**, but with caveats: it is served at `https://developers.seats.aero/reference/get-routes-1.md` (HTTP 200, text/markdown) yet is **not listed in `https://developers.seats.aero/llms.txt`** and is not referenced by any other doc page. The probe URLs `reference/routes.md`, `reference/get-routes.md`, `reference/routes-1.md` all 404. The local snapshot once returned a Cloudflare "Hello there, human!" challenge page; a browser-like `User-Agent` fixed it. The toolkit `seats-aero` skill documents and uses it (`curl ... "https://seats.aero/partnerapi/routes?source=united"`).

- Query: `source` (string, **required**).
- 200: a **bare JSON array** (no `data` wrapper, no pagination fields) of `{ ID, OriginAirport, OriginRegion, DestinationAirport, DestinationRegion, NumDaysOut (int), Distance (int), Source }`. 400 returns `{}`.
- Usage: one call per program per day (cached 24 h per user; `NumDaysOut` also tells how far out that route is monitored). A pair absent from every selected program's route list renders as "not monitored by seats.aero" instead of a blank cell.
- **Fallback design** (because the endpoint is unindexed and could disappear): the route cache is optional. If `/routes` returns non-200 or non-array, the client marks the route table "unavailable", and the grid falls back to the Cached Search signal alone — a cell with zero Availability objects across all selected programs is labelled "no cached data (route monitoring unknown)" rather than "not monitored". `NumDaysOut` is only an integer in the docs; whether a date beyond `NumDaysOut` is "not yet monitored" is **UNVERIFIED** and is shown only as a hint.

### 2.5 Sources table (Concepts, updated 2026-08-28; 26 rows)

Cabin letters: Y=economy, W=premium, J=business, F=first.

| Source | Program | Cabins | Seat count | Trip data |
|---|---|---|---|---|
| `eurobonus` | SAS EuroBonus | Y/J | Yes | Yes |
| `virginatlantic` | Virgin Atlantic Flying Club | Y/W/J | Yes | Yes |
| `aeromexico` | Aeromexico Club Premier | Y/W/J | Yes | Yes |
| `american` | American Airlines | Y/W/J/F | No** | Yes |
| `delta` | Delta SkyMiles | Y/W/J | Yes | Yes |
| `etihad` | Etihad Guest | Y/J/F | Yes | Yes |
| `united` | United MileagePlus | Y/W/J/F | Yes | Yes |
| `emirates` | Emirates Skywards | Y/W/J/F | No | Yes* |
| `aeroplan` | Air Canada Aeroplan | Y/W/J/F | Yes† | Yes |
| `alaska` | Alaska Mileage Plan | Y/W/J/F | Yes | Yes |
| `velocity` | Virgin Australia Velocity | Y/W/J/F | Yes | Yes |
| `qantas` | Qantas Frequent Flyer | Y/W/J/F | No | Yes |
| `connectmiles` | Copa ConnectMiles | Y/J/F | No | Yes |
| `azul` | Azul TudoAzul | Y/J | No | Yes |
| `smiles` | GOL Smiles | Y/W/J/F | Yes | Yes |
| `flyingblue` | Air France/KLM Flying Blue | Y/W/J/F | Yes | Yes |
| `jetblue` | JetBlue TrueBlue | Y/W/J/F | Yes | Yes |
| `qatar` | Qatar Privilege Club | Y/J/F | No | Yes*** |
| `turkish` | Turkish Miles & Smiles | Y/J | No | Yes*** |
| `singapore` | Singapore KrisFlyer | Y/W/J/F | No | Yes*** |
| `ethiopian` | Ethiopian ShebaMiles | Y/J | Yes | Yes |
| `saudia` | Saudi AlFursan | Y/J/F | Yes | Yes |
| `finnair` | Finnair Plus | Y/WJ/F (sic) | Yes | Yes |
| `lufthansa` | Lufthansa Miles&More | Y/J/F | Yes | Yes |
| `frontier` | Frontier Airlines | Y | No | Yes |
| `spirit` | Spirit Airlines | Y | Yes | Yes |

Footnotes: `*` connections may have missing fields; `**` seat counts only sometimes provided when low, otherwise 0; `***` taxes/surcharges not available; `†` seat count typically available, rarely zero. `lifemiles` appears only in example JSON, not in the table — the `programs` list in awardgrid is **not** validated against a closed enum; unknown codes returned by the API are displayed as-is.

### 2.6 Freshness and filtered semantics

- The **only** timestamp fields on Availability objects are `CreatedAt` and `UpdatedAt` (plain strings; RFC3339 is inferred from the examples). No `ComputedLastSeen`, `LastSeen`, "freshness" or "stale" field exists in the official docs (the toolkit skill mentions `ComputedLastSeen`, the OpenAPI does not). **awardgrid's `availability_cache.computed_last_seen` column is populated from `UpdatedAt`**; if a smoke fixture shows a `ComputedLastSeen` field on the live API it is recorded in the fixture and may be preferred later (logged gap, not assumed).
- Freshness displayed = `now − UpdatedAt` ("2h ago"), colour-coded, visibly stale beyond 6 h (kickoff §4.4).
- Dynamic price filtering: expensive dynamically-priced options are removed by default. The UI toggle "include filtered (dynamically-priced) results" maps to `include_filtered=true` on Cached Search / Bulk Availability / Get Trips. No `*Raw` field names are defined anywhere in the docs despite the "raw fields" wording — nothing in awardgrid reads a `*Raw` field. `disable_live_filtering` does not exist.
- Mixed cabin: `min_cabin_pct` is left at its default (100) in v1; exposed as an advanced setting later (`BACKLOG.md`).

### 2.7 Quota policy

- Limit: **1,000 calls/day per seats.aero Pro key/account** (shared with any OAuth apps on that account). awardgrid stops issuing calls for a user at **950** and shows a friendly message with the reset time.
- Counting: every HTTP request to `seats.aero/partnerapi/*` for that user (search pages, bulk pages, trips, routes, and the one validation call when a key is saved) increments `api_usage(user_id, provider='seats_aero', day, calls)`.
- Reset boundary: **UNVERIFIED** — the docs never state when the daily window resets nor what an over-quota response looks like (no 429 semantics, no rate-limit headers, no per-second limit documented). awardgrid counts per **UTC calendar day** and labels the displayed reset time "assumed 00:00 UTC".
- Only documented quota nuance is for Live Search (failed live searches not counted) — irrelevant here.
- Cache TTL 45 min (env `CACHE_TTL_MINUTES`) makes grid re-renders and standing queries reuse pulls; Get Routes cached 24 h; Get Trips cached for the TTL keyed by `Availability.ID`.
- Test-key budget for the whole build run: ≤ 40 calls (kickoff §0.4) — smoke plan: 1 validation, ≤ 3 Cached Search pages, 1 Bulk page, 1 Get Trips, 1 Get Routes, rest reserved.

---

## 3. Verified Claude Agent SDK options (TypeScript)

Package: `@anthropic-ai/claude-agent-sdk` (npm latest **0.3.261**, `engines.node >=18.0.0`). Docs live at `https://code.claude.com/docs/en/agent-sdk/*.md` (the `platform.claude.com/docs/en/agent-sdk/*` URLs in the kickoff prompt 307-redirect there). The SDK bundles the Claude Code binary as a platform optional dependency (e.g. `@anthropic-ai/claude-agent-sdk-darwin-arm64`), so **never install with `--omit=optional`**; SDK version tracks the bundled Claude Code version (0.3.191 ↔ 2.1.191). `ANTHROPIC_API_KEY` is read from the process environment; `.env` files are not auto-loaded.

Signature: `query({ prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query` where `Query extends AsyncGenerator<SDKMessage, void>`. One `query()` = one `claude` subprocess over stdio.

| Concern | Exact option / field | Verified value / shape | awardgrid use |
|---|---|---|---|
| Local plugin | `plugins: SdkPluginConfig[]` | `type SdkPluginConfig = { type: "local"; path: string; skipMcpDiscovery?: boolean }`; `type` must be `"local"`; path absolute or relative to cwd, tilde **not** expanded, must be the plugin **root** (parent of `skills/`, `agents/`, `hooks/`, `commands/`, `.claude-plugin/`); a nonexistent path is **silently skipped** | `plugins: [{ type: "local", path: "<abs>/build/plugin", skipMcpDiscovery: true }]` |
| Plugin MCP | `skipMcpDiscovery: true` | loads skills/hooks/agents/commands but does not read the plugin's `.mcp.json` or manifest `mcpServers` | awardgrid owns MCP connections |
| Subprocess env | `env: Record<string, string \| undefined>` (default `process.env`) | **Replaces** the subprocess environment (no merge); spread `...process.env` to keep `PATH`/`ANTHROPIC_API_KEY`. (Python SDK merges — different semantics.) | per-user keys injected here (§3.2) |
| Pre-approve tools | `allowedTools: string[]` (default `[]`) | auto-approves listed tools; **does not restrict** Claude to them; unlisted tools fall through to `permissionMode`/`canUseTool` | list of read-only tools + `Skill` |
| Remove/deny tools | `disallowedTools: string[]` (default `[]`) | bare name (e.g. `"Bash"`) removes the tool from context; scoped rule (e.g. `"Bash(rm *)"`) denies matching calls in every mode | remove `Write`, `Edit`, `NotebookEdit`, `Task`-style tools |
| Tool set | `tools: string[] \| { type: "preset"; preset: "claude_code" }` | sets the tool set itself; if `skills` is set and `tools` is passed, include `"Skill"` | |
| MCP servers | `mcpServers: Record<string, McpServerConfig>` (default `{}`) | `McpHttpServerConfig = { type: "http"; url: string; headers?: Record<string,string> }`; `McpSSEServerConfig = { type: "sse"; url; headers? }`; `McpStdioServerConfig = { type?: "stdio"; command: string; args?: string[]; env?: Record<string,string> }`; `McpSdkServerConfigWithInstance = { type: "sdk"; name; timeout?; instance }` | the 4 kept remote servers as `type: "http"` (§6) |
| Only our MCP | `strictMcpConfig: boolean` (default false) | use only servers in `mcpServers`; ignore project `.mcp.json`, user settings, plugin-provided servers and claude.ai connectors (`mcpServers: {}` alone does **not** suppress connectors) | `strictMcpConfig: true` |
| MCP tool names | — | `mcp__<server>__<tool>`; docs example pre-approves with `allowedTools: ["mcp__api-server__*"]` (mcp.md); plugin-bundled servers would be `mcp__plugin_<plugin>_<server>__<tool>` (unused since we pass servers ourselves) | `allowedTools` entries `mcp__kiwi__*` etc. |
| Permission mode | `permissionMode: PermissionMode` (default `"default"`) | `"default" \| "acceptEdits" \| "bypassPermissions" \| "plan" \| "dontAsk" \| "auto"`; `dontAsk` denies anything not pre-approved without calling `canUseTool`; evaluation order hooks → deny → ask → mode → allow → `canUseTool` | `"dontAsk"` |
| Prompt fallback | `permissionPrompts: "host" \| "none"` (default `"host"`) | `"none"` denies calls that would prompt; requires Claude Code ≥ 2.1.259 (bundled 2.1.261 by the tracking rule — **UNVERIFIED** until init prints `claude_code_version`) | `"none"` |
| Turn cap | `maxTurns: number` | result `subtype: "error_max_turns"` when hit; the **only** built-in bound (no wall-clock timeout) | 12 |
| Cost cap | `maxBudgetUsd: number` | stops when the client-side estimate reaches the value; result `subtype: "error_max_budget_usd"`, `terminal_reason: "budget_exhausted"` | `min(0.50, dailyRemaining)` |
| Cost readout | result `total_cost_usd: number` (success **and** error arms); `modelUsage: { [model]: ModelUsage }`; `usage: NonNullableUsage` | `usage` = main loop only; prefer `modelUsage` (`inputTokens, outputTokens, thinkingTokens?, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens, costBasis?`); no session-level total — accumulate across `query()` calls yourself; estimates, not billing | `api_usage` accumulation per user per UTC day |
| Result message | `type: "result"`; success arm `subtype: "success"` with `result: string, num_turns, duration_ms, duration_api_ms, is_error, stop_reason, permission_denials, structured_output?, terminal_reason?`; error arm `subtype: "error_max_turns" \| "error_during_execution" \| "error_max_budget_usd" \| "error_max_structured_output_retries"` with `errors: string[]` and **no `result`** | a single-shot `query()` yields the error result **then throws** → wrap the `for await` in try/catch; process-launch failure yields no result message | |
| Init message | `type: "system"`, `subtype: "init"`: `session_id, cwd, model, permissionMode, tools: string[], mcp_servers: {name, status}[], skills: string[], plugins: {name, path}[], slash_commands: string[], agents?, apiKeySource, claude_code_version, output_style, capabilities?` | `plugins[].path` is absolute; plugin skills appear as `"<plugin>:<skill>"` in `skills` and `slash_commands`; `skills` lists user-invocable skills only (skills.md); `mcp_servers[].status ∈ "pending" \| "connected" \| "failed" \| "needs-auth" \| "disabled"` (`pending` is not failure) | Phase-4 assertion: no pruned skill in `skills`/`slash_commands`; every kept server not `failed` |
| Skill allowlist | `skills: string[] \| "all"` | exact names, `plugin:skill` form for plugin skills; **no wildcards** (`"docs:*"` throws before spawn, ≥ 0.3.221); `[]` = none; setting it auto-adds `Skill` to `allowedTools`. Unlisted skills are hidden from the model and rejected by the Skill tool, but their files stay readable and `/name` as the prompt still dispatches them → **allowlist is defense-in-depth; physical pruning is the primary control** | exact list of the 27 kept skills |
| Abort / timeout | `abortController: AbortController` (default `new AbortController()`); `Query.close(): void` | on abort the SDK closes stdin, waits ~2 s, then kills; `AbortError` is the only typed error class | `setTimeout(() => ac.abort(), 120_000)` + `close()` on client disconnect |
| API timeouts (env) | `API_TIMEOUT_MS` (default 600000), `CLAUDE_CODE_MAX_RETRIES` (default 10, cap 15), `CLAUDE_STREAM_IDLE_TIMEOUT_MS` (default 300000), `MCP_TIMEOUT` (30 s), `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` (25k) | passed in `env` | `API_TIMEOUT_MS: "90000"`, `CLAUDE_CODE_MAX_RETRIES: "2"` |
| Streaming | `includePartialMessages: boolean` (default false) | emits `SDKPartialAssistantMessage` `{ type: "stream_event"; event: BetaRawMessageStreamEvent; parent_tool_use_id; uuid; session_id; ttft_ms? }`; text at `event.type === "content_block_delta" && event.delta.type === "text_delta"` → `event.delta.text`; tool input via `input_json_delta`/`partial_json`; main session only | SSE to the Ask drawer |
| Model | `model: string` (alias or full name; default from CLI), `fallbackModel: string` | | `claude-sonnet-5` (§4) |
| Thinking/effort | `thinking: { type: "adaptive" } \| { type: "enabled"; budgetTokens? } \| { type: "disabled" }`; `effort: "low" \| "medium" \| "high" \| "xhigh" \| "max"` (`maxThinkingTokens` deprecated) | | default adaptive |
| System prompt | `systemPrompt: string \| string[] \| { type: "preset"; preset: "claude_code"; append?: string; excludeDynamicSections?: boolean }` (default undefined = minimal prompt) | `outputStyle` is **not** an Options field | custom string: search/compare/explain only |
| Sessions | `persistSession: boolean` (default true); `cwd` (default `process.cwd()`); `resume`, `sessionStore` | transcripts land in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects`) | `persistSession: false`, per-request `cwd` |
| Settings isolation | `settingSources: SettingSource[]`, `SettingSource = "user" \| "project" \| "local"`; omitted = all three | `[]` skips user/project/local settings, but `~/.claude.json` and auto memory still load → also set env `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1"` and a per-tenant `CLAUDE_CONFIG_DIR`; claude.ai connectors need `strictMcpConfig: true` / `ENABLE_CLAUDEAI_MCP_SERVERS=false` | `settingSources: []` |
| Structured output (SDK) | `outputFormat: { type: "json_schema"; schema: JSONSchema }` → `structured_output` on the success result; draft-07 only (`z.toJSONSchema(S, { target: "draft-7" })`) | not used by the parser (which uses the Messages API directly, §5) | — |

### 3.1 The `settingSources` gotcha

Filesystem skills (`~/.claude/skills`, `<cwd>/.claude/skills`) are discovered only through `settingSources` `"user"`/`"project"`; `settingSources: []` + `skills: "all"` loads **no** filesystem skills. The docs offer `plugins` as the alternative ("or use the `plugins` option to load skills from a specific path") and every plugins example passes no `settingSources`, but **no page states explicitly that plugin skills survive `settingSources: []`**. awardgrid therefore:

1. runs with `settingSources: []` and asserts at startup (and in the Phase-4 test) that the init message's `plugins` contains `{ name: "travel-hacker", path: "<abs>/build/plugin" }` and `skills` contains `"travel-hacker:seats-aero"`;
2. if that assertion fails, falls back to `settingSources: ["project"]` with a per-request empty `cwd` (no `.claude/`, no `CLAUDE.md`, no `.mcp.json`) so nothing from the host leaks in — recorded as a decision either way.

Also: a project `.mcp.json` loads only when `"project"` is enabled; with `strictMcpConfig: true` it is ignored regardless.

### 3.2 Per-user env isolation (ask lane)

The toolkit reads keys from the **shell environment** (README: plugin `userConfig` "doesn't propagate to skills that shell out"), and its agent prompt runs `echo "${SEATS_AERO_API_KEY:+set}${SEATS_AERO_API_KEY:-unset}"` before curl. So the key must be in the Bash tool's environment, which is the subprocess environment set by `env`. Per request:

```ts
env: {
  PATH: process.env.PATH, HOME: sessionHome, TMPDIR: sessionTmp,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_CONFIG_DIR: sessionConfigDir, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  API_TIMEOUT_MS: "90000", CLAUDE_CODE_MAX_RETRIES: "2",
  SEATS_AERO_API_KEY: decrypted.seats_aero,           // this user only
  ...(decrypted.duffel && { DUFFEL_API_KEY_LIVE: decrypted.duffel }),
  ...(decrypted.ignav && { IGNAV_API_KEY: decrypted.ignav }),
}
```

Because `env` replaces (not merges), nothing else from the server process — including other users' keys, which are never in `process.env` anyway — reaches the session. One subprocess per request, `persistSession: false`, per-request `cwd`/`CLAUDE_CONFIG_DIR` under a temp dir deleted afterwards. The two-user isolation test spawns two sessions and asserts each Bash `printenv SEATS_AERO_API_KEY` (via a test-only skill) sees only its own last-4. Whether stdio MCP child processes inherit this env is not stated in the docs (per-server `env` exists on `McpStdioServerConfig`); awardgrid uses only `http` servers, so it does not matter.

### 3.3 Plugin directory layout to build (`build/plugin/`)

```
build/plugin/
├── .claude-plugin/plugin.json     # { "name": "travel-hacker", "version": "1.1.0", ... } copied verbatim (name kept → namespace travel-hacker:*)
├── skills/<kept-skill>/SKILL.md   # 27 dirs, symlinks resolved into real copies (§6)
├── data/*.json                    # 16 files copied from the vendored repo ROOT (skills reference data/<file>.json root-relative)
└── LICENSE                        # MIT, Michael Borohovski (attribution obligation)
```

Deliberately **absent**: `agents/` (the `travel-hacker` agent pins `model: opus`, hard-requires skills and references Docker portal skills — the ask lane supplies its own `systemPrompt`), `.mcp.json` (servers passed via `mcpServers` + `skipMcpDiscovery: true`), `commands/`, `hooks/`, `scripts/` (python helpers only used by pruned skills), `plugins/` (Codex copy), `.env.example`, `trips/`. `name` is the only required manifest field (kebab-case); components are auto-discovered from `skills/`. The SDK uses `plugin.json` `name` as the namespace prefix → skills are `travel-hacker:<dir-name>` (user-invoked ones like `travel-hacker:plan-trip` carry `disable-model-invocation: true`).

---

## 4. Chosen model IDs

Source: `platform.claude.com/docs/en/models/overview.md`, `about-claude/pricing.md`, `about-claude/model-deprecations.md` (fetched 2026-09-06; quoted, not independently re-verified). Current non-legacy lineup is exactly `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`).

| Role | Model ID (default) | Price (input / output per MTok) | Context / max output | Why | Env override |
|---|---|---|---|---|---|
| **NL parser** (fast lane, single structured-output call) | `claude-haiku-4-5-20251001` | $1 / $5 (cache: 5m write $1.25, 1h write $2, hit $0.10; batch $0.50/$2.50) | 200K / 64K | Cheapest currently available model (Haiku 3.5 is retired); supports `output_config.format`; older tokenizer (fewer tokens than 4.7+ models). Escalate to `claude-sonnet-5` only if the bilingual fixture suite fails. Retirement not sooner than 2026-10-15 — the nearest horizon of any current model, so the env override matters. `temperature` etc. still allowed but unused. | `AWARDGRID_PARSER_MODEL` |
| **Ask lane** (Agent SDK `model`) | `claude-sonnet-5` | $2 / $10 (now permanent; the Sept-1 increase to $3/$15 was cancelled; cache $2.50 / $4 / $0.20) | 1M / 128K | Current mid-tier ("best combination of speed and intelligence"), adaptive thinking, default effort `high`; dateless 4.6+-style ID is a pinned snapshot, not an alias. `temperature`/`top_p`/`top_k` non-default → 400 on 4.7+ — never set them. | `AWARDGRID_ASK_MODEL` |

Env var names `AWARDGRID_PARSER_MODEL` / `AWARDGRID_ASK_MODEL` are awardgrid's own choice (kickoff §2: "both via env with these as defaults"). Frontier models (`claude-opus-5` $5/$25, `claude-fable-5-1` $10/$50) are not used. The `$2/day` ask cap ≈ 200K input + 100K output Sonnet 5 tokens per user per day.

---

## 5. NL parser — Messages API structured output

Mechanism (GA, no beta header): request field **`output_config.format`** = `{ "type": "json_schema", "schema": { ...JSON Schema... } }`. The JSON arrives in the response's `text` content block. The kickoff prompt's `output_format` top-level field and the `anthropic-beta: structured-outputs-2025-11-13` header are the **deprecated** transition-period forms — not used.

TypeScript (`@anthropic-ai/sdk`):

```ts
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema"; // or zodOutputFormat from "@anthropic-ai/sdk/helpers/zod"
const res = await client.messages.parse({
  model: process.env.AWARDGRID_PARSER_MODEL ?? "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  system: SYSTEM_WITH_PLACES_SEED,
  messages: [{ role: "user", content: text }],
  output_config: { format: jsonSchemaOutputFormat(QUERY_SCHEMA as const) },
});
// res.parsed_output is typed | null; always check res.stop_reason first
```

Schema rules that constrain `QueryObject` minus `raw_text`/`language`:

- every object needs `additionalProperties: false` and `required`; supported: basic types, `enum` (primitives), `const`, `anyOf`, `$ref`/`$defs`, `default`, string formats incl. `date` (used for `date_from`/`date_to`), array `minItems` 0 or 1 only;
- **not** supported (400): `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`, recursive schemas, other array constraints → `origins.min(1)` and the 92-day cap are enforced by zod **after** parsing, not in the API schema; `max_miles` is a plain integer;
- limits per request: ≤ 24 optional parameters, ≤ 16 union-typed (`anyOf`/`["string","null"]`) parameters — the parser schema has 4 optional fields;
- output may still not conform when `stop_reason` is `"refusal"` (HTTP 200, billed) or `"max_tokens"`; `enum` capitalization is not guaranteed → compare cabin/sort enums case-insensitively, then validate with zod; one retry on failure, then a clear error (kickoff §4.2);
- changing the schema invalidates the prompt cache; grammars compile once (cached 24 h from last use) — the schema is a module constant.

The SDK default transform (`jsonSchemaOutputFormat(schema)`) strips unsupported constraints and adds `additionalProperties: false` automatically; `{ transform: false }` sends it unchanged. Supported models include both `claude-haiku-4-5-20251001` and `claude-sonnet-5`.

---

## 6. Toolkit plugin build (`scripts/build-plugin.ts`)

**Where the real Claude Code plugin lives:** the vendored **repo root** — `vendor/travel-hacking-toolkit/.claude-plugin/plugin.json` declares `"name": "travel-hacker"`, `"version": "1.1.0"`, and `.claude-plugin/marketplace.json` uses source `"./"`; README: `claude --plugin-dir .` loads skills + MCP servers + the `travel-hacker` subagent. The path named in the kickoff prompt, `plugins/travel-hacking-toolkit/`, is the **Codex** plugin (`.codex-plugin/plugin.json`, name `travel-hacking-toolkit`). In the pinned checkout the real skills directory is `plugins/travel-hacking-toolkit/skills` (48 entries) and the root `skills` is a git **symlink** (mode 120000) to it (`.claude/skills` and `.agents/skills` symlink to `../skills`); the README diagram shows the reverse. `data/` (16 JSON files) and `scripts/` live at the repo root, and skills reference `data/<file>.json` root-relative. The manifest has no `skills`/`agents`/`mcpServers` keys — discovery is by convention.

Build steps: copy from the repo root **following symlinks**, keep only the allowlisted skill dirs, copy `data/` and `LICENSE`, copy `.claude-plugin/plugin.json`, write nothing else. The exclusion list is explicit in the script and asserted by a test that walks `build/plugin/skills` and greps every kept SKILL.md for `docker`, `patchright`, `agent-browser`, `_USERNAME`, `_PASSWORD`, `printenv`.

### 6.1 Prune list (21 skills) with reasons

| Skill | Reason |
|---|---|
| `american-airlines` | Docker (`ghcr.io/borski/aa-miles-check`) + Patchright against aa.com; reads `AA_USERNAME`, `AA_PASSWORD`, `AA_2FA_COMMAND` |
| `amex-travel` | Docker + Patchright portal; `AMEX_USERNAME`, `AMEX_PASSWORD`, `AMEX_2FA_COMMAND`, `AMEX_PROFILE` |
| `chase-travel` | Docker + Patchright portal; `CHASE_USERNAME`, `CHASE_PASSWORD`, `CHASE_2FA_COMMAND`, `CHASE_PROFILE` |
| `southwest` | Docker (`ghcr.io/borski/sw-fares`) + Patchright against southwest.com; `SW_USERNAME`, `SW_PASSWORD`; `allowed-tools Bash(docker *)` |
| `ticketsatwork` | Docker + Patchright; `TAW_USER`, `TAW_PASS` |
| `vrbo` | Docker + Patchright (Akamai bypass); `VRBO_IN_DOCKER`, `VRBO_PROFILE` |
| `sutochno` | Docker + Patchright; `SUTOCHNO_IN_DOCKER` |
| `google-flights` | `agent-browser` browser automation of google.com/travel/flights (scraping) |
| `seatmaps` | `agent-browser` automation of seatmaps.com (scraping) |
| `atlas-obscura` | shells to `node skills/atlas-obscura/ao.mjs`, which runs `npm install` at runtime and scrapes atlasobscura.com |
| `deutsche-bahn` | shells to `node skills/deutsche-bahn/scripts/search_trains.mjs` (needs `npm install` of `db-vendo-client`); out of scope (rail) |
| `getting-started` | runs `printenv` over the key list (would echo key values into the transcript); host-setup instructions irrelevant when hosted |
| `gardening` | reads an arbitrary user-supplied local file path |
| `trip-log` | writes `trips/logs/*.md` into the cwd |
| `awardwallet` | needs `AWARDWALLET_API_KEY`/`AWARDWALLET_USER_ID`, IP-allowlisted Business API; provider not in `user_keys` enum |
| `rapidapi` | needs `RAPIDAPI_KEY` (not a supported provider) |
| `serpapi` | needs `SERPAPI_API_KEY` (not a supported provider) |
| `tripadvisor` | needs `TRIPADVISOR_API_KEY`; hotels/reviews out of scope |
| `scandinavia-transit` | needs `ENTUR_CLIENT_NAME`, `RESROBOT_API_KEY`, `REJSEPLANEN_API_KEY`; rail out of scope |
| `round-the-world` | shells to `python3 scripts/calc_distance.py`; `scripts/` is not shipped and python3 is not a runtime dependency of the image |
| `compare-hotels` | orchestrates the Airbnb MCP (`--ignore-robots-txt`) and VRBO Docker skill, both dropped; hotels out of scope |

### 6.2 Kept skills (27)

`alliances`, `award-calendar`, `award-holds`, `award-sweet-spots`, `bilt` (public unauthenticated `api.biltrewards.com`, `Bash(curl *)`, `Bash(jq *)`), `booking-guidance`, `cabin-codes`, `compare-flights` (reference; mentions Docker portals as optional — the system prompt states those are unavailable), `duffel`, `fallback-and-resilience`, `flight-search-strategy` (mandatory per the toolkit's own workflow), `hotel-chains`, `ignav`, `lessons-learned` (mandatory), `partner-awards`, `plan-trip` (user-invoked, `disable-model-invocation: true`), `points-valuations`, `premium-hotels`, `seats-aero`, `status-match`, `stopovers`, `transfer-bonuses` (data read only; its `python3 scripts/refresh-transfer-bonuses.py` refresh cannot run because `scripts/` is not shipped — documented in the system prompt), `transfer-partners`, `trip-calculator`, `trip-planner`, `wheretocredit` (fetches wheretocredit.com HTML, no key), `wikipedia-airports` (curl to the Wikipedia API).

Known dangling reference inside kept skills: `seats-aero`, `award-calendar`, `trip-calculator` mention a `seats-aero-web` skill (Patchright) that does not exist in the checkout — harmless. `award-calendar` uses `cabin=` on `/search` where the OpenAPI defines `cabins=` — the ask lane may issue a non-spec parameter; the fast lane never does.

### 6.3 MCP servers

Repo-root `.mcp.json` defines six servers. Kept (all `type: "http"`, no keys), passed via SDK `mcpServers`:

| name | url |
|---|---|
| `skiplagged` | `https://mcp.skiplagged.com/mcp` |
| `kiwi` | `https://mcp.kiwi.com` |
| `trivago` | `https://mcp.trivago.com/mcp` |
| `ferryhopper` | `https://mcp.ferryhopper.com/mcp` |

Dropped: `liteapi` (`https://mcp.liteapi.travel/api/mcp`, header `Authorization: Bearer ${LITEAPI_API_KEY:-unset}` — needs a key awardgrid does not manage) and `airbnb` (stdio `npx -y @openbnb/mcp-server-airbnb@latest --ignore-robots-txt` — runtime `npx` install plus a robots.txt bypass, i.e. scraping).

### 6.4 Env vars read by kept skills and runtime deps

| Env var | Read by | Header |
|---|---|---|
| `SEATS_AERO_API_KEY` | `seats-aero`, `award-calendar` | `Partner-Authorization: $SEATS_AERO_API_KEY` |
| `DUFFEL_API_KEY_LIVE` | `duffel` | `Authorization: Bearer $DUFFEL_API_KEY_LIVE` + `Duffel-Version: v2` |
| `IGNAV_API_KEY` | `ignav` | `X-Api-Key: $IGNAV_API_KEY` |

No kept skill ships a script: the `seats-aero` directory contains only `SKILL.md` (20,823 bytes) — every call is a `curl` + `jq` one-liner. Runtime dependencies of the kept set: **`curl`, `jq`** (skills declare `allowed-tools: Bash(curl *)`, `Bash(jq *)`), Read access to `data/*.json`, and the `WebFetch` tool for `wheretocredit`. No node/python/Docker. The Docker image must therefore install `curl` and `jq`; `allowedTools` includes `Bash(curl *)`, `Bash(jq *)`, `Read`, `Glob`, `Grep`, `WebFetch`, `Skill`, and `mcp__<server>__*` for the four servers (scoped-rule syntax inside `allowedTools` is the permissions-page rule syntax — **verify** in the Phase-4 init/permission_denials output).

License: MIT, "Copyright (c) 2026 Michael Borohovski" — the notice is copied into `build/plugin/LICENSE` and cited in `README.md`/`LEGAL.md`; the README asks for no extra attribution text.

---

## 7. Where the docs contradict the prompt

| # | Kickoff prompt says | Docs / repo say | Resolution (docs win on facts; prompt wins on scope) |
|---|---|---|---|
| 1 | Cached Search has `cabin`, `disable_live_filtering`; response has `YMileageCostRaw`, `ComputedLastSeen`, `APITermsOfUse`; pagination "may use `moreURL`" | OpenAPI defines exactly 16 params (`cabins`, plural; no `cabin`, no `disable_live_filtering`); response has no `*Raw`, `ComputedLastSeen`, `APITermsOfUse`, `moreURL`; pagination is `cursor` + `hasMore` (+ `skip`) | Client generated from the spec only. `computed_last_seen` column ← `UpdatedAt`. Filter toggle ← `include_filtered`. Extra fields seen in live fixtures are recorded, not assumed |
| 2 | "Freshness field (`ComputedLastSeen` or equivalent)" | Only `CreatedAt`/`UpdatedAt` exist (plain strings; RFC3339 inferred). The toolkit skill lists `ComputedLastSeen`, the spec does not | Freshness = `UpdatedAt` |
| 3 | Get Routes listed as a core endpoint | Exists (`GET /routes?source=`, `get-routes-1`) but unindexed in `llms.txt` and referenced nowhere else; bare-array response | Use it with the fallback in §2.4 |
| 4 | "Bulk Availability response shape" to encode | 200 schema is empty `{}`; prose says "similar to Cached Search" | Reuse the Cached Search envelope/Availability schema leniently; smoke fixture confirms |
| 5 | Vendor path for the plugin: `plugins/travel-hacking-toolkit/` | That is the Codex plugin; the Claude Code plugin root is the repo root (`.claude-plugin/plugin.json`, name `travel-hacker`); real skills dir is under `plugins/.../skills` with the root `skills` a symlink; `data/` at root | `build-plugin.ts` copies from the repo root, follows symlinks, includes `data/` |
| 6 | Skills namespaced "e.g. `travel-hacker:getting-started`" (implied from dir name) | Prefix = manifest `name` (`travel-hacker`), not the directory name | Keep manifest name; assert `travel-hacker:seats-aero` in init `skills` |
| 7 | "~48 skills"; README says 42 | Exactly 48 dirs | 27 kept / 21 pruned |
| 8 | "the seats-aero skill's scripts" | No scripts — SKILL.md only | Nothing to execute; env + curl/jq |
| 9 | Keep remote MCP "Kiwi, Trivago, Ferryhopper, Skiplagged" | `.mcp.json` also has `liteapi` (key) and `airbnb` (npx, `--ignore-robots-txt`) | Prompt wins on scope: keep the four, drop `liteapi`, `airbnb` |
| 10 | "check the SDK docs for a native allow/deny mechanism; use it in addition to pruning" | `skills` is allow-only, exact names, no wildcards, and `/name` dispatch bypasses it; `disallowedTools` is for tools | Prune physically (primary) + `skills` allowlist + `disallowedTools` |
| 11 | Load via `plugins: [{ type: "local", path }]` "verify names" | Verified verbatim; plus `skipMcpDiscovery`; nonexistent path silently skipped | Use with `skipMcpDiscovery: true`; assert init `plugins` |
| 12 | "SDK-documented way to set session/MCP environment; if per-session env isn't supported spawn an isolated process" | `env` option exists and **replaces** the subprocess env (TS); per-stdio-server `env` also exists | `env` with an explicit minimal map per request (§3.2) |
| 13 | "request timeout 120 s" | No wall-clock option; `maxTurns` is the only built-in bound; use `abortController` | `AbortController` + `setTimeout`, plus `API_TIMEOUT_MS` in env |
| 14 | Agent SDK docs at `platform.claude.com/docs/en/agent-sdk/*` | 307 → `code.claude.com/docs/en/agent-sdk/*` (`.md` works only there; index `code.claude.com/docs/llms.txt`) | Cite code.claude.com |
| 15 | Models "navigate from `docs.claude.com/en/docs_site_map.md`" | Redirects to `platform.claude.com/llms.txt` | Cite platform.claude.com |
| 16 | Structured output "e.g. `output_format: { type: 'json_schema', schema }`" | Current field is `output_config.format`; `output_format` + beta header are deprecated transition forms | Use `output_config.format` |
| 17 | "cheapest currently available Claude model" / "current mid-tier" | `claude-haiku-4-5-20251001` ($1/$5) / `claude-sonnet-5` ($2/$10, permanent) | As chosen in §4 |
| 18 | gitleaks action "e.g. `gitleaks/gitleaks-action@v2`" | README uses `@v3` (v3.0.0, 2026-05-30, node24); v2 stops working on hosted runners 2026-09-16; not MIT (Gitleaks EULA), license key only for orgs | `gitleaks/gitleaks-action@v3` + `actions/checkout@v6` `fetch-depth: 0` |
| 19 | argon2 "prebuilt binaries via prebuild-install" | `argon2@0.45.1` bundles prebuilds via prebuildify/node-gyp-build; **no darwin-x64** prebuild (Rosetta Node compiles from source) | Use `@node-rs/argon2` (§9) |
| 20 | Telegram `disable_web_page_preview` | Bot API 10.3 `sendMessage` has `link_preview_options: { is_disabled: true }` instead | Use `link_preview_options` |
| 21 | Drizzle `node:sqlite` via `drizzle-orm/node-sqlite` | Only in `drizzle-orm@rc` (1.0.0-rc.4); npm `latest` 0.45.2 has no `./node-sqlite` export | better-sqlite3 on stable Drizzle (§9) |
| 22 | node-cron `cron.schedule(expr, fn)` with v3-style options | v4.6.0: no `scheduled: false`; use `createTask()` + `task.start()`; `TaskOptions` has `timezone`, `name`, `noOverlap`, … | v4 API |
| 23 | Precondition: `docker` + `docker compose` on the host | Docker is not installed on the dev Mac | Compose files written and validated by `docker compose config` elsewhere; listed under "Needs human action" |
| 24 | "toolkit reads `SEATS_AERO_API_KEY`, `DUFFEL_API_KEY_LIVE`, `IGNAV_API_KEY`" | Confirmed exact names; toolkit deliberately reads the shell env, not plugin `userConfig` | Inject via SDK `env` |
| 25 | Toolkit Get Trips params | Toolkit lists only `include_filtered`; spec also has `min_cabin_pct` and optional `MixedCabinPct` | Client follows the spec |
| 26 | Cell shows `miles · $fees · seats · program · freshness`; `availability_cache` has `fees_cents`, `currency`, `booking_url` | Availability (Cached Search / Bulk) objects carry **no** taxes, currency or booking link; `TotalTaxes`, `TaxesCurrency`, `booking_links[]` exist only on Get Trips | Columns nullable; filled on expand (Get Trips) and, since #52, persisted onto that row so they survive the render; fees shown as "—" until then; `fees_asc` sorts fetched cells first |
| 27 | "Node 20+" (§2) and `node` ≥ 20 precondition | `better-sqlite3@13.0.3` requires `node >=22`; `argon2` tested only on ≥ 22; `@anthropic-ai/claude-agent-sdk` needs ≥ 18; Next.js 16 needs ≥ 20.9 | Pin `engines.node >=22` (`.nvmrc` 22); dev with `~/.local/node-arm64` |
| 28 | Live Search excluded (§0.2 #3) | Docs agree: "cannot be used by Seats.aero Pro users at this time" | No conflict — recorded for completeness; no `/live` code path |

Refuted research claims **not** carried into this design: "trips and segments carry CreatedAt/UpdatedAt" is only shown in the Get Trips example, not the Cached Search file; `TotalDuration` unit and `MixedCabinPct` type come from the Get Trips OpenAPI (int32) not Concepts; `mcp__<server>__*` wildcards in top-level `allowedTools` are documented by example on mcp.md, not by the Options table; `outputStyle` is not an Options field; `startup()` returns `Promise<WarmQuery>` (must be awaited; unused here); live-search IDs are synthetic only when `cached: false` (irrelevant — no Live Search).

---

## 8. Unreachable / unverified

Unreachable during research:

- `https://developers.seats.aero/reference/routes.md`, `.../get-routes.md`, `.../routes-1.md` — HTTP 404 HTML (the real page is `get-routes-1.md`).
- `https://platform.claude.com/docs/en/agent-sdk/plugins` and `.md` — docs HTML shell only (content at code.claude.com).
- `https://orm.drizzle.team/docs/connect-better-sqlite3`, `.../connect-libsql` — redirect to the docs home (content at `orm.drizzle.team/docs/sqlite/get-started-sqlite`).

Unverified (explicitly not assumed):

- seats.aero daily-quota reset boundary and over-quota response (no 429/headers documented).
- Bulk Availability exact response envelope (schema empty) — inferred from Cached Search.
- Whether a date beyond `Route.NumDaysOut` means "not yet monitored".
- Existence of `ComputedLastSeen` on the live API (toolkit mentions it; spec does not).
- `TotalDuration` unit (toolkit says minutes; example values do not reconcile); `TotalTaxes` minor-units rule is by Concepts example only; `TaxesCurrency == ""` ⇒ USD is the toolkit's interpretation.
- Plugin skills loading under `settingSources: []` (§3.1 runtime assertion + fallback).
- Scoped allow rules (`Bash(curl *)`) inside the SDK `allowedTools` option; `mcp__<server>__*` in top-level `allowedTools` (documented by example only).
- `permissionPrompts: "none"` support in the bundled Claude Code build (needs ≥ 2.1.259; check `claude_code_version` in init).
- Whether the SDK's Bash tool and http MCP servers see exactly the `env` map (expected; tested by the two-user test).
- Prebuild coverage of `better-sqlite3@13.0.3` for darwin-x64/arm64 and `@libsql/client@0.18.0` (not fetched); `serverExternalPackages` handling of native modules in Next.js 16 (not fetched).
- Models/pricing/tooling facts are quoted from fetched docs but not independently re-verified (see research JSON `quotedNotReverified`).
- No `SEATS_AERO_API_KEY_TEST` smoke has been run yet; fixtures currently derive from the docs' examples.

---

## 9. Tooling facts

### 9.1 Host facts and the SQLite driver choice

Host: Apple Silicon (M3) Mac; default `/usr/local/bin/node` is Intel under Rosetta; an arm64 Node 22 exists at `~/.local/node-arm64`; **Docker is not installed**. Native-module builds break under the Rosetta toolchain (memory note) — so prefer packages with prebuilt binaries and run everything with the arm64 Node 22.

| Option | Drizzle import | Package facts | Verdict |
|---|---|---|---|
| **better-sqlite3** | `drizzle-orm/better-sqlite3` (+ `drizzle-orm/better-sqlite3/migrator`) | `better-sqlite3@13.0.3` (2026-08-05) requires `node >=22`; Drizzle `latest` 0.45.2 supports it; `@types/better-sqlite3` needed; synchronous API | **Chosen.** Stable Drizzle (`drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`), most-documented path, sync API fits a single-file DB and the worker. Requires Node 22 → pin `engines.node >=22`, use `~/.local/node-arm64` locally, `node:22` image in Docker. Prebuild coverage for darwin is **unverified** — if install falls back to node-gyp under Rosetta, switch to arm64 Node (not to a different driver). |
| @libsql/client | `drizzle-orm/libsql` | `@libsql/client@0.18.0` (2026-09-02); local files need the `file:` URL prefix (`DB_FILE_NAME=file:local.db`); async API | Fallback if better-sqlite3 cannot be built/installed. Async API is fine but changes call sites; `file:` prefix is a foot-gun in `drizzle.config.ts`. |
| node:sqlite | `drizzle-orm/node-sqlite` with `DatabaseSync` from `node:sqlite` | **Only** in `drizzle-orm@rc` (1.0.0-rc.4 / `drizzle-kit@rc`); npm `latest` 0.45.2 has no `./node-sqlite` export; zero native deps | Rejected for v1: needs the RC line (different migration folder layout: one folder per migration with `migration.sql` + `snapshot.json`) — kickoff §0.3 prefers the simplest option that passes tests. Revisit when 1.0 is `latest` (`BACKLOG.md`). |

Config (`drizzle.config.ts`): `defineConfig({ out: './drizzle', schema: './src/db/schema.ts', dialect: 'sqlite', dbCredentials: { url: process.env.DB_FILE_NAME! } })`; commands `drizzle-kit generate` / `migrate` / `push`; migration table `__drizzle_migrations`; runtime `migrate(db)` from `drizzle-orm/better-sqlite3/migrator` at app/worker start. Schema: `sqliteTable`, `int().primaryKey({ autoIncrement: true })`, `text().notNull().unique()` from `drizzle-orm/sqlite-core`. Next.js route handlers touching the DB or argon2 declare `export const runtime = 'nodejs'`.

### 9.2 argon2

- `argon2@0.45.1` (2026-07-21): prebuilds bundled in the tarball via prebuildify/node-gyp-build for darwin-arm64, linux-x64 (glibc+musl), linux-arm64 (glibc+musl), linux-arm, freebsd, win32-x64 — **no darwin-x64**, so a Rosetta Node compiles from source (node-gyp + compiler). Tested only against Node ≥ 22.
- **`@node-rs/argon2@2.2.0`** (2026-08-29): napi-rs prebuilt binaries as per-platform optionalDependencies incl. `darwin-x64`, `darwin-arm64`, `linux-x64-gnu/musl`, `linux-arm64-gnu/musl`; no node-gyp, no postinstall. API: `hash(password, options?, abortSignal?) → Promise<string>` (PHC string, Argon2id, 16-byte salt; defaults `memoryCost` 19456 KiB, `timeCost` 2, `parallelism` 1, `outputLen` 32), `verify(hashed, password, options?) → Promise<boolean>`, `parseOptions(hashed)` for needs-rehash checks. **Chosen** — works under both Rosetta and arm64 Node and inside Alpine/Debian images without a toolchain.

### 9.3 node-cron

`node-cron@4.6.0` (2026-07-05), `engines.node >=20`, zero deps, ESM+CJS with bundled types. Exports: `schedule(expression, fn, options?)` → `ScheduledTask` (starts immediately), `createTask` (does not start), `validate(expr) → boolean`, `validateDetailed`, `parse`, `getTasks`, `getTask`, `setLogger`, `shutdown(timeout=5000)`; default export object also exposes them. `TaskOptions`: `timezone`, `name`, `noOverlap`, `distributed`, `runCoordinator`, `distributedLease`, `maxExecutions`, `maxRandomDelay`, `logger`, `suppressMissedWarning`, `missedExecutionTolerance`, `executeTimeout`, `startTimeout`, `unref` — **no v3 `scheduled: false`**. Task methods: `start()`, `stop()`, `destroy()`, `getStatus()` (`'stopped' | 'idle' | 'running' | 'destroyed'`), `execute()`, `getNextRun()`, `getNextRuns(n)`, `lastRun()`; events `execution:started/finished/failed/overlap/skipped/missed`, `task:started/stopped/destroyed/failed`. 5-field expressions with optional leading seconds field. Worker plan: one master tick `*/5 * * * *` with `{ timezone: 'UTC', noOverlap: true, name: 'awardgrid-tick' }` that selects due `saved_queries` (validated with `validate()` at save time) — simpler than one task per saved query; bundling note: inline function tasks need no `external` marking.

### 9.4 gitleaks (CI secret scan)

`gitleaks/gitleaks-action@v3` (v3.0.0, 2026-05-30, `runs.using: node24`) with `actions/checkout@v6` and `fetch-depth: 0`. Env: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`; `GITLEAKS_LICENSE` is required only for organization repos (omit for a personal account). Optional: `GITLEAKS_CONFIG` (a repo-root `gitleaks.toml` is auto-detected), `GITLEAKS_ENABLE_COMMENTS`, `GITLEAKS_ENABLE_UPLOAD_ARTIFACT`, `GITLEAKS_ENABLE_SUMMARY`, `GITLEAKS_VERSION`. v2 is Node 20 and stops working on GitHub-hosted runners 2026-09-16. The action is under a Gitleaks LLC EULA, not MIT (fine for CI use; noted in `LEGAL.md`).

### 9.5 Telegram Bot API (10.3, 2026-08-24)

- Requests: `https://api.telegram.org/bot<token>/METHOD` over HTTPS, GET or POST; JSON body with `application/json`. Response always has boolean `ok`; success → `result`; failure → `description` + integer `error_code` (+ optional `parameters`).
- `getMe` (no params) → `User { id, is_bot, first_name, username?, … }` — used to validate `TELEGRAM_BOT_TOKEN` at startup. `User.id`/chat ids may exceed 32 bits (≤ 52 significant bits) → store as text/bigint, never `number` parsing in the DB layer.
- `sendMessage`: required `chat_id` (Integer or `@username` String), `text` (1–4096 chars after entity parsing); optional `parse_mode` (`"HTML"` chosen — `MarkdownV2` requires escaping `_ * [ ] ( ) ~ \` > # + - = | { } . !`), `link_preview_options: { is_disabled: true }` (there is **no** `disable_web_page_preview`), `disable_notification`, `protect_content`, `reply_markup`, … Messages > 4096 chars are split.
- Linking: deep link `https://t.me/<bot_username>?start=<payload>`, payload `[A-Za-z0-9_-]{1,64}` (base64url token) → the bot receives a message whose `text` is `/start <payload>`.
- Receiving the `/start`: **long polling** via `getUpdates` (`offset` = last `update_id` + 1, `limit` 1–100, `timeout` > 0 seconds, `allowed_updates: ["message"]`) inside the worker — chosen over `setWebhook` because the deployment sits behind Tailscale/Access with no public HTTPS endpoint; `getUpdates` does not work while a webhook is set. (`setWebhook` facts for later: ports 443/80/88/8443, `secret_token` echoed as header `X-Telegram-Bot-Api-Secret-Token`, non-2XX retried.)
- Mock transport with the identical interface when `TELEGRAM_BOT_TOKEN` is absent.

### 9.6 Next.js

- Current stable **16.3.4** (2026-08-31); minimum Node 20.9 (Node 22 used anyway).
- Scaffold: `npx create-next-app@latest awardgrid --ts --tailwind --app --src-dir --eslint --import-alias "@/*" --yes` (`--src-dir` must be explicit — not part of the stated defaults; Turbopack default; `--agents-md` default adds AGENTS.md/CLAUDE.md; `--use-pnpm`, `--skip-install`, `--disable-git` available).
- Route handlers (`app/**/route.ts`): return `new Response(readableStream)` built from a `ReadableStream` (`controller.enqueue(encoder.encode('data: …\n\n'))`) for the Ask SSE stream — set `Content-Type: text/event-stream` yourself (the doc example sets no headers). GET handlers are dynamic by default since 15.0.0-RC; `context.params` is a Promise; segment config `export const runtime = 'nodejs'` where native modules (better-sqlite3, @node-rs/argon2) or the Agent SDK subprocess are used — the ask lane **cannot** run on the edge runtime.
