/**
 * Connect seats.aero in the key flavour (app/flags.ts CONNECT "key", the default build: development, the probes, the
 * UI/UX e2e and internal test builds): Settings › seats.aero account, with the API key pasted (S08
 * "连接数据源进入专页").
 *
 * What the key is for, a password field, Paste only when asked (the clipboard is never read otherwise), and "Check and
 * save", with the approved sentence saying the check sends a request before it does (core seatsaero/key-check.ts: one
 * call). Nothing checks a key to draw a screen. A saved key shows its last four characters only; removing it asks
 * first and says what it affects, then returns to Search, where the first run's welcome is.
 *
 * Not in the App Store build: that build is the OAuth flavour (`npm run build:store` sets VITE_AG_CONNECT=oauth),
 * which connects through seats.aero's own sign-in (./SeatsConnectScreen.tsx) and has no paste field. App.tsx routes
 * this page only where OAUTH_BUILT is false, so this module and its words (./seats-key-copy.ts) are dropped from that
 * bundle, and scripts/check-store-bundle.mjs fails the build if they are not.
 *
 * In sample mode (app/data-source.ts) the page is sample mode's own (SampleSeatsPage): the way back to the account.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router";
import { scrubSecrets } from "@awardgrid/core/ask/errors";
import { copy } from "@awardgrid/core/workspace/present";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { isSample } from "../app/data-source";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { Button } from "../components/ui";
import { last4 } from "../native/keychain";
import { BackToSettings, ConfirmRemove, SampleSeatsPage, useLast4 } from "./SettingsScreen";
import { KEY_ON_FILE, SEATS_KEY } from "./seats-key-copy";
import { SETTINGS } from "./settings-copy";

/** Connect seats.aero (S08 "连接数据源进入专页"); in sample mode, the way back to the account first. */
export function SeatsKeyScreen() {
  const services = useOutletContext<AppServices>();
  return isSample(services) ? <SampleSeatsPage services={services} /> : <SeatsKeyPage services={services} />;
}

function SeatsKeyPage({ services }: { services: AppServices }) {
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  const s = SEATS_KEY[locale];
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
  const navigate = useNavigate();
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
    // Without a key the app is where it starts (release plan step 17): back to Search, which shows the welcome — sample
    // data first, or connect again — and says the key was removed. Focus goes to its title.
    navigate("/", { state: { focus: "search-title", said: s.removed } });
  };

  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <BackToSettings label={t.back} from="seats" />
      <h1 ref={title} tabIndex={-1} className="ag-settings-title">
        {t.seats.title}
      </h1>
      <p className="ag-settings-copy">{s.purpose}</p>
      <p className="ag-settings-copy ag-settings-muted">{s.where}</p>
      {onFile ? <p className="ag-settings-on-file tabular">{KEY_ON_FILE[locale](onFile)}</p> : null}
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
            {t.seats.startSearching}
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
