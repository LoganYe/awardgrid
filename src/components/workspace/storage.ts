/**
 * Each account's own storage on this browser (UI/UX v1 T18; docs/02 D07; acceptance A30).
 *
 * The Web keeps a workspace (the searches on screen) and saved options per signed-in account, in localStorage under
 * a key that names the store and the account: JSON.stringify(["awardgrid-workspace-v1", userId, name]). The account
 * id comes from the server's session (the page's own props), never from a query string. So another account on the
 * same browser reads a different key and never sees them, without anything being emptied.
 *
 * On logout, every account's workspace (results, the view) is removed from this browser, as the conversation is;
 * saved options stay, under their own account's key, for when that account signs in again.
 *
 * A value that cannot be read is not written over (as the device storage refuses to, U-047): its store reads as
 * unreadable, and a later save is refused until it is removed.
 *
 * Every logout and login in this tab moves the device's epoch (forgetWorkspacesOnDevice). Storage made before it
 * writes nothing more, so an answer that lands after the account left (a search still in flight at logout) cannot put
 * that account's results back on the browser (T18 review REG-1).
 */
import type { StoragePort } from "@awardgrid/core/workspace/types";

export const WORKSPACE_STORE = "awardgrid-workspace-v1";
export const FAVORITES_STORE = "awardgrid-favorites-v1";

export class UnreadableWebStorageError extends Error {
  constructor(readonly key: string) {
    super("A saved value on this browser could not be read, so it is not written over.");
    this.name = "UnreadableWebStorageError";
  }
}

export class SignedOutWebStorageError extends Error {
  constructor() {
    super("The account signed out on this browser after this page opened, so nothing more is written for it.");
    this.name = "SignedOutWebStorageError";
  }
}

let epoch = 0;

/** The device's epoch: moved by every logout and login in this tab (forgetWorkspacesOnDevice). */
export function deviceEpoch(): number {
  return epoch;
}

/** The key one account's value lives under: the store, the account, the store's own name. */
export function storageKey(store: string, userId: string, name: string): string {
  return JSON.stringify([store, userId, name]);
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage switched off, or a private mode that refuses it.
    return null;
  }
}

/** A StoragePort over one account's part of this browser's storage. */
export function webStorage(store: string, userId: string, backing: Storage | null = browserStorage()): StoragePort {
  const unreadable = new Set<string>();
  const madeAt = epoch;
  return {
    async read(name) {
      const key = storageKey(store, userId, name);
      const raw = backing?.getItem(key) ?? null;
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        unreadable.add(key);
        throw new UnreadableWebStorageError(key);
      }
    },
    async writeAtomically(name, value) {
      const key = storageKey(store, userId, name);
      if (!backing) throw new Error("This browser keeps no storage for this page.");
      if (epoch !== madeAt) throw new SignedOutWebStorageError();
      if (unreadable.has(key)) throw new UnreadableWebStorageError(key);
      backing.setItem(key, JSON.stringify(value));
    },
    async remove(name) {
      const key = storageKey(store, userId, name);
      backing?.removeItem(key);
      unreadable.delete(key);
    },
  };
}

/**
 * On logout (and login): every account's workspace leaves this browser, and storage made before now writes nothing
 * more. Saved options stay, each under its own account.
 */
export function forgetWorkspacesOnDevice(backing: Storage | null = browserStorage()): void {
  epoch += 1;
  if (!backing) return;
  const doomed: string[] = [];
  for (let i = 0; i < backing.length; i++) {
    const key = backing.key(i);
    if (key === null) continue;
    try {
      const parsed = JSON.parse(key) as unknown;
      if (Array.isArray(parsed) && parsed[0] === WORKSPACE_STORE) doomed.push(key);
    } catch {
      // Not one of ours.
    }
  }
  for (const key of doomed) backing.removeItem(key);
}
