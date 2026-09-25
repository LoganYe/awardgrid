/**
 * What the Web may import (UI/UX v1 T18; acceptance A30): no page, component, server route or CLI module reaches the
 * iOS shell (its native adapters hold the device's keys) or its test fixtures, and the server and CLI never pull in
 * the browser-only workspace (localStorage).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsOf = (path: string) => [...readFileSync(path, "utf8").matchAll(/\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? "");

describe("Web import boundaries", () => {
  const web = files(join(ROOT, "src"));

  it("scans a real amount of the Web", () => {
    expect(web.length).toBeGreaterThan(100);
  });

  it("nothing in the Web imports the iOS shell, its native adapters or the fixture host", () => {
    const offending = web.flatMap((path) => importsOf(path).filter((spec) => /apps\/ios|fixture-host|capacitor|@awardgrid\/ios/i.test(spec)).map((spec) => `${relative(ROOT, path)} → ${spec}`));
    expect(offending).toEqual([]);
  });

  it("the server and the CLI never import the browser workspace", () => {
    const serverSide = web.filter((path) => /[/\\]src[/\\](lib|cli)[/\\]/.test(path));
    const offending = serverSide.flatMap((path) => importsOf(path).filter((spec) => spec.includes("components/workspace")).map((spec) => `${relative(ROOT, path)} → ${spec}`));
    expect(serverSide.length).toBeGreaterThan(20);
    expect(offending).toEqual([]);
  });
});
