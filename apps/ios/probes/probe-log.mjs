/**
 * Reads the probe server's log for run-probes.sh: waits for a condition in it, and summarises a run.
 * Node, no dependencies. It only reads the log file; it never talks to the app or the Simulator.
 *
 *   node probe-log.mjs wait <log> --after SEQ --app PROBE [--timeout S]
 *       an app result named PROBE, logged after SEQ
 *   node probe-log.mjs wait <log> --after SEQ --request TEXT [--label L] [--elapsed MS] [--timeout S]
 *       a request whose path contains TEXT (and whose queue label is L), logged after SEQ, and (with --elapsed) MS
 *       since the server logged it
 *   node probe-log.mjs wait <log> --after SEQ --verdict L [--timeout S]
 *       the server-completed or client-disconnected line of the request labelled L (step 7)
 *   node probe-log.mjs summary <log> [--json FILE]
 *       each probe's verdict and numbers, for the last armed run in the log
 *   node probe-log.mjs summary-e2e <log> --mock <mock-seats.out> [--shots DIR] [--json FILE]
 *       step 7 part B: each scenario's verdict and numbers (A3, A4, A5, E1-E8), from the whole log and the mock's log
 *
 * Waiting polls the file every 250 ms until the condition holds or the timeout passes (exit 1, "timeout").
 */
import { readFileSync, writeFileSync } from "node:fs";

function readEntries(file) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      out[args[i].slice(2)] = args[i + 1];
      i += 1;
    }
  }
  return out;
}

function wait(file, opts) {
  const after = Number(opts.after ?? 0);
  const deadline = Date.now() + Number(opts.timeout ?? 60) * 1000;
  const find = () => {
    const entries = readEntries(file).filter((e) => e.seq > after);
    if (opts.app) return entries.find((e) => e.event === "app" && e.probe === opts.app) ?? null;
    if (opts.verdict) return entries.find((e) => (e.event === "server-completed" || e.event === "client-disconnected") && e.label === opts.verdict) ?? null;
    if (opts.request) {
      const hit = entries.find(
        (e) => e.event === "request" && typeof e.path === "string" && e.path.includes(opts.request) && (opts.label === undefined || e.label === opts.label),
      );
      if (!hit) return null;
      if (opts.elapsed === undefined) return hit;
      return Date.now() >= Date.parse(hit.at) + Number(opts.elapsed) ? hit : null;
    }
    throw new Error("wait needs --app, --verdict or --request");
  };
  const poll = () => {
    const hit = find();
    if (hit) {
      console.log(JSON.stringify({ seq: hit.seq, at: hit.at, event: hit.event, probe: hit.probe ?? null, path: hit.path ?? null }));
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      console.error(`timeout waiting for ${JSON.stringify(opts)}`);
      process.exit(1);
    }
    setTimeout(poll, 250);
  };
  poll();
}

// ---- Summary ----

const near = (value, target, tolerance) => typeof value === "number" && Math.abs(value - target) <= tolerance;

function summary(file, opts) {
  const all = readEntries(file);
  const arm = all.filter((e) => e.event === "host-arm").at(-1);
  if (!arm) {
    console.log("no armed run in this log");
    return;
  }
  const run = all.filter((e) => e.seq >= arm.seq);
  const app = (probe) => run.filter((e) => e.event === "app" && e.probe === probe).at(-1) ?? null;
  const requests = (predicate) => run.filter((e) => e.event === "request" && predicate(e));
  const verdict = (request) =>
    request ? (run.find((e) => (e.event === "server-completed" || e.event === "client-disconnected") && e.req === request.seq) ?? null) : null;
  const pathHas = (text) => (e) => typeof e.path === "string" && e.path.includes(text);
  const results = [];
  const add = (id, pass, numbers, evidence) => results.push({ id, pass, numbers, evidence: evidence.filter(Boolean).map((e) => e.seq) });

  const a0 = app("A0");
  const a0Requests = requests(pathHas("/log?probe=A0"));
  add(
    "A0",
    a0?.pass === true,
    a0 ? { ip: a0.values.ip, localhost: a0.values.localhost, server_stacks: a0Requests.map((r) => ({ seq: r.seq, path: r.path, stack: r.stack })) } : "no A0 result",
    [a0, ...a0Requests],
  );

  const t1 = app("T1");
  const dripReq = requests((e) => pathHas("/drip")(e) && pathHas("probe=T1")(e))[0];
  const slowReq = requests((e) => pathHas("/slow")(e) && pathHas("probe=T1")(e))[0];
  const dripVerdict = verdict(dripReq);
  const slowVerdict = verdict(slowReq);
  add(
    "T1",
    dripVerdict?.event === "server-completed" &&
      near(dripVerdict.completed_after_ms, 18_000, 1_000) &&
      t1?.values?.drip?.bytes === 10_240 &&
      slowVerdict?.event === "client-disconnected" &&
      near(slowVerdict.disconnected_after_ms, 5_000, 150),
    {
      drip_server: dripVerdict && { event: dripVerdict.event, ms: dripVerdict.completed_after_ms ?? dripVerdict.disconnected_after_ms, chunks: dripVerdict.chunks_written, bytes: dripVerdict.bytes_written },
      drip_js: t1?.values?.drip ?? null,
      control_server: slowVerdict && { event: slowVerdict.event, ms: slowVerdict.disconnected_after_ms ?? slowVerdict.completed_after_ms },
      control_js: t1?.values?.control ?? null,
    },
    [t1, dripReq, dripVerdict, slowReq, slowVerdict],
  );

  const t2 = app("T2");
  const t2Req = requests((e) => e.label === "T2" && e.method === "POST")[0];
  const t2Verdict = verdict(t2Req);
  const t2Server = t2Req
    ? {
        origin: t2Req.origin,
        sec_fetch: t2Req.sec_fetch,
        user_agent: t2Req["user-agent"],
        content_type: t2Req["content-type"],
        anthropic_version: t2Req["anthropic-version"],
        x_api_key_length: t2Req.x_api_key_length,
        body_length: t2Req.body_length,
        body_sha256: t2Req.body_sha256,
        messages_length: t2Req.messages_length,
      }
    : null;
  const t2ServerPass =
    t2Server !== null &&
    t2Server.origin === null &&
    Object.keys(t2Server.sec_fetch ?? {}).length === 0 &&
    t2Server.user_agent === "Anthropic/JS 0.123.0" &&
    t2Server.content_type === "application/json" &&
    t2Server.anthropic_version === "2023-06-01" &&
    t2Server.x_api_key_length === 27 &&
    t2Server.body_sha256 === t2?.values?.js_body_sha256;
  add(
    "T2",
    t2?.pass === true && t2ServerPass,
    {
      js: t2?.values ?? null,
      server: t2Server,
      body_sha256_equal: t2Server !== null && t2Server.body_sha256 === t2?.values?.js_body_sha256,
      stream: t2Verdict && { event: t2Verdict.event, ms: t2Verdict.completed_after_ms ?? t2Verdict.disconnected_after_ms, events: t2Verdict.events_written, pings: t2Verdict.pings_written },
    },
    [t2, t2Req, t2Verdict],
  );

  const t2b = app("T2b");
  const t2bReqs = requests(pathHas("probe=T2b"));
  const t2bWebview = t2bReqs.some((e) => e.origin === "capacitor://localhost" || Object.keys(e.sec_fetch ?? {}).length > 0);
  add(
    "T2b",
    t2bWebview || (t2bReqs.length === 0 && t2Req !== undefined),
    { js: t2b?.values ?? null, server: t2bReqs.map((e) => ({ seq: e.seq, method: e.method, origin: e.origin, sec_fetch: e.sec_fetch, user_agent: e["user-agent"], preflight: e.preflight ?? false })) },
    [t2b, ...t2bReqs],
  );

  const t3 = app("T3");
  const t3Req = requests((e) => e.label === "T3")[0];
  add("T3", t3?.pass === true, t3?.values ?? "no T3 result", [t3, t3Req, verdict(t3Req)]);

  const t4 = app("T4");
  const t4Req = requests((e) => e.label === "T4")[0];
  const t4Verdict = verdict(t4Req);
  add(
    "T4",
    t4?.pass === true,
    { js: t4?.values ?? null, server: t4Verdict && { event: t4Verdict.event, ms: t4Verdict.completed_after_ms ?? t4Verdict.disconnected_after_ms, events: t4Verdict.events_written } },
    [t4, t4Req, t4Verdict],
  );

  const a1b = app("A1b");
  add("A1b", a1b?.pass === true, a1b?.values ?? "no A1b result", [a1b]);

  const a2 = app("A2");
  add("A2", a2?.pass === true, a2?.values ?? "no A2 result", [a2]);

  const x1 = app("X1");
  add("X1", x1?.pass === true, x1?.values ?? "no X1 result", [x1]);

  const t5 = app("T5");
  const t5Req = requests((e) => pathHas("/drip")(e) && pathHas("probe=T5")(e))[0];
  const t5Verdict = verdict(t5Req);
  const marks = run.filter((e) => e.event === "host-mark" && typeof e.label === "string" && e.label.startsWith("T5"));
  const fromDrip = (e) => (t5Req && e ? Date.parse(e.at) - Date.parse(t5Req.at) : null);
  add(
    "T5",
    t5?.pass === true,
    {
      js: t5?.values ?? null,
      server: t5Verdict && { event: t5Verdict.event, ms: t5Verdict.completed_after_ms ?? t5Verdict.disconnected_after_ms, chunks: t5Verdict.chunks_written },
      host_marks_ms_after_drip_request: marks.map((m) => ({ label: m.label, ms: fromDrip(m) })),
    },
    [t5, t5Req, t5Verdict, ...marks],
  );

  for (const r of results) console.log(`${r.id.padEnd(4)} ${r.pass ? "PASS" : "FAIL"}  ${JSON.stringify(r.numbers)}\n      evidence seq: ${r.evidence.join(", ")}`);
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify({ arm_seq: arm.seq, results }, null, 2)}\n`);
}

// ---- Step 7 part B: the e2e scenarios ----

/** Sentences from apps/ios/src/ask/labels.ts and core errors.ts that the verdicts look for, verbatim. */
const COPY = {
  noAnthropicKey: "Ask needs your own Anthropic API key. Add one in Settings. Search and watches work without it.",
  attribution: "Data: seats.aero",
  footer: "Data: seats.aero · your own keys, on this device",
  stoppedDuringRequest: "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.",
  unfinished: "This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed.",
  overloaded: "Anthropic is overloaded and did not answer.",
  spendLead: "Anthropic refused the request because your organization reached its spend limit",
  rateWait: "Anthropic asks to wait 7 seconds before trying again.",
};

/** One line of scripts/mock-seatsaero.ts's log: "GET /partnerapi/search?… 200 3ms". */
function mockRequests(mockFile, from, to) {
  let text = "";
  try {
    text = readFileSync(mockFile, "utf8");
  } catch {
    return null;
  }
  return text
    .split("\n")
    .filter(Boolean)
    .slice(from ?? 0, to ?? undefined)
    .flatMap((line) => {
      const m = /^(GET|POST) (\S+) (\d{3}) (\d+)ms$/.exec(line.trim());
      if (!m) return [];
      const url = new URL(m[2], "http://mock");
      // The harness's own readiness polls are not the app's requests.
      if (!url.pathname.startsWith("/partnerapi/")) return [];
      return [{ method: m[1], path: url.pathname, params: Object.fromEntries(url.searchParams), status: Number(m[3]), line: line.trim() }];
    });
}

/** Whether the mock saw exactly the planned requests: the same count, path and query parameters, in order. */
function matchesPlan(planned, seen) {
  if (!planned || !Array.isArray(planned.requests) || !seen) return false;
  // One request per planned request: the demo data never has a second page (hasMore is false below 1,000 rows).
  const expected = planned.requests;
  if (expected.length !== seen.length) return false;
  return expected.every((r, i) => {
    const got = seen[i];
    const path = r.kind === "search" ? "/partnerapi/search" : "/partnerapi/availability";
    if (got.path !== path) return false;
    return Object.entries(r.params).every(([key, value]) => String(Array.isArray(value) ? value.join(",") : value) === got.params[key]);
  });
}

function summaryE2E(file, opts) {
  const all = readEntries(file);
  const results = [];
  const add = (id, pass, numbers, evidence) => results.push({ id, pass, numbers, evidence: evidence.filter(Boolean).map((e) => e.seq) });
  const app = (probe) => all.filter((e) => e.event === "app" && e.probe === probe).at(-1) ?? null;
  const values = (probe) => app(probe)?.values ?? null;
  const hostDone = (name) => all.filter((e) => e.event === "host-done" && e.name === name).at(-1) ?? null;
  const mark = (label) => all.filter((e) => e.event === "host-mark" && e.label === label).at(-1) ?? null;
  const labelled = (label) => all.filter((e) => e.event === "request" && e.label === label);
  const verdictOf = (request) => (request ? (all.find((e) => (e.event === "server-completed" || e.event === "client-disconnected") && e.req === request.seq) ?? null) : null);
  const errorOf = (request) => (request ? (all.find((e) => e.event === "error-response" && e.req === request.seq) ?? null) : null);
  const arm = (phase) => all.filter((e) => e.event === "host-arm" && e.phase === phase).at(-1) ?? null;
  const between = (from, to) => all.filter((e) => e.seq > (from?.seq ?? Infinity) && e.seq < (to?.seq ?? Infinity));
  const anthropicRequests = (entries) => entries.filter((e) => e.event === "request" && typeof e.path === "string" && e.path.startsWith("/sse/"));
  const mockBetween = (before, after) => mockRequests(opts.mock, Number(hostDone(before)?.mock_lines ?? NaN), Number(hostDone(after)?.mock_lines ?? NaN));
  const shotOk = (name) => {
    const done = hostDone(name);
    return done !== null && !done.error && Number(done.bytes) > 0;
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- A3 ----
  {
    const ask = values("A3-ask");
    const search = values("A3-search");
    const phaseStart = arm("a3");
    const phaseEnd = app("phase-done:a3");
    const sent = anthropicRequests(between(phaseStart, phaseEnd));
    const seats = mockBetween("a3-search-before", "a3-search-after");
    const askPass = ask !== null && ask.anthropic_key_on_file === false && ask.composer_disabled === true && ask.ask_button?.disabled === true && (ask.alerts ?? []).some((a) => (a.text ?? "").includes(COPY.noAnthropicKey));
    const searchPass = search !== null && search.table === true && search.cells_with_miles > 0 && search.anthropic_key_on_file === false;
    add(
      "A3",
      askPass && searchPass && sent.length === 0 && shotOk("a3-ask-no-anthropic-key") && shotOk("a3-search-grid"),
      {
        ask: ask && { anthropic_key_on_file: ask.anthropic_key_on_file, composer_disabled: ask.composer_disabled, ask_button: ask.ask_button, alerts: ask.alerts, suggestions_disabled: ask.suggestions_disabled },
        requests_to_the_probe_anthropic_route_during_a3: sent.length,
        search: search && { table: search.table, rows: search.rows, columns: search.columns.length, cells: search.cells_total, cells_with_miles: search.cells_with_miles, calls_line: search.calls_line, quota_line: search.quota_line, alerts: search.alerts },
        mock: seats && seats.map((r) => r.line),
      },
      [phaseStart, app("A3-ask"), app("A3-search"), hostDone("a3-ask-no-anthropic-key"), hostDone("a3-search-grid"), phaseEnd],
    );
  }

  // ---- A4, per device ----
  for (const device of ["17pro", "se"]) {
    const dom = (state) => all.filter((e) => e.event === "app" && e.probe === `dom:a4-${device}-${state}`).at(-1) ?? null;
    const states = ["settings-anthropic", "ask-idle", "nav-working", "ask-running-entry", "ask-answered", "ask-answered-entry", "footer"];
    const facts = Object.fromEntries(states.map((s) => [s, dom(s)?.values ?? null]));
    const present = states.filter((s) => facts[s] !== null);
    const nav = facts["nav-working"];
    const navTexts = nav ? nav.nav.map((n) => n.text) : [];
    const navClipped = nav ? nav.nav.filter((n) => n.box.left < 0 || n.box.right > nav.viewport.innerWidth + 0.5) : null;
    const scroll = Object.fromEntries(present.map((s) => [s, { scrollWidth: facts[s].scroll.scrollWidth, clientWidth: facts[s].scroll.clientWidth, max_right: facts[s].max_right, beyond_viewport: facts[s].beyond_viewport.length }]));
    const noHorizontalScroll = present.length === states.length && present.every((s) => facts[s].scroll.scrollWidth <= facts[s].scroll.clientWidth);
    const nothingBeyond = present.every((s) => facts[s].beyond_viewport.length === 0);
    const footer = facts.footer?.footer ?? null;
    // The controls the step 7 spec names for 44 pt (§6.5): every button, link-as-button, field and the checkbox row on Ask
    // and in Settings' Anthropic section. The nav links are measured and reported apart: the spec does not name them.
    const targets = new Map();
    const navTargets = new Map();
    for (const s of present) {
      for (const t of facts[s].targets) {
        if (t.box.width === 0 && t.box.height === 0) continue;
        if ((t.className ?? "").includes("ag-nav-link")) {
          const key = t.name;
          const prev = navTargets.get(key);
          if (!prev || t.box.width < prev.width) navTargets.set(key, { state: s, name: t.name, width: t.box.width, height: t.box.height });
          continue;
        }
        const key = `${t.role}|${t.name}|${t.className}`;
        const prev = targets.get(key);
        if (!prev || t.box.height < prev.height) targets.set(key, { state: s, role: t.role, name: t.name, className: t.className, width: t.box.width, height: t.box.height });
      }
    }
    const measured = [...targets.values()];
    const under44 = measured.filter((t) => t.height < 44 || t.width < 44);
    const inlineLinks = present.flatMap((s) => facts[s].interactive.filter((i) => i.inline_link && i.rendered).map((i) => ({ state: s, name: i.name, height: i.box.height })));
    // Every other rendered control under 44 pt in either dimension on the same photographed screens: the ones the named
    // set leaves out (Settings' older seats.aero and cache controls, the Search screen's). They do not decide A4, and are
    // listed so a report cannot read as if they were measured. A checkbox whose own label row was measured is marked.
    const notJudged = (state, v) => {
      const named = new Set(v.targets.map((t) => `${t.role}|${t.name}`));
      const rows = new Set(v.targets.filter((t) => t.role === "label").map((t) => t.name));
      return v.interactive
        .filter((i) => i.rendered && !i.inline_link && !(i.className ?? "").includes("ag-nav-link") && !named.has(`${i.role}|${i.name}`))
        .filter((i) => i.box.width < 44 || i.box.height < 44)
        .map((i) => ({ state, role: i.role, name: i.name, width: i.box.width, height: i.box.height, ...(i.role === "checkbox" && rows.has(i.name) ? { inside_measured_label_row: true } : {}) }));
    };
    const dedupe = (list) => {
      const seen = new Map();
      for (const t of list) {
        const key = `${t.role}|${t.name}|${t.width}|${t.height}`;
        if (!seen.has(key)) seen.set(key, { ...t, states: [t.state] });
        else seen.get(key).states.push(t.state);
      }
      return [...seen.values()].map(({ state: _state, ...t }) => t);
    };
    const notJudgedUnder44 = dedupe(present.flatMap((s) => notJudged(s, facts[s])));
    // The same named controls in the states E1-E8 and A5 photographed (all on the iPhone 17 Pro): Try again, Ask again,
    // Open Settings and New conversation appear only there. Reported beside the verdict, which A4's four states decide.
    const others = new Map();
    let otherNotJudged = [];
    if (device === "17pro") {
      const otherDoms = all.filter((e) => e.event === "app" && typeof e.probe === "string" && e.probe.startsWith("dom:") && !e.probe.startsWith("dom:a4-"));
      otherNotJudged = dedupe(otherDoms.flatMap((d) => notJudged(d.probe.slice(4), d.values)));
      for (const d of otherDoms) {
        for (const t of d.values.targets) {
          if ((t.className ?? "").includes("ag-nav-link") || (t.box.width === 0 && t.box.height === 0)) continue;
          const key = `${t.role}|${t.name}`;
          const prev = others.get(key);
          if (!prev || t.box.height < prev.height || t.box.width < prev.width) others.set(key, { state: d.probe.slice(4), role: t.role, name: t.name, width: t.box.width, height: t.box.height });
        }
      }
    }
    add(
      `A4-${device}`,
      present.length === states.length &&
        navTexts.includes("Ask (working)") &&
        navTexts.includes("Watches (12)") &&
        navClipped.length === 0 &&
        nav.header.scrollWidth <= nav.header.clientWidth &&
        noHorizontalScroll &&
        footer !== null &&
        footer.in_viewport === true &&
        footer.text === COPY.footer &&
        under44.length === 0 &&
        states.every((s) => shotOk(`a4-${device}-${s}`)),
      {
        viewport: nav?.viewport ?? null,
        nav: nav && { texts: navTexts, rows: nav.nav_rows, boxes: nav.nav.map((n) => ({ text: n.text, ...n.box })), header: nav.header, clipped: navClipped },
        scroll,
        nothing_beyond_viewport: nothingBeyond,
        footer,
        targets_measured: measured.length,
        smallest_target: measured.reduce((min, t) => (min === null || t.height < min.height ? t : min), null),
        under_44: under44,
        targets: measured,
        nav_links_not_named_by_the_spec: [...navTargets.values()],
        nav_links_under_44: [...navTargets.values()].filter((t) => t.width < 44 || t.height < 44),
        inline_links_not_targets: inlineLinks,
        not_named_by_the_spec_under_44: notJudgedUnder44,
        other_states_targets: [...others.values()],
        other_states_under_44: [...others.values()].filter((t) => t.width < 44 || t.height < 44),
        other_states_not_named_under_44: otherNotJudged,
        missing_states: states.filter((s) => facts[s] === null),
      },
      [...states.map((s) => dom(s)), ...states.map((s) => hostDone(`a4-${device}-${s}`))],
    );
  }

  // ---- A5: every interactive element's name and role, and the status region, per state ----
  {
    const doms = all.filter((e) => e.event === "app" && typeof e.probe === "string" && e.probe.startsWith("dom:"));
    const latest = new Map();
    for (const d of doms) latest.set(d.probe, d);
    const perState = [...latest.values()].map((d) => {
      const rendered = d.values.interactive.filter((i) => i.rendered);
      const names = rendered.map((i) => i.name);
      const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      return {
        state: d.probe.slice(4),
        href: d.values.href,
        interactive: rendered.map((i) => `${i.role}: ${i.name || "(no name)"}${i.disabled ? " [disabled]" : ""}`),
        unnamed: rendered.filter((i) => !i.name).length,
        duplicate_names: duplicates,
        status_regions: d.values.status_regions,
        alerts: d.values.alerts,
        busy: d.values.busy,
      };
    });
    const askStates = perState.filter((s) => s.href === "#/ask");
    const named = (state, text) => (perState.find((s) => s.state === state)?.interactive ?? []).filter((i) => i.endsWith(`: ${text}`) || i.includes(`: ${text} [`)).length;
    add(
      "A5",
      perState.length > 0 && perState.every((s) => s.unnamed === 0) && askStates.every((s) => s.status_regions.filter((r) => (r.className ?? "").includes("sr-only")).length === 1),
      {
        states_recorded: perState.length,
        open_settings_links_with_no_keys: named("a5-ask-no-keys", "Open Settings"),
        new_conversation_buttons_after_too_large: named("a5-too-large", "New conversation"),
        states: perState,
      },
      doms,
    );
  }

  // ---- E1 ----
  {
    const e1 = values("E1");
    const before = values("E1-before");
    const after = values("E1-search-quota");
    const seen = mockBetween("e1-before", "e1-after");
    const step = e1?.entry?.steps?.[0] ?? null;
    const r1 = labelled("E1-r1")[0] ?? null;
    const r2 = labelled("E1-r2")[0] ?? null;
    const stepPass = step !== null && /^Searched seats\.aero: .+\. 1 call\.$/.test(step.label) && e1.dom?.steps?.[0] === step.label;
    const answerPass = (e1?.dom?.answers?.[0] ?? "").startsWith("The cheapest business seats in this search are on Alaska") && e1.dom.attribution === COPY.attribution && e1.dom.attribution_after_answer === true && e1.entry.end?.status === "answered";
    const planPass = matchesPlan(e1?.planned, seen);
    const quotaPass = before?.quota_line === "seats.aero calls today: 0 of 950" && after?.quota_line === "seats.aero calls today: 188 of 950";
    add(
      "E1",
      stepPass && answerPass && planPass && quotaPass && verdictOf(r1)?.event === "server-completed" && verdictOf(r2)?.event === "server-completed",
      {
        step: step && { label: step.label, calls: step.calls, outcome: step.outcome },
        dom_steps: e1?.dom?.steps ?? null,
        answer: e1?.dom?.answers ?? null,
        attribution: e1?.dom?.attribution ?? null,
        attribution_after_answer: e1?.dom?.attribution_after_answer ?? null,
        meta: e1?.dom?.meta ?? null,
        end: e1?.entry?.end ?? null,
        planned: e1?.planned ?? null,
        mock: seen && seen.map((r) => r.line),
        mock_matches_plan: planPass,
        quota_line_before: before?.quota_line ?? null,
        quota_line_after: after?.quota_line ?? null,
        requests: [r1, r2].map((r) => r && { seq: r.seq, label: r.label, stack: r.stack, messages_length: r.messages_length, verdict: verdictOf(r)?.event ?? null }),
      },
      [app("E1-before"), r1, verdictOf(r1), r2, verdictOf(r2), app("E1"), app("E1-search-quota")],
    );
  }

  // ---- E2 ----
  {
    const ask = values("E2-ask");
    const grid = values("E2-grid");
    const normal = values("E2-grid-normal-key");
    const r2 = labelled("E2-r2")[0] ?? null;
    const toolResults = (r2?.message_summaries ?? []).flatMap((m) => m.blocks.filter((b) => b.type === "tool_result"));
    const fields = toolResults[0]?.fields ?? null;
    const listed = fields ? (fields.unmonitored?.length ?? 0) + (fields.not_read_in_full?.length ?? 0) : 0;
    add(
      "E2",
      listed > 0 && (grid?.not_monitored ?? 0) > 0 && (grid?.not_checked ?? 0) > 0,
      {
        ask_step: ask?.entry?.steps?.[0] ?? null,
        tool_result_fields: fields,
        grid_partial_key: grid && { query: grid.query, table: grid.table, not_monitored: grid.not_monitored, not_checked: grid.not_checked, dash: grid.dash, cells: grid.cells_total, rows: grid.rows, grid_message: grid.grid_message, alerts: grid.alerts },
        grid_partial_mock: (mockBetween("e2-grid-before", "e2-grid-after") ?? []).map((r) => r.line),
        grid_normal_key: normal && { table: normal.table, not_monitored: normal.not_monitored, not_checked: normal.not_checked, dash: normal.dash, cells: normal.cells_total, rows: normal.rows, grid_message: normal.grid_message, alerts: normal.alerts },
        grid_normal_mock_count: (mockBetween("e2-grid-normal-before", "e2-grid-normal-after") ?? []).length,
        ask_mock: (mockBetween("e2-ask-before", "e2-ask-after") ?? []).map((r) => r.line),
      },
      [labelled("E2-r1")[0], r2, app("E2-ask"), app("E2-grid"), app("E2-grid-normal-key")],
    );
  }

  // ---- E3 ----
  {
    const stop = values("E3-stop");
    const relaunch = values("E3-relaunch");
    const q2r1 = labelled("E3-q2-r1")[0] ?? null;
    const q2r2 = labelled("E3-q2-r2")[0] ?? null;
    const q3 = labelled("E3-q3")[0] ?? null;
    const v2 = verdictOf(q2r2);
    const end = stop?.entry?.end ?? null;
    const stopPass = end?.status === "stopped" && end.stoppedDuring === "request" && end.committed === false && (stop.dom?.ending ?? []).includes(COPY.stoppedDuringRequest);
    const restored = relaunch?.entries ?? [];
    const relaunchPass = restored.length === 2 && restored[1]?.end?.status === "stopped" && restored[1]?.end?.committed === false;
    const n = q2r1?.messages_length ?? 0;
    const hashPass =
      q2r1 !== null &&
      q3 !== null &&
      q3.messages_length === n &&
      eq(q3.message_sha256.slice(0, n - 1), q2r1.message_sha256.slice(0, n - 1)) &&
      q3.message_sha256[n - 1] !== q2r1.message_sha256[n - 1] &&
      q3.system_sha256 === q2r1.system_sha256 &&
      q3.tools_sha256 === q2r1.tools_sha256;
    add(
      "E3",
      stopPass && v2?.event === "server-completed" && relaunchPass && hashPass && values("E3-q3")?.entry?.end?.status === "answered",
      {
        stop: stop && { request_started_at: stop.request_started_at, stop_at: stop.stop_at, end, ending: stop.dom?.ending },
        stopped_request_server: v2 && { event: v2.event, ms: v2.completed_after_ms ?? v2.disconnected_after_ms, events: v2.events_written },
        after_relaunch: restored.map((e) => ({ question: e.question, status: e.end?.status, committed: e.end?.committed })),
        q2_first_request: q2r1 && { seq: q2r1.seq, messages_length: q2r1.messages_length, message_sha256: q2r1.message_sha256, roles: (q2r1.message_summaries ?? []).map((m) => m.role) },
        q3_first_request: q3 && { seq: q3.seq, messages_length: q3.messages_length, message_sha256: q3.message_sha256, roles: (q3.message_summaries ?? []).map((m) => m.role) },
        system_tools_equal: q2r1 !== null && q3 !== null && q3.system_sha256 === q2r1.system_sha256 && q3.tools_sha256 === q2r1.tools_sha256,
        q3_end: values("E3-q3")?.entry?.end ?? null,
      },
      [labelled("E3-q1")[0], q2r1, q2r2, v2, app("E3-stop"), mark("E3:host-terminates"), app("E3-relaunch"), q3, app("E3-q3")],
    );
  }

  // ---- E4 ----
  {
    const failed = values("E4-failed");
    const retried = values("E4-retried");
    const r1 = labelled("E4-r1")[0] ?? null;
    const r2 = labelled("E4-r2")[0] ?? null;
    const actions = (failed?.dom?.actions ?? []).map((a) => a.name);
    add(
      "E4",
      failed?.entry?.end?.failure?.code === "overloaded" &&
        (failed.dom?.failure?.[0]?.text ?? "").includes(COPY.overloaded) &&
        actions.includes("Try again") &&
        failed.is_retry_entry === true &&
        errorOf(r1)?.status === 529 &&
        r2 !== null &&
        r2.body_sha256 === r1.body_sha256 &&
        retried?.entry?.end?.status === "answered" &&
        (retried.dom?.answers?.length ?? 0) > 0,
      {
        failure: failed?.entry?.end?.failure ?? null,
        failure_dom: failed?.dom?.failure ?? null,
        actions: failed?.dom?.actions ?? null,
        hint: failed?.dom?.hint ?? null,
        first: r1 && { seq: r1.seq, status: errorOf(r1)?.status ?? null, body_sha256: r1.body_sha256, body_length: r1.body_length },
        resend: r2 && { seq: r2.seq, body_sha256: r2.body_sha256, body_length: r2.body_length, verdict: verdictOf(r2)?.event ?? null },
        body_sha256_equal: r1 !== null && r2 !== null && r1.body_sha256 === r2.body_sha256,
        after_retry: retried && { end: retried.entry?.end, requests: retried.entry?.usage?.requests, answers: retried.dom?.answers },
      },
      [r1, errorOf(r1), app("E4-failed"), r2, verdictOf(r2), app("E4-retried")],
    );
  }

  // ---- E5 ----
  {
    const spend = values("E5-spend");
    const rate = values("E5-rate");
    const spendReqs = labelled("E5-spend");
    const rateReqs = labelled("E5-rate");
    const spendStart = spendReqs[0] ?? null;
    const nextReset = all.find((e) => e.event === "reset" && e.seq > (spendStart?.seq ?? Infinity)) ?? null;
    const anthropicAfterSpend = anthropicRequests(between(spendStart, nextReset)).length + (spendStart ? 1 : 0);
    const spendActions = (spend?.dom?.actions ?? []).map((a) => a.name);
    const rateActions = (rate?.dom?.actions ?? []).map((a) => a.name);
    add(
      "E5",
      spend?.entry?.end?.failure?.code === "spend_limit" &&
        (spend.dom?.failure?.[0]?.text ?? "").includes(COPY.spendLead) &&
        spendReqs.length === 1 &&
        anthropicAfterSpend === 1 &&
        !spendActions.includes("Try again") &&
        rate?.entry?.end?.failure?.code === "rate_limited" &&
        (rate.dom?.failure?.[0]?.text ?? "").includes(COPY.rateWait) &&
        rateActions.includes("Try again") &&
        rateReqs.length === 1,
      {
        spend: spend && { failure: spend.entry?.end?.failure, dom: spend.dom?.failure, actions: spend.dom?.actions, requests_labelled: spendReqs.length, anthropic_requests_until_next_reset: anthropicAfterSpend, server: spendReqs.map((r) => errorOf(r)) },
        rate: rate && { failure: rate.entry?.end?.failure, dom: rate.dom?.failure, actions: rate.dom?.actions, hint: rate.dom?.hint, requests_labelled: rateReqs.length, server: rateReqs.map((r) => errorOf(r)) },
      },
      [...spendReqs, ...spendReqs.map(errorOf), app("E5-spend"), ...rateReqs, ...rateReqs.map(errorOf), app("E5-rate")],
    );
  }

  // ---- E6 ----
  {
    const q1r1 = labelled("E6-q1-r1")[0] ?? null;
    const q1r2 = labelled("E6-q1-r2")[0] ?? null;
    const q2r1 = labelled("E6-q2-r1")[0] ?? null;
    const e6 = values("E6");
    const n = q1r2?.messages_length ?? 0;
    const finalAssistant = q2r1?.message_summaries?.[n] ?? null;
    const answerHead = (e6?.q1?.texts ?? []).at(-1)?.slice(0, 60) ?? null;
    const pass =
      q1r1 !== null &&
      q1r2 !== null &&
      q2r1 !== null &&
      q2r1.system_sha256 === q1r1.system_sha256 &&
      q2r1.system_sha256 === q1r2.system_sha256 &&
      q2r1.tools_sha256 === q1r1.tools_sha256 &&
      q2r1.tools_sha256 === q1r2.tools_sha256 &&
      q2r1.messages_length === n + 2 &&
      eq(q2r1.message_sha256.slice(0, n), q1r2.message_sha256) &&
      finalAssistant?.role === "assistant" &&
      answerHead !== null &&
      (finalAssistant.blocks ?? []).some((b) => b.type === "text" && b.head.startsWith(answerHead)) &&
      q2r1.message_summaries?.[n + 1]?.role === "user" &&
      e6?.q1?.end?.committed === true;
    add(
      "E6",
      pass,
      {
        q1_requests: [q1r1, q1r2].map((r) => r && { seq: r.seq, messages_length: r.messages_length, system_sha256: r.system_sha256, tools_sha256: r.tools_sha256, message_sha256: r.message_sha256 }),
        q2_first_request: q2r1 && { seq: q2r1.seq, messages_length: q2r1.messages_length, system_sha256: q2r1.system_sha256, tools_sha256: q2r1.tools_sha256, message_sha256: q2r1.message_sha256, roles: (q2r1.message_summaries ?? []).map((m) => `${m.role}:${m.blocks.map((b) => b.type).join("+")}`) },
        prefix_equal: q1r2 !== null && q2r1 !== null && eq(q2r1.message_sha256.slice(0, n), q1r2.message_sha256),
        final_assistant_message: finalAssistant,
        q1_end: e6?.q1?.end ?? null,
        q2_end: e6?.q2?.end ?? null,
      },
      [q1r1, q1r2, q2r1, app("E6")],
    );
  }

  // ---- E7 ----
  {
    const e7 = values("E7");
    const r1 = labelled("E7-r1")[0] ?? null;
    const r2 = labelled("E7-r2")[0] ?? null;
    const leave = mark("E7:host-opens-Settings");
    const back = mark("E7:host-returns-to-awardgrid");
    const away = anthropicRequests(between(leave, back));
    const ms = (e) => (r1 && e ? Date.parse(e.at) - Date.parse(r1.at) : null);
    add(
      "E7",
      e7?.terminal_count === 1 && e7.entry?.end?.status === "answered" && leave !== null && back !== null && away.length === 0 && r2 !== null && r2.seq > back.seq,
      {
        terminal_count: e7?.terminal_count ?? null,
        terminals: e7?.terminals ?? null,
        end: e7?.entry?.end ?? null,
        steps: e7?.entry?.steps?.map((s) => s.label) ?? null,
        visibility: e7?.visibility ?? null,
        activity: e7?.activity ?? null,
        host_ms_after_first_request: { leave: ms(leave), back: ms(back), second_request: ms(r2) },
        requests_logged_while_away: away.map((e) => ({ seq: e.seq, label: e.label })),
        first_request_server: verdictOf(r1) && { event: verdictOf(r1).event, ms: verdictOf(r1).completed_after_ms ?? verdictOf(r1).disconnected_after_ms, events: verdictOf(r1).events_written, pings: verdictOf(r1).pings_written },
      },
      [r1, leave, mark("E7:Settings-launch-returned"), back, mark("E7:awardgrid-launch-returned"), verdictOf(r1), r2, verdictOf(r2), app("E7")],
    );
  }

  // ---- E8 ----
  {
    const e8 = values("E8");
    const r = labelled("E8")[0] ?? null;
    const entry = e8?.entries?.[0] ?? null;
    const actions = e8?.dom?.actions ?? [];
    add(
      "E8",
      e8?.entries?.length === 1 && entry?.end?.status === "unfinished" && (e8.dom?.ending ?? []).includes(COPY.unfinished) && actions.some((a) => a.name === "Ask again" && a.disabled === false),
      {
        entry: entry && { question: entry.question, end: entry.end, usage: entry.usage },
        ending: e8?.dom?.ending ?? null,
        meta: e8?.dom?.meta ?? null,
        actions,
        request_server: verdictOf(r) && { event: verdictOf(r).event, ms: verdictOf(r).completed_after_ms ?? verdictOf(r).disconnected_after_ms, events: verdictOf(r).events_written },
        host_terminate_ms_after_request: r && mark("E8:host-terminates") ? Date.parse(mark("E8:host-terminates").at) - Date.parse(r.at) : null,
      },
      [app("e8_request_out"), r, mark("E8:host-terminates"), mark("E8:terminated"), verdictOf(r), app("E8")],
    );
  }

  const phases = all.filter((e) => e.event === "app" && typeof e.probe === "string" && e.probe.startsWith("phase-done:")).map((e) => ({ phase: e.probe.slice(11), pass: e.pass, error: e.values?.harness_error ?? null }));
  for (const r of results) console.log(`${r.id.padEnd(9)} ${r.pass ? "PASS" : "FAIL"}  ${JSON.stringify(r.numbers).slice(0, 1500)}\n          evidence seq: ${r.evidence.join(", ")}`);
  console.log(`phases: ${JSON.stringify(phases)}`);
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify({ phases, results }, null, 2)}\n`);
}

const [command, file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: node probe-log.mjs wait|summary|summary-e2e <log> [options]");
  process.exit(2);
}
if (command === "wait") wait(file, flags(rest));
else if (command === "summary") summary(file, flags(rest));
else if (command === "summary-e2e") summaryE2E(file, flags(rest));
else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
