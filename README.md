# NeoSatoshi Card Recognition API

Card recognition API for Pokémon, One Piece, Disney Lorcana, Yu-Gi-Oh!, Magic: The Gathering, Star Wars: Unlimited, Digimon Card Game, Cyberpunk TCG, Riftbound, football (soccer) and basketball (NBA, EuroLeague) cards: send a photo, get JSON with set, number, rarity, Cardmarket ID and daily prices (football and basketball: player, release and parallel).

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

Add `"stream": true` to get Server-Sent Events: each card as soon as it is recognised, then the same result as a normal call, at the same cost. On a Pokémon binder page with 9 cards the first card came after about 6 seconds and all nine after about 17. Football and basketball binder pages stream the same way.

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
| Cyberpunk TCG | `cyberpunk` | English, French | Several (binder pages work) |
| Riftbound (detection only, see below) | `riftbound` | English (French and Chinese prints are recognized, without a price) | Several (binder pages work) |
| Football (soccer) cards: Topps, Panini and other makers | `football` | (no card language) | Several card fronts (binder pages work, best up to about 20), at most 4 MB |
| Basketball cards: NBA (Panini, Topps; mainly 2018-19 to 2026-27) and Panini EuroLeague (from 2023-24); not WNBA, college, G League, NBL | `basketball` | (no card language) | Several card fronts (binder pages work, best up to about 20), at most 4 MB |

## Request

`POST` with a JSON body:

```json
{ "image": "<base64 JPEG or PNG, max 12 MB>", "tcg": "pokemon" }
```

| Field | Required | Description |
|---|---|---|
| `image` | one of `image` or `image_url` | Base64 encoded JPEG or PNG, at most 12 MB (football and basketball: 4 MB). |
| `image_url` | one of `image` or `image_url` | Public `https://` URL of a JPEG or PNG, at most 12 MB, fetched by the API. Alternative to `image`. |
| `tcg` | no | `pokemon` (default), `onepiece`, `lorcana`, `yugioh`, `magic`, `star_wars_unlimited`, `digimon`, `cyberpunk`, `riftbound`, `football` or `basketball`. |
| `stream` | no | `true` for Server-Sent Events, see [Streaming](#streaming). The header `Accept: text/event-stream` does the same. |

## Response

Recorded response for [examples/images/example_api_single.jpg](examples/images/example_api_single.jpg) (Pokémon, Cinderace ex, demo key, 2026-11-11):

```json
{
  "request_id": "req_745cfd72-7f1c-4e4c-94d3-91e2485b8b2d",
  "count": 1,
  "cards": [
    {
      "name": "Cinderace ex",
      "name_ja": null,
      "name_ko": null,
      "name_zh": null,
      "language": "en",
      "card_id": "svp-163",
      "set": { "id": "svp", "ptcgo_code": "PR-SV", "name": "Scarlet & Violet Black Star Promos", "number": "163" },
      "rarity": "Promo",
      "cardmarket_id": 796939,
      "reverse_holo": false,
      "first_edition": false,
      "possible_variants": null,
      "special_variant": null,
      "price_basis": "normal",
      "prices": {
        "cardmarket": { "trend": 3.84, "low": 1, "avg7": 3.87, "avg30": 3.87, "currency": "EUR" },
        "cardmarket_normal": { "trend": 3.84, "low": 1, "avg7": 3.87, "avg30": 3.87, "currency": "EUR" },
        "cardmarket_reverse": { "trend": null, "low": null, "avg7": null, "avg30": null, "currency": "EUR" },
        "tcgplayer": { "market": 5.03, "currency": "USD" }
      },
      "images": {
        "small": "https://d1m1gwcombja0u.cloudfront.net/public_images/cards_en/svp/svp-163_small.webp",
        "large": "https://d1m1gwcombja0u.cloudfront.net/public_images/cards_en/svp/svp-163.png"
      },
      "confidence": 0.85,
      "image_quality": { "blurred": false, "unusual_dimensions": false },
      "alternatives": [
        { "name": "Cinderace ex", "set": "Stellar Crown", "number": "28", "score": 1, "possible_variants": null, "card_id": "sv7-28", "cardmarket_id": 785881 }
      ],
      "graded": null,
      "card_index": 0,
      "review": { "needed": false, "reasons": [], "search": null }
    }
  ],
  "demo": { "limit_per_day": 10, "remaining_today": 9 },
  "correction": {
    "request_id": "req_745cfd72-7f1c-4e4c-94d3-91e2485b8b2d",
    "until": "2026-11-12T17:52:33.487Z",
    "endpoint": "https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi/corrections",
    "search_endpoint": "https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi/search"
  }
}
```

The alternative Stellar Crown 28 has score 1 while the match has confidence 0.85. Score and confidence are different scales, so compare the set number printed on the card, not these two numbers. See [Integration guide](#integration-guide-for-coding-agents).

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
| `correction` | `request_id`, `until`, `search_endpoint` (correction search, first step) and `endpoint` (corrections, second step), when the detection can be corrected for free. |
| `credits.remaining` | Remaining card scans of your key's plan (own keys only). |
| `demo` | Public demo key only, instead of credits: `limit_per_day` and `remaining_today` for your network. |
| `card_id` | Our stable card id (Pokémon for example `svp-163`). Use it to correct, look up or store the card. |
| `card_index` | Position of the card in this detection. A correction names the card by `request_id` and `card_index`. |
| `name` | Card name as printed. |
| `language` | Card language: `en`, `de`, `fr`, `it`, `es`, `pt`, `ja`, `ko`, `zh`. |
| `tcg` | `onepiece`, `lorcana`, `yugioh`, `magic`, `star_wars_unlimited`, `digimon`, `cyberpunk`, `riftbound`, `football` or `basketball`. Absent for Pokémon. |
| `set` | `id`, `ptcgo_code` (Pokémon, One Piece, Lorcana) or `code` (Yu-Gi-Oh!, Magic), `name`, `number`. |
| `rarity` | Rarity as named by the game. |
| `cardmarket_id` | Cardmarket product ID, or null. Pokémon: the product of the version `prices.cardmarket` describes. |
| `prices.cardmarket` | `trend`, `low`, `avg7`, `avg30` in EUR, updated daily. Pokémon: the price of the version the card is (see `price_basis`). |
| `prices.tcgplayer` | TCGplayer prices in USD, where available. |
| `images` | `small` and `large` reference image URLs. |
| `confidence` | 0 to 1, a fixed step per match method, not a probability. Below 0.85 the card has review reason `low_confidence`. |
| `image_quality` | `blurred`, `unusual_dimensions` (booleans about the photo). |
| `alternatives[]` | Other likely matches for a manual pick. The shape differs per game. A `score` is a similarity inside this search, another scale than `confidence`: never pick an alternative by score alone. |
| `review` | `needed`, `reasons` (for example `low_confidence`, `visual_mismatch`, `card_back`, `blurred`) and `search` (a ready correction search body, or null). Accept the card when `needed` is false. |

A missing price is `null`, never `0`.

### Game-specific fields

| Game | Fields |
|---|---|
| Pokémon | `name_ja`, `name_ko`, `name_zh`, `reverse_holo`, `first_edition`, `special_variant`, `possible_variants` (versions with an integer `cardmarket_id` and `price` with `low`, `trend`, `avg7`, `avg30`, `updatedAt`; `lowPrice` and `trendPrice` deprecated), `price_basis` (`normal`, `reverse_holo`, `first_edition`, `special_variant`), `prices.cardmarket_normal` (the plain card), `prices.cardmarket_reverse` (reverse holo family), `prices.tcgplayer.market` (USD) |
| One Piece | `card_id` (for example `OP01-003`) |
| Disney Lorcana | `version`, `full_name`, `name_en`, `prices.cardmarket_foil` |
| Yu-Gi-Oh! TCG | `passcode`, `set.code`, `edition`, `price_versions`, `*_unconfirmed` flags (for example `print_unconfirmed`: the exact print could not be confirmed, check `alternatives`) |
| Magic: The Gathering | printing (`set.code`, `set.number`, `print_unconfirmed`), `prices.cardmarket_foil`, TCGplayer foil price (`prices.tcgplayer.foil`) |
| Digimon Card Game | `card_key` (the card number, for example `BT1-025`), `print_id` (the printing, for example `BT1-025_P1`), `name_en`, `type`, `level`, `colors`, `set.code`, `variant` (`Alternative Art`), `parallel_index`, `finishes`, `print_unconfirmed`, `number_unconfirmed`. `card_id` is `dg-<print_id>` for an English printing, `dg-ja-<print_id>` for a Japanese one and `dg-c-<number>` while the printing is open (then no price; the printings come as `alternatives`, each priced). Cardmarket prices for English and Japanese printings, TCGplayer for English only. |
| Cyberpunk TCG | `card_key` (the card, for example `v-streetkid`, one card in English and French), `print_id` (set code and printed number without the β, for example `WNC-132`; the Beta `WNCB-132` has the same art), `subtitle`, `name_en`, `type`, `color`, `cost`, `set.code`, `set.number` (as printed: `132`, `B132` on a Beta, `004a`), `finish` (`normal` or `foil`, fixed per printing: Rare and above are foil), `finishes`, `is_foil`, `beta`, `print_unconfirmed`, `number_unconfirmed`. `card_id` is `cp-<print_id>` for an English printing, `cp-fr-<print_id>` for a French one and `cp-c-<card_key>` while the printing is open (then no price; the printings come as `alternatives`, each priced). Cardmarket prices (EUR) for English and French cards (a French card takes the price of the same Cardmarket product), TCGplayer (USD) for English only. |
| Riftbound | `card_key` (the card, for example `kaisa-daughter-of-the-void`, one card in every printing), `print_id` (set code and printed number, for example `OGN-066`, `OGN-066a` alternate art, `OGN-299*` signed, `VEN-R02` rune, `UNL-T02-T05` a double-sided token), `subtitle`, `name_en`, `type`, `domain` (a list), `cost`, `set.code`, `set.number` (as printed, a string: `066`, `066a`, `299*`, `T02 // T05`), `variant` (`Overnumbered`, `Signature`, `Prize Wall`, `Best Of` or null), `finishes` (`["normal", "foil"]` for Common and Uncommon, `["foil"]` for Rare and above, `["normal"]` for runes, tokens and metal cards), `finish` and `is_foil` (a printing with both finishes says `normal`: the photo does not tell them apart), `double_sided`, `prices.cardmarket` (normal finish), `prices.cardmarket_foil` (foil finish), `prices.tcgplayer` (`market` normal, `foil` foil), `print_unconfirmed`, `number_unconfirmed`, `print_source`. `card_id` is `rb-<print_id>` for an English printing, `rb-fr-<print_id>` or `rb-zh-<print_id>` for a French or Chinese print and `rb-c-<card_key>` while the printing is open (then no price; the printings come as `alternatives`, each priced). A finish the printing does not exist in has no price. English prints only are priced: a French or Chinese print has no price and review reason `language_not_listed`. Review reason `partial_read`: only the number or only the rules text was read, the card keeps its printing and price but is no proven match. Detection only: no card search, lookup or corrections, `review.search` is always null. |
| Football | `card_id` (`fb-...`), `season`, `subset`, `teams`, `rookie`, `card_type`, `sure`, `score`, `parallel` (`pick` only when the recognizer is sure, `candidates` with `print_run`, `serial_number`). `prices` and `images` are null: no football prices in the API yet, and no reference images. |
| Basketball | The same fields as football; `card_id` `bk-...`. No prices and no images yet. |

Graded slabs: a photo of a PSA, BGS or CGC slab (football and basketball also SGC) fills `graded` with the grader, the grade and the cert number as read from the label; `null` for a raw card. The grade is never estimated.

The full field reference is in the [documentation](https://neosatoshi.com/developers/detection-api).

## Errors

Errors return JSON with `error` (a code) and usually `message`.

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `missing_image`, `bad_image`, `image_too_large`, `unsupported_image`, `unsupported_tcg` | Fix the request. Only JPEG and PNG up to 12 MB (football and basketball 4 MB). |
| 400 | `bad_image_url`, `image_url_fetch_failed` | Only with `image_url`: the URL is invalid or could not be fetched. |
| 401 | `missing_api_key`, `invalid_api_key` | Check the `Authorization` header. |
| 402 | `out_of_credits` | The plan has no card scans left. |
| 405 | `method_not_allowed` | Only `POST`. |
| 422 | `no_card_detected`, `unreadable_image` (football, basketball) | No card recognised. Not charged. |
| 429 | `rate_limited`, `demo_limit_reached`, `football_busy` | Slow down, or the demo key's 10 per day per network are used up, or the key already has 5 football or basketball photos in progress (`Retry-After`). |
| 502 | (backend step failed) | Retry. |
| 503 | `football_daily_limit`, `football_unavailable`, `football_busy` | Football and basketball only (basketball keeps the football codes): the daily capacity is used up (`resets_at`), or the recognizer is unavailable or busy. Not charged; the other games still work. |
| 504 | `detection_timeout` | Often a cold start. Retry. |

## Limits and pricing

* Images: JPEG or PNG, at most 12 MB (football and basketball 4 MB). All nine trading card games, football and basketball: several cards per photo (binder pages work, best up to about 20), one game per photo.
* One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a football or basketball photo about 6 to 25 seconds. Use a client timeout of at least 120 seconds.
* Demo key: 10 detections per day per network, no signup. Good for trying the API, not for production.
* Own keys: create them in the dashboard at https://neosatoshi.com/dashboard/settings/settings#api-keys . A free account includes 50 card scans a month; the smallest paid plan, Start-Up, costs 19 per month and includes 1,000. One credit per detected card, also for a low-confidence best guess; card backs, images without a card and cards with a visual mismatch (review reason `visual_mismatch`) are not charged.
* The API identifies cards. It does not grade card condition.

## Card search and corrections

Base URL: `https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi`, same Bearer key. All trading card games except Riftbound, football and basketball: Riftbound is answered by the detection only (`"tcg": "riftbound"` in search, lookup or corrections is `400 unsupported_tcg`, and a Riftbound detection cannot be corrected).

* **Correct a detection (free):** every detected card has `card_index` and `review`, the response has `correction` with the `request_id`. Within 24 hours, `POST /search` with `{"request_id": correction.request_id, ...card.review.search}` (or your own `q`, or `set` + `number`) returns up to 5 full card objects; `POST /corrections` with `request_id`, `card_index` and the chosen `card_id` returns the corrected card. 5 searches and 3 corrections per detected card, 500 correction searches and 1000 corrections per account per day.
* **Pokémon versions:** add `cardmarket_id` to the correction (the card's own, its 1st Edition product or a `possible_variants[].cardmarket_id` of that card, else `400 unsupported_cardmarket_id`) to pick a version, and `reverse_holo` (`true` or `false`) for a reverse holo copy. `prices.cardmarket` is then that version's price; `price_basis` says which. The lookup takes the same as `?cardmarket_id=` and `&reverse_holo=true`. One Piece picks a parallel by `cardmarket_id`; Lorcana, Yu-Gi-Oh!, Magic, Star Wars: Unlimited, Digimon and Cyberpunk TCG pick a printing by `card_id` or `set` + `number` and refuse a `cardmarket_id` that does not belong to the card (`400 unsupported_cardmarket_id`).
* **Card search (paid):** `POST /search` with `tcg` and `q` (or `set` + `number`), optional `language` and `limit` (up to 10). `GET /cards/{tcg}/{card_id}` returns one card, for example to refresh a price. 0.5 credits per call that returns a card, from the same balance as detection; no result is free. An `Idempotency-Key` header makes a repeat free. Daily limit per plan; the demo key allows 10 searches and 3 lookups per day per network.

```bash
curl -X POST https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi/search \
  -H "Authorization: Bearer nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274" \
  -H "Content-Type: application/json" \
  -d '{"tcg": "pokemon", "q": "charizard 4/102", "limit": 3}'
```

**Digimon:** a card number alone is a query (`{"tcg": "digimon", "q": "BT1-025"}`, `BT1-025_P1` for a printing), or `set` `BT1` with `number` `025`; `language` `en` or `ja`. `GET /cards/digimon/dg-BT1-025_P1` returns a printing, `dg-c-BT1-025` (or `BT1-025`) the card with its printings.

**Cyberpunk TCG:** search by name in English or French (`{"tcg": "cyberpunk", "q": "floor it"}`), by printed number (`B132`, `005a`) or by set code and number (`set` `WNCB` with `number` `B132` or `132`); `language` `en` or `fr`. `GET /cards/cyberpunk/cp-WNCB-132` returns a printing (here the Beta), `cp-c-floor-it` (or `floor-it`) the card with its printings.

**Football:** `{"tcg": "football", "q": "kane chrome 2023"}`, text only (the player, optionally with set or season words), no `language`, no prices yet. Each result carries `ref`; `GET /cards/football/{card_id}?ref=...` (same key, within 24 hours) returns the card with all parallels of its subset and their print runs. Without a valid `ref` the lookup is 400 and free. Football detections cannot be corrected yet.

**Basketball:** the same as football with `"tcg": "basketball"`, for example `{"tcg": "basketball", "q": "wembanyama prizm 2023"}`; `GET /cards/basketball/{card_id}?ref=...`. Basketball detections cannot be corrected yet.

Details: https://neosatoshi.com/developers/detection-api#card-search

## Integration guide for coding agents

The recommended bulk loop:

1. `POST /detectApi` with one photo. Keep `request_id` and `correction`.
2. For each card in `cards`: if `review.needed` is false, accept it.
3. Otherwise check it: read the set number on the photo, or show the card to a person.
4. If it is wrong, correct it: correction search (`POST /cardsApi/search` with `{"request_id": correction.request_id, ...card.review.search, "number": "<read on the photo>"}`), then `POST /cardsApi/corrections` with `request_id`, `card_index` and `card_id`. Both free.
5. Store `card_id`, `cardmarket_id` and `price_basis` with the card.

**Confidence and score.** `confidence` is a fixed step per match method, not a probability. Pokémon: 0.99 direct match, 0.95 number matched, 0.90 direct match (later step), 0.85 number matched (later step), 0.80 direct match (last step), 0.59 best guess. Japanese, Korean and Chinese cards have their own steps (0.99 down to 0.60). `alternatives[].score` is the similarity of a candidate inside this search, another scale. A German Gallopa 189 came back at 0.85 with the alternative Gallopa 30 at score 0.90, and 189 was right. Never pick an alternative by score alone; take one only when its set number matches the card.

**Review reasons.** `low_confidence`: check the set number. `blurred`, `unusual_dimensions`: check the card, a sharper photo helps. `visual_mismatch`, `no_match`: correct or drop (a visual mismatch is not charged). `card_back`: skip (not charged). `variant_price_missing`: the version has no own Cardmarket price, check the price. `print_unconfirmed`, `rarity_unconfirmed`, `version_unconfirmed`, `number_unconfirmed`, `art_unconfirmed`: a person picks the printing. `graded_label_mismatch`: show the slab to a person. Football and basketball `not_sure`, `parallel_unconfirmed`: a person confirms. Treat an unknown reason as needing review.

**Special versions and reverse holo (Pokémon).** `prices.cardmarket` is the price of the version the card is; `price_basis` says which (`normal`, `reverse_holo`, `first_edition`, `special_variant`). `prices.cardmarket_normal` is always the plain card, `prices.cardmarket_reverse` the reverse holo family. The photo does not tell which `possible_variants` entry a copy is: a person picks, and you send that entry's `cardmarket_id` with the same `card_id` in the correction. A reverse holo copy: `"reverse_holo": true`. `first_edition` comes from the detection and is kept; only Base Set has its own 1st Edition price.

**Limits.** 30 requests per minute per key for search, lookup and corrections (429 `rate_limited`, `Retry-After` 60). Correction window 24 hours. 5 correction searches and 3 corrections per card; 500 correction searches and 1000 corrections per account per day (429 `daily_cap_reached`, `Retry-After` until midnight UTC). A correction search returns at most 5 cards. Paid search and lookup: 0.5 credits each, only when a card is returned, with daily limits per plan. Exports: 200 per day, at most 20 `request_ids`.

**Idempotency and retries.** Send an `Idempotency-Key` header (8 to 100 characters of `A-Z a-z 0-9 : _ -`) on paid search and lookup: a repeat within 24 hours is answered from storage and not charged (`Idempotent-Replayed: true`); another body under the same key is 422 `idempotency_key_reuse`, a call still running 409 `idempotency_in_progress`. Retry 429 after `Retry-After` and 502, 503, 504 with backoff; never retry other 4xx. A retried detection is a new detection and is charged when it succeeds, so retry only after an error answer.

**Errors of search, lookup and corrections.** 400 `invalid_json`, `invalid_card_index`, `invalid_card_id`, `invalid_query`, `unsupported_language`, `unsupported_tcg`, `unsupported_cardmarket_id`, `correction_not_available_for_tcg`, `query_too_broad`, `invalid_idempotency_key`; 401 `missing_api_key`, `invalid_api_key`; 402 `out_of_credits`; 403 `feature_not_enabled`, `request_not_yours`, `paid_search_not_enabled`; 404 `unknown_request_id`, `card_not_found`; 409 `idempotency_in_progress`; 410 `correction_window_closed`; 422 `idempotency_key_reuse`; 429 `rate_limited`, `daily_cap_reached`, `correction_budget_exhausted`, `correction_limit_reached`; 502 `lookup_failed`, `search_failed`; 503 `cards_api_disabled`, `limiter_unavailable`, `billing_unavailable`.

Runnable: `python3 examples/python/detect.py photo.jpg pokemon --review` (standard library only) or `node examples/node/detect.mjs photo.jpg pokemon --review` asks for the set number of every card that needs review and corrects it.

## Changelog

* **2026-11-13 (OpenAPI 1.18.0):** Riftbound (`"tcg": "riftbound"`) in detection only; the card search, the lookup and corrections do not cover it (`400 unsupported_tcg`), so its `review.search` is always null. English prints are priced; French and Chinese prints are recognized without a price (new review reason `language_not_listed`). `card_id` `rb-<print_id>`, `rb-fr-<print_id>`, `rb-zh-<print_id>` or `rb-c-<card_key>`; new fields for it: `domain`, `double_sided`, `print_source`. MCP server 0.10.0 (basketball and Riftbound).
* **2026-11-13 (OpenAPI 1.17.0):** Basketball cards (`"tcg": "basketball"`: NBA from Panini and Topps, Panini EuroLeague) in detection, card search and lookup, the same fields, limits and credits as football; `card_id` `bk-...`, no prices or images yet, no corrections yet. Football and basketball read several cards per photo.
* **2026-11-12 (OpenAPI 1.16.0):** Cyberpunk TCG (`"tcg": "cyberpunk"`, English and French) in detection, card search, lookup and corrections. New fields for it: `beta`, `finish`, `is_foil`, `cost`, `color`; `card_id` `cp-<print_id>`, `cp-fr-<print_id>` or `cp-c-<card_key>`.
* **2026-11-11 (OpenAPI 1.15.0):** Pokémon `prices.cardmarket` and `cardmarket_id` now describe the version the card is (picked version, detected special variant, 1st Edition, reverse holo, else the plain card; before: always the plain card). New `price_basis`, `prices.cardmarket_normal`, `prices.cardmarket_reverse`, `prices.tcgplayer`. `possible_variants[].cardmarket_id` is always an integer (before sometimes a digit string); `possible_variants[].price` has `low` and `trend`, `lowPrice` and `trendPrice` are deprecated. Corrections and the lookup take `cardmarket_id` (400 `unsupported_cardmarket_id` for an id of another card) and `reverse_holo`; exports use them. Corrected German, French, Spanish and Italian Pokémon cards keep their localized name. New `review` on every card and `correction.search_endpoint`. Docs: confidence steps vs score, billing of best guesses, 1000 corrections per day.

## When to use this instead of a general vision LLM

A general vision model can often read a card name from a photo. Use this API when you need:

* **Structured catalog IDs**: set ID, set code and number in a fixed JSON shape, matched against a card database, plus alternatives when the print is ambiguous.
* **Cardmarket product IDs and daily prices**: `cardmarket_id` and Cardmarket trend, low, 7 day and 30 day averages (TCGplayer where available). General vision LLMs do not return these.
* **Predictable per-card cost**: one credit per detected card, nothing for images without a card.

If you only need a rough description of a photo, a general vision LLM may be enough.

## MCP server (Claude, Cursor, Codex and other AI assistants)

[mcp-server/](mcp-server/) ([npm: neosatoshi-card-mcp](https://www.npmjs.com/package/neosatoshi-card-mcp)) is a stdio MCP server with eight tools: `recognize_cards` (local file, https URL or base64; cards reported one by one, catalog images on request), `recognize_folder` (a folder of photos to a CSV or JSON file), `search_cards`, `correct_card`, `get_card`, `export_cards` (the same file the NeoSatoshi website exports: custom CSV/JSON, TCGPowerTools CSV, Shopify product CSV or eBay Seller Hub CSV, free), `list_export_presets` and `list_supported_games`, for all nine trading card games, football and basketball (Riftbound: detection only, not in `search_cards`, `get_card` and `correct_card`). It is listed in the [official MCP registry](https://registry.modelcontextprotocol.io) as `io.github.Cookiebreed/card-recognition-mcp`. Quick setup for Claude Code:

```bash
claude mcp add neosatoshi-cards -e NEOSATOSHI_API_KEY=your_key -- npx -y neosatoshi-card-mcp
```

Without `NEOSATOSHI_API_KEY` it uses the demo key. See [mcp-server/README.md](mcp-server/README.md) for Claude Desktop, Cursor and Codex, and for the file access restriction `NEOSATOSHI_ALLOWED_DIRS`.

## Repository layout

| Path | Contents |
|---|---|
| [examples/curl/detect.sh](examples/curl/detect.sh) | Bash and curl, summary via `jq` if installed |
| [examples/python/detect.py](examples/python/detect.py) | Python, standard library only; `--review` runs the correction step |
| [examples/python/stream.py](examples/python/stream.py), [examples/node/stream.mjs](examples/node/stream.mjs), [examples/curl/stream.sh](examples/curl/stream.sh) | Streaming: each card as soon as it is recognised |
| [examples/python/batch_to_csv.py](examples/python/batch_to_csv.py) | Process a folder, write a CSV (name, set, number, rarity, language, cardmarket_id, Cardmarket trend) |
| [examples/node/detect.mjs](examples/node/detect.mjs) | Node.js 18+, built-in `fetch`, no dependencies; `--review` runs the correction step |
| [examples/images/](examples/images/) | Test photos (testing the API only) |
| [examples/responses/](examples/responses/) | Recorded API responses |
| [mcp-server/](mcp-server/) | MCP server (TypeScript) |
| [postman/](postman/) | Postman collection v2.1 |
| [openapi.json](openapi.json) | OpenAPI 3.1 spec |
| [llms.txt](llms.txt) | Plain-text summary for LLMs |

## FAQ

**Is there a free API to identify Pokémon cards from a photo?**
Yes, for testing: the public demo key `nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274` allows 10 detections per day per network without signup. For more, create your own key: a free account includes 50 card scans a month, paid plans more.

**Can it recognise several cards in one photo?**
Yes, in all nine trading card games: binder pages work (Pokémon best up to about 20 cards per photo; an 8 card Lorcana page took about 8 seconds). One game per photo. Football and basketball cards too (card fronts, at most 4 MB).

**Does it return prices?**
Yes. Each card comes with its Cardmarket product ID and daily Cardmarket prices in EUR (trend, low, 7 and 30 day average), plus TCGplayer prices in USD where available. A missing price is `null`. Football and basketball cards have no prices in the API yet.

**Does it recognise Japanese, Korean or Chinese cards?**
Pokémon: Japanese, Korean and Simplified Chinese, besides English, German, French, Italian and Spanish. One Piece and Digimon Card Game: English and Japanese. See the table above for the other games.

**Does it grade card condition?**
No. It identifies which card it is (set, number, rarity, language, variant fields). It does not judge condition.

**Does it recognise football (soccer) cards?**
Yes, with `"tcg": "football"`: Topps, Panini and other makers, several card fronts per photo (at most 4 MB). It returns the player, the release (set and number), season, subset, teams, rookie flag and the parallel (three candidates with print runs, a pick only when it is sure). No prices yet. `search_cards` and the card search find football cards by player name.

**Does it recognise basketball cards?**
Yes, with `"tcg": "basketball"`: NBA cards from Panini and Topps (mainly seasons 2018-19 to 2026-27 plus some older releases) and Panini EuroLeague sets from 2023-24, not WNBA, college, G League or NBL. It works like football: player, release, season, subset, teams, rookie flag and parallel, several card fronts per photo, PSA, BGS, CGC and SGC slabs. No prices yet.

**Does it recognise Digimon cards?**
Yes, the Digimon Card Game in English and Japanese, with `"tcg": "digimon"`: recognised by card number and name, several cards per photo, graded slabs (PSA, BGS, CGC) with the grade read from the label. Alternative arts share the card number, so the printing comes from the picture or stays open with the printings as alternatives to pick. Cardmarket prices (EUR) for English and Japanese printings, TCGplayer (USD) for English only. Older Digimon products (the 1999 card game, the 2000 trading cards) are not recognised.

**Does it recognise Cyberpunk TCG cards?**
Yes, the Cyberpunk TCG by WeirdCo in English and French, with `"tcg": "cyberpunk"`: several cards per photo, graded slabs (PSA, BGS, CGC) with the grade read from the label. Beta (Kickstarter) and Retail base cards share the same art, only the β before the number tells them apart, and their prices differ a lot: `beta` says which one it is, and when the photo cannot tell, the printing stays open with the printings as alternatives to pick. The finish is fixed per printing (`finish`, `is_foil`). Cardmarket prices (EUR) for English and French cards, TCGplayer (USD) for English only.

**Does it recognise Riftbound cards?**
Yes, Riftbound, the League of Legends trading card game by Riot Games, with `"tcg": "riftbound"`: several cards per photo, and graded slabs from PSA, BGS and CGC with the grade read from the label (TAG, ACE and PCG are not read). English prints are priced: Common and Uncommon exist normal and foil, so the card comes with both price families (`prices.cardmarket` and `prices.cardmarket_foil`, TCGplayer `market` and `foil`); Rare and above are foil only. When the photo cannot tell an alternate art, overnumbered, signed or promo printing from the base card, the printing stays open with the printings as alternatives, each priced, to pick yourself. French and Chinese prints are recognized but have no price (review reason `language_not_listed`). Riftbound is detection only: the card search, the lookup and corrections do not cover it.

**Does it support Yu-Gi-Oh! OCG (Asian) cards?**
No, only the TCG in English, German, French, Italian, Spanish and Portuguese.

**How long does a request take?**
One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period, and a binder page with 9 cards about 17 seconds. Use a 120 second client timeout. 502 and 504 can be retried.

**Can I get the cards one by one?**
Yes. With `"stream": true` each card arrives as a Server-Sent Event as soon as it is recognised. It helps with binder pages; see [Streaming](#streaming).

**What does it cost?**
One credit per detected card, from the plan's monthly card scans, also for a low-confidence best guess. Card backs, images without a card and visual mismatches are not charged. A free account includes 50 card scans a month; the smallest paid plan, Start-Up, costs 19 per month and includes 1,000.

**Can I send an image URL instead of base64?**
Yes, send `"image_url": "https://..."` instead of `"image"`. The URL must be public https and point to a JPEG or PNG of at most 12 MB.

**Can AI agents call it directly?**
Yes. Agents may call the endpoint with the demo key, use the [OpenAPI spec](openapi.json), or use the [MCP server](mcp-server/).

**Where do I get support?**
api@neosatoshi.com . Include the `request_id` from the response.

## License and terms

The code in this repository is MIT licensed (see [LICENSE](LICENSE)). The API itself is a commercial service governed by https://neosatoshi.com/termsofuse . The example images in [examples/images/](examples/images/) may only be used for testing the API.
