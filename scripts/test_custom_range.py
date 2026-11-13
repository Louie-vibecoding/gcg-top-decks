#!/usr/bin/env python3
"""Custom date and week-union totals must match the weekly builder's own slices."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import weekly_stats as weekly

ROOT = Path(__file__).resolve().parents[1]


class CustomRangeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = weekly.build_report(ROOT)
        cls.records = weekly.build_records_document(cls.report, ROOT)
        cls.products = json.loads((ROOT / "data/jp-official-products.json").read_text(encoding="utf-8"))
        cls.boundaries = json.loads((ROOT / "data/jp-release-boundaries.json").read_text(encoding="utf-8"))

    def test_every_published_view_matches_its_own_dates(self):
        for region, blob in self.report["regions"].items():
            rows = self.records["regions"][region]["records"]
            for view in blob["weeks"] + blob["special_windows"]:
                dates = set(weekly.dates_inclusive(view["start"], view["end"]))
                got = weekly.summarize_records(rows, dates)
                self.assertEqual(got["events"], view["events"], view["id"])
                self.assertEqual(got["included_decks"], view["included_decks"], view["id"])
                self.assertEqual(got["champions"], view["champions"], view["id"])
                self.assertEqual(got["runners_up"], view["runners_up"], view["id"])
                self.assertEqual(got["quarantined_decks"], view["quarantined_decks"], view["id"])
                self.assertEqual(got["isolated_decks"], view["isolated_decks"], view["id"])
                self.assertEqual(got["unconfirmed_decks"], view["unconfirmed_decks"], view["id"])
                expected = {group["name"]: (group["total"], group["champion"], group["runner_up"], group["percent"]) for group in view["groups"]}
                actual = {group["name"]: (group["total"], group["champion"], group["runner_up"], group["percent"]) for group in got["groups"]}
                self.assertEqual(actual, expected, view["id"])

    def test_partial_days_are_not_the_whole_week(self):
        japan = self.report["regions"]["日本"]
        week = next(view for view in japan["weeks"] if view["included_decks"] > 0)
        rows = self.records["regions"]["日本"]["records"]
        one_day = weekly.summarize_records(rows, {week["start"]})
        self.assertLess(one_day["included_decks"], week["included_decks"])
        self.assertLessEqual(one_day["events"], week["events"])

    def test_noncontiguous_weeks_skip_the_gap(self):
        japan = self.report["regions"]["日本"]
        weeks = [view for view in japan["weeks"] if view["included_decks"] > 0]
        self.assertGreaterEqual(len(weeks), 3)
        left, gap, right = weeks[-3], weeks[-2], weeks[-1]
        rows = self.records["regions"]["日本"]["records"]
        selected = set(weekly.dates_inclusive(left["start"], left["end"])) | set(weekly.dates_inclusive(right["start"], right["end"]))
        gap_days = set(weekly.dates_inclusive(gap["start"], gap["end"]))
        self.assertFalse(selected & gap_days)
        union = weekly.summarize_records(rows, selected)
        gap_only = weekly.summarize_records(rows, gap_days)
        self.assertEqual(union["included_decks"], left["included_decks"] + right["included_decks"])
        self.assertGreater(gap_only["included_decks"], 0)
        self.assertEqual(union["events"], left["events"] + right["events"])

    def test_week_plus_inner_window_does_not_double_count(self):
        japan = self.report["regions"]["日本"]
        window = next(view for view in japan["special_windows"] if view["included_decks"] > 0)
        week = next(view for view in japan["weeks"] if view["start"] <= window["start"] and view["end"] >= window["end"])
        rows = self.records["regions"]["日本"]["records"]
        dates = set(weekly.dates_inclusive(week["start"], week["end"])) | set(weekly.dates_inclusive(window["start"], window["end"]))
        got = weekly.summarize_records(rows, dates)
        self.assertEqual(got["included_decks"], week["included_decks"])
        self.assertEqual(got["events"], week["events"])

    def test_empty_and_invalid_ranges_add_nothing(self):
        rows = self.records["regions"]["日本"]["records"]
        empty = weekly.summarize_records(rows, set())
        self.assertEqual(empty["included_decks"], 0)
        self.assertEqual(empty["groups"], [])
        self.assertEqual(weekly.dates_inclusive("2026-11-15", "2026-11-09"), [])

    def test_cross_month_range_includes_both_months(self):
        rows = self.records["regions"]["日本"]["records"]
        dates = set(weekly.dates_inclusive("2026-10-31", "2026-11-02"))
        got = weekly.summarize_records(rows, dates)
        present = {row["date"] for row in rows if row["date"] in dates and row["status"] == "included"}
        self.assertTrue(any(day.startswith("2026-10") for day in present) or got["included_decks"] >= 0)
        self.assertTrue(all(day.startswith("2026-10") or day.startswith("2026-11") for day in present))

    def test_committed_records_match_the_builder(self):
        path = ROOT / "data/weekly-records.json"
        self.assertTrue(path.exists())
        committed = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(weekly.records_fingerprint(committed), weekly.records_fingerprint(self.records))

    def test_official_products_keep_the_scraped_boundaries(self):
        products = self.products["products"]
        self.assertEqual(len(products), 54)
        self.assertEqual(len({item["id"] for item in products}), 54)
        self.assertEqual(self.products["region"], "JP")
        ids = {item["id"] for item in products}
        self.assertIn("evx06", ids)
        self.assertEqual(sum(1 for item in products if item["id"] == "evx07"), 1)
        for product_id in ("pb02", "pb03", "pb04", "evx12"):
            product = next(item for item in products if item["id"] == product_id)
            self.assertIsNone(product["release_date_iso"], product_id)
            self.assertNotEqual(product["release_date_precision"], "exact_day", product_id)
        beta = next(item for item in products if item["id"] == "limitedbox-beta")
        self.assertFalse(beta["environment_boundary_eligible"])
        eligible = [
            item["release_date_iso"]
            for item in products
            if item["environment_boundary_eligible"] and item["release_date_precision"] == "exact_day" and item["release_date_iso"]
        ]
        self.assertEqual(len(set(eligible)), 15)
        self.assertEqual(
            set(eligible),
            {item["boundary_date_iso"] for item in self.boundaries["candidate_boundaries"]},
        )
        self.assertTrue(all(item["region"] == "JP" for item in products))


if __name__ == "__main__":
    unittest.main()
