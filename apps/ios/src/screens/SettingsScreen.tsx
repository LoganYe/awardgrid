/**
 * Settings (UI/UX v1 T11; docs/04 S08; spec §16): data connection, then AI (optional), appearance and language, local
 * data, about — each a group of rows, in the language chosen here.
 *
 *   - **seats.aero first.** Its own page (`SeatsKeyScreen`): what the key is for, a password field, Paste only when
 *     asked (the clipboard is never read otherwise), and "Check and save", with the approved sentence saying the check
 *     sends a request before it does (core seatsaero/key-check.ts: one call). Nothing checks a key to draw a screen. A
 *     saved key shows its last four characters only; removing it asks first and says what it affects.
 *   - **Anthropic is optional** and on its own page (./AnthropicKeyScreen.tsx); nothing in search needs it. The page
 *     also says whether Ask may send data to Anthropic (release D10) and withdraws that permission. The App Store
 *     build (app/flags.ts STORE) has no Ask: the AI group, its row and the page are compiled out, the Anthropic
 *     Keychain item is never read here, and the sentences below that would name Ask use their neutral versions.
 *   - **No connection at all** (`VITE_AG_CONNECT=0`, app/flags.ts): the Data connection group and the seats.aero
 *     page are compiled out too.
 *   - **Appearance and language** apply at once, keep whatever task is on screen, and are saved on this device
 *     (app/settings-store.ts).
 *   - **Local data**: clearing cached results touches nothing else.
 *   - **About**: what goes where, "Data: seats.aero", the non-affiliation sentence, and the privacy policy and support
 *     pages (opened in Safari) and the open-source licenses (release D7, handoff §3.5).
 *
 * The keys' discipline is unchanged (LEGAL.md "Credentials"): a key is never rendered, logged, or shown beyond its last
 * four characters, and a Keychain failure is a failure, never painted like a success.
 */
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useOutletContext } from "react-router";
import { scrubSecrets } from "@awardgrid/core/ask/errors";
import { copy } from "@awardgrid/core/workspace/present";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { CAN_CONNECT, OAUTH, STORE } from "../app/flags";
import { useFocusOnArrival } from "../app/focus";
import { type Locale, langTag, useLocale } from "../app/locale";
import { PRIVACY_POLICY_URL, SUPPORT_URL } from "../app/links";
import { ASK_SURFACES } from "../ask/ask-surface-copy";
import { Button, Icon, Sheet, type ThemePreference } from "../components/ui";
import { type KeyStore, last4 } from "../native/keychain";
import { SETTINGS } from "./settings-copy";
import "./settings.css";

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
export function ConfirmRemove({
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

/** The key's last four characters. A null store is one this build never reads (STORE's Anthropic item): no value. */
function useLast4(store: KeyStore | null): [string | null | undefined, (value: string | null) => void] {
  /** undefined until the Keychain has been read, so nothing says "no key" before it knows. */
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!store) return;
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
export function BackToSettings({ label, from }: { label: string; from: "seats" | "anthropic" | "acknowledgements" }) {
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

/** Whether the OAuth flavour's account is connected, read from the Keychain alone; undefined until it answers. */
function useConnected(account: AppServices["seatsAccount"]): boolean | undefined {
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!account) return;
    let live = true;
    void account
      .connected()
      .then((on) => live && setConnected(on))
      .catch(() => live && setConnected(false));
    return () => {
      live = false;
    };
  }, [account]);
  return connected;
}

export function SettingsScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  // The key flavour shows a key's last four characters; the OAuth flavour has none, and says "Connected".
  const [seats] = useLast4(CAN_CONNECT && !OAUTH ? services.keys : null);
  const connected = useConnected(OAUTH ? services.seatsAccount : null);
  const seatsValue = OAUTH ? (connected === undefined ? "" : connected ? t.connected : t.notConnected) : keyValue(seats);
  // The App Store build has no Ask, so it never reads the Anthropic Keychain item.
  const [anthropic] = useLast4(STORE ? null : services.anthropicKeys);
  const theme = useSyncExternalStore(services.settings.subscribe, services.settings.theme, services.settings.theme);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  // Back from a key page: focus returns to the row that opened it.
  const returnTo = (useLocation().state as { focus?: string } | null)?.focus ?? null;
  useEffect(() => {
    if (returnTo) document.getElementById(returnTo)?.focus();
  }, [returnTo]);
  function keyValue(value: string | null | undefined): string {
    return value === undefined ? "" : value === null ? t.notConnected : t.onFile(value);
  }
  const row = (id: string, to: string, label: string, value: string, note?: string) => (
    <Link id={id} to={to} className="ag-settings-row">
      {/* Label and value share a line while they fit; with larger text the value goes under the label. */}
      <span className="ag-settings-row-main">
        <span className="ag-settings-row-text">
          <span className="ag-settings-row-label">{label}</span>
          {note ? <span className="ag-settings-row-note">{note}</span> : null}
        </span>
        <span className="ag-settings-value tabular">{value}</span>
      </span>
      <Icon name="chevron-right" />
    </Link>
  );

  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <h1 className="ag-settings-title">{t.title}</h1>
      {CAN_CONNECT ? <Group title={t.groups.data}>{row("settings-row-seats", "/settings/seats", t.seatsRow, seatsValue)}</Group> : null}
      {STORE ? null : (
        <Group title={ASK_SURFACES[locale].settings.group}>
          {row("settings-row-anthropic", "/settings/anthropic", ASK_SURFACES[locale].settings.row, keyValue(anthropic), ASK_SURFACES[locale].settings.rowNote)}
        </Group>
      )}
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
          <p className="ag-settings-copy ag-settings-muted">{t.notAffiliated}</p>
        </div>
        {/* The site's pages open in Safari; nothing is sent to that site from the app. */}
        <a id="settings-row-privacy" className="ag-settings-row" href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener">
          <span className="ag-settings-row-main">
            <span className="ag-settings-row-label">{t.privacy}</span>
          </span>
          <span className="sr-only">{t.opensInSafari}</span>
          <Icon name="external" />
        </a>
        <a id="settings-row-support" className="ag-settings-row" href={SUPPORT_URL} target="_blank" rel="noreferrer noopener">
          <span className="ag-settings-row-main">
            <span className="ag-settings-row-label">{t.support}</span>
          </span>
          <span className="sr-only">{t.opensInSafari}</span>
          <Icon name="external" />
        </a>
        <Link id="settings-row-acknowledgements" to="/settings/acknowledgements" className="ag-settings-row">
          <span className="ag-settings-row-main">
            <span className="ag-settings-row-label">{t.acknowledgements.title}</span>
          </span>
          <Icon name="chevron-right" />
        </Link>
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
