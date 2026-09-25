"use client";
/**
 * The account's saved options on this browser (UI/UX v1 T18; docs/04 S06): each with when it was saved, the search it
 * came from, the option as it was, and the approved "Saved snapshot; availability may change." Opening the page
 * sends nothing. Another account on the same browser has its own list (./storage.ts).
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { FAVORITES_LIMITS } from "@awardgrid/core/workspace/favorites-store";
import { copy, dayLabel, feesLabel, formatMiles, programLabel, querySubline, routeLabel, seatsLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import { useWorkspaceServices } from "./services";

export function SavedApp({ userId }: { userId: string }) {
  const t = useT();
  const locale = useLocale();
  const { services, ready } = useWorkspaceServices(userId);
  const { favorites } = services;
  const items = useSyncExternalStore(favorites.subscribe, favorites.all, favorites.all);
  const when = (iso: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <section className="ag-web-saved" data-ready={ready || undefined}>
      <h1 className="t-title">{t("favorites.title")}</h1>
      <p className="ag-web-status">{t("favorites.intro")}</p>
      {favorites.isReadOnly() ? (
        <p role="alert" className="ag-web-notice">
          {t("favorites.read_only")}
        </p>
      ) : null}
      {ready && items.length > 0 ? (
        <p className="ag-web-status tabular">{t("favorites.usage", { count: String(items.length), max: String(FAVORITES_LIMITS.maxItems) })}</p>
      ) : null}
      {ready && items.length === 0 && !favorites.isReadOnly() ? (
        <div className="ag-web-empty">
          <p>{t("favorites.empty")}</p>
          <Link href="/workspace" className="ag-web-button">
            {t("favorites.go_search")}
          </Link>
        </div>
      ) : null}
      <ul className="ag-web-options">
        {items.map((item) => {
          const row = item.rows[0];
          return (
            <li key={item.id}>
              <article className="ag-web-option" data-testid="favorite-card">
                <div className="ag-web-option-main">
                  <h2 className="ag-web-option-route">{routeLabel(item.query, locale)}</h2>
                  <p className="ag-web-option-meta">{querySubline(item.query, locale)}</p>
                  {row ? (
                    <p className="ag-web-option-meta tabular">
                      {dayLabel(row.value.date, locale)} · {cabinName(row.value.cabin, locale)} · {programLabel(row.value.program)} ·{" "}
                      {locale === "zh" ? `${formatMiles(row.value.miles)} 里程` : `${formatMiles(row.value.miles)} miles`} · {feesLabel(row.value.fees_cents, row.value.currency, locale)} ·{" "}
                      {seatsLabel(row.value.seats_left, locale)}
                    </p>
                  ) : null}
                  <p className="ag-web-option-time">{t("favorites.saved_at", { when: when(item.savedAt) })}</p>
                  <p className="ag-web-option-time">{copy("favorite.snapshot", locale)}</p>
                </div>
                <div className="ag-web-option-actions">
                  <button type="button" className="ag-web-button" onClick={() => void favorites.remove(item.id)}>
                    {t("favorites.remove")}
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
