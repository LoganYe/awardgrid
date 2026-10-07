# App Store listing text

The App Store Connect fields of the AwardGrid iPhone app, one plain-text file per field: `name.txt`, `subtitle.txt`,
`keywords.txt`, `promotional_text.txt`, `description.txt`, `release_notes.txt`, `support_url.txt`, `marketing_url.txt`
and `privacy_url.txt`.

## en-US/: version 1.0, build 4 (since 2026-10-07)

`en-US/` holds the texts for version 1.0 as it is resubmitted with build 4, after App Review rejected build 3 under
Guideline 3.1.1 on 2026-10-05 (`docs/release/IOS_1.0_RELEASE.md` §0 P16-P17). Until build 4 is submitted, the rule
that these files "change only when App Store Connect does" is suspended: `description.txt` and `promotional_text.txt`
are the step-36 texts of the 3.1.1 remediation plan, for the owner to paste in App Store Connect's single pass before
resubmission; App Store Connect still shows build 3's texts until then. The name, subtitle, keywords and URLs are
unchanged.

- The description is for the build that connects with a pasted key: it says "by pasting the API key from your
  seats.aero settings" and "AwardGrid has no in-app purchases" after the one neutral sentence about seats.aero Pro
  (decision D6). A build that connects through seats.aero's own sign-in needs that paragraph and the privacy line
  rewritten first (plan step 47F.5).
- It has no Ask (decision D3), names no Anthropic, and mentions the trip planner only because build 4 has it (plan
  step 18, decision D11): if the planner does not ship, its bullet goes too.
- Every sentence is in `growth/product-facts.json`: claims grid, sample_mode, query_input, views, watches, planner,
  prerequisite, data_cached, keys, privacy and affiliation. The bullets on search languages, views and watches, and
  the cached-data sentence, are build 3's, kept word for word.
- Build 3's texts, as submitted on 2026-09-26, are the record in `docs/release/IOS_1.0_RELEASE.md` §7.6.

## next/: superseded

*Superseded on 2026-10-07 by the build-4 texts in `en-US/`. Nothing in `next/` is uploaded for build 4 (plan step 1),
and neither are the next/ screenshots in `docs/release/appstore/next/`.*

`next/<locale>/` held drafts for the version after 1.0, for en-US, en-GB, en-AU and zh-Hans, written while build 3 had
Ask and the pages asked for a seats.aero subscription. Their descriptions and promotional texts now repeat build 4's
(`en-US/`'s English, and a Chinese version for zh-Hans), so no draft in this repository says what build 4 no longer
does: the registry retired that wording, and the public-claims gate refuses it here too. Their names, subtitles and
keywords are the earlier ASO drafts, unchanged, for a later version; they stay checked as before. None of them is in
App Store Connect.

- Name: AwardGrid in every locale.
- en-US keeps version 1.0's name and subtitle; only its keywords change.
- zh-Hans: all text needs a native speaker's review, the build-4 description and promotional text included.
- `zh-Hans/keywords_fallback.txt` (at most 100 UTF-8 bytes) is for use only if App Store Connect counts the keyword
  field in bytes rather than characters; Apple documents the limit both ways.
- There is no `release_notes.txt` yet: What's New is written once the next version's changes are known.
- There is no zh-Hant localization: no description in traditional characters has been written. Its description must
  include `App 介面為簡體中文與英文。`, because the app's interface is English or Simplified Chinese (the validator
  checks every zh-Hant locale for it). The parser's tests for queries in traditional characters are in
  `packages/core/src/lib/query/zh-hant.test.ts`; version 1.0 does not read 飛 on its own as a direction word, so the
  registry's sentence about such queries (`query_zh_hant`) is pending.
- Keyword fields repeat no word of the name or subtitle, or of another localization the same storefront indexes, and
  use at least 95 of their 100 characters.
- Storefronts: AU indexes en-AU and en-GB, and CA shows en-US while there is no en-CA. Verify both against Apple's
  localization table before submitting.

## Checks

- `python3 scripts/aso/validate_metadata.py --strict` checks `next/`: the field limits, words repeated across the
  name, subtitle and keywords or across the localizations one storefront indexes, keyword use, third-party names in
  the name, subtitle and keywords (Guideline 2.3.7), and features the app does not have. A directory that is not a
  locale code as App Store Connect writes it (`zh-hant/` for `zh-Hant/`) is a warning, so it is never skipped
  unchecked. CI runs it.
- `python3 scripts/aso/validate_metadata.py --dir apps/ios/store-metadata` checks `en-US/`. The build-4 description
  and promotional text pass; it still reports that version 1.0's keywords, which the plan leaves unchanged, repeat
  "award" and "seats" from its subtitle (4 errors and 2 warnings, so `--strict` fails on them). `next/en-US/keywords.txt`
  was written for the same name and subtitle and passes; using it in App Store Connect is the owner's choice.
- `node scripts/growth/validate-public-claims.mjs` checks every file here against `growth/product-facts.json`.
- `python3 scripts/aso/check_name_availability.py` looks a name up in Apple's public search in the us, gb, ca, au, sg,
  hk and tw storefronts and reports apps with the same or a close name.
