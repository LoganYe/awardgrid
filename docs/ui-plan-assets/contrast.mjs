// WCAG 2.x contrast for the UI_PLAN.md token table. Run: node docs/ui-plan-assets/contrast.mjs
// Keep in sync with src/styles/tokens.css; the numbers printed here are the ones quoted in the plan.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };

export const LIGHT = { bg: "#FFFFFF", raised: "#F4F4F4", line: "#E2E2E2", lineStrong: "#8A8A8A", fg: "#171717", muted: "#5C5C5C", accent: "#1F5FBF", fresh: "#1B7A3E", aging: "#8F5800", stale: "#9B4A4A", error: "#B42318" };
export const DARK = { bg: "#111111", raised: "#1E1E1E", line: "#2C2C2C", lineStrong: "#707070", fg: "#EDEDED", muted: "#A3A3A3", accent: "#7DAAF5", fresh: "#5FC77E", aging: "#E3A93C", stale: "#D48C8C", error: "#F17A72" };

let failures = 0;
for (const [name, T] of [["LIGHT", LIGHT], ["DARK", DARK]]) {
  console.log(name);
  for (const k of ["fg", "muted", "accent", "fresh", "aging", "stale", "error"]) {
    const onBg = ratio(T[k], T.bg), onRaised = ratio(T[k], T.raised);
    if (onBg < 4.5 || onRaised < 4.5) failures++;
    console.log(`  ${k.padEnd(7)} on bg ${onBg}  on raised ${onRaised}`);
  }
  const onFg = ratio(T.bg, T.fg), lsBg = ratio(T.lineStrong, T.bg), lsRaised = ratio(T.lineStrong, T.raised);
  if (onFg < 4.5 || lsBg < 3 || lsRaised < 3) failures++;
  console.log(`  bg on fg (primary button text) ${onFg}`);
  console.log(`  line-strong on bg ${lsBg}  on raised ${lsRaised} (non-text: borders, dotted outline, hatch stripes; needs 3)`);
  console.log(`  line on bg ${ratio(T.line, T.bg)}  on raised ${ratio(T.line, T.raised)} (grid lines, decorative)`);
}
if (failures) { console.error(`${failures} pair(s) below AA`); process.exit(1); }
console.log("all text pairs >= 4.5:1; control borders and hatch stripes >= 3:1 on both grounds");
