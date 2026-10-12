# AwardGrid iOS 1.0 (7): execution and acceptance record

Updated **2026-10-12**. **Build 7 is archived and exported, but not uploaded or submitted.** Two upload attempts
failed with Apple’s `Failed to Use Accounts` for Curastone CORP.; the browser’s ASC session also expired. The owner
has been asked to restore both existing logins. Build 6 was not cancelled. A prepared binary is not a submission.

## Starting state and scope

Live ASC snapshot supplied by the coordinating agent on 2026-10-12: app **6816321841**, version **1.0**, build
**6**, **Waiting for Review**, resubmitted **2026-10-08 17:12 PT**, release **Manual**. Messages has only the
2026-10-05 23:49 PT build-3 rejection under 3.1.1 and the owner's 2026-10-06 reply. There is no later written Apple
acceptance of OAuth or sample mode. App Review Attachment is empty. seats.aero's 2026-10-07/08 written answers
cover OAuth and commercial use; its AwardGrid registration is still unapproved.

Build 7 addresses provider-result persistence and its claims, improves review notes, and fixes duplicate en-US
keywords. The intended store policy keeps provider results in memory rather than files; Saved retains query
conditions, Watches retains conditions and rebuilds its comparison baseline after restart. Old known provider
fields are sanitised; unreadable or unknown data cannot be declared removed if cleanup fails. The final code and
verification below determine what is shipped and what the notes may claim.

## Source and build identity

| Item | Recorded value / evidence |
|---|---|
| Worktree | `/Users/yegaoyang/.codex/worktrees/awardgrid-review-build7/awardgrid` |
| Branch and exact source SHA | `codex/ios-review-build7`; archive source `04126d0eb5f992a0931ca1afd92bc9a0d6be7c25` (later commits record evidence only) |
| Dirty-tree state at build | Clean; build script refuses a dirty source or overwriting an existing archive |
| Marketing version / build / bundle ID | Archive and exported IPA both verified: **1.0 (7)**, `com.dowhiz.awardgrid`, AwardGrid, iPhone-only, iOS 18.0 minimum |
| Store flavour / OAuth client ID presence | Store/OAuth flavour with the existing public client ID; copied, archived and exported bundle guards pass; no client secret packaged |
| Dependency / Xcode / SDK identity | ARM Node 22.23.2, pnpm 12.3.4; frozen offline dependencies; Pods deployment install; Xcode 27.0 (27A266a), iOS SDK 27.0 |
| Archive path, timestamp and source identity | `/Users/yegaoyang/Library/Developer/Xcode/Archives/2026-10-12/awardgrid-1.0-7.xcarchive`; CreationDate `2026-10-12 09:10:27 UTC`; source above; `archive-identity.json` |
| Export path and signing verification | Evidence `exported-appstore/AwardGrid.ipa`; public App Store export, manage-build-number false, **EXPORT SUCCEEDED**; Apple Distribution Curastone CORP. (`232AGCYZ2Z`), strict signature verified; SHA-256 `686ca35ead13440139879bb6a485bf7353473376f4f7eb9871814f4d375d6b80` |

## Implementation and validation

| Check | Result / evidence |
|---|---|
| Provider results absent from newly written cache/workspace/Saved/watch/Ask files | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| In-memory expiry and fresh state after restart | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Saved query retained; reopening runs a new query | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Watches retained; baseline rebuilt after restart | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Old backup/result fields sanitised | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Unknown/damaged legacy file or write failure accurately reported | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Disconnect success and partial failure claims | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Sample mode and non-OAuth behaviour preserved | Passed code/tests: OAuth result fields are stripped; owned conditions preserved; failure paths verified and warnings remain visible |
| Unit/type/lint checks appropriate to changed files | Full workspace exit 0: app 1439 passed / 19 plugin-dependent skipped before toolkit build, core 1071 passed, iOS 1201 passed, landing 255 passed, auth 35 passed; proxy 9 passed. Whole-workspace typecheck exit 0; lint exit 0 with 2 existing warnings. After initialising the pinned toolkit and building it, app rerun **1456 passed / 2 optional live tests skipped**; no real Anthropic smoke or two-user live session was run |
| Store bundle guard: no pasted-key/Ask route, fixtures or secrets | Store build, copied resources, archive and exported IPA guards pass; fixture-free and shipped acknowledgement checks pass |
| Sample path: Welcome, search, three views, details, Compare, Saved, Watches, exit | Browser fixture **28/28 Store E2E pass**, including EN/ZH, sample isolation, planner, mocked OAuth/Disconnect and accessibility. Native iPhone and iPad Simulator Release first launch renders Welcome (iPad loaded screenshot, not its initial launch-animation frame); native interactive walkthrough not completed because the native UI control timed out |
| Browser fixture evidence versus real device / real provider evidence | Dedicated iPhone Simulator `941058C4-E9BB-49B4-8C21-BBAF7B334C5A` and iPad `DAA5CA8C-B710-45B0-A449-EC9C6A13DA1C`; screenshots in evidence. No physical-device OAuth/search or offline-mode pass claimed |
| New review recording: source build, content and redaction check | Not produced/attached by metadata preparation |
| Public policy/support content, contacts and user rights preserved | Copy validation 2026-10-12: all href destinations/counts, mailto/support markers and Curastone publisher preserved; App Privacy labels, Cloudflare website disclosure and Contact sections byte-identical to pre-edit HEAD |
| Public site deployment and visible-text readback | Preview then existing Vercel production project promoted; canonical `https://awardgrid.dowhiz.com` readback passes for all 6 pages, visible EN/ZH text, exact links/contact, canonical, resources, redirects, 404 and headers. Preview deployment `dpl_8zXkUEqVXwQu8Ucw5TLWiyLxeKcD`; production promotion `2Ht3kbSDu9ZwZJpes6Lefsd4hMJk`. Static source `0a59382` (public sources unchanged by `04126d0`). DNS/Worker/private web unchanged |

## Metadata and review text

Active name **AwardGrid**, subtitle **Award seats in one table**. `en-US/keywords.txt` now adopts the existing
`next/en-US` string for the same name/subtitle:

```text
points,miles,flights,travel,reward,business,first,class,frequent,flyer,saver,redeem,search,calendar
```

Baseline command `python3 scripts/aso/validate_metadata.py --dir apps/ios/store-metadata --strict` returned exit
1 with **4 errors, 2 warnings** from duplicated `award`, `seats` and `class` keyword terms. Name, subtitle,
description, promotional text and URLs were preserved by the keyword correction.

| Item | Final result / evidence |
|---|---|
| Active en-US strict metadata validator | 2026-10-12: exit 0; 1 locale, **0 errors, 0 warnings, 2 notes**; keywords **99/100** |
| All next-locale strict metadata validator | 2026-10-12: exit 0; 4 locales, **0 errors, 0 warnings, 7 notes** |
| Public claims gate and related tests | 2026-10-12: **53 files, 0 findings, 0 exemptions**; current-tree + validate-public-claims tests **373/373** |
| Review Notes text | `docs/release/appreview/review-notes-1.0-7.txt` |
| Review Notes Unicode character count (max 4,000) | 2026-10-12: **3,743**, including final newline; recount if the attachment or any other text changes |
| Saved ASC field equals verified local notes and keyword text | **Not saved**: existing browser login expired; verified local build-7 notes and 99-character keywords ready |
| New/changed notes checked against shipped behaviour | Independent code review approved `0a59382`; subsequent `04126d0` adjusts only E2E expectations to preserve owned queries after Disconnect; full suite and final E2E pass. Notes accurately mark Apple’s requested classifications/provider registration as unapproved and no recording attached |

The copy requests assessment under **3.1.3(f)** and acceptance of sample mode under **2.1**. Neither request is
represented as an existing Apple approval. It does not claim an attached recording or an offline run. Any new
recording or change in the provider-registration status must be reflected after verification in both the notes
and this record.

Metadata/copy preparation additionally ran the OAuth screen-copy suite (**7/7**), landing suite (**255/255**) and
public proxy checks (**9/9**), all with exit 0. Source snippets in `growth/product-facts.json` were moved to actual
new lines; the public-claims gate verifies their exact text instead of ignoring drift. The first growth test run
found two released/withdrawn snapshot mismatches caused by duplicating an exact review-status phrase in the
metadata README. That duplicate was removed in favour of the release record; the gate and all 373 growth tests
then passed. No validator was weakened.

The implementation's full iOS run then reported three copy failures: the new Chinese phrase for a subsequent
watch check matched the existing no-cadence rule, and two store-flavour assertions required the old copy. This was
reproduced in the two affected suites, fixed by explicitly describing the **first check after reconnecting** and
updating the assertions to the actual in-memory policy, and verified with `honesty.test.ts`,
`store-flavour.test.ts` and `oauth/oauth-flavour.test.ts`: **3 files, 170/170 tests**, exit 0. Sample/key-flavour
assertions and the honesty rule were preserved. The full implementation suite remains the execution owner's
separate verification entry above.

The same 170-test rerun also verifies the Saved list card and detail screen for a query-only persisted item:
they display **"Query conditions saved"** instead of the false **"0 options when saved"** count. SSR also checks
that ordinary saved snapshots still display their actual option count. The new query-only label has an English
and Chinese version.

The first Vitest attempts used `/usr/local/bin/node` (x64 v22.16.0) and failed before test collection because the
rolldown native binding was unavailable. Successful reruns used
`/Users/yegaoyang/.local/node-arm64/bin/node` (the coordinator's arm64 runtime) with each package's
`node_modules/vitest/vitest.mjs`. No `node_modules` deletion, dependency upgrade or global runtime repair was made
for this preparation.

## Archive, upload and App Store Connect

| Event | Time / identity / observed status / evidence |
|---|---|
| Remove or cancel build-6 submission if necessary to replace it | **Not performed**; only replace after Build 7 uploaded, processed and ready |
| Archive completed and inspected | **ARCHIVE SUCCEEDED**, identity/resources/signature inspected; see source above |
| Upload command finished | **Failed twice**, with and without `-allowProvisioningUpdates`: `Failed to Use Accounts`, ASC access for Curastone CORP. required. `upload-first-failed.log` and `upload.log`; exit 70. Export-only command succeeds. No Upload succeeded signal |
| Apple processing completed for 1.0 (7) | **Not started**, no successful upload |
| Build 7 selected on version 1.0 | **Not performed** |
| Privacy/age/content-rights answers checked against final build | Live pre-expiry readback: App Privacy Search History linked for App Functionality only; no tracking/Other User Content. No ASC answer mutations; final readback after login still required |
| Metadata, Review Notes and Attachment readback | Existing Build 6 has 7 no-Ask/sample screenshots and empty Attachment; build-7 notes not yet saved. No new recording produced or falsely claimed |
| Manual release setting readback | Starting snapshot Manual; final readback pending |
| Submit for Review action | **Not performed**, waiting for existing Apple logins to be restored |
| Post-action App Review status and selected build readback | No new action; last live readback before session expiry is **1.0 (6), Waiting for Review**, Manual release |
| Later Apple decision or acceptance | None in starting snapshot; update only on evidence |
| seats.aero registration approval | Unapproved in starting snapshot; update only on evidence |
| Pending Developer Release / public App Store availability | Not established; manual release is a separate action |

## Remaining acceptance gates

Apple may require a reviewer-access alternative or decline the requested 3.1.3(f) classification. An OAuth code
path and a provider letter do not establish successful real-account review access or registration approval.
Simulator/browser/unit checks and an uploaded binary do not establish a physical-iPhone pass or a public release.
Record the exact unsatisfied gate and its evidence; do not convert missing evidence into success.

## Evidence and continuation

External evidence directory: `/Users/yegaoyang/Desktop/workspace/awardgrid-release-1.0-7-20261012`. It contains
source/IPA/archive manifests, complete test/type/lint/build/export/upload logs, retained failed preflight traces,
final browser E2E output, native first-launch screenshots, public preview/production/canonical reports and the
login-required screenshot. No passwords, real API keys or OAuth token values are in the committed release record.

After the owner restores Xcode → Settings → Accounts for Curastone CORP. and Chrome App Store Connect:

1. Verify the archived source and IPA identity above; do not rebuild or overwrite the archive unnecessarily.
2. Retry the prepared upload; require `Upload succeeded` and ASC build **7** processing completion.
3. Read current Build 6 review state; cancel/replace only when Build 7 is eligible.
4. Select Build 7, save the prepared exact notes and keywords, and read back all fields, screenshots, privacy and
   Manual release. No shared-account or real-device recording claim may be added without evidence.
5. Submit the review round, require an ASC readback of **1.0 (7), Waiting for Review**, and replace the pending
   entries and product-facts provenance with the actual submission time. Provider approval/manual public release
   remain separate gates.

## Follow-up CI verification

The first PR run passed its typecheck/lint/test, Docker and secret-scan jobs, but exposed two separate test-harness
issues. ASO tests still expected the retired active-keyword duplication and equated current keywords with build 3’s
preserved history. Both assertions now follow the corrected active fields while retaining the historical record
and duplication-negative tests: **97 ASO tests pass**, with active/next strict validators still clean.

The desktop-light expanded-query screenshot differed because its unmasked demo dates move with today, changing
caption widths and badge/cell positions. The downloaded expected/actual/diff images prove that calendar cause.
The visual test now holds only the five date readings to the capture dates of its committed baselines and checks
that all five routes and date shapes remain present. No baseline PNG or comparison threshold was replaced. Local
state/harness checks pass on all **3 curated projects**; the intentionally uncurated mobile-dark case is skipped.
Mac ignores Linux pixel comparisons by design; the updated Linux CI comparison is the separate final gate.

These follow-up edits affect only tests and this record. They do not alter the archived Build 7 code or its IPA.
The original failed CI logs/artifacts remain in external evidence. Whole-workspace typecheck is green again;
App Store upload/submission remain blocked on Apple authentication.
