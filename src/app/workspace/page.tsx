import type { Metadata } from "next";
import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { decodeQueryParam } from "@/components/grid/state";
import { requireUser } from "@/lib/auth/next";
import { isSeatsConnected, reconnectNoticeDue, seatsOAuthPaused } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? decodeQueryParam(q) : null;
  // Only what the page needs crosses to the browser: the account's id (its storage namespace) and whether seats.aero is
  // connected. Never a token. While the sign-in is paused on this server nothing is (src/lib/seats-oauth/pause.ts).
  const db = getServerDb();
  const paused = seatsOAuthPaused();
  return (
    <WorkspaceApp
      userId={user.id}
      initialQuery={initialQuery}
      hasKey={!paused && isSeatsConnected(db, user.id)}
      seatsNotice={!paused && reconnectNoticeDue(db, user.id)}
    />
  );
}
