"use client";

/**
 * /queries — dense table of the user's standing queries: name · route · cabins · schedule
 * ("every 3 h") · notify rule · threshold · enabled switch · last run (status badge) · actions
 * (run now with spinner + result notice, edit dialog, delete with confirm). The server page
 * hands over the initial list; every mutation goes through /api/queries and patches local state.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2Icon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/components/settings/api";
import { gridHref } from "@/components/grid/state";
import { errorText, hasKey, type I18nKey, type Locale, type Translate } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiDeleteQuery, apiPatchQuery, apiRunQuery, type RunSummary, type SavedQuerySummary } from "./api";
import { cabinSummary, dateSummary, describeCron, routeSummary, type NotifyRule } from "./format";
import { QueryFormDialog } from "./SaveQueryDialog";

export interface QueriesTableProps {
  initial: SavedQuerySummary[];
  telegramLinked: boolean;
}

const NOTIFY_KEY: Record<NotifyRule, I18nKey> = {
  new_cells: "saved.notify.new_cells",
  price_drop: "saved.notify.price_drop",
  both: "saved.notify.both",
};

/** "every 3 h" / "daily 08:00" / raw cron. */
export function scheduleText(t: Translate, cron: string): string {
  const d = describeCron(cron);
  switch (d.kind) {
    case "every_hours":
      return t("saved.schedule.every_hours", { hours: d.hours });
    case "hourly":
      return t("saved.schedule.hourly");
    case "daily":
      return t("saved.schedule.daily", { time: d.time });
    default:
      return d.cron;
  }
}

/** Translate a skipped_reason when a key exists for it, else show the raw code. */
export function skipReasonText(t: Translate, reason: string): string {
  const key = `saved.skip.${reason}`;
  return hasKey(key) ? t(key) : reason;
}

function formatRanAt(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return formatDate(iso, locale);
  }
}

function RunBadge({ run }: { run: RunSummary | null }) {
  const t = useT();
  if (!run) return <Badge variant="outline">{t("saved.status.never")}</Badge>;
  if (run.skipped_reason === "first_run") return <Badge variant="outline">{t("saved.skip.first_run")}</Badge>;
  if (run.skipped_reason) return <Badge variant="secondary">{t("saved.status.skipped", { reason: skipReasonText(t, run.skipped_reason) })}</Badge>;
  if (run.notified) return <Badge className="bg-fresh/15 text-fresh">{t("saved.status.notified")}</Badge>;
  return <Badge variant="outline">{t("saved.status.no_change")}</Badge>;
}

type Notice = { kind: "ok" | "error"; text: string };

export function QueriesTable({ initial, telegramLinked }: QueriesTableProps) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState<SavedQuerySummary[]>(initial);
  const [running, setRunning] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedQuerySummary | null>(null);
  const [deleting, setDeleting] = useState<SavedQuerySummary | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Transient "toast": auto-dismiss after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const replaceRow = useCallback((next: SavedQuerySummary) => {
    setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));
  }, []);

  function failText(error: string, resetAt?: string): string {
    return errorText(locale, error, resetAt ? { resetAt: formatDate(resetAt, locale) } : undefined);
  }

  async function onToggle(row: SavedQuerySummary, enabled: boolean) {
    setBusyId(row.id);
    replaceRow({ ...row, enabled }); // optimistic
    const res = await apiPatchQuery(row.id, { enabled });
    setBusyId(null);
    if (res.ok) replaceRow(res.data.query);
    else {
      replaceRow(row);
      setNotice({ kind: "error", text: failText(res.error, res.resetAt) });
    }
  }

  async function onRun(row: SavedQuerySummary) {
    setRunning((s) => new Set(s).add(row.id));
    setNotice(null);
    const res = await apiRunQuery(row.id);
    setRunning((s) => {
      const n = new Set(s);
      n.delete(row.id);
      return n;
    });
    if (!res.ok) {
      setNotice({ kind: "error", text: failText(res.error, res.resetAt) });
      return;
    }
    const run = res.data.run;
    replaceRow({ ...row, last_run: run, last_run_at: run.ran_at });
    const summary = t("saved.run.cells", { new_cells: run.new_cells, dropped_cells: run.dropped_cells });
    setNotice({
      kind: "ok",
      text: run.skipped_reason ? `${t("saved.run_skipped", { reason: skipReasonText(t, run.skipped_reason) })} · ${summary}` : t("saved.run_done", { summary }),
    });
  }

  async function onDelete() {
    if (!deleting) return;
    const target = deleting;
    setBusyId(target.id);
    const res = await apiDeleteQuery(target.id);
    setBusyId(null);
    setDeleting(null);
    if (res.ok || res.status === 404) {
      setRows((rs) => rs.filter((r) => r.id !== target.id));
      setNotice({ kind: "ok", text: t("saved.deleted") });
    } else {
      setNotice({ kind: "error", text: failText(res.error, res.resetAt) });
    }
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>{t("saved.empty")}</span>
          <Button size="xs" variant="outline" nativeButton={false} render={<Link href="/grid" />}>
            {t("saved.empty_cta")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!telegramLinked && (
        <p className="text-xs text-muted-foreground">
          {t("saved.telegram_hint")}{" "}
          <Link href="/settings#telegram" className="underline underline-offset-2 hover:text-foreground">
            {t("saved.telegram_hint_cta")}
          </Link>
        </p>
      )}

      {notice && (
        <Alert variant={notice.kind === "error" ? "destructive" : "default"} aria-live="polite">
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{t("saved.name")}</TableHead>
              <TableHead>{t("saved.route")}</TableHead>
              <TableHead>{t("saved.cabins")}</TableHead>
              <TableHead>{t("saved.schedule")}</TableHead>
              <TableHead>{t("saved.notify_on")}</TableHead>
              <TableHead>{t("saved.drop_threshold")}</TableHead>
              <TableHead>{t("saved.enabled")}</TableHead>
              <TableHead>{t("saved.last_run")}</TableHead>
              <TableHead className="text-right">{t("saved.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isRunning = running.has(row.id);
              const isBusy = busyId === row.id;
              return (
                <TableRow key={row.id} className={row.enabled ? undefined : "opacity-70"}>
                  <TableCell className="max-w-[16rem]">
                    <div className="flex flex-col gap-0.5">
                      <Link href={gridHref(row.query)} className="truncate font-medium hover:underline" title={t("saved.open_grid")}>
                        {row.name}
                      </Link>
                      <span className="num text-[11px] text-muted-foreground">{dateSummary(row.query)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="num whitespace-nowrap">{routeSummary(row.query)}</TableCell>
                  <TableCell className="num">{cabinSummary(row.query)}</TableCell>
                  <TableCell className="num whitespace-nowrap" title={row.schedule_cron}>
                    {scheduleText(t, row.schedule_cron)}
                  </TableCell>
                  <TableCell>{t(NOTIFY_KEY[row.notify_on])}</TableCell>
                  <TableCell className="num whitespace-nowrap">{row.notify_on === "new_cells" ? "—" : t("saved.threshold_value", { pct: row.drop_threshold_pct })}</TableCell>
                  <TableCell>
                    <Switch
                      size="sm"
                      checked={row.enabled}
                      disabled={isBusy}
                      aria-label={t("saved.enable_aria", { name: row.name })}
                      onCheckedChange={(checked) => void onToggle(row, checked)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <RunBadge run={row.last_run} />
                      {row.last_run && (
                        <span className="num text-[11px] text-muted-foreground" title={row.last_run.ran_at}>
                          {formatRanAt(row.last_run.ran_at, locale)} · {t("saved.run.cells", { new_cells: row.last_run.new_cells, dropped_cells: row.last_run.dropped_cells })}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="outline" size="xs" disabled={isRunning || isBusy} onClick={() => void onRun(row)} aria-busy={isRunning}>
                        {isRunning ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlayIcon data-icon="inline-start" />}
                        {isRunning ? t("saved.running") : t("saved.run_now")}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("saved.edit")} disabled={isBusy} onClick={() => setEditing(row)}>
                        <PencilIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("saved.delete")} disabled={isBusy} onClick={() => setDeleting(row)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <QueryFormDialog
          mode={{ kind: "edit", saved: editing }}
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={(saved) => {
            replaceRow(saved);
            setNotice({ kind: "ok", text: t("saved.updated") });
          }}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("saved.delete_title", { name: deleting?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("saved.delete_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" size="sm" onClick={() => void onDelete()} disabled={busyId !== null}>
              {t("saved.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
