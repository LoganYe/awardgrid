/**
 * GET|POST /api/ask/demo — a scripted, offline SSE stream framed exactly like POST /api/ask.
 *
 * Why it exists: the screenshot suite runs with no ANTHROPIC_API_KEY (e2e/README.md), so the real
 * ask lane can never stream and the streaming UI would be unphotographable. This route replays a
 * fixed, obviously synthetic answer at ~150 ms per delta so a screenshot can land mid-stream.
 *
 * It is inert unless the server runs with ASK_DEMO_STREAM=1: every other environment gets 404,
 * so nothing here can be reached in production. It touches no database, no key and no network,
 * and it is deliberately keyless — it can only ever return this file's own text.
 *
 *   ?probe=1                 → { demo: true } (the drawer checks the route exists)
 *   ?usage=1&after=N[&cap=1] → the usage shape of GET /api/ask/usage, N answers in
 *   ?cap=1                   → the budget error instead of a stream
 *   ?err=<code>              → that failure instead of a stream (no_key, timeout, plugin_missing…)
 *   (otherwise)              → init, text deltas, two tool events, result
 */
import { NextResponse, type NextRequest } from "next/server";
import { sseFrame, usageResponse } from "../wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Milliseconds between text deltas: slow enough that a mid-stream screenshot is reliable. */
export const DEMO_DELTA_MS = 150;
/** What the scripted answer "costs"; with the starting spend it makes the spec's $0.42. */
export const DEMO_ANSWER_USD = 0.31;
export const DEMO_START_USD = 0.11;
export const DEMO_CAP_USD = 2;

/**
 * The scripted answer, split the way a model streams it. Every number here is invented: it
 * matches fixtures/demo, not any real award (e2e/README.md: nothing on a screenshot is real).
 *
 * It deliberately exercises every block `components/ask/answer.tsx` can draw — heading, bold,
 * bullet list, ordered list, link, inline code and a fenced code block — because the screenshot
 * matrix is the record of how those render, and a script with only paragraphs and bullets left
 * four of them undocumented.
 */
export const DEMO_DELTAS: readonly string[] = [
  "## Cheapest first class on this grid\n\n",
  "The cheapest **F** cell on this grid is ",
  "SEA→NRT on Oct 15: 80,000 miles ",
  "plus $5.60 in fees, 2 seats, Alaska.\n\n",
  "Transfer paths into that program:\n\n",
  "- Bilt Rewards, 1:1, usually instant\n",
  "- Marriott Bonvoy, 3:1, up to two days\n",
  "- Capital One, no partner today\n\n",
  "Aeroplan wants 90,000 for the same seat, ",
  "so the 10,000-mile gap only pays off ",
  "if you already hold Aeroplan miles.\n\n",
  "What to do next:\n\n",
  "1. Hold the seat with the program by phone\n",
  "2. Transfer only after the hold is confirmed\n",
  "3. Re-check the fees on the booking page\n\n",
  "Ratios move: check `transfer-partners` for today's numbers, ",
  "and confirm the rules on [seats.aero](https://seats.aero/terms).\n\n",
  "```\npnpm grid \"SEA to NRT, Oct 15, first\"\n```\n\n",
  "Demo answer from a scripted stream. Nothing here was fetched.",
];

/**
 * The same answer in Chinese. Without it every answered zh screenshot showed an English answer
 * body under Chinese chrome, so the record proved nothing about CJK line-breaking, CJK line
 * height on the 20 px body grid, or zh list and inline-code rendering.
 */
export const DEMO_DELTAS_ZH: readonly string[] = [
  "## 本表格中最便宜的头等舱\n\n",
  "本表格中最便宜的**头等舱**是 ",
  "10 月 15 日的 SEA→NRT：80,000 里程，",
  "税费 $5.60，2 个座位，阿拉斯加航空。\n\n",
  "可以转入该里程计划的积分：\n\n",
  "- Bilt Rewards，1:1，通常实时到账\n",
  "- 万豪旅享家，3:1，最多两天\n",
  "- Capital One，目前不是合作伙伴\n\n",
  "同一个座位，枫叶积分需要 90,000 里程，",
  "因此这 10,000 里程的差距只有在你本来就持有枫叶积分时才划算。\n\n",
  "接下来该做的事：\n\n",
  "1. 先致电里程计划锁定座位\n",
  "2. 确认锁定成功后再转入积分\n",
  "3. 在出票页面再核对一次税费\n\n",
  "兑换比例会变动：今天的数字请查 `transfer-partners`，",
  "规则请以 [seats.aero](https://seats.aero/terms) 为准。\n\n",
  "```\npnpm grid \"SEA to NRT, Oct 15, first\"\n```\n\n",
  "这是脚本生成的演示回答，没有真实获取任何数据。",
];

/** Tool events, keyed to the delta index they follow. */
const DEMO_TOOLS: readonly { at: number; name: string }[] = [
  { at: 2, name: "seats-aero-cached-search" },
  { at: 5, name: "travel-hacker:transfer-partners" },
];

/** The script for a locale; anything that is not "zh" gets the English one. */
export function demoDeltas(locale: string | null): readonly string[] {
  return locale === "zh" ? DEMO_DELTAS_ZH : DEMO_DELTAS;
}

function enabled(): boolean {
  return process.env.ASK_DEMO_STREAM === "1";
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}

function demoUsage(after: number, cap: boolean): NextResponse {
  const spentUsd = cap ? DEMO_CAP_USD : Math.min(DEMO_CAP_USD, DEMO_START_USD + DEMO_ANSWER_USD * after);
  const body = usageResponse({ spentUsd, capUsd: DEMO_CAP_USD, remainingUsd: Math.max(0, DEMO_CAP_USD - spentUsd) });
  return NextResponse.json(body, { headers: NO_STORE });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** The failure states the scripted stream can act out (`?err=no_key`), mirrored in demo.ts. */
const DEMO_ERRORS: readonly string[] = ["no_key", "timeout", "plugin_missing", "budget", "sdk"];

function stream(request: NextRequest, cap: boolean, err: string | null, locale: string | null): Response {
  const encoder = new TextEncoder();
  const ac = new AbortController();
  request.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        if (ac.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(type, { type, ...data })));
        } catch {
          ac.abort(); // the client went away mid-frame
        }
      };
      send("init", { model: "demo-scripted-stream", skills: ["seats-aero", "transfer-partners"], mcp_servers: [] });
      if (err || cap) {
        await sleep(DEMO_DELTA_MS, ac.signal);
        send("error", { code: err ?? "budget", capUsd: DEMO_CAP_USD, message: "scripted demo failure" });
        controller.close();
        return;
      }
      const deltas = demoDeltas(locale);
      for (const [i, delta] of deltas.entries()) {
        await sleep(DEMO_DELTA_MS, ac.signal);
        if (ac.signal.aborted) break;
        for (const tool of DEMO_TOOLS) if (tool.at === i) send("tool", { name: tool.name });
        send("text", { text: delta });
      }
      if (!ac.signal.aborted) send("result", { costUsd: DEMO_ANSWER_USD, numTurns: 3, durationMs: DEMO_DELTA_MS * deltas.length, subtype: "success" });
      try {
        controller.close();
      } catch {
        // already closed by a cancel
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive", ...NO_STORE },
  });
}

function handle(request: NextRequest): Response {
  if (!enabled()) return notFound();
  const params = request.nextUrl.searchParams;
  const cap = params.get("cap") === "1";
  if (params.get("probe") === "1") return NextResponse.json({ demo: true }, { headers: NO_STORE });
  if (params.get("usage") === "1") {
    const after = Number.parseInt(params.get("after") ?? "0", 10);
    return demoUsage(Number.isFinite(after) && after > 0 ? Math.min(after, 20) : 0, cap);
  }
  const requested = params.get("err");
  const err = requested !== null && DEMO_ERRORS.includes(requested) ? requested : null;
  return stream(request, cap, err, params.get("locale"));
}

export function GET(request: NextRequest): Response {
  return handle(request);
}

export function POST(request: NextRequest): Response {
  return handle(request);
}
