/**
 * /grid — the one real page (kickoff §8). Server shell: requires a session, reads the
 * shareable ?q= (base64url QueryObject), checks whether the user has a seats.aero key and
 * whether the server can fall back to the language model; the client GridApp does the rest.
 */
import type { Metadata } from "next";
import { GridApp } from "@/components/grid/grid-app";
import { decodeQueryParam } from "@/components/grid/state";
import { requireUser } from "@/lib/auth/next";
import { hasKey } from "@/lib/keys";
import { getServerDb } from "@/lib/server/db";
import { llmAvailable } from "@/lib/server/find";

export const metadata: Metadata = { title: "Grid" };

export default async function GridPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = decodeQueryParam(raw);
  const db = getServerDb();
  return <GridApp initialQuery={initialQuery} hasKey={hasKey(db, user.id, "seats_aero")} llmAvailable={llmAvailable()} />;
}
