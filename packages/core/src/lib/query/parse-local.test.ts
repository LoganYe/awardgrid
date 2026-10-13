/**
 * parseQueryLocal: parseQuery without the LLM fallback, for a caller that must not bundle an LLM client (the iPhone
 * app). It answers exactly as parseQuery does when no client is passed, throws the same ParseError, and imports
 * neither the LLM parser nor the Anthropic SDK, however deep one looks.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ParseError as ParseErrorFromIndex } from "@/lib/query";
import { ParseError as ParseErrorFromLlm } from "@/lib/query/llm";
import { parseQuery } from "@/lib/query/parse";
import { ParseError } from "@/lib/query/parse-error";
import { parseQueryLocal } from "@/lib/query/parse-local";

const today = "2026-09-06";

/** What a parse ends in: its result, or its failure's class, message, notice and missing fields. */
async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await run() };
  } catch (err) {
    const e = err as ParseError;
    return { failed: e.constructor.name, message: e.message, notice: e.notice, missing: e.missing };
  }
}

describe("parseQueryLocal", () => {
  it.each([
    "HKG to SEA 2026-10-01 to 2026-10-07 business",
    "香港到西雅图 2026年10月1日到10月7日 公务舱",
    "SEA to NRT and HND in October, business and first, nonstop only",
    "HKG to SEA 2026-10-07 to 2026-10-01",
    "SFO to LHR from 2026-10-01 to 2027-03-01",
    "HKG to SEA",
    "next month business",
    "   ",
    "",
  ])("answers %j exactly as parseQuery does with no LLM client", async (text) => {
    const local = await outcome(() => parseQueryLocal(text, { today }));
    expect(local).toEqual(await outcome(() => parseQuery(text, { today })));
  });

  it("names the fields it could not read in a ParseError, the one class every module exports, and never uses an LLM", async () => {
    const err = await parseQueryLocal("HKG to SEA", { today }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParseError);
    expect(ParseErrorFromLlm).toBe(ParseError);
    expect(ParseErrorFromIndex).toBe(ParseError);
    expect((err as ParseError).missing).toEqual(expect.arrayContaining(["date_from", "date_to"]));
    expect((err as ParseError).notice?.code).toBe("parse.missing");
    const read = await parseQueryLocal("HKG to SEA 2026-10-01 to 2026-10-07 business", { today });
    expect(read.used_llm).toBe(false);
    expect(read.query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-07" });
  });

  it("imports neither the LLM parser nor the Anthropic SDK, directly or through any module it reaches", () => {
    const lib = path.resolve(import.meta.dirname, "..");
    const seen = new Set<string>();
    const outside = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // Value imports and re-exports; a type-only import brings no code.
      for (const m of source.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+)";/gms)) {
        const specifier = m[1]!;
        if (!specifier.startsWith(".")) {
          outside.add(specifier);
          continue;
        }
        const target = path.resolve(path.dirname(file), specifier);
        const found = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")].find((candidate) => /\.(tsx?|json)$/.test(candidate) && existsSync(candidate));
        if (found === undefined) throw new Error(`${path.relative(lib, file)}: cannot resolve ${specifier}`);
        if (found.endsWith(".json")) seen.add(found);
        else visit(found);
      }
    };
    visit(path.join(lib, "query", "parse-local.ts"));
    const reached = [...seen].map((file) => path.relative(lib, file));
    expect(reached).toContain("query/deterministic.ts");
    expect(reached).not.toContain("query/llm.ts");
    expect(reached).not.toContain("query/parse.ts");
    expect(reached.filter((file) => file.startsWith("ask/"))).toEqual([]);
    expect([...outside].filter((specifier) => specifier.startsWith("@anthropic-ai/"))).toEqual([]);
  });
});
