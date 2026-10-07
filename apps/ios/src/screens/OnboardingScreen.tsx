/**
 * The first run (UI/UX v1 T11; docs/04 S08; spec §16 "首次配置"): one screen, shown where the Search screen would be
 * while there is no seats.aero key — what the app does, "Connect your seats.aero account" first, and "View an
 * example". Nothing is forced and nothing comes back once a key is saved. The Anthropic key is not asked for here: it
 * waits for the first AI entry.
 *
 * The example is made up in this file, marked on the page with the approved "Illustrative data — not live
 * availability", and sends nothing. It shows how results read — miles, fees and seats said as known or unknown — not
 * any real availability.
 */
import { copy } from "@awardgrid/core/workspace/present";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import type { WorkspaceRow } from "@awardgrid/core/workspace/types";
import { useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { CAN_CONNECT } from "../app/flags";
import { useFocusOnArrival } from "../app/focus";
import { type Locale, langTag, useLocale } from "../app/locale";
import { AvailabilityCard } from "../components/results/AvailabilityCard";
import { Icon, Notice } from "../components/ui";

export const WELCOME: Record<Locale, { value: string; connect: string; example: string; exampleTitle: string; exampleNote: string; exampleProgram: string; back: string }> = {
  en: {
    value: "Find award seats across programs, from your own seats.aero account. Every result says what is known and what is not.",
    connect: "Connect your seats.aero account",
    example: "View an example",
    exampleTitle: "Example results",
    exampleNote: "Made up to show how results read. Connect your seats.aero account to see results from it.",
    exampleProgram: "Example program",
    back: "Back",
  },
  zh: {
    value: "通过你自己的 seats.aero 账户跨计划查找兑换座位，每条结果都写明已知与未知。",
    connect: "连接你的 seats.aero 账户",
    example: "查看示例",
    exampleTitle: "示例结果",
    exampleNote: "以下内容为虚构，仅用于展示结果的读法。连接你的 seats.aero 账户后，可查看该账户的结果。",
    exampleProgram: "示例计划",
    back: "返回",
  },
};

/** The one first-run screen, inside the Search screen while there is no seats.aero key. */
export function Welcome({ locale }: { locale: Locale }) {
  const w = WELCOME[locale];
  return (
    <div className="ag-welcome" data-testid="welcome">
      <p className="ag-welcome-value">{w.value}</p>
      {/* Not in a build without a connection (VITE_AG_CONNECT=0, app/flags.ts). */}
      {CAN_CONNECT ? (
        <Link to="/settings/seats" className="ag-button ag-button-primary ag-button-block">
          {w.connect}
        </Link>
      ) : null}
      <Link id="welcome-example" to="/example" className="ag-button ag-button-block">
        {w.example}
      </Link>
    </div>
  );
}

/** The made-up rows the example shows: plainly an example program, dated from today, nothing fetched. */
function exampleRows(today: Date, program: string): WorkspaceRow[] {
  const day = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + n)).toISOString().slice(0, 10);
  const row = (id: string, offset: number, cabin: AvailabilityRow["cabin"], miles: number, fees_cents: number | null, currency: string | null, seats_left: number): AvailabilityRow => ({
    program,
    origin: "HKG",
    dest: "SEA",
    date: day(offset),
    cabin,
    miles,
    fees_cents,
    currency,
    seats_left,
    direct: true,
    airlines: [],
    computed_last_seen: "",
    source_id: id,
    booking_url: null,
    fetched_at: "",
  });
  const rows = [
    row("example-1", 30, "J", 70000, 5600, "USD", 2),
    row("example-2", 32, "J", 85000, null, null, 0),
    row("example-3", 32, "F", 120000, 12050, "USD", 1),
  ];
  // No source time: an example has none, and says so.
  return rows.map((value) => ({ key: `${value.source_id}-${value.cabin}`, value, time: { basis: "unknown", providerAt: null, fetchedAt: null } }));
}

/** "View an example": made-up results, marked as such, with nothing sent. */
export function ExampleScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const w = WELCOME[locale];
  const [now] = useState(() => services.now());
  // Keyed as before whatever the language, so a selection survives switching it.
  const rows = useMemo(() => exampleRows(now, w.exampleProgram), [now, w.exampleProgram]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);
  return (
    <div className="ag-example" lang={langTag(locale)}>
      <Link to="/" state={{ focus: "welcome-example" }} className="ag-settings-back">
        <Icon name="chevron-left" />
        <span>{w.back}</span>
      </Link>
      <h1 ref={title} tabIndex={-1} className="ag-settings-title">
        {w.exampleTitle}
      </h1>
      <Notice tone="warning">{copy("demo.synthetic", locale)}</Notice>
      <p className="ag-results-meta">{w.exampleNote}</p>
      <div className="ag-example-list">
        {rows.map((row) => (
          <AvailabilityCard
            key={row.key}
            row={row}
            snapshotId="example"
            selected={selected.has(row.key)}
            onToggle={(on) => setSelected((s) => (on ? new Set([...s, row.key]) : new Set([...s].filter((k) => k !== row.key))))}
            now={now.toISOString()}
            locale={locale}
          />
        ))}
      </div>
      <Notice tone="warning">{copy("demo.synthetic", locale)}</Notice>
      {CAN_CONNECT ? (
        <Link to="/settings/seats" className="ag-button ag-button-primary ag-button-block">
          {w.connect}
        </Link>
      ) : null}
    </div>
  );
}
