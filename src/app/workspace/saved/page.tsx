import type { Metadata } from "next";
import { SavedApp } from "@/components/workspace/saved-app";
import { requireUser } from "@/lib/auth/next";
import { isSeatsConnected } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await requireUser();
  // Whether seats.aero is connected decides what this browser may keep: nothing from seats.aero when it is not.
  return <SavedApp userId={user.id} connected={isSeatsConnected(getServerDb(), user.id)} />;
}
