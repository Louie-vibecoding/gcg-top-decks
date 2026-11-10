#!/usr/bin/env python3
"""Audit tests for weekly top-cut counts, week bounds, and representative units."""

from __future__ import annotations

import json
import tempfile
import unittest
from collections import Counter, defaultdict
from pathlib import Path

import sync_weekly_cards
import weekly_stats as weekly

ROOT = Path(__file__).resolve().parents[1]
PILOTS = {
    "GD05-097",
    "GD05-085",
    "GD05-081",
    "ST02-010",
    "GD06-092",
    "ST13-011",
    "GD05-093",
    "ST14-012",
    "GD06-081",
    "GD05-082",
    "ST09-008",
    "GD06-090",
    "ST01-010",
    "ST04-010",
}


def deck(cards):
    return {cid: count for cid, count in cards.items()}


class WeeklyStatsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = weekly.build_report(ROOT)
        cls.japan = cls.report["regions"]["日本"]
        cls.catalog = json.loads((ROOT / "scripts/data/card_catalog.json").read_text(encoding="utf-8"))["cards"]
        cls.ctx = weekly.load_context(ROOT)
        cls.records = weekly.collect_records(cls.ctx)

    def test_daily_refresh_is_kept_and_not_replaced_by_the_old_baseline(self):
        summary = json.loads((ROOT / "data/japan-summary.json").read_text(encoding="utf-8"))
        info = self.report["meta"]["japan_events_file"]
        self.assertEqual(info["events"], summary["total_events"])
        self.assertEqual(info["placements"], summary["total_decks"])
        self.assertGreaterEqual(info["events"], 1246)
        self.assertGreaterEqual(info["placements"], 2498)
        self.assertEqual(self.report["meta"]["audit_baseline_commit"], weekly.AUDIT_COMMIT)
        self.assertIn("01M6Z6YB6FV1GRDGMPAM50SGJ5", (ROOT / "data/japan-events.json").read_text(encoding="utf-8"))

    def test_special_window_matches_conservative_v2_audit(self):
        window = self._special()
        self.assertEqual(window["start"], "2026-11-07")
        self.assertEqual(window["end"], "2026-11-08")
        self.assertFalse(window["complete"])
        self.assertEqual(window["events"], 37)
        self.assertEqual(window["raw_decks"], 74)
        self.assertEqual(window["included_decks"], 68)
        self.assertEqual(window["champions"], 37)
        self.assertEqual(window["runners_up"], 31)
        self.assertEqual(window["quarantined_decks"], 6)
        self.assertEqual(window["unconfirmed_decks"], 7)
        self.assertEqual(window["group_total_sum"], 68)
        expected = {
            "蓝绿·ν高达": (15, 6, 9, "22.1"),
            "红白·机动武斗传": (13, 11, 2, "19.1"),
            "红白·ZZ高达": (11, 8, 3, "16.2"),
            "绿紫·新吉翁": (7, 3, 4, "10.3"),
            "蓝白·强袭自由": (5, 3, 2, "7.4"),
            "蓝绿·体系待确认": (4, 0, 4, "5.9"),
            "绿白·飞翼高达": (3, 1, 2, "4.4"),
            "红蓝·强袭自由": (2, 2, 0, "2.9"),
            "绿紫·体系待确认": (2, 2, 0, "2.9"),
            "红白·加拉尔霍恩": (1, 1, 0, "1.5"),
            "白紫·密涅瓦": (1, 0, 1, "1.5"),
            "红紫·体系待确认": (1, 0, 1, "1.5"),
            "绿紫·全装独角兽": (1, 0, 1, "1.5"),
            "蓝白·GQuuuuuuX": (1, 0, 1, "1.5"),
            "蓝白·天使号": (1, 0, 1, "1.5"),
        }
        got = {group["name"]: (group["total"], group["champion"], group["runner_up"], group["percent"]) for group in window["groups"]}
        self.assertEqual(got, expected)

    def test_full_week_is_not_the_two_day_sample(self):
        week = self._week("week:2026-11-02")
        window = self._special()
        self.assertEqual(week["start"], "2026-11-02")
        self.assertEqual(week["end"], "2026-11-08")
        self.assertTrue(week["complete"])
        self.assertEqual(self.japan["default_view"], "week:2026-11-02")
        self.assertGreater(week["events"], window["events"])
        self.assertNotEqual(week["included_decks"], window["included_decks"])
        self.assertNotEqual(week["raw_decks"], 72)
        self.assertEqual(week["events"], 76)
        self.assertEqual(week["raw_decks"], 152)
        self.assertEqual(week["included_decks"], 138)
        self.assertEqual(week["champions"], 76)
        self.assertEqual(week["runners_up"], 62)
        self.assertEqual(week["quarantined_decks"], 14)
        self.assertEqual(week["unconfirmed_decks"], 25)
        self.assertEqual(week["champions"] + week["runners_up"], week["included_decks"])
        self.assertEqual(week["included_decks"] + week["quarantined_decks"], week["raw_decks"])
        dates = {deck["date"] for group in week["groups"] for deck in group["decks"]}
        self.assertTrue(dates)
        self.assertTrue(all("2026-11-02" <= day <= "2026-11-08" for day in dates))
        self.assertIn("2026-11-01", self._dates("week:2026-10-26"))
        self.assertNotIn("2026-11-01", dates)
        expected = {
            "红白·机动武斗传": (32, 22, 10, "23.2"),
            "蓝绿·ν高达": (22, 9, 13, "15.9"),
            "绿紫·新吉翁": (17, 8, 9, "12.3"),
            "蓝白·强袭自由": (13, 7, 6, "9.4"),
            "红白·ZZ高达": (11, 8, 3, "8.0"),
            "蓝绿·体系待确认": (8, 4, 4, "5.8"),
            "绿紫·体系待确认": (7, 6, 1, "5.1"),
            "蓝紫·巴巴托斯": (6, 3, 3, "4.3"),
            "绿白·飞翼高达": (5, 3, 2, "3.6"),
            "红紫·体系待确认": (3, 0, 3, "2.2"),
            "红蓝·强袭自由": (2, 2, 0, "1.4"),
            "红蓝·体系待确认": (2, 1, 1, "1.4"),
            "绿白·体系待确认": (2, 1, 1, "1.4"),
            "蓝紫·体系待确认": (2, 1, 1, "1.4"),
            "红白·加拉尔霍恩": (1, 1, 0, "0.7"),
            "白紫·密涅瓦": (1, 0, 1, "0.7"),
            "红白·体系待确认": (1, 0, 1, "0.7"),
            "绿紫·全装独角兽": (1, 0, 1, "0.7"),
            "蓝白·GQuuuuuuX": (1, 0, 1, "0.7"),
            "蓝白·天使号": (1, 0, 1, "0.7"),
        }
        got = {
            group["name"]: (group["total"], group["champion"], group["runner_up"], group["percent"])
            for group in week["groups"]
        }
        self.assertEqual(got, expected)
        barbatos = next(group for group in week["groups"] if group["name"] == "蓝紫·巴巴托斯")
        self.assertEqual(
            [card["card_id"] for card in barbatos["representative"]["cards"]],
            ["GD02-054", "GD05-002"],
        )
        quarantined_ids = {row["strong_event_id"] for row in week["quarantine"]}
        for sid in (
            "01M6DQASKQPHQDBRNN2W52GPP7",
            "01M6DTQZ6W657PKMT1BJB11WNX",
            "01M6DQARGHATTSDR8XGEE238G0",
            "01M6G2VPAFQRTXE5CT6BB7CGVH",
            "01M6G9R42V9CAP5B5H33SFXZ8T",
            "01M6JW5PFDJPJVF2DC6ZRF6CZ0",
            "01M6NEJN7XRY5ZHQSMPWFQS79N",
            "01M6R4CBANKCPRJ2FF6WHMX657",
            "01M6Z6YB6FV1GRDGMPAM50SGJ5",
        ):
            self.assertIn(sid, quarantined_ids)

    def test_opening_week_is_partial(self):
        first = self.japan["weeks"][0]
        self.assertEqual(first["id"], "week:2026-07-27")
        self.assertEqual(first["start"], "2026-07-27")
        self.assertEqual(first["end"], "2026-08-02")
        self.assertFalse(first["complete"])
        self.assertIn("2026-08-01", first["coverage_note"])

    def test_every_view_group_sum_matches_denominator(self):
        for region in self.report["regions"].values():
            for view in region["weeks"] + region["special_windows"]:
                self.assertEqual(view["group_total_sum"], view["included_decks"], view["id"])
                self.assertTrue(view["sum_matches_denominator"])
                self.assertEqual(sum(group["total"] for group in view["groups"]), view["included_decks"])
                self.assertEqual(sum(group["champion"] for group in view["groups"]), view["champions"])
                self.assertEqual(sum(group["runner_up"] for group in view["groups"]), view["runners_up"])
                self.assertEqual(
                    sum(group["total"] for group in view["groups"] if group["unconfirmed"]),
                    view["unconfirmed_decks"],
                )

    def test_quarantine_stays_out_and_is_not_relabeled_champion(self):
        window = self._special()
        included_players = {
            (deck["strong_event_id"], deck["player"])
            for group in window["groups"]
            for deck in group["decks"]
        }
        self.assertEqual(len(window["quarantine"]), 6)
        verified = [row for row in window["quarantine"] if row["verification"] == "实际冠亚口径未核实"]
        pending = [row for row in window["quarantine"] if row["verification"] == "公开页名次标签冲突，尚未独立核验"]
        self.assertEqual(len(verified), 5)
        self.assertEqual([row["player"] for row in pending], ["オチアス"])
        for row in window["quarantine"]:
            self.assertFalse(row["chart_included"])
            self.assertEqual(row["stored_rank"], 2)
            self.assertNotIn((row["strong_event_id"], row["player"]), included_players)
        for row in verified:
            self.assertTrue(row["official_url"].startswith("https://"))
            self.assertTrue(row["secondary_url"].startswith("https://"))
        self.assertNotIn("official_url", pending[0])
        champions = {
            deck["player"]
            for group in window["groups"]
            for deck in group["decks"]
            if deck["rank"] == 1 and deck["strong_event_id"] in {row["strong_event_id"] for row in window["quarantine"]}
        }
        self.assertEqual(champions, {"ウキョウ", "ドフィ", "あまと", "ショウマ", "シンゴ", "げーしー"})
        self.assertEqual(self.report["meta"]["quarantine_unmatched"], [])

    def test_dedup_does_not_merge_distinct_events_or_double_count(self):
        sample = next(event for event in self.ctx["events"] if event["id"].startswith("ntcd-"))
        twin = json.loads(json.dumps(sample))
        ctx = weekly.load_context(ROOT)
        ctx["events"] = [sample, twin]
        records = weekly.collect_records(ctx)["日本"]
        included = [row for row in records if row["status"] == "included"]
        self.assertEqual(len(included), len(sample["placements"]))
        self.assertEqual(len(ctx["duplicate_drops"]), len(sample["placements"]))

        other = json.loads(json.dumps(sample))
        other["id"] = "ntcd-" + "B" * 26
        other["store_name"] = "另一家店"
        ctx = weekly.load_context(ROOT)
        ctx["events"] = [sample, other]
        records = weekly.collect_records(ctx)["日本"]
        included_ids = {row["event_id"] for row in records if row["status"] == "included"}
        self.assertEqual(included_ids, {sample["id"], other["id"]})
        self.assertEqual(sum(1 for row in records if row["status"] == "included"), len(sample["placements"]) * 2)

    def test_tied_runner_up_players_both_count(self):
        rows = [
            row
            for row in self.records["日本"]
            if row["event_id"] == "ntcd-01KYY84SFTJNK7FSC8S4ZH2MX7" and row["status"] == "included"
        ]
        self.assertEqual(sorted((row["rank"], row["player"]) for row in rows), [(1, "クボ"), (2, "こちょむ"), (2, "さーまる")])

    def test_team_event_excluded_and_individual_final_kept(self):
        excluded = {row["event_id"] for row in self.report["meta"]["excluded_team_events"]}
        self.assertIn("official-expo2026-tokyo-3on3", excluded)
        self.assertNotIn("official-expo2026-tokyo-1on1", excluded)
        self.assertNotIn("jp-cs-2026-08-09-uc-osaka-matsuri", excluded)
        players = {
            deck["player"]
            for week in self.japan["weeks"]
            for group in week["groups"]
            for deck in group["decks"]
        }
        self.assertIn("ヒロ", players)
        ids = {
            deck["event_id"]
            for week in self.japan["weeks"]
            for group in week["groups"]
            for deck in group["decks"]
        }
        self.assertNotIn("official-expo2026-tokyo-3on3", ids)
        self.assertIn("official-expo2026-tokyo-1on1", ids)

    def test_attendance_uses_confirmed_count_not_capacity(self):
        seen = []
        for region in self.report["regions"].values():
            for view in region["weeks"] + region["special_windows"]:
                for group in view["groups"]:
                    for deck in group["decks"]:
                        if "attendance" in deck:
                            seen.append(deck["attendance"])
                        self.assertNotEqual(deck.get("attendance", {}).get("attendance"), 32)
        self.assertTrue(seen)
        self.assertTrue(all(item["attendance"] == 75 and item["ignored_capacity"] == 96 for item in seen))

    def test_photo_only_and_missing_player_are_isolated(self):
        china = self.report["regions"]["中国"]
        august = next(week for week in china["weeks"] if week["id"] == "week:2026-08-17")
        self.assertTrue(august["chart_empty"])
        self.assertEqual(august["included_decks"], 0)
        self.assertEqual(august["isolated_decks"], 2)
        self.assertTrue(all(row["verification"] == "未核实" and row["has_photo"] for row in august["isolated"]))
        self.assertIn("没有纳入", august["chart_empty_reason"])

        event = {
            "id": "ntcd-" + "C" * 26,
            "date": "2026-08-03",
            "region_tag": "日本",
            "event_type": "NTC",
            "store_name": "测试店",
            "placements": [
                {"rank": 1, "player_name": "", "cards": [{"card_id": "GD05-002", "count": 4}]},
                {"rank": 2, "player_name": "有名字", "deck_photo": "x.png"},
            ],
        }
        ctx = weekly.load_context(ROOT)
        ctx["events"] = [event]
        rows = weekly.collect_records(ctx)["日本"]
        reasons = {row["player"]: row["isolate_reason"] for row in rows}
        self.assertEqual(reasons[""], "missing_player")
        self.assertEqual(reasons["有名字"], "missing_card_list")
        self.assertTrue(all(row["status"] == "isolated" for row in rows))

    def test_empty_week_view_has_no_fabricated_percent(self):
        view = weekly.aggregate_view(
            [],
            {},
            {
                "id": "week:2099-01-05",
                "kind": "week",
                "region": "日本",
                "start": "2099-01-05",
                "end": "2099-01-11",
                "complete": True,
                "coverage_note": "测试空周",
                "title": "2099-01-05 至 2099-01-11",
            },
        )
        self.assertTrue(view["chart_empty"])
        self.assertEqual(view["groups"], [])
        self.assertEqual(view["included_decks"], 0)
        self.assertIsNone(view["groups"][0]["percent"] if view["groups"] else None)
        self.assertNotIn("co_occurrence", view)

    def test_rules_do_not_guess_ties_or_color_only(self):
        rules = self.ctx["rules"]
        mf = next(rule for rule in rules if rule["name"] == "红白·机动武斗传")
        zz = next(rule for rule in rules if rule["name"] == "红白·ZZ高达")
        horn = next(rule for rule in rules if rule["name"] == "红白·加拉尔霍恩")
        both = {cid: need for cid, need in mf["minimum_cards"].items()}
        both[next(iter(zz["minimum_cards"]))] = 4
        self.assertEqual(weekly.classify_deck(both, "红白", rules)["name"], "红白·机动武斗传")
        horn_counts = {cid: need for cid, need in horn["minimum_cards"].items()}
        horn_counts[next(iter(zz["minimum_cards"]))] = 4
        self.assertEqual(weekly.classify_deck(horn_counts, "红白", rules)["name"], "红白·加拉尔霍恩")
        self.assertTrue(weekly.classify_deck({"GD06-033": 2}, "红白", rules)["unconfirmed"])
        self.assertEqual(weekly.classify_deck({"GD06-033": 2}, "红白", rules)["name"], "红白·体系待确认")
        self.assertTrue(weekly.classify_deck({"GD06-033": 4}, "红白", rules)["unconfirmed"])
        self.assertEqual(
            weekly.classify_deck({"GD06-033": 3, "GD06-064": 3}, "红白", rules)["name"],
            "红白·ZZ高达",
        )
        self.assertTrue(weekly.classify_deck({"GD06-033": 3, "GD06-064": 3}, "蓝白", rules)["unconfirmed"])
        barbatos = {
            "GD02-054": 3,
            "GD03-056": 3,
            "ST05-010": 3,
            "GD05-002": 3,
            "GD05-081": 3,
        }
        self.assertEqual(weekly.classify_deck(barbatos, "蓝紫", rules)["name"], "蓝紫·巴巴托斯")
        self.assertNotEqual(weekly.classify_deck(barbatos, "蓝白", rules)["name"], "蓝紫·巴巴托斯")
        tied_rules = [
            {"name": "甲体系", "color": "红", "minimum_cards": {"A": 3, "B": 3}, "representative_card": "A"},
            {"name": "乙体系", "color": "红", "minimum_cards": {"C": 3, "D": 3}, "representative_card": "C"},
        ]
        result = weekly.classify_deck({"A": 3, "B": 3, "C": 3, "D": 3}, "红", tied_rules)
        self.assertTrue(result["ambiguous"])
        self.assertIn("多规则同时满足", result["name"])
        self.assertEqual(result["candidates"], ["乙体系", "甲体系"])

    def test_representatives_are_units_that_cooccur(self):
        window = self._special()
        expected = {
            "蓝绿·ν高达": ("declared_core_pair", ["GD05-017", "GD05-029"]),
            "红白·机动武斗传": ("declared_core_pair", ["GD05-033", "GD05-066"]),
            "红白·ZZ高达": ("observed_pair", ["GD06-033", "GD06-064"]),
            "绿紫·新吉翁": ("observed_pair", ["ST13-001", "GD05-049"]),
            "绿白·飞翼高达": ("declared_core_pair", ["ST02-001", "GD05-067"]),
            "红蓝·强袭自由": ("declared_core_pair", ["GD05-002", "GD06-041"]),
            "红白·加拉尔霍恩": ("declared_core_pair", ["GD06-034", "GD06-036"]),
            "白紫·密涅瓦": ("declared_core_pair", ["GD04-050", "GD06-050"]),
            "绿紫·全装独角兽": ("single_core", ["ST14-006"]),
            "蓝白·GQuuuuuuX": ("single_core", ["GD06-003"]),
            "蓝白·天使号": ("declared_core_pair", ["GD05-004", "GD05-003"]),
            "蓝绿·体系待确认": ("unconfirmed_none", []),
        }
        by_name = {group["name"]: group for group in window["groups"]}
        included = [
            row
            for row in self.records["日本"]
            if row["status"] == "included" and "2026-11-07" <= row["date"] <= "2026-11-08"
        ]
        for name, (mode, cards) in expected.items():
            group = by_name[name]
            representative = group["representative"]
            self.assertEqual(representative["mode"], mode, name)
            self.assertEqual([card["card_id"] for card in representative.get("cards") or []], cards)
            if mode.endswith("pair"):
                self.assertEqual(representative["co_occurrence"]["group_size"], group["total"])
                together = sum(
                    1
                    for row in included
                    if row["archetype"] == name and all(cid in row["cards"] for cid in cards)
                )
                self.assertEqual(representative["co_occurrence"]["decks"], together)
            else:
                self.assertNotIn("co_occurrence", representative)
        families = weekly._family_index(json.loads((ROOT / "scripts/data/unit_families.json").read_text(encoding="utf-8")))
        for region in self.report["regions"].values():
            for view in region["weeks"] + region["special_windows"]:
                for group in view["groups"]:
                    representative = group["representative"]
                    ids = [card["card_id"] for card in representative.get("cards") or []]
                    self.assertTrue(all(self.catalog[cid]["card_type"] == "UNIT" for cid in ids), group["name"])
                    self.assertTrue(PILOTS.isdisjoint(ids))
                    if len(ids) == 2 and families.get(ids[0]) and families.get(ids[0]) == families.get(ids[1]):
                        self.fail(f"{group['name']} paired the same machine {ids}")

    def test_same_machine_forms_and_exclusive_subtypes_are_not_paired(self):
        catalog = {
            "CORE": {"name_en": "Core", "card_type": "UNIT", "level": 6},
            "U1": {"name_en": "Alpha", "card_type": "UNIT", "level": 5},
            "U2": {"name_en": "Beta", "card_type": "UNIT", "level": 5},
            "PILOT": {"name_en": "Pilot", "card_type": "PILOT", "level": 4},
            "GD06-003": {"name_en": "GQuuuuuuX Omega", "card_type": "UNIT", "level": 6},
            "GD06-017": {"name_en": "GQuuuuuuX", "card_type": "UNIT", "level": 3},
        }
        families = {"GD06-003": "gquuuuuux", "GD06-017": "gquuuuuux"}
        decks = [{"CORE": 4, "U1": 4, "PILOT": 4} for _ in range(6)]
        decks += [{"CORE": 4, "U2": 4, "PILOT": 4} for _ in range(6)]
        freq = Counter()
        for row in decks:
            for cid in row:
                freq[cid] += 1
        result = weekly.select_representatives(
            decks,
            "测试·核心",
            {"name": "测试·核心", "minimum_cards": {"CORE": 3}, "representative_card": "CORE"},
            catalog,
            {},
            families,
            set(),
            freq,
            len(decks),
            len(decks),
            freq,
            decks,
        )
        self.assertEqual(result["mode"], "single_core")
        self.assertEqual([card["card_id"] for card in result["cards"]], ["CORE"])
        self.assertNotIn("co_occurrence", result)
        self.assertIn("驾驶员", result["reason"])

        forms = [{"GD06-003": 4, "GD06-017": 4, "PILOT": 4} for _ in range(4)]
        form_freq = Counter({"GD06-003": 4, "GD06-017": 4, "PILOT": 4})
        formed = weekly.select_representatives(
            forms,
            "蓝白·GQuuuuuuX",
            {"name": "蓝白·GQuuuuuuX", "minimum_cards": {"GD06-003": 3, "GD06-017": 3}, "representative_card": "GD06-003"},
            catalog,
            {},
            families,
            set(),
            form_freq,
            4,
            4,
            form_freq,
            forms,
        )
        self.assertEqual(formed["mode"], "single_core")
        self.assertEqual([card["card_id"] for card in formed["cards"]], ["GD06-003"])
        self.assertNotIn("GD06-017", [card["card_id"] for card in formed["cards"]])

    def test_unconfirmed_does_not_fill_with_staples(self):
        catalog = {
            "ZAKU": {"name_en": "Zaku", "card_type": "UNIT", "level": 2},
            "DOM": {"name_en": "Dom", "card_type": "UNIT", "level": 2},
            "PILOT": {"name_en": "Pilot", "card_type": "PILOT", "level": 3},
        }
        group = [{"ZAKU": 4, "DOM": 4, "PILOT": 4} for _ in range(5)]
        corpus = Counter({"ZAKU": 40, "DOM": 40, "PILOT": 40})
        result = weekly.select_representatives(
            group,
            "绿紫·体系待确认",
            None,
            catalog,
            {},
            {},
            set(),
            corpus,
            100,
            5,
            Counter({"ZAKU": 5, "DOM": 5, "PILOT": 5}),
            group,
        )
        self.assertEqual(result["mode"], "unconfirmed_none")
        self.assertNotIn("cards", result)
        self.assertNotIn("co_occurrence", result)

    def test_representative_card_images_are_local_webp(self):
        missing = sync_weekly_cards.sync_cards(ROOT, self.report, download=False)
        self.assertEqual(missing, [])
        for card_id in sync_weekly_cards.representative_ids(self.report):
            self.assertNotIn(card_id, PILOTS)

    def test_rebuild_fingerprint_is_idempotent(self):
        again = weekly.build_report(ROOT)
        self.assertEqual(weekly.fingerprint(self.report), weekly.fingerprint(again))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weekly-top.json"
            self.assertEqual(weekly.write_report(self.report, path), "wrote")
            first = path.read_bytes()
            self.assertEqual(weekly.write_report(again, path), "unchanged")
            self.assertEqual(path.read_bytes(), first)

    def _special(self):
        return self.japan["special_windows"][0]

    def _week(self, week_id):
        return next(week for week in self.japan["weeks"] if week["id"] == week_id)

    def _dates(self, week_id):
        week = self._week(week_id)
        return {deck["date"] for group in week["groups"] for deck in group["decks"]}


if __name__ == "__main__":
    unittest.main()
