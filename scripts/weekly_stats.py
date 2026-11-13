#!/usr/bin/env python3
"""Build the Chinese weekly top-cut report from the site's public event files.

Classification uses card-count rules, not color alone. Representative images are
two units that actually co-occur. Pilots, bases and generic splash cards are not
used to fill a second picture. Rank conflicts in the quarantine file stay out of
the denominator and are not relabeled as champions.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "data"
MIN_DATE = "2026-08-01"
CARD_IMAGE_TEMPLATE = "https://gcg-stats.com/images/cards/{CARD_ID}.webp"
AUDIT_COMMIT = "b710fd02d21dba9f8e40f0f3fe9c1f7cf88c8001"
CST = timezone(timedelta(hours=8))

SOURCES = (
    ("data/japan-events.json", "日本"),
    ("data/japan-cs.json", "日本"),
    ("data/japan-official.json", "日本"),
    ("data/china.json", "中国"),
    ("data/eu.json", "欧美"),
)

THRESHOLDS = {
    "declared_pair_min_conditional": 0.6,
    "observed_partner_min_coverage": 0.6,
    "observed_partner_min_conditional": 0.6,
    "observed_partner_min_avg_copies": 2.5,
    "observed_partner_max_outside_rate": 0.08,
    "observed_partner_min_group_decks": 3,
    "observed_partner_small_group_min_corpus_together": 10,
    "unconfirmed_min_coverage": 0.75,
    "unconfirmed_min_conditional": 0.75,
    "unconfirmed_max_outside_rate": 0.08,
    "unconfirmed_min_avg_copies": 2.5,
    "unconfirmed_min_decks": 3,
    "unconfirmed_max_corpus_rate": 0.12,
    "unconfirmed_single_max_outside_rate": 0.05,
    "unconfirmed_single_min_avg_copies": 3.0,
}

ISOLATE_TEXT = {
    "missing_card_list": "缺少可按卡号计数的卡表。有照片也不能当成已分类样本。",
    "missing_player": "缺少选手名。并列名次无法按赛事+名次+选手去重，先隔离。",
    "missing_date": "缺少赛事日期，不能归入周一至周日。",
    "missing_event_id": "缺少赛事 ID，不能跨源去重。",
    "invalid_rank": "名次无法解析，不进入冠亚分母。",
    "date_conflict": "同一赛事 ID 在不同来源里的日期不一致，先隔离。",
}

VOLATILE_META_KEYS = (
    "generated_at",
    "generated_at_label",
    "generation_log",
    "data_git_commit",
)


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def strong_event_id(event_id: str) -> str:
    text = event_id or ""
    match = re.search(r"([0-9A-Z]{26})$", text)
    return match.group(1) if match else text


def parse_day(value: str) -> date:
    year, month, day = (int(part) for part in value.split("-"))
    return date(year, month, day)


def monday_of(value: str) -> date:
    day = parse_day(value)
    return day - timedelta(days=day.weekday())


def iso(day: date) -> str:
    return day.isoformat()


def is_team_event(event: dict) -> bool:
    """Team format is read from the event's own format or title, not from notes.

    Notes often mention some other 3on3 that was skipped. Those sentences must
    not drop an individual final.
    """
    fmt = str(event.get("format") or "").lower()
    if fmt in {"3on3", "5on5"}:
        return True
    if event.get("players_unit") == "teams":
        return True
    blob = " ".join(
        str(event.get(key) or "")
        for key in ("id", "event_name", "series_name")
    )
    return re.search(r"(?:^|[^0-9a-z])(?:3on3|5on5)(?:[^0-9a-z]|$)|チーム戦", blob, re.I) is not None


def confirmed_attendance(event: dict):
    """Only an explicit 实到/確認 ratio is attendance. The number after the slash is capacity."""
    chunks = []
    for key in ("notes", "event_note"):
        if event.get(key):
            chunks.append(str(event[key]))
    blob = "\n".join(chunks)
    match = re.search(r"(\d+)\s*/\s*(\d+)\s*確認", blob)
    if not match:
        return None
    return {
        "attendance": int(match.group(1)),
        "quote": match.group(0),
        "ignored_capacity": int(match.group(2)),
        "source_url": event.get("players_source_url") or event.get("source_url") or "",
    }


def card_counts(cards) -> dict:
    totals = defaultdict(int)
    for card in cards or []:
        cid = str(card.get("card_id") or "").strip()
        if not cid:
            continue
        try:
            count = int(card.get("count") or 0)
        except (TypeError, ValueError):
            continue
        if count > 0:
            totals[cid] += count
    return dict(totals)


def _rule_spec(rule: dict):
    minimum = rule["minimum_cards"]
    return (len(minimum), sum(int(v) for v in minimum.values()))


def _minimum_met(counts: dict, minimum: dict) -> bool:
    return all(counts.get(cid, 0) >= int(need) for cid, need in (minimum or {}).items())


def _rule_matches(rule: dict, counts: dict, deck_type: str) -> bool:
    """Color has to agree, then every required card, then one support package if the rule lists any."""
    rule_color = (rule.get("color") or "").strip()
    deck_color = (deck_type or "").strip()
    if rule_color and rule_color != deck_color:
        return False
    if not _minimum_met(counts, rule.get("minimum_cards") or {}):
        return False
    support = rule.get("support_any") or []
    if support and not any(_minimum_met(counts, group) for group in support):
        return False
    return True


def classify_deck(counts: dict, deck_type: str, rules: list) -> dict:
    """Match the most specific card-count rule. Equal specificity is not guessed."""
    hits = []
    for rule in rules:
        if _rule_matches(rule, counts, deck_type):
            hits.append(rule)
    if not hits:
        color = (deck_type or "").strip() or "颜色未标注"
        return {
            "name": f"{color}·体系待确认",
            "unconfirmed": True,
            "ambiguous": False,
            "candidates": [],
        }
    hits.sort(key=lambda rule: (-_rule_spec(rule)[0], -_rule_spec(rule)[1], rule["name"]))
    best_spec = _rule_spec(hits[0])
    tied = [rule for rule in hits if _rule_spec(rule) == best_spec]
    if len(tied) > 1:
        names = sorted(rule["name"] for rule in tied)
        return {
            "name": "多规则同时满足·" + "/".join(names),
            "unconfirmed": True,
            "ambiguous": True,
            "candidates": names,
        }
    winner = tied[0]
    return {
        "name": winner["name"],
        "unconfirmed": False,
        "ambiguous": False,
        "candidates": [winner["name"]],
    }


def _family_index(doc: dict) -> dict:
    index = {}
    for family in doc.get("families") or []:
        for cid in family.get("card_ids") or []:
            index[cid] = family["id"]
    return index


def _display_name(cid: str, catalog: dict, names_zh: dict) -> str:
    zh = names_zh.get(cid)
    en = (catalog.get(cid) or {}).get("name_en") or ""
    if zh and en:
        return f"{zh} {cid}"
    if zh:
        return f"{zh} {cid}"
    if en:
        return f"{en} {cid}"
    return cid


def _avg(copies: Counter, freq: Counter, cid: str) -> float:
    seen = freq[cid]
    if not seen:
        return 0.0
    return copies[cid] / seen


def _co_decks(decks: list, left: str, right: str) -> int:
    return sum(1 for deck in decks if deck.get(left, 0) > 0 and deck.get(right, 0) > 0)


def _corpus_together(decks: list, left: str, right: str) -> int:
    return _co_decks(decks, left, right)


def _card_payload(cid, freq, copies, group_size, catalog, names_zh, role):
    info = catalog.get(cid) or {}
    payload = {
        "card_id": cid,
        "name_en": info.get("name_en") or "",
        "card_type": info.get("card_type") or "",
        "role": role,
        "decks_with_card": int(freq[cid]),
        "copies_sum": int(copies[cid]),
        "group_size": group_size,
    }
    if names_zh.get(cid):
        payload["name_zh"] = names_zh[cid]
    if info.get("level") is not None:
        payload["level"] = info["level"]
    return payload


def _alt(cid, freq, copies, group_size, catalog, names_zh, reason_code, detail):
    info = catalog.get(cid) or {}
    payload = {
        "card_id": cid,
        "name_en": info.get("name_en") or "",
        "card_type": info.get("card_type") or "",
        "decks_with_card": int(freq[cid]) if cid in freq else 0,
        "copies_sum": int(copies[cid]) if cid in copies else 0,
        "group_size": group_size,
        "reason_code": reason_code,
        "detail": detail,
    }
    if names_zh.get(cid):
        payload["name_zh"] = names_zh[cid]
    return payload


def _better_pair(left, right) -> bool:
    # Namesake core stays in the picture when coverage is tied. Copy count and
    # level only separate the remaining partner. Card id is the last stable tie-break.
    left_key = (left["coverage"], left["has_rep"], left["avg_sum"], left["level_sum"])
    right_key = (right["coverage"], right["has_rep"], right["avg_sum"], right["level_sum"])
    if left_key != right_key:
        return left_key > right_key
    return tuple(sorted(left["ids"])) < tuple(sorted(right["ids"]))


def _pilot_sentence(freq, catalog, names_zh, group_size, rule) -> str:
    pilots = []
    for cid, seen in freq.items():
        if (catalog.get(cid) or {}).get("card_type") == "PILOT" and group_size and seen / group_size >= 0.8:
            pilots.append(cid)
    if not pilots:
        return ""
    preferred = [
        cid
        for cid in (rule or {}).get("minimum_cards") or {}
        if cid in pilots
    ]
    cid = preferred[0] if preferred else max(pilots, key=lambda item: (freq[item], item))
    return f"{_display_name(cid, catalog, names_zh)} 是驾驶员（{freq[cid]}/{group_size} 套），不用来补第二张图。"


def select_representatives(
    group_decks: list,
    archetype_name: str,
    rule: dict | None,
    catalog: dict,
    names_zh: dict,
    families: dict,
    other_core_ids: set,
    corpus_freq: Counter,
    corpus_size: int,
    archetype_size: int,
    archetype_freq: Counter,
    archetype_decks: list,
) -> dict:
    """Pick one or two UNIT cards for a group.

    Declared core units that co-occur win over a colorful splash. A second unit
    must be a different machine, present in the same real lists, and not a
    staple that shows up across unrelated archetypes. Unknown groups never
    borrow another archetype's pair.
    """
    group_size = len(group_decks)
    if group_size <= 0:
        return {"mode": "unconfirmed_none", "reason": "这一组没有卡表。"}

    freq = Counter()
    copies = Counter()
    for deck in group_decks:
        for cid, count in deck.items():
            if count > 0:
                freq[cid] += 1
                copies[cid] += count

    def outside(cid: str) -> float:
        denom = corpus_size - archetype_size
        if denom <= 0:
            return 0.0
        total = corpus_freq[cid]
        inside = archetype_freq[cid]
        return max(0, total - inside) / denom

    def corpus_rate(cid: str) -> float:
        if corpus_size <= 0:
            return 0.0
        return corpus_freq[cid] / corpus_size

    def is_unit(cid: str) -> bool:
        return (catalog.get(cid) or {}).get("card_type") == "UNIT"

    def same_family(left: str, right: str) -> bool:
        fam_left = families.get(left)
        fam_right = families.get(right)
        return bool(fam_left and fam_left == fam_right)

    alternatives = []
    pilot_note = _pilot_sentence(freq, catalog, names_zh, group_size, rule)

    def finish(result):
        if pilot_note and pilot_note not in result["reason"]:
            result["reason"] = result["reason"].rstrip() + pilot_note
        if alternatives:
            alternatives.sort(key=lambda item: (-item.get("decks_with_card", 0), item.get("card_id") or ""))
            result["alternatives"] = alternatives[:3]
        return result

    declared = []
    representative = ""
    if rule:
        representative = rule.get("representative_card") or ""
        for cid in rule.get("minimum_cards") or {}:
            if is_unit(cid):
                declared.append(cid)

    def consider_declared_pairs():
        found = []
        for left, right in combinations(sorted(set(declared)), 2):
            if same_family(left, right):
                alternatives.append(
                    _alt(
                        right,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "same_family",
                        f"{_display_name(left, catalog, names_zh)} 与 {_display_name(right, catalog, names_zh)} 是同一机体的不同形态，不拼成两台。",
                    )
                )
                continue
            seen_left = freq[left]
            seen_right = freq[right]
            together = _co_decks(group_decks, left, right)
            if seen_left == 0 or seen_right == 0 or together == 0:
                continue
            conditional = min(together / seen_left, together / seen_right)
            coverage = together / group_size
            if (
                conditional < THRESHOLDS["declared_pair_min_conditional"]
                and coverage < 0.8
            ):
                alternatives.append(
                    _alt(
                        right,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "exclusive_subtype",
                        f"与 {_display_name(left, catalog, names_zh)} 同场只有 {together}/{group_size}，更像互斥子体系，不拼在一起。",
                    )
                )
                continue
            level_sum = (catalog.get(left) or {}).get("level") or 0
            level_sum += (catalog.get(right) or {}).get("level") or 0
            found.append(
                {
                    "ids": (left, right),
                    "together": together,
                    "coverage": coverage,
                    "avg_sum": _avg(copies, freq, left) + _avg(copies, freq, right),
                    "has_rep": 1 if representative in (left, right) else 0,
                    "level_sum": level_sum,
                }
            )
        return found

    if declared:
        pairs = consider_declared_pairs()
        if pairs:
            best = pairs[0]
            for candidate in pairs[1:]:
                if _better_pair(candidate, best):
                    best = candidate
            left, right = best["ids"]
            if representative in (left, right) and representative != left:
                left, right = right, left
            elif representative not in (left, right):
                left_level = (catalog.get(left) or {}).get("level") or 0
                right_level = (catalog.get(right) or {}).get("level") or 0
                if (right_level, right) > (left_level, left):
                    left, right = right, left
            reason = (
                f"规则核心机体 {_display_name(left, catalog, names_zh)} 与 "
                f"{_display_name(right, catalog, names_zh)} 在本组 {best['together']}/{group_size} 套卡表里同时出现。"
                f"平均投入 {_avg(copies, freq, left):.1f} 张和 {_avg(copies, freq, right):.1f} 张。"
                "这是同一套真实卡表里的两台机体，不是按颜色各挑一张。"
            )
            return finish(
                {
                    "mode": "declared_core_pair",
                    "reason": reason,
                    "cards": [
                        _card_payload(left, freq, copies, group_size, catalog, names_zh, "rule_core"),
                        _card_payload(right, freq, copies, group_size, catalog, names_zh, "rule_core"),
                    ],
                    "co_occurrence": {"decks": best["together"], "group_size": group_size},
                }
            )

    # One declared core, or only same-machine forms: look for a specific partner.
    primary = ""
    if declared:
        present = [cid for cid in declared if freq[cid] > 0]
        if representative in present and is_unit(representative):
            primary = representative
        elif present:
            primary = max(
                present,
                key=lambda cid: (freq[cid], _avg(copies, freq, cid), (catalog.get(cid) or {}).get("level") or 0, cid),
            )

    def partner_candidates(primary_id: str):
        found = []
        primary_seen = freq[primary_id]
        for cid, seen in freq.items():
            if cid == primary_id or not is_unit(cid):
                continue
            if same_family(primary_id, cid):
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "same_family",
                        f"{_display_name(cid, catalog, names_zh)} 与核心机体是同一台的不同形态。",
                    )
                )
                continue
            if cid in other_core_ids:
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "other_archetype_core",
                        f"{_display_name(cid, catalog, names_zh)} 是另一个已定义体系的核心，不用来给本组凑第二台。",
                    )
                )
                continue
            together = _co_decks(group_decks, primary_id, cid)
            coverage = together / group_size
            conditional = min(
                together / seen if seen else 0,
                together / primary_seen if primary_seen else 0,
            )
            average = _avg(copies, freq, cid)
            outside_rate = outside(cid)
            if coverage < THRESHOLDS["observed_partner_min_coverage"]:
                if seen / group_size >= 0.4:
                    alternatives.append(
                        _alt(
                            cid,
                            freq,
                            copies,
                            group_size,
                            catalog,
                            names_zh,
                            "low_coverage",
                            f"同场 {together}/{group_size}，低于 {THRESHOLDS['observed_partner_min_coverage']:.0%}。",
                        )
                    )
                continue
            if conditional < THRESHOLDS["observed_partner_min_conditional"]:
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "exclusive_subtype",
                        f"与核心机体同场条件概率 {conditional:.0%}，可能是互斥子体系。",
                    )
                )
                continue
            if average < THRESHOLDS["observed_partner_min_avg_copies"]:
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "low_copies",
                        f"出现时平均只有 {average:.1f} 张，更像点缀而不是核心投入。",
                    )
                )
                continue
            if outside_rate > THRESHOLDS["observed_partner_max_outside_rate"]:
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "generic_splash",
                        f"在本体系之外的卡表里出现率 {outside_rate:.1%}，视为通用外挂，不作为代表。",
                    )
                )
                continue
            corpus_both = _corpus_together(archetype_decks, primary_id, cid)
            if together < THRESHOLDS["observed_partner_min_group_decks"] and not (
                coverage == 1 and corpus_both >= THRESHOLDS["observed_partner_small_group_min_corpus_together"]
            ):
                alternatives.append(
                    _alt(
                        cid,
                        freq,
                        copies,
                        group_size,
                        catalog,
                        names_zh,
                        "small_sample",
                        f"本组只有 {together} 套同场，而且该配对在全部已收录样本里不足 "
                        f"{THRESHOLDS['observed_partner_small_group_min_corpus_together']} 套，不能从一张卡表推广。",
                    )
                )
                continue
            found.append(
                {
                    "cid": cid,
                    "together": together,
                    "coverage": coverage,
                    "avg": average,
                    "level": (catalog.get(cid) or {}).get("level") or 0,
                    "corpus_both": corpus_both,
                    "outside_rate": outside_rate,
                }
            )
        return found

    if primary:
        partners = partner_candidates(primary)
        if partners:
            partners.sort(key=lambda item: (item["coverage"], item["avg"], item["level"], item["cid"]))
            partner = partners[-1]
            cid = partner["cid"]
            reason = (
                f"规则核心机体是 {_display_name(primary, catalog, names_zh)}（{freq[primary]}/{group_size}）。"
                f"{_display_name(cid, catalog, names_zh)} 不在最低张数规则里，但在本组 {partner['together']}/{group_size} 套与核心同时出现，"
                f"平均投入 {partner['avg']:.1f} 张，体系外出现率 {partner['outside_rate']:.1%}。"
                "第二张图取这台同场机体，不拿驾驶员或通用外挂补位。"
            )
            return finish(
                {
                    "mode": "observed_pair",
                    "reason": reason,
                    "cards": [
                        _card_payload(primary, freq, copies, group_size, catalog, names_zh, "rule_core"),
                        _card_payload(cid, freq, copies, group_size, catalog, names_zh, "cooccurring_unit"),
                    ],
                    "co_occurrence": {"decks": partner["together"], "group_size": group_size},
                }
            )
        reason = (
            f"只确认到一台核心机体 {_display_name(primary, catalog, names_zh)}（{freq[primary]}/{group_size}）。"
            "没有另一台不同机体同时满足同场率、投入张数和外挂检验。"
        )
        if any(same_family(primary, cid) for cid in declared if cid != primary):
            reason += "规则中的另一张是同一机体的不同形态，不把它算成第二台。"
        return finish(
            {
                "mode": "single_core",
                "reason": reason,
                "cards": [
                    _card_payload(primary, freq, copies, group_size, catalog, names_zh, "rule_core")
                ],
            }
        )

    # Unknown / ambiguous: do not inherit a defined archetype's pair.
    units = [cid for cid in freq if is_unit(cid)]
    found_pairs = []
    minimum_decks = THRESHOLDS["unconfirmed_min_decks"]
    if group_size >= minimum_decks:
        for left, right in combinations(sorted(units), 2):
            if same_family(left, right):
                continue
            seen_left = freq[left]
            seen_right = freq[right]
            if seen_left / group_size < THRESHOLDS["unconfirmed_min_coverage"]:
                continue
            if seen_right / group_size < THRESHOLDS["unconfirmed_min_coverage"]:
                continue
            if outside(left) > THRESHOLDS["unconfirmed_max_outside_rate"]:
                continue
            if outside(right) > THRESHOLDS["unconfirmed_max_outside_rate"]:
                continue
            if corpus_rate(left) > THRESHOLDS["unconfirmed_max_corpus_rate"]:
                continue
            if corpus_rate(right) > THRESHOLDS["unconfirmed_max_corpus_rate"]:
                continue
            if _avg(copies, freq, left) < THRESHOLDS["unconfirmed_min_avg_copies"]:
                continue
            if _avg(copies, freq, right) < THRESHOLDS["unconfirmed_min_avg_copies"]:
                continue
            together = _co_decks(group_decks, left, right)
            if together < minimum_decks or together / group_size < THRESHOLDS["unconfirmed_min_coverage"]:
                continue
            conditional = min(together / seen_left, together / seen_right)
            if conditional < THRESHOLDS["unconfirmed_min_conditional"]:
                continue
            found_pairs.append((together, _avg(copies, freq, left) + _avg(copies, freq, right), left, right))
    if found_pairs:
        found_pairs.sort()
        together, _avg_sum, left, right = found_pairs[-1]
        reason = (
            f"体系仍未确认。{_display_name(left, catalog, names_zh)} 与 {_display_name(right, catalog, names_zh)} "
            f"在本组 {together}/{group_size} 套同时出现，而且不是跨组通用外挂。这只说明组内常见这两台，不代表已经定名。"
        )
        return finish(
            {
                "mode": "unconfirmed_pair",
                "reason": reason,
                "cards": [
                    _card_payload(left, freq, copies, group_size, catalog, names_zh, "unconfirmed_unit"),
                    _card_payload(right, freq, copies, group_size, catalog, names_zh, "unconfirmed_unit"),
                ],
                "co_occurrence": {"decks": together, "group_size": group_size},
            }
        )

    singles = []
    if group_size >= minimum_decks:
        for cid in units:
            coverage = freq[cid] / group_size
            average = _avg(copies, freq, cid)
            outside_rate = outside(cid)
            if (
                coverage >= THRESHOLDS["unconfirmed_min_coverage"]
                and outside_rate <= THRESHOLDS["unconfirmed_single_max_outside_rate"]
                and average >= THRESHOLDS["unconfirmed_single_min_avg_copies"]
                and corpus_rate(cid) <= THRESHOLDS["unconfirmed_max_corpus_rate"]
            ):
                singles.append((coverage, average, cid))
    if singles:
        singles.sort()
        _coverage, average, cid = singles[-1]
        reason = (
            f"体系未确认。{_display_name(cid, catalog, names_zh)} 在本组 {freq[cid]}/{group_size} 套出现，"
            f"平均 {average:.1f} 张，但没有第二台通过同场检验。不使用扎古、巴巴托斯一类通用机体充数。"
        )
        return finish(
            {
                "mode": "unconfirmed_single",
                "reason": reason,
                "cards": [
                    _card_payload(cid, freq, copies, group_size, catalog, names_zh, "unconfirmed_unit")
                ],
            }
        )

    reason = (
        "体系未确认，组内也没有一对稳定、且不属于通用外挂的机体。"
        "不按颜色凑图，也不用驾驶员补位。"
    )
    return finish({"mode": "unconfirmed_none", "reason": reason})


def _percent(numerator: int, denominator: int):
    if denominator <= 0:
        return None
    from decimal import Decimal, ROUND_HALF_UP

    quant = (Decimal(numerator) * Decimal(100) / Decimal(denominator)).quantize(
        Decimal("0.1"), rounding=ROUND_HALF_UP
    )
    return format(quant, "f")


def _public_deck(record: dict) -> dict:
    payload = {
        "event_id": record["event_id"],
        "strong_event_id": record["strong_event_id"],
        "date": record["date"],
        "store": record["store"] or "店铺未标注",
        "player": record["player"],
        "rank": record["rank"],
        "event_type": record.get("event_type") or "",
        "source": record.get("source") or "",
        "source_url": record.get("source_url") or "",
    }
    if record.get("area"):
        payload["area"] = record["area"]
    if record.get("store_missing"):
        payload["store_missing"] = True
    if record.get("attendance"):
        payload["attendance"] = record["attendance"]
    if record.get("ambiguous"):
        payload["candidate_rules"] = record.get("candidates") or []
    return payload


def _quarantine_public(record: dict) -> dict:
    entry = dict(record["quarantine"])
    entry.update(
        {
            "event_id": record["event_id"],
            "strong_event_id": record["strong_event_id"],
            "date": record["date"],
            "store": record["store"] or entry.get("store") or "",
            "player": record["player"],
            "stored_rank": record["rank"],
            "source_url": record.get("source_url") or entry.get("gcg_stats_url") or "",
            "would_be_archetype": record.get("archetype") or "",
            "chart_included": False,
            "verification": entry.get("verification") or "实际冠亚口径未核实",
        }
    )
    return entry


def _isolated_public(record: dict) -> dict:
    reason = record.get("isolate_reason") or ""
    return {
        "event_id": record.get("event_id") or "",
        "strong_event_id": record.get("strong_event_id") or "",
        "date": record.get("date") or "",
        "store": record.get("store") or "",
        "player": record.get("player") or "",
        "rank": record.get("rank"),
        "source_url": record.get("source_url") or "",
        "reason": reason,
        "reason_zh": ISOLATE_TEXT.get(reason, reason),
        "has_photo": bool(record.get("has_photo")),
        "chart_included": False,
        "verification": "未核实",
    }


def aggregate_view(records: list, ctx: dict, view: dict) -> dict:
    included = [record for record in records if record["status"] == "included"]
    quarantined = [record for record in records if record["status"] == "quarantined"]
    isolated = [record for record in records if record["status"] == "isolated"]
    grouped = defaultdict(list)
    for record in included:
        grouped[record["archetype"]].append(record)

    groups = []
    for name, rows in grouped.items():
        rule = ctx["rules_by_name"].get(name)
        other_cores = set()
        for rule_name, core_ids in ctx["cores_by_rule"].items():
            if rule_name != name:
                other_cores.update(core_ids)
        archetype_decks = ctx["archetype_decks"].get(name) or []
        representative = select_representatives(
            [row["cards"] for row in rows],
            name,
            rule,
            ctx["catalog"],
            ctx["names_zh"],
            ctx["families"],
            other_cores,
            ctx["corpus_freq"],
            ctx["corpus_size"],
            len(archetype_decks),
            ctx["archetype_freq"].get(name) or Counter(),
            archetype_decks,
        )
        champions = sum(1 for row in rows if row["rank"] == 1)
        runners = sum(1 for row in rows if row["rank"] == 2)
        unconfirmed = bool(rows[0]["unconfirmed"])
        group = {
            "name": name,
            "unconfirmed": unconfirmed,
            "ambiguous": bool(rows[0].get("ambiguous")),
            "total": len(rows),
            "champion": champions,
            "runner_up": runners,
            "percent": _percent(len(rows), len(included)),
            "representative": representative,
            "decks": [_public_deck(row) for row in sorted(rows, key=_deck_sort)],
        }
        if rule and not unconfirmed:
            group["rule"] = {
                "color": rule.get("color") or "",
                "minimum_cards": rule["minimum_cards"],
                "representative_card": rule.get("representative_card") or "",
            }
        if rows[0].get("ambiguous"):
            group["candidate_rules"] = rows[0].get("candidates") or []
        groups.append(group)
    groups.sort(key=lambda group: (-group["total"], -group["champion"], group["name"]))

    champions = sum(1 for row in included if row["rank"] == 1)
    runners = sum(1 for row in included if row["rank"] == 2)
    unconfirmed_decks = sum(1 for row in included if row["unconfirmed"])
    event_ids = {row["event_id"] for row in included}
    raw_event_ids = {row["event_id"] for row in records if row.get("event_id")}
    payload = {
        "id": view["id"],
        "kind": view["kind"],
        "title": view.get("title") or "",
        "region": view["region"],
        "start": view["start"],
        "end": view["end"],
        "complete": bool(view.get("complete")),
        "coverage_note": view.get("coverage_note") or "",
        "note": view.get("note") or "",
        "events": len(event_ids),
        "raw_events": len(raw_event_ids),
        "raw_decks": len(included) + len(quarantined) + len(isolated),
        "included_decks": len(included),
        "champions": champions,
        "runners_up": runners,
        "unconfirmed_decks": unconfirmed_decks,
        "quarantined_decks": len(quarantined),
        "isolated_decks": len(isolated),
        "denominator": len(included),
        "group_total_sum": sum(group["total"] for group in groups),
        "groups": groups,
        "quarantine": [_quarantine_public(row) for row in sorted(quarantined, key=_deck_sort)],
        "isolated": [_isolated_public(row) for row in sorted(isolated, key=_deck_sort)],
    }
    payload["sum_matches_denominator"] = payload["group_total_sum"] == payload["included_decks"]
    if not groups:
        payload["chart_empty"] = True
        payload["chart_empty_reason"] = "这一周没有纳入分母的冠亚卡表。"
        if quarantined or isolated:
            payload["chart_empty_reason"] += "隔离条目另列在下面，没有算进套数。"
    else:
        payload["chart_empty"] = False
    return payload


def _deck_sort(record: dict):
    return (
        record.get("date") or "",
        record.get("rank") if isinstance(record.get("rank"), int) else 99,
        record.get("player") or "",
        record.get("event_id") or "",
    )


def _placement_rank(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    return None


def _event_store(event: dict) -> str:
    return str(event.get("store_name") or event.get("event_name") or event.get("store_or_venue") or "").strip()


def collect_records(ctx: dict) -> dict:
    """Return region -> records after dedup, team exclusion, quarantine and isolation."""
    buckets = defaultdict(list)
    excluded_team = []
    before_min = 0
    out_of_scope = 0
    for event in ctx["events"]:
        region = event.get("region_tag") or event.get("region") or event.get("_source_region") or ""
        if is_team_event(event):
            excluded_team.append(
                {
                    "event_id": event.get("id") or "",
                    "date": event.get("date") or "",
                    "region": region,
                    "format": event.get("format") or "",
                    "name": event.get("event_name") or event.get("series_name") or "",
                    "reason": "团队赛不纳入个人冠亚统计",
                }
            )
            continue
        event_date = str(event.get("date") or "")
        if not event_date:
            event["_missing_date"] = True
            buckets[region].append(event)
            continue
        if event_date < MIN_DATE:
            before_min += 1
            continue
        buckets[region].append(event)

    quarantine = ctx["quarantine_index"]
    matched_quarantine = set()
    regions = {}
    duplicate_drops = []
    unknown_cards = set()
    for region, events in buckets.items():
        grouped = defaultdict(list)
        records = []
        for event in events:
            if event.get("_missing_date") or not event.get("id"):
                reason = "missing_date" if event.get("_missing_date") else "missing_event_id"
                for placement in event.get("placements") or []:
                    rank = _placement_rank(placement.get("rank"))
                    if rank not in (1, 2):
                        if rank is not None:
                            out_of_scope += 1
                        elif placement.get("rank") not in (None, ""):
                            records.append(_isolated_record(event, placement, "", "invalid_rank"))
                        continue
                    records.append(_isolated_record(event, placement, strong_event_id(str(event.get("id") or "")), reason))
                continue
            grouped[strong_event_id(str(event.get("id") or ""))].append(event)
        for sid, copies in grouped.items():
            dates = {str(event.get("date") or "") for event in copies}
            if len(dates) > 1 or "" in dates:
                for event in copies:
                    for placement in event.get("placements") or []:
                        rank = _placement_rank(placement.get("rank"))
                        if rank not in (1, 2):
                            if rank is not None:
                                out_of_scope += 1
                            continue
                        records.append(_isolated_record(event, placement, sid, "date_conflict"))
                continue
            merged = {}
            for event in copies:
                for placement in event.get("placements") or []:
                    rank = _placement_rank(placement.get("rank"))
                    if rank is None:
                        records.append(_isolated_record(event, placement, sid, "invalid_rank"))
                        continue
                    if rank not in (1, 2):
                        out_of_scope += 1
                        continue
                    player = str(placement.get("player_name") or "").strip()
                    key = (rank, player)
                    current = merged.get(key)
                    if current is None:
                        merged[key] = (event, placement)
                        continue
                    old_cards = card_counts(current[1].get("cards"))
                    new_cards = card_counts(placement.get("cards"))
                    drop_event, drop_placement = (event, placement)
                    if sum(new_cards.values()) > sum(old_cards.values()):
                        drop_event, drop_placement = current
                        merged[key] = (event, placement)
                    duplicate_drops.append(
                        {
                            "strong_event_id": sid,
                            "event_id": drop_event.get("id") or "",
                            "rank": rank,
                            "player": player,
                            "reason": "同一赛事、名次和选手重复，只保留卡表更完整的一条",
                        }
                    )
            for (rank, player), (event, placement) in sorted(merged.items()):
                counts = card_counts(placement.get("cards"))
                for cid in counts:
                    if cid not in ctx["catalog"]:
                        unknown_cards.add(cid)
                record = _base_record(event, placement, sid, rank, player, counts)
                if not event.get("id"):
                    record["status"] = "isolated"
                    record["isolate_reason"] = "missing_event_id"
                elif not player:
                    record["status"] = "isolated"
                    record["isolate_reason"] = "missing_player"
                elif not counts:
                    record["status"] = "isolated"
                    record["isolate_reason"] = "missing_card_list"
                else:
                    classified = classify_deck(counts, placement.get("deck_type") or "", ctx["rules"])
                    record["archetype"] = classified["name"]
                    record["unconfirmed"] = classified["unconfirmed"]
                    record["ambiguous"] = classified["ambiguous"]
                    record["candidates"] = classified["candidates"]
                    qkey = (sid, player)
                    if qkey in quarantine:
                        record["status"] = "quarantined"
                        record["quarantine"] = quarantine[qkey]
                        matched_quarantine.add(qkey)
                    else:
                        record["status"] = "included"
                records.append(record)
        regions[region] = records

    ctx["excluded_team"] = excluded_team
    ctx["before_min_date"] = before_min
    ctx["out_of_scope_placements"] = out_of_scope
    ctx["duplicate_drops"] = duplicate_drops
    ctx["unknown_card_ids"] = sorted(unknown_cards)
    ctx["quarantine_unmatched"] = [
        {"strong_event_id": sid, "player": player}
        for sid, player in sorted(quarantine)
        if (sid, player) not in matched_quarantine
    ]
    return regions


def _base_record(event, placement, sid, rank, player, counts) -> dict:
    store = _event_store(event)
    return {
        "event_id": event.get("id") or "",
        "strong_event_id": sid,
        "date": str(event.get("date") or ""),
        "store": store,
        "store_missing": not bool(store),
        "player": player,
        "rank": rank,
        "event_type": event.get("event_type") or "",
        "source": event.get("source") or "",
        "source_url": event.get("source_url") or "",
        "area": event.get("area") or "",
        "cards": counts,
        "has_photo": bool(placement.get("deck_photo") or placement.get("photo")),
        "attendance": confirmed_attendance(event),
        "status": "",
        "archetype": "",
        "unconfirmed": False,
        "ambiguous": False,
        "candidates": [],
    }


def _isolated_record(event, placement, sid, reason) -> dict:
    rank = _placement_rank(placement.get("rank"))
    player = str(placement.get("player_name") or "").strip()
    record = _base_record(event, placement, sid, rank if rank is not None else None, player, card_counts(placement.get("cards")))
    record["status"] = "isolated"
    record["isolate_reason"] = reason
    if record["rank"] is None:
        record["rank"] = None
    return record


def _index_corpus(records: list) -> dict:
    included = [record for record in records if record["status"] == "included"]
    corpus_freq = Counter()
    archetype_decks = defaultdict(list)
    archetype_freq = defaultdict(Counter)
    for record in included:
        archetype_decks[record["archetype"]].append(record["cards"])
        for cid in record["cards"]:
            corpus_freq[cid] += 1
            archetype_freq[record["archetype"]][cid] += 1
    return {
        "corpus_freq": corpus_freq,
        "corpus_size": len(included),
        "archetype_decks": archetype_decks,
        "archetype_freq": archetype_freq,
    }


def _week_views(region: str, records: list, data_as_of: str) -> list:
    dates = [record["date"] for record in records if record.get("date")]
    if not dates:
        return []
    first = monday_of(MIN_DATE)
    last = monday_of(max(dates))
    views = []
    cursor = first
    while cursor <= last:
        start = iso(cursor)
        end = iso(cursor + timedelta(days=6))
        if start < MIN_DATE:
            complete = False
            note = f"收录自 {MIN_DATE} 起，本周一至起始日前没有数据，不是完整周。"
        elif data_as_of and end <= data_as_of:
            complete = True
            note = "周一至周日都在收录范围内，而且周日不晚于当前全部地区数据里的最晚赛事日。"
        else:
            complete = False
            note = f"全部地区数据最晚到 {data_as_of or '未知'}，这一周还没有过完，不作为默认周。"
        views.append(
            {
                "id": f"week:{start}",
                "kind": "week",
                "region": region,
                "start": start,
                "end": end,
                "complete": complete,
                "coverage_note": note,
                "title": f"{start} 至 {end}",
            }
        )
        cursor += timedelta(days=7)
    return views


def _slice(records: list, start: str, end: str) -> list:
    return [record for record in records if start <= (record.get("date") or "") <= end]


def build_region(region: str, records: list, ctx: dict) -> dict:
    indexed = _index_corpus(records)
    local = dict(ctx)
    local.update(indexed)
    weeks = []
    for view in _week_views(region, records, ctx.get("data_as_of") or ""):
        weeks.append(aggregate_view(_slice(records, view["start"], view["end"]), local, view))
    windows = []
    for window in ctx["special_windows"]:
        if window.get("region") != region:
            continue
        view = {
            "id": window["id"],
            "kind": "special",
            "region": region,
            "start": window["start"],
            "end": window["end"],
            "complete": False,
            "title": window.get("title") or window["id"],
            "note": window.get("note") or "",
            "coverage_note": "特别窗口，不是周一至周日的完整周。",
        }
        windows.append(aggregate_view(_slice(records, view["start"], view["end"]), local, view))
    complete_ids = [week["id"] for week in weeks if week["complete"]]
    default_view = complete_ids[-1] if complete_ids else (weeks[-1]["id"] if weeks else "")
    included = [record for record in records if record["status"] == "included"]
    undated = [_isolated_public(record) for record in records if record["status"] == "isolated" and not record.get("date")]
    return {
        "region": region,
        "default_view": default_view,
        "min_date": MIN_DATE,
        "max_date": max((record["date"] for record in records if record.get("date")), default=""),
        "included_decks": len(included),
        "included_events": len({record["event_id"] for record in included}),
        "undated_isolated": undated,
        "weeks": weeks,
        "special_windows": windows,
    }


def load_context(root: Path | None = None) -> dict:
    root = root or ROOT
    rules = load_json(root / "scripts/data/archetype_rules.json")
    catalog_doc = load_json(root / "scripts/data/card_catalog.json")
    names_doc = load_json(root / "scripts/data/card_names_zh.json")
    families_doc = load_json(root / "scripts/data/unit_families.json")
    quarantine_doc = load_json(root / "scripts/data/rank_quarantine.json")
    windows = load_json(root / "scripts/data/special_windows.json")
    catalog = catalog_doc["cards"]
    names_zh = names_doc.get("names") or {}
    families = _family_index(families_doc)
    rules_by_name = {rule["name"]: rule for rule in rules}
    cores_by_rule = {}
    for rule in rules:
        cores_by_rule[rule["name"]] = [
            cid
            for cid in rule["minimum_cards"]
            if (catalog.get(cid) or {}).get("card_type") == "UNIT"
        ]
    quarantine_index = {}
    for entry in quarantine_doc.get("entries") or []:
        quarantine_index[(entry["strong_event_id"], entry["player"].strip())] = entry
    events = []
    source_counts = {}
    for relative, region in SOURCES:
        path = root / relative
        payload = load_json(path)
        rows = payload if isinstance(payload, list) else []
        decks = 0
        for event in rows:
            event = dict(event)
            event["_source_region"] = region
            event["_source_file"] = relative
            events.append(event)
            decks += len(event.get("placements") or [])
        source_counts[relative] = {"events": len(rows), "placements": decks, "region": region}
    return {
        "root": root,
        "rules": rules,
        "rules_by_name": rules_by_name,
        "cores_by_rule": cores_by_rule,
        "catalog": catalog,
        "catalog_meta": catalog_doc.get("meta") or {},
        "names_zh": names_zh,
        "families": families,
        "quarantine_doc": quarantine_doc,
        "quarantine_index": quarantine_index,
        "special_windows": windows,
        "events": events,
        "source_counts": source_counts,
    }


def _git_commit(root: Path) -> str:
    head = root / ".git" / "HEAD"
    if not head.exists():
        return ""
    text = head.read_text(encoding="utf-8").strip()
    if text.startswith("ref:"):
        ref = text.split(" ", 1)[1].strip()
        ref_path = root / ".git" / ref
        if ref_path.exists():
            return ref_path.read_text(encoding="utf-8").strip()
        return ""
    return text


def build_report(root: Path | None = None) -> dict:
    root = root or ROOT
    ctx = load_context(root)
    by_region = collect_records(ctx)
    dated = [
        record["date"]
        for rows in by_region.values()
        for record in rows
        if record.get("date")
    ]
    ctx["data_as_of"] = max(dated) if dated else ""
    order = ["日本", "中国", "欧美"]
    regions = {}
    for region in order:
        regions[region] = build_region(region, by_region.get(region) or [], ctx)
    now = datetime.now(CST).replace(microsecond=0)
    fingerprints = {}
    for relative, _region in SOURCES:
        fingerprints[relative] = sha256_file(root / relative)
    for name in (
        "archetype_rules.json",
        "card_catalog.json",
        "card_names_zh.json",
        "unit_families.json",
        "rank_quarantine.json",
        "special_windows.json",
    ):
        fingerprints[f"scripts/data/{name}"] = sha256_file(root / "scripts/data" / name)
    japan_file = ctx["source_counts"].get("data/japan-events.json") or {}
    report = {
        "meta": {
            "generator": "scripts/build_weekly_stats.py",
            "generated_at": now.isoformat(),
            "generated_at_label": now.strftime("%Y-%m-%d %H:%M") + " 北京时间",
            "data_git_commit": _git_commit(root),
            "audit_baseline_commit": AUDIT_COMMIT,
            "policy": ctx["quarantine_doc"].get("policy") or "",
            "min_date": MIN_DATE,
            "default_region": "日本",
            "card_image_template": CARD_IMAGE_TEMPLATE,
            "thresholds": THRESHOLDS,
            "source_fingerprints": fingerprints,
            "source_counts": ctx["source_counts"],
            "japan_events_file": japan_file,
            "baseline_note": (
                f"审计基准 {AUDIT_COMMIT} 的 data/japan-events.json 是日本店赛样本。"
                "每周统计另含站内已公开的个人赛民间 CS 与官方 1on1 冠亚，排除团队赛。"
                "基准文件的场次数用来确认每日刷新后的店赛文件仍被读入，而不是被另一套数字替换。"
            ),
            "attendance_policy": "只有来源原文写出实到/確認比例时才记录人数。斜线后的定員或容量不采用。没有这句话的 players 字段一律不显示。",
            "not_claims": [
                "按已收录冠亚套数排序，不是强度分层",
                "上位样本不是全体参赛使用率",
                "代表图不是随机第一张，也不是按颜色各挑一张",
            ],
            "catalog_meta": ctx["catalog_meta"],
            "excluded_team_events": ctx.get("excluded_team") or [],
            "before_min_date_events": ctx.get("before_min_date") or 0,
            "out_of_scope_non_finalist_placements": ctx.get("out_of_scope_placements") or 0,
            "duplicate_drops": ctx.get("duplicate_drops") or [],
            "unknown_card_ids": ctx.get("unknown_card_ids") or [],
            "quarantine_unmatched": ctx.get("quarantine_unmatched") or [],
            "generation_log": [],
        },
        "regions": regions,
    }
    return report


def fingerprint(report: dict) -> str:
    clone = json.loads(json.dumps(report, ensure_ascii=False, sort_keys=True))
    meta = clone.get("meta") or {}
    for key in VOLATILE_META_KEYS:
        meta.pop(key, None)
    raw = json.dumps(clone, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def dump_report(report: dict) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def slim_record(region: str, record: dict) -> dict:
    payload = {
        "region": region,
        "date": record.get("date") or "",
        "event_id": record.get("event_id") or "",
        "strong_event_id": record.get("strong_event_id") or "",
        "rank": record.get("rank"),
        "player": record.get("player") or "",
        "store": record.get("store") or "",
        "event_type": record.get("event_type") or "",
        "source_url": record.get("source_url") or "",
        "status": record.get("status") or "",
        "archetype": record.get("archetype") or "",
        "unconfirmed": bool(record.get("unconfirmed")),
    }
    if record.get("isolate_reason"):
        reason = record["isolate_reason"]
        payload["isolate_reason"] = reason
        payload["reason_zh"] = ISOLATE_TEXT.get(reason, reason)
    quarantine = record.get("quarantine") or {}
    if quarantine:
        payload["quarantine_reason"] = quarantine.get("reason") or ""
        payload["verification"] = quarantine.get("verification") or ""
        for key in ("official_url", "gcg_stats_url", "secondary_url"):
            if quarantine.get(key):
                payload[key] = quarantine[key]
    return payload


def representative_catalog(region_blob: dict) -> dict:
    """Largest published slice's representative cards, so a custom range can still draw the pie."""
    best = {}
    views = list(region_blob.get("weeks") or []) + list(region_blob.get("special_windows") or [])
    for view in views:
        for group in view.get("groups") or []:
            name = group["name"]
            current = best.get(name)
            if current is not None and current["total"] >= group["total"]:
                continue
            cards = []
            for card in ((group.get("representative") or {}).get("cards") or []):
                card_id = card.get("card_id") or ""
                if card_id:
                    cards.append({"card_id": card_id, "name_zh": card.get("name_zh") or ""})
            best[name] = {"total": group["total"], "cards": cards}
    return {name: {"cards": item["cards"]} for name, item in best.items()}


def build_records_document(report: dict, root: Path | None = None) -> dict:
    root = root or ROOT
    ctx = load_context(root)
    by_region = collect_records(ctx)
    regions = {}
    for name, blob in (report.get("regions") or {}).items():
        rows = [slim_record(name, record) for record in by_region.get(name) or []]
        rows.sort(
            key=lambda row: (
                row["date"],
                row["event_id"],
                row["rank"] if isinstance(row["rank"], int) else 99,
                row["player"],
                row["status"],
            )
        )
        regions[name] = {
            "min_date": blob.get("min_date") or "",
            "max_date": blob.get("max_date") or "",
            "representatives": representative_catalog(blob),
            "records": rows,
        }
    meta = report.get("meta") or {}
    return {
        "meta": {
            "generator": "scripts/build_weekly_stats.py",
            "min_date": meta.get("min_date") or MIN_DATE,
            "source_fingerprints": meta.get("source_fingerprints") or {},
            "japan_events_file": meta.get("japan_events_file") or {},
            "source_counts": meta.get("source_counts") or {},
        },
        "regions": regions,
    }


def records_fingerprint(document: dict) -> str:
    raw = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def write_records(document: dict, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return "unchanged"
    path.write_text(text, encoding="utf-8")
    return "wrote"


def dates_inclusive(start: str, end: str) -> list[str]:
    if not start or not end or start > end:
        return []
    cursor = datetime.strptime(start, "%Y-%m-%d").date()
    last = datetime.strptime(end, "%Y-%m-%d").date()
    days = []
    while cursor <= last:
        days.append(iso(cursor))
        cursor += timedelta(days=1)
    return days


def summarize_records(records: list, dates: set[str]) -> dict:
    """Count a date set with the same inclusion rules as aggregate_view, without redrawing representatives."""
    chosen = []
    seen = set()
    for record in records:
        day = record.get("date") or ""
        if day not in dates:
            continue
        key = (record.get("strong_event_id") or "", record.get("player") or "", record.get("rank"))
        if key in seen:
            continue
        seen.add(key)
        chosen.append(record)
    included = [row for row in chosen if row.get("status") == "included"]
    quarantined = [row for row in chosen if row.get("status") == "quarantined"]
    isolated = [row for row in chosen if row.get("status") == "isolated"]
    grouped = defaultdict(list)
    for row in included:
        grouped[row.get("archetype") or ""].append(row)
    groups = []
    for name, rows in grouped.items():
        groups.append(
            {
                "name": name,
                "total": len(rows),
                "champion": sum(1 for row in rows if row.get("rank") == 1),
                "runner_up": sum(1 for row in rows if row.get("rank") == 2),
                "unconfirmed": bool(rows[0].get("unconfirmed")),
                "percent": _percent(len(rows), len(included)),
            }
        )
    groups.sort(key=lambda group: (-group["total"], -group["champion"], group["name"]))
    return {
        "events": len({row.get("event_id") or "" for row in included if row.get("event_id")}),
        "raw_events": len({row.get("event_id") or "" for row in chosen if row.get("event_id")}),
        "raw_decks": len(chosen),
        "included_decks": len(included),
        "champions": sum(1 for row in included if row.get("rank") == 1),
        "runners_up": sum(1 for row in included if row.get("rank") == 2),
        "unconfirmed_decks": sum(1 for row in included if row.get("unconfirmed")),
        "quarantined_decks": len(quarantined),
        "isolated_decks": len(isolated),
        "groups": groups,
    }


def write_report(report: dict, path: Path) -> str:
    """Write the report. A second run with the same inputs keeps the previous file byte-for-byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    new_fp = fingerprint(report)
    if path.exists():
        previous = load_json(path)
        if fingerprint(previous) == new_fp:
            return "unchanged"
        log = list((previous.get("meta") or {}).get("generation_log") or [])
        log.append(
            {
                "generated_at": (previous.get("meta") or {}).get("generated_at") or "",
                "fingerprint": fingerprint(previous),
                "japan_default_view": ((previous.get("regions") or {}).get("日本") or {}).get("default_view") or "",
            }
        )
        report = json.loads(json.dumps(report))
        report["meta"]["generation_log"] = log[-30:]
    path.write_text(dump_report(report), encoding="utf-8")
    return "wrote"
