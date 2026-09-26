# AwardGrid iOS 1.0: release status

Release mode **PUBLIC (App Store) since 2026-09-26.** The owner decided on 2026-09-26 not to ask seats.aero first (§0 P1). It was first
written on 2026-09-25 for release mode INTERNAL_PRIVATE (the owner's own use through internal TestFlight), and §1-§9
still describe that build. `release/ios-1.0` merged as `927b70b` ([PR #99](https://github.com/LoganYe/awardgrid/pull/99))
and was deployed to the web app on 2026-09-26. The App Store work continues on `release/ios-1.0-appstore` in the
worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`. The account state, the rules and the background are
in `APP_STORE_HANDOFF.md`.

---

## 0. Public release (the owner's decision, 2026-09-26)

The owner chose a public App Store release. This reverses D1 and D9 as first applied (internal TestFlight only, no
review access). The owner also set aside the handoff's rule of waiting for seats.aero's written permission (P1).
The App Store Connect work below was done on the owner's OK. Submission waits for the Account Holder (P2).
Meanwhile build 1.0 (1) is Ready to Test in TestFlight (internal; expires 90 days after upload). Create an internal
group with the owner, then install it from the TestFlight app.

| # | Step | Who | State |
|---|---|---|---|
| P1 | seats.aero's permission | Owner | **Not sought, by the owner's decision (2026-09-26):** every user brings their own Pro key, and the owner's own key is not used commercially. The draft to support@seats.aero stays unsent in the owner's Gmail. If App Review asks for authorization under 5.2.2, the answer is seats.aero's terms for Pro users, or that e-mail |
| P2 | Accept the updated Program License Agreement (B1) | Account Holder | Open. App Store Connect refuses submissions until it is accepted |
| P3 | The membership renewal (B2) | Account Holder | Open |
| P4 | How App Review uses the app (D9) | Owner | **Decided: explained in the Review Notes** (no key, no demo mode). The notes say what works without a key and invite the reviewer to write to knowhiz.us@gmail.com for live results. Risk: a 2.1 rejection that asks for access |
| P5 | Build 1.0 (2), without the internal-only flag | Agent | **Uploaded 2026-09-26 00:54** with the owner's OK; processed, and **selected on version 1.0** |
| P6 | App Information: subtitle "Award seats in one table"; primary category Travel | Agent | **Saved** |
| P7 | Price: Free | Agent | **Saved:** $0.00 in 175 countries or regions |
| P8 | Availability: every country or region except China mainland. Apple silicon Mac and Vision Pro: off (D11) | Agent, on the owner's OK | **Saved 2026-09-26:** 174 countries or regions, China mainland "Not Available"; Mac and Vision Pro off; distribution Public |
| P9 | Version 1.0: screenshots, promotional text, description, keywords, support and marketing URLs, copyright | Agent | **Saved:** the 7 en-US screenshots in the 6.9-inch set, in order (list, calendar, matrix, details, compare, watches, Ask; the 6.5-inch set uses them); the §7 texts; `https://awardgrid.dowhiz.com/support/` and `/ios/`; "2026 Curastone CORP."; release automatically after approval |
| P10 | App Privacy; age rating; content rights; DSA; regulated medical device | Agent, on the owner's OK | **Done 2026-09-26.** App Privacy published (D8: Search History and Other User Content, app functionality, linked, no tracking; privacy policy URL set). **Age rating 4+**: every question No or None, from the app's facts, and no override; Brazil shows ALL and Korea 00+. **Content rights**: the app shows third-party content (seats.aero's data), and the owner holds that it has the necessary rights. **DSA**: the account already declares non-trader, as for Restful. **Medical device**: not asked of a Travel app with no medical content |
| P11 | App Review information | Agent | **Saved:** contact Logan Ye with Restful's phone number, e-mail knowhiz.us@gmail.com; sign-in not required; the notes (P4) |
| P12 | Submit for Review | Owner, or the agent with an allow rule | **Only P2 (the agreement) remains.** Then: version 1.0 › Add for Review › Submit |
| P13 | Once approved: LEGAL.md, the landing page and the privacy policy stop saying the app is tested privately and not on the App Store | Agent, with the owner's OK | Later |

**Build 1.0 (2)** (`183dcce`: `CURRENT_PROJECT_VERSION` 2, `ExportOptions-AppStore.plist`). Archived on 2026-09-26
without `-allowProvisioningUpdates`, because the profiles from build 1 are on this Mac:
`~/Library/Developer/Xcode/Archives/2026-09-26/awardgrid-1.0-2.xcarchive`. Exported with `testFlightInternalTestingOnly`
false. Signed Apple Distribution: Curastone CORP. with the team's store profile; `codesign --verify --deep --strict`
passes. `get-task-allow` false; 1.0 (2); `MinimumOSVersion` 18.0; `UIDeviceFamily` [1]. No maps, R1 0 hits, and
`public/` is byte-identical to build 1.

**Screenshots:** `docs/release/appstore/1.0/en-US` (7) and `zh-Hans` (6), 1320×2868 (the 6.9-inch size), RGB.
`e2e/uiux/appstore-screenshots.spec.ts` renders them from the real app with the fixture's synthetic data, at that
phone's safe areas (`UIUX_STORE_SHOTS=<dir>`). The Ask screenshot (en-US 07) shows the scripted answer, and "Claude"
in the app's own title. Using it is the owner's choice.

**Web:** main `927b70b` deployed on 2026-09-26 after its CI passed. `/legal` shows the new LEGAL.md; the static
assets and `/ios/`, `/privacy/` and `/support/` answer 200. Backup: `~/Desktop/workspace/awardgrid-deploy-backup-20260926/`
(`.next`, the database, the previous HEAD `26fc6cc`, the build log).

---

## 1. Where it stands

The engineering for 1.0 is done on the branch and its gates pass. Build 1.0 (1) is archived, signed, exported as an
internal-TestFlight-only `.ipa` (§5) and uploaded to App Store Connect (B7). Nothing has run on a physical iPhone.
What is left is the owner's:

| # | Blocking step | Who | State |
|---|---|---|---|
| B1 | Accept the updated Program License Agreement, **before 2026-10-01** | Account Holder | **Open** (read 2026-09-25: the account page and App Store Connect both still ask for it; at 22:00 the account page was down for maintenance). It takes the Account Holder's own sign-in: Users and Access lists them as a different Apple account from the Admin signed in to the owner's browser |
| B2 | Fix the membership renewal, **before 2026-10-10** | Account Holder | **Open** (read 2026-09-25: "wasn't renewed successfully"; App Store Connect at 22:00: expiration Oct 10, 2026, renewed on that date only if the Account Holder opted in to automatic renewal) |
| B3 | Register the App ID `com.dowhiz.awardgrid` | Owner (Admin), or the agent with a per-action OK | **Done 2026-09-25** by the agent with the owner's OK: explicit, description "AwardGrid", no extra capabilities |
| B4 | Create the App Store Connect record | Owner, or the agent with a per-action OK | **Done 2026-09-25** by the agent with the owner's OK: "AwardGrid", Apple ID `6816321841`, SKU `awardgrid-ios`, English (U.S.), Full Access; iOS 1.0 "Prepare for Submission" |
| B5 | Sign in to Xcode › Settings › Accounts; confirm the team's certificates | Owner | **Done:** Xcode on this Mac signs for `232AGCYZ2Z`; the signed archive used the Apple Development and Apple Distribution: Curastone CORP. identities (§5) |
| B6 | Choose the support e-mail, then deploy the privacy and support pages | Owner (address), agent (deploy) | **Done 2026-09-25:** Restful's public contact address; live at `/ios/`, `/privacy/`, `/support/` (`sites/landing/DEPLOY.md`) |
| B7 | Upload build 1.0 (1) | Owner, or the agent with a per-action OK | **Uploaded 2026-09-25 22:01** by the agent with the owner's OK (§6.7): "Upload succeeded"; App Store Connect listed 1.0 (1) as Processing. Whether processing finished was not checked |

---

## 2. The decisions, as applied

| # | Decision | What the branch does | Left |
|---|---|---|---|
| D1 | Private, internal use | Export options mark builds internal-TestFlight-only; LEGAL.md and the landing page say it is tested privately and is not on the App Store | Nothing for internal testing. seats.aero's permission is still needed before any public release |
| D2 | Bundle ID `com.dowhiz.awardgrid` | Unchanged in pbxproj, capacitor.config.ts, App.entitlements | B3 |
| D3 | Store and display name AwardGrid; 1.0 (1) | `CFBundleDisplayName` AwardGrid; capacitor appName AwardGrid; MARKETING_VERSION 1.0, CURRENT_PROJECT_VERSION 1 | Store name is set in B4 |
| D4 | iPhone only | `TARGETED_DEVICE_FAMILY = 1` | — |
| D5 | Minimum iOS 18.0 | `IPHONEOS_DEPLOYMENT_TARGET = 18.0` (all four places) | — |
| D6 | Original icon | `AppIcon-1024.png` from `apps/ios/scripts/app-icon.py`; the Capacitor splash replaced by the app's canvas colour, light and dark | — |
| D7 | Landing, privacy and support pages for `https://awardgrid.dowhiz.com` | `sites/landing` builds `/ios/`, `/privacy/`, `/support/`, served on that host by the Worker `awardgrid-site` beside the web app; the app links privacy and support from Settings › About | — |
| D8 | App Privacy: Search History and Other User Content, linked, app functionality, no tracking | `PrivacyInfo.xcprivacy` says exactly that; the privacy policy says the same | Enter it in App Store Connect (§7.3) |
| D9 | Internal TestFlight only; no review credentials | No review notes or demo mode prepared | — |
| D10 | EN/ZH consent before the first Ask | Consent sheet, service-level refusal, withdraw on the Anthropic key page | — |
| D11 | No mainland China; Mac and Vision Pro off; DSA left to the owner | Nothing in code | Set in App Store Connect when a listing exists (§7.2); DSA is the owner's own answer |
| D12 | Free; Travel; age rating answered live | Nothing in code | §7.1 lists the facts the questionnaire asks about |
| D13 | Fix #89 before release | Core `ResilientRoutesCatalog`, used by the iOS engine, Ask and watches | #78 (the label for those pairs) stays open |
| D14 | No source maps in the app; commit Podfile.lock; build numbers by hand | Maps moved beside `dist/` and checked; Podfile.lock committed; `ExportOptions-TestFlightInternal.plist` keeps the build number | Raise CURRENT_PROJECT_VERSION before every later archive |

---

## 3. The commits

| Commit | What |
|---|---|
| `1842ae7` | Privacy manifest; iOS 18.0; iPhone only; AwardGrid; `ITSAppUsesNonExemptEncryption` false; arm64; en and zh-Hans |
| `7a42410` | Source maps beside the bundle and checked; Podfile.lock committed; export options for internal TestFlight |
| `dff10c7` | #89: one failing route list no longer throws away the search; iOS and Ask say which list failed |
| `c0bb499` | D10: the consent sheet, the service's refusal, withdrawal in Settings; the browser-mock spec |
| `f75732c` | D6: the icon and the launch screen |
| `9c19875` | D7: privacy policy and support pages; the landing page's status and links; honesty scan of all three |
| `25279eb` | Settings › About: privacy, support, non-affiliation, Licenses (generated from what ships, checked by the build) |
| `87c6643` | This file; LEGAL.md; apps/ios/README.md (release runbook, stale lines) |
| `caae87d` | CI: gitleaks allows `Podfile.lock` (its podspec checksums matched the generic-key rule) |
| `7c0b37b` | The site mounted beside the web app: the landing page moves to `/ios/`, a root page for the Worker's own address |
| `63887b8` | The site deployed as the static-assets Worker `awardgrid-site`; `sites/landing/DEPLOY.md`; B6 done |
| `082a527` | B3, B4, the signed archive and its export (§5) |
| `a036899` | Build 1.0 (1) uploaded; the agreement and renewal need the Account Holder's own sign-in |
| `927b70b` | PR #99 merged into main by the owner, and deployed to the web app |
| `183dcce` | Build 2 for the App Store; `ExportOptions-AppStore.plist`; the spike's Podfile.lock ignored again |
| `2c46f07` | §0 (public release); App Store screenshots and their generator |
| `128af10` | §0 after the App Store Connect work: build 2 uploaded and selected, the listing, App Privacy, review information |
| `f4fbcab` | The age rating (4+) and the content rights, done on the owner's instruction |
| (this commit) | Availability set (P8); the repository is public, so CI runs again |

---

## 4. What is verified, and where

"—" means that layer was not used for that check. Nothing ran on a physical device, and nothing used a real key.

| Check | Unit tests | iOS browser mock (Playwright, fixture host) | Simulator, or the archive | Device | Real keys |
|---|---|---|---|---|---|
| Whole suite | typecheck, lint (0 errors), root 964 + 2 skipped, core 979, iOS 830 | 244 passed, 17 skipped (Web specs, `UIUX_WEB=0`), 0 failed; onboarding spec rerun after the About change: 19 passed | — | not run | not run |
| #89: a failed route list keeps the rows | core find/routes/tools tests; iOS engine test with E2's shape | — | — (E2 not rerun; harness stale, V13) | not run | not run |
| D10 consent | service, bootstrap wiring, settings store, markup | `ask-consent.spec.ts`: sheet contents, Not now sends 0 requests, Allow sends and survives a relaunch, withdrawal brings it back, zh | — (needs keys) | not run | not run |
| Info.plist, device family, minimum iOS, encryption key | — | — | Debug build on iOS 18.3; the signed archive and the exported `.ipa` inspected (§5) | not run | — |
| Privacy manifest ships at the app root | — | — | The exported `.ipa` (§5) | not run | — |
| Signing for internal TestFlight | — | — | `codesign --verify --deep --strict` on the exported app; Apple Distribution, the team's store profile, `get-task-allow` false, `beta-reports-active` true (§5) | not run | — |
| Icon, launch screen | — | — | Home screen shows the icon named AwardGrid; launch screen #F6F7F9 in light (dark frame not captured) | not run | — |
| About rows, Licenses page | markup tests | onboarding spec, incl. the 320 pt audit | Rows, the Licenses page and an opened license seen in WKWebView (iOS 18.3) | not run | — |
| iPad compatibility (D4) | — | — | New "awardgrid iPad 13 (V12)" (iOS 26.5): opens in the iPhone window, welcome screen correct | not run | — |
| Privacy and support pages | honesty scan (cadence, background claims, no script) | — | — | — | Rendered over HTTP at 390 pt, light and dark: no overflow, no outside request |
| Bundle hygiene (R1) | `check-fixture-free-bundle` (maps, fixture markers), `acknowledgements --check` | — | R1 over the bundle and its maps, and over `public/` in the exported `.ipa`: 0 hits (§5) | — | — |

Seen on the Simulator, already tracked: scrolled pages pass under the status bar (#90).

---

## 5. What build 1.0 (1) ships

Archived, signed and exported on 2026-09-25 from `63887b8` (bundle built with `env -u VITE_AG_PROBES`, R1 0 hits over
the chunks and their maps, `cap copy ios`), with the owner's OK for `-allowProvisioningUpdates` on that run. Uploaded the
same day (§6.7).

- **Archive:** `~/Library/Developer/Xcode/Archives/2026-09-25/awardgrid-1.0-1.xcarchive`, so it shows in Xcode's
  Organizer. Signed Apple Development with "iOS Team Provisioning Profile: com.dowhiz.awardgrid", which xcodebuild
  created on the team for this run, as it did the store profile below.
- **Export:** `apps/ios/ios/App/output/awardgrid-1.0-1/App.ipa` (git-ignored; 1.8 MB), from
  `ExportOptions-TestFlightInternal.plist`: method app-store-connect, destination export, internal TestFlight only,
  build number kept. Signed **Apple Distribution: Curastone CORP. (232AGCYZ2Z)** with "iOS Team Store Provisioning
  Profile: com.dowhiz.awardgrid" (expires 2027-04-19). `codesign --verify --deep --strict` passes. Entitlements:
  `application-identifier` `232AGCYZ2Z.com.dowhiz.awardgrid`, the app's own keychain group, `get-task-allow` false,
  `beta-reports-active` true.
- `Info.plist`: AwardGrid, `com.dowhiz.awardgrid`, 1.0 (1), `MinimumOSVersion` 18.0, `UIDeviceFamily` [1],
  `UIRequiredDeviceCapabilities` [arm64], `CFBundleLocalizations` [en, zh-Hans], `ITSAppUsesNonExemptEncryption`
  false, no `NSAppTransportSecurity`, no `CAPACITOR_DEBUG`.
- Privacy manifests: the app's own at the root (Search History, Other User Content; C617.1), and Capacitor's and
  CapacitorCordova's inside their frameworks.
- `public/`: the built bundle file for file plus Capacitor's `cordova.js` and `cordova_plugins.js`; no `*.map`, no
  probe or e2e chunk, no `sourceMappingURL`, R1 0 hits. The license texts are in their own lazily loaded chunk.
- Icon: the AwardGrid icon (checked in the exported app's `AppIcon60x60@2x.png`, no alpha).
- Frameworks: Capacitor, Cordova, AparajitaCapacitorSecureStorage, CapacitorFilesystem, IONFilesystemLib, KeychainSwift.
- Size: 4.2 MB for the `.app`, 1.4 MB of it `public/`.
- Not checked: Organizer › Generate Privacy Report (Xcode's window only; the archive is there now).
- The earlier **unsigned** archive, `apps/ios/ios/DerivedData/Archives/awardgrid-1.0-1-UNSIGNED-verification.xcarchive`,
  was only for looking inside; it is superseded and can be deleted. Never upload it.

---

## 6. The owner's steps, in order

The agent drafts and prepares; it never types an Apple ID, password, 2FA code or API key, accepts an agreement,
answers export compliance, content rights, DSA or age questions, or presses Create, Save, Upload or Submit without
an OK for that one action.

1. **Account Holder (B1, B2).** Accept the updated Program License Agreement before 2026-10-01; fix the renewal
   before 2026-10-10. Read on 2026-09-25 in the owner's browser: both are still open, and App Store Connect says that
   until the agreement is accepted, existing apps cannot be updated and new apps cannot be submitted. Both are done at
   `https://developer.apple.com/account` signed in as the Account Holder, a different Apple account from the owner's
   Admin one: the agreement banner there, and the membership's renewal. The agent never signs in for anyone; with the
   Account Holder signed in on this Mac's Chrome, it can open those pages and stop before Agree or payment.
2. **Support e-mail and the site (B6), done.** The pages give the same public contact address as Restful's site, and
   name Curastone CORP. as publisher, as Restful's do. Live on 2026-09-25 at `https://awardgrid.dowhiz.com/ios/`,
   `/privacy/` and `/support/`, served by the static-assets Worker `awardgrid-site` on four routes beside the web app
   (no DNS change; the web app's paths are unchanged). Build, redeploy, checks and roll-back: `sites/landing/DEPLOY.md`.
3. **App ID (B3), done** on 2026-09-25 by the agent with the owner's OK: explicit Bundle ID `com.dowhiz.awardgrid`,
   description "AwardGrid", no extra capabilities (the Keychain group the app uses is its own default group).
4. **App Store Connect record (B4), done** on 2026-09-25 by the agent with the owner's OK: iOS; "AwardGrid"; English
   (U.S.); `com.dowhiz.awardgrid`; SKU `awardgrid-ios`; Full Access. Apple ID `6816321841`.
5. **Signing (B5), done.** Xcode on this Mac signs for `232AGCYZ2Z`. Both AwardGrid profiles now exist on the team
   and on this Mac, so later archives need `-allowProvisioningUpdates` again only if a profile is missing or revoked.
6. **Archive, done for 1.0 (1)** (§5). For each later build: raise `CURRENT_PROJECT_VERSION` in a commit, then
   `apps/ios/README.md` › "Release" steps 1-7.
7. **Upload (B7), done** on 2026-09-25 at 22:01 by the agent, with the owner's OK: `xcodebuild -exportArchive` from
   the archive with the export options' `destination` set to `upload` and `-allowProvisioningUpdates`, which signs in
   with the account in Xcode (nothing typed; `apps/ios/README.md` › "Release" step 7). xcodebuild reported "Upload
   succeeded", and App Store Connect › TestFlight › Build Uploads listed 1.0 (1) as Processing. The pending agreement
   did not stop the upload. Next: when processing ends, the build appears under iOS Builds (Apple also e-mails). If
   it shows "Missing Compliance" despite `ITSAppUsesNonExemptEncryption` false, the owner answers it.
8. **TestFlight.** An internal group with the owner; the test information in §7.4; install on the iPhone.
9. **Device checks,** §8. Every step that sends a real request is the owner's, with the owner's own keys, typed by
   the owner.
10. **Only for a public release, later:** seats.aero's written permission (handoff D1), App Review access (D9),
    the listing (§7.6), the age rating, DSA, the privacy answers' final check, and Submit for Review by the owner.

---

## 7. App Store Connect drafts (for the owner to paste)

### 7.1 App Information

- **Name:** AwardGrid
- **Subtitle** (optional, 24 of 30): Award seats in one table
- **Primary category:** Travel. Secondary: none.
- **Support URL:** `https://awardgrid.dowhiz.com/support/`. **Marketing URL** (optional):
  `https://awardgrid.dowhiz.com/ios/`. Both live.
- **Content rights:** the owner's answer. The facts: results are seats.aero data, fetched with the user's own
  subscription and key; the app shows no airline or program logos.
- **Age rating:** the owner answers the questionnaire as it appears. The facts it asks about: no user-to-user
  content or chat; no web browser in the app (links open Safari); Ask returns text generated by Claude, scoped by
  its prompt to award availability (`packages/core/src/lib/ask/prompt.ts`); no gambling, contests, medical,
  violent or mature content; no purchases. Do not write "4+" anywhere until the form produces it.

### 7.2 Pricing and Availability

- **Price:** Free.
- **Availability:** every country or region except China mainland.
- **Apple silicon Mac** ("Designed for iPhone"): off. **Apple Vision Pro:** off.

### 7.3 App Privacy (D8)

- **Privacy Policy URL:** `https://awardgrid.dowhiz.com/privacy/` (live).
- **Do you or your third-party partners collect data from this app?** Yes.
- **Data types:** Search History; Other User Content. Nothing else.
- For each: **used for** App Functionality only; **linked to the user's identity:** Yes; **used for tracking:** No.
- Matches `apps/ios/ios/App/App/PrivacyInfo.xcprivacy` and `sites/landing/privacy/index.html`; change all three
  together.

### 7.4 TestFlight test information

- **Beta App Description:** AwardGrid finds award seats across programs with your own seats.aero key and shows them
  in one table. Ask, which is optional, answers questions about your results on your own Anthropic key.
- **Feedback e-mail:** the same address as the support page.
- **What to Test (build 1):** First build, internal testing only. Check first launch with no key (the welcome screen;
  nothing is sent), adding your seats.aero key (one call to check it) and a first search; the list, calendar,
  matrix, details and compare; that watches check when you open or return to the app; Settings › About (privacy,
  support, Licenses). If you use Ask: the permission sheet comes before the first question, Not now sends nothing,
  and withdrawing it in Settings brings the sheet back. Real searches spend your own seats.aero calls, and Ask
  questions are billed to your own Anthropic key.
- **Sign-in required:** no (there are no accounts; the app needs the tester's own keys).

### 7.5 Export compliance

`ITSAppUsesNonExemptEncryption` is false in the Info.plist: the app's only encryption is HTTPS through URLSession
and the Keychain, both provided by the OS. The declaration is the owner's to make if App Store Connect asks.

### 7.6 Listing drafts, for the public release (§0 P9)

Not needed for internal TestFlight. Trademark rule (2.3.7): no seats.aero, airline, Claude or Anthropic in the name,
subtitle or keywords; the description names them only to say what the app works with.

- **Keywords** (97 of 100): `award,miles,points,award seats,award flights,business class,first class,frequent flyer,redemption`
- **Keywords, Chinese:** `里程票,里程,积分,兑换,商务舱,头等舱,奖励机票,航空里程,常旅客`
- **Promotional text:** One table of award seats for the routes and dates you choose, on your own seats.aero key.
- **Copyright:** 2026 Curastone CORP.
- **Description:**

  > AwardGrid puts award availability for your routes and dates into one table: the cheapest award seat in each
  > cell, with the miles, the fees, the seats left, the program that sells it, and how old the data is.
  >
  > • Search in English or Chinese, for several origins and destinations over a range of dates.
  > • List, calendar and matrix views, and a side-by-side comparison of up to four options.
  > • Watches check your saved searches when you open the app. There is no background checking and there are no
  >   notifications.
  > • Ask, which is optional: questions about your results, answered by Claude on your own Anthropic API key, once
  >   you allow it.
  >
  > What it needs: your own seats.aero Pro subscription and API key; without one, AwardGrid searches nothing. Ask
  > needs your own Anthropic API key, and Anthropic bills your account for each question.
  >
  > Your keys stay in your iPhone's Keychain. There are no accounts, no analytics, no ads and no tracking. Results
  > are seats.aero's cached data: confirm on the program's own site before you transfer points.
  >
  > AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any
  > loyalty program.

- **Description, Chinese:**

  > AwardGrid 把你所选航线和日期的里程票汇总成一张表：每个单元格显示最便宜的里程票，以及所需里程、税费、剩余座位、出票的里程计划和数据时间。
  >
  > • 用中文或英文查询，可同时查多个出发地、目的地和一段日期。
  > • 列表、日历和矩阵三种视图，最多可并排比较四个选项。
  > • 关注会在你打开应用时检查保存的查询。没有后台检查，也没有通知。
  > • AI 辅助（可选）：由 Claude 使用你自己的 Anthropic API 密钥回答关于结果的问题，需先获得你的许可。
  >
  > 使用前提：你自己的 seats.aero Pro 订阅和 API 密钥；没有它，AwardGrid 无法查票。AI 辅助需要你自己的 Anthropic API
  > 密钥，并由 Anthropic 按每次提问向你的账户计费。
  >
  > 你的密钥保存在 iPhone 的钥匙串中。没有账号、统计分析、广告或跟踪。结果是 seats.aero 的缓存数据，转点前请先在里程计划官网确认。
  >
  > AwardGrid 与 seats.aero、Anthropic、任何航空公司或任何里程计划均无关联，也未获其认可或赞助。

---

## 8. Device checks for the first TestFlight build

`APP_STORE_HANDOFF.md` §5 (V1-V13) still applies. Added or changed by this branch:

| # | Check | How |
|---|---|---|
| V1 | First launch | The AwardGrid icon and name on the home screen; the launch screen is the app's canvas, not white, in Dark Mode |
| V4a | Consent (D10) | With both keys on file: tap Ask; the sheet lists what is sent and links Anthropic's privacy policy. Not now: nothing sent, the words stay. Allow: the question goes. Settings › Anthropic key: "You allowed…", Withdraw permission; the next Ask shows the sheet again |
| V14 | About | Settings › About: the non-affiliation sentence; Privacy policy and Support open the live pages in Safari; Licenses lists 19 entries, each opens to its text |
| V15 | #89 on live data | Only with the owner's consent and quota: a search over several programs; if a route list fails, the results stay and a warning names the program |
| V16 | Build number | Settings › General › About on the phone, or TestFlight: 1.0 (1) |

Every step that sends a real seats.aero or Anthropic request needs the owner's consent at that time, and the keys
are typed into the app by the owner.

---

## 9. Known issues and follow-ups

- **#78:** what an empty pair whose monitoring is unknown should be called. #89's fix leaves those pairs "checked,
  nothing found" and says the rest in a warning.
- **#79:** the web facade still has its own copy of the resilient catalog; the core copy is iOS's.
- **E2 and the Phase 5 harness (V13)** are stale and were not rerun.
- **#90, #91, #92:** status-bar overlap when scrolled (seen again on the Simulator), control sizes, main chunk size.
- **Name in older strings:** the app is AwardGrid on the home screen, the store and the site; older in-app sentences
  still say "awardgrid" ("Paused while you were away from awardgrid.").
- **LEGAL.md** changes reach the web's `/legal` only after a merge and a deploy: production reads LEGAL.md from the
  main checkout.
- **`APP_STORE_HANDOFF.md` §6** says `awardgrid.dowhiz.com` is not in the iOS bundle. It now is, as the two About
  links, opened in Safari; the app sends no request there.
- **B2 matters after the upload too:** TestFlight distribution needs an active membership, and the store profile
  (§5) belongs to the team.
- **Simulator devices:** "awardgrid iPad 13 (V12)" (`0F825C70-F0B3-4831-9CD1-CA9ED2EADA35`, iOS 26.5) was created for
  V12 and is shut down; delete it with `xcrun simctl delete <udid>` when no longer needed. The stock devices and the
  owner's `A480530B` were not used.
