#!/usr/bin/env python3
"""Recognize every JPEG/PNG in a folder and write one CSV row per detected card.

Usage:
    python3 batch_to_csv.py <folder> [tcg] [--out cards.csv]

Columns: file, name, set, number, rarity, language, cardmarket_id, cardmarket_trend_eur

Uses NEOSATOSHI_API_KEY, or the public demo key (only 10 detections per day per network,
so use your own key for real batches). Images run one after another; each call is synchronous.
Standard library only. detect.py must sit next to this file.
"""

import csv
import os
import sys
import time

from detect import DEMO_KEY, TCGS, ApiError, detect

COLUMNS = ["file", "name", "set", "number", "rarity", "language", "cardmarket_id", "cardmarket_trend_eur"]
RETRY_STATUSES = {502, 504}  # backend step failed / detection timeout: worth one retry


def detect_with_retry(path, tcg):
    try:
        return detect(path, tcg)
    except ApiError as e:
        if e.status not in RETRY_STATUSES:
            raise
        time.sleep(5)
        return detect(path, tcg)


def main(argv):
    out = "cards.csv"
    if "--out" in argv:
        i = argv.index("--out")
        out = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    folder = argv[0]
    tcg = argv[1] if len(argv) > 1 else "pokemon"
    if tcg not in TCGS:
        print(f"tcg must be one of {', '.join(TCGS)}", file=sys.stderr)
        return 2
    if (os.environ.get("NEOSATOSHI_API_KEY") or DEMO_KEY) == DEMO_KEY:
        print("Using the public demo key: 10 detections per day per network.", file=sys.stderr)

    files = sorted(
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png")) and os.path.isfile(os.path.join(folder, f))
    )
    rows = 0
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(COLUMNS)
        for name in files:
            path = os.path.join(folder, name)
            try:
                data = detect_with_retry(path, tcg)
            except ApiError as e:
                print(f"{name}: {e}", file=sys.stderr)
                if e.status in (401, 402, 429):  # bad key, no credits, or limit reached: stop
                    break
                continue  # 422 no_card_detected (not charged) and other per-image errors
            for card in data.get("cards", []):
                s = card.get("set") or {}
                trend = ((card.get("prices") or {}).get("cardmarket") or {}).get("trend")
                writer.writerow([
                    name,
                    card.get("full_name") or card.get("name"),
                    s.get("name"),
                    s.get("number"),
                    card.get("rarity"),
                    card.get("language"),
                    card.get("cardmarket_id"),
                    "" if trend is None else trend,
                ])
                rows += 1
            print(f"{name}: {data.get('count', 0)} card(s)", file=sys.stderr)
    print(f"Wrote {rows} row(s) to {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
