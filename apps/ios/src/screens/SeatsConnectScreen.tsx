/**
 * Connect seats.aero in the OAuth flavour (app/flags.ts OAUTH; release plan step 18b): the page Settings › seats.aero
 * account opens instead of the key page (SeatsKeyScreen).
 *
 * The App Store build's connect page (`npm run build:store` builds this flavour). There is no paste field. "Connect
 * seats.aero" opens seats.aero's own sign-in and consent page in the system's sign-in sheet
 * (AppServices.seatsAccount.connect, ../oauth/connect.ts), and one sentence says so before it opens: seats.aero asks
 * the person to sign in and approve AwardGrid, AwardGrid never sees the password, and Disconnect is always there. No
 * token is ever shown — the page says "Connected", nothing more. The rest of what the connection means is said before
 * it is made too: searches go from the device to seats.aero, their results stay on the device for 24 hours at most, and
 * the token service at awardgrid.dowhiz.com renews the connection and keeps nothing.
 *
 * "Disconnect" asks first and says what it removes: the tokens and every seats.aero result on the device (the OAuth
 * Addendum's purge). Saved searches and watches stay, without their results. Each outcome is said, in the page's
 * language; a sign-in that was cancelled or declined saves nothing and says so.
 *
 * In sample mode (app/data-source.ts) the page is sample mode's own, as in the key flavour: the way back to the
 * account first. Sample mode has no account (no token is read there), so neither Connect nor Disconnect is offered.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { isSample } from "../app/data-source";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { Button } from "../components/ui";
import { BackToSettings, ConfirmRemove, SampleSeatsPage } from "./SettingsScreen";
import { OAUTH_CONNECT } from "./oauth-copy";
import { SETTINGS } from "./settings-copy";
import "./settings.css";

/** The Connect button's id: where focus goes after a disconnect. */
const CONNECT_BUTTON = "seats-connect-button";

export function SeatsConnectScreen() {
  const services = useOutletContext<AppServices>();
  return isSample(services) ? <SampleSeatsPage services={services} /> : <SeatsConnectPage services={services} />;
}

function SeatsConnectPage({ services }: { services: AppServices }) {
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  const o = OAUTH_CONNECT[locale];
  const account = services.seatsAccount;
  /** undefined until the Keychain has answered, so nothing says "not connected" before it knows. */
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean; tail?: string } | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const start = useRef<HTMLAnchorElement>(null);
  useFocusOnArrival(title);
  const tailLang = locale === "en" ? undefined : "en";

  useEffect(() => {
    if (!account) return;
    let live = true;
    // The Keychain alone: nothing is sent to draw this page.
    void account
      .connected()
      .then((on) => live && setConnected(on))
      .catch(() => live && setConnected(false));
    return () => {
      live = false;
    };
  }, [account]);

  useEffect(() => {
    // Connected: focus goes to what comes next.
    if (justConnected) start.current?.focus();
  }, [justConnected]);

  const connect = async () => {
    if (!account || busy) return;
    setBusy("connect");
    setStatus(null);
    try {
      const outcome = await account.connect();
      if (outcome.ok) {
        setConnected(true);
        setJustConnected(true);
        setStatus({ text: o.connectedNow, ok: true });
        return;
      }
      setStatus({ text: outcome.reason === "not_configured" ? o.notConfigured : o.failure[outcome.reason], ok: false });
    } catch {
      setStatus({ text: o.failure.failed, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!account || busy) return;
    setConfirming(false);
    setBusy("disconnect");
    setStatus(null);
    try {
      const outcome = await account.disconnect();
      if (!outcome.ok && outcome.reason === "keychain") {
        setStatus({ text: o.disconnectKeychain, ok: false });
        return;
      }
      setConnected(false);
      setJustConnected(false);
      setStatus(outcome.ok ? { text: o.disconnected, ok: true } : { text: o.disconnectSaved(outcome.message ?? ""), ok: false, tail: outcome.message });
      // "Disconnect" is gone with the connection: focus goes to Connect, ready for another.
      window.requestAnimationFrame(() => document.getElementById(CONNECT_BUTTON)?.focus());
    } catch {
      setStatus({ text: o.disconnectKeychain, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const configured = account?.configured ?? false;

  return (
    <div className="ag-settings" lang={langTag(locale)} data-testid="seats-connect">
      <BackToSettings label={t.back} from="seats" />
      <h1 ref={title} tabIndex={-1} className="ag-settings-title">
        {t.seats.title}
      </h1>
      <p className="ag-settings-copy">{o.purpose}</p>
      <p className="ag-settings-copy" data-testid="seats-connect-how">
        {o.how}
      </p>
      <p className="ag-settings-copy ag-settings-muted">{o.where}</p>
      <p className="ag-settings-copy ag-settings-muted">{o.keeps}</p>
      {connected ? <p className="ag-settings-on-file">{o.onFile}</p> : null}
      <div className="ag-settings-card ag-settings-block">
        {/* Until the Keychain answers, the button is there but off, so the page does not jump or claim either state. */}
        {connected !== true ? (
          <Button
            id={CONNECT_BUTTON}
            variant="primary"
            block
            disabled={!configured || connected === undefined}
            disabledReason={configured ? null : o.notConfigured}
            loading={busy === "connect"}
            loadingLabel={o.connecting}
            onClick={() => void connect()}
          >
            {o.connect}
          </Button>
        ) : null}
        <p role="status" className="ag-settings-status">
          {status?.ok ? status.text : ""}
        </p>
        {status && !status.ok ? (
          <p role="alert" className="ag-settings-status ag-settings-fail">
            <WithTail text={status.text} tail={status.tail} tailLang={tailLang} />
          </p>
        ) : null}
        {justConnected ? (
          <Link ref={start} to="/" className="ag-button ag-button-primary ag-button-block">
            {t.seats.startSearching}
          </Link>
        ) : null}
        {connected ? (
          <>
            <p className="ag-settings-copy ag-settings-muted">{o.revokeNote}</p>
            <Button variant="danger" loading={busy === "disconnect"} loadingLabel={o.disconnecting} onClick={() => setConfirming(true)}>
              {o.disconnect}
            </Button>
          </>
        ) : null}
      </div>
      <ConfirmRemove
        open={confirming}
        title={o.confirmTitle}
        body={o.confirmBody}
        confirm={o.confirmDisconnect}
        keep={o.confirmKeep}
        close={t.close}
        onConfirm={() => void disconnect()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
