import type { Metadata } from "next";
import { SavedApp } from "@/components/workspace/saved-app";
import { requireUser } from "@/lib/auth/next";
import { isSeatsConnected, seatsOAuthPaused } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await requireUser();
  // Whether seats.aero is connected decides what this browser may keep: nothing from seats.aero when it is not, or while
  // the sign-in is paused on this server (src/lib/seats-oauth/pause.ts).
  return <SavedApp userId={user.id} connected={!seatsOAuthPaused() && isSeatsConnected(getServerDb(), user.id)} />;
}
