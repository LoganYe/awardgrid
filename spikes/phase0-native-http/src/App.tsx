/**
 * Phase 0, one screen. Deliberately unstyled beyond legibility: this spike is thrown away,
 * and PIVOT §6 puts the design system in Phase 3. What matters here is that every claim on
 * screen is traceable to something a server observed.
 */
import { useCallback, useEffect, useState } from "react";
import {
  type AvailabilityRow,
  type LiveSearchOutcome,
  type ProbeResult,
  probeAbortSignal,
  probeLiveCachedSearch,
  probeNativeReadTimeout,
  probeNativeToSeatsAero,
  probeStackIdentification,
  probeStartupAssertion,
  probeWebViewToSeatsAero,
} from "./probes";

const BUILD_KEY = (import.meta.env.VITE_SEATS_AERO_KEY as string | undefined) ?? "";

const STATUS_COLOR: Record<string, string> = {
  pass: "#0a7f3f",
  fail: "#b3261e",
  inconclusive: "#8a6d00",
  pending: "#5c5f66",
  running: "#1b5fb4",
};

function ProbeCard({ result }: { result: ProbeResult }) {
  const [open, setOpen] = useState(false);
  return (
    <section
      style={{
        border: "1px solid #d7d8dc",
        borderLeft: `4px solid ${STATUS_COLOR[result.status]}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 10,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <strong style={{ fontSize: 15 }}>
          {result.id} · {result.title}
        </strong>
        <span style={{ color: STATUS_COLOR[result.status], fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
          {result.status.toUpperCase()}
          {result.ms !== undefined ? ` · ${Math.round(result.ms)} ms` : ""}
        </span>
      </div>
      <p style={{ margin: "6px 0 4px", fontSize: 13, lineHeight: 1.45 }}>{result.detail}</p>
      <p style={{ margin: 0, fontSize: 12, color: "#5c5f66", lineHeight: 1.4 }}>
        <em>Expected: {result.expectation}</em>
      </p>
      {result.evidence ? (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ marginTop: 8, fontSize: 12, padding: "4px 8px", cursor: "pointer" }}
          >
            {open ? "Hide" : "Show"} evidence
          </button>
          {open ? (
            <pre
              style={{
                marginTop: 8,
                fontSize: 11,
                lineHeight: 1.4,
                background: "#f5f6f8",
                padding: 10,
                borderRadius: 6,
                overflowX: "auto",
                maxHeight: 320,
              }}
            >
              {JSON.stringify(result.evidence, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RowsTable({ rows }: { rows: AvailabilityRow[] }) {
  const cell: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e6e7ea",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ overflowX: "auto", border: "1px solid #d7d8dc", borderRadius: 8, background: "#fff" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", background: "#f5f6f8" }}>
            {["Date", "Route", "Source", "Y", "W", "J", "F", "J seats"].map((h) => (
              <th key={h} style={{ ...cell, fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ID}>
              <td style={cell}>{r.Date}</td>
              <td style={cell}>
                {r.Route?.OriginAirport}→{r.Route?.DestinationAirport}
              </td>
              <td style={cell}>{r.Source}</td>
              {/* MileageCost is a STRING and "0" means unavailable (types.ts:127). */}
              {[r.YMileageCost, r.WMileageCost, r.JMileageCost, r.FMileageCost].map((v, i) => (
                <td key={i} style={cell}>
                  {v && v !== "0" ? Number(v).toLocaleString() : "—"}
                </td>
              ))}
              <td style={cell}>{r.JRemainingSeats ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [live, setLive] = useState<LiveSearchOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [apiKey, setApiKey] = useState(BUILD_KEY);
  const [route, setRoute] = useState({ origin: "SFO", destination: "NRT" });

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setLive(null);
    // Sequential on purpose: P3 and P4 both reset the probe server's log, so overlapping
    // them would let one probe read the other's requests and quietly invent a result.
    for (const probe of [
      probeStartupAssertion,
      probeWebViewToSeatsAero,
      probeNativeToSeatsAero,
      probeStackIdentification,
      probeAbortSignal,
      probeNativeReadTimeout,
    ]) {
      const r = await probe();
      setResults((prev) => [...prev, r]);
    }
    setRunning(false);
  }, []);

  const runLive = useCallback(async () => {
    setRunning(true);
    setLive(await probeLiveCachedSearch(apiKey, route.origin, route.destination));
    setRunning(false);
  }, [apiKey, route]);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  // A "fail" here is a finding about iOS, not a broken spike — P4 fails because AbortSignal
  // genuinely does not reach the native side. Say that rather than printing a bare score.
  const passes = results.filter((r) => r.status === "pass").length;
  const fails = results.filter((r) => r.status === "fail").map((r) => r.id);

  return (
    <main
      style={{
        fontFamily: "-apple-system, system-ui, sans-serif",
        padding: "max(16px, env(safe-area-inset-top)) 16px 32px",
        background: "#f0f1f4",
        minHeight: "100vh",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 20, margin: "8px 0 2px" }}>awardgrid · Phase 0</h1>
      <p style={{ fontSize: 13, color: "#5c5f66", margin: "0 0 14px", lineHeight: 1.45 }}>
        Does a native-HTTP call reach seats.aero, and can we <em>prove</em> it did not go through the
        WebView?{" "}
        {results.length === 0
          ? "Running…"
          : `${passes}/${results.length} passing` +
            (fails.length
              ? ` — ${fails.join(", ")} ${fails.length === 1 ? "reports" : "report"} a real iOS limitation, not a broken probe.`
              : ".")}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => void runAll()} disabled={running} style={{ padding: "8px 14px", fontSize: 14 }}>
          {running ? "Running…" : "Re-run probes"}
        </button>
      </div>

      {results.map((r) => (
        <ProbeCard key={r.id} result={r} />
      ))}

      <h2 style={{ fontSize: 17, margin: "22px 0 8px" }}>P6 · Live query (spends one quota call)</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input
          value={route.origin}
          onChange={(e) => setRoute((r) => ({ ...r, origin: e.target.value.toUpperCase().slice(0, 3) }))}
          style={{ width: 62, padding: 8, fontSize: 14, textTransform: "uppercase" }}
          aria-label="Origin airport"
        />
        <input
          value={route.destination}
          onChange={(e) => setRoute((r) => ({ ...r, destination: e.target.value.toUpperCase().slice(0, 3) }))}
          style={{ width: 62, padding: 8, fontSize: 14, textTransform: "uppercase" }}
          aria-label="Destination airport"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          placeholder="seats.aero Pro key"
          type="password"
          style={{ flex: 1, minWidth: 160, padding: 8, fontSize: 14 }}
          aria-label="seats.aero Pro API key"
        />
        <button onClick={() => void runLive()} disabled={running || !apiKey} style={{ padding: "8px 14px", fontSize: 14 }}>
          Search
        </button>
      </div>
      {BUILD_KEY ? (
        <p style={{ fontSize: 12, color: "#5c5f66", margin: "0 0 10px" }}>
          Key loaded from <code>.env.local</code> at build time (gitignored).
        </p>
      ) : null}

      {live ? (
        <>
          <ProbeCard result={live} />
          <div
            style={{
              background: "#fff",
              border: "1px solid #d7d8dc",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 10,
              fontSize: 13,
            }}
          >
            <strong>X-RateLimit-Remaining:</strong>{" "}
            {live.rateLimitRemaining ?? <em style={{ color: "#b3261e" }}>not returned</em>}
            {Object.keys(live.rateLimitHeaders).length > 0 ? (
              <pre style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                {JSON.stringify(live.rateLimitHeaders, null, 2)}
              </pre>
            ) : null}
          </div>
          {live.rows.length > 0 ? <RowsTable rows={live.rows} /> : null}
        </>
      ) : null}
    </main>
  );
}
