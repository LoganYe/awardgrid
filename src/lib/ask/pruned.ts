/**
 * Explicit deny list of toolkit skills that must NEVER be loadable by the ask lane
 * (kickoff §0.2 #1 no scraping, #5 no credential skills; ARCHITECTURE §6.1).
 *
 * `scripts/build-plugin.ts` physically removes these directories from `build/plugin/skills/`
 * (primary control). This list is defense-in-depth: even if a directory with one of these
 * names reappears in the build output, `pluginSkillAllowlist()` filters it out and
 * `runAsk()` aborts when the SDK's init message lists it.
 */
export const PRUNED_SKILLS = [
  "american-airlines", // Docker + Patchright against aa.com; AA_USERNAME / AA_PASSWORD
  "amex-travel", // Docker + Patchright portal; AMEX_USERNAME / AMEX_PASSWORD
  "chase-travel", // Docker + Patchright portal; CHASE_USERNAME / CHASE_PASSWORD
  "southwest", // Docker + Patchright against southwest.com; SW_USERNAME / SW_PASSWORD
  "ticketsatwork", // Docker + Patchright; TAW_USER / TAW_PASS
  "vrbo", // Docker + Patchright (Akamai bypass)
  "sutochno", // Docker + Patchright
  "google-flights", // agent-browser scraping of google.com/travel/flights
  "seatmaps", // agent-browser scraping of seatmaps.com
  "atlas-obscura", // runtime npm install + scrapes atlasobscura.com
  "deutsche-bahn", // runtime npm install; rail out of scope
  "getting-started", // runs printenv over the key list
  "gardening", // reads arbitrary user-supplied local files
  "trip-log", // writes trips/logs/*.md into the cwd
  "awardwallet", // AWARDWALLET_API_KEY; not a supported provider
  "rapidapi", // RAPIDAPI_KEY; not a supported provider
  "serpapi", // SERPAPI_API_KEY; not a supported provider
  "tripadvisor", // TRIPADVISOR_API_KEY; hotels out of scope
  "scandinavia-transit", // ENTUR / RESROBOT / REJSEPLANEN keys; rail out of scope
  "round-the-world", // shells to python3 scripts/calc_distance.py (scripts/ not shipped)
  "compare-hotels", // orchestrates the Airbnb MCP (--ignore-robots-txt) and VRBO Docker skill
] as const;

export type PrunedSkill = (typeof PRUNED_SKILLS)[number];

const PRUNED_SET: ReadonlySet<string> = new Set<string>(PRUNED_SKILLS);

/** True for a bare skill dir name ("southwest") or a namespaced one ("travel-hacker:southwest"). */
export function isPrunedSkill(name: string): boolean {
  const bare = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
  return PRUNED_SET.has(bare.trim().toLowerCase());
}
