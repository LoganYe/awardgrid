import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginLimiters,
  clientIp,
  DIRECT_CLIENT,
  globalLoginLimiter,
  loginLimiter,
  loginRateKey,
  RateLimiter,
  resetLoginThrottle,
  throttleLogin,
  trustProxyHeaders,
  usernameLimiter,
} from "./rate-limit";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("RateLimiter", () => {
  it("allows `limit` hits then blocks within the window", () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(rl.hit("k")).toMatchObject({ ok: true, remaining: 2 });
    expect(rl.hit("k")).toMatchObject({ ok: true, remaining: 1 });
    expect(rl.hit("k")).toMatchObject({ ok: true, remaining: 0 });
    const blocked = rl.hit("k");
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(1);
    expect(blocked.resetAt).toBe(1_000_000 + 1000);
  });

  it("resets after the window elapses", () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(false);
    c.advance(999);
    expect(rl.hit("k").ok).toBe(false);
    c.advance(1);
    expect(rl.hit("k").ok).toBe(true);
  });

  it("keys are independent and reset() forgets one key", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: clock().now });
    expect(rl.hit("a").ok).toBe(true);
    expect(rl.hit("b").ok).toBe(true);
    expect(rl.hit("a").ok).toBe(false);
    rl.reset("a");
    expect(rl.hit("a").ok).toBe(true);
    expect(rl.hit("b").ok).toBe(false);
  });

  it("check() peeks without counting", () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: clock().now });
    expect(rl.check("k")).toMatchObject({ ok: true, remaining: 2 });
    rl.hit("k");
    expect(rl.check("k")).toMatchObject({ ok: true, remaining: 1 });
    rl.hit("k");
    expect(rl.check("k").ok).toBe(false);
  });

  it("prunes expired buckets lazily", () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    for (let i = 0; i < 50; i++) rl.hit(`k${i}`);
    expect(rl.size).toBe(50);
    c.advance(2000);
    rl.hit("fresh");
    expect(rl.size).toBe(1);
  });

  it("default = 10 per 15 minutes", () => {
    const rl = new RateLimiter();
    expect(rl.limit).toBe(10);
    expect(rl.windowMs).toBe(15 * 60 * 1000);
  });
});

describe("helpers", () => {
  it("loginRateKey normalises the username", () => {
    expect(loginRateKey("  Alice ", "10.0.0.1")).toBe("alice|10.0.0.1");
  });

  it("clientIp ignores every proxy header unless TRUST_PROXY_HEADERS is set", () => {
    const env = {};
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), env)).toBe(DIRECT_CLIENT);
    expect(clientIp(new Headers({ "cf-connecting-ip": "4.4.4.4" }), env)).toBe(DIRECT_CLIENT);
    expect(clientIp(new Headers({ "x-real-ip": "3.3.3.3" }), env)).toBe(DIRECT_CLIENT);
    expect(trustProxyHeaders({})).toBe(false);
    expect(trustProxyHeaders({ TRUST_PROXY_HEADERS: "0" })).toBe(false);
    expect(trustProxyHeaders({ TRUST_PROXY_HEADERS: "true" })).toBe(true);
  });

  it("clientIp behind a declared proxy prefers cf-connecting-ip, then x-real-ip, then first x-forwarded-for", () => {
    const env = { TRUST_PROXY_HEADERS: "1" };
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), env)).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "3.3.3.3", "x-forwarded-for": "1.1.1.1" }), env)).toBe("3.3.3.3");
    expect(clientIp(new Headers({ "cf-connecting-ip": "4.4.4.4", "x-real-ip": "3.3.3.3" }), env)).toBe("4.4.4.4");
    expect(clientIp(new Headers(), env)).toBe(DIRECT_CLIENT);
  });
});

describe("bucket cap", () => {
  it("never tracks more than maxKeys buckets: expired ones go first, then the oldest window", () => {
    const c = clock();
    const rl = new RateLimiter({ limit: 5, windowMs: 1000, maxKeys: 3, now: c.now });
    rl.hit("a");
    c.advance(10);
    rl.hit("b");
    c.advance(10);
    rl.hit("c");
    expect(rl.size).toBe(3);
    rl.hit("d"); // cap reached, nothing expired → "a" (oldest window) is evicted
    expect(rl.size).toBe(3);
    expect(rl.check("a").remaining).toBe(5);
    expect(rl.check("b").remaining).toBe(4);
    // A flood of unique keys inside one window cannot grow the map.
    for (let i = 0; i < 1000; i++) rl.hit(`flood-${i}`);
    expect(rl.size).toBe(3);
    // Once buckets expire they are pruned before anything live is evicted.
    c.advance(2000);
    rl.hit("x");
    expect(rl.size).toBe(1);
  });
});

describe("throttleLogin (three layers)", () => {
  beforeEach(() => clearLoginLimiters());

  it("blocks after 10 per username+ip, 20 per username and 200 overall", () => {
    for (let i = 0; i < 10; i++) expect(throttleLogin("alice", "direct").ok).toBe(true);
    expect(throttleLogin("alice", "direct").ok).toBe(false);
    // Rotating the client id does not give the username more than 20 attempts in total.
    let okCount = 0;
    for (let i = 0; i < 40; i++) if (throttleLogin("alice", `10.0.0.${i}`).ok) okCount += 1;
    expect(okCount).toBe(9); // 20 - 11 already spent on the username bucket
    expect(throttleLogin("bob", "direct").ok).toBe(true);
    expect(globalLoginLimiter.check("*").remaining).toBe(200 - 52);
  });

  it("the global brake stops everyone once the process budget is spent", () => {
    for (let i = 0; i < 200; i++) throttleLogin(`user-${i % 50}`, "direct");
    expect(throttleLogin("fresh", "direct").ok).toBe(false);
    expect(throttleLogin("fresh", "direct").retryAfterSec).toBeGreaterThan(0);
  });

  it("resetLoginThrottle forgets the per-account buckets but not the global one", () => {
    for (let i = 0; i < 5; i++) throttleLogin("alice", "direct");
    resetLoginThrottle("alice", "direct");
    expect(loginLimiter.check(loginRateKey("alice", "direct")).remaining).toBe(10);
    expect(usernameLimiter.check("alice").remaining).toBe(20);
    expect(globalLoginLimiter.check("*").remaining).toBe(195);
  });
});
