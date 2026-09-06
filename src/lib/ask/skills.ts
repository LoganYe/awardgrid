/**
 * Skill allowlist for the SDK `skills` option (ARCHITECTURE.md §3 "Skill allowlist": exact
 * `plugin:skill` names, no wildcards).
 *
 * Source of truth is the PHYSICAL prune: `scripts/build-plugin.ts` writes only kept skills into
 * build/plugin/skills, and this module lists whatever directories are actually there. The explicit
 * deny list in ./pruned.ts is applied on top, so a pruned skill can never be allowlisted even if a
 * directory with its name reappears in the build output.
 */
import fs from "node:fs";
import path from "node:path";
import { isPrunedSkill } from "./pruned";

/** `.claude-plugin/plugin.json` name of the vendored plugin — the SDK's namespace prefix. */
export const PLUGIN_NAME = "travel-hacker";

/** The skill every ask session must be able to reach (kickoff §7.2, ARCHITECTURE §3.1). */
export const REQUIRED_SKILL = "seats-aero";
export const REQUIRED_SKILL_ID = `${PLUGIN_NAME}:${REQUIRED_SKILL}`;

/** `"travel-hacker:seats-aero"` — the exact form the SDK `skills` allowlist and the init message use. */
export function skillId(name: string): string {
  return `${PLUGIN_NAME}:${name}`;
}

/** Default plugin root: <cwd>/build/plugin (the Next.js server and the CLI both run from the repo root). */
export function defaultPluginRoot(): string {
  return path.resolve(
    process.env.AWARDGRID_PLUGIN_ROOT ?? path.join(process.cwd(), "build", "plugin"),
  );
}

/** True when `pluginRoot` looks like a built plugin (manifest + skills dir + the required skill). */
export function pluginRootExists(pluginRoot: string): boolean {
  try {
    return (
      fs.statSync(path.join(pluginRoot, ".claude-plugin", "plugin.json")).isFile() &&
      fs.statSync(path.join(pluginRoot, "skills", REQUIRED_SKILL, "SKILL.md")).isFile()
    );
  } catch {
    return false;
  }
}

const SKILL_DIR_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Bare skill directory names present under `<pluginRoot>/skills` that contain a SKILL.md, sorted.
 * Pruned names are excluded here as well (defense in depth). Returns [] when the dir is missing.
 */
export function listPluginSkillDirs(pluginRoot: string): string[] {
  const skillsDir = path.join(pluginRoot, "skills");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (!SKILL_DIR_NAME.test(name)) continue;
    if (isPrunedSkill(name)) continue;
    try {
      if (!fs.statSync(path.join(skillsDir, name, "SKILL.md")).isFile()) continue;
    } catch {
      continue;
    }
    out.push(name);
  }
  return out.sort();
}

/** Sorted `travel-hacker:<skill>` ids for the SDK `skills` allowlist. */
export function pluginSkillAllowlist(pluginRoot: string): string[] {
  return listPluginSkillDirs(pluginRoot).map(skillId);
}
