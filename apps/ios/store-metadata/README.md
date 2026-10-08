# App Store listing text

The App Store Connect fields of the AwardGrid iPhone app, one plain-text file per field: `name.txt`, `subtitle.txt`,
`keywords.txt`, `promotional_text.txt`, `description.txt`, `release_notes.txt`, `support_url.txt`, `marketing_url.txt`
and `privacy_url.txt`.

## en-US/: version 1.0, the resubmission (since 2026-10-07)

`en-US/` holds the texts for version 1.0 as it is resubmitted, after App Review rejected build 3 under Guideline 3.1.1
on 2026-10-05 (`docs/release/IOS_1.0_RELEASE.md` §0 P16-P17). They were written for build 4 and, the same day,
rewritten for the build that connects only through seats.aero's own sign-in. Until that build is submitted, the rule
that these files "change only when App Store Connect does" is suspended: `description.txt` and `promotional_text.txt`
are the step-36 texts of the 3.1.1 remediation plan, for the owner to paste in App Store Connect's single pass before
resubmission; App Store Connect still shows build 3's texts until then. The name, subtitle, keywords and URLs are
unchanged.

- **No listing text names the data provider (since 2026-10-08).** Per the data provider's trademark guidance, the
  name seats.aero is in no App Store listing text: not the name, subtitle or keywords (Guideline 2.3.7 already kept
  it out of those), and not the promotional text, description or release notes either, in any locale. The texts say
  "the third-party award-data provider AwardGrid supports", then "the provider". The app itself names seats.aero and
  keeps its "Data: seats.aero" attribution; the notes for App Review, which are not shown on the App Store, may name
  it too, and the website is not a listing. `scripts/aso/validate_metadata.py` and the public-claims gate
  (TRADEMARK_ASO) fail any listing text that names it, in any case or spelling ("seats aero", "seatsaero", "Login
  with Seats").
- Since 2026-10-07 (plan step 47F.5) the description is for the build that connects through the provider's own
  sign-in (Login with Seats.aero in the app), the only connection the App Store build has: it says "with the
  provider's own sign-in" and "AwardGrid has no in-app purchases" after the one neutral sentence about the provider's
  Pro plan (decision D6, in its unnamed form since 2026-10-08), and its privacy paragraph says that AwardGrid never
  sees the password to the provider account, that the sign-in tokens stay in the Keychain, that searches go directly
  to the provider, and that the token service at awardgrid.dowhiz.com stores nothing. Build 4 connects with a pasted
  key and is an internal TestFlight build only: these texts are not for it. The build they go with is the next one
  built with an OAuth client ID (`sites/auth/DEPLOY.md`).
- Its first sentence, like the promotional text, names no data source ("AwardGrid puts award seats for several
  origins, several destinations and up to 92 days into one table."): the sample-data bullet and the D6 paragraph say
  where results come from, so the listing does not open by presenting the provider's data as what the app is for
  (plan §1.2: the account only changes where results come from).
- It has no Ask (decision D3), names no Anthropic, and mentions the trip planner only because build 4 has it (plan
  step 18, decision D11): if the planner does not ship, its bullet goes too.
- Every sentence is in `growth/product-facts.json`: claims grid, sample_mode, query_input, views, watches, planner,
  prerequisite, data_cached, oauth_connection, privacy and affiliation. The bullets on search languages, views and
  watches are build 3's, kept word for word; the cached-data sentence is build 3's with "the provider" for
  "seats.aero" ("Results from the provider are its cached data"), so it speaks only of the account's results.
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
- zh-Hans: all text needs a native speaker's review, the build-4 description and promotional text included. Like
  the English, they name no data provider since 2026-10-08: 数据提供方 ("the provider"), 第三方里程票数据提供方 at first mention.
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
  the name, subtitle and keywords (Guideline 2.3.7), the data provider's name in any field, the promotional text,
  description and release notes included, and features the app does not have. A directory that is not a locale code
  as App Store Connect writes it (`zh-hant/` for `zh-Hant/`) is a warning, so it is never skipped unchecked. CI runs
  it.
- `python3 scripts/aso/validate_metadata.py --dir apps/ios/store-metadata` checks `en-US/`. The build-4 description
  and promotional text pass; it still reports that version 1.0's keywords, which the plan leaves unchanged, repeat
  "award" and "seats" from its subtitle (4 errors and 2 warnings, so `--strict` fails on them). `next/en-US/keywords.txt`
  was written for the same name and subtitle and passes; using it in App Store Connect is the owner's choice.
- `node scripts/growth/validate-public-claims.mjs` checks every file here against `growth/product-facts.json`; its
  TRADEMARK_ASO rule also fails the data provider's name in any listing text, prose included (not in this README).
- `python3 scripts/aso/check_name_availability.py` looks a name up in Apple's public search in the us, gb, ca, au, sg,
  hk and tw storefronts and reports apps with the same or a close name.
