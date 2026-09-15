/**
 * Watches.
 *
 * Every sentence on this screen is constrained by one rule from `docs/PIVOT.md` §3: "Promising a
 * cadence the OS will not honour is the one lie this product must not tell." So this screen says
 * when a watch was last checked, never when it will be; it says a change is found when the user
 * opens the app, not when the change happens; and it says there is no background check, because
 * there is none (./../watch/capabilities.ts). `honesty.test.ts` fails CI on any string here
 * that promises a cadence or claims a background check.
 *
 * Changes are shown as "since you last looked" and cleared once this screen has been opened. They
 * accumulate across checks until then (`Watch.unseen`), because each check moves the baseline and a
 * quiet check would otherwise erase an earlier check's news.
 */
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { type Watch, sinceLastCheck } from "@awardgrid/core/watch";
import type { AppServices } from "../app/bootstrap";
import { WATCH_CHECKS } from "../watch/capabilities";

function ago(iso: string, now: Date): string {
  const s = sinceLastCheck(iso, now);
  if (!s || (s.unit === "minute" && s.value < 1)) return "just now";
  const unit = s.unit === "minute" ? "min" : s.unit === "hour" ? "h" : "d";
  return `${s.value} ${unit} ago`;
}

function statusLine(w: Watch, now: Date): string {
  if (!w.enabled) return "Paused. It is not checked until you resume it.";
  const r = w.lastResult;
  if (r?.status === "failed" && (!w.lastCheckedAt || r.at > w.lastCheckedAt)) {
    return `Last attempt failed ${ago(r.at, now)}: ${r.message ?? "unknown error"}`;
  }
  if (!w.lastCheckedAt) return "Not checked yet.";
  if (r?.status === "checked" && r.firstCheck) {
    return `Baseline saved ${ago(w.lastCheckedAt, now)}. Later checks report what changes.`;
  }
  return `Last checked ${ago(w.lastCheckedAt, now)}`;
}

function unseenLine(u: NonNullable<Watch["unseen"]>): string {
  const parts = [
    u.new ? `${u.new} new` : null,
    u.dropped ? `${u.dropped} gone` : null,
    u.cheaper ? `${u.cheaper} cheaper` : null,
  ].filter(Boolean);
  return `${parts.join(", ")} since you last looked`;
}

export function WatchesScreen() {
  const services = useOutletContext<AppServices>();
  const read = useCallback(() => services.watches.all().map((w) => ({ ...w })), [services]);
  const [watches, setWatches] = useState<Watch[]>(read);
  // What was unseen when the screen opened, kept for display after it is marked seen below.
  const [openedWith] = useState(() => new Map(services.watches.all().map((w) => [w.id, w.unseen ?? null])));
  const now = new Date();

  useEffect(() => {
    let cleared = false;
    for (const w of services.watches.all()) {
      if (w.unseen) {
        services.watches.update(w.id, { unseen: null });
        cleared = true;
      }
    }
    if (cleared) {
      void services.persist();
      services.notifyWatchesChanged();
    }
    return services.onWatchesChanged(() => setWatches(read()));
  }, [services, read]);

  const toggle = useCallback(
    async (w: Watch) => {
      services.watches.update(w.id, { enabled: !w.enabled });
      await services.persist();
      services.notifyWatchesChanged();
    },
    [services],
  );

  const remove = useCallback(
    async (w: Watch) => {
      if (!window.confirm(`Stop watching "${w.name}"?`)) return;
      services.watches.remove(w.id);
      await services.persist();
      services.notifyWatchesChanged();
    },
    [services],
  );

  const lastRun = services.lastWatchRun();
  const skipSentence = (id: string): string | null => {
    const outcome = lastRun.find((r) => r.watchId === id)?.outcome;
    if (outcome?.status !== "skipped") return null;
    // Only the skips a user can act on. "Checked recently" and "paused" are already visible.
    if (outcome.reason === "no_key") return "Not checked: add your seats.aero key in Settings.";
    if (outcome.reason === "quota_low") {
      return "Not checked: fewer than 25 seats.aero calls are left today, and those are kept for your own searches.";
    }
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 720, margin: "0 auto" }}>
      <section data-surface="rich" className="ag-surface">
        <p className="ag-eyebrow">Watches</p>
        <h1 className="ag-title">Searches you are watching</h1>
        {WATCH_CHECKS.inBackground ? null : (
          <>
            <p style={{ margin: "0 0 var(--space-2)" }}>Each watch is checked when you open the app, and at no other time.</p>
            <p style={{ margin: "0 0 var(--space-2)", color: "var(--fg-muted)" }}>
              There is no background check, so a change is found the next time you open the app, not when it happens.
            </p>
          </>
        )}
        <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--type-meta)" }}>
          A check sooner than 45 minutes after the previous one is skipped: seats.aero&apos;s cached data could not be any
          newer, and skipping keeps your daily calls for your own searches.
        </p>
      </section>

      {watches.length === 0 ? (
        <p className="ag-surface" style={{ margin: 0 }}>
          You are not watching any searches yet. Run a search, then choose <strong>Watch this search</strong>.
        </p>
      ) : (
        <ul data-surface="flat" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
          {watches.map((w, i) => {
            const unseen = w.unseen ?? openedWith.get(w.id) ?? null;
            const skip = skipSentence(w.id);
            return (
              // Rows share borders: every row but the first drops its top edge.
              <li key={w.id} className="ag-surface" style={i === 0 ? undefined : { borderTopWidth: 0 }}>
                <strong style={{ display: "block" }}>{w.name}</strong>
                {/* The name is the query cut to 60 characters; the full query is shown only when it was cut. */}
                {w.text !== w.name ? (
                  <span style={{ display: "block", color: "var(--fg-muted)", fontSize: "var(--type-meta)" }}>{w.text}</span>
                ) : null}
                <span className="tabular" style={{ display: "block", marginTop: "var(--space-1)", fontSize: "var(--type-meta)" }}>
                  {statusLine(w, now)}
                </span>
                {unseen ? (
                  <span className="tabular" style={{ display: "block", color: "var(--accent)", fontWeight: 600 }}>
                    {unseenLine(unseen)}
                  </span>
                ) : null}
                {skip ? (
                  <span role="status" style={{ display: "block", color: "var(--error)", fontSize: "var(--type-meta)" }}>
                    {skip}
                  </span>
                ) : null}
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                  <button
                    onClick={() => void toggle(w)}
                    style={{ padding: "6px 12px", borderRadius: "var(--radius-control)", border: "1px solid var(--line)", background: "transparent" }}
                  >
                    {w.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => void remove(w)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--line)",
                      background: "transparent",
                      color: "var(--error)",
                    }}
                  >
                    Stop watching
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
