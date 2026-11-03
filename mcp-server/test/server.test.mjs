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
  assert.deepEqual(rec.inputSchema.properties.tcg.enum, ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "football"]);
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
