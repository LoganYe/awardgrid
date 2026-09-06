/**
 * A small QR encoder: byte mode, error-correction level M, versions 1–10, all eight masks with
 * the standard penalty scoring, output as a boolean matrix (true = dark) and as an inline SVG.
 *
 * Why it lives here: the settings page shows a Telegram deep link as a QR (docs/UI_PLAN.md
 * §6.8) and Phase 6 allows no new runtime dependency. A `https://t.me/<bot>?start=<token>` link
 * is well under 100 bytes, so versions 1–10 (up to 213 bytes at level M) are more than enough
 * and the alignment/version tables stay short.
 *
 * Implemented from the QR specification:
 *   - data: mode 0100, an 8-bit (v1–9) or 16-bit (v10) character count, the UTF-8 bytes, a
 *     terminator, then the 0xEC / 0x11 pad bytes;
 *   - error correction: Reed–Solomon over GF(256) (primitive polynomial 0x11D), one generator
 *     polynomial per EC length, one block per the level-M block table, data and EC codewords
 *     interleaved;
 *   - function patterns: finders + separators, timing rows, alignment patterns, the dark
 *     module, the format information (BCH(15,5), generator 0x537, mask 0x5412) and, from
 *     version 7, the version information (BCH(18,6), generator 0x1F25);
 *   - masking: the eight standard formulas applied to data modules only, scored with penalty
 *     rules N1=3 (runs), N2=3 (2×2 blocks), N3=40 (finder-like patterns), N4=10 (dark balance);
 *     the lowest score wins.
 *
 * Everything here is pure and synchronous: same input, same matrix.
 */

// ---------------------------------------------------------------------------
// GF(256) — arithmetic for Reed–Solomon
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Coefficients of (x - a^0)(x - a^1)…(x - a^(n-1)), highest power first, leading 1 dropped. */
export function generatorPoly(n: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < n; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      // Highest power first: multiplying by x moves a coefficient toward index 0.
      next[j] = (next[j]! ^ poly[j]!) & 0xff;
      next[j + 1] = (next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!)) & 0xff;
    }
    poly = next;
  }
  return poly.slice(1);
}

/** The `ecLen` error-correction codewords for one data block. */
export function ecCodewords(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = generatorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i += 1) rem[i] = (rem[i]! ^ gfMul(gen[i]!, factor)) & 0xff;
    }
  }
  return rem;
}

// ---------------------------------------------------------------------------
// Level-M block table, versions 1–10
// [version, ecCodewordsPerBlock, group1Blocks, group1Data, group2Blocks, group2Data]
// ---------------------------------------------------------------------------

const EC_M: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 10, 1, 16, 0, 0],
  [2, 16, 1, 28, 0, 0],
  [3, 26, 1, 44, 0, 0],
  [4, 18, 2, 32, 0, 0],
  [5, 24, 2, 43, 0, 0],
  [6, 16, 4, 27, 0, 0],
  [7, 18, 4, 31, 0, 0],
  [8, 22, 2, 38, 2, 39],
  [9, 22, 3, 36, 2, 37],
  [10, 26, 4, 43, 1, 44],
];

export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

/** Data codewords available at level M for a version. */
export function dataCodewords(version: number): number {
  const [, , g1, d1, g2, d2] = EC_M[version - 1]!;
  return g1 * d1 + g2 * d2;
}

/** Bits used by the character-count field: 8 for versions 1–9, 16 from version 10 (byte mode). */
export function charCountBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** Longest byte payload a version holds at level M: v1 14 … v4 62 … v10 213. */
export function byteCapacity(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - charCountBits(version)) / 8);
}

export class QrCapacityError extends Error {
  constructor(bytes: number) {
    super(`${bytes} bytes is more than version ${MAX_VERSION} holds at level M (${byteCapacity(MAX_VERSION)})`);
    this.name = "QrCapacityError";
  }
}

/** The smallest version that holds `bytes` at level M. Throws QrCapacityError past version 10. */
export function chooseVersion(bytes: number): number {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v += 1) {
    if (bytes <= byteCapacity(v)) return v;
  }
  throw new QrCapacityError(bytes);
}

// ---------------------------------------------------------------------------
// Data codewords: mode + count + payload + padding, then blocks and interleaving
// ---------------------------------------------------------------------------

function toBits(value: number, length: number, out: boolean[]): void {
  for (let i = length - 1; i >= 0; i -= 1) out.push(((value >> i) & 1) === 1);
}

/** The final codeword stream (data blocks interleaved, then EC blocks interleaved). */
export function codewordsFor(bytes: Uint8Array, version: number): Uint8Array {
  const bits: boolean[] = [];
  toBits(0b0100, 4, bits); // byte mode
  toBits(bytes.length, charCountBits(version), bits);
  for (const b of bytes) toBits(b, 8, bits);

  const capacityBits = dataCodewords(version) * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(false); // terminator
  while (bits.length % 8 !== 0) bits.push(false);
  const data = new Uint8Array(dataCodewords(version));
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    data[i / 8] = byte;
  }
  for (let i = bits.length / 8, pad = 0; i < data.length; i += 1, pad += 1) data[i] = pad % 2 === 0 ? 0xec : 0x11;

  // Split into blocks per the level-M table, compute EC per block, interleave.
  const [, ecLen, g1, d1, g2, d2] = EC_M[version - 1]!;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, size] of [
    [g1, d1],
    [g2, d2],
  ] as const) {
    for (let b = 0; b < count; b += 1) {
      const block = data.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, ecLen));
    }
  }
  const out: number[] = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const block of ecBlocks) out.push(block[i]!);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Function patterns
// ---------------------------------------------------------------------------

/** Alignment-pattern centre coordinates, versions 1–10 (version 1 has none). */
const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export function matrixSize(version: number): number {
  return version * 4 + 17;
}

function grid(n: number): boolean[][] {
  return Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
}

interface Canvas {
  modules: boolean[][];
  /** Function-pattern and format modules: never carry data and are never masked. */
  reserved: boolean[][];
}

function drawFunctionPatterns(version: number): Canvas {
  const n = matrixSize(version);
  const modules = grid(n);
  const reserved = grid(n);
  const set = (r: number, c: number, dark: boolean): void => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    modules[r]![c] = dark;
    reserved[r]![c] = true;
  };

  // Finders with their separators, at three corners.
  for (const [fr, fc] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(fr + dr, fc + dc, inner && (ring || core));
      }
    }
  }

  // Timing rows.
  for (let i = 8; i < n - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGNMENT[version - 1]!;
  for (const r of centres) {
    for (const c of centres) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // Format-information modules (values written per mask) and the always-dark module. Index 6
  // is skipped in both directions: (8,6) and (6,8) belong to the timing patterns.
  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) continue;
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    set(8, n - 1 - i, false);
    set(n - 1 - i, 8, false);
  }
  set(n - 8, 8, true);

  // Version information (versions 7+), both copies.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const col = n - 11 + (i % 3);
      set(row, col, dark);
      set(col, row, dark);
    }
  }
  return { modules, reserved };
}

/** 15-bit format information for level M and a mask: BCH(15,5) over 0x537, XOR 0x5412. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 0b00
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information for versions 7–40: BCH(18,6) over 0x1F25. */
export function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

/**
 * The 15 format bits, twice. Copy 1 wraps the top-left finder (bits 0–5 up column 8, bit 6 at
 * (7,8), bit 7 at (8,8), bit 8 at (8,7), bits 9–14 leftwards along row 8, skipping the timing
 * modules at (6,8) and (8,6)). Copy 2 runs bits 0–7 leftwards along row 8 from the right edge
 * and bits 8–14 down column 8 to the bottom edge. Coordinates are [row][col].
 */
function writeFormat(canvas: Canvas, mask: number): void {
  const n = canvas.modules.length;
  const bits = formatBits(mask);
  const bit = (i: number): boolean => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) canvas.modules[i]![8] = bit(i);
  canvas.modules[7]![8] = bit(6);
  canvas.modules[8]![8] = bit(7);
  canvas.modules[8]![7] = bit(8);
  for (let i = 9; i <= 14; i += 1) canvas.modules[8]![14 - i] = bit(i);
  for (let i = 0; i <= 7; i += 1) canvas.modules[8]![n - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) canvas.modules[n - 15 + i]![8] = bit(i);
  canvas.modules[n - 8]![8] = true; // the dark module, restated for clarity
}

/** The zigzag walk: two columns at a time from the right, skipping the vertical timing column. */
function placeData(canvas: Canvas, codewords: Uint8Array): void {
  const n = canvas.modules.length;
  let bit = 0;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v += 1) {
      const row = upward ? n - 1 - v : v;
      for (const col of [right, right - 1]) {
        if (canvas.reserved[row]![col]) continue;
        // Past the last codeword the remainder bits are 0 (they are still masked).
        const byte = codewords[bit >> 3];
        canvas.modules[row]![col] = byte !== undefined && ((byte >> (7 - (bit & 7))) & 1) === 1;
        bit += 1;
      }
    }
    upward = !upward;
  }
}

export const MASK_COUNT = 8;

/** The eight mask conditions; true means "flip this data module". */
export function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(canvas: Canvas, mask: number): void {
  for (let r = 0; r < canvas.modules.length; r += 1) {
    for (let c = 0; c < canvas.modules.length; c += 1) {
      if (canvas.reserved[r]![c]) continue;
      if (maskCondition(mask, r, c)) canvas.modules[r]![c] = !canvas.modules[r]![c];
    }
  }
}

const FINDER_RUN = [true, false, true, true, true, false, true] as const;

/** Standard penalty score (rules N1–N4); the mask with the lowest score is chosen. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const n = modules.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i += 1) {
    lines.push(modules[i]!.slice());
    lines.push(modules.map((row) => row[i]!));
  }
  for (const line of lines) {
    // N1: runs of five or more.
    let run = 1;
    for (let i = 1; i <= n; i += 1) {
      if (i < n && line[i] === line[i - 1]) {
        run += 1;
        continue;
      }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    // N3: the finder-like 1011101 with four light modules on either side.
    for (let i = 0; i + 7 <= n; i += 1) {
      if (!FINDER_RUN.every((v, k) => line[i + k] === v)) continue;
      const before = line.slice(Math.max(0, i - 4), i);
      const after = line.slice(i + 7, i + 11);
      if ((before.length === 4 && before.every((v) => !v)) || (after.length === 4 && after.every((v) => !v))) score += 40;
    }
  }
  // N2: 2×2 blocks of one colour.
  for (let r = 0; r + 1 < n; r += 1) {
    for (let c = 0; c + 1 < n; c += 1) {
      const v = modules[r]![c]!;
      if (modules[r]![c + 1] === v && modules[r + 1]![c] === v && modules[r + 1]![c + 1] === v) score += 3;
    }
  }
  // N4: deviation from a half-dark symbol.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  score += 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
  return score;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QrCode {
  version: number;
  /** Modules per side (version × 4 + 17), without the quiet zone. */
  size: number;
  /** The mask the penalty score chose. */
  mask: number;
  /** `modules[row][col]`, true = dark. */
  modules: boolean[][];
}

/**
 * Encode `text` (UTF-8, byte mode, level M) into the smallest version that holds it, trying all
 * eight masks and keeping the lowest-penalty one. Throws QrCapacityError past 213 bytes.
 */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = codewordsFor(bytes, version);
  let best: QrCode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASK_COUNT; mask += 1) {
    const canvas = drawFunctionPatterns(version);
    placeData(canvas, codewords);
    applyMask(canvas, mask);
    writeFormat(canvas, mask);
    const score = penalty(canvas.modules);
    if (score < bestScore) {
      bestScore = score;
      best = { version, size: canvas.modules.length, mask, modules: canvas.modules };
    }
  }
  return best!;
}

export interface SvgOptions {
  /** Rendered width and height in CSS pixels (the viewBox stays in modules). */
  size?: number;
  /** Colour of the dark modules; "currentColor" so the page's own token decides. */
  fg?: string;
  /** Light margin in modules; the specification's minimum is 4. */
  quietZone?: number;
  /** Accessible name; when omitted the SVG is marked decorative (aria-hidden). */
  title?: string;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * One `<svg>` with a single `<path>`: every dark module is one `M x y h1 v1 h-1 z` subpath, so
 * the string stays small and there is exactly one fillable element. The background is left
 * transparent — the page's own surface is the light half of the code.
 */
export function toSvg(modules: readonly (readonly boolean[])[], opts: SvgOptions = {}): string {
  const { size = 128, fg = "currentColor", quietZone = 4, title } = opts;
  const n = modules.length;
  const side = n + quietZone * 2;
  const parts: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (modules[r]![c]) parts.push(`M${c + quietZone} ${r + quietZone}h1v1h-1z`);
    }
  }
  const label = title === undefined ? ' aria-hidden="true"' : ` role="img" aria-label="${escapeAttr(title)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${side} ${side}"` +
    ` shape-rendering="crispEdges"${label}>` +
    `<path fill="${escapeAttr(fg)}" d="${parts.join("")}"/>` +
    `</svg>`
  );
}

/** Encode and render in one call — what the settings page uses for the Telegram deep link. */
export function qrSvg(text: string, opts: SvgOptions = {}): string {
  return toSvg(encodeQr(text).modules, opts);
}
