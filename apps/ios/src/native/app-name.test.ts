/**
 * The name iOS shows for the app outside its own screens. The home screen reads CFBundleDisplayName; the alert before
 * seats.aero's sign-in sheet ("… Wants to Use "seats.aero" to Sign In", from ASWebAuthenticationSession in
 * ios/App/App/SeatsAuthPlugin.swift) reads CFBundleName. CFBundleName was $(PRODUCT_NAME), which is the target's name,
 * "App", so a Release build of 1.0 (5) asked whether "App" may sign in. It is written out as AwardGrid; the target,
 * the executable and the module stay "App", so nothing else about the build changes.
 *
 * Xcode copies a literal value into the built Info.plist unchanged, so the source file is what ships; the archive is
 * still inspected before each upload (docs/release/APP_STORE_HANDOFF.md §4.7).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), "../../ios/App");
const read = (path: string) => readFileSync(join(NATIVE, path), "utf8");

/** A top-level string value of the plist, as written in the file (no build setting resolved). */
function plistString(plist: string, key: string): string | null {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1] ?? null;
}

describe("the app's name outside its screens", () => {
  const plist = read("App/Info.plist");

  it("is AwardGrid on the home screen and in the sign-in alert, written out rather than built from the target's name", () => {
    expect(plistString(plist, "CFBundleDisplayName")).toBe("AwardGrid");
    expect(plistString(plist, "CFBundleName")).toBe("AwardGrid");
  });

  it("leaves the target, the executable and the module named App", () => {
    const project = read("App.xcodeproj/project.pbxproj");
    expect(project.match(/PRODUCT_NAME = "\$\(TARGET_NAME\)";/g)).toHaveLength(2);
    expect(plistString(plist, "CFBundleExecutable")).toBe("$(EXECUTABLE_NAME)");
  });

  it("is not renamed by a localized InfoPlist.strings", () => {
    const strings = readdirSync(join(NATIVE, "App"), { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith("InfoPlist.strings"));
    for (const path of strings) expect(read(join("App", path)), path).not.toMatch(/CFBundle(Display)?Name/);
  });
});
