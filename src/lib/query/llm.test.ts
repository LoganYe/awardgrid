import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  PARSER_MODEL_DEFAULT,
  ParseError,
  parseWithLLM,
  resolveParserModel,
  type ParserClient,
  type ParserRequest,
  type ParserResponse,
} from "@/lib/query/llm";
import { parseQuery } from "@/lib/query/parse";
import type { QueryObjectLLM } from "@/lib/query/schema";

const today = "2026-09-06";
const good: QueryObjectLLM = {
  origins: ["HKG"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-07",
  cabins: ["J"],
  programs: null,
  direct_only: false,
  max_miles: null,
  sort_by: "miles_asc",
};

/** A scripted fake: each call pops the next outcome (a response or an error to throw). */
function scripted(outcomes: Array<ParserResponse | Error>): { client: ParserClient; calls: ParserRequest[] } {
  const calls: ParserRequest[] = [];
  const queue = [...outcomes];
  const client: ParserClient = {
    messages: {
      parse: async (params) => {
        calls.push(params);
        const next = queue.shift();
        if (next === undefined) throw new Error("fake client: no scripted outcome left");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

describe("model selection", () => {
  it("defaults to the pinned Haiku snapshot and honours AWARDGRID_PARSER_MODEL", () => {
    expect(PARSER_MODEL_DEFAULT).toBe("claude-haiku-4-5-20251001");
    expect(resolveParserModel({})).toBe(PARSER_MODEL_DEFAULT);
    expect(resolveParserModel({ AWARDGRID_PARSER_MODEL: "  " })).toBe(PARSER_MODEL_DEFAULT);
    expect(resolveParserModel({ AWARDGRID_PARSER_MODEL: "claude-sonnet-4-6" })).toBe("claude-sonnet-4-6");
  });
  it("the real Anthropic client satisfies ParserClient (type-level, no request is made)", () => {
    const real: ParserClient = new Anthropic({ apiKey: "test-key-never-used" });
    expect(typeof real.messages.parse).toBe("function");
  });
});

describe("buildSystemPrompt", () => {
  it("embeds today, the seed, rules and the deterministic hints (without raw_text)", () => {
    const p = buildSystemPrompt(today, { origins: ["HKG"], raw_text: "secret raw text", cabins: ["J"] });
    expect(p).toContain("Today is 2026-09-06");
    expect(p).toContain("SEL: ICN,GMP");
    expect(p).toContain("香港=HKG");
    expect(p).toContain("92 days");
    expect(p).toContain('"origins":["HKG"]');
    expect(p).not.toContain("secret raw text");
    // The program list is generated from SEATS_SOURCES, never hand-maintained.
    expect(p).toContain("programs: seats.aero source codes only (eurobonus, virginatlantic");
    expect(p).toContain(", spirit)");
  });
});

describe("parseWithLLM", () => {
  it("succeeds first try and passes the model + strict output format", async () => {
    const { client, calls } = scripted([{ parsed_output: good, stop_reason: "end_turn" }]);
    const r = await parseWithLLM("国庆 香港到西雅图", { today, partial: {}, client, model: "test-model" });
    expect(r.result).toEqual(good);
    expect(r.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("test-model");
    expect(calls[0]!.max_tokens).toBe(1024);
    expect(calls[0]!.output_config.format.type).toBe("json_schema");
    expect(calls[0]!.messages).toEqual([{ role: "user", content: "国庆 香港到西雅图" }]);
  });

  it("retries exactly once on a schema failure thrown by the SDK", async () => {
    const { client, calls } = scripted([
      new Anthropic.AnthropicError("Failed to parse structured output"),
      { parsed_output: good, stop_reason: "end_turn" },
    ]);
    const r = await parseWithLLM("x", { today, partial: {}, client });
    expect(r.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("retries once on refusal / max_tokens / invalid object, then throws ParseError", async () => {
    for (const bad of [
      { parsed_output: null, stop_reason: "refusal" as const },
      { parsed_output: good, stop_reason: "max_tokens" as const },
      { parsed_output: { ...good, origins: ["hkg"] } as unknown as QueryObjectLLM, stop_reason: "end_turn" as const },
    ]) {
      const { client, calls } = scripted([bad, bad]);
      await expect(parseWithLLM("x", { today, partial: {}, client })).rejects.toBeInstanceOf(ParseError);
      expect(calls).toHaveLength(2);
    }
  });

  it("does not retry transport/API errors", async () => {
    const apiErr = new Anthropic.APIConnectionError({ message: "offline" });
    const { client, calls } = scripted([apiErr, { parsed_output: good, stop_reason: "end_turn" }]);
    await expect(parseWithLLM("x", { today, partial: {}, client })).rejects.toBeInstanceOf(ParseError);
    expect(calls).toHaveLength(1);
  });
});

describe("parseQuery + LLM merge", () => {
  it("deterministic fields win over the LLM; LLM fills the rest and provenance says so", async () => {
    const llmAnswer: QueryObjectLLM = { ...good, cabins: ["F"], direct_only: true, max_miles: 70000, programs: ["alaska"] };
    const { client } = scripted([{ parsed_output: llmAnswer, stop_reason: "end_turn" }]);
    const r = await parseQuery("国庆 香港到西雅图 商务", { today, llmClient: client });
    expect(r.used_llm).toBe(true);
    expect(r.query.cabins).toEqual(["J"]); // deterministic, not the LLM's F
    expect(r.query.date_from).toBe("2026-10-01");
    expect(r.query.direct_only).toBe(true);
    expect(r.query.max_miles).toBe(70000);
    expect(r.query.programs).toEqual(["alaska"]);
    expect(r.provenance.cabins).toBe("deterministic");
    expect(r.provenance.date_from).toBe("llm");
    expect(r.provenance.max_miles).toBe("llm");
  });

  it("expands LLM metro codes to airports and flags codes outside the seed", async () => {
    const answer: QueryObjectLLM = { ...good, origins: ["TYO", "HND"], destinations: ["SEA", "ZZZ"] };
    const { client } = scripted([{ parsed_output: answer, stop_reason: "end_turn" }]);
    const r = await parseQuery("国庆 somewhere nice", { today, llmClient: client });
    expect(r.query.origins).toEqual(["NRT", "HND"]); // TYO expanded, HND deduped
    expect(r.query.destinations).toEqual(["SEA", "ZZZ"]);
    expect(r.provenance.origins).toBe("llm");
    expect(r.warnings.some((w) => w.includes("ZZZ") && w.includes("not in the places list"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("TYO"))).toBe(false);
    // The same notes ride along as structured notices (translated by the UI); one per warning.
    expect(r.notices).toHaveLength(r.warnings.length);
    expect(r.notices.some((n) => n.code === "parse.unknown_codes" && String(n.vars?.codes).includes("ZZZ"))).toBe(true);
  });

  it("an unknown program code from the LLM is a schema failure (retried once), never passed downstream", async () => {
    const bad = { parsed_output: { ...good, programs: ["foo"] } as unknown as QueryObjectLLM, stop_reason: "end_turn" as const };
    const { client, calls } = scripted([bad, bad]);
    await expect(parseQuery("国庆 香港到西雅图", { today, llmClient: client })).rejects.toBeInstanceOf(ParseError);
    expect(calls).toHaveLength(2);
    // The output format sent to the API carries the closed program list (the SDK renders
    // enums into the property description), and zod re-validation enforces it on the way back.
    const schema = JSON.stringify(calls[0]!.output_config.format);
    expect(schema).toContain("aeroplan");
    expect(schema).toContain("spirit");
    expect(schema).not.toContain("foo");
  });

  it("does not call the LLM when everything is deterministic", async () => {
    const { client, calls } = scripted([]);
    const r = await parseQuery("HKG to SEA next month", { today, llmClient: client });
    expect(r.used_llm).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a reversed LLM range collapses to one day with a warning", async () => {
    const { client } = scripted([{ parsed_output: { ...good, date_from: "2026-10-07", date_to: "2026-10-01" }, stop_reason: "end_turn" }]);
    const r = await parseQuery("国庆 香港到西雅图", { today, llmClient: client });
    expect(r.query.date_from).toBe("2026-10-07");
    expect(r.query.date_to).toBe("2026-10-07");
    expect(r.warnings.some((w) => w.includes("before start date"))).toBe(true);
  });

  it("empty text and bad today are rejected", async () => {
    await expect(parseQuery("   ", { today })).rejects.toBeInstanceOf(ParseError);
    await expect(parseQuery("HKG to SEA next month", { today: "2026-13-40" })).rejects.toThrow();
  });
});
