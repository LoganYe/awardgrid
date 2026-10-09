"use client";
/**
 * One account's workspace services in the browser (UI/UX v1 T18): the workspace store (its searches, view and
 * selection) and the saved-options store, each over that account's own storage (./storage.ts), made once per account
 * id. A different account gets different stores: nothing in memory carries over either.
 *
 * Both follow short-term caching (./retention.ts): seats.aero results older than 24 hours are dropped as the stores
 * are read and written, and every SWEEP_MS while the page is open; an account that is not connected keeps none.
 */
import { useEffect, useMemo, useState } from "react";
import { FavoritesStore } from "@awardgrid/core/workspace/favorites-store";
import { WorkspaceStore } from "@awardgrid/core/workspace/workspace-store";
import { cutoffFor, expireFavorites, shortTermWebStorage, snapshotFetchedAt } from "./retention";
import { webSearchPort } from "./search-port";
import { FAVORITES_STORE, WORKSPACE_STORE, webStorage } from "./storage";

/** How often an open page looks for results that have passed the limit. */
const SWEEP_MS = 10 * 60_000;

export interface WorkspaceServices {
  userId: string;
  workspace: WorkspaceStore;
  favorites: FavoritesStore;
  /** The oldest fetch time this account may keep now (ms; "everything" when it is not connected). */
  cutoff: () => number;
}

/** `connected`: whether the account has seats.aero connected; without it nothing from seats.aero is kept. */
export function createWorkspaceServices(userId: string, connected = true): WorkspaceServices {
  const now = () => new Date().toISOString();
  const cutoff = () => cutoffFor(connected, Date.now());
  return {
    userId,
    workspace: new WorkspaceStore({ search: webSearchPort(), now, storage: shortTermWebStorage(webStorage(WORKSPACE_STORE, userId), cutoff) }),
    favorites: new FavoritesStore(webStorage(FAVORITES_STORE, userId), now),
    cutoff,
  };
}

/** Drop what has passed the limit: saved options' rows, and the workspace's snapshots (written, then read back pruned). */
async function sweep(services: WorkspaceServices): Promise<void> {
  const cutoff = services.cutoff();
  await expireFavorites(services.favorites, cutoff);
  const old = services.workspace.history().some((s) => {
    const at = snapshotFetchedAt(s);
    return at === null || at < cutoff;
  });
  if (old) {
    await services.workspace.persist();
    await services.workspace.restore();
  }
}

/** The account's services, and whether what this browser kept for it has been read. Reading sends nothing. */
export function useWorkspaceServices(userId: string, connected = true): { services: WorkspaceServices; ready: boolean } {
  const services = useMemo(() => createWorkspaceServices(userId, connected), [userId, connected]);
  // Ready for these services only: another account's services start unread.
  const [readFor, setReadFor] = useState<WorkspaceServices | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([services.workspace.restore(), services.favorites.load().then(() => expireFavorites(services.favorites, services.cutoff()))]).then(() => {
      if (live) setReadFor(services);
    });
    const timer = window.setInterval(() => void sweep(services).catch(() => undefined), SWEEP_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [services]);
  return { services, ready: readFor === services };
}
