/**
 * GET /api/health → 200 { ok: true, version, time }. No auth, no DB — used by the Docker
 * healthcheck and by `docker compose up` smoke tests (kickoff Phase 5).
 */
import { healthPayload } from "@/lib/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(healthPayload(), { headers: { "cache-control": "no-store" } });
}
