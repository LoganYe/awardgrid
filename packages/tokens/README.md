# `@awardgrid/tokens`

The design tokens every surface reads: the Next app, the Capacitor shell (`apps/ios`) and the
landing site (`sites/landing`).

It exists for one reason. Before Phase 3 there were two palettes — `src/styles/tokens.css` and a
hand-picked set of eight hexes in `apps/ios/src/styles.css` that happened to look similar. Three
surfaces reading three copies is how a design system drifts: the next person to adjust a colour
adjusts one of the copies. Now there is one.

## `tokens.css` — colour, type, motion, spacing

Unchanged from v0.2, deliberately and provably: the move into this package was a `git mv` with
**0 insertions and 0 deletions**. Eleven colours per theme, strictly achromatic neutrals, one
accent that is never a fill.

Two things freeze the values, and both are worth knowing before touching them:

- `src/styles/tokens.test.ts` asserts the **exact hex** of every colour token, and that the two
  dark copies define an identical set.
- 24 Playwright baselines and 298 screenshots are pixel-compared in CI, and the `visual` job is
  **blocking**. Those baselines are generated on Linux CI only, so a value change made on a Mac
  cannot be re-baselined by the person making it.

So: **add tokens, change no values, rename nothing.** `docs/PIVOT.md` §4 says the same thing for a
third reason — roughly 10,000 lines of `.tsx` consume `--bg`, `--fg`, `--line` and `--accent`
through the `@theme inline` bridge in `src/app/globals.css`.

New colour pairs go through `docs/ui-plan-assets/contrast.mjs` before they land. It is a manual
gate, not a CI step; CI's a11y enforcement is `e2e/axe.spec.ts`, which fails on any serious or
critical violation across three projects.

## `surfaces.css` — the two surface modes

`docs/PIVOT.md` §4: *"One token file, two surface modes. Colour, type, motion and spacing shared;
radius, blur and elevation fork."*

```
[data-surface="flat"]   the grid, and anything inside .ag-scroll. Default for the app shell.
[data-surface="rich"]   landing, onboarding, key setup, settings headers, empty states.
```

| | flat | rich |
|---|---|---|
| `--surface-radius` | `0` | `14px` |
| `--surface-blur` | `0` | `12px` |
| `--surface-shadow` | `none` | two-layer, composed from black |
| `--surface-pad` | `--space-3` | `--space-6` |

The idea is taken from the design reference rather than invented. `restful.dowhiz.com` is glass
throughout — `backdrop-filter: blur(18px)`, stacked translucent gradients, `0 24px 60px` shadows,
28px radii — and its two **data** components (`.fact-table`, `.compare-table`) switch every bit of
that off: no blur, no shadow, flat fill, 1px hairlines, `overflow-x: auto`. Its radii already fork
without being named as a system — 28px for glass, 20px for data. That instinct is the thing worth
copying, because blur behind a column of mileage numbers costs legibility and buys nothing.

Both blocks set **every** token rather than inheriting, because a flat island must be able to nest
inside a rich page — the grid on an onboarding screen is exactly that — and a mode that overrode
only a subset would leak the outer mode's blur into the inner one.

### What is deliberately not copied

- **Restful's colours.** `FINAL_REPORT.md:179` records that this product passed a "generic-template
  tells" check naming "no cream + serif + terracotta" — Restful's exact signature (`--accent-cream:
  #ffdb76` on an ink-to-navy gradient). Adopting it would make awardgrid look like Restful rather
  than like Restful's sibling.
- **Its muted text.** `--text-muted: #8aa0a3` sits on a gradient that runs to a light navy at the
  bottom of a long page. This repo's CI fails on serious axe violations.
- **Its shadows in flat mode.** `FINAL_REPORT.md:179` also records "no cards, no shadows anywhere".
  Flat mode keeps that. Rich mode reintroduces a shadow only on marketing and onboarding surfaces,
  which did not exist when that rule was written — a departure, recorded in `DECISIONS.md` rather
  than made quietly.
- **Its display tracking.** Restful sets `-0.08em`. awardgrid sets three-letter IATA codes in
  headlines, and `SEA` / `NRT` collide at that tracking, so `--tracking-display` is `-0.02em`.
- **Its lack of motion guards.** Restful ships no `prefers-reduced-motion` handling. Every
  consumer of this file does.

## Fonts

`--font-display` and `--font-eyebrow` name **no webfont**. `docs/UI_PLAN.md:514` rejected a network
font dependency, and the repo's convention is to self-host with the licence beside the binary —
which Inter does, and which is why Inter is copied into `apps/ios/public/fonts/` rather than
re-downloaded. A system serif stack needs neither: `ui-serif` is New York on Apple platforms, a
real display serif rather than a fallback. Both stacks carry an explicit CJK serif, without which a
Chinese eyebrow silently loses the serif voice in half the product.

Inter stays the **data** face untouched. Its tabular figures and CJK-after-Latin `unicode-range`
stack are load-bearing for a bilingual grid of mileage numbers.
