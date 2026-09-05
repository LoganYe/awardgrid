"use client";

/**
 * Live Telegram linking UI for the Settings card: status badge (linked / not linked / mock),
 * "Link Telegram" → POST /api/telegram/link → deep-link button (opens t.me) + "press Start"
 * instruction, polling GET /api/telegram/status every 3 s for 2 minutes; "Unlink" behind a
 * confirm. State transitions live in telegram-link-state.ts (pure, tested).
 */
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiTelegramLink, apiTelegramStatus, apiTelegramUnlink } from "./api";
import { POLL_INTERVAL_MS, initialTelegramState, secondsLeft, shouldPoll, telegramLinkReducer, type TelegramLinkAction, type TelegramLinkState } from "./telegram-link-state";

export interface TelegramLinkProps {
  linked: boolean;
  /** Server-side: no TELEGRAM_BOT_TOKEN configured. */
  mock: boolean;
}

export function TelegramLink({ linked, mock }: TelegramLinkProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const texts = { linkedNow: t("settings.telegram.linked_now"), timeout: t("settings.telegram.timeout") };
  const [state, dispatch] = useReducer(
    (s: TelegramLinkState, a: TelegramLinkAction) => telegramLinkReducer(s, a, texts),
    { linked, mock },
    ({ linked, mock }) => initialTelegramState(linked, mock),
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

  // Once linked, let the server page re-render with the new state (nav, saved-queries hint).
  useEffect(() => {
    if (state.phase === "idle" && state.linked !== linked) router.refresh();
  }, [state, linked, router]);

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
    if (res.data.mock || !res.data.deepLink) {
      dispatch({ type: "link_mock" });
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
  const statusLabel = state.mock
    ? t("settings.telegram.status.mock")
    : isLinked
      ? t("settings.telegram.status.linked")
      : t("settings.telegram.status.not_linked");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isLinked ? "default" : state.mock ? "outline" : "secondary"}>{statusLabel}</Badge>
        {isLinked ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmUnlink(true)} disabled={busy}>
            {t("settings.telegram.unlink")}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void onLink()} disabled={busy || state.phase === "linking" || state.phase === "waiting"}>
            {state.phase === "linking" ? (
              <>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                {t("settings.telegram.linking")}
              </>
            ) : (
              t("settings.telegram.link")
            )}
          </Button>
        )}
      </div>

      {(state.phase === "mock" || (state.phase === "idle" && state.mock)) && (
        <p className="text-xs text-muted-foreground">{t("settings.telegram.mock_explain")}</p>
      )}

      {state.phase === "waiting" && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <Button size="sm" className="w-fit" render={<a href={state.deepLink} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLinkIcon data-icon="inline-start" />
            {t("settings.telegram.open_link")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("settings.telegram.instruction")}</p>
          <p className="num flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <Loader2Icon className="size-3 animate-spin" />
            {t("settings.telegram.waiting", { seconds: secondsLeft(state, now) })}
          </p>
        </div>
      )}

      {state.phase === "idle" && state.notice && (
        <Alert variant={state.notice.kind === "error" ? "destructive" : "default"} aria-live="polite">
          <AlertDescription>{state.notice.text}</AlertDescription>
        </Alert>
      )}

      <Dialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.telegram.unlink_title")}</DialogTitle>
            <DialogDescription>{t("settings.telegram.unlink_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" size="sm" onClick={() => void onUnlink()} disabled={busy}>
              {t("settings.telegram.unlink")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
