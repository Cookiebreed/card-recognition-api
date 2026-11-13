// Tool behaviour with a fake fetch: no live API calls are made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { API_ENDPOINT, CARDS_API_BASE, DEMO_API_KEY } from "../dist/constants.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-srv-")));
const img = path.join(dir, "card.jpg");
fs.writeFileSync(img, JPEG);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const sample = JSON.parse(
  fs.readFileSync(new URL("../../examples/responses/pokemon_single_cinderace.json", import.meta.url), "utf8"),
);

function fakeFetch(status, payload, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
}

async function connect(env, fetchImpl) {
  const server = createServer({ env, fetchImpl });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test("lists all tools", async () => {
  const client = await connect({}, fakeFetch(200, sample, []));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["correct_card", "export_cards", "get_card", "list_export_presets", "list_supported_games", "recognize_cards", "recognize_folder", "search_cards"]);
  assert.match(tools.find((t) => t.name === "export_cards").description, /Free/);
  assert.match(tools.find((t) => t.name === "search_cards").description, /free/);
  assert.match(tools.find((t) => t.name === "get_card").description, /0\.5 credits/);
  const rec = tools.find((t) => t.name === "recognize_cards");
  assert.match(rec.description, /demo key/);
  assert.deepEqual(rec.inputSchema.properties.tcg.enum, ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon", "cyberpunk", "riftbound", "football"]);
  assert.match(rec.description, /football/);
  assert.ok(tools.find((t) => t.name === "get_card").inputSchema.properties.ref, "get_card takes the football ref");
});

test("recognize_cards sends base64 to the one endpoint and summarizes", async () => {
  const calls = [];
  const key = "nsk_live_test_secret_key_123";
  const client = await connect({ NEOSATOSHI_API_KEY: key }, fakeFetch(200, sample, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, API_ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent, { tcg: "pokemon", image: JPEG.toString("base64") });
  assert.match(res.content[0].text, /Cinderace ex/);
  assert.match(res.content[0].text, /Cardmarket 796939/);
  assert.equal(res.structuredContent.cards[0].cardmarket_id, 796939);
  assert.ok(!JSON.stringify(res).includes(key), "key must not appear in the result");
});

test("image_url is forwarded as is, never fetched by the server", async () => {
  const calls = [];
  const client = await connect({}, fakeFetch(200, sample, calls));
  const url = "https://example.com/some/card.jpg?x=1";
  await client.callTool({ name: "recognize_cards", arguments: { image_url: url, tcg: "lorcana" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, API_ENDPOINT);
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "lorcana", image_url: url });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${DEMO_API_KEY}`);
});

test("exactly one image source is required", async () => {
  const calls = [];
  const client = await connect({}, fakeFetch(200, sample, calls));
  const none = await client.callTool({ name: "recognize_cards", arguments: {} });
  assert.equal(none.isError, true);
  const two = await client.callTool({
    name: "recognize_cards",
    arguments: { image_path: img, image_url: "https://example.com/a.jpg" },
  });
  assert.equal(two.isError, true);
  assert.match(two.content[0].text, /exactly one/);
  assert.equal(calls.length, 0);
});

test("API errors pass through error and message, key is scrubbed", async () => {
  const key = "nsk_live_another_secret_456";
  const client = await connect(
    { NEOSATOSHI_API_KEY: key },
    fakeFetch(429, { error: "demo_limit_reached", message: `Daily demo limit reached for ${key}` }, []),
  );
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /429 demo_limit_reached/);
  assert.match(res.content[0].text, /Daily demo limit reached/);
  assert.ok(!res.content[0].text.includes(key));
});

test("an unfilled Claude Desktop field is not a key and not a folder", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "${user_config.api_key}", NEOSATOSHI_ALLOWED_DIRS: "${user_config.allowed_dir}" }, fakeFetch(200, sample, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${DEMO_API_KEY}`);
});

test("NEOSATOSHI_ALLOWED_DIRS is enforced by the tool", async () => {
  const calls = [];
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-allow-")));
  const client = await connect({ NEOSATOSHI_ALLOWED_DIRS: other }, fakeFetch(200, sample, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /NEOSATOSHI_ALLOWED_DIRS/);
  assert.equal(calls.length, 0);
  fs.rmSync(other, { recursive: true, force: true });
});

test("search_cards: a correction search goes to cardsApi/search with the detection reference", async () => {
  const calls = [];
  const key = "nsk_live_test_secret_key_123";
  const answer = { results: [{ card_id: "base1-4" }], count: 1, has_more: false, billing: { charged_credits: 0, source: "free_correction" } };
  const client = await connect({ NEOSATOSHI_API_KEY: key }, fakeFetch(200, answer, calls));
  const res = await client.callTool({ name: "search_cards", arguments: { request_id: "req_abc12345", card_index: 0, q: "charizard 4/102" } });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].url, `${CARDS_API_BASE}/search`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { request_id: "req_abc12345", card_index: 0, q: "charizard 4/102" });
  assert.equal(res.structuredContent.results[0].card_id, "base1-4");
});

test("correct_card posts the correction, get_card reads one card with its query", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { card: { card_id: "x" } }, calls));
  await client.callTool({ name: "correct_card", arguments: { request_id: "req_abc12345", card_index: 1, card_id: "OP01-001", cardmarket_id: 667 } });
  assert.equal(calls[0].url, `${CARDS_API_BASE}/corrections`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { request_id: "req_abc12345", card_index: 1, card_id: "OP01-001", cardmarket_id: 667 });
  await client.callTool({ name: "get_card", arguments: { tcg: "magic", card_id: "o-1", set: "lea", number: "161" } });
  assert.equal(calls[1].url, `${CARDS_API_BASE}/cards/magic/o-1?set=lea&number=161`);
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.body, undefined);
  await client.callTool({ name: "correct_card", arguments: { request_id: "req_abc12345", card_index: 0, card_id: "swsh12-189", cardmarket_id: 806514, reverse_holo: false } });
  assert.deepEqual(JSON.parse(calls[2].init.body), { request_id: "req_abc12345", card_index: 0, card_id: "swsh12-189", cardmarket_id: 806514, reverse_holo: false });
  await client.callTool({ name: "get_card", arguments: { tcg: "pokemon", card_id: "swsh12-189", cardmarket_id: 806514, reverse_holo: true } });
  assert.equal(calls[3].url, `${CARDS_API_BASE}/cards/pokemon/swsh12-189?cardmarket_id=806514&reverse_holo=true`);
});

test("cards API errors come back as tool errors without the key", async () => {
  const key = "nsk_live_secret_for_error_test";
  const client = await connect({ NEOSATOSHI_API_KEY: key }, fakeFetch(429, { error: "correction_budget_exhausted", message: `used up for ${key}` }, []));
  const res = await client.callTool({ name: "search_cards", arguments: { request_id: "req_abc12345", card_index: 0, q: "pikachu" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /429 correction_budget_exhausted/);
  assert.ok(!JSON.stringify(res).includes(key));
});

const football = JSON.parse(
  fs.readFileSync(new URL("../../examples/responses/football_beste_autograph.json", import.meta.url), "utf8"),
);

test("recognize_cards football: sends tcg football and summarizes player, release and parallel", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, football, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "football" } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "football", image: JPEG.toString("base64") });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /Niklas Beste \| 2025-26 Topps Chrome Bundesliga #BA-NBE/);
  assert.match(line, /parallel Gold Wave Refractor \/50 \(suggested, confirm it\)/);
  assert.match(line, /serial 37/);
  assert.match(line, /no price yet/);
  assert.doesNotMatch(line, /Cardmarket/);
});

test("recognize_cards football: a photo over 4 MB is refused before any call", async () => {
  const calls = [];
  const big = path.join(dir, "big.jpg");
  fs.writeFileSync(big, Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)]));
  const client = await connect({}, fakeFetch(200, football, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: big, tcg: "football" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /larger than 4 MB/);
  const ok = await client.callTool({ name: "recognize_cards", arguments: { image_path: big, tcg: "pokemon" } });
  assert.equal(ok.isError, undefined, "the 12 MB cap still applies to the other games");
  assert.equal(calls.length, 1);
});

test("football search and lookup: q only, then get_card with the ref", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { results: [{ card_id: "fb-a2a-2a", ref: "abc.def" }] }, calls));
  await client.callTool({ name: "search_cards", arguments: { tcg: "football", q: "kane chrome 2023", limit: 5 } });
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "football", q: "kane chrome 2023", limit: 5 });
  await client.callTool({ name: "get_card", arguments: { tcg: "football", card_id: "fb-a2a-2a", ref: "lz3k1.Ab_-x" } });
  assert.equal(calls[1].url, `${CARDS_API_BASE}/cards/football/fb-a2a-2a?ref=lz3k1.Ab_-x`);
});

test("list_supported_games names football and the card search prices", async () => {
  const client = await connect({}, fakeFetch(200, sample, []));
  const res = await client.callTool({ name: "list_supported_games", arguments: {} });
  assert.match(res.content[0].text, /tcg="football"/);
  assert.match(res.content[0].text, /Card search: .*0\.5 credits/);
  assert.match(res.content[0].text, /tcg="lorcana".*cards per photo: several/);
});

// Digimon card shape from the OpenAPI lookup example (GET /cardsApi/cards/digimon/dg-BT1-025_P1), shortened.
const digimonCard = {
  name: "WarGreymon",
  name_en: "WarGreymon",
  language: "en",
  tcg: "digimon",
  card_key: "BT1-025",
  type: "Digimon",
  level: 6,
  colors: ["red"],
  card_id: "dg-BT1-025_P1",
  print_id: "BT1-025_P1",
  set: { id: "BT1", code: "BT1", name: "RELEASE SPECIAL BOOSTER Ver.1.0 [BT01-03]", number: "BT1-025" },
  rarity: "SR",
  variant: "Alternative Art",
  parallel_index: 1,
  cardmarket_id: 620026,
  finishes: ["normal"],
  prices: {
    cardmarket: { trend: 16.85, low: 14.99, avg7: 17.06, avg30: 17.3, currency: "EUR" },
    tcgplayer: { market: 9.54, currency: "USD" },
  },
  print_unconfirmed: false,
  number_unconfirmed: false,
  confidence: 1,
  image_quality: { blurred: false, unusual_dimensions: false },
  alternatives: [],
  graded: null,
};

test("recognize_cards digimon: sends tcg digimon and summarizes printing and prices", async () => {
  const calls = [];
  const resp = { request_id: "req_dg1", count: 1, cards: [digimonCard], credits: { remaining: 99 } };
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, resp, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "digimon" } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "digimon", image: JPEG.toString("base64") });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /WarGreymon \| RELEASE SPECIAL BOOSTER Ver\.1\.0 \[BT01-03\] \(BT1\) #BT1-025/);
  assert.match(line, /BT1-025_P1 Alternative Art/);
  assert.match(line, /Cardmarket 620026 \| trend 16\.85 EUR \| TCGplayer 9\.54 USD/);
});

test("recognize_cards digimon: an open printing says so and offers the printings", async () => {
  const open = {
    ...digimonCard,
    language: "ja",
    card_id: "dg-c-BT1-025",
    print_id: null,
    variant: null,
    cardmarket_id: null,
    prices: { cardmarket: { trend: null, low: null, avg7: null, avg30: null, currency: "EUR" }, tcgplayer: { market: null, currency: "USD" } },
    print_unconfirmed: true,
    alternatives: [{ card_id: "dg-ja-BT1-025" }, { card_id: "dg-ja-BT1-025_P1" }],
  };
  const client = await connect({}, fakeFetch(200, { request_id: "req_dg2", count: 1, cards: [open] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "digimon" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /unconfirmed: print/);
  assert.match(line, /2 alternatives/);
  assert.doesNotMatch(line, /TCGplayer/);
});

test("digimon search and lookup: a card number as q, get_card by printing id", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { card: digimonCard }, calls));
  await client.callTool({ name: "search_cards", arguments: { tcg: "digimon", q: "BT1-025", language: "ja" } });
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "digimon", q: "BT1-025", language: "ja" });
  await client.callTool({ name: "get_card", arguments: { tcg: "digimon", card_id: "dg-BT1-025_P1" } });
  assert.equal(calls[1].url, `${CARDS_API_BASE}/cards/digimon/dg-BT1-025_P1`);
});

test("list_supported_games names Digimon with English and Japanese", async () => {
  const client = await connect({}, fakeFetch(200, sample, []));
  const res = await client.callTool({ name: "list_supported_games", arguments: {} });
  assert.match(res.content[0].text, /Digimon Card Game.*tcg="digimon", languages en, ja, cards per photo: several/);
  assert.match(res.content[0].text, /Digimon: .*TCGplayer \(USD\) for English only/);
});

// Cyberpunk TCG card shape from the OpenAPI lookup example (GET /cardsApi/cards/cyberpunk/cp-WNCB-132), shortened.
const cyberpunkCard = {
  name: "Floor It",
  name_en: "Floor It",
  subtitle: null,
  language: "en",
  tcg: "cyberpunk",
  card_key: "floor-it",
  type: "Program",
  color: "Blue",
  cost: 1,
  card_id: "cp-WNCB-132",
  print_id: "WNCB-132",
  set: { id: "WNCB", code: "WNCB", name: "Welcome to Night City Beta", number: "B132" },
  rarity: "Common",
  finish: "normal",
  finishes: ["normal"],
  is_foil: false,
  beta: true,
  cardmarket_id: 905220,
  prices: {
    cardmarket: { trend: 0.08, low: 0.02, avg7: 0.09, avg30: 0.09, currency: "EUR" },
    tcgplayer: { market: 0.12, currency: "USD" },
  },
  print_unconfirmed: false,
  number_unconfirmed: false,
  art_unconfirmed: false,
  confidence: 1,
  image_quality: { blurred: false, unusual_dimensions: false },
  alternatives: [],
  graded: null,
  review: { needed: false, reasons: [], search: null },
};

test("recognize_cards cyberpunk: sends tcg cyberpunk and summarizes the Beta printing and prices", async () => {
  const calls = [];
  const resp = { request_id: "req_cp1", count: 1, cards: [cyberpunkCard], credits: { remaining: 99 } };
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, resp, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "cyberpunk" } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "cyberpunk", image: JPEG.toString("base64") });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /Floor It \| Welcome to Night City Beta \(WNCB\) #B132 \| WNCB-132 Beta \| Common \| en/);
  assert.match(line, /Cardmarket 905220 \| trend 0\.08 EUR \| TCGplayer 0\.12 USD/);
  assert.doesNotMatch(line, /foil/);
});

test("recognize_cards cyberpunk: a Retail printing has no Beta mark, a foil printing says foil", async () => {
  // The same shape as a Retail foil printing (the finish is fixed per printing), only to check the summary.
  const retailFoil = { ...cyberpunkCard, card_id: "cp-WNC-132", print_id: "WNC-132", set: { id: "WNC", code: "WNC", name: "Welcome to Night City", number: "132" }, beta: false, finish: "foil", finishes: ["foil"], is_foil: true };
  const client = await connect({}, fakeFetch(200, { request_id: "req_cp2", count: 1, cards: [retailFoil] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "cyberpunk" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /#132 \| WNC-132 \| Common/);
  assert.doesNotMatch(line, /Beta/);
  assert.match(line, /\| foil \|/);
});

test("recognize_cards cyberpunk: an open printing says so and offers the printings", async () => {
  const open = {
    ...cyberpunkCard,
    language: "fr",
    card_id: "cp-c-floor-it",
    print_id: null,
    set: { id: null, code: null, name: null, number: "132" },
    beta: null,
    cardmarket_id: null,
    prices: { cardmarket: { trend: null, low: null, avg7: null, avg30: null, currency: "EUR" }, tcgplayer: null },
    print_unconfirmed: true,
    alternatives: [{ card_id: "cp-fr-WNC-132" }, { card_id: "cp-fr-WNCB-132" }],
  };
  const client = await connect({}, fakeFetch(200, { request_id: "req_cp3", count: 1, cards: [open] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "cyberpunk" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /unconfirmed: print/);
  assert.match(line, /2 alternatives/);
  assert.doesNotMatch(line, /TCGplayer/);
  assert.doesNotMatch(line, /Beta/);
});

test("cyberpunk search and lookup: set + number, a French name, get_card by printing id", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { card: cyberpunkCard }, calls));
  await client.callTool({ name: "search_cards", arguments: { tcg: "cyberpunk", set: "WNCB", number: "B132" } });
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "cyberpunk", set: "WNCB", number: "B132" });
  await client.callTool({ name: "search_cards", arguments: { tcg: "cyberpunk", q: "floor it", language: "fr" } });
  assert.deepEqual(JSON.parse(calls[1].init.body), { tcg: "cyberpunk", q: "floor it", language: "fr" });
  await client.callTool({ name: "get_card", arguments: { tcg: "cyberpunk", card_id: "cp-WNCB-132" } });
  assert.equal(calls[2].url, `${CARDS_API_BASE}/cards/cyberpunk/cp-WNCB-132`);
});

test("list_supported_games names Cyberpunk TCG with English and French", async () => {
  const client = await connect({}, fakeFetch(200, sample, []));
  const res = await client.callTool({ name: "list_supported_games", arguments: {} });
  assert.match(res.content[0].text, /Cyberpunk TCG.*tcg="cyberpunk", languages en, fr, cards per photo: several/);
  assert.match(res.content[0].text, /Cyberpunk TCG: .*Beta.*TCGplayer \(USD\) for English only/);
});

// Riftbound card shape from the documentation example (VEN-001, functions/shared/detectCardMapping.js mapCardRiftbound), shortened.
const riftboundCard = {
  name: "Baccai Sandspinner",
  name_en: "Baccai Sandspinner",
  subtitle: null,
  language: "en",
  tcg: "riftbound",
  card_key: "baccai-sandspinner",
  type: "Unit",
  domain: ["Fury"],
  cost: 6,
  card_id: "rb-VEN-001",
  print_id: "VEN-001",
  set: { id: "VEN", code: "VEN", name: "Vendetta", number: "001" },
  rarity: "Common",
  variant: null,
  finish: "normal",
  finishes: ["normal", "foil"],
  is_foil: false,
  double_sided: false,
  cardmarket_id: 897877,
  prices: {
    cardmarket: { trend: 0.04, low: 0.02, avg7: 0.06, avg30: 0.05, currency: "EUR" },
    cardmarket_foil: { trend: 0.12, low: 0.02, avg7: 0.09, avg30: 0.1, currency: "EUR" },
    tcgplayer: { market: 0.03, foil: 0.15, currency: "USD" },
  },
  print_unconfirmed: false,
  number_unconfirmed: false,
  print_source: "line",
  art_unconfirmed: false,
  confidence: 0.95,
  image_quality: { blurred: false, unusual_dimensions: false },
  alternatives: [],
  graded: null,
  card_index: 0,
  review: { needed: false, reasons: [], search: null },
};
const noPrice = { trend: null, low: null, avg7: null, avg30: null, currency: "EUR" };

test("recognize_cards riftbound: sends tcg riftbound and summarizes the printing and both finish prices", async () => {
  const calls = [];
  const resp = { request_id: "req_rb1", count: 1, cards: [riftboundCard], credits: { remaining: 99 } };
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, resp, calls));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "riftbound" } });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].url, API_ENDPOINT);
  assert.deepEqual(JSON.parse(calls[0].init.body), { tcg: "riftbound", image: JPEG.toString("base64") });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /Baccai Sandspinner \| Vendetta \(VEN\) #001 \| VEN-001 \| Common \| en \| Cardmarket 897877/);
  assert.match(line, /trend 0\.04 EUR \| foil trend 0\.12 EUR \| TCGplayer 0\.03 USD \| TCGplayer foil 0\.15 USD/);
  assert.doesNotMatch(line, /\| foil \|/);
  assert.doesNotMatch(line, /review needed/);
});

test("summary: only Riftbound prints the TCGplayer foil price, every other game's line is unchanged", async () => {
  // a Pokemon card whose TCGplayer block happens to carry a foil field: the line must stay as before the Riftbound change
  const other = { ...riftboundCard, tcg: "pokemon", print_id: null, card_id: "sv1-1", prices: { ...riftboundCard.prices } };
  const client = await connect({}, fakeFetch(200, { request_id: "req_pk1", count: 1, cards: [other] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /TCGplayer 0\.03 USD/);
  assert.doesNotMatch(line, /TCGplayer foil/);
});

test("recognize_cards riftbound: a signed foil-only printing names its kind of print and says foil", async () => {
  // A Signature printing exists in foil only: no normal price, only the foil family (shape as mapCardRiftbound, prices only for the summary).
  const signed = {
    ...riftboundCard, name: "Kai'Sa, Daughter of the Void", card_key: "kaisa-daughter-of-the-void", card_id: "rb-OGN-299*", print_id: "OGN-299*",
    set: { id: "OGN", code: "OGN", name: "Origins", number: "299*" }, rarity: "Showcase", variant: "Signature", finish: "foil", finishes: ["foil"], is_foil: true, cardmarket_id: null,
    prices: { cardmarket: noPrice, cardmarket_foil: { trend: 300, low: 250, avg7: 310, avg30: 320, currency: "EUR" }, tcgplayer: { market: null, foil: 280, currency: "USD" } },
  };
  const client = await connect({}, fakeFetch(200, { request_id: "req_rb2", count: 1, cards: [signed] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "riftbound" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /Origins \(OGN\) #299\* \| OGN-299\* Signature \| Showcase \| en \| foil \| Cardmarket n\/a \| foil trend 300 EUR \| TCGplayer foil 280 USD/);
  assert.doesNotMatch(line, /\| trend /);
  assert.doesNotMatch(line, /TCGplayer null/);
  // Without a variant, the star alone still marks the signed print.
  const bare = { ...signed, variant: null };
  const res2 = await (await connect({}, fakeFetch(200, { request_id: "req_rb3", count: 1, cards: [bare] }, []))).callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "riftbound" } });
  assert.match(res2.content[0].text.split("\n")[1], /\| OGN-299\* signed \|/);
});

test("recognize_cards riftbound: a French print has no price and says language not listed, with no correction hint", async () => {
  const french = {
    ...riftboundCard, language: "fr", card_id: "rb-fr-VEN-001",
    prices: { cardmarket: noPrice, cardmarket_foil: noPrice, tcgplayer: { market: null, foil: null, currency: "USD" } },
    review: { needed: true, reasons: ["language_not_listed"], search: null },
  };
  const client = await connect({}, fakeFetch(200, { request_id: "req_rb4", count: 1, cards: [french] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "riftbound" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /\| VEN-001 \| Common \| fr \| Cardmarket 897877/);
  assert.match(line, /review needed: language not listed/);
  assert.doesNotMatch(line, /trend|TCGplayer/);
  assert.doesNotMatch(line, /search_cards/);
});

test("recognize_cards riftbound: an open printing says so and lists the printings", async () => {
  const open = {
    ...riftboundCard,
    card_id: "rb-c-baccai-sandspinner",
    print_id: null,
    set: { id: "VEN", code: "VEN", name: null, number: "001" },
    rarity: null, variant: null, finish: null, finishes: [], is_foil: null, double_sided: null, cardmarket_id: null,
    prices: { cardmarket: noPrice, cardmarket_foil: noPrice, tcgplayer: { market: null, foil: null, currency: "USD" } },
    print_unconfirmed: true,
    print_source: null,
    alternatives: [{ card_id: "rb-VEN-001" }, { card_id: "rb-VEN-001a" }],
    review: { needed: true, reasons: ["print_unconfirmed"], search: null },
  };
  const client = await connect({}, fakeFetch(200, { request_id: "req_rb5", count: 1, cards: [open] }, []));
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, tcg: "riftbound" } });
  const line = res.content[0].text.split("\n")[1];
  assert.match(line, /unconfirmed: print/);
  assert.match(line, /2 alternatives/);
  assert.match(line, /Cardmarket n\/a/);
  assert.doesNotMatch(line, /trend|TCGplayer|search_cards/);
});

test("recognize_folder takes tcg riftbound", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-rb-")));
  try {
    fs.writeFileSync(path.join(folder, "a.jpg"), JPEG);
    const calls = [];
    const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { request_id: "req_rb6", count: 1, cards: [riftboundCard] }, calls));
    const res = await client.callTool({ name: "recognize_folder", arguments: { folder, tcg: "riftbound", output: "json" } });
    assert.equal(res.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).tcg, "riftbound");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("search_cards and get_card do not offer riftbound and refuse it without a call", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, { card: riftboundCard }, calls));
  const { tools } = await client.listTools();
  for (const name of ["search_cards", "get_card"]) {
    const t = tools.find((x) => x.name === name);
    assert.deepEqual(t.inputSchema.properties.tcg.enum, ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon", "cyberpunk", "football"]);
    assert.match(t.description, /Not for Riftbound/);
  }
  assert.match(tools.find((x) => x.name === "correct_card").description, /Riftbound detections cannot be corrected/);
  assert.match(tools.find((x) => x.name === "recognize_cards").description, /Riftbound \(tcg "riftbound".*detection only/);
  const attempts = [
    { name: "search_cards", arguments: { tcg: "riftbound", q: "baccai sandspinner" } },
    { name: "get_card", arguments: { tcg: "riftbound", card_id: "rb-VEN-001" } },
  ];
  for (const a of attempts) {
    let refused = false;
    try {
      const res = await client.callTool(a);
      refused = res.isError === true;
    } catch {
      refused = true; // an SDK that throws on invalid arguments refuses too
    }
    assert.ok(refused, `${a.name} refuses tcg riftbound`);
  }
  assert.equal(calls.length, 0, "no API call for a refused game");
});

test("list_supported_games names Riftbound as detection only with its price rules", async () => {
  const client = await connect({}, fakeFetch(200, sample, []));
  const res = await client.callTool({ name: "list_supported_games", arguments: {} });
  const text = res.content[0].text;
  assert.match(text, /Riftbound \(.*detection only, not in the card search\): tcg="riftbound", languages en, fr and zh \(recognized, no price\), cards per photo: several/);
  assert.match(text, /Riftbound: detection only: search_cards, get_card and correct_card do not cover Riftbound .*language_not_listed/);
  assert.match(text, /Card search: .*not for Riftbound/);
  assert.equal(res.structuredContent.games.find((g) => g.tcg === "riftbound").cards_per_photo, "several (binder pages work)");
});

function sseFetch(events, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(": keep-alive\n\n");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

test("recognize_cards with a progress token streams and reports each card", async () => {
  const calls = [];
  const events = [["accepted", { request_id: "req_1" }], ["progress", { stage: "matching" }], ["card", { index: 0, card: { name: "Cinderace ex" } }], ["done", sample]];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, sseFetch(events, calls));
  const seen = [];
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } }, undefined, { onprogress: (p) => seen.push(p) });
  assert.equal(res.isError, undefined);
  assert.equal(JSON.parse(calls[0].init.body).stream, true);
  assert.deepEqual(seen.map((p) => p.message), ["Photo accepted", "Stage: matching", "Card 1: Cinderace ex"]);
  assert.match(res.content[0].text, /Cinderace ex/);
});

test("a stream error is a tool error; a stream without a final event is never resent", async () => {
  const c1 = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, sseFetch([["accepted", {}], ["error", { status: 502, error: "detection_failed", message: "x" }]], []));
  const r1 = await c1.callTool({ name: "recognize_cards", arguments: { image_path: img } }, undefined, { onprogress: () => {} });
  assert.equal(r1.isError, true);
  assert.match(r1.content[0].text, /502 detection_failed/);
  const calls = [];
  const c2 = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, sseFetch([["accepted", {}]], calls));
  const r2 = await c2.callTool({ name: "recognize_cards", arguments: { image_path: img } }, undefined, { onprogress: () => {} });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /ended without a result/);
  assert.equal(calls.length, 1);
});

test("include_images adds catalog images from our CDN only", async () => {
  const fetched = [];
  const resp = { request_id: "r", count: 2, cards: [
    { name: "A", images: { small: "https://d1m1gwcombja0u.cloudfront.net/x/a_small.webp" } },
    { name: "B", images: { small: "https://evil.example.com/b.webp" } },
  ] };
  const server = createServer({ env: { NEOSATOSHI_API_KEY: "k_123456789" }, fetchImpl: fakeFetch(200, resp, []), imageFetchImpl: async (url) => {
    fetched.push(url);
    return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
  } });
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = await client.callTool({ name: "recognize_cards", arguments: { image_path: img, include_images: true } });
  assert.deepEqual(fetched, ["https://d1m1gwcombja0u.cloudfront.net/x/a_small.webp"]);
  const images = res.content.filter((c) => c.type === "image");
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, "image/webp");
  assert.match(res.content.find((c) => /Catalog images/.test(c.text ?? "")).text, /1\. A/);
  const plain = await client.callTool({ name: "recognize_cards", arguments: { image_path: img } });
  assert.equal(plain.content.filter((c) => c.type === "image").length, 0, "off by default");
});

test("recognize_folder: every photo once, a new CSV with escaped cells, never overwrites", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-folder-")));
  for (const n of ["b.jpg", "a.png", "notes.txt", ".hidden.jpg"]) fs.writeFileSync(path.join(folder, n), n === "a.png" ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) : JPEG);
  const calls = [];
  const resp = { request_id: "req_f", count: 1, cards: [{ name: "=HYPERLINK(1)", set: { name: "Base", number: "4" }, cardmarket_id: 1, prices: { cardmarket: { trend: 2.5 } }, card_index: 0 }] };
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(200, resp, calls));
  const seen = [];
  const res = await client.callTool({ name: "recognize_folder", arguments: { folder, output: "both" } }, undefined, { onprogress: (p) => seen.push(p) });
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.equal(calls.length, 2, "two photos, the txt and the hidden file are skipped");
  assert.deepEqual(seen.map((p) => [p.progress, p.total, p.message]), [[1, 2, "a.png"], [2, 2, "b.jpg"]]);
  const [csvFile, jsonFile] = res.structuredContent.files_written;
  const csv = fs.readFileSync(csvFile, "utf8").split("\r\n");
  assert.match(csv[0], /^file,card_index,name,/);
  assert.match(csv[1], /^a\.png,0,'=HYPERLINK\(1\),pokemon,,Base,,4,,1,2\.5,/);
  assert.equal(JSON.parse(fs.readFileSync(jsonFile, "utf8")).length, 2);
  const again = await client.callTool({ name: "recognize_folder", arguments: { folder } });
  assert.notEqual(again.structuredContent.files_written[0], csvFile);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("recognize_folder stops on out_of_credits and respects the allowlist", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-folder2-")));
  for (const n of ["1.jpg", "2.jpg", "3.jpg"]) fs.writeFileSync(path.join(folder, n), JPEG);
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "k_123456789" }, fakeFetch(402, { error: "out_of_credits", message: "No credits" }, calls));
  const res = await client.callTool({ name: "recognize_folder", arguments: { folder } });
  assert.equal(calls.length, 1);
  assert.equal(res.structuredContent.stopped, "out_of_credits");
  assert.deepEqual(res.structuredContent.files_written, []);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-allow2-")));
  const c2 = await connect({ NEOSATOSHI_ALLOWED_DIRS: other }, fakeFetch(200, sample, []));
  const r2 = await c2.callTool({ name: "recognize_folder", arguments: { folder } });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /NEOSATOSHI_ALLOWED_DIRS/);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

const EXPORT_RESP = {
  filename: "neosatoshi-pokemon-export-2026-11-03.csv", content_type: "text/csv", format: "csv", row_count: 2,
  columns: ["Name", "SKU"], fields: ["name", "sku"], content: "\uFEFFName,SKU\r\nPikachu,BS58\r\nPikachu,BS58",
  dropped_fields: [], skipped: [{ request_id: "req_b", card_index: 1, reason: "correction_not_kept" }], warnings: [],
  missing: [{ request_id: "req_c", reason: "expired" }], generated_at: "2026-11-03T09:00:00.000Z", engine: { commit: "x", inputs: "y" },
};

test("export_cards: one POST /exports with the caller's choice, the file inline with what was left out", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x" }, fakeFetch(200, EXPORT_RESP, calls));
  const res = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a", "req_c"], fields: ["name", "sku"] } });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CARDS_API_BASE}/exports`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { request_ids: ["req_a", "req_c"], fields: ["name", "sku"] });
  const text = res.content[0].text;
  assert.match(text, /2 row\(s\), csv/);
  assert.match(text, /req_c \(expired\)/);
  assert.match(text, /req_b card 1 \(correction_not_kept\)/);
  assert.match(text, /Pikachu,BS58/);
  assert.equal(res.structuredContent.row_count, 2);
});

test("export_cards save_to_folder: a new file in an allowed folder, never overwritten; a refused folder makes no call", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-export-")));
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x", NEOSATOSHI_ALLOWED_DIRS: folder }, fakeFetch(200, EXPORT_RESP, calls));
  const a = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], save_to_folder: folder } });
  const b = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], save_to_folder: folder } });
  assert.equal(a.isError, undefined);
  assert.deepEqual(fs.readdirSync(folder).sort(), ["neosatoshi-pokemon-export-2026-11-03-2.csv", "neosatoshi-pokemon-export-2026-11-03.csv"]);
  assert.equal(fs.readFileSync(path.join(folder, "neosatoshi-pokemon-export-2026-11-03.csv"), "utf8"), EXPORT_RESP.content);
  assert.equal(a.content[0].text.includes("Pikachu,BS58"), false, "the file is written, not repeated in the answer");
  assert.match(b.structuredContent.file_written, /-2\.csv$/);
  const before = calls.length;
  const refused = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], save_to_folder: os.tmpdir() } });
  assert.equal(refused.isError, true);
  assert.equal(calls.length, before);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("export_cards: an API refusal is a tool error, a large file asks for save_to_folder", async () => {
  let client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x" }, fakeFetch(403, { error: "exports_need_own_key", message: "Exports need your own API key: demo detections keep no cards." }, []));
  let res = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"] } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /own API key/);
  client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x" }, fakeFetch(200, { ...EXPORT_RESP, content: "x".repeat(100_001) }, []));
  res = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"] } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /save_to_folder/);
});

test("list_export_presets: GET /exports/presets", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x" }, fakeFetch(200, { presets: [{ id: "recommended-csv" }], fields: [] }, calls));
  const res = await client.callTool({ name: "list_export_presets", arguments: {} });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].url, `${CARDS_API_BASE}/exports/presets`);
  assert.equal(calls[0].init.method, "GET");
});

test("export_cards: tcgpowertools, shopify and ebay options go to POST /exports unchanged", async () => {
  const calls = [];
  const client = await connect({ NEOSATOSHI_API_KEY: "nsk_live_x" }, fakeFetch(200, { ...EXPORT_RESP, format: "ebay", marketplace: "EBAY_DE", currency: "EUR", notices: ["own_photos_not_used"] }, calls));
  const res = await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], format: "ebay", marketplace: "EBAY_DE", one_row_per_card: false, min_price: 0.5, rounding: "end_99", price_source: "cardmarket_trend" } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), { request_ids: ["req_a"], format: "ebay", marketplace: "EBAY_DE", one_row_per_card: false, min_price: 0.5, rounding: "end_99", price_source: "cardmarket_trend" });
  assert.match(res.content[0].text, /eBay site: EBAY_DE, EUR/);
  assert.match(res.content[0].text, /own_photos_not_used/);
  await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], format: "shopify", store_currency: "CHF", variant_mode: "single", markup_percent: 10 } });
  assert.deepEqual(JSON.parse(calls[1].init.body), { request_ids: ["req_a"], format: "shopify", store_currency: "CHF", variant_mode: "single", markup_percent: 10 });
  await client.callTool({ name: "export_cards", arguments: { request_ids: ["req_a"], format: "tcgpowertools", comment: "Toploader" } });
  assert.deepEqual(JSON.parse(calls[2].init.body), { request_ids: ["req_a"], format: "tcgpowertools", comment: "Toploader" });
});
