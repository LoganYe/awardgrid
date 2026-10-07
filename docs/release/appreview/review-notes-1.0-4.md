# App Review Notes for AwardGrid 1.0 (4)

Drafts for **App Store Connect › AwardGrid › version 1.0 › App Review Information › Notes**, written on 2026-10-07 for
build 4 (the 3.1.1 remediation plan's Draft B, steps 22 and 37). Paste the variant that matches the build chosen at the
gate (plan step 34), in the single App Store Connect pass before resubmission (steps 36-38). Nothing here has been
pasted, saved or sent.

- **Variant 1, a pasted key:** the build that connects with the API key pasted from the user's seats.aero settings
  (`VITE_AG_CONNECT=key`, the default).
- **Variant 2, seats.aero's own sign-in:** the build that connects with "Connect seats.aero" (`VITE_AG_CONNECT=oauth`,
  PR-O). Use it only once that build exists and its token service is deployed (plan step 47F).

Before pasting:

- Delete every line in square brackets, or fill it: `[- As discussed with App Review on <date>: …]` only if App Review
  answered the reply of 2026-10-06 or a call took place; the permission or approval line only if seats.aero's written
  answer exists (it then goes in App Review Information › Attachment too).
- Replace `<phone>` with the contact phone number (decision D14(b)). The time zone is the one the reply of 2026-10-06
  gave. The e-mail address is the public support address on `https://awardgrid.dowhiz.com/support/`.
- The Attachment field holds the screen recording of the connection on the owner's own account (plan step 33). If it
  is not attached, delete the sentence "The attached recording shows …".
- The limit is 4,000 characters. Counted on the text between the fences (Unicode characters, as App Store Connect
  counts; the em dash is one character):

| Variant | With the bracketed lines | Without them |
|---|---|---|
| 1, a pasted key | 2,900 | 2,776 |
| 2, seats.aero's own sign-in | 2,959 | 2,848 |

## Variant 1: a pasted key

```text
CHANGES SINCE 1.0 (3), REJECTED UNDER GUIDELINE 3.1.1 ON 5 OCTOBER 2026
- Search, the List/Calendar/Matrix views, option details, Compare, Saved and Watches all work on built-in sample data, with no account, key or sign-in. Only booking links and connecting a seats.aero account are unavailable while sample data is on.
- Connecting a seats.aero account is optional (Settings > seats.aero account) and only replaces the sample data with results from the user's own account. No screen or feature is withheld without it. The word "Pro" is gone from the app.
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
People who already have a seats.aero account with API access can connect it, after "Exit sample data", in Settings > seats.aero account by pasting the API key from their seats.aero settings and tapping "Check and save". seats.aero is a separate company; AwardGrid does not sell, issue or license that key. When a key is added, the app checks it with one search sent to seats.aero. The key stays in the iOS Keychain, and searches go from the device directly to seats.aero. Results from the account are labelled "Data: seats.aero" with a link to seats.aero. seats.aero accounts are individual and may not be shared, so we cannot provide one. The attached recording shows the connection on our own account.
[seats.aero's written permission dated <date> is attached.]

AwardGrid for iPhone has no accounts, no server of its own, no analytics, no ads and no tracking.
Contact: Logan Ye, <phone>, knowhiz.us@gmail.com, Pacific Time. We reply the same day.
```

## Variant 2: seats.aero's own sign-in (OAuth)

```text
CHANGES SINCE 1.0 (3), REJECTED UNDER GUIDELINE 3.1.1 ON 5 OCTOBER 2026
- Search, the List/Calendar/Matrix views, option details, Compare, Saved and Watches all work on built-in sample data, with no account, key or sign-in. Only booking links and connecting a seats.aero account are unavailable while sample data is on.
- Connecting a seats.aero account is optional (Settings > seats.aero account) and only replaces the sample data with results from the user's own account. No screen or feature is withheld without it. The word "Pro" is gone from the app.
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
People who already have a seats.aero account with API access can connect it, after "Exit sample data", in Settings > seats.aero account with "Connect seats.aero", which opens seats.aero's own sign-in and consent page (Login with Seats.aero, OAuth 2.0). seats.aero is a separate company; AwardGrid does not sell or issue access to it. A small token service at awardgrid.dowhiz.com holds AwardGrid's OAuth client secret and exchanges and refreshes tokens; it stores nothing. Tokens stay in the iOS Keychain, and searches go from the device directly to seats.aero. Results from the account are labelled "Data: seats.aero" with a link to seats.aero. seats.aero accounts are individual and may not be shared, so we cannot provide one. The attached recording shows sign-in on our own account.
[seats.aero approved our OAuth app on <date>.]

AwardGrid for iPhone has no accounts of its own, no analytics, no ads and no tracking.
Contact: Logan Ye, <phone>, knowhiz.us@gmail.com, Pacific Time. We reply the same day.
```

## Where each quoted string comes from

Every string in quotation marks is the app's own, as build 4 shows it in English:

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
| Settings > "seats.aero account", and "Check and save" (variant 1) | `apps/ios/src/screens/settings-copy.ts:78`, `:117` |
| "Connect seats.aero" (variant 2) | `apps/ios/src/screens/oauth-copy.ts:41` on `claude/ios-311-o` |
| "Data: seats.aero" with a link to https://seats.aero | `apps/ios/src/components/results/copy.ts:220`; `apps/ios/src/components/SeatsAttribution.tsx` |

The step-20 Simulator QA (2026-10-07, `awardgrid T22 smoke` on iOS 26.5 and 18.3, and `awardgrid iPad Air 11 M3`, the
review device's type) walked this path in the App Store build, in English and Chinese: Welcome, "Try with sample
data", two typed routes, the three views, details, compare, save, watch and "Exit sample data", with no request to
seats.aero.
