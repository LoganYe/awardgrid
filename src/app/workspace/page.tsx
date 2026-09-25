import type { Metadata } from "next";
import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { decodeQueryParam } from "@/components/grid/state";
import { requireUser } from "@/lib/auth/next";
import { hasKey } from "@/lib/keys";
import { getServerDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? decodeQueryParam(q) : null;
  // Only what the page needs crosses to the browser: the account's id (its storage namespace) and whether a key is on
  // file. Never the key.
  return <WorkspaceApp userId={user.id} initialQuery={initialQuery} hasKey={hasKey(getServerDb(), user.id, "seats_aero")} />;
}
