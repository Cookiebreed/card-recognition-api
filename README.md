# NeoSatoshi Card Recognition API

Card recognition API for Pokémon, One Piece, Disney Lorcana, Yu-Gi-Oh!, Magic: The Gathering, Star Wars: Unlimited, Digimon Card Game and football (soccer) cards: send a photo, get JSON with set, number, rarity, Cardmarket ID and daily prices (football: player, release and parallel).

This repository contains runnable examples (curl, Python, Node.js), an MCP server for AI assistants, a Postman collection and a copy of the OpenAPI spec. The API is run by [NeoSatoshi](https://neosatoshi.com) (NeoGen Solutions GmbH, Bern, Switzerland).

* Endpoint: `POST https://europe-west1-neosatoshi.cloudfunctions.net/detectApi`
* Auth: `Authorization: Bearer <API_KEY>`
* Public demo key (no signup, 10 detections per day per network): `nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274`
* Docs: https://neosatoshi.com/developers/detection-api
* Card search and corrections: `POST .../cardsApi/search`, `POST .../cardsApi/corrections`, `GET .../cardsApi/cards/{tcg}/{card_id}` (see [Card search and corrections](#card-search-and-corrections))
* OpenAPI: [openapi.json](openapi.json) (also at https://neosatoshi.com/openapi.json)

## Quickstart (30 seconds)

From a clone of this repository (or use any photo of a card). Works on macOS and Linux as is:

```bash
{ printf '{"tcg":"pokemon","image":"'; base64 < examples/images/example_api_single.jpg | tr -d '\n'; printf '"}'; } > body.json

curl -sS --max-time 120 -X POST https://europe-west1-neosatoshi.cloudfunctions.net/detectApi \
  -H "Authorization: Bearer nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274" \
  -H "Content-Type: application/json" \
  --data-binary @body.json
```

One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a binder page with 9 cards about 17 seconds. Keep the client timeout at 120 seconds or more.

Ready-made scripts that print a per-card summary:

```bash
./examples/curl/detect.sh examples/images/example_api_single.jpg
python3 examples/python/detect.py examples/images/example_api_lorcana_de.jpg lorcana
node examples/node/detect.mjs examples/images/example_api_multi.jpg pokemon --json
```

All scripts read `NEOSATOSHI_API_KEY` and fall back to the demo key.

## Streaming

Add `"stream": true` to get Server-Sent Events: each card as soon as it is recognised, then the same result as a normal call, at the same cost. On a Pokémon binder page with 9 cards the first card came after about 6 seconds and all nine after about 17. Football (one card per photo) gets progress events, not a faster result.

```bash
./examples/curl/stream.sh https://neosatoshi.com/static/images/example_api_multi.jpg
python3 examples/python/stream.py https://neosatoshi.com/static/images/example_api_multi.jpg
node examples/node/stream.mjs https://neosatoshi.com/static/images/example_api_lorcana.jpg lorcana
```

Events: `accepted`, `progress`, `card` (`index`, `card`), then exactly one of `done` (same body as the JSON response) or `error` (`status`, `error`, `message`). A `: keep-alive` comment comes every 15 seconds. Errors before the detection starts stay plain JSON with their status code. A stream cannot be resumed: a reconnect is a new, charged detection. Details: [documentation](https://neosatoshi.com/developers/detection-api#streaming).

## Supported games and languages

| Game | `tcg` value | Card languages | Cards per photo |
|---|---|---|---|
| Pokémon TCG | `pokemon` (default) | English, German, French, Italian, Spanish, Japanese, Korean, Simplified Chinese | Several (binder pages work, best up to about 20) |
| One Piece Card Game | `onepiece` | English, Japanese | Several (binder pages work) |
| Disney Lorcana | `lorcana` | English, German, French, Italian | Several (binder pages work) |
| Yu-Gi-Oh! TCG (not OCG) | `yugioh` | English, German, French, Italian, Spanish, Portuguese | Several (binder pages work) |
| Magic: The Gathering | `magic` | English, German, French, Italian, Spanish | Several (binder pages work) |
| Star Wars: Unlimited | `star_wars_unlimited` | English, German, French, Italian, Spanish | Several (binder pages work) |
| Digimon Card Game | `digimon` | English, Japanese | Several (binder pages work) |
| Football (soccer) cards: Topps, Panini and other makers | `football` | (no card language) | One, the card front, at most 4 MB |

## Request

`POST` with a JSON body:

```json
{ "image": "<base64 JPEG or PNG, max 12 MB>", "tcg": "pokemon" }
```

| Field | Required | Description |
|---|---|---|
| `image` | one of `image` or `image_url` | Base64 encoded JPEG or PNG, at most 12 MB (football: 4 MB). |
| `image_url` | one of `image` or `image_url` | Public `https://` URL of a JPEG or PNG, at most 12 MB, fetched by the API. Alternative to `image`. |
| `tcg` | no | `pokemon` (default), `onepiece`, `lorcana`, `yugioh`, `magic`, `star_wars_unlimited`, `digimon` or `football`. |
| `stream` | no | `true` for Server-Sent Events, see [Streaming](#streaming). The header `Accept: text/event-stream` does the same. |

## Response

Recorded response for [examples/images/example_api_single.jpg](examples/images/example_api_single.jpg) (Pokémon, Cinderace ex):

```json
{
  "request_id": "req_adec9d16-14dc-40a8-9d8c-2df9de2ad3a5",
  "count": 1,
  "cards": [
    {
      "name": "Cinderace ex",
      "name_ja": null,
      "name_ko": null,
      "name_zh": null,
      "language": "en",
      "set": { "id": "svp", "ptcgo_code": "PR-SV", "name": "Scarlet & Violet Black Star Promos", "number": "163" },
      "rarity": "Promo",
      "cardmarket_id": 796939,
      "reverse_holo": false,
      "first_edition": false,
      "special_variant": null,
      "prices": { "cardmarket": { "trend": 3.59, "low": 1, "avg7": 3.71, "avg30": 4.1, "currency": "EUR" } },
      "images": {
        "small": "https://d1m1gwcombja0u.cloudfront.net/public_images/cards_en/svp/svp-163_small.webp",
        "large": "https://d1m1gwcombja0u.cloudfront.net/public_images/cards_en/svp/svp-163.png"
      },
      "confidence": 0.85,
      "image_quality": { "blurred": false, "unusual_dimensions": false },
      "alternatives": [
        { "name": "Cinderace ex", "set": "Stellar Crown", "number": "28", "score": 1, "possible_variants": null }
      ]
    }
  ],
  "demo": { "limit_per_day": 10, "remaining_today": 9 }
}
```

(Shortened; the full recording is in [examples/responses/pokemon_single_cinderace.json](examples/responses/pokemon_single_cinderace.json).) For the 9 card binder page in [example_api_multi.jpg](examples/images/example_api_multi.jpg) the API returns every card in `cards`, one entry each.

More recordings:

* [lorcana_en_genie.json](examples/responses/lorcana_en_genie.json): Disney Lorcana, English, photo [example_api_lorcana.jpg](examples/images/example_api_lorcana.jpg)
* [lorcana_de_blume.json](examples/responses/lorcana_de_blume.json): Disney Lorcana, German (foil detected), photo [example_api_lorcana_de.jpg](examples/images/example_api_lorcana_de.jpg)
* [football_beste_autograph.json](examples/responses/football_beste_autograph.json): football, a numbered autograph (Gold Wave Refractor 37/50), shortened to two of its four alternatives
* [catalog-shape/](examples/responses/catalog-shape/): One Piece, Lorcana, Yu-Gi-Oh! and Magic responses recorded from clean catalog images, included only to show the response shape per game (the catalog images themselves are not in this repo)

### Fields shared by every game

| Field | Description |
|---|---|
| `request_id` | ID of the request, quote it in support questions. |
| `count` | Number of detected cards. |
| `cards[]` | One object per detected card (see below). |
| `credits.remaining` | Remaining card scans of your key's plan (own keys only). |
| `demo` | Public demo key only, instead of credits: `limit_per_day` and `remaining_today` for your network. |
| `name` | Card name as printed. |
| `language` | Card language: `en`, `de`, `fr`, `it`, `es`, `pt`, `ja`, `ko`, `zh`. |
| `tcg` | `onepiece`, `lorcana`, `yugioh`, `magic`, `star_wars_unlimited`, `digimon` or `football`. Absent for Pokémon. |
| `set` | `id`, `ptcgo_code` (Pokémon, One Piece, Lorcana) or `code` (Yu-Gi-Oh!, Magic), `name`, `number`. |
| `rarity` | Rarity as named by the game. |
| `cardmarket_id` | Cardmarket product ID, or null. |
| `prices.cardmarket` | `trend`, `low`, `avg7`, `avg30` in EUR, updated daily. |
| `prices.tcgplayer` | TCGplayer prices in USD, where available. |
| `images` | `small` and `large` reference image URLs. |
| `confidence` | 0 to 1. |
| `image_quality` | `blurred`, `unusual_dimensions` (booleans about the photo). |
| `alternatives[]` | Other likely matches for a manual pick. The shape differs per game. |

A missing price is `null`, never `0`.

### Game-specific fields

| Game | Fields |
|---|---|
| Pokémon | `name_ja`, `name_ko`, `name_zh`, `reverse_holo`, `first_edition`, `special_variant` |
| One Piece | `card_id` (for example `OP01-003`) |
| Disney Lorcana | `version`, `full_name`, `name_en`, `prices.cardmarket_foil` |
| Yu-Gi-Oh! TCG | `passcode`, `set.code`, `edition`, `price_versions`, `*_unconfirmed` flags (for example `print_unconfirmed`: the exact print could not be confirmed, check `alternatives`) |
| Magic: The Gathering | printing (`set.code`, `set.number`, `print_unconfirmed`), `prices.cardmarket_foil`, TCGplayer foil price (`prices.tcgplayer.foil`) |
| Digimon Card Game | `card_key` (the card number, for example `BT1-025`), `print_id` (the printing, for example `BT1-025_P1`), `name_en`, `type`, `level`, `colors`, `set.code`, `variant` (`Alternative Art`), `parallel_index`, `finishes`, `print_unconfirmed`, `number_unconfirmed`. `card_id` is `dg-<print_id>` for an English printing, `dg-ja-<print_id>` for a Japanese one and `dg-c-<number>` while the printing is open (then no price; the printings come as `alternatives`, each priced). Cardmarket prices for English and Japanese printings, TCGplayer for English only. |
| Football | `card_id` (`fb-...`), `season`, `subset`, `teams`, `rookie`, `card_type`, `sure`, `score`, `parallel` (`pick` only when the recognizer is sure, `candidates` with `print_run`, `serial_number`). `prices` and `images` are null: no football prices in the API yet, and no reference images. |

Graded slabs: a photo of a PSA, BGS or CGC slab (football also SGC) fills `graded` with the grader, the grade and the cert number as read from the label; `null` for a raw card. The grade is never estimated.

The full field reference is in the [documentation](https://neosatoshi.com/developers/detection-api).

## Errors

Errors return JSON with `error` (a code) and usually `message`.

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `missing_image`, `bad_image`, `image_too_large`, `unsupported_image`, `unsupported_tcg` | Fix the request. Only JPEG and PNG up to 12 MB (football 4 MB). |
| 400 | `bad_image_url`, `image_url_fetch_failed` | Only with `image_url`: the URL is invalid or could not be fetched. |
| 401 | `missing_api_key`, `invalid_api_key` | Check the `Authorization` header. |
| 402 | `out_of_credits` | The plan has no card scans left. |
| 405 | `method_not_allowed` | Only `POST`. |
| 422 | `no_card_detected`, `unreadable_image` (football) | No card recognised. Not charged. |
| 429 | `rate_limited`, `demo_limit_reached`, `football_busy` | Slow down, or the demo key's 10 per day per network are used up, or the key already has 5 football photos in progress (`Retry-After`). |
| 502 | (backend step failed) | Retry. |
| 503 | `football_daily_limit`, `football_unavailable`, `football_busy` | Football only: the daily football capacity is used up (`resets_at`), or the recognizer is unavailable or busy. Not charged; the other games still work. |
| 504 | `detection_timeout` | Often a cold start. Retry. |

## Limits and pricing

* Images: JPEG or PNG, at most 12 MB (football 4 MB). All seven trading card games: several cards per photo (binder pages work; Pokémon best up to about 20), one game per photo. Football: one card per photo.
* One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a football card about 6 to 25 seconds. Use a client timeout of at least 120 seconds.
* Demo key: 10 detections per day per network, no signup. Good for trying the API, not for production.
* Own keys: create them in the dashboard at https://neosatoshi.com/dashboard/settings/settings#api-keys . Any paid plan works; the smallest, Start-Up, costs 19 per month and includes 1,000 card scans. One credit per detected card; images without a card are not charged.
* The API identifies cards. It does not grade card condition.

## Card search and corrections

Base URL: `https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi`, same Bearer key. All seven trading card games and football.

* **Correct a detection (free):** every detected card has `card_index`, the response has `correction` with the `request_id`. Within 24 hours, `POST /search` with `request_id`, `card_index` and `q` (a card name, or `set` + `number`) returns up to 5 full card objects; `POST /corrections` with `request_id`, `card_index` and the chosen `card_id` returns the corrected card. 5 searches and 3 corrections per detected card.
* **Card search (paid):** `POST /search` with `tcg` and `q` (or `set` + `number`), optional `language` and `limit` (up to 10). `GET /cards/{tcg}/{card_id}` returns one card, for example to refresh a price. 0.5 credits per call that returns a card, from the same balance as detection; no result is free. An `Idempotency-Key` header makes a repeat free. Daily limit per plan; the demo key allows 10 searches and 3 lookups per day per network.

```bash
curl -X POST https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi/search \
  -H "Authorization: Bearer nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274" \
  -H "Content-Type: application/json" \
  -d '{"tcg": "pokemon", "q": "charizard 4/102", "limit": 3}'
```

**Digimon:** a card number alone is a query (`{"tcg": "digimon", "q": "BT1-025"}`, `BT1-025_P1` for a printing), or `set` `BT1` with `number` `025`; `language` `en` or `ja`. `GET /cards/digimon/dg-BT1-025_P1` returns a printing, `dg-c-BT1-025` (or `BT1-025`) the card with its printings.

**Football:** `{"tcg": "football", "q": "kane chrome 2023"}`, text only (the player, optionally with set or season words), no `language`, no prices yet. Each result carries `ref`; `GET /cards/football/{card_id}?ref=...` (same key, within 24 hours) returns the card with all parallels of its subset and their print runs. Without a valid `ref` the lookup is 400 and free. Football detections cannot be corrected yet.

Details: https://neosatoshi.com/developers/detection-api#card-search

## When to use this instead of a general vision LLM

A general vision model can often read a card name from a photo. Use this API when you need:

* **Structured catalog IDs**: set ID, set code and number in a fixed JSON shape, matched against a card database, plus alternatives when the print is ambiguous.
* **Cardmarket product IDs and daily prices**: `cardmarket_id` and Cardmarket trend, low, 7 day and 30 day averages (TCGplayer where available). General vision LLMs do not return these.
* **Predictable per-card cost**: one credit per detected card, nothing for images without a card.

If you only need a rough description of a photo, a general vision LLM may be enough.

## MCP server (Claude, Cursor, Codex and other AI assistants)

[mcp-server/](mcp-server/) ([npm: neosatoshi-card-mcp](https://www.npmjs.com/package/neosatoshi-card-mcp)) is a stdio MCP server with eight tools: `recognize_cards` (local file, https URL or base64; cards reported one by one, catalog images on request), `recognize_folder` (a folder of photos to a CSV or JSON file), `search_cards`, `correct_card`, `get_card`, `export_cards` (the same file the NeoSatoshi website exports: custom CSV/JSON, TCGPowerTools CSV, Shopify product CSV or eBay Seller Hub CSV, free), `list_export_presets` and `list_supported_games`, for all seven trading card games and football. It is listed in the [official MCP registry](https://registry.modelcontextprotocol.io) as `io.github.Cookiebreed/card-recognition-mcp`. Quick setup for Claude Code:

```bash
claude mcp add neosatoshi-cards -e NEOSATOSHI_API_KEY=your_key -- npx -y neosatoshi-card-mcp
```

Without `NEOSATOSHI_API_KEY` it uses the demo key. See [mcp-server/README.md](mcp-server/README.md) for Claude Desktop, Cursor and Codex, and for the file access restriction `NEOSATOSHI_ALLOWED_DIRS`.

## Repository layout

| Path | Contents |
|---|---|
| [examples/curl/detect.sh](examples/curl/detect.sh) | Bash and curl, summary via `jq` if installed |
| [examples/python/detect.py](examples/python/detect.py) | Python with `requests` |
| [examples/python/stream.py](examples/python/stream.py), [examples/node/stream.mjs](examples/node/stream.mjs), [examples/curl/stream.sh](examples/curl/stream.sh) | Streaming: each card as soon as it is recognised |
| [examples/python/batch_to_csv.py](examples/python/batch_to_csv.py) | Process a folder, write a CSV (name, set, number, rarity, language, cardmarket_id, Cardmarket trend) |
| [examples/node/detect.mjs](examples/node/detect.mjs) | Node.js 18+, built-in `fetch`, no dependencies |
| [examples/images/](examples/images/) | Test photos (testing the API only) |
| [examples/responses/](examples/responses/) | Recorded API responses |
| [mcp-server/](mcp-server/) | MCP server (TypeScript) |
| [postman/](postman/) | Postman collection v2.1 |
| [openapi.json](openapi.json) | OpenAPI 3.1 spec |
| [llms.txt](llms.txt) | Plain-text summary for LLMs |

## FAQ

**Is there a free API to identify Pokémon cards from a photo?**
Yes, for testing: the public demo key `nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274` allows 10 detections per day per network without signup. For more, create your own key on any paid plan.

**Can it recognise several cards in one photo?**
Yes, in all seven trading card games: binder pages work (Pokémon best up to about 20 cards per photo; an 8 card Lorcana page took about 8 seconds). One game per photo. Football cards: one card per photo.

**Does it return prices?**
Yes. Each card comes with its Cardmarket product ID and daily Cardmarket prices in EUR (trend, low, 7 and 30 day average), plus TCGplayer prices in USD where available. A missing price is `null`. Football cards have no prices in the API yet.

**Does it recognise Japanese, Korean or Chinese cards?**
Pokémon: Japanese, Korean and Simplified Chinese, besides English, German, French, Italian and Spanish. One Piece and Digimon Card Game: English and Japanese. See the table above for the other games.

**Does it grade card condition?**
No. It identifies which card it is (set, number, rarity, language, variant fields). It does not judge condition.

**Does it recognise football (soccer) cards?**
Yes, with `"tcg": "football"`: Topps, Panini and other makers, one card front per photo (at most 4 MB). It returns the player, the release (set and number), season, subset, teams, rookie flag and the parallel (three candidates with print runs, a pick only when it is sure). No prices yet. `search_cards` and the card search find football cards by player name.

**Does it recognise Digimon cards?**
Yes, the Digimon Card Game in English and Japanese, with `"tcg": "digimon"`: recognised by card number and name, several cards per photo, graded slabs (PSA, BGS, CGC) with the grade read from the label. Alternative arts share the card number, so the printing comes from the picture or stays open with the printings as alternatives to pick. Cardmarket prices (EUR) for English and Japanese printings, TCGplayer (USD) for English only. Older Digimon products (the 1999 card game, the 2000 trading cards) are not recognised.

**Does it support Yu-Gi-Oh! OCG (Asian) cards?**
No, only the TCG in English, German, French, Italian, Spanish and Portuguese.

**How long does a request take?**
One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period, and a binder page with 9 cards about 17 seconds. Use a 120 second client timeout. 502 and 504 can be retried.

**Can I get the cards one by one?**
Yes. With `"stream": true` each card arrives as a Server-Sent Event as soon as it is recognised. It helps with binder pages; see [Streaming](#streaming).

**What does it cost?**
One credit per detected card, from the plan's monthly card scans. Images without a card are not charged. The smallest paid plan, Start-Up, costs 19 per month and includes 1,000 card scans.

**Can I send an image URL instead of base64?**
Yes, send `"image_url": "https://..."` instead of `"image"`. The URL must be public https and point to a JPEG or PNG of at most 12 MB.

**Can AI agents call it directly?**
Yes. Agents may call the endpoint with the demo key, use the [OpenAPI spec](openapi.json), or use the [MCP server](mcp-server/).

**Where do I get support?**
api@neosatoshi.com . Include the `request_id` from the response.

## License and terms

The code in this repository is MIT licensed (see [LICENSE](LICENSE)). The API itself is a commercial service governed by https://neosatoshi.com/termsofuse . The example images in [examples/images/](examples/images/) may only be used for testing the API.
