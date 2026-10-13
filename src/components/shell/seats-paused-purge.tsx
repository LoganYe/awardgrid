"use client";

/**
 * While Login with Seats.aero is paused on the server (SEATS_OAUTH_WEB=off, src/lib/seats-oauth/pause.ts) the root
 * layout renders this on every signed-in page: the browser forgets what it kept from seats.aero for the account, as
 * Disconnect does (src/components/workspace/retention.ts forgetSeatsResultsOnDevice): the workspace's results, saved
 * options' rows and the Ask conversation. Saved options keep their search. Renders nothing and sends nothing.
 */
import { useEffect } from "react";
import { forgetSeatsResultsOnDevice } from "@/components/workspace/retention";

export function SeatsPausedPurge({ userId }: { userId: string }) {
  useEffect(() => {
    // Storage switched off or unreadable: there is nothing this browser could have kept, or the next page tries again.
    void forgetSeatsResultsOnDevice(userId).catch(() => undefined);
  }, [userId]);
  return null;
}
