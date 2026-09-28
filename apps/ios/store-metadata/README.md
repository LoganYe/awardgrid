# App Store listing text

The App Store Connect fields of the AwardGrid iPhone app, one plain-text file per field: `name.txt`, `subtitle.txt`,
`keywords.txt`, `promotional_text.txt`, `description.txt`, `release_notes.txt`, `support_url.txt`, `marketing_url.txt`
and `privacy_url.txt`.

## en-US/: version 1.0

`en-US/` mirrors version 1.0 (build 3) as submitted on 2026-09-26: the texts recorded in
`docs/release/IOS_1.0_RELEASE.md` (§0 P6 and P9, §7.1, §7.3 and §7.6). Version 1.0 has no release notes. These files
change only when App Store Connect does. The description's first sentence describes a table cell as the web app's
table does; `growth/product-facts.json` lists it as retired wording (the `grid` claim's `retired_copy`), which the
public-claims gate refuses everywhere except in `en-US/description.txt`.

## next/: drafts for the next version

`next/<locale>/` holds drafts for the next version, for en-US, en-GB, en-AU and zh-Hans. None of them is in App Store
Connect.

- Name: AwardGrid in every locale.
- en-US keeps version 1.0's name and subtitle; only its keywords change.
- The en-US, en-GB and en-AU descriptions and promotional text are built from the sentences in
  `growth/product-facts.json`.
- zh-Hans is the Chinese draft in `docs/release/IOS_1.0_RELEASE.md` §7.6 with two changes: the first paragraph's
  description of a cell is replaced by the app's own Matrix caption (`apps/ios/src/components/results/copy.ts`), and
  the sentence about accounts names the App as its subject. Its promotional text is two sentences of that draft. All
  zh-Hans text needs a native speaker's review.
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
- `python3 scripts/aso/validate_metadata.py --dir apps/ios/store-metadata` checks version 1.0; it reports that
  version 1.0's keywords repeat "award" and "seats" from its subtitle.
- `node scripts/growth/validate-public-claims.mjs` checks every file here against `growth/product-facts.json`.
- `python3 scripts/aso/check_name_availability.py` looks a name up in Apple's public search in the us, gb, ca, au, sg,
  hk and tw storefronts and reports apps with the same or a close name.
