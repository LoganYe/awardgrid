/**
 * Settings (UI/UX v1 T11; docs/04 S08; spec §16): data connection, then AI (optional), appearance and language, local
 * data, about — each a group of rows, in the language chosen here.
 *
 *   - **seats.aero first.** Its own page (`SeatsKeyScreen`): what the key is for, a password field, Paste only when
 *     asked (the clipboard is never read otherwise), and "Check and save", with the approved sentence saying the check
 *     sends a request before it does (core seatsaero/key-check.ts: one call). Nothing checks a key to draw a screen. A
 *     saved key shows its last four characters only; removing it asks first and says what it affects.
 *   - **Anthropic is optional** and on its own page; nothing in search needs it.
 *   - **Appearance and language** apply at once, keep whatever task is on screen, and are saved on this device
 *     (app/settings-store.ts).
 *   - **Local data**: clearing cached results touches nothing else.
 *
 * The keys' discipline is unchanged (LEGAL.md "Credentials"): a key is never rendered, logged, or shown beyond its last
 * four characters, and a Keychain failure is a failure, never painted like a success.
 */
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useOutletContext } from "react-router";
import { askRequestIdLine, scrubSecrets } from "@awardgrid/core/ask/errors";
import { copy } from "@awardgrid/core/workspace/present";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { useFocusOnArrival } from "../app/focus";
import { type Locale, langTag, useLocale } from "../app/locale";
import type { KeyCheckResult } from "../ask/ask-service";
import { PRICING_URL } from "../ask/labels";
import { Button, Icon, Sheet, type ThemePreference } from "../components/ui";
import { type KeyStore, last4, maskedKey } from "../native/keychain";
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

type AnthropicKeyServices = Pick<AppServices, "anthropicKeys" | "ask">;

/** What a key check says, in its tone. */
export function checkStatus(result: KeyCheckResult): KeyStatus {
  return { text: result.message, ok: result.ok, requestIdLine: result.requestId ? askRequestIdLine(result.requestId) : null, lang: "en" };
}

/** "On file: ••••abcd", "No Anthropic key on file.", or nothing while the Keychain has not been read (`undefined`). */
export function anthropicKeyLine(masked: string | null | undefined, locale: Locale = "en"): string | null {
  if (masked === undefined) return null;
  const a = SETTINGS[locale].anthropic;
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
    return { text: SETTINGS[locale].anthropic.saveFailed(tail), ok: false, requestIdLine: null, tail };
  }
  await onSaved();
  return checkStatus(await services.ask.checkKey());
}

/** Remove the key, then read the Keychain again: a removal is reported only when the key is really gone. */
export async function removeAnthropicKey(services: Pick<AppServices, "anthropicKeys">, locale: Locale = "en"): Promise<KeyStatus> {
  const a = SETTINGS[locale].anthropic;
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
// Pieces
// ---------------------------------------------------------------------------

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ag-settings-group" aria-labelledby={id}>
      <h2 className="ag-settings-label" id={id}>
        {title}
      </h2>
      <div className="ag-settings-card">{children}</div>
    </section>
  );
}

/** Rows of radio buttons, 44 pt each (S08): a native radio group, so arrows move and VoiceOver says "1 of 3". */
function RadioRows<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; lang?: string }>; onChange: (value: T) => void }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="ag-radio-rows">
      <p className="ag-radio-rows-label" aria-hidden="true">
        {label}
      </p>
      {options.map((o) => (
        <label key={o.value} className="ag-radio-row" lang={o.lang}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** A confirmation before removing a key: what it affects, and the two choices. */
function ConfirmRemove({
  open,
  title,
  body,
  confirm,
  keep,
  close,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string[];
  confirm: string;
  keep: string;
  close: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose} closeLabel={close}>
      {body.map((line) => (
        <p key={line} className="ag-settings-copy">
          {line}
        </p>
      ))}
      <div className="ag-settings-actions">
        <Button variant="danger" onClick={onConfirm}>
          {confirm}
        </Button>
        <Button onClick={onClose}>{keep}</Button>
      </div>
    </Sheet>
  );
}

function useLast4(store: KeyStore): [string | null | undefined, (value: string | null) => void] {
  /** undefined until the Keychain has been read, so nothing says "no key" before it knows. */
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void store
      .get()
      .then((key) => (cancelled ? undefined : setValue(key ? last4(key) : null)))
      .catch(() => (cancelled ? undefined : setValue(null)));
    return () => {
      cancelled = true;
    };
  }, [store]);
  return [value, setValue];
}

/** Back to Settings, where focus returns to the row this page was opened from. */
function BackToSettings({ label, from }: { label: string; from: "seats" | "anthropic" }) {
  return (
    <Link to="/settings" state={{ focus: `settings-row-${from}` }} className="ag-settings-back">
      <Icon name="chevron-left" />
      <span>{label}</span>
    </Link>
  );
}


// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  const [seats] = useLast4(services.keys);
  const [anthropic] = useLast4(services.anthropicKeys);
  const theme = useSyncExternalStore(services.settings.subscribe, services.settings.theme, services.settings.theme);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  // Back from a key page: focus returns to the row that opened it.
  const returnTo = (useLocation().state as { focus?: string } | null)?.focus ?? null;
  useEffect(() => {
    if (returnTo) document.getElementById(returnTo)?.focus();
  }, [returnTo]);
  const row = (id: string, to: string, label: string, value: string | null | undefined, note?: string) => (
    <Link id={id} to={to} className="ag-settings-row">
      {/* Label and value share a line while they fit; with larger text the value goes under the label. */}
      <span className="ag-settings-row-main">
        <span className="ag-settings-row-text">
          <span className="ag-settings-row-label">{label}</span>
          {note ? <span className="ag-settings-row-note">{note}</span> : null}
        </span>
        <span className="ag-settings-value tabular">{value === undefined ? "" : value === null ? t.notConnected : t.onFile(value)}</span>
      </span>
      <Icon name="chevron-right" />
    </Link>
  );

  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <h1 className="ag-settings-title">{t.title}</h1>
      <Group title={t.groups.data}>{row("settings-row-seats", "/settings/seats", t.seatsRow, seats)}</Group>
      <Group title={t.groups.ai}>{row("settings-row-anthropic", "/settings/anthropic", t.anthropicRow, anthropic, t.anthropicRowNote)}</Group>
      <Group title={t.groups.appearance}>
        <RadioRows<ThemePreference>
          label={t.theme}
          value={theme}
          onChange={(value) => void services.settings.setTheme(value)}
          options={[
            { value: "system", label: t.themes.system },
            { value: "light", label: t.themes.light },
            { value: "dark", label: t.themes.dark },
          ]}
        />
        <RadioRows<Locale>
          label={t.language}
          value={locale}
          onChange={(value) => void services.settings.setLocale(value)}
          options={[
            { value: "en", label: "English", lang: "en" },
            { value: "zh", label: "中文", lang: "zh-CN" },
          ]}
        />
      </Group>
      <Group title={t.groups.local}>
        <div className="ag-settings-block">
          <p className="ag-settings-copy">{t.cacheNote}</p>
          <p className="ag-settings-copy ag-settings-muted">{t.cacheKeeps}</p>
          <Button
            onClick={async () => {
              // Memory and disk, and nothing else: quota spent today, the user's watches, both keys and ask.json survive.
              await services.clearCache();
              setCacheStatus(t.cacheCleared);
            }}
          >
            {t.clearCache}
          </Button>
          <p role="status" className="ag-settings-status">
            {cacheStatus ?? ""}
          </p>
        </div>
      </Group>
      <Group title={t.groups.about}>
        <div className="ag-settings-block">
          <p className="ag-settings-copy">{t.aboutSent}</p>
          <p className="ag-settings-copy ag-settings-muted">{t.aboutData}</p>
        </div>
      </Group>
    </div>
  );
}

/** Connect seats.aero (S08 "连接数据源进入专页"). */
export function SeatsKeyScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  const s = t.seats;
  const [onFile, setOnFile] = useLast4(services.keys);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean; tail?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fieldId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const start = useRef<HTMLAnchorElement>(null);
  useFocusOnArrival(title);
  // The Keychain's own words are English: marked so on a Chinese screen.
  const tailLang = locale === "en" ? undefined : "en";
  // One filled button at a time: "Start searching" only while no new key is being typed.
  const showStart = saved && draft.trim() === "";
  useEffect(() => {
    // After a save the field empties and "Check and save" turns off: focus goes to what comes next.
    if (saved) start.current?.focus();
  }, [saved]);

  // Only on the user's tap: the clipboard is never read to fill the field on its own.
  const paste = async () => {
    try {
      setDraft((await navigator.clipboard.readText()).trim());
    } catch {
      setStatus({ text: s.pasteFailed, ok: false });
    }
  };

  const failure = (reason: "invalid" | "malformed" | "network" | "unknown" | "quota") =>
    ({ invalid: s.invalid, malformed: s.malformed, network: s.network, unknown: s.unknown, quota: s.quota })[reason];

  const checkAndSave = async () => {
    setBusy(true);
    setStatus(null);
    setSaved(false);
    const candidate = draft.trim();
    try {
      const outcome = await services.checkSeatsKey(candidate);
      if (!outcome.ok) {
        setStatus({ text: failure(outcome.reason), ok: false });
        return;
      }
      try {
        await services.keys.set(candidate);
      } catch (err) {
        const tail = scrubSecrets(err instanceof Error ? err.message || err.name : String(err), [candidate, draft]);
        setStatus({ text: s.saveFailed(tail), ok: false, tail });
        return;
      }
      setDraft("");
      setOnFile(last4(candidate));
      setSaved(true);
      setStatus({ text: s.saved, ok: true });
    } catch {
      // Never silent: anything unexpected is said, and the key is not saved.
      setStatus({ text: s.unknown, ok: false });
    } finally {
      // A check that sent a request spent a call: the counter is saved with everything else.
      await services.persist();
      setBusy(false);
    }
  };

  /** Remove, then read the Keychain again: a removal is reported only when the key is really gone. */
  const remove = async () => {
    setConfirming(false);
    setStatus(null);
    try {
      await services.keys.clear();
    } catch {
      // The read below says whether the key went.
    }
    let after: string | null = null;
    try {
      after = await services.keys.get();
    } catch {
      setStatus({ text: s.removeUnconfirmed, ok: false });
      return;
    }
    if (after) {
      setOnFile(last4(after));
      setStatus({ text: s.notRemoved, ok: false });
      return;
    }
    setOnFile(null);
    setSaved(false);
    setStatus({ text: s.removed, ok: true });
    // "Remove key" is gone with the key: focus goes to the field, ready for another.
    window.requestAnimationFrame(() => field.current?.focus());
  };

  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <BackToSettings label={t.back} from="seats" />
      <h1 ref={title} tabIndex={-1} className="ag-settings-title">
        {s.title}
      </h1>
      <p className="ag-settings-copy">{s.purpose}</p>
      <p className="ag-settings-copy ag-settings-muted">{s.where}</p>
      {onFile ? <p className="ag-settings-on-file tabular">{t.onFile(onFile)}</p> : null}
      <div className="ag-settings-card ag-settings-block">
        <label className="ag-settings-field-label" htmlFor={fieldId}>
          {s.label}
        </label>
        <div className="ag-key-row">
          <input
            ref={field}
            id={fieldId}
            type="password"
            className="ag-input ag-key-control"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={s.placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <Button className="ag-key-paste" onClick={() => void paste()}>
            {s.paste}
          </Button>
        </div>
        <p className="ag-settings-copy ag-settings-muted">{copy("key.check_cost", locale)}</p>
        <Button variant="primary" block disabled={draft.trim().length === 0} loading={busy} loadingLabel={s.checking} onClick={() => void checkAndSave()}>
          {s.checkAndSave}
        </Button>
        <p role="status" className="ag-settings-status">
          {status?.ok ? status.text : ""}
        </p>
        {status && !status.ok ? (
          <p role="alert" className="ag-settings-status ag-settings-fail">
            <WithTail text={status.text} tail={status.tail} tailLang={tailLang} />
          </p>
        ) : null}
        {showStart ? (
          <Link ref={start} to="/" className="ag-button ag-button-primary ag-button-block">
            {s.startSearching}
          </Link>
        ) : null}
        {onFile ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {s.remove}
          </Button>
        ) : null}
      </div>
      <ConfirmRemove open={confirming} title={s.confirmTitle} body={s.confirmBody} confirm={s.confirmRemove} keep={s.confirmKeep} close={t.close} onConfirm={() => void remove()} onClose={() => setConfirming(false)} />
    </div>
  );
}

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
  const a = SETTINGS[locale].anthropic;
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
      <ConfirmRemove open={confirming} title={a.confirmTitle} body={a.confirmBody} confirm={r.seats.confirmRemove} keep={r.seats.confirmKeep} close={r.close} onConfirm={() => void remove()} onClose={() => setConfirming(false)} />
    </section>
  );
}
