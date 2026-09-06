"use client";

/**
 * "Save as standing query" (grid header) and "Edit" (saved-queries page) share one form:
 * name · schedule preset (every 3 h default / 6 h / 12 h / daily 08:00 / custom cron) ·
 * notify rule (both default) · drop threshold (10 % default). State lives in the pure
 * queryFormReducer (format.ts) so the validation is unit-tested without React.
 *
 * Create: POST /api/queries → inline confirmation with a link to /queries.
 * Edit:   PATCH /api/queries/[id] → onSaved(updated) and close.
 */
import Link from "next/link";
import { useId, useReducer, useState, type FormEvent } from "react";
import { BookmarkPlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/settings/native-select";
import { formatDate } from "@/components/settings/api";
import { errorText, type I18nKey } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";
import { apiCreateQuery, apiPatchQuery, type SavedQuerySummary } from "./api";
import {
  CRON_PRESETS,
  THRESHOLD_RANGE,
  NAME_MAX_LENGTH,
  formProblems,
  formStateFrom,
  formToBody,
  initialFormState,
  queryFormReducer,
  type CronPresetId,
  type NotifyRule,
  type QueryFormState,
} from "./format";

const PRESET_KEY: Record<CronPresetId, I18nKey> = {
  every_3h: "saved.dialog.preset.every_3h",
  every_6h: "saved.dialog.preset.every_6h",
  every_12h: "saved.dialog.preset.every_12h",
  daily_08: "saved.dialog.preset.daily_08",
  custom: "saved.dialog.preset.custom",
};

const NOTIFY_KEY: Record<NotifyRule, I18nKey> = {
  new_cells: "saved.notify.new_cells",
  price_drop: "saved.notify.price_drop",
  both: "saved.notify.both",
};

const NOTIFY_RULES: readonly NotifyRule[] = ["both", "new_cells", "price_drop"];

type Mode = { kind: "create"; query: QueryObject } | { kind: "edit"; saved: SavedQuerySummary };

export interface QueryFormDialogProps {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode: the updated row. Create mode: the new row (the dialog stays open showing the link). */
  onSaved?: (saved: SavedQuerySummary) => void;
}

function initialState(mode: Mode): QueryFormState {
  return mode.kind === "create" ? initialFormState(mode.query) : formStateFrom(mode.saved);
}

/** The shared form dialog (controlled). */
export function QueryFormDialog({ mode, open, onOpenChange, onSaved }: QueryFormDialogProps) {
  const t = useT();
  const locale = useLocale();
  const ids = useId();
  const [state, dispatch] = useReducer(queryFormReducer, mode, initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SavedQuerySummary | null>(null);
  const [touched, setTouched] = useState(false);

  const problems = formProblems(state);
  const showProblem = (p: "name" | "cron" | "threshold") => touched && problems.includes(p);

  function reset() {
    dispatch({ type: "reset", state: initialState(mode) });
    setError(null);
    setCreated(null);
    setTouched(false);
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (busy || problems.length > 0) return;
    setBusy(true);
    setError(null);
    const body = formToBody(state);
    const res = mode.kind === "create" ? await apiCreateQuery({ ...body, query: mode.query }) : await apiPatchQuery(mode.saved.id, body);
    setBusy(false);
    if (!res.ok) {
      setError(errorText(locale, res.error, res.resetAt ? { resetAt: formatDate(res.resetAt, locale) } : undefined));
      return;
    }
    if (mode.kind === "create") {
      setCreated(res.data.query);
      onSaved?.(res.data.query);
    } else {
      onSaved?.(res.data.query);
      onOpenChange(false);
      reset();
    }
  }

  const title = mode.kind === "create" ? t("saved.dialog.save_title") : t("saved.dialog.edit_title");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{mode.kind === "create" ? t("saved.dialog.save_body") : t("saved.dialog.quota_hint")}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-3">
            <Alert aria-live="polite">
              <AlertDescription>
                {t("saved.dialog.saved")} <span className="font-mono">{created.name}</span>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="sm" />}>{t("common.close")}</DialogClose>
              <Button size="sm" nativeButton={false} render={<Link href="/queries" />}>
                {t("saved.dialog.view")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-name`}>{t("saved.name")}</Label>
              <Input
                id={`${ids}-name`}
                value={state.name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(e) => dispatch({ type: "set_name", value: e.target.value })}
                disabled={busy}
                aria-invalid={showProblem("name") ? true : undefined}
                autoFocus={mode.kind === "edit"}
              />
              <p className="text-xs text-muted-foreground">{t("saved.dialog.name_hint")}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-preset`}>{t("saved.schedule")}</Label>
                <NativeSelect
                  id={`${ids}-preset`}
                  value={state.preset}
                  onChange={(e) => dispatch({ type: "set_preset", value: e.target.value as CronPresetId })}
                  disabled={busy}
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(PRESET_KEY[p.id])}
                    </option>
                  ))}
                  <option value="custom">{t(PRESET_KEY.custom)}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-notify`}>{t("saved.notify_on")}</Label>
                <NativeSelect
                  id={`${ids}-notify`}
                  value={state.notifyOn}
                  onChange={(e) => dispatch({ type: "set_notify", value: e.target.value as NotifyRule })}
                  disabled={busy}
                >
                  {NOTIFY_RULES.map((r) => (
                    <option key={r} value={r}>
                      {t(NOTIFY_KEY[r])}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {state.preset === "custom" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-cron`}>{t("saved.dialog.custom_cron")}</Label>
                <Input
                  id={`${ids}-cron`}
                  value={state.customCron}
                  onChange={(e) => dispatch({ type: "set_custom_cron", value: e.target.value })}
                  placeholder="0 */4 * * *"
                  className="font-mono"
                  spellCheck={false}
                  autoCapitalize="none"
                  disabled={busy}
                  aria-invalid={showProblem("cron") ? true : undefined}
                />
                {showProblem("cron") && <p className="text-xs text-destructive">{t("saved.dialog.custom_cron_invalid")}</p>}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-threshold`}>{t("saved.drop_threshold")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${ids}-threshold`}
                  type="number"
                  inputMode="numeric"
                  min={THRESHOLD_RANGE.min}
                  max={THRESHOLD_RANGE.max}
                  step={1}
                  value={state.thresholdPct}
                  onChange={(e) => dispatch({ type: "set_threshold", value: e.target.valueAsNumber })}
                  className="num w-24"
                  disabled={busy || state.notifyOn === "new_cells"}
                  aria-invalid={showProblem("threshold") ? true : undefined}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">{t("saved.dialog.threshold_hint")}</p>
            </div>

            {mode.kind === "create" && <p className="text-xs text-muted-foreground">{t("saved.dialog.quota_hint")}</p>}

            {error && (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="sm" />} disabled={busy}>
                {t("common.cancel")}
              </DialogClose>
              <Button type="submit" size="sm" disabled={busy || (touched && problems.length > 0)}>
                {busy ? t("saved.dialog.saving") : mode.kind === "create" ? t("saved.dialog.submit") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface SaveQueryDialogProps {
  /** The grid's current QueryObject (already validated by the parser / chips). */
  query: QueryObject;
  disabled?: boolean;
}

/** Grid-header entry point: the button + the create dialog. */
export function SaveQueryDialog({ query, disabled }: SaveQueryDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)} disabled={disabled}>
        <BookmarkPlusIcon data-icon="inline-start" />
        {t("grid.save_query")}
      </Button>
      {open && <QueryFormDialog mode={{ kind: "create", query }} open={open} onOpenChange={setOpen} />}
    </>
  );
}
