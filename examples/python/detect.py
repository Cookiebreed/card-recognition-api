#!/usr/bin/env python3
"""Detect the trading cards in one photo with the NeoSatoshi card recognition API.

Usage:
    python3 detect.py <image.jpg|image.png> [tcg] [--json] [--review]

    tcg:      pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited, digimon
    --json:   also print the full JSON response
    --review: for every card with review.needed, ask for the set number printed on the card and
              correct the card when it differs (correction search + correction, both free)

Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).
Standard library only (Python 3.8+).
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi"
CARDS_API = "https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi"
DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274"
TCGS = ("pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon")
RETRY_STATUSES = (429, 502, 503, 504)


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(f"HTTP {status} {code or ''}: {message or ''}".strip())
        self.status = status
        self.code = code


def call(method, url, body=None, api_key=None, timeout=120, retries=0):
    """One API call. With retries > 0: 429 after Retry-After, 502/503/504 with backoff. Other errors raise ApiError."""
    headers = {
        "Authorization": f"Bearer {api_key or os.environ.get('NEOSATOSHI_API_KEY') or DEMO_KEY}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {"message": raw[:300].decode("utf-8", "replace")}
            wait = int(err.headers.get("Retry-After") or 2 ** (attempt + 1))
            if err.code not in RETRY_STATUSES or attempt == retries or wait > 120:
                raise ApiError(err.code, payload.get("error"), payload.get("message")) from None
            time.sleep(wait)


def detect(image_path, tcg="pokemon", api_key=None, timeout=120):
    """Send one image file and return the parsed JSON response.

    Every detection that answers 200 is charged: do not send the same photo again to be sure.
    """
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("ascii")
    return call("POST", ENDPOINT, {"image": image_b64, "tcg": tcg}, api_key=api_key, timeout=timeout)


def correction_search(result, card, number=None):
    """Free correction search, built from the card's review.search (plus the number read on the photo)."""
    body = {"request_id": result["correction"]["request_id"], **card["review"]["search"]}
    if number:
        body["number"] = number
    return call("POST", f"{CARDS_API}/search", body, retries=3)["results"]


def correct(result, card, card_id, **version):
    """Free correction. Pokémon version: cardmarket_id=<possible_variants id> or reverse_holo=True."""
    body = {"request_id": result["correction"]["request_id"], "card_index": card["card_index"], "card_id": card_id, **version}
    return call("POST", f"{CARDS_API}/corrections", body, retries=3)["card"]


def review_cards(result):
    """Accept cards with review.needed false; ask a person for the set number of the others and correct them."""
    out = []
    for card in result.get("cards", []):
        review = card.get("review") or {}
        if not review.get("needed"):
            out.append(card)
            continue
        number_now = (card.get("set") or {}).get("number")
        print(f"Card {card.get('card_index')}: {card.get('name')} #{number_now} needs review ({', '.join(review.get('reasons', []))})")
        if not review.get("search") or not result.get("correction"):
            print("  cannot be corrected here (card back, football or no correction window)")
            out.append(card)
            continue
        number = input("  Set number printed on the card (Enter keeps the match): ").strip()
        if not number or number == number_now:
            out.append(card)
            continue
        # An alternative with that number, else the free correction search. Never pick by score alone.
        match = next((a for a in card.get("alternatives") or [] if a.get("number") == number and a.get("card_id")), None)
        if match is None:
            found = correction_search(result, card, number)
            if len(found) == 1:
                match = found[0]
            else:
                print(f"  {len(found)} cards match, pick one by hand: " + ", ".join(f"{c['card_id']} ({c['set']['name']})" for c in found))
        if match:
            card = correct(result, card, match["card_id"])
            print(f"  corrected to {card.get('card_id')}")
        out.append(card)
    return out


def summarize_card(i, card):
    s = card.get("set") or {}
    cm = (card.get("prices") or {}).get("cardmarket") or {}
    review = card.get("review") or {}
    parts = [
        f"{i}. {card.get('full_name') or card.get('name')}",
        f"{s.get('name') or '?'} {s.get('ptcgo_code') or s.get('code') or ''} #{s.get('number') or '?'}".replace("  ", " "),
        card.get("rarity") or "?",
        card.get("language") or "?",
        f"Cardmarket {card.get('cardmarket_id') or 'n/a'}",
        f"trend {cm.get('trend') if cm.get('trend') is not None else 'n/a'} EUR"
        + (f" ({card['price_basis']})" if card.get("price_basis") else ""),
        f"confidence {card.get('confidence')}",
        "review: " + (", ".join(review.get("reasons", [])) if review.get("needed") else "no"),
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
        cards = review_cards(data) if "--review" in argv else data.get("cards", [])
    except ApiError as e:
        print(e, file=sys.stderr)
        return 1

    print(f"Detected {data.get('count', 0)} card(s)")
    for i, card in enumerate(cards, 1):
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
