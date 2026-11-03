#!/usr/bin/env python3
"""Detect the trading cards in one photo with the NeoSatoshi card recognition API.

Usage:
    python3 detect.py <image.jpg|image.png> [tcg] [--json]

    tcg:    pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited, digimon
    --json: also print the full JSON response

Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).
Only dependency: requests (pip install requests).
"""

import base64
import json
import os
import sys

import requests

ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi"
DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274"
TCGS = ("pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon")


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(f"HTTP {status} {code or ''}: {message or ''}".strip())
        self.status = status
        self.code = code


def detect(image_path, tcg="pokemon", api_key=None, timeout=120):
    """Send one image file and return the parsed JSON response."""
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("ascii")
    resp = requests.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {api_key or os.environ.get('NEOSATOSHI_API_KEY') or DEMO_KEY}"},
        json={"image": image_b64, "tcg": tcg},
        timeout=timeout,
    )
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code != 200:
        raise ApiError(resp.status_code, data.get("error"), data.get("message") or resp.text[:300])
    return data


def summarize_card(i, card):
    s = card.get("set") or {}
    cm = (card.get("prices") or {}).get("cardmarket") or {}
    parts = [
        f"{i}. {card.get('full_name') or card.get('name')}",
        f"{s.get('name') or '?'} {s.get('ptcgo_code') or s.get('code') or ''} #{s.get('number') or '?'}".replace("  ", " "),
        card.get("rarity") or "?",
        card.get("language") or "?",
        f"Cardmarket {card.get('cardmarket_id') or 'n/a'}",
        f"trend {cm.get('trend') if cm.get('trend') is not None else 'n/a'} EUR",
        f"confidence {card.get('confidence')}",
    ]
    return " | ".join(parts)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    show_json = "--json" in argv
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    image_path = args[0]
    tcg = args[1] if len(args) > 1 else "pokemon"
    if tcg not in TCGS:
        print(f"tcg must be one of {', '.join(TCGS)}", file=sys.stderr)
        return 2

    try:
        data = detect(image_path, tcg)
    except ApiError as e:
        print(e, file=sys.stderr)
        return 1

    print(f"Detected {data.get('count', 0)} card(s)")
    for i, card in enumerate(data.get("cards", []), 1):
        print(summarize_card(i, card))
    if data.get("demo"):
        print(f"Demo key: {data['demo'].get('remaining_today')} of {data['demo'].get('limit_per_day')} left today")
    elif data.get("credits"):
        print(f"Credits remaining: {data['credits'].get('remaining')}")
    if show_json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
