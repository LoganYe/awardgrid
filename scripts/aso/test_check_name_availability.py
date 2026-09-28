#!/usr/bin/env python3
"""Tests for scripts/aso/check_name_availability.py. The network is mocked: no test reaches Apple.

Run:
    python3 -m unittest discover -s scripts/aso -p 'test_*.py' -v
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

_SPEC = importlib.util.spec_from_file_location("check_name_availability", Path(__file__).with_name("check_name_availability.py"))
c = importlib.util.module_from_spec(_SPEC)
sys.modules["check_name_availability"] = c
_SPEC.loader.exec_module(c)

BRAND = "Tablely"


def response(*names, own=False):
    results = [{"trackId": 1000 + i, "trackName": n, "sellerName": f"Seller {i}"} for i, n in enumerate(names)]
    if own:
        results.append({"trackId": c.OWN_APP_ID, "trackName": "AwardGrid", "sellerName": "Curastone CORP."})
    return io.BytesIO(json.dumps({"resultCount": len(results), "results": results}).encode("utf-8"))


class FakeApple:
    """Stands in for urllib.request.urlopen: answers by search term and records every request."""

    def __init__(self, answers=None, fail=()):
        self.answers = answers or {}
        self.fail = set(fail)
        self.requests = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        self.requests.append({"url": url, "query": query, "headers": dict(request.header_items()), "timeout": timeout})
        if (query["term"], query["country"]) in self.fail or query["term"] in self.fail:
            raise OSError("network unreachable")
        return response(*self.answers.get(query["term"], ()))


class FakeTime:
    def __init__(self):
        self.t = 1000.0
        self.slept = []

    def clock(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds

    def now(self):
        self.t += 0.001
        return self.t


def pacer_and_time():
    t = FakeTime()
    return c.Pacer(c.MIN_INTERVAL, clock=t.clock, sleep=t.sleep), t


class NetworkTouched(BaseException):
    """Raised by the tripwire. A BaseException, so the name check's own `except Exception` (a failed lookup) cannot
    swallow it."""


class NoNetwork(unittest.TestCase):
    """Every test starts with urlopen replaced by a tripwire that fails the test: nothing here may reach the network.

    A test that forgets self.fake() fails either way: the tripwire raises NetworkTouched, which screen() and main()
    do not catch, and a cleanup checks that the tripwire was never called.
    """

    def setUp(self):
        self.network_calls = []

        def refuse(request, *_args, **_kwargs):
            self.network_calls.append(getattr(request, "full_url", request))
            raise NetworkTouched("a test tried to reach the network")

        patcher = mock.patch("urllib.request.urlopen", refuse)
        patcher.start()
        # Cleanups run last-in first-out, so this check runs after every patch has been undone.
        self.addCleanup(lambda: self.assertEqual(self.network_calls, [], "a test tried to reach the network"))
        self.addCleanup(patcher.stop)

    def fake(self, answers=None, fail=()):
        apple = FakeApple(answers, fail)
        patcher = mock.patch("urllib.request.urlopen", apple)
        patcher.start()
        self.addCleanup(patcher.stop)
        return apple


class TestTheTripwire(unittest.TestCase):
    def test_a_test_that_forgets_the_fake_fails(self):
        class Forgetful(NoNetwork):
            def test_screen(self):
                pacer, t = pacer_and_time()
                c.screen("Tablely", ("us",), pacer=pacer, now=t.now, brand=BRAND)

            def test_main(self):
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    c.main(["--storefront", "us", "AwardGrid"], pacer=pacer_and_time()[0], now=FakeTime().now)

            def test_search(self):
                c.search("Tablely", "us", now=FakeTime().now)

            def test_with_the_fake(self):
                self.fake({"Tablely": ["Other"]})
                c.search("Tablely", "us", now=FakeTime().now)

        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(Forgetful).run(result)
        self.assertEqual(result.testsRun, 4)
        failed = sorted({test.id().rsplit(".", 1)[-1] for test, _ in result.errors + result.failures})
        self.assertEqual(failed, ["test_main", "test_screen", "test_search"], result.errors + result.failures)
        self.assertTrue(all("a test tried to reach the network" in trace for _, trace in result.errors + result.failures))


class TestNames(unittest.TestCase):
    def test_phrases(self):
        self.assertEqual(c.phrases("Tablely: Recipe Box Planner", BRAND), ["Tablely: Recipe Box Planner", "Recipe Box Planner"])
        self.assertEqual(c.phrases("Tablely", BRAND), ["Tablely"])
        self.assertEqual(c.phrases("Tablely: Menus · Recipe Box", BRAND), ["Tablely: Menus · Recipe Box", "Menus · Recipe Box", "Menus", "Recipe Box"])
        self.assertEqual(c.phrases("Tablely 菜谱查询", BRAND), ["Tablely 菜谱查询", "菜谱查询"])
        # A generic segment on its own proves nothing.
        self.assertEqual(c.phrases("Tablely: Search · Recipe Box", BRAND), ["Tablely: Search · Recipe Box", "Search · Recipe Box", "Recipe Box"])

    def test_descriptor_and_normalising(self):
        self.assertEqual(c.descriptor("Cookly: Recipe Box Planner"), "Recipe Box Planner")
        self.assertEqual(c.descriptor("Cookly - Recipe Box"), "Recipe Box")
        self.assertEqual(c.descriptor("Recipe-Box Planner"), "")
        self.assertEqual(c.normalise("Recipes & Meals!"), "recipes and meals")
        self.assertEqual(c.tokens("Recipes Box Planners"), {"recipe", "box", "planner"})
        self.assertEqual(c.tokens("菜谱查询"), {"菜谱", "谱查", "查询"})


class TestCloseness(unittest.TestCase):
    CANDIDATE = "Tablely: Recipe Box Planner"
    PHRASE = "Recipe Box Planner"

    def level(self, published, phrase=None, candidate=None):
        return c.closeness(candidate or self.CANDIDATE, phrase or self.PHRASE, published, BRAND)

    def test_exact(self):
        self.assertEqual(self.level("Recipe Box Planner")[0], "EXACT")
        self.assertEqual(self.level("tablely: recipe box planner")[0], "EXACT")

    def test_the_same_descriptor_is_too_close(self):
        # Guideline 4.1: another app's name with the same descriptor phrase after a different brand.
        level, why = self.level("Cookly: Recipe Box Planner")
        self.assertEqual(level, "TOO_CLOSE")
        self.assertIn("the same descriptor", why)
        self.assertEqual(self.level("Cookly - Recipes Box Planner")[0], "TOO_CLOSE")

    def test_nearly_the_same_words_are_too_close(self):
        self.assertEqual(self.level("Box Planner")[0], "TOO_CLOSE")
        self.assertEqual(self.level("The Recipe Box Planner Pro Max")[0], "TOO_CLOSE")
        self.assertEqual(self.level("Pantry: Recipe Box and Planner")[0], "TOO_CLOSE")

    def test_the_brand_is_too_close(self):
        self.assertEqual(self.level("Tabletop Kitchen")[0], "CLEAR")
        self.assertEqual(self.level("Table-ly Kitchen")[0], "TOO_CLOSE")
        self.assertEqual(self.level("Tablely Kitchen")[0], "TOO_CLOSE")
        self.assertEqual(c.closeness("Tablely", "Tablely", "Tablely", BRAND)[0], "EXACT")

    def test_contains_and_clear(self):
        self.assertEqual(self.level("Menus of the World", phrase="Menus", candidate="Tablely: Menus · Recipe Box")[0], "CONTAINS")
        self.assertEqual(self.level("Grocery Box Tracker")[0], "CLEAR")
        self.assertEqual(self.level("Recipe Planner Pro")[0], "CLEAR")

    def test_cjk_by_character_pairs(self):
        self.assertEqual(c.closeness("Tablely 菜谱查询", "菜谱查询", "菜谱查询大全", BRAND)[0], "TOO_CLOSE")
        self.assertEqual(c.closeness("Tablely 菜谱查询", "菜谱查询", "菜谱大全", BRAND)[0], "CLEAR")
        self.assertEqual(c.closeness("Tablely 菜谱查询", "菜谱查询", "菜谱查询", BRAND)[0], "EXACT")


class TestSearch(NoNetwork):
    def test_the_request_is_a_cache_busted_read_of_apples_public_search(self):
        apple = self.fake({"Recipe Box": ["Cookly: Recipe Box"]})
        t = FakeTime()
        first = c.search("Recipe Box", "gb", 25, now=t.now)
        c.search("Recipe Box", "gb", 25, now=t.now)
        self.assertEqual(first, [{"trackId": 1000, "trackName": "Cookly: Recipe Box", "sellerName": "Seller 0"}])
        req = apple.requests[0]
        split = urllib.parse.urlsplit(req["url"])
        self.assertEqual((split.scheme, split.netloc, split.path), ("https", "itunes.apple.com", "/search"))
        self.assertEqual({k: req["query"][k] for k in ("term", "country", "entity", "limit")}, {"term": "Recipe Box", "country": "gb", "entity": "software", "limit": "25"})
        self.assertNotEqual(apple.requests[0]["query"]["cb"], apple.requests[1]["query"]["cb"])
        self.assertIn("awardgrid-aso-name-check", req["headers"]["User-agent"])
        self.assertEqual(req["timeout"], 25)

    def test_this_app_is_left_out(self):
        with mock.patch("urllib.request.urlopen", lambda request, timeout=None: response("AwardGrid Pro", own=True)):
            found = c.search("AwardGrid", "us")
        self.assertEqual([r["trackName"] for r in found], ["AwardGrid Pro"])

    def test_the_pacer_keeps_two_seconds_between_requests(self):
        pacer, t = pacer_and_time()
        pacer.wait()
        t.t += 0.5
        pacer.wait()
        pacer.wait()
        self.assertEqual(t.slept, [1.5, 2.0])
        self.assertTrue(all(s >= 0 for s in t.slept))

    def test_screen_classifies_every_phrase_in_every_storefront(self):
        apple = self.fake({
            "Tablely: Recipe Box Planner": ["Tablely: Recipe Box Planner Lite"],
            "Recipe Box Planner": ["Cookly: Recipe Box Planner", "Grocery List"],
        })
        pacer, t = pacer_and_time()
        report = c.screen("Tablely: Recipe Box Planner", ("us", "tw"), pacer=pacer, now=t.now, brand=BRAND)
        self.assertEqual(len(apple.requests), 4)
        self.assertEqual(len(t.slept), 3)
        # Each request is at least two seconds after the one before (the fake clock also moves a millisecond per cache-buster).
        self.assertTrue(all(s > c.MIN_INTERVAL - 0.01 for s in t.slept), t.slept)
        self.assertEqual(report["worst"], "TOO_CLOSE")
        cell = report["phrases"][1]["storefronts"]["tw"]
        self.assertEqual(cell["status"], "TOO_CLOSE")
        self.assertEqual([h["name"] for h in cell["hits"]], ["Cookly: Recipe Box Planner"])
        self.assertEqual(cell["results"], ["Cookly: Recipe Box Planner", "Grocery List"])

    def test_a_failed_lookup_is_recorded(self):
        self.fake({}, fail={("Tablely", "hk")})
        pacer, t = pacer_and_time()
        report = c.screen("Tablely", ("us", "hk"), pacer=pacer, now=t.now, brand=BRAND)
        self.assertEqual(report["failed"], 1)
        self.assertEqual(report["phrases"][0]["storefronts"]["hk"]["status"], "ERROR")
        self.assertEqual(report["phrases"][0]["storefronts"]["us"]["status"], "CLEAR")


class TestCli(NoNetwork):
    def run_main(self, *args, pacer=None):
        out, err = io.StringIO(), io.StringIO()
        if pacer is None:
            pacer, _ = pacer_and_time()
        with redirect_stdout(out), redirect_stderr(err):
            code = c.main(list(args), pacer=pacer, now=FakeTime().now)
        return code, out.getvalue(), err.getvalue()

    def test_usage_errors(self):
        self.assertEqual(self.run_main("--pause", "1", "AwardGrid")[0], 2)
        self.assertEqual(self.run_main("--limit", "0", "AwardGrid")[0], 2)
        self.assertEqual(self.run_main()[0], 2)
        self.assertEqual(self.run_main("--dir", "/nonexistent/dir")[0], 2)
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            c.main(["--storefront", "cn", "AwardGrid"])

    def test_storefronts_default_to_the_seven(self):
        self.assertEqual(c.STOREFRONTS, ("us", "gb", "ca", "au", "sg", "hk", "tw"))
        apple = self.fake({"AwardGrid": ["Award Grid Planner"]})
        code, out, _ = self.run_main("AwardGrid")
        self.assertEqual(code, 0, out)
        self.assertEqual([r["query"]["country"] for r in apple.requests], list(c.STOREFRONTS))
        self.assertIn("TOO_CLOSE", out)
        self.assertIn("not a veto", out)

    def test_dir_reads_the_locale_names_and_json_keeps_every_result(self):
        self.fake({"Tablely": ["Tablely", "Other"]})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for locale in ("en-US", "en-GB"):
                (root / locale).mkdir()
                (root / locale / "name.txt").write_text("Tablely\n", encoding="utf-8")
            out_file = root / "report.json"
            code, out, _ = self.run_main("--dir", str(root), "--storefront", "us", "--json", str(out_file))
            self.assertEqual(code, 0, out)
            data = json.loads(out_file.read_text(encoding="utf-8"))
        self.assertEqual([r["name"] for r in data["candidates"]], ["Tablely"])
        self.assertEqual(data["storefronts"], ["us"])
        self.assertEqual(data["candidates"][0]["phrases"][0]["storefronts"]["us"]["results"], ["Tablely", "Other"])
        self.assertEqual(data["candidates"][0]["worst"], "EXACT")

    def test_a_failed_lookup_fails_the_run(self):
        self.fake({}, fail={"AwardGrid"})
        code, out, _ = self.run_main("--storefront", "us", "AwardGrid")
        self.assertEqual(code, 1)
        self.assertIn("lookup failed", out)

    def test_the_repos_next_names(self):
        self.assertEqual(c.names_in(c.DEFAULT_DIR), ["AwardGrid"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
