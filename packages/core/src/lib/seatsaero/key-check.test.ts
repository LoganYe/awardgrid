/**
 * Checking a seats.aero key (UI/UX v1 T11): one call, counted; a refused key is "invalid", a lost connection
 * "network"; nothing is sent for an empty key, and a check that sends nothing costs nothing.
 */
import { describe, expect, it } from "vitest";
import { checkSeatsKey } from "./key-check";
import { InMemoryQuotaStore, Quota } from "./quota";

const NOW = new Date("2026-10-18T08:30:00.000Z");

function setup(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  const quota = new Quota({ store: new InMemoryQuotaStore(), now: () => NOW });
  const sent: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    sent.push(url);
    return respond(url, init);
  }) as typeof fetch;
  return { quota, sent, fetchImpl };
}

describe("checkSeatsKey", () => {
  it("an accepted key: one smallest search, one call counted", async () => {
    const { quota, sent, fetchImpl } = setup(async () => new Response(JSON.stringify({ data: [], count: 0, hasMore: false, cursor: 1 }), { status: 200 }));
    expect(await checkSeatsKey({ apiKey: "fixture-good", userId: "local", fetch: fetchImpl, quota })).toEqual({ ok: true, api_calls_used: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/search?");
    expect(sent[0]).toContain("take=10");
    expect(await quota.used("local")).toBe(1);
  });

  it("a refused key is invalid, and the call it cost is counted", async () => {
    const { quota, fetchImpl } = setup(async () => new Response("{}", { status: 401 }));
    expect(await checkSeatsKey({ apiKey: "fixture-bad", userId: "local", fetch: fetchImpl, quota })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await quota.used("local")).toBe(1);
  });

  it("a lost connection is 'network'; an empty key sends nothing and costs nothing", async () => {
    const { quota, fetchImpl } = setup(async () => Promise.reject(new TypeError("offline")));
    expect(await checkSeatsKey({ apiKey: "fixture-key", userId: "local", fetch: fetchImpl, quota })).toMatchObject({ ok: false, reason: "network" });
    const empty = setup(async () => new Response("{}"));
    expect(await checkSeatsKey({ apiKey: "  ", userId: "local", fetch: empty.fetchImpl, quota: empty.quota })).toEqual({ ok: false, reason: "invalid", api_calls_used: 0 });
    expect(empty.sent).toHaveLength(0);
    expect(await empty.quota.used("local")).toBe(0);
  });

  it("a key with a space or line break inside is 'malformed': nothing sent, nothing counted", async () => {
    const { quota, sent, fetchImpl } = setup(async () => new Response("{}"));
    expect(await checkSeatsKey({ apiKey: "abcd\nefgh", userId: "local", fetch: fetchImpl, quota })).toEqual({ ok: false, reason: "malformed", api_calls_used: 0 });
    expect(await checkSeatsKey({ apiKey: "abcd efgh", userId: "local", fetch: fetchImpl, quota })).toMatchObject({ reason: "malformed" });
    expect(sent).toHaveLength(0);
    expect(await quota.used("local")).toBe(0);
  });

  it("with today's calls used up: 'quota' and when the count resets; nothing sent, the count unchanged", async () => {
    const { quota, sent, fetchImpl } = setup(async () => new Response("{}"));
    await quota.increment("local", quota.softLimit);
    expect(await checkSeatsKey({ apiKey: "fixture-key", userId: "local", fetch: fetchImpl, quota })).toEqual({
      ok: false,
      reason: "quota",
      resetAt: "2026-10-19T00:00:00.000Z",
      api_calls_used: 0,
    });
    expect(sent).toHaveLength(0);
    expect(await quota.used("local")).toBe(quota.softLimit);
  });
});
