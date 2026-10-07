/**
 * What AwardGrid's two invented datasets share: the seeded random numbers, the day arithmetic, the programs and their
 * invented prices and taxes. Every number here is made up; nothing was fetched from seats.aero or any airline.
 *
 *   - **Sample mode** (./generate.ts, ./sample-fetch.ts): the app's own labelled sample data, for any route it knows.
 *   - **The demo corridor** (fixtures/demo/generate.ts, which imports these back): the files the web app's screenshot
 *     suite and `pnpm demo` serve. scripts/demo-dataset.test.ts holds those files byte-identical, so the values the
 *     corridor reads (the J and F prices, the taxes, the dynamic-prone programs) must not change here.
 *
 * Plain functions and constants only: no Capacitor, no DOM, no `import.meta.env`, so the root workspace (tsx, vitest)
 * and the iOS shell both compile it.
 */
import type { SeatsSource } from "@awardgrid/core/seatsaero/types";

/** Real seats.aero source codes only (SEATS_SOURCES): real program names with invented numbers (release plan D10). */
export const DEMO_PROGRAMS = ["american", "alaska", "united", "aeroplan", "singapore", "jetblue", "flyingblue"] as const satisfies readonly SeatsSource[];
export type DemoProgram = (typeof DEMO_PROGRAMS)[number];

/**
 * Invented base prices per program (miles) for a reference trip of about 5,700 statute miles (the demo corridor, Asia
 * to Seattle). The corridor reads J and F as they are; sample mode scales all four cabins by distance (./generate.ts).
 */
export const BASE_MILES: Record<DemoProgram, { Y: number; W: number; J: number; F: number }> = {
  american: { Y: 30_000, W: 45_000, J: 60_000, F: 80_000 },
  alaska: { Y: 32_500, W: 50_000, J: 70_000, F: 85_000 },
  united: { Y: 35_000, W: 55_000, J: 80_000, F: 110_000 },
  aeroplan: { Y: 35_000, W: 50_000, J: 75_000, F: 105_000 },
  singapore: { Y: 38_000, W: 58_000, J: 92_000, F: 118_000 },
  jetblue: { Y: 30_000, W: 48_000, J: 90_000, F: 120_000 },
  flyingblue: { Y: 33_000, W: 52_000, J: 85_000, F: 130_000 },
};

/** Programs whose rows may be dynamic-priced (served only with include_filtered=true). */
export const DYNAMIC_PRONE: readonly DemoProgram[] = ["united", "aeroplan", "flyingblue", "jetblue"];

/** Invented taxes in minor units (cents) per program: [min, max]. */
export const TAXES: Record<DemoProgram, [number, number]> = {
  american: [560, 4_000],
  alaska: [560, 3_500],
  united: [560, 6_000],
  aeroplan: [6_000, 20_000],
  singapore: [5_000, 15_000],
  jetblue: [560, 3_000],
  flyingblue: [20_000, 45_000],
};

/** mulberry32 — tiny seeded PRNG; good enough for invented data, and the same numbers on every device. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string's UTF-16 code units: a 32-bit seed for mulberry32 from a key such as "HKG|SEA|2026-11-02|J". */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A calendar day `n` days after `iso` (YYYY-MM-DD), in UTC, so it never shifts with the device's zone. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
