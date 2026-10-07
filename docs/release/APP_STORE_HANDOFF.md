# AwardGrid iOS: App Store release handoff (v1.0)

Written 2026-09-25 at the end of the UI/UX v1 session, for the session that ships the iOS app. The start prompt for that session is at the end of this file.

**Status after the release session (2026-09-25):** `docs/release/IOS_1.0_RELEASE.md`, on branch `release/ios-1.0`: the decisions as taken, what was built and verified where, and the owner's remaining steps.

**Where things stand:**
- `main` is at `d998cf5` and pushed; CI is fully green (run `36117314251`: checks, e2e, visual, docker smoke, gitleaks).
- The web app is deployed from this commit.
- The iOS app (`apps/ios`, Capacitor 8 + React 19 + Vite, Xcode project `apps/ios/ios/App`) has **never been released, never been archived, never been signed for a device, and never run on a physical iPhone**. This is the first App Store submission.

**How this file was built:**
- A read-only research pass over the repo: four readers (the Xcode project, App Review and privacy, verification status, environment) plus a completeness critic.
- A read-only look at the Apple Developer portal and App Store Connect in the owner's signed-in browser on 2026-09-25.
- Facts carry their source. "Inference" and "external" mark what was not read from the repo or Apple's pages; check external rules against Apple's current pages before you rely on them.

---

## 1. Account state and deadlines (read 2026-09-25)

| Item | State |
|---|---|
| Team | **Curastone CORP.**, Team ID **`232AGCYZ2Z`**, enrolled as an **Organization** |
| The owner's role | **Admin**, not Account Holder. The Account Holder is another person on the team. |
| Program License Agreement | **Updated, not yet accepted.** The Account Holder must accept it **by October 1, 2026**, or the team loses access to Certificates, IDs & Profiles, App Store Connect and the App Store Connect API. App Store Connect also says that no new app can be submitted until it is accepted. |
| Membership | Renewal date **October 10, 2026**. The portal says the renewal **"wasn't renewed successfully"**, and only the Account Holder can renew. |
| App ID `com.dowhiz.awardgrid` | **Not registered.** The team has nine App IDs, mostly `com.curastone.*`, plus an Xcode wildcard (`*`). *Registered later on 2026-09-25 by the release session: `IOS_1.0_RELEASE.md` B3.* |
| App Store Connect record | **None for AwardGrid.** The team has other apps (Restful, Lets ×3, MemCatch, KnoWhiz). *Created later on 2026-09-25 by the release session: `IOS_1.0_RELEASE.md` B4.* |
| What an Admin may do | Register App IDs and devices, and create app records in App Store Connect. The Account Holder is needed for agreements and renewal. |
| Signing on this Mac | The login keychain has one Apple Distribution and one Apple Development identity. The research pass reported the Distribution one as belonging to Curastone CORP.; confirm in Xcode › Settings › Accounts. There are 2 provisioning profiles; whether any matches the app was not checked. |

**Blocking owner actions, before anything else:**
1. The Account Holder accepts the updated agreement (before **Oct 1**).
2. The Account Holder fixes the membership renewal (before **Oct 10**).

Without these, nothing can be uploaded, and after Oct 1 even Certificates, IDs & Profiles closes.

---

## 2. Owner decisions (the agent must ask; recommendations given)

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| D1 | **seats.aero permission to distribute** (docs/PIVOT.md §0, "Still open. No email sent.") | seats.aero's terms allow non-commercial Pro use of the Partner API. Guideline 5.2.2 requires permission to use a third-party service, "provided upon request". App Store Connect asks about content rights. Ask also sends seats.aero results to Anthropic (#81). | Email support@seats.aero (PIVOT.md:60) and keep the written answer for App Review. Until it arrives: TestFlight **internal** testing only, no public submission. |
| D2 | **Bundle ID** | It is permanent after the first upload. It is hard-coded in 4 places: `project.pbxproj:366,386`, `capacitor.config.ts:4`, `App.entitlements:16`, `probes/run-probes.sh:44`. The seller shown on the store will be Curastone CORP. | Keep `com.dowhiz.awardgrid` (a domain the owner uses), or switch to `com.curastone.awardgrid` to match the team. Decide before registering the App ID. |
| D3 | **Names and version** | The home-screen name is lowercase `awardgrid` (Info.plist:8). The executable, `.app` and `.ipa` are all named `App`. The version is 1.0, build 1. The store name must be unique and at most 30 characters. | Choose the store name and the display name; ship 1.0 (1); bump the build number on every upload (§4.9). |
| D4 | **iPhone only, or iPhone and iPad** | `TARGETED_DEVICE_FAMILY = "1,2"`. The app has never run on an iPad. Keeping iPad requires 13" iPad screenshots, and App Review may test on one. External: a later version **cannot drop iPad** once one ships with it. | **iPhone only for 1.0** (`TARGETED_DEVICE_FAMILY = 1` at pbxproj:370,390). iPhone apps still run on iPad in compatibility mode, so smoke-test that on a fresh iPad Simulator. |
| D5 | **Minimum iOS** | It is 15.0 today, but the web bundle does not parse before **iOS 16.4**: the main chunk has regex lookbehind literals and calls iOS 15.4+ APIs (critic, checked against the built chunk). Nothing below iOS 18.3 has ever run. | Raise `IPHONEOS_DEPLOYMENT_TARGET` at pbxproj:294,345,362,383 to **at least 16.4**. Choose **18.0** unless the owner wants older devices and allows downloading a 16.x/17.x Simulator runtime to test them. The Podfile and Pods can stay at 15.0. |
| D6 | **App icon and launch screen** | Both are Capacitor's placeholder artwork (same hashes as the template) and show the Capacitor logo. That invites rejection under 2.1, 2.3.8 and 5.2.1. The splash is also white in Dark Mode. | The owner supplies a 1024×1024 PNG icon with **no alpha channel** and no airline or seats.aero marks. Use a background-only launch screen that adapts to dark mode. |
| D7 | **Privacy policy URL, support URL, contact email** | App Store Connect requires both URLs. Guideline 5.1.1(i) also wants a privacy link inside the app. `LEGAL.md` describes the web app "for fewer than ten friends" and has no contact address. `https://awardgrid.dowhiz.com/legal` is served from the owner's Mac through the tunnel and goes down when the Mac sleeps. | Write an **iOS privacy policy** from §6's facts and host it off the Mac: `sites/landing` is a static page meant for Cloudflare Pages, not deployed yet. Add a support page with an email address. |
| D8 | **App Privacy label** | This is entered in App Store Connect and must match `PrivacyInfo.xcprivacy`. | **Option B**: "Data Linked to You", covering Search History (search parameters sent to seats.aero and, when included, to Anthropic) and Other User Content (Ask questions sent to Anthropic). Purpose App Functionality; no tracking; nothing else collected. Option A ("Data Not Collected") is arguable because requests go on the user's own keys, but it is riskier. **Build 4** (`IOS_1.0_RELEASE.md` §0.1 D8): Search History only; Other User Content leaves App Store Connect, `PrivacyInfo.xcprivacy` and the privacy policy together, because the App Store build has no Ask. |
| D9 | **How App Review uses the app** | *Build 3:* it did nothing live without a seats.aero key, and Ask also needed an Anthropic key. The production build had no demo mode: the fixture host and probes are compiled out, and the only content without a key was a static example screen. Guidelines 2.1 and 4.2 apply. *Build 4:* every feature works without a key on clearly labelled sample data made on the device, for any route between the 84 airports the app recognises (release plan steps 16-17); the App Store build has no Ask (D3 of `IOS_1.0_RELEASE.md` §0.1). | **Superseded 2026-10-06** (`IOS_1.0_RELEASE.md` §0 P16-P17, §0.1 D2): build 4's review path is a clearly labelled sample-data mode, and no key goes to App Review. *Was:* (a) Only if seats.aero agrees (D1): put a seats.aero key in the Review Notes (it spends the owner's 1,000 calls a day; rotate it after review), and optionally an Anthropic key with a low spend limit. Or (b) build a clearly labelled synthetic demo mode (#80) from the existing fixtures. Keys are typed by the owner into App Store Connect, **never handled by the agent**. |
| D10 | **Consent before data goes to Anthropic** | External (verify): the November 2025 revision of 5.1.2(i) requires explicit permission before sharing personal data with third-party AI. Today the app shows disclosures but never asks. | Add a one-time consent sheet before the first Ask request or when the Anthropic key is saved: name Anthropic, list what is sent (the `ANTHROPIC_DATA_SENT` text), offer "Allow" and "Not now", with EN and ZH copy and tests. |
| D11 | **Territories and platforms** | External: mainland China needs an ICP filing, and approval for generative-AI features, and the Anthropic API is unavailable there. The EU requires a DSA trader or non-trader declaration. New iPhone apps are offered by default on Apple silicon Macs and Vision Pro, where this app has never run. | Exclude mainland China. Answer the DSA question. In Pricing and Availability, untick Mac ("Designed for iPad") and Vision Pro for 1.0; this can be changed later. |
| D12 | **Price, category, age rating** | Price is an open owner question. The repo's "no money" boundary (no paywall, cost-sharing or subscription logic) stands until the owner retires it (PIVOT §7 Q2, Q3), and a paid app worsens D1 and 3.1.1 (PIVOT §5). External: the age questionnaire was revised in 2025, and Ask returns AI-generated text, so the rating is not a given. | Free. Category Travel. Answer the live questionnaire honestly (Ask is scoped to award availability: `packages/core/src/lib/ask/prompt.ts:23-33`). Do not write "4+" anywhere until the form produces it. |
| D13 | **Known functional issues** | **#89**, the grid half of E2: one failing route list fails the whole search and discards the rows already paid for. The iOS app uses core's plain `RoutesCatalog` (`apps/ios/src/app/bootstrap.ts:320`); the Web uses `ResilientRoutesCatalog` (`src/lib/server/find.ts:130`). **The Ask half of E2:** with one route-list call per search, empty pairs are rarely called "not monitored". **E1's** extra Get Routes call is by design (`SEARCH_ROUTES_CAP`); only its harness criterion is wrong (V13). None has been tested on live data on a device. | Fix #89 in the iOS bootstrap before release (recommended), or list it as a known issue. |
| D14 | **Release hygiene** | Source maps (about 4.4 MB, with the original TypeScript) ship inside the app. `Podfile.lock` is gitignored, so the archive cannot be rebuilt from git alone. Build numbers can be rewritten by Xcode's export (§4.9). | Turn source maps off for release, or strip `*.map` before `cap copy`. Commit `Podfile.lock`, or record its checksums in the release notes. Choose one build-number scheme. |

---

## 3. Engineering work the agent can do (on a release branch)

All of this happens in a worktree on a branch from `main` (§7), with a commit per step and an explicit file list. None of it is pushed or merged without asking.

1. **Privacy manifest (blocker).** Add `apps/ios/ios/App/App/PrivacyInfo.xcprivacy` and wire it into `project.pbxproj`: a file reference, a child of the App group, a build file, and Copy Bundle Resources.
   - Contents: `NSPrivacyTracking` false; `NSPrivacyTrackingDomains` empty; `NSPrivacyAccessedAPITypes` = FileTimestamp (`NSPrivacyAccessedAPICategoryFileTimestamp`, reason `C617.1`); `NSPrivacyCollectedDataTypes` matching D8.
   - Why: IONFilesystemLib 1.1.4 (under `@capacitor/filesystem`) calls the file-timestamp APIs and ships no manifest. External: uploads without the declaration are flagged (ITMS-91053). The Capacitor and CapacitorCordova pods carry their own manifests. KeychainSwift 21.0.0 ships none.
2. **Info.plist** (`apps/ios/ios/App/App/Info.plist`):
   - add `ITSAppUsesNonExemptEncryption` = false. The only crypto is HTTPS through URLSession and the Keychain, both OS-provided and exempt; without the key, every build stops at "Missing Compliance";
   - change `UIRequiredDeviceCapabilities` from the template's `armv7` to `arm64`;
   - add `CFBundleLocalizations` [en, zh-Hans] if Chinese should appear in the store's language list. Note: the app already switches to zh from `navigator.language`, which reads `zh-CN` on a Chinese device (checked in T07 on iOS 26.5 and 18.3 Simulators).
3. **Targets:** the deployment target (D5) and the device family (D4) in `project.pbxproj`.
4. **Artwork:** replace `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and its `Contents.json`, and the Splash images or `LaunchScreen.storyboard` (D6), once the owner supplies the art.
5. **In-app legal and consent:**
   - a Privacy Policy link, and the non-affiliation sentence from LEGAL.md:51-52 ("not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or any loyalty program"), under Settings › About, in EN and ZH;
   - an Acknowledgements entry generated from what actually ships, since MIT and ISC require the notice to ship with copies. That is the npm packages named in the release build's source maps (today: react, react-dom, scheduler, react-router, zod, @anthropic-ai/sdk, standardwebhooks, @stablelib/base64, fast-sha256 (Unlicense), @noble/hashes, @capacitor/core, @capacitor/filesystem, @capacitor/synapse (ISC), @aparajita/capacitor-secure-storage), the pods (Capacitor, CapacitorCordova, KeychainSwift, IONFilesystemLib), and Inter (OFL);
   - the Anthropic consent sheet (D10).
   - `honesty.test.ts` and `locale-parity.test.ts` guard all copy, so run them.
6. **Fix #89** if D13 says so.
7. **Docs, after D1:**
   - LEGAL.md (lines 3-5 say "fewer than ten friends … deployed privately"; it also renders on the live web `/legal`);
   - the no-badge comment and the "Where this is up to" section, `sites/landing/index.html:153-169`, which say "It is not on the App Store";
   - a release runbook in `apps/ios/README.md`;
   - `apps/ios/README.md:117-122,202`, which are stale on the live-key checks and the test count (811).
8. **Build the bundle that ships**, then archive (§4).

**Traps:**
- **Xcode's "Update to recommended settings":** do not accept it for this project (LastUpgradeCheck 0920). Inference: it can set `ENABLE_USER_SCRIPT_SANDBOXING = YES`, which breaks the CocoaPods script phases. If it was accepted, set it back to NO and review the pbxproj diff.
- **No test reads the native config:** `Info.plist`, `project.pbxproj`, `App.entitlements` and `capacitor.config`. Verify native edits by inspecting the built archive (§4.7).
- **Keychain entitlement:** `App.entitlements` has one key, `keychain-access-groups = [$(AppIdentifierPrefix)com.dowhiz.awardgrid]`. It must follow D2.

---

## 4. Build, archive and upload (agent builds; owner signs in and uploads)

Run from the worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux` (all paths below are relative to it), with the arm64 toolchain first: `export PATH="$HOME/.local/node-arm64/bin:$PATH"`.

1. **Local gates.** The release branch is not pushed, so CI will not run on it. On `main`, CI runs typecheck, lint and unit tests for every package, iOS included, but never the iOS bundle build, the UI/UX Playwright suite or Xcode:
   - `pnpm typecheck && pnpm lint && pnpm test` (at d998cf5: root 964 passed / 2 skipped, core 966, iOS 811);
   - `UIUX_WEB=0 pnpm exec playwright test --config=playwright.uiux.config.ts` (the iOS browser mock; never at the same time as `pnpm e2e`).
2. **Web bundle:** `pnpm --filter @awardgrid/ios build:store`, run as `env -u VITE_AG_PROBES -u VITE_AG_STORE` (the script sets `VITE_AG_STORE=1` itself). This builds the App Store flavour, with Ask compiled out, and then runs `scripts/check-fixture-free-bundle.mjs` (it must print "none found in dist"), `scripts/check-store-bundle.mjs` and `scripts/acknowledgements.mjs --check`. The plain `build` keeps Ask: it is for development, the probes and e2e, never for an archive. *(Builds 1-3 were archived from `build`; build 4 is the first from `build:store`, release plan steps 14 and 29.)*
3. **R1 (probe-free), by hand:**
   - `ls apps/ios/dist/assets | grep -Ei 'probe|e2e'` prints nothing;
   - `grep -c '127.0.0.1:45\|localhost:45\|probe-server\|sk-ant-' apps/ios/dist/assets/*.js` counts 0 in every file;
   - if source maps are kept, check the `*.js.map` files too.
4. **Copy into Xcode:** `(cd apps/ios && npx cap copy ios)`, then `(cd apps/ios && node scripts/check-store-bundle.mjs ios/App/App/public)`: `ios/App/App/public` is gitignored and keeps whatever was copied last, so the check shows that the bundle Xcode archives is the store flavour too, not an earlier `build`. **`cap sync` only after a dependency bump**: it runs `pod install` against the network (the owner's OK, §7), and the licenses list must then be written again. That is the release plan's step 4b sequence (`env -u VITE_AG_PROBES npx vite build`, `LANG=en_US.UTF-8 npx cap sync ios`, `node scripts/acknowledgements.mjs`, then §4.2-§4.4 again with `cap copy`), and `ios/App/Podfile`, `ios/App/Podfile.lock`, any `project.pbxproj` change and `src/about/acknowledgements.json` go in a commit before the archive. Otherwise the Pods are already installed and pinned by the committed `Podfile.lock`. Same as `apps/ios/README.md` › "Release" step 3.
5. **Signing.** The owner signs in to Xcode › Settings › Accounts with their Apple ID; **the agent never types the Apple ID, password or 2FA**. The owner, or the agent with the owner's per-action OK in the browser, registers the App ID from D2. Then either pass `DEVELOPMENT_TEAM=232AGCYZ2Z` on the xcodebuild command line, which keeps it out of git, or commit it if the owner prefers. Automatic signing needs nothing else: the Pods' resource bundles have signing off, and their frameworks are re-signed by "[CP] Embed Pods Frameworks".
6. **Archive:**
   ```
   xcodebuild -workspace apps/ios/ios/App/App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath <dir outside /tmp and the repo>/awardgrid-1.0-<build>.xcarchive DEVELOPMENT_TEAM=232AGCYZ2Z -allowProvisioningUpdates archive
   ```
   **`-allowProvisioningUpdates` writes to the developer account.** For automatically signed targets, it lets xcodebuild create or update App IDs, provisioning profiles and certificates on the team (`xcodebuild -help`). Run it only after the owner has registered the D2 App ID and confirmed the certificates in Xcode › Settings › Accounts, and ask the owner before each run that uses it. Without the flag, the archive uses only the profiles already on this Mac. Or the owner archives from Xcode.

   The `App` scheme is autogenerated on this Mac and not shared; sharing it writes `xcshareddata`. Put archives in `~/Library/Developer/Xcode/Archives/<YYYY-MM-DD>/`, so Organizer lists them for §4.7 and §4.8. Never use `/tmp`, which is cleaned after about 3 days.
7. **Inspect what ships**, in the archive's `Products/Applications/App.app`:
   - `plutil -p Info.plist` shows `MinimumOSVersion` at the D5 value, `ITSAppUsesNonExemptEncryption` false, no `NSAppTransportSecurity`, no `CAPACITOR_DEBUG`;
   - `PrivacyInfo.xcprivacy` sits at the `.app` root;
   - `public/` has no probe or e2e chunk, R1 matches nothing, and there is no `*.map` if D14 removed them;
   - the icon is the new one;
   - Xcode Organizer › Generate Privacy Report.
8. **Upload.** The owner uploads with Xcode Organizer › Distribute App › App Store Connect. Transporter takes an `.ipa`, not an archive, so for Transporter first export one: `xcodebuild -exportArchive -archivePath <archive> -exportOptionsPlist <plist: method app-store-connect, teamID 232AGCYZ2Z> -exportPath <dir>`. External: Organizer's "Manage Version and Build Number" can rewrite `CFBundleVersion`.
9. **Build numbers:** bump `CURRENT_PROJECT_VERSION` (pbxproj:363,384, both configurations; `MARKETING_VERSION` stays 1.0) in a commit before each archive, and switch Xcode's auto-management off (both `ExportOptions-*.plist` set `manageAppVersionAndBuildNumber` false, D14). Or let Xcode manage it and record the uploaded number. Each upload needs a higher build number. 1.0 (4), the resubmission after the 3.1.1 rejection, is `CURRENT_PROJECT_VERSION = 4` (release plan step 28).
10. **TestFlight internal first:**
    - install on the owner's iPhone and run §5;
    - then, only after D1, fill in the metadata and let the **owner** press Submit for Review.

**Debugging on a device:** Release and TestFlight builds have the Web Inspector off (`isWebDebuggable` only under DEBUG or CAPACITOR_DEBUG). If the first device build shows a blank screen, nobody can attach Safari. So first install a **Debug** build from Xcode on the owner's iPhone: development signing with the team, and Developer Mode on. Inspect it with Safari › Develop, then verify the TestFlight build.

---

## 5. Verification before Submit for Review

Nothing below has run on a physical device. Two iPhones are paired to this Mac (model IDs `iPhone19,2` and `iPhone14,7`); both were not connected when checked. Live-key steps spend the owner's quota or money: **ask the owner first, every time**, and let them type the keys into the app themselves.

| # | Check | How | Status |
|---|---|---|---|
| V1 | First launch | Home-screen icon and name; launch screen; the welcome screen with no key and nothing sent (no quota line is shown without a key; after V2's key check, Search reads "seats.aero calls today: 1 of 950", from the check alone); the four tabs; no native-HTTP startup error | never on device |
| V2 | Keychain and key pages (A20) | Settings › seats.aero key: Paste (one system paste prompt) › Check and save (1 counted call) › "On file ••••last4" › force-quit and relaunch, still on file › Remove key. The same for the Anthropic key (Check sends `GET /v1/models/claude-opus-5`, with no question). No `-34018` (that would mean the entitlements did not apply). | never on device |
| V3 | Live search (owner's consent) | One text search, e.g. "HKG, SHA to SEA, next 30 days, business and first". In PHASE5 §3.4 the same search cost 27 seats.aero calls in total, route lists plus results. The route catalogue is kept in memory only (#75), so expect about that much on the first search after each launch. Check List, Calendar, Matrix, coverage notices, the quota line, a detail with "View flight itineraries" (one Get Trips call), a booking link opening Safari, and copy | never live on the UI/UX v1 build |
| V4 | Ask, live (consent) | Include the last search and ask one question: an answer, "Data: seats.aero", a meta line. Stop at about 5 s: "Stopped … may be billed". Background mid-question for about 30 s: one terminal state (K4). Force-quit mid-request, then relaunch: "unfinished" (A28, native half) | K1, K3 and K2's Stop half ran on the owner's Simulator (A480530B) on 2026-09-23, before UI/UX v1; K2's billing half (the owner's Console), K4, K5 and K6 never ran |
| V5 | VoiceOver (A15, A36) | Tab bar names and badge; results cards; the Matrix (one stop per cell); calendar; detail dialog and focus return; compare (a fifth pick refused and announced); Settings radio groups; Ask status | never run anywhere |
| V6 | Touch (A16) | Swipe the Matrix sideways at a large text size: it settles on whole columns, nothing cropped. Momentum and overscroll. Ask's list does not jump while scrolled up | mouse only |
| V7 | Keyboard and dates (A10, A20) | Query editor: the Find button stays visible and tappable above the keyboard. The wheel date picker. Typing dates a month at a time sends zero requests. The Ask composer and Stop above the keyboard | Find and the composer above the keyboard: stand-in keyboard in the iOS browser mock only (A20). Typing a date a month at a time: never (A10 partial). The wheel date picker: never |
| V8 | Safe areas and landscape (A12, #90) | Scroll the results on a Dynamic Island iPhone (header never under the island). Detail, compare bottom bar, Ask, Settings. Rotate results and compare to landscape | first screen only, Simulator |
| V9 | Dynamic Type (A35) | Large, xxxLarge, AX Large, AX xxxLarge across results (three views), editor, details, compare, Ask, Settings key pages, Saved: no clipping, no sideways scroll | first screen only, Simulator |
| V10 | Watches, persistence, appearance | Save a watch, background, return: it checks only on open or return, with no notification prompt. Save an option and a snapshot, force-quit, reopen offline: no call. Light or Dark against the system setting, and the strip under the tab bar matches | Appearance: Simulator only, partial (U-059). Watches, persistence and offline reopen: iOS browser mock only, never on a Simulator or device |
| V11 | Device-only extras | No "Save Password?" sheet after typing a key (AutoFill would copy it to iCloud). Airplane-mode launch, search and Ask. Delete and reinstall: inference, the Keychain keys may survive an uninstall, so check and word the privacy policy to match. Device language Chinese: the app opens in zh | never |
| V12 | Simulator passes, on **new** devices created for this | iPad compatibility (D4) and 6.9" screenshots, on devices made for this, e.g. `xcrun simctl create "awardgrid iPad 13" com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB com.apple.CoreSimulator.SimRuntime.iOS-26-5`, and the same with the iPhone-17-Pro-Max type. The stock `iPad Pro 13-inch (M5)` and `iPhone 17 Pro Max` hold another project's app: never erase, reset or reconfigure them | — |
| V13 | Phase 5 harness (A28 native half, E-scenarios) | Update `apps/ios/src/probes/e2e-driver.ts` (Settings is now five S08 groups; the quota line is a `<p class="ag-results-meta">`; E1 must include a search, U-051; the A4 layout states) and the verdicts in `probe-log.mjs`. Then run it on a fresh Simulator with the command in §7 | stale (U-028); optional for the release |

Full context for each A-number is in `docs/uiux-v1/ACCEPTANCE.md` and `docs/uiux-v1/NEXT_SESSION.md`. The Phase 5 transport probes are described in `docs/PHASE5.md`.

---

## 6. Facts for the listing, the privacy label and the review notes

**What the app sends, and where (from code):**
- **seats.aero:**
  - Destination: `https://seats.aero/partnerapi/`, with the user's key in the `Partner-Authorization` header, over native URLSession via CapacitorHttp, never the WebView's fetch.
  - Content: search parameters (airports, dates, cabins, programs), an availability id for Get Trips.
  - Triggers: searches, key checks (1 call), detail lookups (1 call), watch checks on open or return, and, in a build with Ask, Ask's tool calls (at most 8 tool calls and 12 seats.aero calls per question).
- **Sample data (build 4):** nothing. Without a seats.aero key the app runs on sample data made on the device (`apps/ios/src/sample/`): its transport answers in memory and never calls the native HTTP adapter, and its in-memory placeholder key is never saved or sent. The step-20 Simulator QA (2026-10-07) saw no request to seats.aero in sample mode.
- **Anthropic:** never from the App Store build, which has no Ask (`build:store`; `IOS_1.0_RELEASE.md` §0.1 D3). In a build with Ask (development, probes, e2e, TestFlight builds 1-3): `api.anthropic.com`, with the user's own key, only for Ask and for the key check. A question sends:
  - the question and today's date;
  - the parameters of the search the user chose to include, and any result rows they attached from it;
  - the seats.aero results of the searches and flight lookups Ask's own tools make, with the remaining seats.aero calls;
  - every earlier question and answer in the same conversation.

  Requests also carry the SDK's headers and Accept-Language. Saving or checking the key sends `GET /v1/models/claude-opus-5`, with no question. The seats.aero key is never sent to Anthropic (LEGAL.md:33-44, `apps/ios/src/ask/labels.ts:547`, `ANTHROPIC_DATA_SENT`).
- **Nothing else:** no AwardGrid server (since `release/ios-1.0`, `awardgrid.dowhiz.com` is in the bundle only as Settings › About's links to the privacy and support pages, opened in Safari; the app sends it no request, though the step-20 Simulator QA saw the app's WebKit network process open a connection to the host as a link is tapped, a preconnect with no HTTP request, which the privacy policy discloses since 2026-10-07), no Telegram, no analytics, crash reporting, ads, tracking, accounts or login. The only native pods are Capacitor, CapacitorCordova, AparajitaCapacitorSecureStorage (KeychainSwift) and CapacitorFilesystem (IONFilesystemLib).

**What stays on the device:**
- **Keychain:** two items, `seats_aero_api_key` (afterFirstUnlockThisDeviceOnly) and `anthropic_api_key` (whenUnlockedThisDeviceOnly). Both have iCloud sync off, and only the last four characters are ever shown.
- **Files in Documents** (included in device backups): `cache.json` (45-minute TTL), `quota.json`, `watches.json`, `ask.json` (up to 1.5 MB), and the two-slot `workspace-v1`, `settings-v1`, `favorites-v1`, `plans-v1` (trip plans, release plan step 18) and `data-source-v1` (the account or sample data, release plan step 16) files. While sample data is on, sample mode keeps its own versions of these files under `sample/`, listed in `sample/files.json`; leaving sample data deletes them.

**Listing rules:**
- **No trademarks as keywords:** "seats.aero", airline names, "Claude" and "Anthropic" do not go in the name, subtitle or keywords (2.3.7). Mention them only nominatively in the description.
- **State the prerequisites:** *superseded 2026-10-06 (`IOS_1.0_RELEASE.md` §0.1 D3 and D6): the description keeps one neutral, link-free sentence about seats.aero Pro, with no "paid" or "subscribe", and Ask is not in the App Store build. Build 4's description (`apps/ios/store-metadata/en-US/description.txt`, 2026-10-07) says that without an account every screen works on labelled sample data, gives that sentence with "by pasting the API key from your seats.aero settings. AwardGrid has no in-app purchases.", and says that watches are checked only when the app is opened.* Was: "requires your own seats.aero Pro subscription and API key"; Ask is optional, on the user's own Anthropic key and billed to it; watches check only while the app is open.
- **No affiliation implied.** Follow the voice in `docs/COPY.md`.
- **Accessibility Nutrition Labels:** leave them blank, or claim only what V5/V9 verified.

**Screenshots:** 6.9" iPhone (plus 13" iPad if D4 keeps iPad). Use real results only under D1's permission; otherwise use clearly synthetic data rendered by the real app.

**Review Notes:** *superseded for build 4 by `docs/release/appreview/review-notes-1.0-4.md` (two variants: a pasted key, or seats.aero's own sign-in). The list below is the build-3 draft.*
- what the app is, and that the keys are credentials for the user's own third-party accounts: nothing is sold or unlocked by the developer, and there is no purchase path (3.1.1);
- how to test (D9);
- the seats.aero permission (D1);
- that Ask is optional.

---

## 7. Environment and safety rules for the release session

- **Toolchain:** `export PATH="$HOME/.local/node-arm64/bin:$PATH"` before any node or pnpm command; the default node is x64 under Rosetta. pnpm 12.3.4; Xcode 26.6 (17F113).
- **The main checkout `/Users/yegaoyang/Desktop/workspace/awardgrid` is production.**
  - LaunchAgent `com.awardgrid.app` runs `next start` there, and Cloudflare Tunnel `com.awardgrid.tunnel` exposes it at `https://awardgrid.dowhiz.com`. The server reads `.next`, `node_modules`, `drizzle/`, `LEGAL.md` and `build/plugin` from it at runtime.
  - Never run `pnpm build`, `next build` or `pnpm e2e` there. Never commit, switch branches or leave files there without the owner's OK. Never restart `:3000`.
  - iOS build outputs are not read by the web server, but do iOS work in a worktree anyway.
- **Worktree:**
  - Use `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`. It holds node_modules, Pods, `Podfile.lock`, `build/plugin`, vendor and DerivedData. It is on branch `docs/app-store-handoff`, which is `main` plus this file. Start the release branch from it: `git switch -c release/ios-1.0 docs/app-store-handoff`, or from `main` once this file has been merged there. **Open the release session in this worktree, not the main checkout.** Subagent and workflow shells reset to the session's directory, so a session opened in the main checkout would run relative commands in production.
  - A new worktree gets its dependencies by APFS clone, never `pnpm install`:
    ```
    for d in node_modules apps/ios/node_modules packages/core/node_modules sites/landing/node_modules; do cp -Rc ../awardgrid/$d $d; done
    ```
    then `rsync -a --exclude=.git ../awardgrid/vendor/travel-hacking-toolkit/ vendor/travel-hacking-toolkit/`, `pnpm build:plugin`, and copy the Pods and `Podfile.lock` from the main checkout. `pnpm install --offline` fails its supply-chain metadata check.
- **Simulators:**
  - **Never use `iPhone 17 Pro` `A480530B-3036-4B12-80D4-F37A6130D898`**: it holds the owner's real seats.aero and Anthropic keys and app data. It is booted right now.
  - **Never use `booted`** in `simctl` commands (apps/ios/README.md does).
  - `run-probes.sh` defaults `SIM_UDID` to the owner's device, so always set it.
  - Keyless devices made for AwardGrid: `awardgrid T22 smoke` `A655D16B-17E7-4DF4-B481-DF9229C8CCE1` (iOS 26.5) and `awardgrid T22 smoke iOS18` `4EDAFC4F-DDCA-47D4-963B-96D2688F5871` (iOS 18.3).
  - For anything else (iPad, the 6.9" screenshots), create new devices (V12). The stock `iPhone 17 Pro Max` (`A5BC8AFF-…`) and `iPad Pro 13-inch (M5)` (`118B5043-…`) hold another project's app: never erase, reset or reconfigure them.
- **Offline Pods:** do not run `pod install` or `cap sync` without the owner's OK, since they use the network. A release needs them only after a dependency bump (§4.4); otherwise `cap copy`. For the probe harness, put a stand-in `pod` first on PATH:
  ```
  mkdir -p <scratch>/shim && printf '#!/bin/sh\n[ "$1" = --version ] && echo 1.16.2\nexit 0\n' > <scratch>/shim/pod && chmod +x <scratch>/shim/pod
  PATH="<scratch>/shim:$PATH" SIM_UDID=<fresh UDID> SE_NAME="<new name>" apps/ios/probes/run-probes.sh --e2e <scratch>/phase5-e2e
  ```
  Without `--e2e`, the harness sends one real (rejected) request to Anthropic.
- **Secrets:** never read or print `.env` (the main checkout has one) or keys. Keys enter only through the app's Settings, typed by the owner. Every real seats.aero or Anthropic call needs the owner's consent.
- **The agent must not:**
  - type the Apple ID, password, 2FA, App Store Connect API keys or app-specific passwords;
  - create accounts;
  - accept agreements, export-compliance attestations or content-rights declarations;
  - upload or submit for review without the owner;
  - register App IDs or create app records without the owner's per-action OK.

  The agent may draft everything (metadata, privacy answers, review notes) for the owner to paste.
- **Git:** commits carry an explicit file list and end with the `Co-Authored-By` line. Never push, merge into `main` or fast-forward it without asking. CI (`.github/workflows/ci.yml`) runs typecheck, lint and unit tests for every package, iOS included, but builds no iOS bundle, runs no `playwright.uiux.config.ts` and no Xcode.
- **This Mac:** keep the lid open during long runs; sleep stalls them.

---

## 8. Sources

- **The repo at `d998cf5`:**
  - `apps/ios/**`: `project.pbxproj`, `Info.plist`, `App.entitlements`, `capacitor.config.ts`, `Podfile`, `vite.config.ts`, `scripts/check-fixture-free-bundle.mjs`, `probes/run-probes.sh`, `README.md`;
  - `docs/PIVOT.md` (§0), `docs/PHASE0.md`, `docs/PHASE5.md`, `docs/DEPLOYMENT.md`, `docs/COPY.md`, `LEGAL.md`, `sites/landing/index.html`;
  - `docs/uiux-v1/{STATUS,ACCEPTANCE,DECISIONS,NEXT_SESSION,FINAL_REPORT}.md`.
- **Apple, read 2026-09-25 in the owner's signed-in browser, nothing changed:**
  - App Store Connect › Apps;
  - developer.apple.com › Account (membership details, agreements);
  - Certificates, IDs & Profiles › Identifiers.
- **External rules marked "external"** (ITMS-91053, 5.1.2(i) as revised in November 2025, the age-rating questionnaire, iPad drop, DSA, China, Mac and Vision Pro defaults): check them on Apple's current pages at submission time.

---

## 9. Start prompt for the release session

Paste this into a new Claude Code session opened in **`/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`**, the release worktree. Never open it in the production checkout.

````
任务：把 AwardGrid iOS app（apps/ios，Capacitor 8）的 1.0 版发布到 Apple App Store。这是第一次发布：从未 archive、从未在真机上跑过。

本 session 应在 worktree /Users/yegaoyang/Desktop/workspace/awardgrid-uiux 中打开（不是主 checkout）。先读交接文档 /Users/yegaoyang/Desktop/workspace/awardgrid-uiux/docs/release/APP_STORE_HANDOFF.md（已提交在 docs/app-store-handoff 分支上；也可用 `git show docs/app-store-handoff:docs/release/APP_STORE_HANDOFF.md` 读）。然后按这个顺序工作：

1. 只读核对：git status、main 是否仍是 d998cf5（或更新），交接文档 §1 的账号状态和 §2 的 14 个决定。把我还没决定的事项（D1–D14）列成一个清单一次性问我，附你的建议；不要替我决定。
2. 在该 worktree 里从 docs/app-store-handoff（若交接文档已合并进 main，则从 main）新建分支 release/ios-1.0，做 §3 的工程项（隐私清单、Info.plist、deployment target、device family、法律与同意文案等），每步带测试、明确文件列表的本地提交。
3. 按 §4 构建和检查：iOS 门禁、web bundle（build:store）、R1、cap copy（只有依赖升级后才用 cap sync，见 §4.4）并对 ios/App/App/public 跑 check-store-bundle、Release archive、检查 archive 里真正要发布的内容。
4. 按 §5 准备真机验证清单；真机和真实 key 的步骤由我来操作或逐项同意。
5. 为 App Store Connect 起草元数据、App Privacy 答案、Review Notes（交接文档 §6），由我粘贴。

硬性规则（详见 §7）：
- 主 checkout /Users/yegaoyang/Desktop/workspace/awardgrid 是线上生产环境：不在那里 build、不在那里提交、切分支或创建任何文件（包括 worktree），不重启 :3000。所有命令都在 worktree 里运行或使用绝对路径；子代理/工作流的 Bash 会把 cwd 重置回 session 目录，不能依赖之前的 cd。
- `xcodebuild -allowProvisioningUpdates` 会在开发者账号上创建/更新 App ID、证书和描述文件：每次使用前先问我。
- 先 export PATH="$HOME/.local/node-arm64/bin:$PATH"。
- 绝不使用 Simulator A480530B-3036-4B12-80D4-F37A6130D898（存有我的真实 key），不用 `booted`，跑 run-probes.sh 必须显式设 SIM_UDID；不要清除或重置 stock 的 iPhone 17 Pro Max / iPad Pro 13-inch 模拟器（装有别的项目的 app），需要时新建模拟器。
- 不读 .env、不输出任何 key；真实 seats.aero / Anthropic 调用每次都要我同意，key 由我在 app 里自己输入。
- 你不能输入 Apple ID、密码、2FA 或 App Store Connect API key，不能创建账号、接受协议或出口合规声明、上传或提交审核；注册 App ID、创建 App Store Connect 记录也要我逐项同意。这些由我来做，你负责起草和准备。
- 未经我同意不 push、不合并到 main、不跑 pod install / cap sync（需要网络）。
- 汇报时把单元测试、iOS 浏览器 mock、Simulator、真机、真实 key 分开写；没执行的写"未验证"。

提醒：账号的 Account Holder 必须在 2026-10-01 前接受新版 Apple Developer Program License Agreement，并在 2026-10-10 前修复会员续费，否则无法上传。开始时先确认这两件事的状态。
````
