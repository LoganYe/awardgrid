/**
 * The search screen.
 *
 * Deliberately plain: PIVOT §6 puts the design system and the real grid components in Phase 3,
 * and the `ApiResult` contract in `src/search/search.ts` is what makes that a small diff rather
 * than a rewrite. What this screen does own is the honesty rules, which are not cosmetic:
 *
 *   - **No cancel button.** Phase 0 measured that `AbortSignal` does not cancel a native request
 *     (docs/PHASE0.md §3): the promise rejects, the request completes, the quota call is spent.
 *     A "Cancel" that implied the search had been called off would be a lie about the user's
 *     money, so the search is bounded by a native timeout instead and simply cannot be recalled.
 *   - **"Last checked", never "next check".** PIVOT §3: "Never print a next-run time." Nothing
 *     here promises a cadence, because iOS cannot honour one.
 *   - **Freshness is reported from the data**, not from when the button was pressed —
 *     `fetched_at_min` is the oldest row in the answer, so a cache hit says so honestly.
 */
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import type { ApiResult, FindValue, QuotaSnapshotView } from "../search/search";
import { GridTable } from "../components/GridTable";

const EXAMPLES = [
  "HKG, SHA to SEA, next 30 days, business and first",
  "SFO to NRT next 60 days business",
  "LHR to JFK, next 2 weeks, first",
];

/** "2 h ago" from an ISO timestamp. Past tense only — this never extrapolates forwards. */
function agoLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function SearchScreen() {
  const services = useOutletContext<AppServices>();
  const [text, setText] = useState(EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult<FindValue> | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshotView | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [watchMessage, setWatchMessage] = useState<string | null>(null);

  useEffect(() => {
    void services.keys.get().then((k) => setHasKey(Boolean(k)));
    void services.engine.quotaView().then(setQuota);
  }, [services]);

  const run = useCallback(async () => {
    setBusy(true);
    setWatchMessage(null);
    try {
      const key = await services.keys.get();
      const res = await services.engine.search(text, key);
      setResult(res);
      setQuota(await services.engine.quotaView());
      // A search is the moment worth persisting: it is the only thing that spends quota.
      await services.persist();
    } finally {
      setBusy(false);
    }
  }, [services, text]);

  /**
   * Watch the query exactly as typed. The TEXT is stored, not the parsed dates, so "next 30 days"
   * keeps meaning the next 30 days — the fix for the web app's issue #47, where a standing query
   * froze its dates and went silent once they passed.
   */
  const watchThis = useCallback(async () => {
    const trimmed = text.trim();
    const added = services.watches.add({
      id: crypto.randomUUID(),
      name: trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed,
      text: trimmed,
      lastCheckedAt: null,
      baseline: [],
      dropThresholdPct: 10,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    if (!added.ok) {
      setWatchMessage(
        added.reason === "duplicate" ? "You are already watching this search." : "You have reached the limit of 20 watches.",
      );
      return;
    }
    setWatchMessage("Watching this search. It is checked when you open the app.");
    await services.persist();
    services.notifyWatchesChanged();
  }, [services, text]);

  const value = result?.ok ? result.value : null;
  const failure = result && !result.ok ? result : null;
  const checked = value ? agoLabel(value.fetched_at_min, new Date()) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900, margin: "0 auto" }}>
      <label htmlFor="q" style={{ fontSize: 13, color: "var(--fg-muted)" }}>
        Search awards
      </label>
      <textarea
        id="q"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        style={{
          font: "inherit",
          padding: 10,
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--line)",
          background: "var(--bg-raised)",
          color: "var(--fg)",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => void run()}
          disabled={busy || hasKey === false}
          style={{
            padding: "9px 18px",
            borderRadius: "var(--radius-control)",
            border: "none",
            background: busy || hasKey === false ? "var(--line)" : "var(--accent)",
            color: busy || hasKey === false ? "var(--fg-muted)" : "var(--bg)",
            fontWeight: 600,
          }}
        >
          {busy ? "Searching…" : "Run"}
        </button>
        {/* No cancel button, on purpose — see the note at the top of this file. */}
        {value ? (
          <button
            onClick={() => void watchThis()}
            style={{
              padding: "9px 14px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--line)",
              background: "transparent",
            }}
          >
            Watch this search
          </button>
        ) : null}
        {quota ? (
          <span className="tabular" style={{ fontSize: 12, color: "var(--fg-muted)" }}>
            seats.aero calls today: {quota.used} of {quota.softLimit}
          </span>
        ) : null}
      </div>

      {watchMessage ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)" }}>
          {watchMessage}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => setText(e)}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--bg-raised)",
              color: "var(--fg-muted)",
            }}
          >
            {e}
          </button>
        ))}
      </div>

      {hasKey === false ? (
        <Callout tone="danger">
          No seats.aero key yet. Add your own Pro key in <strong>Settings</strong> — awardgrid has no
          key of its own and never will.
        </Callout>
      ) : null}

      {failure ? <Callout tone="danger">{failure.message ?? failure.error}</Callout> : null}

      {value ? (
        <>
          <div style={{ fontSize: 12, color: "var(--fg-muted)" }} className="tabular">
            {value.served_from_cache
              ? `Served from this device's cache${checked ? ` · last checked ${checked}` : ""}`
              : `${value.api_calls_used} seats.aero call${value.api_calls_used === 1 ? "" : "s"}${checked ? ` · checked ${checked}` : ""}`}
          </div>
          {value.warnings.map((w) => (
            <Callout key={w} tone="warn">
              {w}
            </Callout>
          ))}
          <GridTable grid={value.grid} />
        </>
      ) : null}
    </div>
  );
}

function Callout({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      style={{
        margin: 0,
        padding: "8px 10px",
        borderRadius: "var(--radius-control)",
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${tone === "danger" ? "var(--error)" : "var(--fg-muted)"}`,
        background: "var(--bg-raised)",
        fontSize: 13,
      }}
    >
      {children}
    </p>
  );
}
