/**
 * The SeatsPort Ask's tools run on, built from the grid lane's own pieces.
 *
 * Core's tools (packages/core/src/lib/ask/tools.ts) keep no second cache and count no call a second way. They take
 * the device's cache, routes catalog and Quota, and the transport a grid search uses, and this file hands them
 * exactly those: SearchEngine's `cache`, `routes` and `quota`, and bootstrap's seats.aero transport, which is the
 * X-RateLimit-Remaining observer over the native adapter (bootstrap.ts `seatsTransport`). A tool's request
 * therefore passes the question's budget guard, then the observer, then the adapter. seats.aero's own count
 * corrects the quota after a tool call exactly as it does after a grid search.
 *
 * The keys arrive as values the caller read when the question started (ask-service.ts), never at launch. The
 * Anthropic key is only a secret to mask from tool results; no seats.aero request carries it.
 */
import type { SeatsPort } from "@awardgrid/core/ask/tools";
import { LOCAL_USER, type SearchEngine } from "../search/search";

export interface SeatsPortKeys {
  /** The person's seats.aero Pro key. */
  seatsAero: string;
  /** The Anthropic key the question runs on, masked from every tool result. */
  anthropic: string | null;
}

export interface CreateSeatsPortOptions {
  /** Bootstrap's seats.aero transport: the rate-limit observer over the native adapter. Never the Anthropic one. */
  fetchImpl: typeof fetch;
  engine: Pick<SearchEngine, "cache" | "routes" | "quota">;
  keys: SeatsPortKeys;
  /**
   * AppServices.persist: the cache and quota snapshots, and ask.json. The runner calls it after any call that moved
   * the quota, so what a paid call learned is on disk before the question goes on.
   */
  persist(): Promise<void>;
  /** The clock the engine's Quota was built with. */
  now: () => Date;
}

export function createSeatsPort(opts: CreateSeatsPortOptions): SeatsPort {
  // The service refuses a missing key before it gets here; a blank one reaching this is a bug, not a state.
  if (!opts.keys.seatsAero.trim()) throw new Error("createSeatsPort needs the person's seats.aero key.");
  return {
    userId: LOCAL_USER,
    apiKey: opts.keys.seatsAero,
    fetch: opts.fetchImpl,
    quota: opts.engine.quota,
    cache: opts.engine.cache,
    routes: opts.engine.routes,
    now: opts.now,
    persist: () => opts.persist(),
    secrets: opts.keys.anthropic ? [opts.keys.anthropic] : [],
  };
}
