/**
 * Small in-memory fixed-window rate limiters for POST /api/auth/login.
 *
 * Three layers, checked in this order, so that no header a client controls can unlock more
 * argon2 work than the per-username and global budgets allow:
 *   1. global      — every login attempt on this process (coarse DoS brake)
 *   2. username    — attempts against one account, regardless of where they come from
 *   3. username+ip — the classic per-client bucket (IP only trusted behind a declared proxy)
 *
 * In-memory is enough for a single-process, <10-user deployment. Bucket count is hard-capped
 * (`maxKeys`): when the cap is reached, expired buckets are pruned and, failing that, the
 * oldest window is evicted — so a flood of unique keys cannot grow the map without bound.
 * Nothing here is ever logged, so the composite key may include the username.
 */
export interface RateLimiterOptions {
  /** Max hits per window (default 10). */
  limit?: number;
  /** Window length in ms (default 15 min). */
  windowMs?: number;
  /** Hard cap on tracked keys (default 10 000). */
  maxKeys?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Hits remaining in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
  /** Seconds until reset, rounded up (for Retry-After). */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = 0;

  constructor(opts: RateLimiterOptions = {}) {
    this.limit = opts.limit ?? 10;
    this.windowMs = opts.windowMs ?? 15 * 60 * 1000;
    this.maxKeys = Math.max(1, opts.maxKeys ?? DEFAULT_MAX_KEYS);
    this.now = opts.now ?? Date.now;
  }

  /** Record one hit for `key` and report whether it is within the limit. */
  hit(key: string): RateLimitResult {
    const now = this.now();
    this.maybePrune(now);
    let b = this.buckets.get(key);
    if (!b || now - b.windowStart >= this.windowMs) {
      if (!b) this.enforceCap(now);
      b = { count: 0, windowStart: now };
      this.buckets.set(key, b);
    }
    b.count += 1;
    const resetAt = b.windowStart + this.windowMs;
    const ok = b.count <= this.limit;
    return {
      ok,
      remaining: Math.max(0, this.limit - b.count),
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  /** Peek without counting. */
  check(key: string): RateLimitResult {
    const now = this.now();
    const b = this.buckets.get(key);
    if (!b || now - b.windowStart >= this.windowMs) {
      return { ok: true, remaining: this.limit, resetAt: now + this.windowMs, retryAfterSec: 0 };
    }
    const resetAt = b.windowStart + this.windowMs;
    return {
      ok: b.count < this.limit,
      remaining: Math.max(0, this.limit - b.count),
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  /** Forget a key (e.g. after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Time-based lazy prune: at most once per window. */
  private maybePrune(now: number): void {
    if (now - this.lastPrune < this.windowMs) return;
    this.lastPrune = now;
    this.pruneExpired(now);
  }

  private pruneExpired(now: number): void {
    for (const [k, b] of this.buckets) {
      if (now - b.windowStart >= this.windowMs) this.buckets.delete(k);
    }
  }

  /** Called before inserting a NEW key: keep the map at or below `maxKeys`. */
  private enforceCap(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    this.pruneExpired(now);
    while (this.buckets.size >= this.maxKeys) {
      // Evict the oldest window (Map iteration order is insertion order, and a bucket is only
      // ever re-inserted when its window restarts, so the first entry is the oldest window).
      let oldestKey: string | undefined;
      let oldestStart = Number.POSITIVE_INFINITY;
      for (const [k, b] of this.buckets) {
        if (b.windowStart < oldestStart) {
          oldestStart = b.windowStart;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }
}

/** Composite key for login throttling: normalised username + client IP. */
export function loginRateKey(username: string, ip: string): string {
  return `${username.trim().toLowerCase()}|${ip}`;
}

/** Env flag that declares a trusted reverse proxy (Cloudflare Access / nginx) in front of the app. */
export const TRUST_PROXY_ENV = "TRUST_PROXY_HEADERS";

/** True when the deployment has declared a reverse proxy whose client-IP headers can be trusted. */
export function trustProxyHeaders(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[TRUST_PROXY_ENV]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Placeholder client id when no trusted proxy header is available (Node route handlers expose no socket address). */
export const DIRECT_CLIENT = "direct";

/**
 * Best-effort client IP. Proxy headers (`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`)
 * are only honoured when TRUST_PROXY_HEADERS is set: without a reverse proxy in front (the
 * documented Tailscale deployment) anyone can send them, and trusting them would hand every
 * request a fresh rate-limit bucket. Falls back to "direct" — never throws.
 */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (!trustProxyHeaders(env)) return DIRECT_CLIENT;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return DIRECT_CLIENT;
}

const WINDOW_15_MIN = 15 * 60 * 1000;

/** Per username+IP: 10 attempts / 15 min (POST /api/auth/login). */
export const loginLimiter = new RateLimiter({ limit: 10, windowMs: WINDOW_15_MIN });
/** Per username alone, IP-independent: 20 attempts / 15 min. */
export const usernameLimiter = new RateLimiter({ limit: 20, windowMs: WINDOW_15_MIN });
/** Whole process: 200 login attempts / 15 min (≈ 10 users × 20) — a coarse argon2 CPU brake. */
export const globalLoginLimiter = new RateLimiter({ limit: 200, windowMs: WINDOW_15_MIN, maxKeys: 1 });
export const GLOBAL_LOGIN_KEY = "*";

export interface LoginThrottleResult {
  ok: boolean;
  retryAfterSec: number;
}

/**
 * Apply all three login limiters for one attempt (each one counts the hit). Returns the
 * longest Retry-After among the layers that blocked.
 */
export function throttleLogin(username: string, ip: string): LoginThrottleResult {
  const results = [
    globalLoginLimiter.hit(GLOBAL_LOGIN_KEY),
    usernameLimiter.hit(username),
    loginLimiter.hit(loginRateKey(username, ip)),
  ];
  const blocked = results.filter((r) => !r.ok);
  if (blocked.length === 0) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.max(...blocked.map((r) => r.retryAfterSec)) };
}

/**
 * After a successful login the per-account buckets are forgotten (the client proved it knows
 * the password); the global brake keeps counting.
 */
export function resetLoginThrottle(username: string, ip: string): void {
  loginLimiter.reset(loginRateKey(username, ip));
  usernameLimiter.reset(username);
}

/** Test helper: forget every login bucket. */
export function clearLoginLimiters(): void {
  loginLimiter.clear();
  usernameLimiter.clear();
  globalLoginLimiter.clear();
}
