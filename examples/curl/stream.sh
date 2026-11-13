#!/usr/bin/env bash
# Print the Server-Sent Events of one detection as they arrive.
#
# Usage: ./stream.sh <image_url> [tcg]
#   image_url: public https link to a JPEG or PNG
#   tcg:       pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited, digimon, cyberpunk, football, basketball
#
# Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).
set -euo pipefail

ENDPOINT="https://europe-west1-neosatoshi.cloudfunctions.net/detectApi"
DEMO_KEY="nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274"
API_KEY="${NEOSATOSHI_API_KEY:-$DEMO_KEY}"

IMAGE_URL="${1:-}" TCG="${2:-pokemon}"
[ -n "$IMAGE_URL" ] || { echo "Usage: $0 <image_url> [tcg]" >&2; exit 2; }

# -N turns off curl's output buffering, so each event shows up immediately.
curl -sS -N --max-time 180 -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"image_url\": \"$IMAGE_URL\", \"tcg\": \"$TCG\", \"stream\": true}"
