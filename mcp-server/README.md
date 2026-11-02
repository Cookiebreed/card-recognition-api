# NeoSatoshi Card Recognition MCP server

MCP server for the [NeoSatoshi card recognition API](https://neosatoshi.com/developers/detection-api): lets Claude, Cursor, Codex and other MCP clients identify Pokémon, One Piece, Disney Lorcana, Yu-Gi-Oh!, Magic: The Gathering, Star Wars: Unlimited and football (soccer) cards in a photo (binder pages work, football one card per photo) and get set, number, rarity, Cardmarket ID and daily prices as JSON (football: player, release and parallel), and search the card catalog.

* Transport: stdio
* npm package: `neosatoshi-card-mcp`, binary `neosatoshi-card-mcp`
* Node.js 18 or newer

## Tools

### `recognize_cards`

| Argument | Type | Description |
|---|---|---|
| `image_path` | string | Local `.jpg`, `.jpeg` or `.png`, at most 12 MB (football 4 MB). `~` is expanded. |
| `image_url` | string | Public `https://` URL of a JPEG or PNG. Forwarded to the API as is; the server never downloads it. |
| `image_base64` | string | Base64 JPEG or PNG, a `data:image/...;base64,` prefix is accepted. |
| `tcg` | enum | `pokemon` (default), `onepiece`, `lorcana`, `yugioh`, `magic`, `star_wars_unlimited`, `football` |

| `include_images` | boolean | Also return the catalog image of up to 10 recognised cards (from our CDN, at most 4 MB together), so the assistant can compare them with the photo. Default `false`. |

Give exactly one of `image_path`, `image_url`, `image_base64`. The result has a short text summary per card, the full API response as JSON text, and the same response as `structuredContent`. API errors come back as tool errors with the API's `error` code and `message`.

Example summary line:

```
1. Cinderace ex | Scarlet & Violet Black Star Promos (PR-SV) #163 | Promo | en | Cardmarket 796939 | trend 3.59 EUR | confidence 0.85 | 5 alternatives
```

Football line (no prices yet, the parallel is a suggestion a person should confirm):

```
1. Niklas Beste | 2025-26 Topps Chrome Bundesliga #BA-NBE | Base Cards Autograph Variation | Sport-Club Freiburg | parallel Gold Wave Refractor /50 (suggested, confirm it) | serial 37 | 2 alternatives | no price yet
```

When the client sends a progress token (Claude Code, Claude Desktop and most clients do), the detection is streamed and each card is reported as soon as it is recognised: on an 8 card Lorcana page the first card came after about 8 seconds, all eight after 11.

The API identifies cards; it does not grade condition (a PSA, BGS or CGC slab, for football also SGC, comes back with the grade read from the label). One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a binder page with 9 cards about 17 seconds; a football card about 6 to 25 seconds. The client waits up to 120 seconds.

### `recognize_folder`

| Argument | Type | Description |
|---|---|---|
| `folder` | string | Local folder with the photos (not its subfolders). `~` is expanded. |
| `tcg` | enum | One game per folder. Default `pokemon`. |
| `max_files` | integer | At most this many photos, in name order. Default 20, at most 100. |
| `output` | enum | `csv` (default), `json` (API format) or `both`, written as a new file into the folder. |

One detection per photo, one credit per detected card. Existing files are never overwritten. It stops early on errors that would fail every photo (no credits, invalid key, demo limit). CSV columns: `file`, `card_index`, `name`, `tcg`, `language`, `set_name`, `set_code`, `number`, `rarity`, `cardmarket_id`, `cardmarket_trend_eur`, `cardmarket_avg30_eur`, `tcgplayer_market_usd`, `confidence`, `graded`, `season`, `subset`, `parallel`, `request_id`. Cells that start with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet does not run them.

### `search_cards`

Search the card catalog; results are full card objects like a detection returns (set, number, rarity, Cardmarket
product ID, daily prices, images), at most 10, with `has_more` but no total. With `request_id` and `card_index` from
`recognize_cards` it is a free correction search (5 per detected card within 24 hours, at most 5 results). Without
them it is the paid card search: 0.5 credits when it returns a card.

Football: `{"tcg": "football", "q": "kane chrome 2023"}`, only `q` (the player, optionally with set or season words), no
`language`, `set` or `number`, no prices yet. Each result carries `ref` for `get_card`.

### `correct_card`

Correct a detected card to the right catalog card (`card_id` from a correction search or from the card's
alternatives). Free, within 24 hours, 3 times per card, only for the key that made the detection.

### `get_card`

One card by its `card_id`, for example to refresh a price. 0.5 credits when the card exists. For a wrong detection
use `search_cards` with `request_id` and `correct_card` instead, both free.

Football: pass `ref` from the `search_cards` result (same key, within 24 hours). The card then comes with all parallels
of its subset and their print runs. Without a valid `ref` the call is refused and free.

### `list_supported_games`

Games, card languages, `tcg` values, limits and card search prices. No API call, no cost.

## Cost

| Call | Own key | Demo key |
|---|---|---|
| `recognize_cards` | 1 credit per detected card, nothing without a card | 10 per day per network |
| `search_cards` (card search), `get_card` | 0.5 credits when a card comes back | 10 searches, 3 lookups per day per network, never charged |
| `search_cards` with `request_id`, `correct_card` | free | free |

## Configuration

| Variable | Required | Description |
|---|---|---|
| `NEOSATOSHI_API_KEY` | no | Your API key from https://neosatoshi.com/dashboard/settings/settings#api-keys (any paid plan). Without it the public demo key is used: 10 detections per day per network. |
| `NEOSATOSHI_ALLOWED_DIRS` | no | Directories `image_path` may read from, separated by `:` (`;` on Windows). Unset means any readable image file. Set it to limit what an assistant can send. |

## Setup

### Claude Code

```bash
claude mcp add neosatoshi-cards -e NEOSATOSHI_API_KEY=your_key -- npx -y neosatoshi-card-mcp
```

With a directory restriction:

```bash
claude mcp add neosatoshi-cards -e NEOSATOSHI_API_KEY=your_key -e NEOSATOSHI_ALLOWED_DIRS="$HOME/Pictures/cards" -- npx -y neosatoshi-card-mcp
```

Leave out `-e NEOSATOSHI_API_KEY=...` to try it with the demo key.

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "neosatoshi-cards": {
      "command": "npx",
      "args": ["-y", "neosatoshi-card-mcp"],
      "env": {
        "NEOSATOSHI_API_KEY": "your_key",
        "NEOSATOSHI_ALLOWED_DIRS": "/Users/you/Pictures/cards"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "neosatoshi-cards": {
      "command": "npx",
      "args": ["-y", "neosatoshi-card-mcp"],
      "env": { "NEOSATOSHI_API_KEY": "your_key" }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.neosatoshi-cards]
command = "npx"
args = ["-y", "neosatoshi-card-mcp"]
env = { NEOSATOSHI_API_KEY = "your_key" }
```

### From source

```bash
cd mcp-server
npm install
npm run build
node dist/index.js   # speaks MCP on stdin/stdout
```

Point any client at `node /absolute/path/to/mcp-server/dist/index.js` instead of `npx`.

## Security

* Files: only regular files are read. Directories, devices, sockets and pipes are refused. Symlinks are resolved first and the real target is checked. Only `.jpg`, `.jpeg` and `.png` whose content starts with JPEG or PNG magic bytes are accepted, at most 12 MB (football 4 MB).
* `NEOSATOSHI_ALLOWED_DIRS` is checked against the resolved real path, so `../` and symlinks cannot escape it. Entries that do not exist grant nothing.
* Network: the server only calls `https://europe-west1-neosatoshi.cloudfunctions.net/detectApi` and `.../cardsApi`, and with `include_images` our card image CDN `https://d1m1gwcombja0u.cloudfront.net` (other image hosts are skipped).
* Writing: only `recognize_folder` writes, and only new files named `neosatoshi_cards_<date>-<time>.csv` / `.json` into the folder it read (same `NEOSATOSHI_ALLOWED_DIRS` check). `image_url` is passed to the API, which fetches and validates it; the server itself never fetches URLs.
* No shell execution.
* The API key is only sent in the `Authorization` header. It is never logged or returned, and it is scrubbed from error messages.

## Development

```bash
npm install
npm test     # builds, then runs node:test (file safety and tool tests with a fake fetch, no live API calls)
```

## Publishing notes

* `server.json` is for the official MCP registry (https://registry.modelcontextprotocol.io). Its `name` matches the `mcpName` in `package.json` (`io.github.Cookiebreed/card-recognition-mcp`); the registry checks GitHub ownership for `io.github.*` names.
* `smithery.yaml` is for Smithery.

## License

MIT for this code (see [LICENSE](LICENSE)). The API is a commercial service governed by https://neosatoshi.com/termsofuse .
