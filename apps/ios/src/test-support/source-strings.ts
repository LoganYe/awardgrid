/**
 * TEST-ONLY: the shell's source read the way a person reads its copy (moved here from honesty.test.ts, which it was
 * written for, so store-copy.test.ts reads the source the same way). Strings come from the TypeScript AST, never by
 * grepping: comments are never visited, a template literal is joined across its interpolations (`every ${n} hours`
 * reads "every {x} hours"), and JSX text is joined across inline tags (`Next <strong>check</strong>` reads "Next
 * check"), with entities decoded. Declared names and module paths are kept apart from the copy.
 *
 * Not a test file itself (vitest runs only the files named *.test.ts), and never imported by the app.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The TypeScript source under `dir`, tests left out. */
export function sourceFiles(dir: string): string[] {
  return walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
}

export interface Located {
  text: string;
  line: number;
  /** Where the node starts in the file (its offset), for a reader that needs to know which branch it is in. */
  pos: number;
}

export interface Extracted {
  strings: Located[];
  names: Located[];
  imports: string[];
}

/** Tags a sentence runs through. Any other element starts a new block of text. */
export const INLINE_TAGS = new Set(["a", "abbr", "b", "code", "em", "i", "kbd", "mark", "small", "span", "strong", "sub", "sup", "time"]);

/** Named entities a page or JSX is likely to use; the same table as scripts/growth/validate-public-claims.mjs. */
const ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  shy: "", zwj: "", zwnj: "", zerowidthspace: "", wj: "",
  hyphen: "-", dash: "-", minus: "-", ndash: "–", mdash: "—", horbar: "—",
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"', laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  hellip: "…", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", times: "×", rarr: "→", larr: "←",
  thinsp: " ", ensp: " ", emsp: " ", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢",
};

/** TypeScript leaves JSX entities raw (`seats.aero&apos;s`); a reader sees them decoded. One pass, so `&amp;#39;` stays `&#39;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] !== "#") return ENTITIES[ref.toLowerCase()] ?? match;
    const code = ref.charAt(1).toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

export const templateText = (t: ts.TemplateExpression): string => t.head.text + t.templateSpans.map((s) => `{x}${s.literal.text}`).join("");

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, (child) => containsJsx(child) || undefined) ?? false;
}

/** The text of one JSX block: inline children joined into it, block-level children read on their own. */
function jsxBlocks(children: ts.NodeArray<ts.JsxChild>, sf: ts.SourceFile): string[] {
  const blocks: string[] = [];
  let buffer = "";
  const flush = () => {
    const text = decodeEntities(buffer).replace(/\s+/g, " ").trim();
    if (text) blocks.push(text);
    buffer = "";
  };
  const read = (kids: ts.NodeArray<ts.JsxChild>) => {
    for (const kid of kids) {
      if (ts.isJsxText(kid)) {
        buffer += kid.text;
      } else if (ts.isJsxExpression(kid)) {
        const e = kid.expression;
        if (!e) continue; // {/* a comment */}
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) buffer += e.text;
        else if (ts.isTemplateExpression(e)) buffer += templateText(e);
        else if (containsJsx(e)) flush(); // conditional markup is read where it is written
        else buffer += "{x}";
      } else if (ts.isJsxElement(kid) && INLINE_TAGS.has(kid.openingElement.tagName.getText(sf))) {
        read(kid.children);
      } else {
        flush();
      }
    }
  };
  read(children);
  flush();
  return blocks;
}

function isDeclaredName(node: ts.Identifier | ts.PrivateIdentifier | ts.StringLiteral): boolean {
  const p = node.parent;
  if (ts.isPrivateIdentifier(node)) return true;
  // A literal type ("checked_recently") or a quoted key is a name, not copy.
  if (ts.isStringLiteral(node)) return ts.isLiteralTypeNode(p) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node);
  if (ts.isShorthandPropertyAssignment(p)) return true;
  return (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isTypeParameterDeclaration(p)) &&
    p.name === node
  );
}

/** User-visible text, declared names and module paths from one file, via the AST. Comments are never visited. */
export function extract(file: string, code = readFileSync(file, "utf8")): Extracted {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const out: Extracted = { strings: [], names: [], imports: [] };
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isModulePath =
        ts.isImportDeclaration(p) ||
        ts.isExportDeclaration(p) ||
        (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent));
      if (isModulePath) out.imports.push(node.text);
      else if (ts.isStringLiteral(node) && isDeclaredName(node)) out.names.push({ text: node.text, line: lineOf(node), pos: node.getStart(sf) });
      else out.strings.push({ text: node.text, line: lineOf(node), pos: node.getStart(sf) });
    } else if (ts.isTemplateExpression(node)) {
      out.strings.push({ text: templateText(node), line: lineOf(node), pos: node.getStart(sf) });
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const readByParent =
        ts.isJsxElement(node) &&
        INLINE_TAGS.has(node.openingElement.tagName.getText(sf)) &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent));
      if (!readByParent) for (const text of jsxBlocks(node.children, sf)) out.strings.push({ text, line: lineOf(node), pos: node.getStart(sf) });
    } else if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && isDeclaredName(node)) {
      out.names.push({ text: node.text, line: lineOf(node), pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
