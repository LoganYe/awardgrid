/**
 * The Anthropic key's Keychain item, against a fake SecureStorage plugin (design §7).
 *
 * The fake keeps items by name, as the plugin keeps them under its prefix, and vitest records every call. The
 * seats.aero key's store (keychain.ts, unchanged) runs against the same fake, so these tests can show that the two
 * items never touch each other, and that nothing here changes the plugin's global defaults keychain.ts relies on.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => {
  const items = new Map<string, unknown>();
  const SecureStorage = {
    get: vi.fn(async (key: string, _convertDate?: boolean, _sync?: boolean): Promise<unknown> => (items.has(key) ? items.get(key) : null)),
    set: vi.fn(async (key: string, data: unknown, _convertDate?: boolean, _sync?: boolean, _access?: number): Promise<void> => {
      items.set(key, data);
    }),
    remove: vi.fn(async (key: string, _sync?: boolean): Promise<boolean> => items.delete(key)),
    clear: vi.fn(async (_sync?: boolean): Promise<void> => items.clear()),
    setSynchronize: vi.fn(async (_sync: boolean): Promise<void> => {}),
    setDefaultKeychainAccess: vi.fn(async (_access: number): Promise<void> => {}),
  };
  return { items, SecureStorage };
});

vi.mock("@aparajita/capacitor-secure-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aparajita/capacitor-secure-storage")>();
  return { ...actual, SecureStorage: plugin.SecureStorage };
});

import { KeychainAccess } from "@aparajita/capacitor-secure-storage";
import { ANTHROPIC_KEY_ITEM, anthropicKeychain } from "./anthropic-key";
import { keychain } from "./keychain";

const ANTHROPIC_KEY = "sk-ant-api03-keychain-test-key-DO_NOT_LEAK";
const SEATS_KEY = "pro_keychain_test_key_DO_NOT_LEAK";
const storage = plugin.SecureStorage;

beforeEach(() => {
  plugin.items.clear();
});

describe("anthropicKeychain", () => {
  it("stores the trimmed key in its own item, passing whenUnlockedThisDeviceOnly and sync false on the call", async () => {
    await anthropicKeychain.set(`  ${ANTHROPIC_KEY}\n`);
    expect(ANTHROPIC_KEY_ITEM).toBe("anthropic_api_key");
    expect(KeychainAccess.whenUnlockedThisDeviceOnly).toBe(1);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith("anthropic_api_key", ANTHROPIC_KEY, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  });

  it("never changes the plugin's global defaults, which keychain.ts sets for the seats.aero item", async () => {
    await anthropicKeychain.set(ANTHROPIC_KEY);
    await anthropicKeychain.get();
    await anthropicKeychain.clear();
    expect(storage.setDefaultKeychainAccess).not.toHaveBeenCalled();
    expect(storage.setSynchronize).not.toHaveBeenCalled();
  });

  it("reads its own item with sync false and no date conversion", async () => {
    await anthropicKeychain.set(ANTHROPIC_KEY);
    expect(await anthropicKeychain.get()).toBe(ANTHROPIC_KEY);
    expect(storage.get).toHaveBeenCalledWith("anthropic_api_key", false, false);
  });

  it("reads anything but a non-empty string as no key, and a plugin that throws as no key", async () => {
    expect(await anthropicKeychain.get()).toBeNull();
    plugin.items.set(ANTHROPIC_KEY_ITEM, "");
    expect(await anthropicKeychain.get()).toBeNull();
    plugin.items.set(ANTHROPIC_KEY_ITEM, 12345);
    expect(await anthropicKeychain.get()).toBeNull();
    storage.get.mockRejectedValueOnce(new Error("errSecItemNotFound"));
    expect(await anthropicKeychain.get()).toBeNull();
  });

  it.each(["", "   ", "\n\t"])("refuses to store an empty key (%j) without touching the Keychain", async (blank) => {
    await expect(anthropicKeychain.set(blank)).rejects.toThrow("Refusing to store an empty Anthropic key.");
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("lets a Keychain failure on save reach the caller, which shows it as a failure", async () => {
    storage.set.mockRejectedValueOnce(new Error("OSStatus -34018"));
    await expect(anthropicKeychain.set(ANTHROPIC_KEY)).rejects.toThrow("OSStatus -34018");
  });

  it("removing the Anthropic key removes its item only: the seats.aero key stays on file", async () => {
    await keychain.set(SEATS_KEY);
    await anthropicKeychain.set(ANTHROPIC_KEY);

    await anthropicKeychain.clear();

    expect(await anthropicKeychain.get()).toBeNull();
    expect(await keychain.get()).toBe(SEATS_KEY);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith("anthropic_api_key", false);
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it("saving the seats.aero key after this one leaves this item as it was saved", async () => {
    await anthropicKeychain.set(ANTHROPIC_KEY);
    await keychain.set(SEATS_KEY);
    expect(await anthropicKeychain.get()).toBe(ANTHROPIC_KEY);
    // The only access class this item was ever saved with is the one passed on its own call.
    expect(storage.set.mock.calls.filter(([key]) => key === ANTHROPIC_KEY_ITEM).map((call) => call[4])).toEqual([KeychainAccess.whenUnlockedThisDeviceOnly]);
  });

  it("treats removing a key that is already gone as done", async () => {
    storage.remove.mockRejectedValueOnce(new Error("errSecItemNotFound"));
    await expect(anthropicKeychain.clear()).resolves.toBeUndefined();
  });
});

describe("the shell's Keychain calls, read from source", () => {
  const SHELL_SRC = path.join(import.meta.dirname, "..");
  // Tests included: a test that reached the real plugin's clear() would remove both keys from a device too.
  const sources = walk(SHELL_SRC).filter((f) => /\.(ts|tsx)$/.test(f));

  it("no file in apps/ios/src, tests included, uses SecureStorage.clear(), which would remove both keys", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((file) => /\.test\.tsx?$/.test(file))).toBe(true);
    expect(sources.flatMap((file) => storageUses(file, "clear").map((line) => `${path.relative(SHELL_SRC, file)}:${line}`))).toEqual([]);
  });

  it("finds clear() however the plugin is reached: aliased, through a namespace, copied, by index, or destructured", () => {
    const text = [
      'import { SecureStorage as Vault } from "@aparajita/capacitor-secure-storage";',
      'import * as Plugin from "@aparajita/capacitor-secure-storage";',
      "await Vault.clear();",
      'await Plugin.SecureStorage["clear"]();',
      "const copy = Vault;",
      "const later = copy.clear;",
      "const { clear } = Plugin.SecureStorage;",
      "const { clear: wipe } = copy;",
      "const other = { clear() {} };",
      "other.clear();",
      "// SecureStorage.clear() in a comment is not a use",
    ].join("\n");
    expect(storageUsesIn("probe.ts", text, "clear")).toEqual([3, 4, 6, 7, 8]);
  });

  it("anthropic-key.ts never sets the plugin's defaults", () => {
    const file = path.join(import.meta.dirname, "anthropic-key.ts");
    expect(storageUses(file, "setDefaultKeychainAccess")).toEqual([]);
    expect(storageUses(file, "setSynchronize")).toEqual([]);
    // The calls it does make are found, so the empty results above are not a scan that sees nothing.
    expect(storageUses(file, "set")).toHaveLength(1);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const PLUGIN_MODULE = "@aparajita/capacitor-secure-storage";

function storageUses(file: string, method: string): number[] {
  return storageUsesIn(file, readFileSync(file, "utf8"), method);
}

/**
 * Lines where a file reaches the plugin's `SecureStorage.<method>`, from the AST, so comments that discuss it do not
 * count. The plugin object is followed through a renamed import, a namespace import, and a variable it is copied
 * into; the method counts whether it is called, read, taken by index or destructured.
 */
function storageUsesIn(file: string, text: string, method: string): number[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const storage = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== PLUGIN_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === "SecureStorage") storage.add(element.name.text);
    }
  }
  const isStorage = (node: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(node)) return isStorage(node.expression);
    if (ts.isIdentifier(node)) return storage.has(node.text);
    if (ts.isPropertyAccessExpression(node)) return ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && node.name.text === "SecureStorage";
    if (ts.isElementAccessExpression(node)) {
      return ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "SecureStorage";
    }
    return false;
  };
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // Copies first, until no new one appears, so a use through `const copy = SecureStorage` is found wherever it is.
  for (let grew = true; grew; ) {
    grew = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isStorage(node.initializer) && !storage.has(node.name.text)) {
        storage.add(node.name.text);
        grew = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
  }

  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === method && isStorage(node.expression)) lines.add(lineOf(node));
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === method && isStorage(node.expression)) {
      lines.add(lineOf(node));
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined && isStorage(node.initializer)) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === method) lines.add(lineOf(element));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...lines].sort((a, b) => a - b);
}
