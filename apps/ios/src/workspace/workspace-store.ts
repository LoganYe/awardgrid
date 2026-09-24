/**
 * The workspace store lives in core since T18 (packages/core/src/lib/workspace/workspace-store.ts), so the Web keeps
 * its own per-account workspace with the same rules (U-053). This path stays for the iOS shell's imports.
 */
export * from "@awardgrid/core/workspace/workspace-store";
