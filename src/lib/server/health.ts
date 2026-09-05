/** Payload for GET /api/health — kept outside route.ts so the route module only exports handlers. */
import pkg from "../../../package.json";

export const APP_VERSION: string = pkg.version;

export interface HealthPayload {
  ok: true;
  version: string;
  time: string;
}

export function healthPayload(now: Date = new Date()): HealthPayload {
  return { ok: true, version: APP_VERSION, time: now.toISOString() };
}
