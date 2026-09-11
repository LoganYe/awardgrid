/**
 * The probe build's seats.aero rewrite, offline. It exists only in a probe build, but the rewrite is what step 7's E1
 * relies on to show the injected X-RateLimit-Remaining reaching the observer, so its placement is pinned here.
 */
import { describe, expect, it } from "vitest";
import { withRateLimitObserver } from "../app/bootstrap";
import { MOCK_SEATS_PREFIX, PROBE_ANTHROPIC_BASE_URL, PROBE_RATE_LIMIT_REMAINING, PROBE_SERVER, withSeatsMock } from "./probe-transport";

function recordingFetch(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("withSeatsMock", () => {
  it("sends a seats.aero Partner API request to the local mock with the same init", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    const init = { headers: { "Partner-Authorization": "demo-key-normal" } };
    const res = await withSeatsMock(fetchImpl)("https://seats.aero/partnerapi/search?origin_airport=SEA", init);
    expect(calls).toEqual([{ url: `${MOCK_SEATS_PREFIX}search?origin_airport=SEA`, init }]);
    expect(MOCK_SEATS_PREFIX).toBe("http://127.0.0.1:4597/partnerapi/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("[]");
  });

  it("adds x-ratelimit-remaining: 812, which the rate-limit observer above it reads from the seats.aero URL", async () => {
    const { fetchImpl } = recordingFetch(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const seen: Array<string | null> = [];
    const stacked = withRateLimitObserver(withSeatsMock(fetchImpl), (headers) => seen.push(headers.get("x-ratelimit-remaining")));
    const res = await stacked("https://seats.aero/partnerapi/routes?source=united");
    expect(PROBE_RATE_LIMIT_REMAINING).toBe("812");
    expect(seen).toEqual(["812"]);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("keeps a status that has no body, and still adds the header", async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
    const res = await withSeatsMock(fetchImpl)("https://seats.aero/partnerapi/routes");
    expect(res.status).toBe(204);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("812");
  });

  it("leaves every other URL alone, Anthropic's and the probe server's included", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("ok"));
    const wrapped = withSeatsMock(fetchImpl);
    const anthropic = await wrapped("https://api.anthropic.com/v1/models");
    await wrapped(`${PROBE_ANTHROPIC_BASE_URL}/v1/messages`);
    await wrapped(new URL("https://seats.aero/other"));
    expect(calls.map((c) => c.url)).toEqual(["https://api.anthropic.com/v1/models", `${PROBE_SERVER}/sse/v1/messages`, "https://seats.aero/other"]);
    expect(anthropic.headers.get("x-ratelimit-remaining")).toBeNull();
  });
});
