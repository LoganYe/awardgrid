"use client";

/**
 * Telegram linking (spec §5.2): status line, "Link Telegram" → POST /api/telegram/link → the
 * bot deep link as a button plus a QR of the same link, and "Waiting for you to press Start in
 * Telegram…" while GET /api/telegram/status is polled every 3 s for two minutes. Unlink confirms
 * inline, never in a modal. State transitions live in telegram-link-state.ts (pure, tested).
 *
 * The QR is drawn by the in-repo encoder (src/lib/qr/encode.ts) as an inline SVG in
 * `currentColor` on the page's own ground, so it needs no image, no network and no dependency.
 * It carries the same link as the button next to it, and the text alternative says what it does.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorText } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { qrSvg } from "@awardgrid/core/qr/encode";
import { apiTelegramLink, apiTelegramStatus, apiTelegramUnlink } from "./api";
import { SettingsNotice } from "./section";
import {
  initialTelegramState,
  POLL_INTERVAL_MS,
  secondsLeft,
  shouldPoll,
  telegramLinkReducer,
  type TelegramLinkAction,
  type TelegramLinkState,
} from "./telegram-link-state";

/** Rendered size of the QR, in CSS pixels (docs/UI_PLAN.md §6.8). */
export const QR_SIZE = 160;

export interface TelegramLinkProps {
  linked: boolean;
  /** Server-side: no TELEGRAM_BOT_TOKEN configured, so alerts are printed instead of sent. */
  mock: boolean;
}

export function TelegramLink({ linked, mock }: TelegramLinkProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const texts = { linkedNow: t("settings.telegram.linked_now"), timeout: t("settings.telegram.timeout") };
  const [state, dispatch] = useReducer(
    (s: TelegramLinkState, a: TelegramLinkAction) => telegramLinkReducer(s, a, texts),
    linked,
    initialTelegramState,
  );
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Poll the status endpoint while a deep link is outstanding.
  const polling = shouldPoll(state);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      const res = await apiTelegramStatus();
      if (cancelled) return;
      const at = Date.now();
      setNow(at);
      if (res.ok) dispatch({ type: "poll", linked: res.data.linked, now: at });
      else dispatch({ type: "poll_failed", now: at });
    };
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [polling]);

  // Once linked (or unlinked), let the server page re-render with the new state.
  useEffect(() => {
    if (state.phase === "idle" && state.linked !== linked) router.refresh();
  }, [state, linked, router]);

  const deepLink = state.phase === "waiting" ? state.deepLink : null;
  const qr = useMemo(() => (deepLink ? qrSvg(deepLink, { size: QR_SIZE, title: t("settings.telegram.qr_alt") }) : null), [deepLink, t]);

  async function onLink() {
    if (busy) return;
    setBusy(true);
    dispatch({ type: "link_start" });
    const res = await apiTelegramLink();
    setBusy(false);
    if (!res.ok) {
      dispatch({ type: "link_failed", text: errorText(locale, res.error) });
      return;
    }
    // Mock mode mints no token, so POST /api/telegram/link answers `{ deepLink: null }` and
    // there is nothing to encode: the component shows the "unavailable" phase and its
    // explanation instead of an empty QR.
    if (!res.data.deepLink) {
      dispatch({ type: "link_unavailable" });
      return;
    }
    const at = Date.now();
    setNow(at);
    dispatch({ type: "link_ready", deepLink: res.data.deepLink, now: at });
  }

  async function onUnlink() {
    setBusy(true);
    const res = await apiTelegramUnlink();
    setBusy(false);
    setConfirmUnlink(false);
    if (res.ok) dispatch({ type: "unlinked", text: t("settings.telegram.unlinked") });
    else dispatch({ type: "error", text: errorText(locale, res.error) });
  }

  const isLinked = state.phase === "idle" && state.linked;
  // The status answers "is MY account linked?". A server with no bot token is not a third state
  // of the account (spec §5.2, §1.3) — it is a caveat, and it rides on the muted line below.
  const status = isLinked ? t("settings.telegram.status.linked") : t("settings.telegram.status.not_linked");

  return (
    <div className="flex flex-col gap-3" data-telegram={isLinked ? "linked" : "unlinked"} data-telegram-phase={state.phase}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
        <p className="t-body">
          <span className="text-fg-muted">{t("settings.telegram.status_label")} </span>
          <span data-telegram-status>{status}</span>
        </p>
        {isLinked ? (
          confirmUnlink ? (
            <span className="flex items-center gap-2">
              <span className="t-meta text-fg">{t("settings.telegram.unlink_title")}</span>
              <Button type="button" variant="destructive" size="sm" onClick={() => void onUnlink()} disabled={busy} autoFocus>
                {t("settings.telegram.unlink")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmUnlink(false)} disabled={busy}>
                {t("common.keep")}
              </Button>
            </span>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmUnlink(true)} disabled={busy}>
              {t("settings.telegram.unlink")}
            </Button>
          )
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => void onLink()}
            disabled={busy || state.phase === "linking" || state.phase === "waiting"}
          >
            {state.phase === "linking" ? t("settings.telegram.linking") : t("settings.telegram.link")}
          </Button>
        )}
      </div>

      {isLinked && <p className="t-meta text-fg-muted">{t("settings.telegram.linked_hint")}</p>}

      {/* Why this account cannot be linked here, said once, whether or not Link was pressed. */}
      {(mock || state.phase === "unavailable") && !isLinked && (
        <p className="t-meta text-fg-muted" data-telegram-mock-explain>
          {t("settings.telegram.mock_explain")}
        </p>
      )}

      {state.phase === "waiting" && qr && (
        <div className="flex flex-wrap items-start gap-6" data-telegram-invite>
          <div className="flex flex-col gap-2">
            <Button size="sm" className="w-fit" nativeButton={false} render={<a href={state.deepLink} target="_blank" rel="noopener noreferrer" />}>
              {t("settings.telegram.open_link")}
            </Button>
            <p className="t-meta text-fg-muted">{t("settings.telegram.instruction")}</p>
            <p className="t-meta text-fg" aria-live="polite" data-telegram-waiting>
              {t("settings.telegram.waiting_start")} {t("settings.telegram.waiting_seconds", { seconds: secondsLeft(state, now) })}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            {/*
              The markup is generated locally by src/lib/qr/encode.ts: fixed shapes, no user text.
              docs/UI_PLAN.md §6.8 says "--fg on --bg", which in dark mode is light modules on a
              dark ground — an inverted code that many phone cameras refuse to decode. So dark mode
              flips the plate to the sanctioned inversion (--fg ground, --bg modules, the same pair
              the primary button uses), keeping dark modules on a light plate in both themes.
            */}
            <div
              className="text-fg dark:bg-fg dark:text-bg"
              style={{ width: QR_SIZE, height: QR_SIZE }}
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="t-meta text-fg-muted">{t("settings.telegram.qr_alt")}</p>
          </div>
        </div>
      )}

      {state.phase === "idle" && state.notice && <SettingsNotice kind={state.notice.kind}>{state.notice.text}</SettingsNotice>}
    </div>
  );
}
