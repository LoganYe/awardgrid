/**
 * The probe build's seats.aero rewrite, offline. It exists only in a probe build, but the rewrite is what step 7's E1
 * relies on to show the injected X-RateLimit-Remaining reaching the observer, so its placement is pinned here.
 */
import { describe, expect, it } from "vitest";
import { withRateLimitObserver } from "../app/bootstrap";
import {
  MOCK_SEATS_PREFIX,
  PROBE_ANTHROPIC_BASE_URL,
  PROBE_RATE_LIMIT_REMAINING,
  PROBE_SERVER,
  ProbeAnthropicHostError,
  e2eBootstrapOptions,
  withAnthropicProbe,
  withSeatsMock,
} from "./probe-transport";

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

describe("withAnthropicProbe (the e2e build)", () => {
  it("sends the SDK's https://api.anthropic.com/ requests to the probe server's /sse/ with the same init", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("{}", { status: 200 }));
    const init = { method: "POST", body: "{\"model\":\"claude-opus-5\"}", headers: { "x-api-key": "sk-ant-probe-invalid-000000" } };
    const wrapped = withAnthropicProbe(fetchImpl);
    await wrapped("https://api.anthropic.com/v1/messages", init);
    await wrapped(new URL("https://api.anthropic.com/v1/models/claude-opus-5"));
    expect(calls).toEqual([
      { url: "http://127.0.0.1:4599/sse/v1/messages", init },
      { url: "http://127.0.0.1:4599/sse/v1/models/claude-opus-5", init: undefined },
    ]);
  });

  it("refuses any other URL naming anthropic.com before the inner transport sees it", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("{}"));
    const wrapped = withAnthropicProbe(fetchImpl);
    for (const url of ["http://api.anthropic.com/v1/messages", "https://API.ANTHROPIC.COM/v1/messages", "https://console.anthropic.com/"]) {
      await expect(wrapped(url)).rejects.toBeInstanceOf(ProbeAnthropicHostError);
    }
    expect(calls).toEqual([]);
  });

  it("leaves seats.aero and the probe server alone", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("ok"));
    const wrapped = withAnthropicProbe(fetchImpl);
    await wrapped("https://seats.aero/partnerapi/routes");
    await wrapped(`${PROBE_SERVER}/log`);
    expect(calls.map((c) => c.url)).toEqual(["https://seats.aero/partnerapi/routes", `${PROBE_SERVER}/log`]);
  });
});

describe("e2eBootstrapOptions", () => {
  it("starts with both keys empty, in memory, and separate", async () => {
    const opts = e2eBootstrapOptions();
    expect(await opts.keys?.get()).toBeNull();
    expect(await opts.anthropicKeys?.get()).toBeNull();
    await opts.keys?.set("demo-key-normal");
    expect(await opts.anthropicKeys?.get()).toBeNull();
    expect(typeof opts.fetchImpl).toBe("function");
    expect(typeof opts.anthropicFetch).toBe("function");
  });
});
