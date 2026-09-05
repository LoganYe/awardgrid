import { describe, expect, it, vi } from "vitest";
import { seatsFetchFromEnv } from "./seats-fetch";

describe("seatsFetchFromEnv", () => {
  it("is inert when SEATS_AERO_BASE_URL is unset", () => {
    expect(seatsFetchFromEnv({})).toBeUndefined();
    expect(seatsFetchFromEnv({ SEATS_AERO_BASE_URL: "  " })).toBeUndefined();
  });

  it("rewrites only seats.aero partner API URLs to the configured base", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      const f = seatsFetchFromEnv({ SEATS_AERO_BASE_URL: "http://127.0.0.1:3999/partnerapi" })!;
      await f("https://seats.aero/partnerapi/search?take=10", { headers: { "Partner-Authorization": "k" } });
      expect(spy).toHaveBeenLastCalledWith("http://127.0.0.1:3999/partnerapi/search?take=10", expect.anything());
      await f("https://example.com/other");
      expect(spy).toHaveBeenLastCalledWith("https://example.com/other", undefined);
    } finally {
      spy.mockRestore();
    }
  });
});
