import { describe, expect, it } from "vitest";
import { AskRequestBody, parseWireEvent, redactSecrets, sseFrame, toWireEvent, usageResponse } from "./wire";

describe("wire", () => {
  it("sseFrame produces `event: <type>\\ndata: <json>\\n\\n` on a single data line", () => {
    expect(sseFrame("text", { type: "text", text: "a\nb" })).toBe('event: text\ndata: {"type":"text","text":"a\\nb"}\n\n');
  });

  it("redactSecrets masks raw and JSON-escaped forms and skips short/empty secrets", () => {
    const key = 'pro_key_"quoted"_1234';
    const json = JSON.stringify({ text: `k=${key}` });
    expect(redactSecrets(json, [key, undefined, "short"])).not.toContain("quoted");
    expect(redactSecrets(json, [key])).toContain("••••");
    expect(redactSecrets("nothing here", [key, ""])).toBe("nothing here");
  });

  it("toWireEvent passes objects through and turns garbage into an internal error", () => {
    expect(toWireEvent({ type: "tool", name: "Skill" })).toEqual({ type: "tool", data: { type: "tool", name: "Skill" } });
    expect(toWireEvent("nope").type).toBe("error");
  });

  it("parseWireEvent tolerates snake_case fields and falls back to the SSE event name", () => {
    expect(parseWireEvent('{"text":"hi"}', "text")).toEqual({ type: "text", text: "hi" });
    expect(parseWireEvent('{"type":"result","total_cost_usd":0.5,"num_turns":2,"subtype":"success"}')).toEqual({ type: "result", costUsd: 0.5, numTurns: 2, subtype: "success" });
    expect(parseWireEvent("not json")).toBeNull();
    expect(parseWireEvent("[]")).toBeNull();
  });

  it("AskRequestBody trims and bounds the prompt and validates the cell", () => {
    expect(AskRequestBody.safeParse({ prompt: "  ok  " }).data?.prompt).toBe("ok");
    expect(AskRequestBody.safeParse({ prompt: "   " }).success).toBe(false);
    expect(AskRequestBody.safeParse({ prompt: "x", context: { cell: { origin: "SEA" } } }).success).toBe(false);
  });

  it("usageResponse fills remaining and resetAt (next UTC midnight)", () => {
    const now = new Date("2026-09-06T13:00:00Z");
    expect(usageResponse({ spentUsd: 0.5, capUsd: 2 }, now)).toEqual({ spentUsd: 0.5, capUsd: 2, remainingUsd: 1.5, resetAt: "2026-09-07T00:00:00.000Z" });
    expect(usageResponse(null, now).capUsd).toBe(0);
  });
});
