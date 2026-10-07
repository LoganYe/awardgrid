/**
 * Run a block of tests in one time zone. vitest.config.ts pins TZ to UTC for every file, so a test about "today" on a
 * device somewhere else sets process.env.TZ, which Node applies at once, and puts the old zone back afterwards (the
 * same pattern as core's pivot.test.ts and present.test.ts).
 */
import { afterAll, beforeAll } from "vitest";

export function inTimeZone(tz: string): void {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}
