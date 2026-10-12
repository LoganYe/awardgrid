# AwardGrid iOS 1.0 (7): execution and acceptance record

Prepared **2026-10-12**. The execution owner fills this record with the actual source, command output, archive,
upload and App Store Connect readback. A pending entry does not imply a passed test or an external action.

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
| Branch and exact source SHA | Not yet recorded |
| Dirty-tree state at build | Not yet recorded |
| Marketing version / build / bundle ID | Not yet verified from archive |
| Store flavour / OAuth client ID presence | Not yet verified; never record secrets |
| Dependency / Xcode / SDK identity | Not yet recorded |
| Archive path, timestamp and source identity | Not yet recorded |
| Export path and signing verification | Not yet recorded |

## Implementation and validation

| Check | Result / evidence |
|---|---|
| Provider results absent from newly written cache/workspace/Saved/watch/Ask files | Pending implementation verification |
| In-memory expiry and fresh state after restart | Pending implementation verification |
| Saved query retained; reopening runs a new query | Pending implementation verification |
| Watches retained; baseline rebuilt after restart | Pending implementation verification |
| Old backup/result fields sanitised | Pending implementation verification |
| Unknown/damaged legacy file or write failure accurately reported | Pending implementation verification |
| Disconnect success and partial failure claims | Pending implementation verification |
| Sample mode and non-OAuth behaviour preserved | Pending implementation verification |
| Unit/type/lint checks appropriate to changed files | Not yet recorded |
| Store bundle guard: no pasted-key/Ask route, fixtures or secrets | Not yet recorded |
| Sample path: Welcome, search, three views, details, Compare, Saved, Watches, exit | Not yet recorded |
| Browser fixture evidence versus real device / real provider evidence | Not yet recorded; keep these separate |
| New review recording: source build, content and redaction check | Not produced/attached by metadata preparation |
| Public policy/support content, contacts and user rights preserved | Copy validation 2026-10-12: all href destinations/counts, mailto/support markers and Curastone publisher preserved; App Privacy labels, Cloudflare website disclosure and Contact sections byte-identical to pre-edit HEAD |
| Public site deployment and visible-text readback | Not deployed by metadata preparation |

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
| Saved ASC field equals verified local notes and keyword text | Not yet recorded |
| New/changed notes checked against shipped behaviour | Pending final implementation and UI verification |

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
| Remove or cancel build-6 submission if necessary to replace it | Not performed by metadata preparation |
| Archive completed and inspected | Not yet recorded |
| Upload command finished | Not yet recorded; upload success requires command evidence |
| Apple processing completed for 1.0 (7) | Not yet recorded |
| Build 7 selected on version 1.0 | Not yet recorded |
| Privacy/age/content-rights answers checked against final build | Not yet recorded |
| Metadata, Review Notes and Attachment readback | Not yet recorded |
| Manual release setting readback | Starting snapshot Manual; final readback pending |
| Submit for Review action | Not yet recorded |
| Post-action App Review status and selected build readback | Not yet recorded |
| Later Apple decision or acceptance | None in starting snapshot; update only on evidence |
| seats.aero registration approval | Unapproved in starting snapshot; update only on evidence |
| Pending Developer Release / public App Store availability | Not established; manual release is a separate action |

## Remaining acceptance gates

Apple may require a reviewer-access alternative or decline the requested 3.1.3(f) classification. An OAuth code
path and a provider letter do not establish successful real-account review access or registration approval.
Simulator/browser/unit checks and an uploaded binary do not establish a physical-iPhone pass or a public release.
Record the exact unsatisfied gate and its evidence; do not convert missing evidence into success.
