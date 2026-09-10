/**
 * Settings: the key, and the cache.
 *
 * The whole of `src/lib/keys/` (438 lines) and `src/lib/crypto/aes.ts` collapse to this screen.
 * They existed to stop one user's key being readable by another on a shared host; with one device
 * and one user the OS Keychain does that job, and what survives is the discipline rather than the
 * machinery: the key is never rendered, never logged, and never shown beyond its last four
 * characters (LEGAL.md, "Credentials").
 */
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { maskedKey } from "../native/keychain";

export function SettingsScreen() {
  const services = useOutletContext<AppServices>();
  const [masked, setMasked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const key = await services.keys.get();
    setMasked(key ? maskedKey(key) : null);
  }, [services]);

  // Load on mount with a cancellation guard rather than calling `refresh()` straight from the
  // effect body: that reads as a synchronous setState to the React compiler lint, and it would
  // also set state on an unmounted screen if the user navigates away mid-read.
  useEffect(() => {
    let cancelled = false;
    void services.keys.get().then((key) => {
      if (!cancelled) setMasked(key ? maskedKey(key) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const save = useCallback(async () => {
    try {
      await services.keys.set(draft);
      setDraft("");
      setStatus({ text: "Saved to the device Keychain.", ok: true });
      await refresh();
    } catch (e) {
      // Keychain failures land here (e.g. -34018 errSecMissingEntitlement on an unsigned
      // build). They are failures and must not be painted like a success.
      setStatus({ text: `Could not save the key: ${e instanceof Error ? e.message : String(e)}`, ok: false });
    }
  }, [draft, refresh, services]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640, margin: "0 auto" }}>
      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>seats.aero Pro key</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--fg-muted)" }}>
          Your own key, stored in this device&apos;s Keychain and sent only to seats.aero. awardgrid
          has no key of its own and no server to route through. Generate one on the API tab of your{" "}
          seats.aero settings page.
        </p>
        <p className="tabular" style={{ margin: "0 0 10px", fontSize: 13 }}>
          {masked ? `On file: ${masked}` : "No key on file."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your Pro key"
            aria-label="seats.aero Pro key"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              flex: "1 1 100%",
              padding: 9,
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--line)",
              background: "var(--bg-raised)",
              color: "var(--fg)",
            }}
          />
          <button
            onClick={() => void save()}
            disabled={!draft.trim()}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--radius-control)",
              border: "none",
              background: draft.trim() ? "var(--accent)" : "var(--line)",
              color: draft.trim() ? "var(--bg)" : "var(--fg-muted)",
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
        {masked ? (
          <button
            onClick={async () => {
              await services.keys.clear();
              setStatus({ text: "Key removed from the Keychain.", ok: true });
              await refresh();
            }}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--error)",
              fontSize: 13,
            }}
          >
            Remove key
          </button>
        ) : null}
      </section>

      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Cached data</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--fg-muted)" }}>
          Award results are cached on this device for 45 minutes so repeating a search costs no
          seats.aero calls. Clearing it costs one cold search, nothing more. This does not touch
          your key.
        </p>
        <button
          onClick={async () => {
            // Memory and disk, and nothing else: quota spent today and the user's watches survive.
            await services.clearCache();
            setStatus({ text: "Cached results cleared. Your key is untouched.", ok: true });
          }}
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-control)",
            border: "1px solid var(--line)",
            background: "transparent",
            fontSize: 13,
          }}
        >
          Clear cached results
        </button>
      </section>

      {status ? (
        <p
          role={status.ok ? "status" : "alert"}
          style={{ margin: 0, fontSize: 13, color: status.ok ? "var(--fresh)" : "var(--error)" }}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
