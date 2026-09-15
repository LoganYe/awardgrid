/**
 * The host half of step 7's e2e driver (apps/ios/src/probes/e2e-driver.ts). Node, no dependencies.
 *
 *   node e2e-host.mjs --log <probe-log.jsonl> --udid <simulator UDID> --shots <dir> --mock <mock-seats.out> --after <seq>
 *
 * run-probes.sh --e2e starts it in the background for one Simulator and stops it by its PID. It follows the probe
 * server's log, and for each app post logged after --after that asks the host for something:
 *
 *   host:shot:NAME       xcrun simctl io <UDID> screenshot <shots>/NAME.png
 *   host:mocklines:NAME  the number of lines in the seats.aero mock's log, so a scenario's requests can be cut out of it
 *
 * it does that and then POSTs /host-done?name=NAME with what it found, which the app is polling for. It never taps,
 * never touches the host desktop, and addresses the Simulator only by UDID.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, readSync, closeSync, readFileSync, statSync, fstatSync } from "node:fs";
import path from "node:path";

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) out[args[i].replace(/^--/, "")] = args[i + 1];
  return out;
}

const opts = flags(process.argv.slice(2));
for (const key of ["log", "udid", "shots", "mock"]) {
  if (!opts[key]) {
    console.error(`e2e-host: --${key} is required`);
    process.exit(2);
  }
}
const SERVER = opts.server ?? "http://127.0.0.1:4599";
const AFTER = Number(opts.after ?? 0);
mkdirSync(opts.shots, { recursive: true });

let offset = 0;
let carry = "";
const handled = new Set();
let stopping = false;

function lines(file) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function done(name, fields) {
  const query = new URLSearchParams({ name, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${SERVER}/host-done?${query.toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /host-done answered ${res.status}`);
}

async function handle(entry) {
  const match = /^host:(shot|mocklines):(.+)$/.exec(entry.probe ?? "");
  if (!match || handled.has(entry.seq)) return;
  handled.add(entry.seq);
  const [, action, name] = match;
  if (action === "shot") {
    const file = path.join(opts.shots, `${name}.png`);
    let fields;
    try {
      execFileSync("xcrun", ["simctl", "io", opts.udid, "screenshot", file], { stdio: "ignore", timeout: 60_000 });
      fields = { action, file: path.basename(file), bytes: statSync(file).size, udid: opts.udid };
    } catch (err) {
      fields = { action, error: String(err?.message ?? err).slice(0, 200), udid: opts.udid };
    }
    await done(name, fields);
    return;
  }
  await done(name, { action, mock_lines: lines(opts.mock) });
}

function readNew() {
  let fd;
  try {
    fd = openSync(opts.log, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return [];
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    offset = size;
    const text = carry + buffer.toString("utf8");
    const parts = text.split("\n");
    carry = parts.pop() ?? "";
    return parts.filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } finally {
    closeSync(fd);
  }
}

async function loop() {
  while (!stopping) {
    for (const entry of readNew()) {
      if (entry.seq > AFTER && entry.event === "app") {
        try {
          await handle(entry);
        } catch (err) {
          console.error(`e2e-host: ${entry.probe}: ${err?.message ?? err}`);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    process.exit(0);
  });
}
console.log(`e2e-host: following ${opts.log} after seq ${AFTER} for ${opts.udid}`);
loop();
