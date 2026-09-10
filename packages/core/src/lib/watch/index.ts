/**
 * Watches: the portable half of what the web app calls a standing query.
 *
 * The cron, the database and the Telegram transport stay in `src/lib/scheduler/` — a client app
 * has none of them. What is here is what a shell actually needs: turn rows into a snapshot,
 * compare two snapshots, and hash one for identity.
 */
export * from "./diff";
export * from "./watch";
export type { CellSnapshot, DiffOptions, PriceDrop, SnapshotDiff } from "./types";
