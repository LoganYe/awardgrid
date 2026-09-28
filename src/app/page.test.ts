/**
 * The front door's one branch (HANDOFF.md §3.4 acceptance criteria 2 and 5).
 *
 * `e2e/home.spec.ts` proves the wire behaviour — 200 with the tagline, 307 to /grid, 200 for a
 * bad cookie. What it cannot produce is the third failure mode: a session lookup that *throws*.
 * That is the whole reason `src/app/page.tsx` carries its own `.catch(() => null)` rather than
 * leaning on the layout's: `getCurrentUser` is memoised, so the layout and the page share one
 * rejected promise, and an uncaught one would 500 the app's root URL on a SQLite blip.
 *
 * The page is a server component, so nothing here renders it. `Home()` returns a React element,
 * and the assertions walk that element for the dictionary keys it asked for — the translator is
 * stubbed to return its key, so the walk reads as the page's content outline.
 */
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/auth/users";

const { getCurrentUser, redirect } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<User | null>>(),
  redirect: vi.fn<(url: string) => never>(() => {
    // next/navigation's redirect throws; the page must not sit inside a try/catch around it.
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/next", () => ({ getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getT: async () => ({ locale: "en" as const, t: (key: string) => key }),
}));

const { default: Home } = await import("./page");

const ALICE = { id: "u1", username: "alice" } as User;

/** Every string the element tree renders, in document order. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const child of node) textOf(child, out);
  else if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props && "children" in props) textOf(props.children, out);
  }
  return out;
}

type ReactNodeLike = { type: unknown; props: Record<string, unknown> };

/** The element whose children are exactly `text`, depth-first. */
function elementWithText(node: unknown, text: string): ReactNodeLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = elementWithText(child, text);
      if (found) return found;
    }
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactNodeLike;
    if (element.props?.children === text) return element;
    return elementWithText(element.props?.children, text);
  }
  return undefined;
}

describe("the front door at /", () => {
  it("renders the signed-out page when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    const page = await Home();
    expect(redirect).not.toHaveBeenCalled();
    expect(textOf(page)).toEqual([
      "app.tagline",
      "home.lead",
      "home.invite.label",
      "home.invite.body",
      "home.key.label",
      "home.key.body",
      "home.limits.label",
      "home.limits.body",
      "home.login_link",
      "home.register_link",
      "home.ios_link",
    ]);
  });

  /**
   * "/" with a query string (a campaign or shared link) reaches this page, not the site's home page, whose exact route
   * matches no query string (sites/landing/DEPLOY.md). So the page links the iPhone app's page: a plain <a> to the
   * static site's /ios/, which is not a route of this app (a next/link would prefetch it and navigate client-side).
   */
  it("links the iPhone app's page at /ios/ with a plain link that keeps the touch floor", async () => {
    getCurrentUser.mockResolvedValue(null);
    const page = await Home();
    const link = elementWithText(page, "home.ios_link");
    expect(link?.type).toBe("a");
    expect(link?.props).toMatchObject({ href: "/ios/", "data-slot": "button" });
    expect(String(link?.props.className)).toMatch(/\bself-start\b/);
  });

  it("redirects a signed-in visitor to /grid without rendering the page", async () => {
    getCurrentUser.mockResolvedValue(ALICE);
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/grid");
  });

  /** Criterion 5: a database blip renders the front door, never a 500 at the app's root URL. */
  it("renders the signed-out page when the session lookup throws", async () => {
    getCurrentUser.mockRejectedValue(new Error("database is locked"));
    const page = await Home();
    expect(redirect).not.toHaveBeenCalled();
    expect(textOf(page)).toContain("app.tagline");
  });
});
