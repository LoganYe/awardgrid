"use client";

/** Direct only editor (spec §3.2): one switch. */
import { Switch } from "@/components/ui/switch";
import { useT } from "@awardgrid/core/i18n/client";

export interface DirectEditorProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function DirectEditor({ value, onChange }: DirectEditorProps) {
  const t = useT();
  return (
    <label className="flex items-center justify-between gap-3 text-grid">
      <span>{t("grid.chips.direct_only")}</span>
      <Switch checked={value} onCheckedChange={(next) => onChange(next)} aria-label={t("grid.chips.direct_only")} />
    </label>
  );
}
