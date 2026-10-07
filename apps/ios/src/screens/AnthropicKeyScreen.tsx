/**
 * Settings › AI (optional) › the Anthropic key (S08 "AI（可选）"; design §7): its own page — what the key is for, what
 * Ask sends to Anthropic, the pricing link, the key field, Save, Check key and Remove key — and whether Ask may send
 * data to Anthropic (release D10, given on the Ask screen's consent sheet), with the way to withdraw it.
 *
 * Its own module, loaded lazily by App.tsx, so the App Store build (app/flags.ts STORE), which has no Ask, compiles the
 * page and its words (./anthropic-copy.ts) out of the bundle (scripts/check-store-bundle.mjs).
 *
 * The keys' discipline is Settings' (LEGAL.md "Credentials"): the key is never rendered, logged, or shown beyond its
 * last four characters, and a Keychain failure is a failure, never painted like a success.
 */
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOutletContext } from "react-router";
import { askRequestIdLine, scrubSecrets } from "@awardgrid/core/ask/errors";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { useFocusOnArrival } from "../app/focus";
import { type Locale, langTag, useLocale } from "../app/locale";
import type { KeyCheckResult } from "../ask/ask-service";
import { CONSENT } from "../ask/consent-copy";
import { PRICING_URL } from "../ask/labels";
import { type KeyStore, maskedKey } from "../native/keychain";
import { ANTHROPIC_PAGE } from "./anthropic-copy";
import { BackToSettings, ConfirmRemove } from "./SettingsScreen";
import { SETTINGS } from "./settings-copy";
import "./settings.css";

// ---------------------------------------------------------------------------
// The Anthropic key's actions, apart from the markup so they are tested without a DOM
// ---------------------------------------------------------------------------

/**
 * A result line: its sentence, its tone, and Anthropic's request ID when the response carried one. `lang` is the
 * sentence's own language when it is not the screen's (the Ask service's check results are English); `tail` is an
 * English message a translated sentence ends with (the Keychain's words), marked on a Chinese screen.
 */
export interface KeyStatus {
  text: string;
  ok: boolean;
  requestIdLine: string | null;
  lang?: "en";
  tail?: string;
}

type AnthropicKeyServices = Pick<AppServices, "anthropicKeys" | "ask"> & Partial<Pick<AppServices, "settings">>;

/** What a key check says, in its tone. */
export function checkStatus(result: KeyCheckResult): KeyStatus {
  return { text: result.message, ok: result.ok, requestIdLine: result.requestId ? askRequestIdLine(result.requestId) : null, lang: "en" };
}

/** "On file: ••••abcd", "No Anthropic key on file.", or nothing while the Keychain has not been read (`undefined`). */
export function anthropicKeyLine(masked: string | null | undefined, locale: Locale = "en"): string | null {
  if (masked === undefined) return null;
  const a = ANTHROPIC_PAGE[locale];
  return masked === null ? a.noKey : a.onFile(masked);
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
export async function saveAnthropicKey(
  services: AnthropicKeyServices,
  draft: string,
  onSaved: () => void | Promise<void>,
  locale: Locale = "en",
): Promise<KeyStatus> {
  try {
    await services.anthropicKeys.set(draft);
  } catch (err) {
    const tail = scrubSecrets(errorText(err), [draft, draft.trim()]);
    return { text: ANTHROPIC_PAGE[locale].saveFailed(tail), ok: false, requestIdLine: null, tail };
  }
  await onSaved();
  return checkStatus(await services.ask.checkKey());
}

/** Remove the key, then read the Keychain again: a removal is reported only when the key is really gone. */
export async function removeAnthropicKey(services: Pick<AppServices, "anthropicKeys">, locale: Locale = "en"): Promise<KeyStatus> {
  const a = ANTHROPIC_PAGE[locale];
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
    return after ? { text: a.notRemoved, ok: false, requestIdLine: null } : { text: a.removed, ok: true, requestIdLine: null };
  } catch (err) {
    const tail = scrubSecrets(errorText(err), [before]);
    return { text: a.readFailed(tail), ok: false, requestIdLine: null, tail };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message || err.name : String(err);
}


// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** The Anthropic key (S08 "AI（可选）"): its own page, the existing section. */
export function AnthropicKeyScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);
  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <BackToSettings label={SETTINGS[locale].back} from="anthropic" />
      <AnthropicKeySection services={services} locale={locale} title={title} />
    </div>
  );
}

/**
 * "Anthropic API key (for Ask)" (design §7). The key is read here for its last four characters only, and a check
 * runs only when the person saves or taps Check key. The check's own result sentence is the Ask service's, in English
 * (marked so) until the Ask rework (T15–T17).
 */
export function AnthropicKeySection({
  services,
  locale = "en",
  title,
}: {
  services: AnthropicKeyServices;
  locale?: Locale;
  /** On its own page the section's title is the page's h1, and takes focus there. */
  title?: RefObject<HTMLHeadingElement | null>;
}) {
  const a = ANTHROPIC_PAGE[locale];
  const r = SETTINGS[locale];
  /** undefined until the Keychain has been read, so the screen never says "no key" before it knows. */
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Sentences from the Ask service, and the Keychain's words inside a translated one, are English: marked so on a
  // Chinese screen. This page's own sentences are in the screen's language.
  const english = locale === "en" ? undefined : "en";

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
      const status = await saveAnthropicKey(
        services,
        draft,
        async () => {
          setDraft("");
          setSaved(true);
          setChecking(true);
          setMasked(await readMasked(services.anthropicKeys));
        },
        locale,
      );
      setResult(status);
    });

  const check = () =>
    act(async () => {
      setChecking(true);
      setResult(checkStatus(await services.ask.checkKey()));
    });

  const remove = () =>
    act(async () => {
      setConfirming(false);
      setResult(await removeAnthropicKey(services, locale));
      setMasked(await readMasked(services.anthropicKeys));
    });

  const onFile = anthropicKeyLine(masked, locale);

  return (
    <section className="settings-section">
      {title ? (
        <h1 ref={title} tabIndex={-1} className="settings-heading ag-settings-title">
          {a.title}
        </h1>
      ) : (
        <h2 className="settings-heading">{a.title}</h2>
      )}
      <p className="settings-copy">{a.use}</p>
      <p className="settings-copy">{a.dataSent}</p>
      <p className="settings-copy">
        <a href={PRICING_URL} target="_blank" rel="noreferrer noopener">
          {a.pricing}
        </a>
      </p>
      {onFile !== null ? <p className="tabular settings-on-file">{onFile}</p> : null}

      <div className="settings-row">
        <input
          type="password"
          className="ag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={a.placeholder}
          aria-label={a.label}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="ag-button ag-button-primary" aria-label={a.saveName} disabled={busy || draft.trim().length === 0} onClick={() => void save()}>
          {a.save}
        </button>
      </div>

      {masked ? (
        <>
          <div className="settings-row">
            <button type="button" className="ag-button" disabled={busy} onClick={() => void check()}>
              {a.check}
            </button>
            <button type="button" className="ag-button ag-button-danger" aria-label={a.removeName} disabled={busy} onClick={() => setConfirming(true)}>
              {a.remove}
            </button>
          </div>
          <p className="settings-note">{a.removalNote}</p>
        </>
      ) : null}

      {/* Always mounted, so what lands in it is announced; a failure is an alert of its own below. */}
      <div role="status" className="settings-results">
        {saved ? <p className="settings-ok">{a.saved}</p> : null}
        {checking ? <p>{a.checking}</p> : null}
        {result?.ok ? (
          <p className="settings-ok" lang={result.lang ? english : undefined}>
            {result.text}
          </p>
        ) : null}
      </div>
      {result !== null && !result.ok ? (
        <div role="alert" className="settings-results settings-fail">
          <p lang={result.lang ? english : undefined}>
            <WithTail text={result.text} tail={result.tail} tailLang={english} />
          </p>
          {result.requestIdLine !== null ? <p className="tabular">{result.requestIdLine}</p> : null}
        </div>
      ) : null}
      {services.settings ? <AskPermission settings={services.settings} locale={locale} /> : null}
      <ConfirmRemove open={confirming} title={a.confirmTitle} body={a.confirmBody} confirm={r.seats.confirmRemove} keep={r.seats.confirmKeep} close={r.close} onConfirm={() => void remove()} onClose={() => setConfirming(false)} />
    </section>
  );
}

/**
 * Whether Ask may send data to Anthropic (release D10), and the way to withdraw it. It is given only on the Ask
 * screen's consent sheet, where what is sent is listed; withdrawing stops every later question and Try again until it
 * is given again, and says it cannot recall what was already sent.
 */
export function AskPermission({ settings, locale }: { settings: AppServices["settings"]; locale: Locale }) {
  const k = CONSENT[locale].settings;
  const consent = useSyncExternalStore(settings.subscribe, settings.aiConsent, settings.aiConsent);
  const [status, setStatus] = useState<string | null>(null);
  const withdraw = async () => {
    const saved = await settings.withdrawAi();
    setStatus(saved ? k.withdrawn : k.withdrawNotSaved);
  };
  return (
    <div className="settings-consent" data-testid="ask-permission">
      <p className="settings-copy">{consent ? k.allowed : k.notAllowed}</p>
      {consent ? (
        <button type="button" className="ag-button" onClick={() => void withdraw()}>
          {k.withdraw}
        </button>
      ) : null}
      <p role="status" className="settings-note">
        {status ?? ""}
      </p>
    </div>
  );
}
