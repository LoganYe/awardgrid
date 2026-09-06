/**
 * Explicit classification of the vendored travel-hacking-toolkit for the hosted ask lane
 * (kickoff §7.1–7.2, §0.2 #1/#5; ARCHITECTURE.md §3.3 and §6).
 *
 * Every skill directory in vendor/travel-hacking-toolkit/plugins/travel-hacking-toolkit/skills
 * (the real directory; the repo-root `skills` is a git symlink to it) MUST appear in exactly one
 * of PRUNED_SKILLS / KEPT_SKILLS. scripts/build-plugin.ts fails when a toolkit update adds a skill
 * that is not classified here, so nothing ships by accident.
 *
 * This file is pure data — no I/O — so the Phase-4 ask lane can import it for the SDK `skills`
 * allowlist (`plugin:skill` names, no wildcards) without touching the filesystem.
 */

/** `.claude-plugin/plugin.json` name of the vendored plugin — the namespace prefix for its skills. */
export const PLUGIN_NAME = "travel-hacker";

/** `"travel-hacker:seats-aero"` — the exact form the SDK `skills` allowlist and the init message use. */
export function skillId(name: string): string {
  return `${PLUGIN_NAME}:${name}`;
}

/**
 * Skills removed from the hosted plugin, with the reason each one is out (kickoff §0.2 #1 no
 * scraping, #5 no credential-based skills; plus keys awardgrid does not manage, runtime installers,
 * and filesystem writes). Order is alphabetical; the reason is what PRUNED.md prints.
 */
export const PRUNED_SKILLS: Readonly<Record<string, string>> = {
  "american-airlines":
    "Docker (ghcr.io/borski/aa-miles-check) + Patchright against aa.com; reads AA_USERNAME / AA_PASSWORD / AA_2FA_COMMAND (§0.2 #1, #5)",
  "amex-travel":
    "Docker + Patchright portal login; reads AMEX_USERNAME / AMEX_PASSWORD / AMEX_2FA_COMMAND (§0.2 #5)",
  "atlas-obscura":
    "shells to `node skills/atlas-obscura/ao.mjs`, which runs `npm install` at runtime and scrapes atlasobscura.com",
  awardwallet:
    "needs AWARDWALLET_API_KEY / AWARDWALLET_USER_ID (IP-allowlisted Business API) — a key awardgrid does not manage",
  "chase-travel":
    "Docker + Patchright portal login; reads CHASE_USERNAME / CHASE_PASSWORD / CHASE_2FA_COMMAND (§0.2 #5)",
  "compare-hotels":
    "orchestrates the Airbnb MCP (npx --ignore-robots-txt), the VRBO Docker skill and the Chase/Amex portal skills — all dropped; hotels are out of scope (DECISIONS.md)",
  "deutsche-bahn":
    "shells to `node skills/deutsche-bahn/scripts/search_trains.mjs` (runtime `npm install` of db-vendo-client); rail out of scope",
  gardening:
    "reads an arbitrary user-supplied local file path (reservations file) — no local files in hosted mode",
  "getting-started":
    "runs `printenv` over the API-key list, which would echo key values into the transcript; host-setup instructions are irrelevant when hosted",
  "google-flights": "agent-browser automation of google.com/travel/flights — scraping (§0.2 #1)",
  rapidapi: "needs RAPIDAPI_KEY — a key awardgrid does not manage",
  "round-the-world":
    "shells to `python3 scripts/calc_distance.py` (scripts/ is not shipped, no python3 in the image); ARCHITECTURE.md §6.1. Physically pruned because the SDK init message lists every skill present on disk regardless of the `skills` allowlist (verified 2026-09-06, Claude Code 2.1.260)",
  "scandinavia-transit":
    "needs ENTUR_CLIENT_NAME / RESROBOT_API_KEY / REJSEPLANEN_API_KEY — keys awardgrid does not manage; rail out of scope",
  seatmaps: "agent-browser automation of seatmaps.com / AeroLOPA — scraping (§0.2 #1)",
  serpapi: "needs SERPAPI_API_KEY — a key awardgrid does not manage",
  southwest:
    "Docker (ghcr.io/borski/sw-fares) + Patchright against southwest.com; reads SW_USERNAME / SW_PASSWORD; allowed-tools Bash(docker *) (§0.2 #1, #5)",
  sutochno:
    "Docker + Patchright (patchright-docker base image); reads SUTOCHNO_IN_DOCKER (§0.2 #5)",
  ticketsatwork: "Docker + Patchright portal login; reads TAW_USER / TAW_PASS (§0.2 #5)",
  tripadvisor:
    "needs TRIPADVISOR_API_KEY — a key awardgrid does not manage; hotel reviews out of scope",
  "trip-log":
    "writes trips/logs/*.md into the working directory — no filesystem writes in hosted mode",
  vrbo: "Docker + Patchright (Akamai bot-wall bypass); reads VRBO_IN_DOCKER / VRBO_PROFILE (§0.2 #1, #5)",
};

/**
 * Skills shipped in build/plugin/skills. Reference/API skills only: markdown + data/*.json reads +
 * curl/jq one-liners against APIs whose keys awardgrid manages (SEATS_AERO_API_KEY,
 * DUFFEL_API_KEY_LIVE, IGNAV_API_KEY) or that need no key.
 *
 * Note on a kept skill whose SKILL.md references a repo-root python helper that is NOT shipped
 * (build/plugin has no scripts/ directory and the image has no python3):
 *  - `transfer-bonuses` mentions `scripts/refresh-transfer-bonuses.py` (scrapes Frequent Miler and
 *    writes data/transfer-bonuses.json). The skill reads the shipped JSON only; the refresh cannot
 *    run. The ask-lane system prompt says so.
 */
export const KEPT_SKILLS: readonly string[] = [
  "alliances",
  "award-calendar",
  "award-holds",
  "award-sweet-spots",
  "bilt",
  "booking-guidance",
  "cabin-codes",
  "compare-flights",
  "duffel",
  "fallback-and-resilience",
  "flight-search-strategy",
  "hotel-chains",
  "ignav",
  "lessons-learned",
  "partner-awards",
  "plan-trip",
  "points-valuations",
  "premium-hotels",
  "seats-aero",
  "status-match",
  "stopovers",
  "transfer-bonuses",
  "transfer-partners",
  "trip-calculator",
  "trip-planner",
  "wheretocredit",
  "wikipedia-airports",
];

/** Kickoff §7.2 names these explicitly as must-keep; the test asserts they are in KEPT_SKILLS. */
export const MUST_KEEP_SKILLS: readonly string[] = [
  "seats-aero",
  "duffel",
  "ignav",
  "transfer-partners",
  "points-valuations",
  "flight-search-strategy",
  "alliances",
  "lessons-learned",
  "wheretocredit",
  "wikipedia-airports",
];

/**
 * Safety net applied to every file in the built plugin: a hit in a file without an ALLOWED_MENTIONS
 * entry fails the build. Catches a toolkit update that quietly adds Docker/browser automation or a
 * credential read to a kept skill.
 */
export const PRUNE_PATTERNS =
  /docker|patchright|playwright|agent-browser|_USERNAME|_PASSWORD|printenv/i;

/**
 * Output-relative paths that are allowed to match PRUNE_PATTERNS, each with the reason verified by
 * reading the file (line numbers refer to the pinned checkout). All are prose that names a pruned
 * skill or Docker image as an alternative; none of them can run anything: the referenced skills
 * are absent from the plugin, `Bash(docker *)` is not in the ask lane's allowedTools, and no
 * `*_USERNAME`/`*_PASSWORD` value exists in the session env.
 */
export const ALLOWED_MENTIONS: Readonly<Record<string, string>> = {
  "skills/award-calendar/SKILL.md":
    "line 126: lists 'seats.aero live search (local Patchright only)' as a manual alternative — no command, and the seats-aero-web skill does not exist in the checkout",
  "skills/compare-flights/SKILL.md":
    "source table + 'Portal Pay-With-Points (Docker required)' section describe the southwest / chase-travel / amex-travel skills as optional parallel sources; they are pruned, and the skill says to skip them when not configured (line 209)",
  "skills/fallback-and-resilience/SKILL.md":
    "fallback table and 'Patchright-Based Skills' / 'Docker Image Failures' sections are troubleshooting prose for pruned skills; no runnable command is issued by the model, only `docker pull/logout` advice for a local install",
  "skills/flight-search-strategy/SKILL.md":
    "source-priority table (Google Flights via agent-browser, Southwest via Patchright/Docker), two example `docker run ghcr.io/borski/sw-fares` commands (lines 59, 75, the latter with `-e SW_USERNAME -e SW_PASSWORD`) and one `python3 skills/southwest/scripts/search_fares.py` example (line 65) — mandatory §7.2 skill; Docker/python are not allowed tools, the southwest dir is not shipped, and the vars are never set",
  "skills/seats-aero/SKILL.md":
    "line 380: price history 'available on the web UI' via a `seats-aero-web` (Patchright) skill that does not exist in the checkout — dangling reference",
  "skills/trip-calculator/SKILL.md":
    "line 77: 'Seats.aero web → live search (local Patchright only)' in the source hierarchy — prose only",
  "data/airport-coordinates.json":
    "the Australian airport DKV is named 'Docker River Airport' (place name, not a tool)",
};

/**
 * Files never copied out of a kept skill directory (reference skills are markdown + data only;
 * in the pinned checkout no kept skill has any of these — the rule is a safety net for updates).
 */
export const EXCLUDED_FILE_PATTERNS: readonly RegExp[] = [
  /\.py$/i,
  /\.mjs$/i,
  /\.cjs$/i,
  /\.js$/i,
  /\.ts$/i,
  /\.sh$/i,
  /\.ps1$/i,
  /\.cmd$/i,
  /^Dockerfile$/,
  /^package(-lock)?\.json$/,
];

/**
 * Repo-root files deliberately NOT shipped (ARCHITECTURE.md §3.3). Documented in PRUNED.md.
 * `scripts/` is where the python helpers referenced by round-the-world / transfer-bonuses live.
 */
export const DROPPED_ROOT_ENTRIES: Readonly<Record<string, string>> = {
  "agents/":
    "travel-hacker.md pins model: opus and references Docker portal skills; the ask lane supplies its own systemPrompt",
  ".mcp.json":
    "MCP servers are passed by the app via the SDK `mcpServers` option (+ skipMcpDiscovery: true)",
  "scripts/":
    "python/shell helpers (calc_distance.py, refresh-transfer-bonuses.py, setup-keys.sh, …); no python3 in the image",
  "commands/ hooks/ plugins/ docs/ trips/ .env.example CLAUDE.md README.md":
    "not part of the Claude Code plugin surface awardgrid loads",
};

export type HttpMcpServer = { type: "http"; url: string };

/** Remote, keyless MCP servers from the repo-root .mcp.json, passed by the app via `mcpServers`. */
export const KEPT_MCP_SERVERS: Readonly<Record<string, HttpMcpServer>> = {
  skiplagged: { type: "http", url: "https://mcp.skiplagged.com/mcp" },
  kiwi: { type: "http", url: "https://mcp.kiwi.com" },
  trivago: { type: "http", url: "https://mcp.trivago.com/mcp" },
  ferryhopper: { type: "http", url: "https://mcp.ferryhopper.com/mcp" },
};

export const DROPPED_MCP_SERVERS: Readonly<Record<string, string>> = {
  liteapi: "needs LITEAPI_API_KEY (Authorization: Bearer header) — a key awardgrid does not manage",
  airbnb:
    "stdio `npx -y @openbnb/mcp-server-airbnb@latest --ignore-robots-txt` — runtime npx install plus a robots.txt bypass (scraping)",
};

/** Sorted `travel-hacker:<skill>` ids for the SDK `skills` allowlist (no wildcards). */
export const KEPT_SKILL_IDS: readonly string[] = [...KEPT_SKILLS].sort().map(skillId);

/** Sorted `travel-hacker:<skill>` ids the Phase-4 init assertion must NOT find in `skills`/`slash_commands`. */
export const PRUNED_SKILL_IDS: readonly string[] = Object.keys(PRUNED_SKILLS).sort().map(skillId);
