#!/usr/bin/env bash
# Detect the trading cards in one photo with the NeoSatoshi card recognition API.
#
# Usage: ./detect.sh <image.jpg|image.png> [tcg] [--raw]
#   tcg:   pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited
#   --raw: print the full JSON response instead of the summary
#
# Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).
# Prints a per-card summary when jq is installed, otherwise the raw JSON.
set -euo pipefail

ENDPOINT="https://europe-west1-neosatoshi.cloudfunctions.net/detectApi"
DEMO_KEY="nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274"
API_KEY="${NEOSATOSHI_API_KEY:-$DEMO_KEY}"

IMAGE="" TCG="pokemon" RAW=0
for arg in "$@"; do
  case "$arg" in
    --raw) RAW=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) if [ -z "$IMAGE" ]; then IMAGE="$arg"; else TCG="$arg"; fi ;;
  esac
done
[ -n "$IMAGE" ] || { echo "Usage: $0 <image.jpg|image.png> [tcg] [--raw]" >&2; exit 2; }
[ -f "$IMAGE" ] || { echo "Not a file: $IMAGE" >&2; exit 2; }

BODY="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$BODY" "$OUT"' EXIT

# Build the JSON body without putting the image on the command line (works on macOS and Linux).
{ printf '{"tcg":"%s","image":"' "$TCG"; base64 < "$IMAGE" | tr -d '\n'; printf '"}'; } > "$BODY"

STATUS="$(curl -sS --max-time 120 -o "$OUT" -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @"$BODY")"

if [ "$STATUS" != "200" ]; then
  echo "HTTP $STATUS" >&2; cat "$OUT" >&2; echo >&2
  exit 1
fi

if [ "$RAW" = 1 ] || ! command -v jq >/dev/null 2>&1; then
  cat "$OUT"; echo
  exit 0
fi

jq -r '
  "Detected \(.count) card(s)",
  (.cards | to_entries[] | .value as $c |
    "\(.key + 1). \($c.full_name // $c.name) | \($c.set.name // "?") \($c.set.ptcgo_code // $c.set.code // "") #\($c.set.number // "?") | \($c.rarity // "?") | \($c.language) | Cardmarket \($c.cardmarket_id // "n/a") | trend \($c.prices.cardmarket.trend // "n/a") EUR | confidence \($c.confidence)"),
  (if .demo then "Demo key: \(.demo.remaining_today) of \(.demo.limit_per_day) left today"
   elif .credits then "Credits remaining: \(.credits.remaining)" else empty end)
' "$OUT"
