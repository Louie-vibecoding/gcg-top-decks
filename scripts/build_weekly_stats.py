#!/usr/bin/env python3
"""Idempotent weekly top-cut rebuild.

    python3 scripts/build_weekly_stats.py
    python3 scripts/build_weekly_stats.py --check

Repeat runs do not append decks. --check exits nonzero when data/weekly-top.json
or data/weekly-records.json does not match the current event files, rules,
catalog, or quarantine list. Generated timestamps are ignored by --check so a
clean tree stays clean.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from sync_weekly_cards import sync_cards
from weekly_stats import (
    ROOT as STATS_ROOT,
    build_records_document,
    build_report,
    fingerprint,
    load_json,
    records_fingerprint,
    write_records,
    write_report,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild data/weekly-top.json from public event files.")
    parser.add_argument("--check", action="store_true", help="Exit 1 if the committed report is stale.")
    parser.add_argument("--out", default="data/weekly-top.json")
    parser.add_argument("--records", default="data/weekly-records.json")
    args = parser.parse_args()
    path = (STATS_ROOT / args.out).resolve()
    records_path = (STATS_ROOT / args.records).resolve()
    report = build_report(STATS_ROOT)
    records = build_records_document(report, STATS_ROOT)
    if args.check:
        if not path.exists():
            print(f"missing {path}", file=sys.stderr)
            return 1
        current = load_json(path)
        if fingerprint(current) != fingerprint(report):
            print("weekly-top.json is stale; run python3 scripts/build_weekly_stats.py", file=sys.stderr)
            return 1
        if not records_path.exists():
            print(f"missing {records_path}", file=sys.stderr)
            return 1
        current_records = load_json(records_path)
        if records_fingerprint(current_records) != records_fingerprint(records):
            print("weekly-records.json is stale; run python3 scripts/build_weekly_stats.py", file=sys.stderr)
            return 1
        missing = sync_cards(STATS_ROOT, current, download=False)
        if missing:
            print("missing weekly card images: " + ", ".join(missing), file=sys.stderr)
            return 1
        print("weekly-top.json matches current inputs")
        return 0
    status = write_report(report, path)
    records_status = write_records(records, records_path)
    missing = sync_cards(STATS_ROOT, report, download=True)
    if missing:
        print("missing weekly card images: " + ", ".join(missing), file=sys.stderr)
        return 1
    japan = report["regions"]["日本"]
    print(
        f"{status} {path} fingerprint={fingerprint(report)[:12]} "
        f"records={records_status} japan_default={japan['default_view']} included_decks={japan['included_decks']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
