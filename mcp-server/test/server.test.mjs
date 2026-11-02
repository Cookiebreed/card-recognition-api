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
  assert.deepEqual(tools.map((t) => t.name).sort(), ["correct_card", "get_card", "list_supported_games", "recognize_cards", "search_cards"]);
  assert.match(tools.find((t) => t.name === "search_cards").description, /free/);
  assert.match(tools.find((t) => t.name === "get_card").description, /0\.5 credits/);
  const rec = tools.find((t) => t.name === "recognize_cards");
  assert.match(rec.description, /demo key/);
  assert.deepEqual(rec.inputSchema.properties.tcg.enum, ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited"]);
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
});

test("cards API errors come back as tool errors without the key", async () => {
  const key = "nsk_live_secret_for_error_test";
  const client = await connect({ NEOSATOSHI_API_KEY: key }, fakeFetch(429, { error: "correction_budget_exhausted", message: `used up for ${key}` }, []));
  const res = await client.callTool({ name: "search_cards", arguments: { request_id: "req_abc12345", card_index: 0, q: "pikachu" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /429 correction_budget_exhausted/);
  assert.ok(!JSON.stringify(res).includes(key));
});
