/**
 * Table-driven parser fixtures (kickoff Phase 1: ≥ 20 bilingual parsing fixtures).
 * No network: the LLM is a fake client returning the fixture's `llm` object.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, formatISODate, parseISODate } from "@/lib/query/dates";
import { parseDeterministic } from "@/lib/query/deterministic";
import { ParseError, type ParserClient, type ParserRequest } from "@/lib/query/llm";
import { parseQuery } from "@/lib/query/parse";
import type { QueryObjectLLM } from "@/lib/query/schema";

interface Expect {
  origins?: string[];
  destinations?: string[];
  cabins?: string[];
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  direct_only?: boolean;
  max_miles?: number;
  programs?: string[];
  language?: string;
  used_llm?: boolean;
  provenance?: Record<string, string>;
  warnings_contains?: string;
  error?: string;
}

interface Case {
  name: string;
  text: string;
  today: string;
  missing?: string[];
  llm?: QueryObjectLLM;
  expect: Expect;
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/queries/cases.json", import.meta.url), "utf8"),
) as { cases: Case[] };

/** "today" / "today+N" / literal ISO date → ISO date. */
function resolveDate(spec: string, today: string): string {
  const m = /^today(?:\+(\d+))?$/.exec(spec);
  if (!m) return spec;
  return formatISODate(addDays(parseISODate(today), Number(m[1] ?? 0)));
}

function fakeClient(answer: QueryObjectLLM, calls: ParserRequest[]): ParserClient {
  return {
    messages: {
      parse: async (params) => {
        calls.push(params);
        return { parsed_output: answer, stop_reason: "end_turn" };
      },
    },
  };
}

describe("parser fixtures", () => {
  it("has at least 24 cases", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(24);
  });

  for (const c of fixture.cases) {
    it(c.name, async () => {
      if (c.missing) {
        const det = parseDeterministic(c.text, { today: c.today });
        expect(det.missing).toEqual(c.missing);
      }

      const calls: ParserRequest[] = [];
      const llmClient = c.llm ? fakeClient(c.llm, calls) : undefined;
      const e = c.expect;

      if (e.error !== undefined) {
        const err = await parseQuery(c.text, { today: c.today, llmClient }).catch((x: unknown) => x);
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).message).toContain(e.error);
        if (c.missing) expect((err as ParseError).missing).toEqual(c.missing);
        return;
      }

      const res = await parseQuery(c.text, { today: c.today, llmClient });
      const q = res.query;
      expect(q.raw_text).toBe(c.text);
      if (e.origins) expect(q.origins).toEqual(e.origins);
      if (e.destinations) expect(q.destinations).toEqual(e.destinations);
      if (e.cabins) expect(q.cabins).toEqual(e.cabins);
      if (e.date_from) expect(q.date_from).toBe(resolveDate(e.date_from, c.today));
      if (e.date_to) expect(q.date_to).toBe(resolveDate(e.date_to, c.today));
      if (e.sort_by) expect(q.sort_by).toBe(e.sort_by);
      if (e.direct_only !== undefined) expect(q.direct_only).toBe(e.direct_only);
      if (e.max_miles !== undefined) expect(q.max_miles).toBe(e.max_miles);
      if (e.programs) expect(q.programs).toEqual(e.programs);
      if (e.language) expect(q.language).toBe(e.language);
      if (e.used_llm !== undefined) {
        expect(res.used_llm).toBe(e.used_llm);
        expect(calls.length).toBe(e.used_llm ? 1 : 0);
      }
      if (e.provenance) {
        for (const [field, p] of Object.entries(e.provenance)) expect(res.provenance[field]).toBe(p);
      }
      if (e.warnings_contains) {
        expect(res.warnings.some((w) => w.includes(e.warnings_contains!))).toBe(true);
      }
      if (calls.length > 0) {
        // The LLM request must carry today's date, the seed and the deterministic hints, and use strict output.
        const req = calls[0]!;
        expect(req.max_tokens).toBe(1024);
        expect(req.output_config.format.type).toBe("json_schema");
        const system = String(req.system);
        expect(system).toContain(c.today);
        expect(system).toContain("TYO: NRT,HND");
        expect(system).toContain("Already known");
      }
    });
  }
});
