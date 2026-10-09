/**
 * /grid — the one real page (kickoff §8). Server shell: requires a session, reads the
 * shareable ?q= (base64url QueryObject), checks whether the user has connected seats.aero (and whether to say,
 * once, that a pasted key was removed) and whether the server can fall back to the language model; the client
 * GridApp does the rest.
 */
import type { Metadata } from "next";
import { GridApp } from "@/components/grid/grid-app";
import { decodeQueryParam } from "@/components/grid/state";
import { requireUser } from "@/lib/auth/next";
import { isSeatsConnected, reconnectNoticeDue } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";
import { llmAvailable } from "@/lib/server/find";

export const metadata: Metadata = { title: "Grid" };

export default async function GridPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = decodeQueryParam(raw);
  const db = getServerDb();
  return (
    <GridApp
      initialQuery={initialQuery}
      hasKey={isSeatsConnected(db, user.id)}
      seatsNotice={reconnectNoticeDue(db, user.id)}
      llmAvailable={llmAvailable()}
    />
  );
}
