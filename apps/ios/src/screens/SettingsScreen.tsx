/**
 * Settings: the keys, and the cache.
 *
 * The whole of `src/lib/keys/` (438 lines) and `src/lib/crypto/aes.ts` collapse to this screen.
 * They existed to stop one user's key being readable by another on a shared host; with one device
 * and one user the OS Keychain does that job, and what survives is the discipline rather than the
 * machinery: a key is never rendered, never logged, and never shown beyond its last four
 * characters (LEGAL.md, "Credentials").
 *
 * Two keys, two Keychain items, two sections. The Anthropic key is optional and used by Ask alone
 * (design §7). Save stores it first, so a key pasted while offline is kept, and then checks it with
 * a request that carries no question; Check key repeats the check. Every result is shown in its own
 * tone, and a Keychain failure is a failure, never painted like a success.
 */
import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { askRequestIdLine, scrubSecrets } from "@awardgrid/core/ask/errors";
import type { AppServices } from "../app/bootstrap";
import type { KeyCheckResult } from "../ask/ask-service";
import {
  ANTHROPIC_DATA_SENT,
  ANTHROPIC_KEY_INPUT_LABEL,
  ANTHROPIC_KEY_PLACEHOLDER,
  ANTHROPIC_KEY_USE,
  ANTHROPIC_SECTION_TITLE,
  CACHE_CLEARED,
  CACHE_NOTE,
  CHECK_KEY,
  KEY_CHECKING,
  KEY_NOT_REMOVED,
  KEY_REMOVAL_NOTE,
  KEY_REMOVED,
  KEY_SAVED,
  NO_KEY_ON_FILE,
  PRICING_LINE,
  PRICING_URL,
  REMOVE_ANTHROPIC_KEY_NAME,
  REMOVE_KEY,
  REMOVE_SEATS_KEY_NAME,
  SAVE_ANTHROPIC_KEY_NAME,
  SAVE_KEY,
  SAVE_SEATS_KEY_NAME,
  SEATS_KEY_NOT_SENT,
  keyOnFileLabel,
  keyReadFailedLabel,
  keySaveFailedLabel,
} from "../ask/labels";
import { type KeyStore, maskedKey } from "../native/keychain";

// ---------------------------------------------------------------------------
// The Anthropic key's actions, apart from the markup so they are tested without a DOM
// ---------------------------------------------------------------------------

/** A result line: its sentence, its tone, and Anthropic's request ID when the response carried one. */
export interface KeyStatus {
  text: string;
  ok: boolean;
  requestIdLine: string | null;
}

type AnthropicKeyServices = Pick<AppServices, "anthropicKeys" | "ask">;

/** What a key check says, in its tone. */
export function checkStatus(result: KeyCheckResult): KeyStatus {
  return { text: result.message, ok: result.ok, requestIdLine: result.requestId ? askRequestIdLine(result.requestId) : null };
}

/** "On file: ••••abcd", "No Anthropic key on file.", or nothing while the Keychain has not been read (`undefined`). */
export function anthropicKeyLine(masked: string | null | undefined): string | null {
  if (masked === undefined) return null;
  return masked === null ? NO_KEY_ON_FILE : keyOnFileLabel(masked);
}

/** The key on file, masked to its last four characters, or null. A store that throws has no key to show. */
export async function readMasked(store: KeyStore): Promise<string | null> {
  try {
    const key = await store.get();
    return key ? maskedKey(key) : null;
  } catch {
    return null;
  }
}

/**
 * Save, then check (design §7). The key is stored first and `onSaved` runs as soon as it is, so the screen can say
 * so before Anthropic answers. A store that refuses the key ends it there: nothing is checked, and the store's own
 * words are shown masked of the pasted key.
 */
export async function saveAnthropicKey(services: AnthropicKeyServices, draft: string, onSaved: () => void | Promise<void>): Promise<KeyStatus> {
  try {
    await services.anthropicKeys.set(draft);
  } catch (err) {
    return { text: keySaveFailedLabel(scrubSecrets(errorText(err), [draft, draft.trim()])), ok: false, requestIdLine: null };
  }
  await onSaved();
  return checkStatus(await services.ask.checkKey());
}

/** Remove the key, then read the Keychain again: a removal is reported only when the key is really gone. */
export async function removeAnthropicKey(services: Pick<AppServices, "anthropicKeys">): Promise<KeyStatus> {
  let before: string | null = null;
  try {
    before = await services.anthropicKeys.get();
  } catch {
    // Nothing to mask with; the removal is still tried.
  }
  try {
    await services.anthropicKeys.clear();
  } catch {
    // The read below says whether the key went.
  }
  try {
    const after = await services.anthropicKeys.get();
    return after ? { text: KEY_NOT_REMOVED, ok: false, requestIdLine: null } : { text: KEY_REMOVED, ok: true, requestIdLine: null };
  } catch (err) {
    return { text: keyReadFailedLabel(scrubSecrets(errorText(err), [before])), ok: false, requestIdLine: null };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message || err.name : String(err);
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

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
      setStatus({ text: "seats.aero key saved to the device Keychain.", ok: true });
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
          seats.aero settings page. {SEATS_KEY_NOT_SENT}
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
            aria-label={SAVE_SEATS_KEY_NAME}
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
            aria-label={REMOVE_SEATS_KEY_NAME}
            onClick={async () => {
              await services.keys.clear();
              setStatus({ text: "seats.aero key removed from the Keychain.", ok: true });
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

      <AnthropicKeySection services={services} />

      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Cached data</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--fg-muted)" }}>{CACHE_NOTE}</p>
        <button
          onClick={async () => {
            // Memory and disk, and nothing else: quota spent today, the user's watches, both keys and ask.json survive.
            await services.clearCache();
            setStatus({ text: CACHE_CLEARED, ok: true });
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

/**
 * "Anthropic API key (for Ask)" (design §7). The key is read here for its last four characters only, and a check
 * runs only when the person saves or taps Check key.
 */
export function AnthropicKeySection({ services }: { services: AnthropicKeyServices }) {
  /** undefined until the Keychain has been read, so the screen never says "no key" before it knows. */
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readMasked(services.anthropicKeys).then((found) => {
      if (!cancelled) setMasked(found);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  /** One action at a time; each starts from a clean slate of result lines. */
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setSaved(false);
    setChecking(false);
    setResult(null);
    try {
      await action();
    } finally {
      setChecking(false);
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      const status = await saveAnthropicKey(services, draft, async () => {
        setDraft("");
        setSaved(true);
        setChecking(true);
        setMasked(await readMasked(services.anthropicKeys));
      });
      setResult(status);
    });

  const check = () =>
    act(async () => {
      setChecking(true);
      setResult(checkStatus(await services.ask.checkKey()));
    });

  const remove = () =>
    act(async () => {
      setResult(await removeAnthropicKey(services));
      setMasked(await readMasked(services.anthropicKeys));
    });

  const onFile = anthropicKeyLine(masked);

  return (
    <section className="settings-section">
      <h2 className="settings-heading">{ANTHROPIC_SECTION_TITLE}</h2>
      <p className="settings-copy">{ANTHROPIC_KEY_USE}</p>
      <p className="settings-copy">{ANTHROPIC_DATA_SENT}</p>
      <p className="settings-copy">
        <a href={PRICING_URL} target="_blank" rel="noreferrer noopener">
          {PRICING_LINE}
        </a>
      </p>
      {onFile !== null ? <p className="tabular settings-on-file">{onFile}</p> : null}

      <div className="settings-row">
        <input
          type="password"
          className="ag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={ANTHROPIC_KEY_PLACEHOLDER}
          aria-label={ANTHROPIC_KEY_INPUT_LABEL}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="ag-button ag-button-primary"
          aria-label={SAVE_ANTHROPIC_KEY_NAME}
          disabled={busy || draft.trim().length === 0}
          onClick={() => void save()}
        >
          {SAVE_KEY}
        </button>
      </div>

      {masked ? (
        <>
          <div className="settings-row">
            <button type="button" className="ag-button" disabled={busy} onClick={() => void check()}>
              {CHECK_KEY}
            </button>
            <button type="button" className="ag-button ag-button-danger" aria-label={REMOVE_ANTHROPIC_KEY_NAME} disabled={busy} onClick={() => void remove()}>
              {REMOVE_KEY}
            </button>
          </div>
          <p className="settings-note">{KEY_REMOVAL_NOTE}</p>
        </>
      ) : null}

      {/* Always mounted, so what lands in it is announced; a failure is an alert of its own below. */}
      <div role="status" className="settings-results">
        {saved ? <p className="settings-ok">{KEY_SAVED}</p> : null}
        {checking ? <p>{KEY_CHECKING}</p> : null}
        {result?.ok ? <p className="settings-ok">{result.text}</p> : null}
      </div>
      {result !== null && !result.ok ? (
        <div role="alert" className="settings-results settings-fail">
          <p>{result.text}</p>
          {result.requestIdLine !== null ? <p className="tabular">{result.requestIdLine}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
