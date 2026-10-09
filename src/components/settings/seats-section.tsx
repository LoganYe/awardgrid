"use client";

/**
 * seats.aero (Settings, first section): connect the account through seats.aero's own sign-in, Login with Seats.aero,
 * or disconnect it; today's seats.aero calls sit under it.
 *
 *   - Connect asks the server for a fresh consent URL (POST /api/seats/connect) and opens it in this tab. seats.aero
 *     asks the person to sign in and approve AwardGrid; they come back to /settings?seats=<outcome>, which this
 *     section says in one line (src/lib/seats-oauth/connect.ts CONNECT_OUTCOMES) and then takes out of the address.
 *   - Disconnect confirms inline (as removing a key did), deletes the tokens and every seats.aero result the server
 *     keeps for the account (DELETE /api/seats/connection), then what this browser kept (workspace results, saved
 *     options' rows, the Ask conversation).
 *   - An account whose pasted key the move to Login with Seats.aero removed is told so once, until it connects or
 *     dismisses the notice (DELETE /api/seats/notice).
 *
 * No token ever reaches this page: the server hands it a boolean and a date.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/queries/inline-confirm";
import { Button } from "@/components/ui/button";
import { forgetSeatsResultsOnDevice } from "@/components/workspace/retention";
import type { I18nKey } from "@awardgrid/core/i18n";
import { errorText } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { ConnectOutcome } from "@/lib/seats-oauth/connect";
import { apiJson, formatDayMonth } from "./api";
import { QuotaBar, type QuotaView } from "./quota-bar";
import { SettingsNotice, SettingsSection } from "./section";

export interface SeatsSectionProps {
  userId: string;
  connected: boolean;
  /** ISO time the account connected, when it is connected. */
  connectedAt: string | null;
  /** Whether this server has a seats.aero client ID (SEATS_OAUTH_CLIENT_ID). */
  configured: boolean;
  /** Say, once, that the pasted key was removed and seats.aero now connects through its own sign-in. */
  reconnectNotice: boolean;
  /** How a sign-in that just came back ended (?seats=), or null. */
  outcome: ConnectOutcome | null;
  quota: QuotaView;
}

const OUTCOME_TEXT: Record<ConnectOutcome, I18nKey> = {
  connected: "settings.seats.outcome.connected",
  denied: "settings.seats.outcome.denied",
  mismatch: "settings.seats.outcome.mismatch",
  expired: "settings.seats.outcome.expired",
  rejected: "settings.seats.outcome.rejected",
  unavailable: "settings.seats.outcome.unavailable",
  not_configured: "settings.seats.not_configured",
  failed: "settings.seats.outcome.failed",
};

type Notice = { kind: "ok" | "error"; text: string } | null;

export function SeatsSection({ userId, connected, connectedAt, configured, reconnectNotice, outcome, quota }: SeatsSectionProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<Notice>(() =>
    outcome ? { kind: outcome === "connected" ? "ok" : "error", text: t(OUTCOME_TEXT[outcome]) } : null,
  );
  const [showReconnect, setShowReconnect] = useState(reconnectNotice);

  // Back from seats.aero's page with the browser's Back button: the page comes out of the back/forward cache as it was
  // left, mid-Connect, so the button is given back.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // The outcome is said once: the address loses ?seats= so a reload does not say it again.
  useEffect(() => {
    if (!outcome) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("seats");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [outcome]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await apiJson<{ url: string }>("/api/seats/connect", { method: "POST", body: {} });
    if (res.ok && typeof res.data?.url === "string") {
      // seats.aero's own page, in this tab; the busy state stays until the browser leaves.
      window.location.assign(res.data.url);
      return;
    }
    setBusy(false);
    setNotice({ kind: "error", text: res.ok ? t("settings.seats.outcome.failed") : res.error === "not_configured" ? t("settings.seats.not_configured") : errorText(locale, res.error) });
  }

  async function disconnect() {
    setBusy(true);
    setNotice(null);
    const res = await apiJson<undefined>("/api/seats/connection", { method: "DELETE" });
    if (res.ok) {
      try {
        await forgetSeatsResultsOnDevice(userId);
      } catch {
        // What this browser kept is pruned again the next time the workspace opens (it now knows nothing is connected).
      }
    }
    setBusy(false);
    setConfirmDisconnect(false);
    if (res.ok) {
      setNotice({ kind: "ok", text: t("settings.seats.disconnected") });
      router.refresh();
    } else {
      setNotice({ kind: "error", text: errorText(locale, res.error) });
    }
  }

  async function dismissNotice() {
    setShowReconnect(false);
    await apiJson<undefined>("/api/seats/notice", { method: "DELETE" });
  }

  const status = connected
    ? connectedAt
      ? t("settings.seats.connected_since", { date: formatDayMonth(connectedAt, locale) })
      : t("settings.seats.connected")
    : t("settings.seats.not_connected");

  return (
    <SettingsSection id="seats" title={t("settings.seats.title")}>
      <p className="t-meta text-fg-muted">{t("settings.seats.intro")}</p>

      {showReconnect && !connected && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="seats-reconnect-notice">
          <p className="t-body" role="status">
            {t("seats.reconnect_notice")}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void dismissNotice()}>
            {t("settings.seats.dismiss")}
          </Button>
        </div>
      )}

      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1" data-seats-row>
        <span className="t-body font-medium">seats.aero</span>
        <span className="t-meta text-fg-muted" data-seats-status={connected ? "connected" : "not_connected"}>
          {status}
        </span>
        {confirmDisconnect ? (
          <InlineConfirm
            question={t("settings.seats.disconnect_title")}
            confirmLabel={t("settings.seats.disconnect")}
            cancelLabel={t("common.keep")}
            busy={busy}
            size="sm"
            align="start"
            restoreFocusTo='[data-testid="seats-disconnect"]'
            onConfirm={() => void disconnect()}
            onCancel={() => setConfirmDisconnect(false)}
            data-testid="seats-disconnect-confirm"
          />
        ) : connected ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={busy} data-testid="seats-disconnect">
            {t("settings.seats.disconnect")}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void connect()} disabled={busy || !configured} data-testid="seats-connect">
            {busy ? t("settings.seats.opening") : t("settings.seats.connect")}
          </Button>
        )}
      </div>
      {confirmDisconnect && <p className="t-meta text-fg-muted">{t("settings.seats.disconnect_body")}</p>}
      {!connected && !configured && <p className="t-meta text-fg-muted">{t("settings.seats.not_configured")}</p>}

      {notice && <SettingsNotice kind={notice.kind}>{notice.text}</SettingsNotice>}

      <QuotaBar quota={quota} />
    </SettingsSection>
  );
}
