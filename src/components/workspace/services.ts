"use client";
/**
 * One account's workspace services in the browser (UI/UX v1 T18): the workspace store (its searches, view and
 * selection) and the saved-options store, each over that account's own storage (./storage.ts), made once per account
 * id. A different account gets different stores: nothing in memory carries over either.
 */
import { useEffect, useMemo, useState } from "react";
import { FavoritesStore } from "@awardgrid/core/workspace/favorites-store";
import { WorkspaceStore } from "@awardgrid/core/workspace/workspace-store";
import { webSearchPort } from "./search-port";
import { FAVORITES_STORE, WORKSPACE_STORE, webStorage } from "./storage";

export interface WorkspaceServices {
  userId: string;
  workspace: WorkspaceStore;
  favorites: FavoritesStore;
}

export function createWorkspaceServices(userId: string): WorkspaceServices {
  const now = () => new Date().toISOString();
  return {
    userId,
    workspace: new WorkspaceStore({ search: webSearchPort(), now, storage: webStorage(WORKSPACE_STORE, userId) }),
    favorites: new FavoritesStore(webStorage(FAVORITES_STORE, userId), now),
  };
}

/** The account's services, and whether what this browser kept for it has been read. Reading sends nothing. */
export function useWorkspaceServices(userId: string): { services: WorkspaceServices; ready: boolean } {
  const services = useMemo(() => createWorkspaceServices(userId), [userId]);
  // Ready for these services only: another account's services start unread.
  const [readFor, setReadFor] = useState<WorkspaceServices | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([services.workspace.restore(), services.favorites.load()]).then(() => {
      if (live) setReadFor(services);
    });
    return () => {
      live = false;
    };
  }, [services]);
  return { services, ready: readFor === services };
}
