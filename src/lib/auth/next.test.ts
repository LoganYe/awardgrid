/**
 * `getCurrentUser` is wrapped in React `cache()` so the root layout (src/app/layout.tsx:34) and
 * the page it renders share ONE session lookup per request. Two things depend on it: `/` would
 * otherwise do two identical better-sqlite3 reads per hit, and a session that expires between
 * the two reads is deleted by the first (session.ts:55-58), so an unmemoised layout and page
 * could answer differently inside one request.
 *
 * Why this file is shaped the way it is: under vitest, `import { cache } from "react"` resolves
 * to react/index.js — the CLIENT build, whose `cache()` is `return fn.apply(null, arguments)`
 * with no memoisation at all (node_modules/react/cjs/react.development.js:917-921). Only the
 * build behind the "react-server" export condition memoises, and only while
 * `ReactSharedInternals.A` holds an async dispatcher
 * (node_modules/react/cjs/react.react-server.development.js:575-618) — which is what Next's
 * Flight server installs and what an App Router page runs under. So this file loads that build
 * by absolute path (the exports map does not expose it by specifier), installs the same kind of
 * dispatcher, and hands its `cache()` to the module under test. Real React semantics, not a
 * hand-written stand-in for them.
 *
 * Consequences worth knowing before editing:
 *   - the only assertion that fails if the `cache()` wrapper is deleted is the call COUNT; the
 *     spy returns the same object either way, so an identity check would prove nothing;
 *   - this instantiates a second React copy in the process, so this file must never render;
 *   - the AsyncLocalStorage scope is not decoration — a bare `internals.A = …` around an await
 *     would silently share one cache between concurrent "requests".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/auth/users";

/** 43 characters of the session-token alphabet, so it clears TOKEN_RE (session.ts:14). */
const TOKEN = "0123456789012345678901234567890123456789012";

const ALICE: User = {
  id: "u1",
  username: "alice",
  createdAt: "2026-09-06T00:00:00.000Z",
  telegramChatId: null,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: "UTC",
  locale: "en",
  theme: "system",
};

// `await vi.hoisted(async …)` so the node: builtins are imported inside the hoisted block: a
// hoisted factory runs above the file's own imports, and referencing one from up there is a
// temporal-dead-zone error rather than a resolution failure.
const { lookup, serverCache, inOneRequest } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");

  // "react/package.json" is the one subpath the exports map allows; cjs/ is reached by path.
  const req = createRequire(import.meta.url);
  const root = dirname(req.resolve("react/package.json"));
  const build =
    process.env.NODE_ENV === "production"
      ? "cjs/react.react-server.production.js"
      : "cjs/react.react-server.development.js";
  const server = req(join(root, build)) as {
    cache: <F extends (...args: never[]) => unknown>(fn: F) => F;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: unknown };
  };

  // One cache root per request, the way the Flight server scopes it.
  const scope = new AsyncLocalStorage<Map<() => unknown, unknown>>();
  server.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
    getCacheForType<T>(create: () => T): T {
      const store = scope.getStore();
      if (!store) return create(); // outside a request: uncached, exactly as in production
      let value = store.get(create) as T | undefined;
      if (value === undefined) {
        value = create();
        store.set(create, value);
      }
      return value;
    },
    cacheSignal: () => null,
    getOwner: () => null,
  };

  return {
    lookup: vi.fn<(db: unknown, token: unknown) => User | null>(),
    serverCache: server.cache,
    inOneRequest: <T>(fn: () => Promise<T>): Promise<T> => scope.run(new Map(), fn),
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: serverCache };
});

/** One cookie, so the module never needs a real next/headers request scope. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ name: "ag_session", value: TOKEN }) }),
}));

/** getCurrentUser passes the handle straight through, so any object will do. */
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ testDbHandle: true }) }));

/** The session lookup itself — the call this file counts. */
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getSessionUser: lookup };
});

const { getCurrentUser, requireUser } = await import("@/lib/auth/next");

beforeEach(() => {
  // clearMocks (vitest.config.ts) clears calls, not implementations; set it explicitly anyway.
  lookup.mockReturnValue(ALICE);
});

describe("getCurrentUser is memoised per request", () => {
  it("performs one session lookup for two calls inside one request", async () => {
    await inOneRequest(async () => {
      expect(await getCurrentUser()).toEqual(ALICE);
      expect(await getCurrentUser()).toEqual(ALICE);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("shares that lookup with requireUser, which is the layout-then-page path", async () => {
    await inOneRequest(async () => {
      await getCurrentUser(); // src/app/layout.tsx:34
      await requireUser(); // /grid, /queries, /settings
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("looks up again in the next request", async () => {
    await inOneRequest(async () => void (await getCurrentUser()));
    await inOneRequest(async () => void (await getCurrentUser()));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("caches the rejection too, so the layout and the page cannot disagree", async () => {
    const boom = new Error("database is locked");
    lookup.mockImplementation(() => {
      throw boom;
    });
    await inOneRequest(async () => {
      // The wrapped function is async, so it never throws synchronously: both callers await the
      // same rejected promise. This is why src/app/page.tsx's own `.catch(() => null)` is
      // load-bearing rather than a copy of the layout's.
      await expect(getCurrentUser()).rejects.toBe(boom);
      await expect(getCurrentUser()).rejects.toBe(boom);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
