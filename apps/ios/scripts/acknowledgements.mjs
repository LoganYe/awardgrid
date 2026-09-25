#!/usr/bin/env node
/**
 * The Acknowledgements page's data (src/about/acknowledgements.json), taken from what actually ships (release handoff
 * §3.5: the MIT, ISC and OFL licenses require their notice to travel with the copies):
 *
 *   - every npm package a source map beside the bundle names (vite.config.ts moves the maps to dist-sourcemaps/, so
 *     they list exactly the modules the chunks were built from);
 *   - the native pods the app links, with the versions in ios/App/Podfile.lock: Capacitor and CapacitorCordova
 *     (@capacitor/ios), AparajitaCapacitorSecureStorage and CapacitorFilesystem (their npm packages, already listed
 *     from the maps), KeychainSwift and IONFilesystemLib (ios/App/Pods). CapacitorCordova also carries Apache Cordova
 *     source files under the Apache License 2.0, whose text goes with them (the standard text, as TypeScript ships it);
 *   - the Inter font in public/fonts, whose license file ships beside it.
 *
 * A package that ships no license file of its own gets its license's standard text with the copyright holder its
 * package.json names, and says so (`noticeFrom: "package.json"`). A package whose license file is another license
 * than its package.json declares (@capacitor/synapse: ISC declared, an MIT file) gets both texts, under both names;
 * any other disagreement stops the script for a person to read.
 *
 *   node scripts/acknowledgements.mjs            write the JSON (after `vite build`)
 *   node scripts/acknowledgements.mjs --check    fail when the JSON is not what ships (run by `pnpm build`)
 *
 * Without ios/App/Pods (a checkout that never ran pod install) the two pods' entries cannot be read again: --check
 * then compares everything else and says it did not re-read them.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const here = import.meta.dirname;
const app = path.resolve(here, "..");
const mapsDir = path.join(app, "dist-sourcemaps");
const out = path.join(app, "src", "about", "acknowledgements.json");
const pods = path.join(app, "ios", "App", "Pods");
const podfileLock = path.join(app, "ios", "App", "Podfile.lock");
const require = createRequire(path.join(app, "package.json"));

const MIT = (holder) =>
  `MIT License\n\nCopyright (c) ${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC = (holder) =>
  `ISC License\n\nCopyright (c) ${holder}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** Which license a license file's text is, by its own operative words. */
function familyOf(text) {
  if (/Permission is hereby granted, free of charge/.test(text)) return "MIT";
  if (/Permission to use, copy, modify, and\/or distribute this software/.test(text)) return "ISC";
  if (/This is free and unencumbered software released into the public domain/.test(text)) return "Unlicense";
  if (/Apache License\s+Version 2\.0/.test(text)) return "Apache-2.0";
  return null;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The license file at a package's root, if it ships one. */
function licenseFile(root) {
  const name = licenseFileName(root);
  return name ? readFileSync(path.join(root, name), "utf8").trim() : null;
}

function licenseFileName(root) {
  return readdirSync(root).find((file) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file)) ?? null;
}

function holderOf(pkg) {
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  return author ? author.replace(/\s*<[^>]*>|\s*\([^)]*\)/g, "").trim() : null;
}

/** The npm packages the shipped chunks were built from, each with the root it was bundled from. */
function shippedPackages() {
  const roots = new Map();
  for (const file of walk(mapsDir).filter((f) => f.endsWith(".map"))) {
    for (const source of JSON.parse(readFileSync(file, "utf8")).sources ?? []) {
      const at = source.lastIndexOf("node_modules/");
      if (at < 0) continue;
      const parts = source.slice(at + "node_modules/".length).split("/");
      const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      const absolute = path.resolve(path.dirname(file), source);
      roots.set(name, absolute.slice(0, absolute.lastIndexOf("node_modules/") + "node_modules/".length) + name);
    }
  }
  return roots;
}

function npmEntry(name, root) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== name) throw new Error(`${root}: package.json names ${pkg.name}, not ${name}`);
  const own = licenseFile(root);
  if (own) {
    const family = familyOf(own);
    if (family === null) throw new Error(`${name}: its license file is no license this script knows; read it and add it`);
    if (family === pkg.license) return { name, version: pkg.version, license: pkg.license, kind: "npm", notice: own };
    const holder = own.match(/Copyright \(c\) ([^\n]+)/i)?.[1]?.trim();
    if (pkg.license !== "ISC" || family !== "MIT" || !holder) throw new Error(`${name}: package.json declares ${pkg.license}, its license file is ${family}`);
    const file = licenseFileName(root);
    return {
      name,
      version: pkg.version,
      license: `ISC (package.json), MIT (${file})`,
      kind: "npm",
      notice: `${own}\n\n${name}'s package.json declares the ISC License:\n\n${ISC(holder)}`,
    };
  }
  const holder = holderOf(pkg);
  if (pkg.license !== "MIT" || !holder) throw new Error(`${name} ships no license file, and its ${pkg.license} notice cannot be written from package.json`);
  return { name, version: pkg.version, license: pkg.license, kind: "npm", notice: MIT(holder), noticeFrom: "package.json" };
}

/** Pod versions from the committed Podfile.lock. */
function podVersions() {
  const versions = new Map();
  for (const line of readFileSync(podfileLock, "utf8").split("\n")) {
    const m = line.match(/^ {2}- ([A-Za-z0-9]+) \(([^)]+)\):?$/);
    if (m) versions.set(m[1], m[2]);
  }
  return versions;
}

function podEntries(npmRoots) {
  const versions = podVersions();
  const version = (pod) => {
    const v = versions.get(pod);
    if (!v) throw new Error(`Podfile.lock has no ${pod}`);
    return v;
  };
  const capacitorIos = path.join(app, "node_modules", "@capacitor", "ios");
  const entries = [
    {
      name: "Capacitor and CapacitorCordova (iOS)",
      version: version("Capacitor"),
      license: JSON.parse(readFileSync(path.join(capacitorIos, "package.json"), "utf8")).license,
      kind: "pod",
      notice: licenseFile(capacitorIos),
    },
  ];
  // The other two local pods are the npm packages the maps already list; their pod versions must match.
  for (const [pod, npm] of [
    ["AparajitaCapacitorSecureStorage", "@aparajita/capacitor-secure-storage"],
    ["CapacitorFilesystem", "@capacitor/filesystem"],
  ]) {
    const root = npmRoots.get(npm);
    const pkg = root && JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    if (!pkg || pkg.version !== version(pod)) throw new Error(`${pod} ${version(pod)} is not the ${npm} the bundle ships (${pkg?.version ?? "absent"})`);
  }
  // Apache Cordova code inside CapacitorCordova: the Apache License 2.0 asks for its text to go with the copies, and
  // for any NOTICE file's attributions too (the package ships none today; one appearing stops this script).
  const cordova = walk(path.join(capacitorIos, "CapacitorCordova")).filter((f) => /\.(h|m)$/.test(f) && readFileSync(f, "utf8").includes("Licensed to the Apache Software Foundation"));
  if (cordova.length > 0) {
    if (walk(capacitorIos).some((f) => /^NOTICE(\.[a-z]+)?$/i.test(path.basename(f)))) throw new Error("@capacitor/ios ships a NOTICE file: add its attributions");
    const apache = readFileSync(path.join(path.dirname(require.resolve("typescript/package.json")), "LICENSE.txt"), "utf8").trim();
    if (!apache.startsWith("Apache License") || !apache.includes("Version 2.0, January 2004")) throw new Error("typescript/LICENSE.txt is no longer the Apache License 2.0 text");
    entries.push({
      name: "Apache Cordova (in CapacitorCordova)",
      version: version("CapacitorCordova"),
      license: "Apache-2.0",
      kind: "pod",
      notice: `${cordova.length} source files of CapacitorCordova are Apache Cordova code, licensed to the Apache Software Foundation (ASF) under one or more contributor license agreements and distributed under the Apache License, Version 2.0:\n\n${apache}`,
    });
  }
  let reread = true;
  for (const pod of ["KeychainSwift", "IONFilesystemLib"]) {
    const root = path.join(pods, pod);
    if (!existsSync(root)) {
      reread = false;
      continue;
    }
    entries.push({ name: pod, version: version(pod), license: "MIT", kind: "pod", notice: licenseFile(root) });
  }
  return { entries, reread };
}

function fontEntry() {
  const notice = readFileSync(path.join(app, "public", "fonts", "LICENSE-Inter.txt"), "utf8").trim();
  return { name: "Inter", version: "4.001", license: "OFL-1.1", kind: "font", notice };
}

function build() {
  if (!existsSync(mapsDir)) throw new Error(`No source maps at ${mapsDir}: run \`vite build\` first.`);
  const roots = shippedPackages();
  const npm = [...roots].map(([name, root]) => npmEntry(name, root));
  const { entries: pod, reread } = podEntries(roots);
  for (const entry of [...npm, ...pod]) if (!entry.notice) throw new Error(`${entry.name}: no license text found`);
  const all = [...npm, ...pod, fontEntry()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { all, reread };
}

const { all, reread } = build();
if (process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(out, "utf8"));
  const key = (e) => `${e.kind}:${e.name}`;
  // Without the Pods directory, the two pods read from it cannot be compared; everything else must match exactly.
  const comparable = reread ? committed : committed.filter((e) => !(e.kind === "pod" && (e.name === "KeychainSwift" || e.name === "IONFilesystemLib")));
  const want = JSON.stringify(all.map((e) => [key(e), e]));
  const have = JSON.stringify(comparable.map((e) => [key(e), e]));
  if (want !== have) {
    const names = (list) => new Set(list.map(key));
    const shipped = names(all);
    const listed = names(comparable);
    console.error("acknowledgements: src/about/acknowledgements.json is not what ships. Run `node scripts/acknowledgements.mjs` and commit it.");
    for (const k of shipped) if (!listed.has(k)) console.error(`  ships, not listed: ${k}`);
    for (const k of listed) if (!shipped.has(k)) console.error(`  listed, does not ship: ${k}`);
    process.exit(1);
  }
  console.log(`acknowledgements: ${all.length} entries match what ships${reread ? "" : " (Pods not installed: KeychainSwift and IONFilesystemLib not re-read)"}`);
} else {
  writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`acknowledgements: wrote ${all.length} entries to ${path.relative(process.cwd(), out)}`);
}
