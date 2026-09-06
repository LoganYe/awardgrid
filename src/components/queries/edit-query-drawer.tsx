"use client";

/**
 * "Edit" on the Queries page opens the 480 px drawer (spec §4, §11): name, schedule presets +
 * a custom cron, the notify rule and the drop threshold, and — the point of the drawer rather
 * than a dialog — the SAME seven chip editors the grid uses (src/components/grid/chip-row.tsx)
 * with the saved QueryObject as the draft, so what a standing query watches is edited the way
 * the query itself was built.
 *
 * Save is one PATCH /api/queries/[id]; the chips travel with it only when they actually changed
 * (PatchBody in src/app/api/queries/shared.ts accepts `query`, so there is no fallback path).
 *
 * Errors are inline in the drawer, never a modal, and the drawer stays open on failure.
 */
import { useReducer, useState } from "react";
import { ChipRow } from "@/components/grid/chip-row";
import { validateQuery, type ChipId } from "@/components/grid/chips-model";
import { localToday } from "@/components/grid/state";
import { DrawerShell } from "@/components/drawers";
import { apiPatchQuery, type QueryRowSummary, type SavedQuerySummary } from "@/components/queries/api";
import {
  CRON_PRESETS,
  NAME_MAX_LENGTH,
  THRESHOLD_RANGE,
  formProblems,
  formStateFrom,
  formToBody,
  queryFormReducer,
  type CronPresetId,
  type NotifyRule,
} from "@/components/queries/format";
import { NativeSelect } from "@/components/settings/native-select";
import { formatDate } from "@/components/settings/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText, type I18nKey } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";

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

export interface EditQueryDrawerProps {
  saved: QueryRowSummary;
  open: boolean;
  onClose: () => void;
  /** The updated row from the API. */
  onSaved: (row: SavedQuerySummary) => void;
}

const sameQuery = (a: QueryObject, b: QueryObject) => JSON.stringify(a) === JSON.stringify(b);

export function EditQueryDrawer({ saved, open, onClose, onSaved }: EditQueryDrawerProps) {
  const t = useT();
  const locale = useLocale();
  const [state, dispatch] = useReducer(queryFormReducer, saved, formStateFrom);
  const [draft, setDraft] = useState<QueryObject>(saved.query);
  // ChipRow is fully controlled: without these the drawer's chips render but never open.
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const problems = formProblems(state);
  const chips = validateQuery(draft, t);
  const showProblem = (p: "name" | "cron" | "threshold") => touched && problems.includes(p);
  const blocked = problems.length > 0 || !chips.valid;

  async function onSave() {
    setTouched(true);
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    const body = formToBody(state);
    // PATCH takes the whole QueryObject; send it only when the chips actually moved, so an
    // untouched query keeps its stored JSON byte for byte.
    const queryChanged = !sameQuery(draft, saved.query);
    const res = await apiPatchQuery(saved.id, queryChanged ? { ...body, query: draft } : body);
    setBusy(false);
    if (!res.ok) {
      setError(errorText(locale, res.error, res.resetAt ? { resetAt: formatDate(res.resetAt, locale) } : undefined));
      return;
    }
    onSaved(res.data.query);
    onClose();
  }

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title={t("saved.dialog.edit_title")}
      width={480}
      mobile="sheet"
      openerKey={saved.id}
      data-testid="edit-query-drawer"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={busy || (touched && blocked)} onClick={() => void onSave()} data-testid="edit-query-save">
            {busy ? t("saved.dialog.saving") : t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-query-name">{t("saved.name")}</Label>
          <Input
            id="edit-query-name"
            value={state.name}
            maxLength={NAME_MAX_LENGTH}
            disabled={busy}
            aria-invalid={showProblem("name") ? true : undefined}
            onChange={(e) => dispatch({ type: "set_name", value: e.target.value })}
          />
          <p className="t-meta text-fg-muted">{t("saved.dialog.name_hint")}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-query-preset">{t("saved.schedule")}</Label>
            <NativeSelect
              id="edit-query-preset"
              value={state.preset}
              disabled={busy}
              onChange={(e) => dispatch({ type: "set_preset", value: e.target.value as CronPresetId })}
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
            <Label htmlFor="edit-query-notify">{t("saved.notify_on")}</Label>
            <NativeSelect
              id="edit-query-notify"
              value={state.notifyOn}
              disabled={busy}
              onChange={(e) => dispatch({ type: "set_notify", value: e.target.value as NotifyRule })}
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
            <Label htmlFor="edit-query-cron">{t("saved.dialog.custom_cron")}</Label>
            <Input
              id="edit-query-cron"
              value={state.customCron}
              placeholder="0 */4 * * *"
              spellCheck={false}
              autoCapitalize="none"
              disabled={busy}
              aria-invalid={showProblem("cron") ? true : undefined}
              onChange={(e) => dispatch({ type: "set_custom_cron", value: e.target.value })}
            />
            {showProblem("cron") && <p className="t-meta text-error">{t("saved.dialog.custom_cron_invalid")}</p>}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-query-threshold">{t("saved.drop_threshold")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="edit-query-threshold"
              type="number"
              inputMode="numeric"
              min={THRESHOLD_RANGE.min}
              max={THRESHOLD_RANGE.max}
              step={1}
              value={state.thresholdPct}
              className="num w-24"
              disabled={busy || state.notifyOn === "new_cells"}
              aria-invalid={showProblem("threshold") ? true : undefined}
              onChange={(e) => dispatch({ type: "set_threshold", value: e.target.valueAsNumber })}
            />
            <span className="t-body text-fg-muted">%</span>
          </div>
          <p className="t-meta text-fg-muted">{t("saved.dialog.threshold_hint")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="aq-section-title">{t("saved.edit.watches")}</p>
          {/*
            The grid's own chip row. `modified` stays false so the row does not grow a second
            "Run" button inside a drawer whose only commit is Save; the edited chips still take
            the accent outline, which comes from the comparison with `parsed`.
          */}
          <ChipRow
            query={draft}
            parsed={saved.query}
            modified={false}
            today={localToday()}
            disabled={busy}
            open={openChip}
            onOpenChange={setOpenChip}
            canReset={false}
            onChange={setDraft}
            onRun={() => undefined}
            onReset={() => setDraft(saved.query)}
          />
        </div>

        {error && (
          <p className="t-meta text-error" role="status" data-testid="edit-query-error">
            {error}
          </p>
        )}
      </div>
    </DrawerShell>
  );
}
