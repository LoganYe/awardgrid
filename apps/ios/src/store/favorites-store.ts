/**
 * The favourites store lives in core since T18 (packages/core/src/lib/workspace/favorites-store.ts), so the Web keeps
 * each account's saved options with the same rules (U-053). This path stays for the iOS shell's imports.
 */
export * from "@awardgrid/core/workspace/favorites-store";
