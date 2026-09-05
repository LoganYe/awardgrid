/**
 * Next.js 16 Proxy (formerly Middleware): one place that applies the cross-site request guard
 * to every state-changing /api/* request before a Route Handler runs. See
 * src/lib/server/origin.ts for the rules. Pure and dependency-free (no DB, no session lookup).
 */
import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, isApiPath } from "@/lib/server/origin";

export function proxy(request: NextRequest): NextResponse {
  if (isApiPath(request.nextUrl.pathname)) {
    const verdict = checkOrigin(request.method, request.headers);
    if (!verdict.ok) {
      // Body is a code only — never the offending header values.
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
