#!/usr/bin/env node
/**
 * Fails the iOS build if anything from the UI/UX test fixtures reached dist/ (docs/uiux-v1, acceptance A01).
 *
 * The fixture host (apps/ios/fixture-host, vite.fixture.config.ts) is a separate Vite root that src/main.tsx
 * never imports, and eslint.config.mjs forbids production iOS source from importing it or core's test fixtures.
 * This check makes the result a tested fact: the bundle Capacitor copies into the Xcode project may contain no
 * fixture-host marker, fake key, synthetic row id, scenario description, fixture file-level note, and no source
 * map entry pointing into fixture-host/ or test/fixtures/.
 *
 * Markers come from the synthetic JSON itself at run time, so a new scenario or row is covered without editing
 * this file. Copy text (copy.zh-en.json en/zh values) is deliberately NOT a marker: T11 adopts it into the real
 * dictionaries; its per-row usage notes and file status are markers instead, since they exist only in the JSON.
 *
 *   node scripts/check-fixture-free-bundle.mjs [distDir]      (run by `pnpm --filter @awardgrid/ios build`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const dist = path.resolve(process.argv[2] ?? path.join(here, "..", "dist"));
const fixtures = path.resolve(here, "..", "..", "..", "packages", "core", "test", "fixtures", "uiux");

/** Strings that exist only in the fixture host. */
const HOST_MARKERS = [
  "fixture-ready",
  "fixture-status",
  "__uiuxFixture",
  "uiux-fixture",
  "fixture-not-a-real",
  "Unknown synthetic scenario",
  "not seeded by the fixture host",
  "FixtureAnthropicRefusedError",
  "FixtureWriteFailedError",
];

function readJson(name) {
  return JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
}

/** Strings that exist only in the synthetic JSON. Short generic words are skipped to avoid false alarms. */
function dataMarkers() {
  const scenarios = readJson("scenarios.json");
  const rows = readJson("availability-rows.json");
  const queries = readJson("query-cases.json");
  const acceptance = readJson("acceptance-cases.json");
  const copy = readJson("copy.zh-en.json");
  return [
    scenarios.format,
    ...scenarios.scenarios.map((s) => s.purpose),
    ...rows.rows.map((r) => r.source_id),
    rows.query.raw_text,
    queries.note,
    acceptance.status,
    ...acceptance.cases.map((c) => c.expected),
    copy.status,
    ...copy.rows.map((r) => r.when),
  ].filter((m) => typeof m === "string" && m.length >= 16);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let files;
try {
  files = walk(dist);
} catch {
  console.error(`check-fixture-free-bundle: no build output at ${dist}`);
  process.exit(2);
}

const markers = [...HOST_MARKERS, ...dataMarkers()];
const problems = [];
for (const file of files) {
  const rel = path.relative(dist, file);
  if (/fixture/i.test(rel)) problems.push(`${rel}: a fixture file name is in the bundle`);
  if (!/\.(js|mjs|css|html|json|map)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".map")) {
    // A source map names every module that went into the chunk. JSON modules may not appear here, which is
    // why the data markers above are checked against the chunks themselves.
    for (const source of JSON.parse(text).sources ?? []) {
      if (/(^|\/)(fixture-host|test\/fixtures)\//.test(source)) problems.push(`${rel}: bundles ${source}`);
    }
    continue;
  }
  for (const marker of markers) if (text.includes(marker)) problems.push(`${rel}: contains "${marker}"`);
}

if (problems.length) {
  console.error("check-fixture-free-bundle: the production bundle contains test-fixture code or data:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-fixture-free-bundle: ${files.length} files, ${markers.length} markers, none found in ${path.relative(process.cwd(), dist) || dist}`);
