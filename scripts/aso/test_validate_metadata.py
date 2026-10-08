#!/usr/bin/env python3
"""Tests for scripts/aso/validate_metadata.py.

Run:
    python3 -m unittest discover -s scripts/aso -p 'test_*.py' -v
"""

from __future__ import annotations

import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("validate_metadata", Path(__file__).with_name("validate_metadata.py"))
v = importlib.util.module_from_spec(_SPEC)
sys.modules["validate_metadata"] = v
_SPEC.loader.exec_module(v)

SCRIPT = Path(v.__file__)
RELEASE_DOC = v.REPO_ROOT / "docs" / "release" / "IOS_1.0_RELEASE.md"
GATE = v.REPO_ROOT / "scripts" / "growth" / "validate-public-claims.mjs"

# A neutral, valid listing; each test changes one thing.
BASE = {
    "name": "Tablely",
    "subtitle": "Recipes in one grid",
    "keywords": "cook,bake,meal,dinner,lunch,breakfast,kitchen,pantry,menu,planner,ingredients,shopping,list,vegan",
    "promotional_text": "Plan your week of meals.",
    "description": "A meal planner.",
    "support_url": "https://awardgrid.dowhiz.com/support/",
    "marketing_url": "https://awardgrid.dowhiz.com/ios/",
    "privacy_url": "https://awardgrid.dowhiz.com/privacy/",
}


def check(locale: str = "en-US", **overrides: str) -> v.LocaleReport:
    values = dict(BASE)
    for key, value in overrides.items():
        if value is None:
            values.pop(key, None)
        else:
            values[key] = value
    return v.validate_values(locale, values, tuple(values))


def messages(report: v.LocaleReport, level: str | None = None) -> list:
    return [i.message for i in report.issues if level is None or i.level == level]


def write_locale(root: Path, locale: str, values: dict) -> Path:
    d = root / locale
    d.mkdir(parents=True)
    for key, value in values.items():
        (d / f"{key}.txt").write_text(value + "\n", encoding="utf-8")
    return d


def run_cli(*args: str) -> tuple:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = v.main(list(args))
    return code, out.getvalue(), err.getvalue()


class TestBase(unittest.TestCase):
    def test_the_neutral_listing_is_clean(self):
        report = check()
        self.assertEqual(report.errors + report.warnings, [], messages(report))


class TestLengths(unittest.TestCase):
    def test_over_limit_is_an_error(self):
        self.assertTrue(any("exceeds the 30-char limit" in m for m in messages(check(name="R" * 31), "error")))
        self.assertTrue(any("exceeds the 170-char limit" in m for m in messages(check(promotional_text="p" * 171), "error")))
        self.assertTrue(any("exceeds the 4000-char limit" in m for m in messages(check(description="d" * 4001), "error")))

    def test_exactly_at_limit_passes(self):
        report = check(name="R" * 30, subtitle="s" * 30, promotional_text="p" * 170)
        self.assertFalse(any("exceeds" in m for m in messages(report)))

    def test_astral_chars_cost_two_and_cjk_counts_by_character(self):
        self.assertEqual(v.field_len("🌙"), 2)
        self.assertEqual(v.field_len("abc"), 3)
        self.assertEqual(v.field_len("里程票"), 3)

    def test_utf8_bytes(self):
        self.assertEqual(v.utf8_len("里程"), 6)
        self.assertEqual(v.utf8_len("miles"), 5)

    def test_newline_in_a_single_line_field(self):
        self.assertTrue(any("contains a newline" in m for m in messages(check(name="Tab\nlely"), "error")))


class TestKeywordFormat(unittest.TestCase):
    def test_space_after_comma_is_an_error(self):
        self.assertTrue(any('", "' in m for m in messages(check(keywords="cook, bake"), "error")))

    def test_duplicate_term_is_an_error(self):
        self.assertTrue(any("listed 2 times" in m for m in messages(check(keywords="cook,bake,Cook"), "error")))

    def test_trailing_comma_and_empty_term(self):
        errors = messages(check(keywords="cook,,bake,"), "error")
        self.assertTrue(any("trailing comma" in m for m in errors))
        self.assertTrue(any("empty term" in m for m in errors))

    def test_illegal_separators_are_errors(self):
        for raw in ("cook;bake", "cook、bake", "cook，bake", "cook|bake"):
            with self.subTest(raw=raw):
                self.assertTrue(any("ILLEGAL_KEYWORD_CHARACTER" in m for m in messages(check(keywords=raw), "error")))

    def test_underfilled_budget_warns(self):
        self.assertTrue(any("thrown away" in m for m in messages(check(keywords="cook,bake"), "warning")))

    def test_ninety_five_characters_is_enough(self):
        keywords = "k" * 95
        self.assertFalse(any("thrown away" in m for m in messages(check(keywords=keywords))))
        self.assertTrue(any("thrown away" in m for m in messages(check(keywords="k" * 94), "warning")))

    def test_dead_terms_warn(self):
        report = check(keywords="free,app,iphone,tablely," + "k" * 80)
        self.assertGreaterEqual(len([m for m in messages(report, "warning") if "no search value" in m]), 3)

    def test_the_category_is_a_note_not_a_warning(self):
        report = check(keywords="travel," + "k" * 90)
        self.assertTrue(any("primary category" in m for m in messages(report, "info")))
        self.assertFalse(any("primary category" in m for m in messages(report, "warning")))


class TestCrossFieldDuplication(unittest.TestCase):
    def test_keyword_repeating_a_name_or_subtitle_word_is_an_error(self):
        report = check(keywords="recipes,cook")
        self.assertTrue(any("'recipes' (in 'recipes') already appears" in m for m in messages(report, "error")))

    def test_name_and_subtitle_overlap_is_an_error(self):
        report = check(name="Recipe Grid", subtitle="Recipe cards")
        self.assertTrue(any("appears in both the name and the subtitle" in m for m in messages(report, "error")))

    def test_stop_words_are_not_repeats(self):
        report = check(name="Meals in a Week", subtitle="Recipes in one grid")
        self.assertFalse(any("both the name and the subtitle" in m for m in messages(report)))

    def test_word_repeated_across_keyword_terms_warns(self):
        report = check(keywords="meal plan,meal prep,cook")
        self.assertTrue(any("'meal' is repeated across keyword terms" in m for m in messages(report, "warning")))

    def test_cjk_term_inside_the_subtitle_is_an_error(self):
        report = check("zh-Hans", subtitle="积分里程换商务舱", keywords="商务舱,余票")
        self.assertTrue(any("already a substring of the name or subtitle" in m for m in messages(report, "error")))

    def test_cjk_term_inside_another_term_warns(self):
        report = check("zh-Hans", subtitle="一张表", keywords="机票,兑换机票")
        self.assertTrue(any("is a substring of" in m for m in messages(report, "warning")))

    def test_cjk_name_and_subtitle_overlap_is_an_error(self):
        report = check("zh-Hans", name="Tablely 里程票", subtitle="里程票一张表", keywords="余票")
        self.assertTrue(any("'里程票' appears in both the name and the subtitle" in m for m in messages(report, "error")))

    def test_a_latin_locale_ignores_substrings(self):
        report = check(keywords="nap,snap")
        self.assertEqual([m for m in messages(report) if "substring" in m], [])

    def test_a_cjk_term_spanning_a_separator_is_not_an_error(self):
        report = check("zh-Hans", name="深度记录", subtitle="白噪音", keywords="录白,雨声")
        self.assertFalse(any("substring" in m for m in messages(report, "error")))


class TestTrademarks(unittest.TestCase):
    def test_third_party_names_fail_in_the_name_subtitle_and_keywords(self):
        cases = (
            ("keywords", "award,seats aero,miles"),
            ("keywords", "award,seatsaero,miles"),
            ("keywords", "award,SEATS.AERO,miles"),
            ("subtitle", "Award seats, with Claude"),
            ("name", "Tablely for Anthropic"),
            ("keywords", "award,AAdvantage,business"),
            ("keywords", "award,skymiles,business"),
            ("keywords", "award,miles & more,grid"),
            ("keywords", "pointsyeah,grid"),
            ("keywords", "awardwallet,grid"),
            ("keywords", "point.me,grid"),
            ("keywords", "roame,grid"),
            ("keywords", "美国航空,里程"),
            ("keywords", "美航,里程"),
            ("keywords", "avios,grid"),
        )
        for field_name, text in cases:
            with self.subTest(field=field_name, text=text):
                self.assertTrue(any("TRADEMARK" in m for m in messages(check(**{field_name: text}), "error")))

    def test_seats_is_a_brand_only_when_it_stands_alone(self):
        self.assertTrue(any("TRADEMARK" in m for m in messages(check(keywords="award,Seats,points"), "error")))
        self.assertTrue(any("TRADEMARK" in m for m in messages(check(subtitle="Login with Seats"), "error")))
        self.assertTrue(any("TRADEMARK" in m for m in messages(check(name="Seats Pro Grid"), "error")))
        self.assertEqual(v.trademark_hits("Award seats in one table"), [])
        self.assertEqual(v.trademark_hits("award seats,seat,business"), [])

    def test_generic_words_pass(self):
        # A program's full name is a trademark; its generic words on their own are not ("Qantas Frequent Flyer").
        for text in (
            "award seats,points,miles,business class,grid",
            "frequent,flyer,singapore,mileage",
            "新航线,航空公司,直飞",
            "北美航线,中国航线,中澳航线,中日航线,每日航班,增加航班,新航站楼,航空里程,积分,里程",
            "miles upgrade,points,award,seat,wallet,tool,fares",
        ):
            with self.subTest(text=text):
                self.assertEqual(v.trademark_hits(text), [])

    def test_chinese_airline_and_program_names(self):
        # The full names and the short name before 航空 / 里程 / 积分, in both scripts; this validator is the only
        # guard on the zh keyword fields.
        for text in (
            "达美航空", "達美航空", "汉莎航空", "漢莎航空", "德国汉莎航空", "德國漢莎", "国泰航空", "國泰航空", "长荣航空",
            "長榮航空", "中华航空", "中華航空", "捷蓝航空", "捷藍航空", "中国国航", "中國國航", "国航里程", "澳航积分",
            "新航里程", "法航荷航", "维珍大西洋航空", "維珍大西洋", "墨西哥国际航空", "墨西哥國際航空", "沙特阿拉伯航空",
            "沙烏地阿拉伯航空", "埃航", "前程万里", "前程萬里", "凤凰知音", "东方万里行", "美航会员", "日航哩程",
        ):
            with self.subTest(text=text):
                self.assertNotEqual(v.trademark_hits(text), [], text)
                self.assertTrue(any("TRADEMARK" in m for m in messages(check("zh-Hans", subtitle="一张表", keywords=f"余票,{text}"), "error")))

    def test_program_and_competitor_names_in_keyword_spelling(self):
        # Lower case, and with or without the space or dot a keyword field might give them.
        for text in (
            "velocity", "velocity points", "virgin", "seats pro", "seats app", "seats api", "login with seats",
            "points yeah", "point me", "pointme", "award wallet", "award fares", "award tool", "miles up",
            "sky miles", "kris flyer", "seats . aero",
        ):
            with self.subTest(text=text):
                self.assertNotEqual(v.trademark_hits(text), [], text)
                self.assertTrue(any("TRADEMARK" in m for m in messages(check(keywords=f"cook,{text}"), "error")))

    def test_prose_fields_may_name_what_the_app_works_with(self):
        report = check(description="Needs your own seats.aero Pro key. Ask uses Claude on your Anthropic key.")
        self.assertFalse(any("TRADEMARK" in m for m in messages(report)))

    def test_every_program_in_packages_core_is_a_trademark(self):
        sources, names = v.programs_from_core()
        self.assertEqual(len(sources), 26)
        self.assertEqual(sorted(v.PROGRAM_BRANDS), sorted(sources))
        self.assertEqual(len(names), 26)
        folded = {t.casefold() for t in v.TRADEMARKS}
        for name in names:
            self.assertIn(name.casefold(), folded)

    def test_the_list_holds_everything_the_public_claims_gate_lists(self):
        src = GATE.read_text(encoding="utf-8")
        base = re.search(r"export const TRADEMARK_BASE = \[([^\]]*)\]", src)
        brands = re.search(r"export const PROGRAM_BRANDS = \{([\s\S]*?)\n\};", src)
        self.assertIsNotNone(base)
        self.assertIsNotNone(brands)
        gate_terms = re.findall(r'"([^"]+)"', base.group(1)) + re.findall(r'"([^"]+)"', brands.group(1))
        self.assertGreater(len(gate_terms), 40)
        folded = {t.casefold() for t in v.TRADEMARKS}
        self.assertEqual([t for t in gate_terms if t.casefold() not in folded], [])

    def test_other_award_search_apps_are_listed(self):
        folded = {t.casefold() for t in v.TRADEMARKS}
        for name in ("point.me", "Roame", "AwardFares", "PointsYeah", "AwardTool", "MilesUp", "Flightpoints", "AwardWallet"):
            self.assertIn(name.casefold(), folded)


class TestUnsupportedFeatures(unittest.TestCase):
    def assertFlags(self, report, word=None):
        found = [m for m in messages(report, "error") if "UNSUPPORTED_FEATURE" in m]
        self.assertTrue(found, messages(report))
        if word:
            self.assertTrue(any(repr(word) in m for m in found), found)

    def assertClean(self, report):
        self.assertEqual([m for m in messages(report) if "UNSUPPORTED_FEATURE" in m], [])

    def test_claims_in_prose_are_errors(self):
        for text, word in (
            ("Get real-time award availability.", "real-time"),
            ("Live award availability for every route.", "Live"),
            ("It alerts you when seats open.", "alerts"),
            ("We notify you when a seat opens.", "notify"),
            ("Push notifications for new seats.", "notifications"),
            ("It books the seat for you.", "books"),
            ("Auto-book the cheapest seat.", "Auto-book"),
            ("实时查询里程票。", "实时"),
            ("有座位时提醒你。", "提醒"),
            ("即時通知。", "即時"),
        ):
            with self.subTest(text=text):
                self.assertFlags(check(description=text), word)

    def test_negated_limits_pass(self):
        for text in (
            "Results are seats.aero's cached availability, not a live search, and each shows how old it is.",
            "Watches are checked when you open the app; there is no background check and no notification.",
            "There are no alerts or notifications.",
            "For an option it opens seats.aero's booking link when there is one; otherwise you copy the search. It never books.",
            "It does not send you alerts.",
            "No live search, no booking, no round trips, no alerts or notifications.",
            "没有后台检查，也没有通知。",
            "不提供实时查询。",
        ):
            with self.subTest(text=text):
                self.assertClean(check(description=text))

    def test_a_negation_elsewhere_does_not_hide_a_claim(self):
        for text in (
            "No subscription, and it sends alerts.",
            "There are no ads but live results.",
            "It has no ads and it notifies you.",
            "没有广告，但提供实时查询。",
            "非常及时的提醒。",
        ):
            with self.subTest(text=text):
                self.assertFlags(check(description=text))

    def test_a_person_is_not_the_app(self):
        for text in ("If you live in mainland China, it is not offered.", "You book the seat yourself, on the program's site.", "Then you can book it."):
            with self.subTest(text=text):
                self.assertClean(check(description=text))

    def test_in_keywords_and_titles_any_use_is_an_error(self):
        for field_name, text in (
            ("keywords", "cook,alerts,bake"),
            ("keywords", "cook,live,bake"),
            ("keywords", "cook,realtime,bake"),
            ("keywords", "no alerts,cook"),
            ("keywords", "实时,里程"),
            ("subtitle", "Seat alerts by date"),
            ("name", "Tablely Live"),
        ):
            with self.subTest(field=field_name, text=text):
                self.assertFlags(check(**{field_name: text}))

    def test_word_boundaries(self):
        self.assertClean(check(keywords="facebook,notebook,delivery,livery,bookmark,pushchair,instantiate"))

    def test_booking_words_in_keywords_and_titles(self):
        for field_name, text in (
            ("keywords", "cook,booking,bake"),
            ("keywords", "cook,award booking,bake"),
            ("keywords", "预订,里程"),
            ("keywords", "訂票,里程"),
            ("keywords", "出票,里程"),
            ("keywords", "代订,里程"),
            ("subtitle", "Award booking by date"),
            ("keywords", "cook,booking link"),
        ):
            with self.subTest(field=field_name, text=text):
                self.assertFlags(check(**{field_name: text}))

    def test_push_and_instant_are_claims(self):
        for field_name, text in (
            ("keywords", "cook,push,bake"),
            ("keywords", "推送,里程"),
            ("keywords", "cook,instant,bake"),
            ("description", "Push alerts for new seats."),
            ("description", "Instant results for every route."),
            ("description", "有座位时推送给你。"),
        ):
            with self.subTest(field=field_name, text=text):
                self.assertFlags(check(**{field_name: text}))
        for text in ("There are no push notifications.", "没有推送，也没有通知。"):
            with self.subTest(text=text):
                self.assertClean(check(description=text))

    def test_booking_in_prose(self):
        # seats.aero's booking link exists; booking as a feature does not.
        for text in ("For an option it opens seats.aero's booking link when there is one.", "打开 seats.aero 的预订链接。"):
            with self.subTest(text=text):
                self.assertClean(check(description=text))
        for text in ("Award booking made easy.", "Fast booking for every route.", "一键预订里程票。", "代订机票。"):
            with self.subTest(text=text):
                self.assertFlags(check(description=text))
        for text in ("No booking, no alerts.", "不提供预订。", "It never books, and there is no booking in the app."):
            with self.subTest(text=text):
                self.assertClean(check(description=text))

    def test_a_negation_does_not_reach_the_next_bullet_line(self):
        # App Store descriptions are often bullet lines with no full stop.
        for text in (
            "• No ads\n• Alerts when seats open",
            "• 没有账号\n• 实时提醒",
            "No ads\nLive results",
            "- No ads\n- Alerts when seats open",
            "* No subscription\n* Real-time availability",
            "No ads • Alerts when seats open",
            "没有广告 · 实时查询",
        ):
            with self.subTest(text=text):
                self.assertFlags(check(description=text))
        self.assertEqual(v.unsupported_hits("• No ads\n• Alerts when seats open", True), [("Alerts", "alert: there are no alerts")])
        # A negation inside its own bullet line still governs it.
        for text in ("• No alerts\n• No live search", "• 没有通知\n• 不提供实时查询"):
            with self.subTest(text=text):
                self.assertClean(check(description=text))

    def test_the_cli_fails_a_bullet_claim_after_a_negated_bullet(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "en-US", {**BASE, "description": "• No ads\n• Alerts when seats open"})
            write_locale(root, "zh-Hans", {**BASE, "subtitle": "一张表", "keywords": "余票,日历," + "k" * 90, "description": "• 没有账号\n• 实时提醒"})
            code, out, _ = run_cli("--dir", str(root), "--strict")
            self.assertEqual(code, 1, out)
            self.assertIn("UNSUPPORTED_FEATURE: 'Alerts'", out)
            self.assertIn("UNSUPPORTED_FEATURE: '实时'", out)
            self.assertIn("UNSUPPORTED_FEATURE: '提醒'", out)

    def test_a_modifier_is_not_a_negation(self):
        # 没有…的 describes the noun after 的; "Nothing beats" starts a claim; "no-lag" is an adjective.
        for text in ("没有延迟的实时查询。", "没有广告的实时提醒。", "Nothing beats live results.", "No-lag live search.", "No app gives live results."):
            with self.subTest(text=text):
                self.assertFlags(check(description=text))
        for text in ("没有目的地提醒。", "There is nothing live about it: results are cached.", "No push notifications."):
            with self.subTest(text=text):
                self.assertClean(check(description=text))


class TestUiLanguageDisclosure(unittest.TestCase):
    SENTENCE = "App 介面為簡體中文與英文。"

    def test_zh_hant_needs_the_sentence(self):
        report = check("zh-Hant", subtitle="一表看清", keywords="獎勵,酬賓", description="用中文或英文輸入航線和日期。")
        self.assertTrue(any("UI_LANGUAGE_DISCLOSURE" in m for m in messages(report, "error")))
        report = check("zh-Hant", subtitle="一表看清", keywords="獎勵,酬賓", description="用中文或英文輸入航線和日期。" + self.SENTENCE)
        self.assertFalse(any("UI_LANGUAGE" in m for m in messages(report)))

    def test_zh_hant_cannot_promise_a_traditional_interface(self):
        report = check("zh-Hant", subtitle="一表看清", keywords="獎勵", promotional_text="完整繁體中文 App 介面。", description=self.SENTENCE)
        self.assertTrue(any("UNSUPPORTED_UI_LANGUAGE" in m for m in messages(report, "error")))
        report = check("zh-Hant", subtitle="一表看清", keywords="獎勵", description="尚未提供繁體中文介面。" + self.SENTENCE)
        self.assertFalse(any("UNSUPPORTED_UI_LANGUAGE" in m for m in messages(report)))

    def test_every_traditional_chinese_locale_gets_the_checks(self):
        for locale in ("zh-Hant-HK", "zh-Hant-TW", "zh-HK", "zh-TW"):
            with self.subTest(locale=locale):
                report = check(locale, subtitle="一表看清", keywords="獎勵", promotional_text="完整繁體中文 App 介面。", description="用中文或英文輸入航線和日期。")
                errors = messages(report, "error")
                self.assertTrue(any("UNSUPPORTED_UI_LANGUAGE" in m for m in errors), errors)
                self.assertTrue(any("UI_LANGUAGE_DISCLOSURE" in m for m in errors), errors)
                report = check(locale, subtitle="一表看清", keywords="獎勵", description="用中文或英文輸入航線和日期。" + self.SENTENCE)
                self.assertFalse(any("UI_LANGUAGE" in m for m in messages(report)))
                self.assertIn("keywords_utf8_bytes", report.lengths)

    def test_other_locales_need_no_disclosure(self):
        self.assertFalse(any("UI_LANGUAGE" in m for m in messages(check("zh-Hans", subtitle="一张表", keywords="余票"))))


class TestUrls(unittest.TestCase):
    def test_store_urls_must_be_plain_first_party_https(self):
        for url in (
            "https://example.org/privacy/",
            "https://awardgrid.dowhiz.com.evil.example/privacy/",
            "https://user@awardgrid.dowhiz.com/privacy/",
            "https://awardgrid.dowhiz.com:8443/privacy/",
            "https://awardgrid.dowhiz.com/?redirect=https://example.org",
            "https://awardgrid.dowhiz.com/ios/#top",
            "http://awardgrid.dowhiz.com/ios/",
        ):
            with self.subTest(url=url):
                self.assertTrue(any("FIRST_PARTY_URL" in m for m in messages(check(privacy_url=url), "error")))

    def test_the_site_pages_pass(self):
        for url in ("https://awardgrid.dowhiz.com/support/", "https://awardgrid.dowhiz.com/ios/"):
            self.assertTrue(v.is_first_party_url(url))


class TestFieldsPresent(unittest.TestCase):
    def test_required_fields(self):
        for name in v.REQUIRED:
            with self.subTest(field=name):
                self.assertTrue(any(f"{name}.txt is missing" in m for m in messages(check(**{name: None}), "error")))

    def test_optional_fields_are_notes(self):
        report = check(promotional_text=None, marketing_url=None)
        self.assertEqual(report.errors + report.warnings, [])
        notes = messages(report, "info")
        self.assertTrue(any("release_notes.txt is missing" in m for m in notes))
        self.assertTrue(any("promotional_text.txt is missing" in m for m in notes))

    def test_an_unknown_file_warns(self):
        with tempfile.TemporaryDirectory() as temp:
            d = write_locale(Path(temp), "en-US", {**BASE, "copyright": "2026"})
            self.assertTrue(any("not an App Store Connect field" in m for m in messages(v.validate_locale(d), "warning")))


class TestKeywordFallback(unittest.TestCase):
    ZH = {"subtitle": "积分里程换商务舱头等舱，一张表看清", "keywords": "里程票,查询,兑换机票,奖励机票,常旅客,飞行常客,公务舱,余票,日历,矩阵,航线,舱位,查票,出发地,目的地,直飞,单程,航班,航空公司,多机场,多日期"}

    def test_cjk_keywords_report_their_bytes(self):
        report = check("zh-Hans", **self.ZH)
        self.assertGreater(report.lengths["keywords_utf8_bytes"], 100)
        self.assertTrue(any("UTF-8 bytes" in m for m in messages(report, "info")))
        self.assertFalse(any("UTF-8 bytes" in m for m in messages(report, "warning") + messages(report, "error")))

    def test_the_fallback_must_fit_in_100_bytes(self):
        report = check("zh-Hans", keywords_fallback="里程票,查询,兑换机票,奖励机票,常旅客,飞行常客,公务舱,余票,日历,矩阵", **self.ZH)
        self.assertEqual(report.lengths["keywords_fallback_utf8_bytes"], 96)
        self.assertFalse(any("fallback" in i.field for i in report.errors + report.warnings), messages(report))
        report = check("zh-Hans", keywords_fallback="里程票,查询,兑换机票,奖励机票,常旅客,飞行常客,公务舱,余票,日历,矩阵,直飞", **self.ZH)
        self.assertTrue(any("exceeds the 100-byte fallback limit" in m for m in messages(report, "error")))

    def test_the_fallback_follows_the_other_keyword_rules(self):
        report = check("zh-Hans", keywords_fallback="商务舱,余票", **self.ZH)
        self.assertTrue(any("already a substring" in m for m in messages(report, "error")))

    def test_a_latin_locale_needs_no_fallback(self):
        self.assertTrue(any("only needed for a CJK locale" in m for m in messages(check(keywords_fallback="cook"), "warning")))


class TestCrossLocale(unittest.TestCase):
    GB = {"name": "Tablely", "subtitle": "Meal cards by date", "keywords": "cook,bake,menu"}
    AU = {"name": "Tablely", "subtitle": "Recipes per day", "keywords": "pantry,lunch,dinner"}

    def test_storefronts(self):
        self.assertEqual(v.storefront_locales({"en-US", "en-GB", "en-AU"}), {"us": ("en-US",), "gb": ("en-GB",), "au": ("en-AU", "en-GB"), "ca": ("en-US",)})
        self.assertEqual(v.storefront_locales({"en-US", "en-CA"})["ca"], ("en-CA",))
        self.assertEqual(v.storefront_locales({"en-AU"}), {"au": ("en-AU",)})

    def test_au_indexes_en_au_and_en_gb_together(self):
        self.assertEqual(v.check_cross_locale({"en-GB": self.GB, "en-AU": self.AU}), [])
        au = dict(self.AU, keywords="pantry,lunch,menu")
        issues = v.check_cross_locale({"en-GB": self.GB, "en-AU": au})
        self.assertEqual(len(issues), 1)
        self.assertIn("CROSS_LOCALE_DUPLICATE: 'menu'", issues[0].message)
        self.assertIn("AU storefront", issues[0].locale)
        # A subtitle word counts too.
        issues = v.check_cross_locale({"en-GB": self.GB, "en-AU": dict(self.AU, keywords="pantry,meal")})
        self.assertTrue(any("'meal'" in i.message for i in issues))

    def test_the_brand_in_every_name_is_not_a_repeat(self):
        self.assertEqual(v.check_cross_locale({"en-GB": dict(self.GB, name="AwardGrid"), "en-AU": dict(self.AU, name="AwardGrid")}), [])
        # A name word in the other locale's keywords is a repeat.
        issues = v.check_cross_locale({"en-GB": dict(self.GB, name="Tablely Menus"), "en-AU": dict(self.AU, keywords="pantry,menus")})
        self.assertTrue(any("'menus'" in i.message for i in issues))

    def test_locales_no_storefront_indexes_together_may_share_words(self):
        us = dict(self.GB, subtitle="Other words here")
        self.assertEqual(v.check_cross_locale({"en-US": us, "en-GB": self.GB}), [])

    def test_the_cli_fails_on_a_cross_locale_repeat(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "en-GB", BASE)
            write_locale(root, "en-AU", {**BASE, "subtitle": "Dishes per day", "keywords": "k" * 91 + ",menu"})
            code, out, _ = run_cli("--dir", str(root))
            self.assertEqual(code, 1, out)
            self.assertIn("CROSS_LOCALE_DUPLICATE", out)


class TestFillKeywords(unittest.TestCase):
    def test_it_skips_what_the_checks_refuse_and_fills_to_the_limit(self):
        values = {"name": "Tablely", "subtitle": "Recipes in one grid"}
        candidates = ["recipes", "cook", "free", "claude", "alerts", "cook", "meal", "menu", "x" * 90, "dinner"]
        self.assertEqual(v.fill_keywords(candidates, values, "en-US", limit=25), "cook,meal,menu,dinner")

    def test_it_avoids_another_locale_of_the_same_storefront(self):
        other = {"name": "Tablely", "subtitle": "Meal cards", "keywords": "menu"}
        self.assertEqual(v.fill_keywords(["meal", "menu", "cook"], {"name": "Tablely", "subtitle": "Recipes"}, "en-AU", others=[other]), "cook")

    def test_cjk_substrings_and_bytes(self):
        values = {"name": "Tablely", "subtitle": "积分里程换商务舱"}
        self.assertEqual(v.fill_keywords(["商务舱", "机票", "兑换机票", "余票", "日历"], values, "zh-Hans"), "机票,余票,日历")
        self.assertEqual(v.fill_keywords(["兑换机票", "奖励机票", "余票"], values, "zh-Hans", limit=19, unit="bytes"), "兑换机票,余票")
        self.assertEqual(v.fill_keywords(["兑换机票", "奖励机票", "余票"], values, "zh-Hans", limit=18, unit="bytes"), "兑换机票")

    def test_a_filled_field_passes_the_checks(self):
        values = {"name": "Tablely", "subtitle": "Recipes in one grid"}
        words = "cook,bake,meal,dinner,lunch,breakfast,kitchen,pantry,menu,planner,ingredients,shopping,list,vegan,dessert,snack,brunch".split(",")
        keywords = v.fill_keywords(words, values, "en-US")
        report = check(keywords=keywords)
        self.assertEqual(report.errors + report.warnings, [], messages(report))


class TestCli(unittest.TestCase):
    def test_exit_codes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "en-US", BASE)
            self.assertEqual(run_cli("--dir", str(root), "--strict")[0], 0)
            (root / "en-US" / "keywords.txt").write_text("cook,bake\n", encoding="utf-8")
            self.assertEqual(run_cli("--dir", str(root))[0], 0)
            self.assertEqual(run_cli("--dir", str(root), "--strict")[0], 1)
            self.assertEqual(run_cli("--dir", str(root / "missing"))[0], 2)
            self.assertEqual(run_cli("--dir", str(root), "--locale", "fr-FR")[0], 2)

    def test_directories_that_are_not_locales_are_skipped(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "en-US", BASE)
            (root / "next").mkdir()
            code, out, _ = run_cli("--dir", str(root), "--strict")
            self.assertEqual(code, 0, out)
            self.assertIn("skipped next/", out)
            self.assertEqual(run_cli("--dir", str(root / "next"))[0], 2)

    def test_a_miscased_locale_directory_is_a_warning(self):
        # zh-hant/ and en-gb/ are not App Store Connect's codes; skipping them silently would leave them unchecked.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "en-US", BASE)
            write_locale(root, "zh-hant", {**BASE, "subtitle": "一表看清", "keywords": "獎勵", "promotional_text": "完整繁體中文 App 介面。"})
            write_locale(root, "en-gb", {**BASE, "keywords": "alerts,live,Qantas"})
            (root / "next").mkdir()
            code, out, _ = run_cli("--dir", str(root), "--strict")
            self.assertEqual(code, 1, out)
            self.assertIn("UNEXPECTED_DIRECTORY: en-gb/", out)
            self.assertIn("UNEXPECTED_DIRECTORY: zh-hant/", out)
            self.assertIn("skipped next/", out)
            self.assertNotIn("UNEXPECTED_DIRECTORY: next/", out)
            self.assertIn("1 locales: 0 errors, 2 warnings", out)
            self.assertEqual(run_cli("--dir", str(root))[0], 0)
            data = json.loads(run_cli("--dir", str(root), "--json")[1])
            self.assertEqual(sorted(i["storefront"] for i in data["cross_locale"] if i["level"] == "warning"), ["en-gb/", "zh-hant/"])

    def test_json(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_locale(root, "zh-Hans", {**BASE, "subtitle": "一张表", "keywords": "余票,日历"})
            code, out, _ = run_cli("--dir", str(root), "--json", "--strict")
            data = json.loads(out)
            self.assertEqual(code, 1)
            self.assertEqual(data["locales"][0]["locale"], "zh-Hans")
            self.assertIn("keywords_utf8_bytes", data["locales"][0]["lengths"])
            self.assertGreater(data["warnings"], 0)


def release_doc_section(heading: str, until: str) -> str:
    text = RELEASE_DOC.read_text(encoding="utf-8")
    start = text.index(heading)
    return text[start:text.index(until, start)]


def blockquote(section: str, label: str, until: str) -> str:
    """A description drafted as a wrapped Markdown blockquote, as the paste text: paragraphs apart, bullets on lines."""
    body = section[section.index(label) + len(label):section.index(until)] if until else section[section.index(label) + len(label):]
    paragraphs, current = [], []
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith(">"):
            continue
        content = line[1:].strip()
        if not content:
            if current:
                paragraphs.append(current)
            current = []
        elif content.startswith("• ") or not current:
            current.append(content)
        else:
            current[-1] += ("" if re.match(r"[㐀-鿿]", content) and re.search(r"[㐀-鿿，。]$", current[-1]) else " ") + content
    if current:
        paragraphs.append(current)
    return "\n\n".join("\n".join(p) for p in paragraphs)


class TestShippedMetadata(unittest.TestCase):
    """The committed files: the next/ drafts pass strictly, and en-US is version 1.0's fields with build 4's prose."""

    NEXT = v.DEFAULT_DIR
    V1 = v.METADATA_ROOT / "en-US"

    def test_next_passes_strict_from_the_command_line(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--strict"], capture_output=True, text=True, cwd=v.REPO_ROOT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"\n4 locales: 0 errors, 0 warnings, \d+ notes \(strict\)")

    def test_next_holds_the_four_locales_each_clean(self):
        dirs, _ = v.locale_dirs(self.NEXT)
        self.assertEqual([d.name for d in dirs], ["en-AU", "en-GB", "en-US", "zh-Hans"])
        for d in dirs:
            with self.subTest(locale=d.name):
                report = v.validate_locale(d)
                self.assertEqual(report.errors + report.warnings, [], messages(report))
                self.assertGreaterEqual(v.field_len(v.read_field(d, "keywords")), 95)
                self.assertEqual(v.read_field(d, "name"), "AwardGrid")
        self.assertEqual(v.check_cross_locale({d.name: v.read_locale(d) for d in dirs}), [])

    def test_next_en_us_changes_only_the_keywords_and_the_prose(self):
        nxt = self.NEXT / "en-US"
        for name in ("name", "subtitle", "support_url", "marketing_url", "privacy_url"):
            self.assertEqual(v.read_field(nxt, name), v.read_field(self.V1, name), name)
        self.assertEqual(
            v.read_field(nxt, "keywords"),
            "points,miles,flights,travel,reward,business,first,class,frequent,flyer,saver,redeem,search,calendar",
        )

    def test_version_1_0_reports_the_award_repetition(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--strict", "--dir", str(v.METADATA_ROOT)], capture_output=True, text=True, cwd=v.REPO_ROOT
        )
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("skipped next/", result.stdout)
        self.assertIn("'award' is repeated across keyword terms (award, award seats, award flights)", result.stdout)
        self.assertIn("'award' (in 'award seats') already appears in the name or subtitle", result.stdout)
        self.assertIn("'seats' (in 'award seats') already appears in the name or subtitle", result.stdout)
        report = v.validate_locale(self.V1)
        self.assertEqual({i.message.split(" ")[0] for i in report.errors}, {"'award'", "'seats'"})

    def test_en_us_is_build_4_on_version_1_0s_fields(self):
        # Since 2026-10-07 en-US/ holds the texts for version 1.0 as resubmitted with build 4 (the 3.1.1 remediation
        # plan's step 36): the name, subtitle, keywords and URLs are version 1.0's as recorded in the release doc, while
        # the promotional text and the description are new; build 3's stay recorded in §7.6.
        info = release_doc_section("### 7.1 App Information", "### 7.2")
        privacy = release_doc_section("### 7.3 App Privacy", "### 7.4")
        listing = release_doc_section("### 7.6 Listing drafts", "\n---")
        self.assertIn(f"**Name:** {v.read_field(self.V1, 'name')}\n", info)
        self.assertRegex(info, r"\*\*Subtitle\*\* \(optional, 24 of 30\): " + re.escape(v.read_field(self.V1, "subtitle")) + r"\n")
        self.assertIn(f"**Support URL:** `{v.read_field(self.V1, 'support_url')}`", info)
        self.assertIn(f"`{v.read_field(self.V1, 'marketing_url')}`", info)
        self.assertIn(f"**Privacy Policy URL:** `{v.read_field(self.V1, 'privacy_url')}`", privacy)
        self.assertIn(f"**Keywords** (97 of 100): `{v.read_field(self.V1, 'keywords')}`", listing)
        self.assertEqual(
            v.read_field(self.V1, "promotional_text"),
            "One table of award seats for the routes and dates you choose. Try every screen on built-in sample data, or connect your own seats.aero account to see its results.",
        )
        description = v.read_field(self.V1, "description")
        self.assertNotEqual(description, blockquote(listing, "- **Description:**", "- **Description, Chinese:**"))
        for needed in (
            "• Sample data: search any route between the 84 airports AwardGrid recognises",
            "Your own seats.aero data (optional): if you have a seats.aero account with API access (part of seats.aero Pro, which AwardGrid does not sell), you can connect it to see results from that account instead of sample data, with seats.aero's own sign-in. AwardGrid has no in-app purchases.",
            "Results from seats.aero are its cached data: confirm on the program's own site before you transfer points.",
            "AwardGrid never sees your seats.aero password, and the sign-in tokens stay in your iPhone's Keychain, with iCloud Keychain sync off.",
            "A small token service at awardgrid.dowhiz.com exchanges and refreshes the sign-in tokens for AwardGrid; it stores nothing and keeps no logs of tokens. AwardGrid for iPhone has no accounts, no analytics, no ads and no tracking.",
            "AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or any loyalty program.",
        ):
            self.assertIn(needed, description)
        # No Ask, no Anthropic, no purchase wording (the plan's decisions D3 and D6), and since the OAuth build (plan
        # step 47F.5) no pasted key: the App Store build connects only through seats.aero's own sign-in.
        self.assertIsNone(re.search(r"\bAsk\b|Anthropic|Claude|subscri|\bpaid\b|What it needs|searches nothing", description))
        self.assertIsNone(re.search(r"API key|API tab|past(?:e|ing)|no server of its own", description))
        self.assertFalse((self.V1 / "release_notes.txt").exists())

    def test_next_repeats_build_4s_prose(self):
        # next/ is superseded (apps/ios/store-metadata/README.md): its English descriptions and promotional texts repeat
        # en-US's build-4 texts, and zh-Hans says the same in Chinese, so no draft says what build 4 no longer does.
        for locale in ("en-US", "en-GB", "en-AU"):
            with self.subTest(locale=locale):
                for field in ("description", "promotional_text"):
                    self.assertEqual(v.read_field(self.NEXT / locale, field), v.read_field(self.V1, field), field)
        zh = v.read_field(self.NEXT / "zh-Hans", "description")
        en = v.read_field(self.V1, "description")
        self.assertEqual(zh.count("\n\n"), en.count("\n\n"))
        self.assertEqual(zh.count("• "), en.count("• "))
        for needed in (
            "你自己的 seats.aero 数据（可选）：如果你的 seats.aero 账户有 API 权限（属于 seats.aero Pro，AwardGrid 不出售），你可以连接这个账户，看到它的结果，而不是示例数据",
            "示例数据",
            "84 个机场",
            "AwardGrid iPhone 版没有账号、统计分析、广告或跟踪。",
            "AwardGrid 与 seats.aero、任何航空公司或任何里程计划均无关联，也未获其认可或赞助。",
            "连接时使用 seats.aero 自己的登录",
        ):
            self.assertIn(needed, zh)
        self.assertIsNone(re.search(r"API 密钥|API 页|粘贴", zh))
        for text in (zh, v.read_field(self.NEXT / "zh-Hans", "promotional_text")):
            self.assertIsNone(re.search(r"AI 辅助|Anthropic|Claude|订阅|无法查票|使用前提", text))

if __name__ == "__main__":
    unittest.main(verbosity=2)
