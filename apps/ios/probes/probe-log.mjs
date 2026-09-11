/**
 * Reads the probe server's log for run-probes.sh: waits for a condition in it, and summarises a run.
 * Node, no dependencies. It only reads the log file; it never talks to the app or the Simulator.
 *
 *   node probe-log.mjs wait <log> --after SEQ --app PROBE [--timeout S]
 *       an app result named PROBE, logged after SEQ
 *   node probe-log.mjs wait <log> --after SEQ --request TEXT [--elapsed MS] [--timeout S]
 *       a request whose path contains TEXT, logged after SEQ, and (with --elapsed) MS since the server logged it
 *   node probe-log.mjs summary <log> [--json FILE]
 *       each probe's verdict and numbers, for the last armed run in the log
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
    if (opts.request) {
      const hit = entries.find((e) => e.event === "request" && typeof e.path === "string" && e.path.includes(opts.request));
      if (!hit) return null;
      if (opts.elapsed === undefined) return hit;
      return Date.now() >= Date.parse(hit.at) + Number(opts.elapsed) ? hit : null;
    }
    throw new Error("wait needs --app or --request");
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

const [command, file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: node probe-log.mjs wait|summary <log> [options]");
  process.exit(2);
}
if (command === "wait") wait(file, flags(rest));
else if (command === "summary") summary(file, flags(rest));
else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
