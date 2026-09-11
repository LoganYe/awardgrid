/**
 * The WebView fetch tripwire (design §2.6, probe A2), against stand-ins for `globalThis`.
 *
 * Most cases wrap a plain object's fetch, so nothing reaches the network. The one case that installs on the real
 * `globalThis` restores the original before it ends. main.tsx is read through the TypeScript AST, so a comment that
 * mentions the guard cannot stand in for the call.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { describeAskError } from "@awardgrid/core/ask/errors";
import { type FetchTarget, NativeHttpRequiredError, installWebViewFetchGuard } from "./webview-fetch-guard";

function target(location?: string) {
  const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("passed through", { status: 200 }));
  const t: FetchTarget = { fetch: inner as unknown as typeof fetch, ...(location ? { location: { href: location } } : {}) };
  return { t, inner };
}

const refusal = (host: string) => `${host} must be reached over native HTTP (src/native/http.ts), never the WebView's fetch.`;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (err: unknown) => err,
  );
}

describe("installWebViewFetchGuard", () => {
  it.each([
    ["https://api.anthropic.com/v1/messages", "api.anthropic.com"],
    ["http://api.anthropic.com/v1/models", "api.anthropic.com"],
    ["HTTPS://API.ANTHROPIC.COM/v1/messages", "api.anthropic.com"],
    ["https://Api.Anthropic.Com:443/v1/models/claude-opus-5", "api.anthropic.com"],
    ["https://seats.aero/partnerapi/search?origin_airport=SEA", "seats.aero"],
    ["http://seats.aero/partnerapi/routes?source=united", "seats.aero"],
    ["https://SEATS.AERO/partnerapi/trips/2PPrELk9WcfJaNREWEPXypvhXAD", "seats.aero"],
    ["https://seats.aero./partnerapi/routes", "seats.aero"],
  ])("rejects %s as a string, a URL and a Request, before the WebView sends it", async (url, host) => {
    const { t, inner } = target();
    installWebViewFetchGuard(t);
    for (const input of [url, new URL(url), new Request(url)]) {
      const err = await rejection(t.fetch(input, { method: "POST", body: "{}" }));
      expect(err).toBeInstanceOf(NativeHttpRequiredError);
      expect((err as Error).name).toBe("NativeHttpRequiredError");
      expect((err as Error).message).toBe(refusal(host));
      expect((err as NativeHttpRequiredError).host).toBe(host);
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.com/",
    "https://seats.aero.example.com/partnerapi/search",
    "https://api.anthropic.com.example.net/v1/messages",
    "https://platform.claude.com/docs/en/about-claude/pricing",
    "https://example.com/?next=https://seats.aero/partnerapi/search",
    "capacitor://localhost/assets/index.js",
    "not a URL at all",
  ])("passes %s through to the WebView's fetch, untouched", async (url) => {
    const { t, inner } = target();
    installWebViewFetchGuard(t);
    const init = { method: "GET", headers: { accept: "application/json" } };
    const res = await t.fetch(url, init);
    expect(await res.text()).toBe("passed through");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith(url, init);
  });

  it("judges an input by the URL fetch reads from it, never by a field that names another", async () => {
    const { t, inner } = target();
    installWebViewFetchGuard(t);
    // fetch converts a plain object to its string and never reads its `url` field.
    const disguised = { url: "https://example.com/", toString: () => "https://seats.aero/partnerapi/search" };
    expect(await rejection(t.fetch(disguised as unknown as RequestInfo))).toBeInstanceOf(NativeHttpRequiredError);
    // A Request sends the URL it carries; an own `url` field over the prototype's getter does not change it.
    const relabelled = Object.defineProperty(new Request("https://api.anthropic.com/v1/messages"), "url", { value: "https://example.com/" });
    expect(relabelled.url).toBe("https://example.com/");
    expect(await rejection(t.fetch(relabelled))).toBeInstanceOf(NativeHttpRequiredError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("reads an input once and hands the WebView the string it checked", async () => {
    const { t, inner } = target();
    installWebViewFetchGuard(t);
    let reads = 0;
    const shifting = { toString: () => (reads++ === 0 ? "https://example.com/" : "https://seats.aero/partnerapi/search") };
    await t.fetch(shifting as unknown as RequestInfo);
    expect(inner).toHaveBeenLastCalledWith("https://example.com/", undefined);
    expect(reads).toBe(1);
    // A URL goes on as the string fetch would have read from it; a Request goes on as itself.
    await t.fetch(new URL("https://example.com/a?b=c"));
    expect(inner).toHaveBeenLastCalledWith("https://example.com/a?b=c", undefined);
    const request = new Request("https://example.com/r");
    await t.fetch(request);
    expect(inner).toHaveBeenLastCalledWith(request, undefined);
  });

  it("resolves a relative URL against the page, as the WebView does", async () => {
    // Served from capacitor://localhost, a scheme-relative URL stays on the capacitor scheme and reaches no host.
    const app = target("capacitor://localhost/#/ask");
    installWebViewFetchGuard(app.t);
    await app.t.fetch("//seats.aero/partnerapi/search");
    expect(app.inner).toHaveBeenCalledTimes(1);

    // Served over https (vite dev in a browser), the same URL is seats.aero.
    const dev = target("https://localhost:5173/");
    installWebViewFetchGuard(dev.t);
    expect(await rejection(dev.t.fetch("//seats.aero/partnerapi/search"))).toBeInstanceOf(NativeHttpRequiredError);
    expect(dev.inner).not.toHaveBeenCalled();
  });

  it("installing twice keeps one guard", async () => {
    const { t, inner } = target();
    expect(installWebViewFetchGuard(t)).toBe(true);
    const guarded = t.fetch;
    expect(installWebViewFetchGuard(t)).toBe(false);
    expect(t.fetch).toBe(guarded);

    await t.fetch("https://example.com/");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await rejection(t.fetch("https://api.anthropic.com/v1/models"))).toBeInstanceOf(NativeHttpRequiredError);
  });

  it("calls the WebView's fetch on its own target, because window.fetch called on anything else throws", async () => {
    const seen: unknown[] = [];
    const t: FetchTarget = {
      fetch: async function (this: unknown) {
        seen.push(this);
        return new Response("");
      } as unknown as typeof fetch,
    };
    installWebViewFetchGuard(t);
    await t.fetch("https://example.com/");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(t);
  });

  it("does nothing where there is no fetch to guard", () => {
    expect(installWebViewFetchGuard({} as FetchTarget)).toBe(false);
  });

  it("installs on globalThis by default, which is how main.tsx calls it", async () => {
    const original = globalThis.fetch;
    try {
      expect(installWebViewFetchGuard()).toBe(true);
      expect(globalThis.fetch).not.toBe(original);
      expect(await rejection(globalThis.fetch("https://api.anthropic.com/v1/models"))).toBeInstanceOf(NativeHttpRequiredError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("is reported by Ask as a wiring failure, never as an outage", () => {
    const failure = describeAskError(new NativeHttpRequiredError("api.anthropic.com"), { elapsedMs: 0, hidden: false, secrets: [] });
    expect(failure.code).toBe("wiring");
    expect(failure.retryable).toBe(false);
  });
});

describe("main.tsx", () => {
  it("installs the guard at the top level, before createRoot renders anything", () => {
    const file = path.join(import.meta.dirname, "..", "main.tsx");
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const topLevelCall = (name: string) =>
      sf.statements.find(
        (s) =>
          ts.isExpressionStatement(s) &&
          ((ts.isCallExpression(s.expression) && firstCallee(s.expression) === name) ||
            (ts.isCallExpression(s.expression) && ts.isPropertyAccessExpression(s.expression.expression) && firstCallee(s.expression.expression.expression) === name)),
      );
    const install = topLevelCall("installWebViewFetchGuard");
    const render = topLevelCall("createRoot");
    expect(install, "installWebViewFetchGuard() is not a top-level statement of main.tsx").toBeDefined();
    expect(render, "createRoot(…) is not a top-level statement of main.tsx").toBeDefined();
    expect(install!.getStart(sf)).toBeLessThan(render!.getStart(sf));
  });
});

/** The name a call expression starts from: `createRoot` in `createRoot(x).render(y)`. */
function firstCallee(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node)) return firstCallee(node.expression);
  return null;
}
