# NeoSatoshi Card Recognition MCP server

MCP server for the [NeoSatoshi card recognition API](https://neosatoshi.com/developers/detection-api): lets Claude, Cursor, Codex and other MCP clients identify Pokémon, One Piece, Disney Lorcana, Yu-Gi-Oh! and Magic: The Gathering cards in a photo and get set, number, rarity, Cardmarket ID and daily prices as JSON.

* Transport: stdio
* npm package: `neosatoshi-card-mcp`, binary `neosatoshi-card-mcp`
* Node.js 18 or newer

## Tools

### `recognize_cards`

| Argument | Type | Description |
|---|---|---|
| `image_path` | string | Local `.jpg`, `.jpeg` or `.png`, at most 12 MB. `~` is expanded. |
| `image_url` | string | Public `https://` URL of a JPEG or PNG. Forwarded to the API as is; the server never downloads it. |
| `image_base64` | string | Base64 JPEG or PNG, a `data:image/...;base64,` prefix is accepted. |
| `tcg` | enum | `pokemon` (default), `onepiece`, `lorcana`, `yugioh`, `magic` |

Give exactly one of `image_path`, `image_url`, `image_base64`. The result has a short text summary per card, the full API response as JSON text, and the same response as `structuredContent`. API errors come back as tool errors with the API's `error` code and `message`.

Example summary line:

```
1. Cinderace ex | Scarlet & Violet Black Star Promos (PR-SV) #163 | Promo | en | Cardmarket 796939 | trend 3.59 EUR | confidence 0.85 | 5 alternatives
```

The API identifies cards; it does not grade condition. One card usually takes 6 to 20 seconds; the server waits up to 120 seconds.

### `list_supported_games`

Games, card languages, `tcg` values and limits. No API call, no cost.

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

* Files: only regular files are read. Directories, devices, sockets and pipes are refused. Symlinks are resolved first and the real target is checked. Only `.jpg`, `.jpeg` and `.png` whose content starts with JPEG or PNG magic bytes are accepted, at most 12 MB.
* `NEOSATOSHI_ALLOWED_DIRS` is checked against the resolved real path, so `../` and symlinks cannot escape it. Entries that do not exist grant nothing.
* Network: the server only calls `https://europe-west1-neosatoshi.cloudfunctions.net/detectApi`. `image_url` is passed to the API, which fetches and validates it; the server itself never fetches URLs.
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
