# App Review Notes for AwardGrid 1.0 (7)

Prepared on **2026-10-12** for the next build of version 1.0. The exact text to paste into App Store Connect ›
AwardGrid › version 1.0 › App Review Information › Notes is
[`review-notes-1.0-7.txt`](review-notes-1.0-7.txt). It has no placeholders. This file is the preparation record, not
the field contents. Build 7 has not been uploaded, selected or submitted by this preparation task.

## Verified starting snapshot

The coordinating agent read App Store Connect on 2026-10-12: app **6816321841**, version **1.0**, build **6**,
**Waiting for Review** after resubmission on **2026-10-08 17:12 PT**, with **Manual** release. Messages contains the
Apple rejection of build 3 on **2026-10-05 23:49 PT** under 3.1.1 and the owner's reply of **2026-10-06**; no later
Apple message accepts OAuth or the proposed sample-data review path. App Review Information's Attachment field is
empty. The current saved notes were read from
`/Users/yegaoyang/Desktop/workspace/awardgrid-asc-1.0-6/3-app-review-notes.txt`.

seats.aero's written answers of **2026-10-07** and **2026-10-08**, as recorded in the current saved review notes,
address using Login with Seats.aero and commercial use. They do not establish approval of AwardGrid's OAuth
registration. On **2026-10-12** the coordinating agent opened the actual provider consent page without authorising
the app; it still said **"This app is new and has not been reviewed by seats.aero."**

## Why the text is worded this way

- It asks Apple to evaluate the free companion app under 3.1.3(f); it does not claim Apple has already classified
  AwardGrid as eligible. Apple's [current guidelines](https://developer.apple.com/app-store/review/guidelines/)
  were read on 2026-10-12. 3.1.3(f) describes the free companion category with no purchase flow or outside-purchase
  prompts. 2.1(a) requires prior Apple approval when a built-in demo mode substitutes for a demo account because of
  legal or security obligations. These are two separate review questions.
- It distinguishes API access at the independent provider from an AwardGrid paid tier and explains that the
  developer sells neither. It describes the actual sample path without implying that invented availability is
  bookable.
- It explains why shared credentials are not supplied and candidly requests acceptance of sample mode. The absence
  of an Apple reply is not treated as acceptance.
- It omits the old draft's unsupported "works offline" and "attached recording" statements. It also omits the old
  blanket 24-hour physical-deletion guarantee. The new Build 7 paragraph describes the in-memory storage boundary,
  retained queries and watch conditions, and explicit legacy-cleanup failures; verify it against the final build.
- It names seats.aero only in private App Review notes. The public listing remains provider-neutral in accordance
  with the existing trademark rule.

## Before saving or submitting Build 7

Record completion and exact evidence in [`../IOS_1.0_BUILD7.md`](../IOS_1.0_BUILD7.md).

- Verify the shipped store bundle, the named buttons, sample search, views, details, Compare, Saved, Watches,
  disconnected state, missing key-entry/Ask routes and the optional OAuth path. Browser fixtures prove the app
  flow; they do not prove real OAuth service acceptance on an iPhone.
- Align any new retention paragraph with the final implementation and its tests. The proposed Build 7 policy is
  provider results in memory only, saved query conditions and watch conditions on disk, fresh results and a new watch
  baseline after restart. Do not make this a shipped claim until verified. If cleanup of an older or damaged file
  fails, the app must report the failure instead of asserting that all provider data was removed.
- If a new recording is produced and attached, first verify that it is from the submitted build and exposes no
  password, token, secret, account address or notification; then replace the text's attachment sentence with
  the exact verified attachment description. Until the Attachment field is read back nonempty, the text truthfully
  says no recording is attached.
- Re-read Messages and the provider-registration state immediately before submission. Update only facts that have
  changed. A reply or registration approval needs its own evidence and date.
- Count the plain-text file again and keep it at or below 4,000 Unicode characters. Check the saved ASC field after
  pasting it. Keep release **Manual** and distinguish submission, review acceptance, provider approval and public
  release.

## Text and metadata validation

The final character count and validation output are recorded in the Build 7 execution record. The active en-US
keyword field now uses the existing `next/en-US/keywords.txt` draft, written for the same name **AwardGrid** and
subtitle **Award seats in one table**. The copy fixes repeated `award`, `seats` and `class` terms; name, subtitle,
description, promotional text and public URLs are unchanged by this preparation task.
