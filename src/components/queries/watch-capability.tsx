/**
 * What this server's standing queries can really do (UI/UX v1 T20; docs/02 D05; docs/05; A33), said once at the top
 * of /queries in the approved words. Server-rendered from real signals only:
 *
 *   - scheduled checks: a worker has ticked against this database (its heartbeat, src/lib/scheduler/heartbeat.ts);
 *   - push: that worker delivers through a real Telegram bot, this server has the bot's token, and this account is
 *     linked.
 *
 * "Configured" is never "ran": how the last run went is its own line, from the heartbeat's age and outcome, and
 * "unknown" when nothing is recorded. Nothing here sends anything.
 */
import type { Locale } from "@awardgrid/core/i18n";
import type { Translate } from "@awardgrid/core/i18n";
import { copy } from "@awardgrid/core/workspace/present";
import { capabilityMessageKey, runHealth, type RunHealth, type WatchCapabilities } from "@awardgrid/core/workspace/watch-capabilities";
import { absoluteTime, relativeTime } from "@/components/queries/format";
import type { WorkerHeartbeat } from "@/lib/scheduler/heartbeat";

/** The worker ticks every minute: a heartbeat older than this means it stopped (or cannot write). */
export const HEARTBEAT_STALE_MS = 10 * 60 * 1000;

export function webWatchCapabilities(beat: WorkerHeartbeat | null, telegramConfigured: boolean, telegramLinked: boolean): WatchCapabilities {
  return {
    checkOnForeground: false,
    scheduledChecks: beat !== null,
    pushEnabled: beat !== null && beat.transport === "telegram" && telegramConfigured && telegramLinked,
  };
}

export function WatchCapability({ beat, telegramConfigured, telegramLinked, now, locale, t }: { beat: WorkerHeartbeat | null; telegramConfigured: boolean; telegramLinked: boolean; now: Date; locale: Locale; t: Translate }) {
  const key = capabilityMessageKey(webWatchCapabilities(beat, telegramConfigured, telegramLinked));
  const health: RunHealth = runHealth(beat ? { finishedAt: beat.tickAt, ok: beat.ok } : null, now.toISOString(), HEARTBEAT_STALE_MS);
  const when = beat ? relativeTime(beat.tickAt, now.getTime(), locale) : "";
  const title = beat ? absoluteTime(beat.tickAt, locale) : undefined;
  const healthText =
    health === "ok" ? t("saved.health.ok", { when }) : health === "stale" ? t("saved.health.stale", { when }) : health === "failed" ? t("saved.health.failed", { when }) : t("saved.health.unknown");
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-line bg-bg-raised px-4 py-3" aria-label={t("saved.capability_label")} data-testid="watch-capability" data-capability={key} data-health={health}>
      <p className="t-body text-fg">{copy(key, locale)}</p>
      <p className="t-meta text-fg-muted" title={title}>
        {healthText}
      </p>
    </section>
  );
}
