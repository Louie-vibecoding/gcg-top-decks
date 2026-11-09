#!/usr/bin/env python3
"""Keep weekly representative card images next to the page.

The weekly page only needs the units chosen as representatives. Missing files
are read from the public card-image address already used by the event list.
--check does not download.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = "https://gcg-stats.com/images/cards/{CARD_ID}.webp"


def representative_ids(report: dict) -> list[str]:
    found = set()
    for pack in (report.get("regions") or {}).values():
        views = list(pack.get("weeks") or []) + list(pack.get("special_windows") or [])
        for view in views:
            for group in view.get("groups") or []:
                cards = ((group.get("representative") or {}).get("cards")) or []
                for card in cards:
                    card_id = card.get("card_id") or ""
                    if card_id:
                        found.add(card_id)
    return sorted(found)


def is_webp(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 32:
        return False
    head = path.read_bytes()[:12]
    return head[:4] == b"RIFF" and head[8:12] == b"WEBP"


def sync_cards(root: Path, report: dict, download: bool) -> list[str]:
    folder = root / "weekly-cards"
    folder.mkdir(exist_ok=True)
    template = ((report.get("meta") or {}).get("card_image_template")) or TEMPLATE
    missing = []
    for card_id in representative_ids(report):
        path = folder / f"{card_id}.webp"
        if is_webp(path):
            continue
        if download:
            url = template.replace("{CARD_ID}", card_id)
            request = urllib.request.Request(url, headers={"User-Agent": "gcg-top-decks-weekly"})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    data = response.read()
            except Exception:
                data = b""
            if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
                path.write_bytes(data)
        if not is_webp(path):
            missing.append(card_id)
    return missing


def main() -> int:
    parser = argparse.ArgumentParser(description="Download missing weekly representative card images.")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--report", default="data/weekly-top.json")
    args = parser.parse_args()
    report = json.loads((ROOT / args.report).read_text(encoding="utf-8"))
    missing = sync_cards(ROOT, report, download=not args.check)
    if missing:
        print("missing weekly card images: " + ", ".join(missing), file=sys.stderr)
        return 1
    print(f"weekly-cards ok ({len(representative_ids(report))} representative units)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
