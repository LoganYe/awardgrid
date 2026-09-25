/**
 * The Web workspace's search port (UI/UX v1 T18): the existing authenticated /api/find, whose server resolves this
 * account's own seats.aero key, cache and quota, mapped to the same ResultSnapshot iOS builds (core
 * workspace/snapshot-from-find.ts). The browser never sees a key.
 *
 * An answer that lands after the account signed out in this tab (storage.ts deviceEpoch) is dropped, never shown or
 * kept: the request already sent is not recalled, but its rows do not outlive the session (T18 review REG-1).
 */
import { snapshotFromFind } from "@awardgrid/core/workspace/snapshot-from-find";
import { SearchRunError } from "@awardgrid/core/workspace/workspace-store";
import type { SearchPort } from "@awardgrid/core/workspace/types";
import { apiFind } from "@/components/grid/api";
import { deviceEpoch } from "./storage";

export function webSearchPort(now: () => Date = () => new Date()): SearchPort {
  const madeAt = deviceEpoch();
  return {
    async execute(query, run) {
      if (run.signal?.aborted) throw new SearchRunError("superseded", "A newer search started before this one was sent.");
      if (deviceEpoch() !== madeAt) throw new SearchRunError("signed_out", "The account signed out on this browser; nothing was sent.");
      const result = await apiFind(query, "dates", run.signal);
      if (deviceEpoch() !== madeAt) throw new SearchRunError("signed_out", "The account signed out on this browser while this search ran; its answer is not kept.");
      if (!result.ok) throw new SearchRunError(result.error, result.message);
      const value = result.value;
      return snapshotFromFind(
        {
          query: value.grid.query,
          rows: value.rows,
          coverage: value.coverage ?? null,
          api_calls_used: value.grid.meta.api_calls_used,
          served_from_cache: value.grid.meta.served_from_cache,
        },
        run,
        now().toISOString(),
      );
    },
  };
}
