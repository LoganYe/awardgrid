"use client";

/**
 * The Queries page when the read fails (spec §4, §11: errors are inline, never a modal). One
 * sentence saying what happened and what to do, and the retry that does it. No stack, no error
 * code: nothing here is actionable to the reader, and a message from the server could carry
 * data that does not belong on screen.
 */
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export default function QueriesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div className="flex w-full max-w-content flex-col items-start gap-3">
      <h1 className="t-title">{t("saved.title")}</h1>
      <p className="t-body text-error" role="status" data-testid="queries-error">
        {t("saved.load_failed")}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={reset}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
