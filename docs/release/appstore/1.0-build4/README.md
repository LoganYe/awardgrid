# App Store screenshots: version 1.0, build 4

The 6.9-inch iPhone set for version 1.0 as it is resubmitted with build 4 (`docs/release/IOS_1.0_RELEASE.md` §0 P9,
P17), English (en-US) only, as App Store Connect has no other localization. Seven PNGs, 1320×2868 portrait, RGB
without alpha. They replace the whole build-3 set in `../1.0/`, which stays in the repository as the record of what
was listed for build 3 (its `07-ask.png` shows a feature the App Store build no longer has).

| File | Screen | What it shows |
|---|---|---|
| `en-US/01-list.png` | Search › List | "LAX to Tokyo next month, business": LAX → NRT, HND, Oct 7 – Nov 5, business; 53 options sorted by lowest miles; every row's time line reads "Sample data"; the status line reads "Sample data · on this device" |
| `en-US/02-calendar.png` | Search › Calendar | The same search: lowest miles by date for October 2026, with the days that have no matches |
| `en-US/03-matrix.png` | Search › Matrix | The same search: one row per date, LAX → NRT and LAX → HND side by side, program and seats in each cell, and the note that miles in different programs are not equivalent |
| `en-US/04-details.png` | Option details | LAX → NRT on Fri, Oct 23, business, 53,000 miles, redeemed through American Airlines AAdvantage, with the first flight itinerary (one stop, segment times in local time) and "Sample options have no booking links." |
| `en-US/05-compare.png` | Compare selected options | Three options selected; columns 1 and 2: AAdvantage 53,000 miles against Alaska Mileage Plan 61,000 miles, with the note that miles from different programs are not ranked or scored |
| `en-US/06-watches.png` | Watches | Three watched searches (LAX → NRT, HND business; SFO → LHR, LGW, LCY, STN first; HKG → SEA business), each with its first check done: "Baseline saved just now. Later checks report what changes." |
| `en-US/07-welcome.png` | Search, first run | The welcome a new install opens on: "Try with sample data" first, "Connect your seats.aero account" second, and the trip planner ("Plan a trip") under them |

Every sample screen (01-06) carries the sample banner ("Sample data", "Illustrative data — not live availability",
"Exit sample data"). None of the seven is the connection screen, and none shows Ask, a source time ("Source
updated") or "Pro".

## How they were made

- **Bundle:** the App Store flavour, built from `claude/ios-311-s2` with
  `env -u VITE_AG_PROBES npm run build:store && npx cap copy ios` in `apps/ios` (the store-bundle check passed on both
  `dist` and `ios/App/App/public`), then `xcodebuild` Debug for the iOS Simulator, ad-hoc signed
  (`CODE_SIGN_IDENTITY=-`), with its derived data inside the worktree.
- **Device:** a new Simulator device, "awardgrid 6.9 shots" (device type iPhone 17 Pro Max, the 6.9-inch display,
  iOS 27.0), installed fresh. Light appearance, English (`-AppleLanguages (en)`, `-AppleLocale en_US`), 12-hour clock
  (the new device had copied the host's 24-hour setting, which shows "09:41"). Status bar:
  `xcrun simctl status_bar <UDID> override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 --operatorName ""`.
- **Steps:** 07 was taken first, on the fresh install. Then the welcome's "Try with sample data"; on sample data,
  "LAX to Tokyo next month, business" was typed and run (01-03), its first option opened with its itineraries (04),
  and three options of different programs compared (05). That search, "SFO to London next 60 days, first" and "Hong
  Kong to Seattle next month, business" were watched, and the app was opened again so the watches took their first
  check (06). The screens were driven through the app's WebKit inspector (taps and typing as page events) and
  captured with `xcrun simctl io <UDID> screenshot`.
- **Sample data** is made on the device from the day it runs: these were taken on 2026-10-07, so "next month" reads as
  Oct 7 – Nov 5. Program names are real; miles, fees, seats and flight numbers are invented (decision D10).
- **After capture**, two changes only: RGBA to RGB (every pixel was already opaque), and a 3×3-pixel black dot in the
  top-left corner, present on every `simctl` capture of this device (its home screen included), covered with the
  4×4 block of status-bar background beside it.

## Checks

- `sips`: each file 1320×2868, RGB, no alpha.
- Text recognition (Apple Vision) over each final PNG: "9:41" on all seven; the banner's title and sentence on 01-06;
  no "Source updated", "min ago", "Pro", "subscribe", "purchase", "unlock", "upgrade", "Ask", "AI", "Anthropic",
  "Claude" or "API key" on any. The only "live" is the banner's own "not live availability".
- `apps/ios/scripts/check-store-bundle.mjs` passed on the bundle these were taken from.
