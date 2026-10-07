/**
 * TEST-ONLY: which of the shell's source files the App Store build (src/app/flags.ts STORE) is made from, read from
 * the source rather than from a build, so store-copy.test.ts can hold their wording without building anything.
 *
 * It walks the imports from src/main.tsx the way the bundler keeps them in that build. An import is followed when the
 * build keeps it: a side-effect import, a re-export, and a value import with at least one use that is live in this
 * flavour. A use is dead when it sits in the branch of a condition the build fixes the other way — `STORE ? … : use`,
 * `ASK_BUILT ? use : …`, `!STORE && use`, `if (E2E) use`, and the same for the inline `import.meta.env` comparisons —
 * and an import whose every use is dead is dropped, as the bundler drops it. Type-only imports never count. A dynamic
 * `import()` is followed when the call itself is live. Imports outside apps/ios/src (core, React) are not followed.
 *
 * It also reports, per file, the source ranges that are dead in this build, so a reader can leave out what the build
 * leaves out.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** What the App Store build fixes, by name: ./flags.ts and the constants App.tsx writes out (VITE_AG_CONNECT=key). */
export const STORE_CONSTANTS: Readonly<Record<string, boolean>> = {
  STORE: true,
  CAN_CONNECT: true,
  ASK_BUILT: false,
  PROBES: false,
  E2E: false,
};

/** The `import.meta.env` values the App Store build is made with. */
const STORE_ENV: Readonly<Record<string, string>> = { VITE_AG_STORE: "1", VITE_AG_PROBES: "", VITE_AG_CONNECT: "" };

type Known = boolean | undefined;

function envValue(node: ts.Expression): string | undefined {
  // import.meta.env.NAME
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "env" &&
    ts.isMetaProperty(node.expression.expression)
  ) {
    return STORE_ENV[node.name.text] ?? "";
  }
  return undefined;
}

/** A condition's value in the App Store build, when the build fixes it. */
export function evaluate(node: ts.Expression, constants: Readonly<Record<string, boolean>> = STORE_CONSTANTS): Known {
  if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, constants);
  if (ts.isIdentifier(node)) return node.text in constants ? constants[node.text] : undefined;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = evaluate(node.operand, constants);
    return inner === undefined ? undefined : !inner;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      const left = evaluate(node.left, constants);
      const right = evaluate(node.right, constants);
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return left === false || right === false ? false : left && right ? true : undefined;
      return left === true || right === true ? true : left === false && right === false ? false : undefined;
    }
    const strict = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if (strict) {
      const env = envValue(node.left);
      if (env !== undefined && (ts.isStringLiteral(node.right) || ts.isNoSubstitutionTemplateLiteral(node.right))) {
        const equal = env === node.right.text;
        return op === ts.SyntaxKind.EqualsEqualsEqualsToken ? equal : !equal;
      }
    }
  }
  return undefined;
}

const within = (node: ts.Node, outer: ts.Node | undefined) => outer !== undefined && node.pos >= outer.pos && node.end <= outer.end;

/** Whether the build never reaches `node`: some condition around it is fixed the other way. */
export function isDead(node: ts.Node, constants: Readonly<Record<string, boolean>> = STORE_CONSTANTS): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) {
      const value = evaluate(parent.condition, constants);
      if (value === false && within(child, parent.whenTrue)) return true;
      if (value === true && within(child, parent.whenFalse)) return true;
    } else if (ts.isBinaryExpression(parent) && within(child, parent.right)) {
      const op = parent.operatorToken.kind;
      const left = evaluate(parent.left, constants);
      if (op === ts.SyntaxKind.AmpersandAmpersandToken && left === false) return true;
      if (op === ts.SyntaxKind.BarBarToken && left === true) return true;
    } else if (ts.isIfStatement(parent)) {
      const value = evaluate(parent.expression, constants);
      if (value === false && within(child, parent.thenStatement)) return true;
      if (value === true && within(child, parent.elseStatement)) return true;
    }
  }
  return false;
}

/** The dead ranges of one file, as [start, end) offsets. */
export function deadRanges(sf: ts.SourceFile, constants: Readonly<Record<string, boolean>> = STORE_CONSTANTS): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (isDead(node, constants)) {
      ranges.push([node.getStart(sf), node.end]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ranges;
}

function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The local names an import declaration binds to values (type-only ones left out). */
function valueBindings(decl: ts.ImportDeclaration): string[] {
  const clause = decl.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) if (!el.isTypeOnly) names.push(el.name.text);
  return names;
}

/** The imports of one file the App Store build keeps, as resolved paths inside apps/ios/src. */
export function liveImports(file: string, constants: Readonly<Record<string, boolean>> = STORE_CONSTANTS): string[] {
  const sf = parse(file);
  const out = new Set<string>();
  const uses = new Map<string, ts.Identifier[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent) && !ts.isNamespaceImport(node.parent)) {
      const list = uses.get(node.text) ?? [];
      list.push(node);
      uses.set(node.text, list);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const target = resolve(file, node.arguments[0].text);
      if (target && !isDead(node, constants)) out.add(target);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
      const target = resolve(file, statement.moduleSpecifier.text);
      if (target) out.add(target);
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolve(file, statement.moduleSpecifier.text);
    if (!target) continue;
    if (!statement.importClause) {
      out.add(target); // a side-effect import
      continue;
    }
    const live = valueBindings(statement).some((name) => (uses.get(name) ?? []).some((use) => !isDead(use, constants)));
    if (live) out.add(target);
  }
  return [...out];
}

/** Every source file of apps/ios/src the App Store build is made from, starting at src/main.tsx. */
export function storeSources(entry: string, constants: Readonly<Record<string, boolean>> = STORE_CONSTANTS): string[] {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of liveImports(queue.shift()!, constants)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].sort();
}

export { parse as parseSource };
