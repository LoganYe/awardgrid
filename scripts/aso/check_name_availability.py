#!/usr/bin/env python3
"""Screen App Store name candidates against published app names, with Apple's public iTunes Search API.

App Store Connect refuses a name that another app already uses, and App Review can reject a name too close to an
existing app's (Guideline 4.1). For each phrase of a candidate (the whole name, the part after the brand, and each
segment of that part) this asks Apple's public search in each storefront and reports, per published name found:

  EXACT      the published name is exactly the candidate or the phrase
  TOO_CLOSE  it has the same brand, the same descriptor (the part after the ":" or "-"), or nearly the same
             descriptor words (normalised: case, punctuation and a plural "s" ignored; CJK compared by character pairs)
  CONTAINS   the phrase appears inside it
  CLEAR      none of these, for every name found

How strong the signal is: the search API only approximates App Store search, and a name held by an app that is not
published yet is invisible to it. A clear result means "worth trying", never "will be accepted"; a hit is a reason
to prefer another candidate, not a veto.

Usage:
    python3 scripts/aso/check_name_availability.py "AwardGrid"
    python3 scripts/aso/check_name_availability.py --dir apps/ios/store-metadata/next
    python3 scripts/aso/check_name_availability.py --storefront us --storefront gb "Name One" "Name Two" --json out.json

Read-only: one GET per phrase and storefront to https://itunes.apple.com/search, cache-busted (Apple's CDN caches by
query string), at most one request every 2 seconds. Exit 0 when every lookup answered, 1 when one failed, 2 on a
usage error. Python standard library only.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "apps" / "ios" / "store-metadata" / "next"

SEARCH_URL = "https://itunes.apple.com/search"
STOREFRONTS = ("us", "gb", "ca", "au", "sg", "hk", "tw")
MIN_INTERVAL = 2.0
USER_AGENT = "awardgrid-aso-name-check/1.0 (+https://awardgrid.dowhiz.com/support/)"
BRAND = "AwardGrid"
OWN_APP_ID = 6816321841
NAME_LIMIT = 30

# Where a name's brand ends and its descriptor starts: "Brand: Descriptor", "Brand - Descriptor", "Brand | …".
DESCRIPTOR_SPLIT = re.compile(r"\s*[:：|｜]\s*|\s+[-–—]\s+")
SEGMENT_SPLIT = re.compile(r"[·・、,，/|]+")
# Segments too generic to screen on their own: a hit on them proves nothing.
TOO_GENERIC = {"app", "apps", "award", "awards", "flight", "flights", "search", "miles", "points", "travel", "里程", "机票", "機票", "查询", "查詢"}
CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]")

LEVELS = {"CLEAR": 0, "CONTAINS": 1, "TOO_CLOSE": 2, "EXACT": 3}
CLOSE_JACCARD = 0.75


# ---------------------------------------------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------------------------------------------


def normalise(text: str) -> str:
    """Compatibility-folded, case-folded, "&" as "and", punctuation as spaces, spaces collapsed."""
    text = unicodedata.normalize("NFKC", text).casefold().replace("&", " and ")
    text = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text)
    return " ".join(text.split())


def strip_brand(name: str, brand: str = BRAND) -> str:
    body = name.strip()
    if body.casefold().startswith(brand.casefold()):
        body = body[len(brand):]
    return body.strip(" -–—:：|｜·")


def descriptor(name: str) -> str:
    """The part after the first ":" / " - " / "|", or "" when the name has none."""
    parts = DESCRIPTOR_SPLIT.split(name.strip(), maxsplit=1)
    return parts[1].strip() if len(parts) == 2 else ""


def tokens(text: str) -> set:
    """Latin words (a plural "s" dropped) and CJK character pairs, of the normalised text."""
    out = set()
    for word in normalise(text).split():
        if CJK.search(word):
            chars = [ch for ch in word if CJK.match(ch)]
            out |= {a + b for a, b in zip(chars, chars[1:])} or set(chars)
            latin = "".join(ch for ch in word if not CJK.match(ch))
            if latin:
                out.add(latin)
        elif word not in {"a", "an", "and", "the", "for", "of", "by", "in", "on", "to", "with"}:
            out.add(word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word)
    return out


def phrases(name: str, brand: str = BRAND) -> list:
    """What to search for: the whole name, the part after the brand, and each segment of that part."""
    out = [name.strip()]
    body = strip_brand(name, brand)
    if body:
        out.append(body)
        out += [p.strip() for p in SEGMENT_SPLIT.split(body) if p.strip()]
    seen, unique = set(), []
    for p in out:
        key = normalise(p)
        if key and key not in seen and (p == name.strip() or (key not in TOO_GENERIC and len(p) > 1)):
            seen.add(key)
            unique.append(p)
    return unique


def closeness(candidate: str, phrase: str, published: str, brand: str = BRAND) -> tuple:
    """(level, why) for one published name against a candidate and the phrase it was found by."""
    pub = normalise(published)
    if pub in (normalise(candidate), normalise(phrase)):
        return "EXACT", "the same name"
    squashed = pub.replace(" ", "")
    if brand and normalise(brand).replace(" ", "") in squashed:
        return "TOO_CLOSE", f"it contains the brand {brand}"
    cand_desc = strip_brand(candidate, brand)
    pub_desc = descriptor(published) or published
    ct, pt = tokens(cand_desc), tokens(pub_desc)
    if ct and ct == pt:
        return "TOO_CLOSE", f"the same descriptor ({pub_desc})"
    common = ct & pt
    if len(ct) >= 2 and len(common) >= 2:
        jaccard = len(common) / len(ct | pt)
        if common == ct or common == pt or jaccard >= CLOSE_JACCARD:
            return "TOO_CLOSE", f"nearly the same descriptor words ({', '.join(sorted(common))})"
    if normalise(phrase) and normalise(phrase) in pub:
        return "CONTAINS", "the phrase is inside it"
    return "CLEAR", ""


# ---------------------------------------------------------------------------------------------------------------
# Apple's search
# ---------------------------------------------------------------------------------------------------------------


class Pacer:
    """At most one request per `interval` seconds, across every lookup of a run."""

    def __init__(self, interval: float = MIN_INTERVAL, clock=time.monotonic, sleep=time.sleep):
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self.last = None

    def wait(self) -> None:
        if self.last is not None:
            remaining = self.interval - (self.clock() - self.last)
            if remaining > 0:
                self.sleep(remaining)
        self.last = self.clock()


def search_url(term: str, country: str, limit: int, now=time.time) -> str:
    query = urllib.parse.urlencode(
        {"term": term, "country": country, "entity": "software", "limit": limit, "cb": int(now() * 1000)}
    )
    return f"{SEARCH_URL}?{query}"


def search(term: str, country: str, limit: int = 25, pacer=None, now=time.time) -> list:
    """Published apps for `term` in one storefront: [{"trackId", "trackName", "sellerName"}], this app left out."""
    if pacer is not None:
        pacer.wait()
    request = urllib.request.Request(search_url(term, country, limit, now), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = json.load(response)
    out = []
    for r in data.get("results", []):
        if r.get("trackId") == OWN_APP_ID or not r.get("trackName"):
            continue
        out.append({"trackId": r.get("trackId"), "trackName": r["trackName"], "sellerName": r.get("sellerName")})
    return out


def screen(candidate: str, storefronts=STOREFRONTS, limit: int = 25, pacer=None, now=time.time, brand: str = BRAND) -> dict:
    """Every phrase of `candidate` in every storefront, each published name classified."""
    report = {"name": candidate, "length": len(candidate), "over_limit": len(candidate) > NAME_LIMIT, "phrases": [], "worst": "CLEAR", "failed": 0}
    for phrase in phrases(candidate, brand):
        entry = {"phrase": phrase, "storefronts": {}}
        for country in storefronts:
            cell = {"status": "CLEAR", "hits": [], "results": [], "error": None}
            try:
                found = search(phrase, country, limit, pacer, now)
            except Exception as exc:  # the network is the only realistic failure here
                cell["status"] = "ERROR"
                cell["error"] = f"{type(exc).__name__}: {exc}"
                report["failed"] += 1
                entry["storefronts"][country] = cell
                continue
            cell["results"] = [r["trackName"] for r in found]
            for r in found:
                level, why = closeness(candidate, phrase, r["trackName"], brand)
                if level != "CLEAR":
                    cell["hits"].append({"level": level, "name": r["trackName"], "seller": r["sellerName"], "why": why})
            cell["hits"].sort(key=lambda h: -LEVELS[h["level"]])
            if cell["hits"]:
                cell["status"] = cell["hits"][0]["level"]
            if LEVELS[cell["status"]] > LEVELS[report["worst"]]:
                report["worst"] = cell["status"]
            entry["storefronts"][country] = cell
        report["phrases"].append(entry)
    return report


def render(report: dict) -> list:
    lines = [f"\n=== {report['name']}  ({report['length']}/{NAME_LIMIT}{', OVER THE LIMIT' if report['over_limit'] else ''})  worst: {report['worst']}"]
    for entry in report["phrases"]:
        lines.append(f"  phrase {entry['phrase']!r}")
        for country, cell in entry["storefronts"].items():
            if cell["error"]:
                lines.append(f"    {country}  ?  lookup failed ({cell['error']})")
                continue
            if not cell["hits"]:
                lines.append(f"    {country}  CLEAR  ({len(cell['results'])} apps found, none close)")
                continue
            lines.append(f"    {country}  {cell['status']}")
            for hit in cell["hits"][:4]:
                lines.append(f"        {hit['level']:<9} {hit['name']}  [{hit['why']}]")
    return lines


def names_in(directory: Path) -> list:
    out = []
    for d in sorted(p for p in directory.iterdir() if p.is_dir()):
        f = d / "name.txt"
        if f.exists():
            name = f.read_text(encoding="utf-8").strip()
            if name and name not in out:
                out.append(name)
    return out


def main(argv=None, pacer=None, now=time.time) -> int:
    parser = argparse.ArgumentParser(description="Screen App Store name candidates against published app names.")
    parser.add_argument("names", nargs="*", help="candidate names")
    parser.add_argument("--dir", type=Path, help="also screen every <locale>/name.txt under this directory")
    parser.add_argument("--storefront", action="append", choices=STOREFRONTS, help="limit to these storefronts (default: all seven)")
    parser.add_argument("--limit", type=int, default=25, help="results per search (1-200, default 25)")
    parser.add_argument("--pause", type=float, default=MIN_INTERVAL, help=f"seconds between requests (at least {MIN_INTERVAL:g})")
    parser.add_argument("--json", type=Path, help="also write the full report, every name found included, to this file")
    args = parser.parse_args(argv)

    if args.pause < MIN_INTERVAL:
        print(f"--pause must be at least {MIN_INTERVAL:g} seconds", file=sys.stderr)
        return 2
    if not 1 <= args.limit <= 200:
        print("--limit must be between 1 and 200", file=sys.stderr)
        return 2
    names = list(args.names)
    if args.dir:
        if not args.dir.is_dir():
            print(f"No directory at {args.dir}", file=sys.stderr)
            return 2
        names += [n for n in names_in(args.dir) if n not in names]
    if not names:
        parser.print_usage(sys.stderr)
        return 2

    pacer = pacer or Pacer(args.pause)
    storefronts = tuple(args.storefront or STOREFRONTS)
    started = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reports = [screen(name, storefronts, args.limit, pacer, now) for name in names]
    print(f"name check {started}: {len(names)} names x {len(storefronts)} storefronts ({', '.join(storefronts)}), via {SEARCH_URL}")
    for report in reports:
        for line in render(report):
            print(line)
    failed = sum(r["failed"] for r in reports)
    print(
        "\nA hit is a reason to prefer another candidate, not a veto; a clear result means worth trying, not accepted "
        "(the search API approximates App Store search and cannot see names held by apps not yet published)."
    )
    if failed:
        print(f"{failed} lookups failed.")
    if args.json:
        args.json.write_text(
            json.dumps(
                {"checked_at": started, "api": SEARCH_URL, "storefronts": list(storefronts), "limit": args.limit, "candidates": reports},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
