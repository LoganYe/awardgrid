"use client";
/**
 * The Web workspace (UI/UX v1 T18; docs/04 S10, laid out in T19): the account's search as one trusted snapshot,
 * listed through the same projection every view uses (core workspace/projection.ts), with each option's "Save
 * option". A search given in the address (?q=, as the grid's shared links) runs once; a restored workspace runs
 * nothing. Everything belongs to the signed-in account: its stores are made for its id (./services.ts).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { favoriteFromOption, optionOrigin } from "@awardgrid/core/workspace/favorites-store";
import { projectResults } from "@awardgrid/core/workspace/projection";
import { querySubline, routeLabel } from "@awardgrid/core/workspace/present";
import { notifyUsageChanged } from "@/components/shell/quota-indicator";
import { OptionCard } from "./option-card";
import { useWorkspaceServices } from "./services";

export interface WorkspaceAppProps {
  /** The signed-in account, from the server's session. */
  userId: string;
  initialQuery: QueryObject | null;
  hasKey: boolean;
}

export function WorkspaceApp({ userId, initialQuery, hasKey }: WorkspaceAppProps) {
  const t = useT();
  const locale = useLocale();
  const { services, ready } = useWorkspaceServices(userId);
  const { workspace, favorites } = services;
  const state = useSyncExternalStore(workspace.subscribe, workspace.getState, workspace.getState);
  const saved = useSyncExternalStore(favorites.subscribe, favorites.all, favorites.all);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The address's search runs once, when this account's stored workspace has been read.
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !initialQuery || !hasKey || ran.current === userId) return;
    ran.current = userId;
    void workspace.run(initialQuery).then(() => {
      // The header's count re-reads the server's, now: a search may have spent a call, answered or not.
      notifyUsageChanged();
      return workspace.persist();
    });
  }, [ready, initialQuery, hasKey, userId, workspace]);

  const snapshot = state.displayedSnapshot;
  const projected = useMemo(() => (snapshot ? projectResults(snapshot, state.preferences) : null), [snapshot, state.preferences]);
  const now = new Date().toISOString();
  const savedOrigins = new Set(saved.map((f) => f.originalSnapshotId));

  const save = async (rowKey: string) => {
    if (!snapshot) return;
    const item = favoriteFromOption(snapshot, rowKey, new Date().toISOString(), crypto.randomUUID());
    if (!item) return;
    setSaving(rowKey);
    const written = await favorites.save(item);
    setSaving(null);
    setNotice(written.ok ? null : written.reason === "capacity" ? t("workspace.save_full") : t("workspace.save_failed"));
  };

  const run = state.run.kind;
  return (
    <section className="ag-web-workspace" data-testid="workspace" data-run={run} data-ready={ready || undefined}>
      <h1 className="t-title">{t("workspace.title")}</h1>
      {snapshot ? (
        <div className="ag-web-summary" data-testid="query-summary">
          <p className="ag-web-summary-route">{routeLabel(snapshot.query, locale)}</p>
          <p className="ag-web-summary-sub">{querySubline(snapshot.query, locale)}</p>
        </div>
      ) : null}
      <p role="status" className="ag-web-status">
        {!hasKey
          ? t("workspace.no_key")
          : run === "running"
            ? t("workspace.running")
            : run === "failed"
              ? t("workspace.failed")
              : projected
                ? projected.rows.length > 0
                  ? t("workspace.count", { count: String(projected.rows.length) })
                  : t("workspace.none")
                : ready
                  ? t("workspace.no_search")
                  : ""}
      </p>
      {notice ? (
        <p role="alert" className="ag-web-notice">
          {notice}
        </p>
      ) : null}
      {snapshot && projected && projected.rows.length > 0 ? (
        <ul className="ag-web-options" data-testid="availability-list">
          {projected.rows.map((row) => (
            <li key={row.key}>
              <OptionCard
                row={row}
                snapshotId={snapshot.id}
                locale={locale}
                now={now}
                saved={savedOrigins.has(optionOrigin(snapshot.id, row.key))}
                busy={saving === row.key || favorites.isReadOnly()}
                onSave={() => void save(row.key)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
