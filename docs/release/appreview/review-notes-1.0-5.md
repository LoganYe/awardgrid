# App Review Notes for AwardGrid 1.0 (5)

The draft for **App Store Connect › AwardGrid › version 1.0 › App Review Information › Notes**, written on 2026-10-07
for the build that connects a seats.aero account only through seats.aero's own sign-in (the 3.1.1 remediation plan's
Draft B, OAuth variant, and step 47F). It replaces both variants of `review-notes-1.0-4.md`: build 1.0 (4) connects
with a pasted key, is an internal TestFlight build only, and is not submitted. Nothing here has been pasted, saved or
sent.

"1.0 (5)" is the build number the owner gives the OAuth build once its client ID exists (`sites/auth/DEPLOY.md`); if
it gets another number, change the title above and nothing else (the notes themselves name no build).

Before pasting:

- The build must be the one made by `npm run build:store` with the real client ID (`VITE_AG_SEATS_CLIENT_ID`), and the
  token service must be deployed with the client's secret, its route added and the WAF check passed
  (`sites/auth/DEPLOY.md`). Otherwise "Connect seats.aero" cannot finish, and the notes describe a connection that
  does not work.
- Delete every line in square brackets, or fill it: `[- As discussed with App Review on <date>: …]` only if App Review
  answered the reply of 2026-10-06 or a call took place; `[seats.aero approved …]` only if seats.aero has approved the
  app for general use by then.
- The Attachment field (App Review Information › Attachment) holds the screen recording of the sign-in on the owner's
  own account, made with this build (plan step 33, adapted: Connect seats.aero › seats.aero's page › back in the app ›
  one search › Disconnect). Before upload, check that it shows no seats.aero password, no account e-mail and no
  notification. If it is not attached, delete the sentence "The attached recording shows sign-in on our own account."
- There is no phone number in the notes: App Review Information has its own contact fields (decision D14(b)). The
  e-mail address is the public support address on `https://awardgrid.dowhiz.com/support/`.
- "Works offline" rests on the Simulator QA, where sample mode sent no request; no run with the network off has been
  made. Check it in airplane mode in the device test (Welcome, "Try with sample data", a search, the three views,
  details, compare, save, watch); if anything there needs the network, delete "; works offline".
- The line "The Welcome screen also offers "Plan a trip" …" is there only because the build has the planner
  (decision D11). If it has none, delete it, as the description's planner bullet goes too.
- The limit is 4,000 characters. Counted on the text between the fences (Unicode characters, as App Store Connect
  counts; the em dash is one character): **3,498** with the two bracketed lines, **3,355** without them.

```text
CHANGES SINCE 1.0 (3), REJECTED UNDER GUIDELINE 3.1.1 ON 5 OCTOBER 2026
- Search, the List/Calendar/Matrix views, option details, Compare, Saved and Watches all work on built-in sample data, with no account, key or sign-in. Only booking links and connecting a seats.aero account are unavailable while sample data is on.
- Connecting a seats.aero account is optional (Settings > seats.aero account) and only replaces the sample data with results from the user's own account. No screen or feature is withheld without it. The word "Pro" is gone from the app.
- Connecting happens only through seats.aero's own sign-in (Login with Seats.aero, OAuth 2.0). The app no longer asks for an API key and has no field to paste one.
- Ask, which used the user's own Anthropic API key, is removed from this version.
- No In-App Purchases, no paid tier, and no purchase links or calls to action in the app, its metadata or our support pages.
[- As discussed with App Review on <date>: <one-line summary>.]

HOW TO REVIEW (no login needed; works offline)
1. On first launch, tap "Try with sample data" on the Welcome screen. Every screen then shows a banner titled "Sample data" with the line "Illustrative data — not live availability". Sample data is generated on the device and sends nothing.
2. Search any route with a date window, for example "Hong Kong to Seattle next month, business" or "LAX to Tokyo next month", or tap "Try Hong Kong to Seattle, next 30 days, business" where it is offered. Sample data covers the 84 airports the app recognises, for the next 12 months.
3. Switch between List, Calendar and Matrix, change the filters, and open an option's details.
4. Select two options and tap "Compare selected options". Save an option (Saved tab). Tap "Watch this search" (Watches tab).
5. "Exit sample data" is in the banner; it returns to the Welcome screen.
The Welcome screen also offers "Plan a trip", which shows how a typed trip is read, on the device, with nothing sent.
We request approval of this built-in sample-data mode as the review path under Guideline 2.1.

OPTIONAL: THE USER'S OWN SEATS.AERO ACCOUNT
People who already have a seats.aero account with API access can connect it, after "Exit sample data", in Settings > seats.aero account with "Connect seats.aero". It opens seats.aero's own sign-in and consent page (Login with Seats.aero, OAuth 2.0) in the system sign-in sheet, where seats.aero asks them to sign in and approve AwardGrid; AwardGrid never sees their password. seats.aero is a separate company; AwardGrid does not sell or issue access to it. seats.aero confirmed in writing on 7 October 2026 that AwardGrid may use Login with Seats.aero. A small token service at awardgrid.dowhiz.com holds AwardGrid's OAuth client secret and exchanges and refreshes the sign-in tokens; it stores nothing. The tokens stay in the iOS Keychain, searches go from the device directly to seats.aero, and seats.aero's results are kept on the device for at most 24 hours. "Disconnect" removes the tokens and those results. Results from the account are labelled "Data: seats.aero" with a link to seats.aero. seats.aero accounts are individual and may not be shared, so we cannot provide one. The attached recording shows sign-in on our own account.
[seats.aero approved our Login with Seats.aero app for general use on <date>.]

AwardGrid for iPhone has no accounts of its own, no analytics, no ads and no tracking.
Contact: Logan Ye, knowhiz.us@gmail.com, Pacific Time. We reply the same day.
```

## Where each quoted string comes from

Every string in quotation marks is the app's own, as the App Store build (`npm run build:store`, the OAuth flavour)
shows it in English:

| In the notes | Source |
|---|---|
| "Try with sample data" (the Welcome screen's first button) | `apps/ios/src/sample/sample-copy.ts:53` |
| The banner's title "Sample data", and "Exit sample data" in it | `apps/ios/src/sample/sample-copy.ts:55-56` |
| The banner's line "Illustrative data — not live availability" | `packages/core/src/lib/workspace/present.ts:66` (`demo.synthetic`) |
| "Try Hong Kong to Seattle, next 30 days, business" (offered on an empty result or an unread text) | `apps/ios/src/sample/sample-copy.ts:62` |
| 84 airports, the next 12 months (the app's own coverage note) | `apps/ios/src/sample/airports.test.ts:27`; `sample-copy.ts` `coverage` |
| "Hong Kong to Seattle next month, business" and "LAX to Tokyo next month" return rows | `e2e/uiux/store-sample-mode.spec.ts` (project `ios-store`) |
| "Compare selected options" | `packages/core/src/lib/workspace/present.ts:45` |
| "Watch this search" | `apps/ios/src/components/results/copy.ts:205` |
| "Plan a trip" | `apps/ios/src/components/plan/plan-copy.ts:68` |
| Settings > "seats.aero account" | `apps/ios/src/screens/settings-copy.ts:66` |
| "Connect seats.aero", and the page's sentence that seats.aero asks you to sign in and approve AwardGrid and that AwardGrid never sees your password | `apps/ios/src/screens/oauth-copy.ts:45`, `:41` |
| "Disconnect" | `apps/ios/src/screens/oauth-copy.ts:62` |
| No field to paste a key: the store build carries neither the key page nor its words | `apps/ios/package.json:10` (`build:store` sets `VITE_AG_CONNECT=oauth`); `apps/ios/src/app/App.tsx` (`OAUTH_BUILT`); `apps/ios/scripts/check-store-bundle.mjs` |
| Results kept on the device for at most 24 hours | `apps/ios/src/retention/short-term.ts:31` |
| "Data: seats.aero" with a link to https://seats.aero | `apps/ios/src/components/results/copy.ts:220`; `apps/ios/src/components/SeatsAttribution.tsx` |
| The token service stores nothing | `sites/auth/src/index.ts:16-19`; `sites/auth/wrangler.jsonc` |

The `ios-store` UI/UX e2e project (fixture host served as the OAuth flavour, `e2e/uiux/store-*.spec.ts`) walks the
sample-data path above and the sign-in path with seats.aero played in the page: Connect seats.aero, a declined and a
cancelled sign-in, a search on the connected account, and Disconnect. It is not a device run: the end-to-end check
against seats.aero on a device is plan step 47F.4, after the token service is deployed.
