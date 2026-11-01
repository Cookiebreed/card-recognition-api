#!/usr/bin/env python3
"""Print each card as soon as it is recognised (Server-Sent Events).

Usage:
    python3 stream.py <image_url> [tcg]

    image_url: public https link to a JPEG or PNG
    tcg:       pokemon (default), onepiece, lorcana, yugioh, magic

Streaming helps with Pokémon binder pages. The other games have one card per
photo, so there you get progress events, not a faster result.

Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).
Only dependency: requests (pip install requests).
"""

import json
import os
import sys

import requests

ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi"
DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274"


def stream_cards(image_url, tcg="pokemon"):
    """Print each card as it arrives and return the full result."""
    res = requests.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {os.environ.get('NEOSATOSHI_API_KEY') or DEMO_KEY}"},
        json={"image_url": image_url, "tcg": tcg, "stream": True},
        stream=True,
        timeout=(10, 120),  # connect, then the longest gap between two reads
    )
    # Errors before the detection starts are plain JSON, as without streaming.
    if not res.headers.get("Content-Type", "").startswith("text/event-stream"):
        raise RuntimeError(f"HTTP {res.status_code}: {res.text[:300]}")

    event = None
    for line in res.iter_lines(decode_unicode=True):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
            if event == "progress":
                print("stage:", data["stage"])
            elif event == "card":
                card = data["card"]
                print(f'{data["index"] + 1}. {card.get("full_name") or card["name"]} | {card["set"]["name"]} #{card["set"]["number"]}')
            elif event == "done":
                return data  # the same body as the normal JSON response
            elif event == "error":
                raise RuntimeError(f'{data["status"]} {data["error"]}: {data["message"]}')
    # No final event: the outcome is unknown and cards may be charged. Do not resend automatically.
    raise RuntimeError("The stream ended without a result.")


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        result = stream_cards(argv[0], argv[1] if len(argv) > 1 else "pokemon")
    except (RuntimeError, requests.RequestException) as e:
        print(e, file=sys.stderr)
        return 1
    print(f'Done: {result["count"]} card(s)')
    for warning in result.get("warnings", []):
        print("Warning:", warning["message"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
