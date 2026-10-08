#!/usr/bin/env python3
"""Validate the App Store listing text under apps/ios/store-metadata/.

Apple indexes the union of the app name, the subtitle and the keyword field, and a storefront can index more than
one localization. A word spent twice is a wasted ranking slot and an unused keyword character a lost one. This
script checks both, the field limits, and the words the listing may not use: third-party names (seats.aero,
Claude, Anthropic, airlines, loyalty programs, other award-search apps) in the name, subtitle and keywords
(Guideline 2.3.7), the data provider's name (seats.aero) in any listing text, the promotional text, description and
release notes included, and features the app does not have (alerts, notifications and push, live, real-time or
instant results, booking).

Usage:
    python3 scripts/aso/validate_metadata.py                     # apps/ios/store-metadata/next
    python3 scripts/aso/validate_metadata.py --strict            # warnings fail too (CI)
    python3 scripts/aso/validate_metadata.py --dir apps/ios/store-metadata    # version 1.0 as submitted
    python3 scripts/aso/validate_metadata.py --locale zh-Hans --json

Each locale is a directory of one file per field (name.txt, subtitle.txt, keywords.txt, promotional_text.txt,
description.txt, release_notes.txt, support_url.txt, marketing_url.txt, privacy_url.txt). A CJK locale may add
keywords_fallback.txt: a keyword field of at most 100 UTF-8 bytes, for use if App Store Connect counts that field
in bytes rather than characters.

Exit 0 when clean, 1 on an error (with --strict, also on a warning), 2 on a usage error. Notes never fail.
Python standard library only (python3 as on macOS and on the CI runner).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
METADATA_ROOT = REPO_ROOT / "apps" / "ios" / "store-metadata"
DEFAULT_DIR = METADATA_ROOT / "next"
CORE_PROGRAMS = REPO_ROOT / "packages" / "core" / "src" / "lib" / "seatsaero" / "types.ts"

BRAND = "AwardGrid"
FIRST_PARTY_HOST = "awardgrid.dowhiz.com"

# Hard limits enforced by App Store Connect (characters).
LIMITS = {
    "name": 30,
    "subtitle": 30,
    "keywords": 100,
    "promotional_text": 170,
    "description": 4000,
    "release_notes": 4000,
}
TEXT_FIELDS = tuple(LIMITS)
URL_FIELDS = ("support_url", "marketing_url", "privacy_url")
FALLBACK_FIELD = "keywords_fallback"
KNOWN_FIELDS = TEXT_FIELDS + URL_FIELDS + (FALLBACK_FIELD,)
# App Store Connect will not save a localization without these.
REQUIRED = ("name", "subtitle", "keywords", "description", "support_url")
# Optional, or not needed until the version is known; a missing one is a note.
MISSING_NOTES = {
    "promotional_text": "promotional_text.txt is missing: a new version's promotional text starts empty",
    "release_notes": "release_notes.txt is missing: an update needs What's New, written once its changes are known",
    "marketing_url": "marketing_url.txt is missing (optional in App Store Connect)",
    "privacy_url": "privacy_url.txt is missing (the privacy policy URL is set once for the app)",
}

KEYWORD_UTILIZATION_FLOOR = 0.95
KEYWORD_BYTE_LIMIT = 100

# Terms that carry no search value, or that the listing already has everywhere.
DEAD_KEYWORDS = {
    "app", "apps", "free", "new", "best", "top", "ios", "iphone", "ipad", BRAND.casefold(),
    "应用", "應用", "软件", "軟體", "免费", "免費", "苹果", "蘋果",
}
# The primary category (Travel). Apple may index the category name, so a keyword naming it may add nothing; this is
# not documented by Apple, so it is a note, not a warning.
CATEGORY_TERMS = {"travel": "Travel", "旅游": "Travel", "旅遊": "Travel"}
# Words that are not search terms: never counted as repeats.
STOP_WORDS = {"a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "per", "the", "to", "with", "your"}

# A CJK locale is any Chinese, Japanese or Korean one (zh-Hans, zh-Hant, zh-Hant-HK, ja, ko …): its keywords are
# compared by substring and its keyword field is also reported in UTF-8 bytes.
CJK_LANGUAGES = frozenset({"ja", "ko", "zh"})
# Traditional Chinese localizations: zh-Hant and any regional zh-Hant-* one, and the region-only codes in case one is
# used. Each gets the interface-language checks below.
TRADITIONAL_CHINESE_REGIONS = frozenset({"zh-HK", "zh-TW", "zh-MO"})
CJK_RANGES = (
    (0x3040, 0x30FF),  # kana
    (0x3400, 0x4DBF),  # CJK ext A
    (0x4E00, 0x9FFF),  # CJK unified
    (0xAC00, 0xD7AF),  # hangul syllables
    (0xF900, 0xFAFF),  # CJK compatibility
)
# Separators inside the kana block that are punctuation, not content.
CJK_PUNCTUATION = frozenset("・·　、。〈〉《》「」『』【】〔〕〜～：；，．！？")
LOCALE_DIR = re.compile(r"^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$")
# Directories under a --dir that are not locales and are expected: next/ when --dir is apps/ios/store-metadata. Any
# other directory that is not a locale code (zh-hant/, en-gb/: a casing slip) is a warning, so --strict fails on it
# rather than skipping a localization unchecked.
EXPECTED_NON_LOCALE_DIRS = frozenset({"next"})

# Which localizations each storefront indexes, for the cross-locale check. A storefront with no localization of its
# own shows the primary one (en-US). Verify against Apple's localization table before submitting: Apple can change it.
STOREFRONT_LOCALES = {
    "us": ("en-US",),
    "gb": ("en-GB",),
    "au": ("en-AU", "en-GB"),
    "ca": ("en-CA",),
}
STOREFRONT_FALLBACK = {"ca": "en-US"}

# Features the app does not have. In the name, subtitle and keywords any use is an error (a keyword has no
# sentence to negate it in); in prose a use that a negation governs ("no alerts", "not a live search", "never
# books", 没有通知) passes.
# The third item says whether a person as the subject ("If you live in …", "you book the seat yourself") makes the
# word not about the app.
UNSUPPORTED_FEATURES = (
    (r"\breal[- ]?time\b", "real-time: results are seats.aero's cached availability", False),
    (r"\blive\b", "live: there is no live search", True),
    (r"\binstant(?:ly)?\b", "instant: results are seats.aero's cached availability", False),
    (r"\balert(?:s|ed|ing)?\b", "alert: there are no alerts", False),
    (r"\bnotif(?:y|ies|ied|ying|ication|ications)\b", "notify: there are no notifications", False),
    (r"\bpush\b", "push: there are no push notifications", False),
    (r"\bauto[- ]?book(?:s|ed|ing)?\b", "auto-book: the app never books", False),
    (r"\bbook(?:s|ed|ing)?\b", "book: the app never books (it opens seats.aero's booking link, or you copy the search)", True),
    (r"实时|實時|即时|即時", "实时 / 即時: results are cached", False),
    (r"提醒|通知|推送", "提醒 / 通知 / 推送: there are no alerts or notifications", False),
    (r"预订|預訂|订票|訂票|出票|代订|代訂", "预订 / 订票 / 出票: the app never books", False),
)
PERSON_BEFORE = re.compile(r"\b(?:you|we|they|who|people|users?|I)(?:\s+can)?\s+$", re.IGNORECASE)
# In prose, a booking word that names seats.aero's booking link is a fact, not a feature ("it opens seats.aero's
# booking link"). In the name, subtitle and keywords it is still an error.
PROSE_ALLOWED = re.compile(r"booking\s+links?\b|预订链接|預訂連結", re.IGNORECASE)

# The storefront copy must not promise an interface language the app does not ship. The app's interface is English
# or Simplified Chinese (growth/product-facts.json released.interface_languages), so a Traditional Chinese listing
# (zh-Hant, zh-Hant-HK …) says so in this sentence, word for word.
ZH_HANT_UI_DISCLOSURE = "App 介面為簡體中文與英文。"
ZH_HANT_UI_OVERCLAIM = r"(?:完整|全面|全)?繁體中文\s*(?:App\s*)?(?:介面|界面)"

# Third-party names that never go in the name, subtitle or keywords (Guideline 2.3.7). The program names in
# packages/core are read from its source (programs_from_core) so the two cannot drift; the brand words below are
# the same as PROGRAM_BRANDS in scripts/growth/validate-public-claims.mjs, which the tests compare.
TRADEMARK_BASE = (
    "seats.aero", "seats aero", "seatsaero", "Claude", "Anthropic",
    "point.me", "Roame", "AwardFares", "PointsYeah", "AwardTool", "MilesUp", "Flightpoints", "AwardWallet",
)
PROGRAM_BRANDS = {
    "eurobonus": ("SAS", "EuroBonus"),
    "virginatlantic": ("Virgin Atlantic", "Flying Club"),
    "aeromexico": ("Aeromexico", "Aeroméxico", "Club Premier"),
    "american": ("American Airlines", "AAdvantage"),
    "delta": ("Delta", "SkyMiles"),
    "etihad": ("Etihad", "Etihad Guest"),
    "united": ("United", "MileagePlus"),
    "emirates": ("Emirates", "Skywards"),
    "aeroplan": ("Air Canada", "Aeroplan"),
    "alaska": ("Alaska", "Mileage Plan"),
    "velocity": ("Virgin Australia", "Velocity Frequent Flyer", "Velocity"),
    "qantas": ("Qantas",),
    "connectmiles": ("Copa", "ConnectMiles"),
    "azul": ("Azul", "TudoAzul"),
    "smiles": ("GOL Smiles",),
    "flyingblue": ("Air France", "KLM", "Flying Blue"),
    "jetblue": ("JetBlue", "TrueBlue"),
    "qatar": ("Qatar", "Privilege Club"),
    "turkish": ("Turkish Airlines", "Miles&Smiles", "Miles & Smiles"),
    "singapore": ("Singapore Airlines", "KrisFlyer"),
    "ethiopian": ("Ethiopian Airlines", "ShebaMiles"),
    "saudia": ("Saudia", "AlFursan"),
    "finnair": ("Finnair",),
    "lufthansa": ("Lufthansa", "Miles & More", "Miles&More"),
    "frontier": ("Frontier Airlines",),
    "spirit": ("Spirit Airlines",),
}
# The same airlines and programs in Chinese (Simplified and Traditional), for the zh keyword fields. A short name
# (达美, 汉莎) also matches inside its full form (达美航空, 汉莎航空) by the rule in trademark_pattern; a full form
# the rule cannot reach (德国汉莎, 中国国航, 维珍大西洋) is listed.
PROGRAM_BRANDS_ZH = (
    "北欧航空", "北歐航空", "维珍航空", "維珍航空", "维珍大西洋", "維珍大西洋", "墨西哥航空", "墨西哥国际航空",
    "墨西哥國際航空", "美国航空", "美國航空", "美航", "达美", "達美", "达美航空", "達美航空", "阿提哈德", "联合航空",
    "聯合航空", "美联航", "美聯航", "前程万里", "前程萬里", "阿联酋航空", "阿聯酋航空", "加拿大航空", "加航",
    "阿拉斯加航空", "维珍澳洲", "維珍澳洲", "澳洲航空", "澳航", "巴拿马航空", "巴拿馬航空", "蓝色巴西", "藍色巴西",
    "法航", "法国航空", "法國航空", "荷航", "法航荷航", "法荷航", "荷兰皇家航空", "荷蘭皇家航空", "蓝天飞行", "藍天飛行",
    "捷蓝", "捷藍", "捷蓝航空", "捷藍航空", "卡塔尔航空", "卡達航空", "土耳其航空", "新加坡航空", "新航",
    "埃塞俄比亚航空", "衣索比亞航空", "埃航", "沙特航空", "沙烏地航空", "沙特阿拉伯航空", "沙烏地阿拉伯航空",
    "芬兰航空", "芬蘭航空", "芬航", "汉莎", "漢莎", "汉莎航空", "漢莎航空", "德国汉莎", "德國漢莎", "边疆航空",
    "邊疆航空", "精神航空",
)
# Other large carriers and programs a listing for this audience might reach for. Not exhaustive: a reviewer still
# reads the fields.
OTHER_AIRLINES = (
    "Cathay Pacific", "Asia Miles", "British Airways", "Avios", "Air China", "EVA Air", "China Airlines", "ANA", "JAL",
    "Korean Air", "Iberia", "Virgin",
    "国泰", "國泰", "国泰航空", "國泰航空", "亚洲万里通", "亞洲萬里通", "国航", "國航", "中国国航", "中國國航",
    "中国国际航空", "中國國際航空", "凤凰知音", "鳳凰知音", "东航", "東航", "东方航空", "東方航空", "东方万里行",
    "東方萬里行", "南航", "南方航空", "长荣", "長榮", "长荣航空", "長榮航空", "华航", "華航", "中华航空", "中華航空",
    "英航", "英国航空", "英國航空", "全日空", "日航", "日本航空", "大韩航空", "大韓航空",
)
# Store listing texts must not use the data provider's trademark: not in the name, subtitle or keywords (above), and
# not in the promotional text, description or release notes either. The listing says "the award-data provider"; the
# app itself names it, and shows its attribution. These match the way trademark_pattern matches any name (any case,
# with or without the dot or a space), and "Login with Seats" as SEATS_BRAND does.
PROVIDER_TRADEMARK = ("seats.aero", "seats aero", "seatsaero")
PROVIDER_SIGN_IN = re.compile(r"\bLogin\s+with\s+Seats\b", re.IGNORECASE)
# "Seats" is also seats.aero's short name, but "award seats" is the generic noun: only a brand-like use is flagged
# (a keyword term or a name segment that is just "Seats", "Seats Pro", "Seats app", "Login with Seats"), in any case:
# a keyword field is usually lower case.
SEATS_BRAND = re.compile(r"\bSeats(?=\s+(?:Pro|app|API|Partner)\b)|\bLogin\s+with\s+Seats\b", re.IGNORECASE)
# A two-character Chinese name (美航, 新航, 国航, 日航) is also two characters inside ordinary words (北美航线, 新航线,
# 中国航线, 每日航班), so it matches on its own, or right before a word that makes it the airline's (达美航空, 新航里程,
# 澳航积分, 国航会员).
ZH_BRAND_SUFFIX = r"航空|里程|哩程|里数|里數|积分|積分|会员|會員|常旅客"

SENTENCE_SPLIT = re.compile(r"[.!?\n。！？]")
# A line break and a list bullet end a clause too: App Store descriptions are often bullet lines with no full stop,
# and a negation on one line says nothing about the next.
CLAUSE_BREAK = re.compile(
    r"[;:!?\n。；！？：，,—•·▪◦]|\.(?=\s|$)|\s[–-]{1,2}\s|\b(?:but|and|so|because|while|although|though|then|plus|instead)\b|但是?|而且|并且|並且|所以|因此",
    re.IGNORECASE,
)
# A negator joined to the next word by a hyphen ("no-lag", "no-fee") makes a modifier, not a negation.
EN_NEGATOR = re.compile(
    r"\b(?:no|not|never|without|nor|neither|none|nothing|cannot|can't|isn't|aren't|doesn't|don't|won't|n't)\b(?!-\w)",
    re.IGNORECASE,
)
EN_DETERMINERS = {"no", "without", "nor", "neither", "none", "nothing"}
# A determiner governs the noun after it, not a predicate: in "Nothing beats live results" or "No ad is live", the
# verb starts a new claim. A determiner's reach therefore ends at one of these verbs.
EN_VERBS = frozenset(
    "is are was were be been am has have had does do did beats beat gives give shows show offers offer provides "
    "provide sends send gets get means mean makes make lets let needs need requires require compares compare matches "
    "match comes come goes go keeps keep brings bring delivers deliver finds find can could will would shall should "
    "may might must".split()
)
# Chinese negation words govern up to six characters after them (没有后台提醒, 也没有通知); a single-character negator
# only the next two (不抓取, 非实时), and never inside a word that is not a negation (非常, 不断, 未来, 无论 …).
# A 的 ends the reach: in 没有延迟的实时查询 the negation describes the noun after 的, it does not deny it (目的地 and
# 的确 are words, not the particle).
ZH_MODIFIER = re.compile(r"(?<!目)的(?![确確])")
ZH_NEGATOR = re.compile(r"没有|沒有|不是|不会|不會|不提供|不支持|不支援|无需|無需|并非|並非|从不|從不|从未|從未|绝不|絕不|尚未|毫无|毫無")
ZH_NEGATOR_CHAR = re.compile(r"[不没沒无無非未]")
ZH_NOT_NEGATION = re.compile(
    r"^(?:不断|不斷|不同|不仅|不僅|不但|不少|不错|不錯|不过|不過|不管|不久|不止|不停|不妨|不论|不論|非常|未来|未來|无论|無論|无限|無限|无比|無比|无缝|無縫|无忧|無憂)"
)


# ---------------------------------------------------------------------------------------------------------------
# Counting
# ---------------------------------------------------------------------------------------------------------------


def is_cjk_char(ch: str) -> bool:
    if ch in CJK_PUNCTUATION:
        return False
    cp = ord(ch)
    if 0x3000 <= cp <= 0x303F:  # CJK symbols and punctuation
        return False
    return any(lo <= cp <= hi for lo, hi in CJK_RANGES)


def is_cjk_locale(locale: str) -> bool:
    return locale.split("-")[0] in CJK_LANGUAGES


def is_traditional_chinese(locale: str) -> bool:
    return locale == "zh-Hant" or locale.startswith("zh-Hant-") or locale in TRADITIONAL_CHINESE_REGIONS


def utf16_len(text: str) -> int:
    """App Store Connect counts UTF-16 code units, so an astral character costs 2."""
    return sum(2 if ord(ch) > 0xFFFF else 1 for ch in text)


def field_len(text: str) -> int:
    """The stricter of code-point and UTF-16 length, so a count is never low. A CJK character counts as one."""
    return max(len(text), utf16_len(text))


def utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def split_keywords(raw: str) -> list[str]:
    return [t.strip() for t in raw.split(",") if t.strip()]


def cjk_runs(text: str) -> list[str]:
    """Contiguous CJK spans of two or more characters, so comparisons never straddle punctuation or Latin text."""
    runs, current = [], []
    for ch in text:
        if is_cjk_char(ch):
            current.append(ch)
        elif current:
            runs.append("".join(current))
            current = []
    if current:
        runs.append("".join(current))
    return [r for r in runs if len(r) >= 2]


def latin_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[A-Za-zÀ-ɏ]+", text.lower()) if len(w) > 1 and w not in STOP_WORDS}


# ---------------------------------------------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------------------------------------------


@dataclass
class Issue:
    level: str  # "error" | "warning" | "info"
    locale: str
    field: str
    message: str

    def render(self) -> str:
        mark = {"error": "ERROR  ", "warning": "warning", "info": "note   "}[self.level]
        return f"  {mark}  [{self.field}] {self.message}"


@dataclass
class LocaleReport:
    locale: str
    lengths: dict = field(default_factory=dict)
    issues: list = field(default_factory=list)

    def add(self, level: str, field_name: str, message: str) -> None:
        self.issues.append(Issue(level, self.locale, field_name, message))

    @property
    def errors(self) -> list:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list:
        return [i for i in self.issues if i.level == "warning"]

    @property
    def notes(self) -> list:
        """Informational only: never fails, not even under --strict."""
        return [i for i in self.issues if i.level == "info"]


def read_field(locale_dir: Path, name: str):
    path = locale_dir / f"{name}.txt"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8").strip("\n")


def read_locale(locale_dir: Path) -> dict:
    values = {}
    for name in KNOWN_FIELDS:
        raw = read_field(locale_dir, name)
        if raw is not None:
            values[name] = raw
    return values


# ---------------------------------------------------------------------------------------------------------------
# Third-party names
# ---------------------------------------------------------------------------------------------------------------


def programs_from_core(path: Path = CORE_PROGRAMS) -> tuple:
    """The seats.aero source codes and program names in packages/core (SEATS_SOURCES, SOURCE_NAMES)."""
    if not path.exists():
        return (tuple(PROGRAM_BRANDS), ())
    src = path.read_text(encoding="utf-8")
    listing = re.search(r"SEATS_SOURCES\s*=\s*\[([\s\S]*?)\]", src)
    names = re.search(r"SOURCE_NAMES[^=]*=\s*\{([\s\S]*?)\};", src)
    sources = tuple(re.findall(r'"([a-z]+)"', listing.group(1))) if listing else ()
    full = tuple(re.findall(r':\s*"([^"]+)"', names.group(1))) if names else ()
    return (sources, full)


def trademark_terms(core: Path = CORE_PROGRAMS) -> list:
    _, names = programs_from_core(core)
    out, seen = [], set()
    brands = [t for group in PROGRAM_BRANDS.values() for t in group]
    for term in (*TRADEMARK_BASE, *names, *brands, *PROGRAM_BRANDS_ZH, *OTHER_AIRLINES):
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            out.append(term)
    return out


TRADEMARKS = trademark_terms()


CJK_CLASS = "".join(f"\\u{lo:04x}-\\u{hi:04x}" for lo, hi in CJK_RANGES)


def latin_name_parts(term: str) -> list:
    """A Latin name's parts: its words, split again at a camel-case or dot boundary ("PointsYeah" -> Points, Yeah;
    "point.me" -> point, me), so a keyword that spaces or joins them still matches."""
    parts = []
    for word in term.split():
        parts.extend(p for p in re.split(r"(?<=[a-z])(?=[A-Z])|\.", word) if p)
    return parts


def trademark_pattern(term: str) -> re.Pattern:
    """Latin names match as whole words, any case, with or without a space or dot between their parts ("seats aero",
    "seatsaero", "points yeah", "pointme"). CJK names match as substrings, except a two-character one (美航, 新航),
    which must stand on its own or come right before 航空, 里程, 积分 and the like, so 新航线 (a new route) and 每日航班
    (daily flights) are not read as airlines."""
    if any(is_cjk_char(ch) for ch in term):
        escaped = r"\s*".join(re.escape(part) for part in term.split())
        if len(term) <= 2:
            return re.compile(rf"(?<![{CJK_CLASS}]){escaped}(?![{CJK_CLASS}])|{escaped}(?={ZH_BRAND_SUFFIX})")
        return re.compile(escaped)
    escaped = r"[\s.]*".join(re.escape(part) for part in latin_name_parts(term))
    return re.compile(rf"(?<![0-9A-Za-zÀ-ɏ]){escaped}(?![0-9A-Za-zÀ-ɏ])", re.IGNORECASE)


_TRADEMARK_PATTERNS = [(t, trademark_pattern(t)) for t in TRADEMARKS]


def trademark_hits(text: str, terms=None) -> list:
    """Third-party names in a name, subtitle or keyword field, in order of appearance."""
    patterns = _TRADEMARK_PATTERNS if terms is None else [(t, trademark_pattern(t)) for t in terms]
    hits = []
    for term, pattern in patterns:
        for m in pattern.finditer(text):
            hits.append((m.start(), term, m.group(0)))
    pieces = [p.strip() for p in re.split(r"[,:：|·\-–—]", text)]
    if any(p.casefold() == "seats" for p in pieces):
        hits.append((text.casefold().find("seats"), "Seats", "seats"))
    for m in SEATS_BRAND.finditer(text):
        hits.append((m.start(), "Seats", m.group(0)))
    return [(term, found) for _, term, found in sorted(hits)]


_PROVIDER_PATTERNS = [(t, trademark_pattern(t)) for t in PROVIDER_TRADEMARK]


def provider_hits(text: str) -> list:
    """The data provider's name in any listing text (prose included), in order of appearance."""
    hits = [(m.start(), term, m.group(0)) for term, pattern in _PROVIDER_PATTERNS for m in pattern.finditer(text)]
    hits += [(m.start(), "Login with Seats", m.group(0)) for m in PROVIDER_SIGN_IN.finditer(text)]
    seen, out = set(), []
    for start, term, found in sorted(hits):
        if start not in seen:
            seen.add(start)
            out.append((term, found))
    return out


# ---------------------------------------------------------------------------------------------------------------
# Unsupported features
# ---------------------------------------------------------------------------------------------------------------


def _clause_start(text: str, index: int) -> int:
    start = 0
    for m in CLAUSE_BREAK.finditer(text, 0, index):
        start = m.end()
    return start


def is_negated(text: str, start: int) -> bool:
    """True when a negation governs the match at `start`: a negator close before it in its own clause.

    English: "no" / "without" reach two words ("no push notifications") but not across a verb ("Nothing beats live
    results" is a claim), a negated verb four ("does not send you alerts"). Chinese: a negation within six characters
    (没有后台提醒, 也没有通知), up to a 的. A comma, "and", "but", a sentence end, a line break or a bullet closes a
    clause, so "no ads, and it alerts you" and "• No ads\\n• Alerts when seats open" are claims.
    """
    clause = text[_clause_start(text, start):start]
    last = None
    for m in EN_NEGATOR.finditer(clause):
        last = m
    if last is not None:
        gap = clause[last.end():]
        words = [w.lower() for w in re.findall(r"[A-Za-z0-9][\w'.-]*", gap)]
        determiner = last.group(0).lower() in EN_DETERMINERS
        reach = 2 if determiner else 4
        crosses_verb = determiner and any(w in EN_VERBS for w in words)
        if len(words) <= reach and not crosses_verb and not any(is_cjk_char(ch) for ch in gap):
            return True
    zh = None
    for m in ZH_NEGATOR.finditer(clause):
        zh = m
    if zh is not None:
        gap = clause[zh.end():]
        if sum(1 for ch in gap if is_cjk_char(ch)) <= 6 and not re.search(r"[A-Za-z]{3,}", gap) and not ZH_MODIFIER.search(gap):
            return True
    for m in ZH_NEGATOR_CHAR.finditer(clause):
        if ZH_NOT_NEGATION.match(clause[m.start():]):
            continue
        gap = clause[m.end():]
        if sum(1 for ch in gap if is_cjk_char(ch)) <= 2 and not re.search(r"[A-Za-z]{3,}", gap) and not ZH_MODIFIER.search(gap):
            return True
    return False


def unsupported_hits(text: str, allow_negated: bool) -> list:
    """Unsupported-feature words in `text`: (word, why) for each that is not negated (when that is allowed).

    `allow_negated` is True for prose (promotional text, description, release notes): there a negation may govern
    the word, and "booking link" names seats.aero's link. In the name, subtitle and keywords neither applies. A person
    as the subject ("If you live in …") makes the word not about the app in any field.
    """
    # Runs of spaces and tabs become one space; line breaks stay, because they end a clause (a bullet line).
    flat = re.sub(r"[^\S\n]+", " ", text)
    hits = []
    for pattern, why, person_ok in UNSUPPORTED_FEATURES:
        for m in re.finditer(pattern, flat, flags=re.IGNORECASE):
            if allow_negated and PROSE_ALLOWED.match(flat, m.start()):
                continue
            if person_ok and PERSON_BEFORE.search(flat[max(0, m.start() - 20):m.start()]):
                continue
            if allow_negated and is_negated(flat, m.start()):
                continue
            hits.append((m.group(0), why))
    return hits


# ---------------------------------------------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------------------------------------------


def check_lengths(report: LocaleReport, values: dict) -> None:
    for name, limit in LIMITS.items():
        raw = values.get(name)
        if raw is None:
            continue
        length = field_len(raw)
        report.lengths[name] = length
        if length > limit:
            report.add("error", name, f"{length} chars exceeds the {limit}-char limit by {length - limit}")


def check_control_chars(report: LocaleReport, values: dict) -> None:
    for name in ("name", "subtitle", "keywords", "promotional_text", FALLBACK_FIELD):
        raw = values.get(name)
        if not raw:
            continue
        if "\n" in raw:
            report.add("error", name, "contains a newline")
        for ch in raw:
            if unicodedata.category(ch) == "Cc" and ch != "\n":
                report.add("error", name, f"contains control character U+{ord(ch):04X}")
                break


def _keyword_format(report: LocaleReport, raw: str, field_name: str) -> list:
    illegal = sorted({ch for ch in raw if ch in ";/\\|，；、"})
    if illegal:
        rendered = " ".join(f"U+{ord(ch):04X} {ch!r}" for ch in illegal)
        report.add("error", field_name, f"ILLEGAL_KEYWORD_CHARACTER: use ASCII commas only; found {rendered}")
    if ", " in raw:
        report.add("error", field_name, 'contains ", " (a space after a comma burns a character for nothing)')
    if raw != raw.strip():
        report.add("error", field_name, "has leading or trailing whitespace")
    if raw.endswith(","):
        report.add("error", field_name, "has a trailing comma")
    if ",," in raw:
        report.add("error", field_name, "contains an empty term (',,')")
    terms = split_keywords(raw)
    seen = {}
    for term in terms:
        seen[term.casefold()] = seen.get(term.casefold(), 0) + 1
    for key, count in seen.items():
        if count > 1:
            report.add("error", field_name, f"term {key!r} is listed {count} times")
    for term in terms:
        if term.casefold() in DEAD_KEYWORDS:
            report.add("warning", field_name, f"{term!r} carries no search value, or the listing already has it")
        elif term.casefold() in CATEGORY_TERMS:
            report.add(
                "info", field_name,
                f"{term!r} names the app's primary category ({CATEGORY_TERMS[term.casefold()]}); if Apple indexes the "
                f"category name it adds nothing (not documented by Apple)",
            )
    return terms


def check_keyword_format(report: LocaleReport, raw: str) -> None:
    _keyword_format(report, raw, "keywords")
    if is_cjk_locale(report.locale):
        as_bytes = utf8_len(raw)
        report.lengths["keywords_utf8_bytes"] = as_bytes
        if as_bytes > KEYWORD_BYTE_LIMIT:
            report.add(
                "info", "keywords",
                f"{as_bytes} UTF-8 bytes. Apple documents this field as both 100 characters and 100 bytes; if App Store "
                f"Connect refuses the paste, it counts bytes: use keywords_fallback.txt (at most {KEYWORD_BYTE_LIMIT} bytes)",
            )
    used = field_len(raw)
    floor = LIMITS["keywords"] * KEYWORD_UTILIZATION_FLOOR
    if used < floor:
        report.add(
            "warning", "keywords",
            f"only {used}/{LIMITS['keywords']} chars used (below {KEYWORD_UTILIZATION_FLOOR:.0%}); "
            f"{LIMITS['keywords'] - used} ranking characters are thrown away",
        )


def _repeats(report: LocaleReport, values: dict, keywords: str, field_name: str) -> None:
    """A word in the name or subtitle is already indexed; a keyword that repeats it is waste."""
    name = values.get("name", "")
    subtitle = values.get("subtitle", "")
    terms = split_keywords(keywords)
    already = latin_words(f"{name} {subtitle}")
    for term in terms:
        for word in sorted(latin_words(term) & already):
            report.add(
                "error", field_name,
                f"{word!r} (in {term!r}) already appears in the name or subtitle; Apple indexes the union, so this "
                f"keyword slot is wasted",
            )
    # Apple indexes each word once, so a word repeated across keyword terms only costs characters.
    word_terms = {}
    for term in terms:
        for word in latin_words(term):
            word_terms.setdefault(word, []).append(term)
    for word, owners in sorted(word_terms.items()):
        if len(owners) > 1:
            report.add(
                "warning", field_name,
                f"{word!r} is repeated across keyword terms ({', '.join(owners)}); Apple indexes it once, so the extra "
                f"copies only cost characters",
            )
    if is_cjk_locale(report.locale):
        # CJK search matches substrings, so a term inside the name or subtitle adds nothing, and neither does a term
        # inside another term. Runs, not the concatenation, so no substring is invented across a separator.
        haystack = cjk_runs(name) + cjk_runs(subtitle)
        for term in terms:
            cjk_term = "".join(ch for ch in term if is_cjk_char(ch))
            if len(cjk_term) >= 2 and any(cjk_term in run for run in haystack):
                report.add(
                    "error", field_name,
                    f"{term!r} is already a substring of the name or subtitle; CJK search matches substrings, so this "
                    f"term adds nothing",
                )
        for a in terms:
            for b in terms:
                if a is not b and len(a) < len(b) and len(a) >= 2 and a in b:
                    report.add("warning", field_name, f"{a!r} is a substring of {b!r}: redundant under CJK substring matching")


def check_cross_field_duplication(report: LocaleReport, values: dict) -> None:
    name = values.get("name", "")
    subtitle = values.get("subtitle", "")
    for word in sorted(latin_words(name) & latin_words(subtitle)):
        report.add("error", "subtitle", f"{word!r} appears in both the name and the subtitle")
    if is_cjk_locale(report.locale):
        for run in cjk_runs(name):
            found = None
            for length in range(len(run), 1, -1):
                for offset in range(len(run) - length + 1):
                    if run[offset:offset + length] in subtitle:
                        found = run[offset:offset + length]
                        break
                if found:
                    break
            if found:
                report.add(
                    "error", "subtitle",
                    f"{found!r} appears in both the name and the subtitle; Apple indexes the union, so the repeat is wasted",
                )
    if values.get("keywords"):
        _repeats(report, values, values["keywords"], "keywords")


def check_fallback(report: LocaleReport, values: dict) -> None:
    """keywords_fallback.txt: the keyword field cut to at most 100 UTF-8 bytes, with the same rules otherwise."""
    raw = values.get(FALLBACK_FIELD)
    if raw is None:
        return
    _keyword_format(report, raw, FALLBACK_FIELD)
    size = utf8_len(raw)
    report.lengths["keywords_fallback_utf8_bytes"] = size
    if size > KEYWORD_BYTE_LIMIT:
        report.add("error", FALLBACK_FIELD, f"{size} UTF-8 bytes exceeds the {KEYWORD_BYTE_LIMIT}-byte fallback limit")
    _repeats(report, values, raw, FALLBACK_FIELD)


def check_trademarks(report: LocaleReport, values: dict) -> None:
    for name in ("name", "subtitle", "keywords", FALLBACK_FIELD):
        raw = values.get(name)
        if not raw:
            continue
        for term, found in trademark_hits(raw):
            report.add(
                "error", name,
                f"TRADEMARK: {found!r} ({term}) does not go in the App Store name, subtitle or keywords (Guideline 2.3.7)",
            )
    # Store listing texts must not use the data provider's trademark: the prose fields may name what the app works
    # with in general terms ("the award-data provider"), never the provider itself.
    for name in ("promotional_text", "description", "release_notes"):
        raw = values.get(name)
        if not raw:
            continue
        for term, found in provider_hits(raw):
            report.add(
                "error", name,
                f"TRADEMARK: {found!r} ({term}): store listing texts must not use the data provider's trademark",
            )


def check_unsupported_features(report: LocaleReport, values: dict) -> None:
    for name in TEXT_FIELDS + (FALLBACK_FIELD,):
        raw = values.get(name)
        if not raw:
            continue
        # A name, subtitle or keyword has no sentence around it, so nothing there can negate a feature word.
        prose = name in ("promotional_text", "description", "release_notes")
        for word, why in unsupported_hits(raw, allow_negated=prose):
            report.add("error", name, f"UNSUPPORTED_FEATURE: {word!r} ({why})")


def check_ui_language_disclosure(report: LocaleReport, values: dict) -> None:
    if not is_traditional_chinese(report.locale):
        return
    required = ZH_HANT_UI_DISCLOSURE
    searchable = "\n".join(values.get(n, "") for n in ("promotional_text", "description", "release_notes"))
    for m in re.finditer(ZH_HANT_UI_OVERCLAIM, searchable):
        start = 0
        for stop in SENTENCE_SPLIT.finditer(searchable, 0, m.start()):
            start = stop.end()
        # "尚未提供繁體中文介面" (not yet) states a limit, not a feature.
        if not re.search(r"尚未|不提供|沒有|没有|不是", searchable[start:m.start()]):
            report.add("error", "description", "UNSUPPORTED_UI_LANGUAGE: the listing must not promise an interface language the app does not ship")
            break
    if required not in values.get("description", ""):
        report.add("error", "description", f"UI_LANGUAGE_DISCLOSURE: the description must say {required!r}")


def is_first_party_url(raw: str) -> bool:
    try:
        url = urlsplit(raw)
        return bool(
            re.fullmatch(r"https://\S+", raw)
            and url.scheme == "https" and url.hostname == FIRST_PARTY_HOST and url.netloc == FIRST_PARTY_HOST
            and url.path.startswith("/") and not url.query and not url.fragment
        )
    except ValueError:
        return False


def check_urls(report: LocaleReport, values: dict) -> None:
    for name in URL_FIELDS:
        raw = values.get(name)
        if raw is None:
            continue
        if not is_first_party_url(raw):
            report.add(
                "error", name,
                f"FIRST_PARTY_URL: expected a plain https URL on {FIRST_PARTY_HOST}, with no credentials, port, query or fragment",
            )


def validate_values(locale: str, values: dict, present: tuple = ()) -> LocaleReport:
    """Every per-locale check on one locale's field values. `present` names the files that exist."""
    report = LocaleReport(locale=locale)
    for name in REQUIRED:
        if name not in values:
            report.add("error", name, f"{name}.txt is missing")
        elif not values[name].strip():
            report.add("error", name, f"{name}.txt is empty")
    for name, note in MISSING_NOTES.items():
        if name not in values:
            report.add("info", name, note)
    for extra in present:
        if extra not in KNOWN_FIELDS:
            report.add("warning", extra, f"{extra}.txt is not an App Store Connect field")
    if FALLBACK_FIELD in values and not is_cjk_locale(locale):
        report.add("warning", FALLBACK_FIELD, "a byte-limited keyword fallback is only needed for a CJK locale")
    check_lengths(report, values)
    check_control_chars(report, values)
    if values.get("keywords"):
        check_keyword_format(report, values["keywords"])
    check_cross_field_duplication(report, values)
    check_fallback(report, values)
    check_trademarks(report, values)
    check_unsupported_features(report, values)
    check_ui_language_disclosure(report, values)
    check_urls(report, values)
    return report


def validate_locale(locale_dir: Path) -> LocaleReport:
    present = tuple(sorted(p.stem for p in locale_dir.glob("*.txt")))
    return validate_values(locale_dir.name, read_locale(locale_dir), present)


# ---------------------------------------------------------------------------------------------------------------
# Across locales
# ---------------------------------------------------------------------------------------------------------------


def storefront_locales(present) -> dict:
    """For each storefront, the present locales it indexes (its fallback when it has none of its own)."""
    out = {}
    for storefront, locales in STOREFRONT_LOCALES.items():
        indexed = tuple(l for l in locales if l in present)
        if not indexed and STOREFRONT_FALLBACK.get(storefront) in present:
            indexed = (STOREFRONT_FALLBACK[storefront],)
        if indexed:
            out[storefront] = indexed
    return out


def indexed_words(values: dict) -> dict:
    """The words a locale gets indexed for, each with the fields it is in. The brand is in every locale's name."""
    out = {}
    for name in ("name", "subtitle", "keywords"):
        raw = values.get(name, "")
        words = latin_words(raw) - {BRAND.casefold()}
        if name == "keywords":
            words |= {t for t in split_keywords(raw) if any(is_cjk_char(ch) for ch in t)}
        for word in words:
            out.setdefault(word, []).append(name)
    return out


def check_cross_locale(all_values: dict) -> list:
    """A word indexed by two localizations that one storefront indexes together is spent twice there."""
    issues = []
    for storefront, locales in storefront_locales(set(all_values)).items():
        if len(locales) < 2:
            continue
        label = f"{storefront.upper()} storefront ({' + '.join(locales)})"
        words = {l: indexed_words(all_values[l]) for l in locales}
        for i, a in enumerate(locales):
            for b in locales[i + 1:]:
                # A word both names hold is the brand (the storefront shows one name), not a repeat to remove.
                shared_name = latin_words(all_values[a].get("name", "")) & latin_words(all_values[b].get("name", ""))
                for word in sorted((set(words[a]) & set(words[b])) - shared_name):
                    issues.append(Issue(
                        "error", label, "keywords",
                        f"CROSS_LOCALE_DUPLICATE: {word!r} is in {a} ({', '.join(words[a][word])}) and {b} "
                        f"({', '.join(words[b][word])}); the storefront indexes both, so one of them is wasted",
                    ))
    return issues


# ---------------------------------------------------------------------------------------------------------------
# Filling a keyword field
# ---------------------------------------------------------------------------------------------------------------


def fill_keywords(candidates, values: dict, locale: str, others=(), limit: int = 100, unit: str = "chars") -> str:
    """The keyword field from `candidates`, in order, skipping any term the checks above would refuse.

    A term is skipped when it repeats a word of the name, the subtitle, a term already chosen or another locale in
    `others` (field values of locales the same storefront indexes); for a CJK locale when it is a substring of the
    name, the subtitle or a chosen term, or a chosen term is a substring of it; when it is a dead word, a third-party
    name or an unsupported feature; or when it does not fit in `limit` (characters, or UTF-8 bytes with
    unit="bytes"). Later, shorter terms can still fill the gap a long one leaves.
    """
    measure = utf8_len if unit == "bytes" else field_len
    taken = latin_words(f"{values.get('name', '')} {values.get('subtitle', '')}")
    for other in others:
        taken |= set(indexed_words(other))
    runs = cjk_runs(values.get("name", "")) + cjk_runs(values.get("subtitle", ""))
    chosen = []
    for term in candidates:
        term = term.strip()
        if not term or term.casefold() in {c.casefold() for c in chosen} or term.casefold() in DEAD_KEYWORDS:
            continue
        if latin_words(term) & taken or trademark_hits(term) or unsupported_hits(term, allow_negated=False):
            continue
        cjk = "".join(ch for ch in term if is_cjk_char(ch))
        if is_cjk_locale(locale) and cjk:
            if term in taken or any(cjk in run for run in runs) or any(term in c or c in term for c in chosen):
                continue
        if measure(",".join(chosen + [term])) > limit:
            continue
        chosen.append(term)
        taken |= latin_words(term)
    return ",".join(chosen)


# ---------------------------------------------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------------------------------------------


def locale_dirs(root: Path):
    """(locale directories, skipped directory names): a directory whose name is not a locale code is skipped, and so
    is a hidden one."""
    dirs, skipped = [], []
    for d in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")):
        if LOCALE_DIR.match(d.name):
            dirs.append(d)
        else:
            skipped.append(d.name)
    return dirs, skipped


def unexpected_dirs(skipped) -> list:
    """A skipped directory other than next/ (zh-hant/, en-gb/) would hold a localization nothing checks: a warning."""
    return [
        Issue(
            "warning", f"{name}/", "directory",
            f"UNEXPECTED_DIRECTORY: {name}/ is not a locale code (such as en-GB or zh-Hant, cased as App Store Connect "
            f"names them), so nothing in it was checked",
        )
        for name in skipped
        if name not in EXPECTED_NON_LOCALE_DIRS
    ]


def run(root: Path, locales=None):
    """(reports, issues across locales and directories, notes) for the locale directories under `root`."""
    dirs, skipped = locale_dirs(root)
    notes = [f"skipped {name}/ (not a locale directory)" for name in skipped if name in EXPECTED_NON_LOCALE_DIRS]
    all_values = {d.name: read_locale(d) for d in dirs}
    chosen = [d for d in dirs if not locales or d.name in locales]
    reports = [validate_locale(d) for d in chosen]
    cross = check_cross_locale(all_values)
    if locales:
        cross = [i for i in cross if any(l in i.locale for l in locales)]
    cross = unexpected_dirs(skipped) + cross
    fronts = storefront_locales(set(all_values))
    if fronts:
        notes.append(
            "storefronts: "
            + ", ".join(
                f"{sf}={'+'.join(ls)}{' (fallback)' if sf in STOREFRONT_FALLBACK and ls == (STOREFRONT_FALLBACK[sf],) else ''}"
                for sf, ls in fronts.items()
            )
            + " (verify against Apple's localization table before submitting)"
        )
    return reports, cross, notes


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Validate the App Store listing text.")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="locale directories (default: apps/ios/store-metadata/next)")
    parser.add_argument("--locale", action="append", help="validate only this locale (repeatable)")
    parser.add_argument("--json", action="store_true", help="print a machine-readable report")
    parser.add_argument("--strict", action="store_true", help="warnings fail too (notes never do)")
    args = parser.parse_args(argv)

    root = args.dir if args.dir.is_absolute() else (Path.cwd() / args.dir)
    root = root.resolve()
    if not root.is_dir():
        print(f"No metadata directory at {root}", file=sys.stderr)
        return 2
    dirs, _ = locale_dirs(root)
    if not dirs:
        print(f"No locale directory under {root}", file=sys.stderr)
        return 2
    if args.locale:
        missing = set(args.locale) - {d.name for d in dirs}
        for name in sorted(missing):
            print(f"Unknown locale: {name}", file=sys.stderr)
        if missing:
            return 2

    reports, cross, notes = run(root, args.locale)
    errors = sum(len(r.errors) for r in reports) + sum(1 for i in cross if i.level == "error")
    warnings = sum(len(r.warnings) for r in reports) + sum(1 for i in cross if i.level == "warning")
    infos = sum(len(r.notes) for r in reports)

    if args.json:
        print(json.dumps({
            "root": str(root),
            "strict": args.strict,
            "notes": notes,
            "cross_locale": [{"level": i.level, "storefront": i.locale, "message": i.message} for i in cross],
            "locales": [
                {
                    "locale": r.locale,
                    "lengths": r.lengths,
                    "issues": [{"level": i.level, "field": i.field, "message": i.message} for i in r.issues],
                }
                for r in reports
            ],
            "errors": errors,
            "warnings": warnings,
        }, ensure_ascii=False, indent=2))
    else:
        print(f"store metadata: {root}")
        for note in notes:
            print(f"note: {note}")
        for report in reports:
            as_bytes = report.lengths.get("keywords_utf8_bytes")
            byte_note = f" ({as_bytes}B utf-8)" if as_bytes else ""
            fallback = report.lengths.get("keywords_fallback_utf8_bytes")
            fallback_note = f"  fallback={fallback}/{KEYWORD_BYTE_LIMIT}B" if fallback is not None else ""
            headline = (
                f"name={report.lengths.get('name', 0)}/30  subtitle={report.lengths.get('subtitle', 0)}/30  "
                f"keywords={report.lengths.get('keywords', 0)}/100{byte_note}{fallback_note}  "
                f"promo={report.lengths.get('promotional_text', 0)}/170  desc={report.lengths.get('description', 0)}/4000"
            )
            status = "FAIL" if report.errors else ("warn" if report.warnings else "ok")
            print(f"\n{report.locale}  [{status}]\n  {headline}")
            for issue in report.issues:
                print(issue.render())
        if cross:
            print("\nacross locales and directories")
            for issue in cross:
                mark = {"error": "ERROR  ", "warning": "warning", "info": "note   "}[issue.level]
                print(f"  {mark}  [{issue.locale}] {issue.message}")
        print(f"\n{len(reports)} locales: {errors} errors, {warnings} warnings, {infos} notes{' (strict)' if args.strict else ''}")

    failed = errors > 0 or (args.strict and warnings > 0)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
