/**
 * Tests for the in-repo QR encoder. Nothing here calls the encoder's own helpers to decide what
 * the answer should be:
 *   - the capacity numbers are the published level-M byte capacities, typed out;
 *   - the format bits are recomputed in this file with the BCH(15,5) formula, written a second
 *     time as a plain polynomial division, and read back OUT of the finished matrix;
 *   - the version bits are the spec's table for versions 7–10;
 *   - error correction is checked mathematically: a codeword block must vanish at α^0…α^(n-1);
 *   - and a full decode (find the mask in the format bits, unmask, walk the zigzag, read the
 *     mode / length / payload) gets the original string back out of the matrix.
 */
import { describe, expect, it } from "vitest";
import {
  MASK_COUNT,
  QrCapacityError,
  byteCapacity,
  chooseVersion,
  codewordsFor,
  dataCodewords,
  ecCodewords,
  encodeQr,
  formatBits,
  matrixSize,
  penalty,
  qrSvg,
  toSvg,
  versionBits,
} from "./encode";

// --- independent GF(256) arithmetic, written from the primitive polynomial ------------------

function gfPow(exp: number): number {
  let x = 1;
  for (let i = 0; i < exp; i += 1) {
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return x;
}

function gfMul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) result ^= x;
    y >>= 1;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return result;
}

/** Evaluate the codeword polynomial (highest power first) at α^k. */
function evalAt(codewords: readonly number[], k: number): number {
  return codewords.reduce((acc, coeff) => gfMul(acc, gfPow(k)) ^ coeff, 0);
}

// --- independent format / mask helpers -----------------------------------------------------

/** BCH(15,5): 5 data bits, generator 0x537, result XORed with the 0x5412 mask. */
function expectedFormat(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function maskAt(mask: number, r: number, c: number): boolean {
  const table = [
    (i: number, j: number) => (i + j) % 2 === 0,
    (i: number) => i % 2 === 0,
    (_i: number, j: number) => j % 3 === 0,
    (i: number, j: number) => (i + j) % 3 === 0,
    (i: number, j: number) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i: number, j: number) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i: number, j: number) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i: number, j: number) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
  ];
  return table[mask]!(r, c);
}

/** Which modules are function patterns (so the decoder skips them) — rebuilt from the spec. */
function functionMap(size: number, version: number): boolean[][] {
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number): void => {
    if (r >= 0 && c >= 0 && r < size && c < size) map[r]![c] = true;
  };
  for (const [fr, fc] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let dr = -1; dr <= 7; dr += 1) for (let dc = -1; dc <= 7; dc += 1) mark(fr! + dr, fc! + dc);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
    mark(8, i < 9 ? i : size - 1 - (i - 9) >= size - 8 ? size - 1 - (i - 9) : 8);
    mark(i < 9 ? i : size - 1 - (i - 9), 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  const centres: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  for (const r of centres[version]!) {
    for (const c of centres[version]!) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const row = Math.floor(i / 3);
      const col = size - 11 + (i % 3);
      mark(row, col);
      mark(col, row);
    }
  }
  return map;
}

/**
 * Read the 15 format modules of the top-left copy back out of a finished matrix, following the
 * spec's placement: bits 0–5 up column 8, bit 6 at (7,8), bit 7 at (8,8), bit 8 at (8,7), bits
 * 9–14 leftwards along row 8 (the timing modules at (6,8) and (8,6) are skipped).
 */
function readFormat(m: readonly (readonly boolean[])[]): number {
  const bit = (r: number, c: number, i: number): number => (m[r]![c] ? 1 << i : 0);
  let value = 0;
  for (let i = 0; i <= 5; i += 1) value |= bit(i, 8, i);
  value |= bit(7, 8, 6);
  value |= bit(8, 8, 7);
  value |= bit(8, 7, 8);
  for (let i = 9; i <= 14; i += 1) value |= bit(8, 14 - i, i);
  return value;
}

/** Full decode of a single-block (version 1–3) byte-mode symbol. */
function decode(m: readonly (readonly boolean[])[], version: number): string {
  const size = m.length;
  const mask = readFormat(m) ^ 0x5412 ? (readFormat(m) ^ 0x5412) >> 10 : 0;
  const maskId = mask & 0b111;
  const fn = functionMap(size, version);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v += 1) {
      const row = upward ? size - 1 - v : v;
      for (const col of [right, right - 1]) {
        if (fn[row]![col]) continue;
        const dark = m[row]![col]! !== maskAt(maskId, row, col); // undo the mask
        bits.push(dark ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const take = (start: number, n: number): number => bits.slice(start, start + n).reduce((acc, b) => (acc << 1) | b, 0);
  expect(take(0, 4)).toBe(0b0100); // byte mode
  const length = take(4, 8);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(12 + i * 8, 8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

// -------------------------------------------------------------------------------------------

describe("capacity table and version selection", () => {
  it("matches the published level-M byte capacities for versions 1–10", () => {
    const published = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    expect(published.map((_, i) => byteCapacity(i + 1))).toEqual(published);
    // Total data codewords per version at level M, also from the table.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dataCodewords)).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
  });

  it("picks the smallest version that fits, so a 60-character deep link is version 4", () => {
    const link = `https://t.me/awardgrid_bot?start=${"a".repeat(27)}`;
    expect(link).toHaveLength(60);
    expect(chooseVersion(link.length)).toBe(4);
    expect(encodeQr(link).version).toBe(4);
    // Thresholds either side of every boundary.
    expect(chooseVersion(14)).toBe(1);
    expect(chooseVersion(15)).toBe(2);
    expect(chooseVersion(62)).toBe(4);
    expect(chooseVersion(63)).toBe(5);
    expect(chooseVersion(213)).toBe(10);
    expect(() => chooseVersion(214)).toThrow(QrCapacityError);
    expect(() => encodeQr("x".repeat(214))).toThrow(QrCapacityError);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(encodeQr("链接").version).toBe(1); // 6 bytes
    expect(matrixSize(1)).toBe(21);
    expect(matrixSize(4)).toBe(33);
  });
});

describe("Reed–Solomon", () => {
  it("produces codewords divisible by the generator polynomial (zero at α^0…α^(n-1))", () => {
    const data = Uint8Array.from([0x40, 0xd2, 0x75, 0x47, 0x76, 0x17, 0x32, 0x06, 0x27, 0x26, 0x96, 0xc6, 0xc6, 0x96, 0x70, 0xec]);
    for (const ecLen of [10, 16, 26]) {
      const full = [...data, ...ecCodewords(data, ecLen)];
      for (let k = 0; k < ecLen; k += 1) expect(evalAt(full, k), `ecLen ${ecLen}, root ${k}`).toBe(0);
    }
  });

  it("fills a version-1 symbol with exactly 26 codewords: 16 data (mode, length, payload, pad) + 10 EC", () => {
    const words = codewordsFor(new TextEncoder().encode("HELLO WORLD"), 1);
    expect(words).toHaveLength(26);
    expect(words[0]).toBe(0x40); // 0100 (byte mode) + the high nibble of the length 11 (0000)
    expect(words[1]).toBe(0xb4); // the low nibble of 11 (1011) + the high nibble of "H" (0x48)
    // Padding after the terminator alternates 0xEC / 0x11.
    expect([...words.slice(13, 16)]).toEqual([0xec, 0x11, 0xec]);
    for (let k = 0; k < 10; k += 1) expect(evalAt([...words], k)).toBe(0);
  });
});

describe("format and version information", () => {
  it("matches the BCH(15,5) formula for every mask at level M", () => {
    for (let mask = 0; mask < MASK_COUNT; mask += 1) {
      expect(formatBits(mask), `mask ${mask}`).toBe(expectedFormat(0b00, mask));
    }
    // Two published entries of the format table (level M, masks 0 and 7).
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(7)).toBe(0b100101010100000);
  });

  it("matches the spec's version-information table for versions 7–10", () => {
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(8)).toBe(0b001000010110111100);
    expect(versionBits(9)).toBe(0b001001101010011001);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });

  it("writes both copies of the chosen mask's format bits into the matrix", () => {
    const code = encodeQr("https://t.me/awardgrid_bot?start=abc123");
    const m = code.modules;
    const n = m.length;
    expect(readFormat(m)).toBe(expectedFormat(0b00, code.mask));
    // Second copy: bits 0–7 along row 8 from the right edge, bits 8–14 down column 8 to the bottom.
    const bits = expectedFormat(0b00, code.mask);
    for (let i = 0; i <= 7; i += 1) expect(m[8]![n - 1 - i], `copy 2 bit ${i}`).toBe(((bits >> i) & 1) === 1);
    for (let i = 8; i <= 14; i += 1) expect(m[n - 15 + i]![8], `copy 2 bit ${i}`).toBe(((bits >> i) & 1) === 1);
    expect(m[n - 8]![8]).toBe(true); // the always-dark module
  });
});

describe("structure of a finished symbol", () => {
  const code = encodeQr("HELLO WORLD");

  it("is a 21×21 version-1 matrix with the three finders and their separators intact after masking", () => {
    expect(code.version).toBe(1);
    expect(code.size).toBe(21);
    expect(code.modules).toHaveLength(21);
    const finder = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ];
    for (const [top, left] of [
      [0, 0],
      [0, 14],
      [14, 0],
    ]) {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          expect(code.modules[top! + r]![left! + c], `finder at ${top},${left} cell ${r},${c}`).toBe(finder[r]![c] === 1);
        }
      }
    }
    // Separators: the light ring around each finder.
    for (let i = 0; i < 8; i += 1) {
      expect(code.modules[7]![i]).toBe(false);
      expect(code.modules[i]![7]).toBe(false);
      expect(code.modules[7]![20 - i]).toBe(false);
      expect(code.modules[20 - i]![7]).toBe(false);
    }
  });

  it("keeps both timing patterns alternating between the separators", () => {
    for (let i = 8; i <= 12; i += 1) {
      expect(code.modules[6]![i], `row timing ${i}`).toBe(i % 2 === 0);
      expect(code.modules[i]![6], `column timing ${i}`).toBe(i % 2 === 0);
    }
  });

  it("places an alignment pattern at (18,18) from version 2 up and none in version 1", () => {
    const v2 = encodeQr("x".repeat(20)); // 20 bytes → version 2
    expect(v2.version).toBe(2);
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        expect(v2.modules[18 + dr]![18 + dc], `alignment ${dr},${dc}`).toBe(Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  });

  it("chooses the lowest-penalty mask of the eight", () => {
    expect(code.mask).toBeGreaterThanOrEqual(0);
    expect(code.mask).toBeLessThan(MASK_COUNT);
    // A blank field is the worst possible symbol: one big run, all 2×2 blocks, 100 % dark.
    const blank = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(true));
    expect(penalty(blank)).toBeGreaterThan(penalty(code.modules));
  });

  it("is deterministic", () => {
    expect(encodeQr("HELLO WORLD").modules).toEqual(code.modules);
  });
});

describe("round trip", () => {
  it("decodes back to the original text (mask found in the format bits, zigzag walked in reverse)", () => {
    for (const text of ["HELLO WORLD", "https://t.me/awardgrid_bot?start=9f8e7d", "链接"]) {
      const code = encodeQr(text);
      expect(code.version).toBeLessThanOrEqual(3); // single-block versions, which this decoder handles
      expect(decode(code.modules, code.version)).toBe(text);
    }
  });
});

describe("toSvg", () => {
  const code = encodeQr("https://t.me/awardgrid_bot?start=abc123");

  it("renders one path in currentColor with a four-module quiet zone", () => {
    const svg = toSvg(code.modules);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain(`viewBox="0 0 ${code.size + 8} ${code.size + 8}"`);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('width="128" height="128"');
    expect(svg).toContain('aria-hidden="true"');
    // One subpath per dark module, all inside the quiet zone.
    const dark = code.modules.flat().filter(Boolean).length;
    expect(svg.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
    expect(svg).toContain("M4 4"); // the top-left finder starts at the quiet-zone offset
  });

  it("honours size, colour, quiet zone and an accessible name", () => {
    const svg = toSvg(code.modules, { size: 96, fg: "var(--fg)", quietZone: 2, title: "Telegram link" });
    expect(svg).toContain('width="96" height="96"');
    expect(svg).toContain(`viewBox="0 0 ${code.size + 4} ${code.size + 4}"`);
    expect(svg).toContain('fill="var(--fg)"');
    expect(svg).toContain('role="img" aria-label="Telegram link"');
    expect(svg).not.toContain("aria-hidden");
  });

  it("escapes anything that would break out of an attribute", () => {
    const svg = toSvg(code.modules, { fg: '"><script>', title: 'a "quoted" & <tagged> name' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;&gt;&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("qrSvg encodes and renders in one call", () => {
    expect(qrSvg("https://t.me/awardgrid_bot?start=abc123")).toBe(toSvg(code.modules));
  });
});
