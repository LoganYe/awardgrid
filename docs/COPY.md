# Copy: rules, glossary, and how to add a string

Words are design content (Phase 6 spec §1.3; `docs/UI_PLAN.md` §8). Every user-facing string lives in
`src/lib/i18n/dictionaries/en.ts` and `zh.ts`, under the same key. This document is the contract for
those strings; `src/lib/i18n/copy-rules.test.ts` enforces the mechanical half of it.

## 1. Rules

1. **Sentence case.** Buttons, labels, headings, table columns: first letter capitalised, the rest as in
   prose. Never Title Case, never ALL CAPS (IATA codes, `CSV`, `API`, `ID`, `URL`, `OK` excepted).
2. **Active voice, and a control says exactly what happens.** "Save as standing query", "Show flights",
   "Open in Alaska Mileage Plan". No "Submit", no "OK" as a verb.
3. **The same verb through the whole flow.** Button → progress → toast use one verb: "Save as standing
   query" → "Saving…" → "Standing query saved"; "Export CSV" → "Exporting…" → "CSV exported";
   "Link Telegram" → "Creating link…" → "Telegram linked"; "Log in" / "Log out" everywhere (never "Sign
   in/out").
4. **Errors say what happened and what to do next.** Two short sentences at most, no apology, no vagueness:
   "Couldn't reach awardgrid. Check your connection and retry." (the web app's dictionaries, which still write the
   name in lower case: see the glossary). Never "Sorry", "Oops", "Please" (en) or
   抱歉 / 对不起 (zh). Env-var names (`MASTER_KEY`, `TELEGRAM_BOT_TOKEN`) may appear because the
   self-hoster is the reader and the fix is that exact identifier.
5. **Empty states invite action.** A sentence plus a link button: "No standing queries yet. Save one from
   the grid." + "Go to grid". No box, no icon, no "nothing here".
6. **No filler.** No page subtitles that pitch the product, no "Note that", no "Simply". One scoped
   exemption: the signed-out front door at `/` (`home.*`, UI_PLAN §6.10) is the only screen where the
   product has been explained nowhere else, and its three blocks state constraints — invite only, your
   own key, what it does not do — never benefit claims.
7. **No glyphs doing a word's job inside a string.** No "→" or "->" (routes are rendered by components
   from data: `SEA → NRT` is a column header, never dictionary text); no " · " joining meta fragments
   (write two facts as two sentences or separate them with a comma); no "..." (use "…"); no em dash
   joining two clauses (en "—", zh "——"): split into two sentences.
8. **No trailing period on a label, button, menu item or toast.** Sentences (errors, hints, body text)
   end with one.
9. **Numbers and dates through `Intl`**; strings carry only the words around them
   (`{used} / {limit} today`). Keep the same `{placeholders}` in both languages.
10. **Chinese:** natural Simplified Chinese, not a word-for-word rendering; full-width punctuation
    （，。：？！（）） wherever the neighbouring character is Chinese; half-width only inside Latin
    fragments ("HKG to SEA, next month", `HH:MM`, `seats.aero`); no italics, no bold-for-emphasis; one
    term per concept (glossary below).

## 2. Glossary (en ↔ zh)

| Concept | en | zh | Notes |
|---|---|---|---|
| The product | AwardGrid | AwardGrid | One word, capital G, never translated: the name of the iPhone app and of the website's pages (see "The product's name" below). The private web app's own strings, in these dictionaries, still write `awardgrid` until they are changed, so rule 4's and §3's examples keep it |
| The grid page / the table | Grid | 表格 | 表格 is the natural word; 网格 is the machine-literal one. Also what `UI_PLAN.md` §8 uses |
| Standing query | Standing query | 定时查询 | Never "saved query" / 已保存查询, never "cron job" |
| Program (loyalty program) | Program | 里程计划 | Program names are text from `SOURCE_NAMES`, never translated |
| Cabin | Cabin | 舱位 | Economy 经济舱 · Premium economy 超级经济舱 · Business 商务舱 · First 头等舱 |
| Seats (the count) | seats | 座位数 | "2 seats" in prose is 2 个座位; the column/label is 座位数 |
| Fees | fees | 税费 | |
| Miles | miles | 里程 | |
| Freshness | Freshness | 数据时间 | Tiers: fresh 最新 · aging 较旧 · stale 过期 · unknown 未知 |
| Freshness line | seats.aero last saw this: {age} | seats.aero 查看时间：{age} | Never "Updated" / 更新于. `{age}` can be 刚刚 or 未知 (en: "now" / "unknown"), so the frame must accept a bare noun — 「于{age}查看」 and "Seen by seats.aero {age}" both broke on those two values |
| Award availability | availability | 里程票 | "No availability" 无里程票 |
| Route | Route | 航线 | |
| Origins / Destinations | Origins / Destinations | 出发地 / 目的地 | Chip labels; "origin airports" in errors is 出发机场 |
| Dates | Dates | 日期 | |
| Direct only | Direct only | 仅直飞 | |
| Dynamic pricing | dynamic pricing | 动态定价 | Toolbar switch "Show dynamic pricing" 显示动态定价 |
| Mixed cabin (`min_cabin_pct`) | Mixed cabin | 混舱 | Both the chip and the drawer badge (`grid.sheet.mixed_cabin`) use this one term. Its default (100) is **"not allowed" / 不允许**, never "off" / 关: "off" is what the Direct only chip beside it says for the opposite meaning, a constraint lifted, while 100 is the constraint at maximum |
| Not monitored | Not monitored by seats.aero | seats.aero 未监控此航线 | Cell state 3 |
| Not fetched | Not fetched | 未获取 | Cell state 4 |
| Chips (parsed query editors) | chips | 筛选条件 | |
| Cell | cell | 单元格 | |
| Daily limit (seats.aero quota) | daily limit | 每日上限 | "quota" as a budget is 额度 |
| API key | key | 密钥 | The web app and the iPhone app's development builds. The iPhone app's App Store build asks for no key: see the next row |
| Connecting a seats.aero account (iPhone app, App Store build) | Connect seats.aero / connect your seats.aero account with seats.aero's own sign-in (Login with Seats.aero) | 连接 seats.aero / 用 seats.aero 自己的登录连接 seats.aero 账户 | seats.aero asks you to sign in and approve AwardGrid; AwardGrid never sees your password; disconnect at any time, in AwardGrid or in your seats.aero settings. Never "paste the API key", "API tab" or "Pro key" in the iPhone app's public copy. The tokens are "the sign-in tokens" / 登录令牌, never shown; the Worker is "a small token service at awardgrid.dowhiz.com" / awardgrid.dowhiz.com 上的一个小型令牌服务 |
| Link / Unlink Telegram | Link Telegram / Unlink | 绑定 Telegram / 解绑 | |
| Alert (Telegram message) | alert | 提醒 | The verb "notify" is 通知 |
| Quiet hours | Quiet hours | 免打扰时段 | |
| Ask (the assistant lane) | Ask | 提问 | Feature name; "Ask budget" 提问额度. On the website's pages and in the iPhone app's public copy, "Ask" names only the AI feature, never searching: a search is typed ("Type the routes and dates …"). The web app's front door (`home.lead`) still opens "Ask in Chinese or English"; rewording it is the owner's decision |
| Run (a query) | Run | 运行 | Button on the query bar; "Run now" 立即运行. Never 重跑 |
| Schedule (a standing query's cadence) | Schedule | 频率 | Never 计划, which collides with 里程计划 |
| This server / instance / deployment | this server | 此服务器 | One noun for the machine; the person who runs it is the server's operator / 本站管理员 |
| Deep link to a program's site | link | 跳转链接 | Never 直达链接: 直达 reads as "nonstop" in a flight UI |
| Log in / Log out | Log in / Log out | 登录 / 退出登录 | Never "Sign in" |
| Settings | Settings | 设置 | "Open settings" 打开设置 |
| Program's site | the program's site | 里程计划官网 | |

### The product's name

**AwardGrid**, one word with a capital G, is the product's name on every public surface: the website's pages
(`sites/landing/`), the App Store listing, the public copy in `growth/` and the iPhone app's name. One spelling keeps
the product apart from other things called "award grid" and from "award chart", the generic term.

Not everything says it yet:

- The private web app's own strings still write `awardgrid`: `app.name` and several sentences in
  `packages/core/src/lib/i18n/dictionaries/`, which is why rule 4's and §3's examples keep the lower case. They
  change only if the owner decides to rename the web app too.
- Several strings inside the iPhone app still write `awardgrid` too: `apps/ios/src/app/App.tsx` (the heading shown
  when the app cannot start), `apps/ios/src/ask/labels.ts` (Ask's step and failure labels),
  `apps/ios/src/components/results/copy.ts` and `apps/ios/src/screens/watches-copy.ts` (in English and Chinese).
  Renaming them is a candidate change for a later version of the app, pending the owner's decision; a rename should
  start from `grep -rn awardgrid apps/ios/src`, not from this list.

The product in one sentence, for a heading, a profile or a listing that needs one (registered under the `grid`
claim of `growth/product-facts.json`, with the prerequisite and the platform):

- en: AwardGrid: award seats for many routes and dates in one table, on iPhone, from your own seats.aero account or from sample data.
- zh: AwardGrid：在 iPhone 上把多条航线、多个日期的里程票排进一张表，数据来自你自己的 seats.aero 账户或示例数据。

Until 2026-10-07 it ended "on your own seats.aero Pro key". Build 4 works without a key, on sample data, and the
public pages no longer call the key a Pro key (release plan step 22; `IOS_1.0_RELEASE.md` §0.1 D6).

Since the same day the App Store build connects a seats.aero account only through seats.aero's own sign-in, Login
with Seats.aero (release plan 47F; `npm run build:store` builds that flavour). The public copy says so in the words
of the registry's `oauth_connection` claim: "You connect your seats.aero account with seats.aero's own sign-in (Login
with Seats.aero): seats.aero asks you to sign in and approve AwardGrid, and AwardGrid never sees your password. You
can disconnect at any time, in AwardGrid or in your seats.aero settings." It never tells a reader to find, copy or
paste an API key. Where the iPhone app's privacy is described, "no server of its own" gave way to the token service
(the `privacy` claim), and results from the account are kept on the iPhone for at most 24 hours (`short_term_caching`).

Every other public sentence about the iPhone app comes from `growth/product-facts.json` (`allowed_copy` and its kin,
and `allowed_copy_zh` in Chinese), which `scripts/growth/validate-public-claims.mjs` checks in CI;
`scripts/growth/current-tree.test.ts` also checks that the titles, meta descriptions and H1s of `/ios/`,
`/ios/award-grid/` and `/ios/zh-hans/` are registered copy.

**"Ask" is the AI feature's name, and only that, on the website's pages and in the iPhone app's public copy.** There
a search is *typed*: "Type the routes and dates in English or Chinese, or set them in the editor." Never "Ask in
Chinese or English" for a search, and never "AI search": the search parser is deterministic
(`apps/ios/src/search/search.ts`). In Chinese the feature is AI 辅助, as the app names it; the website writes
AI 辅助（Ask） so it matches the English pages. Ask is not part of the App Store version 1.0 (`IOS_1.0_RELEASE.md`
§0.1 D3): the pages say so ("in testing; it is not part of the App Store version 1.0") and never offer it as a feature
of that version. The web app's signed-out front door (`home.lead` in the dictionaries) still opens "Ask in Chinese or
English"; it is the web app's own copy, and rewording it is the owner's decision.

## 3. Before → after (from the dictionaries)

| # | Key | Before | After (en) | After (zh) | Rule |
|---|---|---|---|---|---|
| 1 | `grid.save_query` + `saved.dialog.saved` | "Save query" / "Saved as a standing query." | "Save as standing query" → "Standing query saved" | 「保存为定时查询」→「定时查询已保存」 | 3, 8 |
| 2 | `grid.empty.no_key` + `_cta` | "Add your seats.aero key in Settings." + "Go to Settings" | "Add your seats.aero Pro key to search." + "Open settings" | 「添加 seats.aero Pro 密钥后即可搜索。」+「打开设置」 | 1, 5 |
| 3 | `grid.empty.parse_missing` | "Missing: {fields}" | "Couldn't read the {fields} in this query." | 「无法识别这个查询中的{fields}。」 | 4 |
| 4 | `error.network` | "Network error — please try again." | "Couldn't reach awardgrid. Check your connection and retry." | 「无法连接 awardgrid，请检查网络后重试。」 | 4, 7 |
| 5 | `error.unauthorized` | "Please log in." | "You're logged out. Log in again." | 「你已退出登录，请重新登录。」 | 4 |
| 6 | `settings.keys.status_saved` | "{masked} · added {date}" | "{masked}, added {date}" | 「{masked}，添加于 {date}」 | 7 |
| 7 | `grid.sheet.title` | "{origin} → {dest} · {date}" | "{origin} to {dest}, {date}" | 「{origin} 到 {dest}，{date}」 | 7 |
| 8 | `grid.freshness.legend` | "Freshness: fresh < 2h · aging ≤ 6h · stale > 6h" | "Freshness: fresh under 2 h, aging up to 6 h, stale over 6 h" | 「数据时间：2 小时内为最新，6 小时内为较旧，超过 6 小时为过期」 | 7, 10 |
| 9 | `ask.subtitle` | "Advisory only — searches, compares and explains; never books or logs in." | "Searches, compares and explains. Never books or logs in." | 「只搜索、比较和解释，不会预订或登录。」 | 7 |
| 10 | `settings.account.logout_all` | "Sign out everywhere" | "Log out everywhere" | 「在所有设备上退出登录」 | 3 |
| 11 | `settings.keys.input_hint_seats` | "Copy it from the API tab of seats.aero → Settings (Pro plan)…" | "Copy it from the API tab of your seats.aero settings (Pro plan). Saving spends one API call to check it." | 「从 seats.aero 设置页的 API 标签复制（需要 Pro）。保存时会用一次 API 调用来验证。」 | 7 |
| 12 | `saved.run.cells` | "{new_cells} new · {dropped_cells} gone" | "{new_cells} new, {dropped_cells} gone" | 「新增 {new_cells}，消失 {dropped_cells}」 | 7 |
| 13 | `grid.deeplink_caveat` | "Confirm on the program's site before transferring any points — cached data can be stale…" | "Confirm on the program's site before transferring any points. Cached data can be stale and awards disappear." | 「转点前请先在里程计划官网确认。缓存数据可能过期，里程票随时会消失。」 | 7 |
| 14 | `notice.parse.range_truncated` | "date range truncated to {days} days ({date_from} → {date_to}); split…" | "Date range truncated to {days} days ({date_from} to {date_to}). Split longer searches into several queries." | 「日期范围已缩短为 {days} 天（{date_from} 至 {date_to}）。更长的范围请分多次搜索。」 | 1, 7 |
| 15 | `grid.provenance.llm` | "DET" / "LLM" badges on every chip | "guessed" — one 12 px sentence-case note beside "Parsed from", shown only when the language model filled a field | 「推测」 | 6 (`UI_PLAN.md` §3) |

Two notes on the table, both deliberate: row 14 keeps the word "truncated" in English because
`test/fixtures/queries/cases.json` pins the notice text and the phrase is plain English (the zh side reads 「已缩短为」,
which is the natural Chinese for it — the rule is one term per concept per language, not a word-for-word pairing); and
row 15 has no `grid.provenance.deterministic` key, because the deterministic path shows nothing at all — a note appears
only when the language model filled a field.

## 4. How to add a string

1. Pick a key `page.section.thing` in lowercase snake case: `grid.chips.at_least_one_airport`,
   `settings.telegram.qr_hint`, `saved.dialog.submit`. The first segment is the page or surface
   (`nav`, `footer`, `auth`, `grid`, `saved`, `settings`, `ask`, `common`, `error`, `notice`, `notify`,
   `quota`, `theme`); the middle segments are the section or component; the last names the thing.
   Controls end in a verb or control name (`.run`, `.submit`, `_cta`, `.open_link`); the lint treats those
   as labels (no trailing period, capitalised first word).
2. Append it to **both** `en.ts` and `zh.ts` with the same `{placeholders}` (601 keys each today; `i18n.test.ts` fails
   the moment they diverge). Reuse a glossary term; do not coin a second word for a concept that has one.
3. Never put text in JSX. Render with `t("key")` (server: `getT()` from `@/lib/i18n/server`; client:
   `useT()` from `@/lib/i18n/client`). Compose data in components (`SEA → NRT`, `60,000`), words in the
   dictionary.
4. Run `pnpm exec vitest run src/lib/i18n`. `i18n.test.ts` checks key sets and placeholders match;
   `copy-rules.test.ts` checks the rules in §1. A failure names the key.
5. If a proper noun trips the Title Case or ALL-CAPS check, add it to `src/lib/i18n/copy-allowlist.ts`
   with a reason. Program names come from `SOURCE_NAMES` automatically.

## 5. What the test guards

`src/lib/i18n/copy-rules.test.ts`, both languages unless noted:

- ALL-CAPS tokens of 4+ letters outside `CAPS_ALLOWED`.
- "→" or "->" anywhere.
- " · " anywhere, except keys listed in `MIDDLE_DOT_EXEMPT` (only `notify.digest.title`, a Telegram
  message whose exact text is pinned by `src/lib/notify/format.test.ts`).
- "..." instead of "…".
- "sorry", "oops", "please" (en, whole word, any case); 抱歉 / 对不起 / 不好意思 / 很遗憾 (zh).
- "—" in en; "——" in zh.
- Control keys (patterns in `CONTROL_KEY_PATTERNS`) ending with "." or "。", or (en) not starting with a
  capital letter, digit or placeholder.
- en: two adjacent capitalised plain words that are not in `PROPER_NOUNS` and do not straddle a
  sentence boundary (Title Case heuristic).
- zh: half-width `, . : ; ? ! ( )` touching a Chinese character, or ending a Chinese string; values with
  no Chinese characters unless identical to the English value (`Telegram`, `v{version}`, `{n}/{max}`);
  `<i>` / `<em>` markup.
