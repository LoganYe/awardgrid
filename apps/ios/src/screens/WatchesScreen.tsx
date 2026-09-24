/**
 * Watches.
 *
 * Every sentence on this screen is constrained by one rule from `docs/PIVOT.md` §3: "Promising a
 * cadence the OS will not honour is the one lie this product must not tell." So this screen says
 * when a watch was last checked, never when it will be; it says a change is found when the user
 * opens the app, not when the change happens; and it says there is no background check, because
 * there is none (./../watch/capabilities.ts). Its words, in English and Chinese, are in ./watches-copy.ts;
 * `honesty.test.ts` fails CI on any string there
 * that promises a cadence or claims a background check.
 *
 * Changes are shown as "since you last looked" and cleared once this screen has been opened. They
 * accumulate across checks until then (`Watch.unseen`), because each check moves the baseline and a
 * quiet check would otherwise erase an earlier check's news.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { type Watch, sinceLastCheck } from "@awardgrid/core/watch";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { langTag, useLocale } from "../app/locale";
import { Button, Sheet } from "../components/ui";
import { WATCH_CHECKS } from "../watch/capabilities";
import { WATCHES, type WatchesCopy } from "./watches-copy";

function ago(iso: string, now: Date, w: WatchesCopy): string {
  const s = sinceLastCheck(iso, now);
  if (!s || (s.unit === "minute" && s.value < 1)) return w.justNow;
  return w.ago(s.value, s.unit === "minute" ? "minute" : s.unit === "hour" ? "hour" : "day");
}

/** The status sentence, and the engine's own (English) message it ends with, if any. */
function statusLine(watch: Watch, now: Date, w: WatchesCopy): { text: string; tail?: string } {
  if (!watch.enabled) return { text: w.paused };
  const r = watch.lastResult;
  if (r?.status === "failed" && (!watch.lastCheckedAt || r.at > watch.lastCheckedAt)) {
    return r.message ? { text: w.failed(ago(r.at, now, w), r.message), tail: r.message } : { text: w.failed(ago(r.at, now, w), w.unknownError) };
  }
  if (!watch.lastCheckedAt) return { text: w.notChecked };
  if (r?.status === "checked" && r.firstCheck) return { text: w.baseline(ago(watch.lastCheckedAt, now, w)) };
  return { text: w.lastChecked(ago(watch.lastCheckedAt, now, w)) };
}

export function WatchesScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = WATCHES[locale];
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

  // Stopping asks first, in the screen's language (a native confirm's buttons are always English).
  const [stopping, setStopping] = useState<Watch | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const remove = useCallback(
    async (w: Watch) => {
      setStopping(null);
      services.watches.remove(w.id);
      await services.persist();
      services.notifyWatchesChanged();
      // Its row, and the button that asked, are gone: focus goes to the page title.
      window.requestAnimationFrame(() => title.current?.focus());
    },
    [services, setStopping],
  );

  const lastRun = services.lastWatchRun();
  const skipSentence = (id: string): string | null => {
    const outcome = lastRun.find((r) => r.watchId === id)?.outcome;
    if (outcome?.status !== "skipped") return null;
    // Only the skips a user can act on. "Checked recently" and "paused" are already visible.
    if (outcome.reason === "no_key") return t.skipNoKey;
    if (outcome.reason === "quota_low") return t.skipQuota;
    return null;
  };

  return (
    <div lang={langTag(locale)} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 720, margin: "0 auto" }}>
      <section data-surface="rich" className="ag-surface">
        <p className="ag-eyebrow">{t.eyebrow}</p>
        <h1 ref={title} tabIndex={-1} className="ag-title">
          {t.title}
        </h1>
        {WATCH_CHECKS.inBackground ? null : (
          <>
            <p style={{ margin: "0 0 var(--space-2)" }}>{t.onOpen}</p>
            <p style={{ margin: "0 0 var(--space-2)", color: "var(--fg-muted)" }}>{t.noBackground}</p>
          </>
        )}
        <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--type-meta)" }}>{t.skipSoon}</p>
      </section>

      {watches.length === 0 ? (
        <p className="ag-surface" style={{ margin: 0 }}>
          {t.empty.before}
          <strong>{t.empty.action}</strong>
          {t.empty.after}
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
                  <WithTail {...statusLine(w, now, t)} tailLang={locale === "en" ? undefined : "en"} />
                </span>
                {unseen ? (
                  <span className="tabular" style={{ display: "block", color: "var(--accent)", fontWeight: 600 }}>
                    {t.unseen(unseen)}
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
                    {w.enabled ? t.pause : t.resume}
                  </button>
                  <button
                    onClick={() => setStopping(w)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--line)",
                      background: "transparent",
                      color: "var(--error)",
                    }}
                  >
                    {t.stop}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={stopping !== null} title={stopping ? t.confirmStop(stopping.name) : ""} closeLabel={t.close} onClose={() => setStopping(null)}>
        <p style={{ margin: 0 }}>{t.confirmStopBody}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ag-space-2)", marginTop: "var(--ag-space-3)" }}>
          <Button variant="danger" onClick={() => stopping && void remove(stopping)}>
            {t.stop}
          </Button>
          <Button onClick={() => setStopping(null)}>{t.keepWatching}</Button>
        </div>
      </Sheet>
    </div>
  );
}
