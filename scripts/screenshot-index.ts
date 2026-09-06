/**
 * Build `docs/screenshots/v0.2/README.md` — the contact sheet for the Phase 6.6 capture matrix
 * (spec §9) — and check the tree against the naming rule.
 *
 *     pnpm exec tsx scripts/screenshot-index.ts            # write the contact sheet
 *     pnpm exec tsx scripts/screenshot-index.ts --check    # check only, write nothing
 *     pnpm exec tsx scripts/screenshot-index.ts --strict   # also fail on captures outside the matrix
 *
 * The matrix itself lives in `e2e/matrix.ts` (imported here, so the sheet can never describe a
 * different set of states than `e2e/screenshots.spec.ts` captures). This script reads only the
 * file tree: it never runs a browser, so it is safe to run on any machine, offline.
 *
 * Exit code 1 on:
 *   - a directory under docs/screenshots/v0.2/ that is not a known page,
 *   - a file that is not a PNG named `<state>-<viewport>-<theme>[-zh].png`,
 *   - a matrix entry with no PNG on disk,
 *   - (with --strict) a PNG that is not in the matrix.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DETAIL_PAGES,
  expectedFiles,
  FILE_RE,
  MATRIX,
  MATRIX_PAGES,
  NON_CAPTURE_FILES,
  SHOT_ROOT,
  shotFile,
  THEMES,
  VIEWPORTS,
  type MatrixPage,
} from "../e2e/matrix";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, ...SHOT_ROOT.split("/"));
const BEFORE = "before";
const KNOWN_DIRS: readonly string[] = [...MATRIX_PAGES, ...DETAIL_PAGES, BEFORE];

/** 400 KB: Playwright's PNGs are already small; anything above this wants looking at. */
const SIZE_BUDGET = 400 * 1024;

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const STRICT = args.has("--strict");

const problems: string[] = [];
const warnings: string[] = [];

interface Capture {
  dir: string;
  file: string;
  bytes: number;
}

/** Every PNG under the tree, grouped by directory, sorted by name. */
function readTree(): Map<string, Capture[]> {
  const out = new Map<string, Capture[]>();
  const entries = readdirSync(DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isFile()) {
      if (!(NON_CAPTURE_FILES as readonly string[]).includes(entry.name)) problems.push(`${SHOT_ROOT}/${entry.name}: loose file (captures live in a page folder)`);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!KNOWN_DIRS.includes(entry.name)) {
      problems.push(`${SHOT_ROOT}/${entry.name}/: unknown page folder (known: ${KNOWN_DIRS.join(", ")})`);
      continue;
    }
    const files: Capture[] = [];
    for (const file of readdirSync(path.join(DIR, entry.name)).sort((a, b) => a.localeCompare(b))) {
      if ((NON_CAPTURE_FILES as readonly string[]).includes(file)) continue;
      if (!FILE_RE.test(file)) {
        problems.push(`${SHOT_ROOT}/${entry.name}/${file}: does not match <state>-<viewport>-<theme>[-zh].png`);
        continue;
      }
      const bytes = statSync(path.join(DIR, entry.name, file)).size;
      if (bytes > SIZE_BUDGET) warnings.push(`${SHOT_ROOT}/${entry.name}/${file}: ${(bytes / 1024).toFixed(0)} KB (budget ${SIZE_BUDGET / 1024} KB)`);
      files.push({ dir: entry.name, file, bytes });
    }
    out.set(entry.name, files);
  }
  return out;
}

/** `<stem>-<viewport>-<theme>[-zh].png` → the stem, with the `-zh` folded back in. */
function stemOf(file: string): string {
  const m = /^(.*)-(desktop|mobile)-(light|dark)(-zh)?\.png$/.exec(file);
  return m ? `${m[1]}${m[4] ?? ""}` : file;
}

const COLUMNS = VIEWPORTS.flatMap((viewport) => THEMES.map((theme) => ({ viewport, theme, label: `${viewport} ${theme}` })));

/** One `<img>` cell, or an em dash when that combination is deliberately not captured. */
function cell(dir: string, file: string, present: Set<string>): string {
  if (!present.has(file)) return "—";
  const href = `./${dir}/${file}`;
  return `<a href="${href}"><img src="${href}" alt="${file}" width="180"></a>`;
}

function tableFor(dir: string, rows: { state: string; zh?: boolean; what?: string }[], present: Set<string>): string[] {
  const lines = [`| State | ${COLUMNS.map((c) => c.label).join(" | ")} |`, `|---|${COLUMNS.map(() => "---").join("|")}|`];
  for (const row of rows) {
    const label = row.what ? `**${row.state}${row.zh ? " (zh)" : ""}**<br>${row.what}` : `**${row.state}${row.zh ? " (zh)" : ""}**`;
    const cells = COLUMNS.map((c) => cell(dir, shotFile(row.state, c.viewport, c.theme, row.zh), present));
    lines.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  return lines;
}

function main(): void {
  const tree = readTree();

  // Completeness: every matrix entry has its PNG.
  const onDisk = new Set<string>();
  for (const [dir, files] of tree) for (const f of files) onDisk.add(`${dir}/${f.file}`);
  const missing = expectedFiles().filter((f) => !onDisk.has(f));
  for (const f of missing) problems.push(`${SHOT_ROOT}/${f}: missing (declared in e2e/matrix.ts)`);

  // Captures a matrix page holds that the matrix does not declare. The per-feature specs
  // (grid.spec.ts, chips.spec.ts, …) still write a few of these; they are listed in the sheet.
  const expected = new Set(expectedFiles());
  const extras = new Map<MatrixPage, string[]>();
  for (const page of MATRIX_PAGES) {
    const list = (tree.get(page) ?? []).map((f) => f.file).filter((f) => !expected.has(`${page}/${f}`));
    if (list.length > 0) extras.set(page, list);
    if (STRICT) for (const f of list) problems.push(`${SHOT_ROOT}/${page}/${f}: not declared in e2e/matrix.ts`);
  }

  if (problems.length > 0) {
    console.error(`screenshot-index: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exitCode = 1;
    if (CHECK_ONLY) return;
  }
  if (warnings.length > 0) console.warn(`screenshot-index: ${warnings.length} oversized PNG(s)\n${warnings.map((w) => `  - ${w}`).join("\n")}`);

  const all = [...tree.values()].flat();
  const totalBytes = all.reduce((sum, f) => sum + f.bytes, 0);
  const largest = Math.max(0, ...all.map((f) => f.bytes));

  if (CHECK_ONLY) {
    console.log(`screenshot-index: ${all.length} PNGs, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, largest ${(largest / 1024).toFixed(0)} KB — check only, nothing written`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [
    "# Screenshots — v0.2",
    "",
    "Every image on this page is a capture of the offline demo build: the `DEMO=1` mock seats.aero",
    "server (`fixtures/demo/`, synthetic data), the seeded e2e users and the scripted Ask stream.",
    "**Nothing here is real award data**, and no key, network call or account is involved.",
    "",
    `Generated ${today} by:`,
    "",
    "```sh",
    "pnpm build && pnpm e2e -g screenshots      # capture the matrix (four projects)",
    "pnpm exec tsx scripts/screenshot-index.ts  # rebuild this page",
    "```",
    "",
    `File names follow spec §9: \`<page>/<state>-<viewport>-<theme>[-zh].png\` — desktop is 1440×900,`,
    "mobile 390×844, themes light and dark. The matrix is declared once, in `e2e/matrix.ts`, and",
    "captured by `e2e/screenshots.spec.ts`.",
    "",
    `${all.length} PNGs, ${(totalBytes / 1024 / 1024).toFixed(1)} MB in total; largest ${(largest / 1024).toFixed(0)} KB.`,
    "",
    "## Contents",
    "",
    ...MATRIX_PAGES.map((p) => `- [${p}](#${p})`),
    ...DETAIL_PAGES.map((p) => `- [${p} (per-feature detail)](#${p}-per-feature-detail)`),
    "- [before (v0.1)](#before-v01)",
    "",
  ];

  for (const page of MATRIX_PAGES) {
    const present = new Set((tree.get(page) ?? []).map((f) => f.file));
    const rows = MATRIX.filter((s) => s.page === page).map((s) => ({ state: s.state, zh: s.zh, what: s.what }));
    out.push(`## ${page}`, "", ...tableFor(page, rows, present), "");
    const extra = extras.get(page);
    if (extra && extra.length > 0) {
      const stems = [...new Set(extra.map(stemOf))].sort();
      out.push(
        `Also in this folder, written by the feature specs rather than the matrix: ${stems.map((s) => `\`${s}\``).join(", ")}.`,
        "",
      );
    }
  }

  for (const page of DETAIL_PAGES) {
    const files = tree.get(page) ?? [];
    if (files.length === 0) continue;
    const present = new Set(files.map((f) => f.file));
    const stems = [...new Set(files.map((f) => stemOf(f.file)))].sort();
    const rows = stems.map((stem) => (stem.endsWith("-zh") ? { state: stem.slice(0, -3), zh: true } : { state: stem }));
    out.push(
      `## ${page} (per-feature detail)`,
      "",
      `Captured by \`e2e/${page}.spec.ts\` while it asserts that feature's semantics. These are extra`,
      "detail on states the matrix already covers from the page's point of view.",
      "",
      ...tableFor(page, rows, present),
      "",
    );
  }

  const beforeFiles = tree.get(BEFORE) ?? [];
  if (beforeFiles.length > 0) {
    const present = new Set(beforeFiles.map((f) => f.file));
    const stems = [...new Set(beforeFiles.map((f) => stemOf(f.file)))].sort();
    out.push(
      "## before (v0.1)",
      "",
      "The Phase 6.0 record of the v0.1 UI, captured once by `e2e/before.spec.ts` before any of this",
      "phase's work landed. **These are never regenerated** — they are the \"before\" half of every PR",
      "description. Names here carry the page as well as the state:",
      "`<page>-<state>-<viewport>-<theme>.png`.",
      "",
      ...tableFor(BEFORE, stems.map((state) => ({ state })), present),
      "",
    );
  }

  writeFileSync(path.join(DIR, "README.md"), `${out.join("\n").trimEnd()}\n`, "utf8");
  console.log(
    `screenshot-index: wrote ${SHOT_ROOT}/README.md — ${all.length} PNGs, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, largest ${(largest / 1024).toFixed(0)} KB`,
  );
}

main();
