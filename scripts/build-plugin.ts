/**
 * `pnpm build:plugin` — builds the pruned travel-hacker plugin for the hosted ask lane
 * (kickoff §7.1–7.2; ARCHITECTURE.md §3.3, §6).
 *
 * Source: the vendored repo ROOT vendor/travel-hacking-toolkit (its .claude-plugin/plugin.json is
 * the Claude Code plugin; the root `skills` entry is a git symlink to
 * plugins/travel-hacking-toolkit/skills and is resolved so real files are copied).
 *
 * Output (build/plugin/, gitignored, wiped on every run, deterministic — sorted file order, no
 * timestamps):
 *   .claude-plugin/plugin.json   copied verbatim (name "travel-hacker" → skills are travel-hacker:*)
 *   skills/<kept>/…              only KEPT_SKILLS; *.py/*.mjs/*.js/*.sh/Dockerfile/… never copied
 *   data/*.json                  every JSON file at the repo root data/ (skills read them root-relative)
 *   LICENSE                      MIT, Michael Borohovski — attribution obligation
 *   PRUNED.md                    what was left out and why (generated, no timestamp)
 *
 * Deliberately absent: agents/, .mcp.json, scripts/, commands/, hooks/ (ARCHITECTURE.md §3.3).
 *
 * The build FAILS (non-zero exit) when: a skill dir in the vendored repo is not classified in
 * scripts/plugin-manifest.ts; a pruned skill name ends up in the output; any output file matches
 * PRUNE_PATTERNS without an ALLOWED_MENTIONS entry (or an ALLOWED_MENTIONS entry no longer
 * matches — keep the map honest); plugin.json name != "travel-hacker"; the output contains
 * .mcp.json or agents/; a kept skill has no SKILL.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_MENTIONS,
  DROPPED_MCP_SERVERS,
  DROPPED_ROOT_ENTRIES,
  EXCLUDED_FILE_PATTERNS,
  KEPT_MCP_SERVERS,
  KEPT_SKILLS,
  PLUGIN_NAME,
  PRUNE_PATTERNS,
  PRUNED_SKILLS,
} from "./plugin-manifest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");
export const DEFAULT_SRC = path.join(REPO_ROOT, "vendor", "travel-hacking-toolkit");
export const DEFAULT_OUT = path.join(REPO_ROOT, "build", "plugin");

/** Name of the generated summary file; the only output file exempt from the PRUNE_PATTERNS scan. */
export const PRUNED_MD = "PRUNED.md";

export class PluginBuildError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`plugin build failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PluginBuildError";
  }
}

export type BuildResult = {
  src: string;
  out: string;
  /** Output-relative paths written, sorted, posix separators. */
  written: string[];
  /** Source-relative paths inside kept skill dirs that were NOT copied (EXCLUDED_FILE_PATTERNS). */
  excluded: string[];
  keptSkills: string[];
  prunedSkills: string[];
  /** Output-relative files that matched PRUNE_PATTERNS and were covered by ALLOWED_MENTIONS. */
  allowedMentionHits: string[];
};

const toPosix = (p: string): string => p.split(path.sep).join("/");

/** `readdir` names, sorted bytewise so the walk (and therefore the output) is deterministic. */
function sortedNames(dir: string): string[] {
  return fs.readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Recursively list files under `dir` following symlinks; returns paths relative to `dir` (posix). */
export function walkFiles(dir: string): string[] {
  const acc: string[] = [];
  const visit = (rel: string): void => {
    const abs = path.join(dir, rel);
    const st = fs.statSync(abs); // follows symlinks
    if (st.isDirectory()) {
      for (const name of sortedNames(abs)) visit(rel ? `${rel}/${name}` : name);
    } else if (st.isFile()) {
      acc.push(toPosix(rel));
    }
  };
  visit("");
  return acc;
}

/** Skill directory names in the vendored repo (symlink resolved), sorted. */
export function listSourceSkills(src: string): string[] {
  const skillsDir = fs.realpathSync(path.join(src, "skills"));
  return sortedNames(skillsDir).filter((n) => fs.statSync(path.join(skillsDir, n)).isDirectory());
}

/** KEPT ∪ PRUNED must equal the set of skill dirs, and the two must be disjoint. */
export function classificationProblems(sourceSkills: readonly string[]): string[] {
  const problems: string[] = [];
  const pruned = new Set(Object.keys(PRUNED_SKILLS));
  const kept = new Set(KEPT_SKILLS);
  for (const n of kept) if (pruned.has(n)) problems.push(`skill "${n}" is in both KEPT_SKILLS and PRUNED_SKILLS`);
  const source = new Set(sourceSkills);
  for (const n of source) {
    if (!kept.has(n) && !pruned.has(n)) {
      problems.push(`unclassified skill "${n}" in the vendored toolkit — add it to KEPT_SKILLS or PRUNED_SKILLS in scripts/plugin-manifest.ts`);
    }
  }
  for (const n of [...kept, ...pruned]) {
    if (!source.has(n)) problems.push(`classified skill "${n}" does not exist in the vendored toolkit`);
  }
  return problems;
}

function isExcludedFile(relInsideSkill: string): boolean {
  const base = path.posix.basename(relInsideSkill);
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(base));
}

function copyFile(srcAbs: string, outAbs: string): void {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.copyFileSync(fs.realpathSync(srcAbs), outAbs);
}

function renderPrunedMd(args: {
  keptSkills: readonly string[];
  excluded: readonly string[];
  dataFiles: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Pruned travel-hacker plugin`, ``);
  lines.push(
    `Generated by \`scripts/build-plugin.ts\` from \`vendor/travel-hacking-toolkit\` (MIT, Michael Borohovski — see LICENSE).`,
    `Classification lives in \`scripts/plugin-manifest.ts\`; this file only reports it.`,
    ``,
  );
  lines.push(`## Summary`, ``);
  lines.push(`- Kept skills: ${args.keptSkills.length}`);
  lines.push(`- Pruned skills: ${Object.keys(PRUNED_SKILLS).length}`);
  lines.push(`- Data files: ${args.dataFiles.length}`);
  lines.push(`- Kept MCP servers (passed by the app, not by this plugin): ${Object.keys(KEPT_MCP_SERVERS).sort().join(", ")}`);
  lines.push(`- Dropped MCP servers: ${Object.keys(DROPPED_MCP_SERVERS).sort().join(", ")}`);
  lines.push(``);
  lines.push(`## Pruned skills`, ``, `| Skill | Reason |`, `|---|---|`);
  for (const name of Object.keys(PRUNED_SKILLS).sort()) lines.push(`| \`${name}\` | ${PRUNED_SKILLS[name]} |`);
  lines.push(``);
  lines.push(`## Kept skills`, ``);
  for (const name of args.keptSkills) lines.push(`- \`${name}\``);
  lines.push(``);
  lines.push(`## Files excluded from kept skill directories`, ``);
  if (args.excluded.length === 0) lines.push(`(none — every kept skill is markdown only)`);
  else for (const f of args.excluded) lines.push(`- \`${f}\``);
  lines.push(``);
  lines.push(`## Repo-root entries not shipped`, ``, `| Entry | Reason |`, `|---|---|`);
  for (const k of Object.keys(DROPPED_ROOT_ENTRIES)) lines.push(`| \`${k}\` | ${DROPPED_ROOT_ENTRIES[k]} |`);
  lines.push(``);
  lines.push(`## Dropped MCP servers`, ``, `| Server | Reason |`, `|---|---|`);
  for (const k of Object.keys(DROPPED_MCP_SERVERS).sort()) lines.push(`| \`${k}\` | ${DROPPED_MCP_SERVERS[k]} |`);
  lines.push(``);
  lines.push(`## Allowed pattern mentions in shipped files`, ``, `| File | Why it is harmless |`, `|---|---|`);
  for (const k of Object.keys(ALLOWED_MENTIONS).sort()) lines.push(`| \`${k}\` | ${ALLOWED_MENTIONS[k]} |`);
  lines.push(``);
  return lines.join("\n");
}

/**
 * Validates an already-built plugin directory. Returns the list of problems (empty = valid) and
 * the output-relative files whose PRUNE_PATTERNS hit was covered by ALLOWED_MENTIONS.
 */
export function validatePlugin(out: string): { problems: string[]; allowedMentionHits: string[] } {
  const problems: string[] = [];
  const allowedMentionHits: string[] = [];

  // plugin.json name
  const manifestPath = path.join(out, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    problems.push(".claude-plugin/plugin.json missing");
  } else {
    let name: unknown;
    try {
      name = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: unknown }).name;
    } catch (e) {
      problems.push(`.claude-plugin/plugin.json is not valid JSON: ${(e as Error).message}`);
    }
    if (name !== undefined && name !== PLUGIN_NAME) problems.push(`plugin.json name is ${JSON.stringify(name)}, expected "${PLUGIN_NAME}"`);
  }

  // forbidden top-level entries
  for (const forbidden of ["agents", ".mcp.json", "scripts", "commands", "hooks"]) {
    if (fs.existsSync(path.join(out, forbidden))) problems.push(`output must not contain ${forbidden}`);
  }
  if (!fs.existsSync(path.join(out, "LICENSE"))) problems.push("LICENSE missing");

  // skills: no pruned dir, every kept dir has SKILL.md, nothing unclassified
  const skillsDir = path.join(out, "skills");
  const outSkills = fs.existsSync(skillsDir) ? sortedNames(skillsDir) : [];
  for (const pruned of Object.keys(PRUNED_SKILLS)) {
    if (outSkills.includes(pruned)) problems.push(`pruned skill "${pruned}" present in output`);
  }
  for (const kept of KEPT_SKILLS) {
    if (!fs.existsSync(path.join(skillsDir, kept, "SKILL.md"))) problems.push(`kept skill "${kept}" has no SKILL.md in output`);
  }
  for (const n of outSkills) {
    if (!KEPT_SKILLS.includes(n)) problems.push(`skill dir "${n}" in output is not in KEPT_SKILLS`);
  }

  // every shipped file: no excluded file types anywhere, PRUNE_PATTERNS safety net
  const files = fs.existsSync(out) ? walkFiles(out) : [];
  const matched = new Set<string>();
  for (const rel of files) {
    if (rel === PRUNED_MD) continue;
    if (isExcludedFile(rel)) problems.push(`excluded file type shipped: ${rel}`);
    const text = fs.readFileSync(path.join(out, rel), "utf8");
    if (PRUNE_PATTERNS.test(text)) {
      matched.add(rel);
      if (rel in ALLOWED_MENTIONS) allowedMentionHits.push(rel);
      else problems.push(`${rel} matches PRUNE_PATTERNS ${PRUNE_PATTERNS} and has no ALLOWED_MENTIONS entry`);
    }
  }
  for (const rel of Object.keys(ALLOWED_MENTIONS)) {
    if (!matched.has(rel)) problems.push(`ALLOWED_MENTIONS entry "${rel}" is stale: file missing or no longer matches PRUNE_PATTERNS`);
  }

  return { problems, allowedMentionHits };
}

export function buildPlugin(opts: { src?: string; out?: string } = {}): BuildResult {
  const src = path.resolve(opts.src ?? DEFAULT_SRC);
  const out = path.resolve(opts.out ?? DEFAULT_OUT);

  // --- source sanity -------------------------------------------------------------------------
  const pre: string[] = [];
  for (const required of [".claude-plugin/plugin.json", "skills", "data", "LICENSE"]) {
    if (!fs.existsSync(path.join(src, required))) pre.push(`source is missing ${required} (is the submodule checked out? ${src})`);
  }
  if (pre.length) throw new PluginBuildError(pre);
  if (out === src || out.startsWith(src + path.sep) || src.startsWith(out + path.sep)) {
    throw new PluginBuildError([`refusing to build: out (${out}) overlaps src (${src})`]);
  }

  const sourceSkills = listSourceSkills(src);
  const classification = classificationProblems(sourceSkills);
  if (classification.length) throw new PluginBuildError(classification);

  // --- wipe + recreate -----------------------------------------------------------------------
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const written: string[] = [];
  const excluded: string[] = [];

  // plugin.json verbatim
  copyFile(path.join(src, ".claude-plugin", "plugin.json"), path.join(out, ".claude-plugin", "plugin.json"));
  written.push(".claude-plugin/plugin.json");

  // kept skills (symlinks resolved; excluded file types skipped and reported)
  const keptSkills = [...KEPT_SKILLS].sort();
  const skillsSrc = fs.realpathSync(path.join(src, "skills"));
  for (const skill of keptSkills) {
    const dir = path.join(skillsSrc, skill);
    for (const rel of walkFiles(dir)) {
      const srcRel = `skills/${skill}/${rel}`;
      if (isExcludedFile(rel)) {
        excluded.push(srcRel);
        continue;
      }
      copyFile(path.join(dir, rel), path.join(out, "skills", skill, rel));
      written.push(srcRel);
    }
  }

  // data/*.json (top level only — the toolkit keeps them flat)
  const dataFiles = sortedNames(path.join(src, "data")).filter(
    (n) => n.endsWith(".json") && fs.statSync(path.join(src, "data", n)).isFile(),
  );
  for (const n of dataFiles) {
    copyFile(path.join(src, "data", n), path.join(out, "data", n));
    written.push(`data/${n}`);
  }

  // LICENSE
  copyFile(path.join(src, "LICENSE"), path.join(out, "LICENSE"));
  written.push("LICENSE");

  // PRUNED.md
  fs.writeFileSync(path.join(out, PRUNED_MD), renderPrunedMd({ keptSkills, excluded, dataFiles }), "utf8");
  written.push(PRUNED_MD);

  // --- validate ------------------------------------------------------------------------------
  const { problems, allowedMentionHits } = validatePlugin(out);
  if (problems.length) throw new PluginBuildError(problems);

  written.sort();
  return {
    src,
    out,
    written,
    excluded,
    keptSkills,
    prunedSkills: Object.keys(PRUNED_SKILLS).sort(),
    allowedMentionHits: allowedMentionHits.sort(),
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let src: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src") src = argv[++i];
    else if (a === "--out") out = argv[++i];
    else {
      console.error(`unknown argument ${a}\nusage: tsx scripts/build-plugin.ts [--src <toolkit root>] [--out <dir>]`);
      return 2;
    }
  }
  try {
    const r = buildPlugin({ src, out });
    console.log(`build-plugin: wrote ${r.written.length} files to ${r.out}`);
    console.log(`  kept skills: ${r.keptSkills.length}, pruned skills: ${r.prunedSkills.length}`);
    console.log(`  excluded files inside kept skills: ${r.excluded.length === 0 ? "none" : r.excluded.join(", ")}`);
    console.log(`  allowed pattern mentions: ${r.allowedMentionHits.join(", ")}`);
    return 0;
  } catch (e) {
    console.error(e instanceof PluginBuildError ? e.message : e);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
