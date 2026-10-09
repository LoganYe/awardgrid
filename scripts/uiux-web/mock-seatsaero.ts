/**
 * The UI/UX Web surface's stand-in for seats.aero (plan 04 T18; docs/02 D10). TEST-ONLY.
 *
 * The Web server's own seats.aero client is pointed here (SEATS_AERO_BASE_URL). Each fixture user's fake key names
 * its scenario ("uiux-web-user-a" → web-user-a), and the answer is that scenario's synthetic rows, through the very
 * transport the iOS fixture host uses (apps/ios/fixture-host/transports.ts), so both surfaces see the same data. Any
 * other key is refused. Nothing here reaches the network.
 *
 *   GET  /healthz   ready check for Playwright
 *   GET  /__log     requests seen, per scenario: { [scenario]: { seats, trips, seatsPaths } }
 *   POST /__reset   forget the log
 */
import { createServer } from "node:http";
import { environmentFor } from "../../apps/ios/fixture-host/scenarios";
import { syntheticSeatsFetch } from "../../apps/ios/fixture-host/transports";
import type { FixtureRequestLog } from "../../apps/ios/fixture-host/protocol";

const PORT = Number(process.env.UIUX_WEB_MOCK_PORT ?? 4331);
const KEY_PREFIX = "uiux-";
/** The seeded connection's Partner-Authorization value before its scenario key (e2e/users.ts SEEDED_ACCESS_PREFIX). */
const SEEDED_BEARER = "Bearer seats:ota:seeded-";
const logs = new Map<string, FixtureRequestLog>();

function logFor(scenario: string): FixtureRequestLog {
  let log = logs.get(scenario);
  if (!log) {
    log = { seats: 0, trips: 0, anthropic: 0, writes: 0, seatsPaths: [], directSeats: 0, directAnthropic: 0, anthropicContext: [], oauth: { consent: 0, token: 0, refresh: 0 } };
    logs.set(scenario, log);
  }
  return log;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/healthz") return void res.writeHead(200).end("ok");
  if (url.pathname === "/__log") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify(Object.fromEntries(logs)));
  }
  if (url.pathname === "/__reset" && req.method === "POST") {
    logs.clear();
    return void res.writeHead(204).end();
  }
  if (!url.pathname.startsWith("/partnerapi/")) return void res.writeHead(404).end();
  // The web app sends its seeded Login with Seats.aero token ("Bearer seats:ota:seeded-uiux-<scenario>",
  // scripts/seed-e2e.ts); the scenario key is what follows the prefix.
  const header = String(req.headers["partner-authorization"] ?? "");
  const key = header.startsWith(SEEDED_BEARER) ? header.slice(SEEDED_BEARER.length) : header;
  const scenario = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : "";
  let env;
  try {
    env = environmentFor(scenario);
  } catch {
    res.writeHead(401, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ error: "unknown fixture key" }));
  }
  const fetchImpl = syntheticSeatsFetch(env.rows, env.routes, logFor(scenario), env.searchMode);
  const response = await fetchImpl(`https://seats.aero${url.pathname}${url.search}`, { method: req.method, headers: { "partner-authorization": key } });
  res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" });
  res.end(await response.text());
});

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`uiux-web mock seats.aero on 127.0.0.1:${PORT}\n`));
