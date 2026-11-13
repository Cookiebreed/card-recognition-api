#!/usr/bin/env node
// Detect the trading cards in one photo with the NeoSatoshi card recognition API.
//
// Usage: node detect.mjs <image.jpg|image.png> [tcg] [--json] [--review]
//   tcg:      pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited, digimon, cyberpunk, riftbound
//   --json:   also print the full JSON response
//   --review: for every card with review.needed, ask for the set number printed on the card and
//             correct the card when it differs (correction search + correction, both free)
//
// Node.js 18 or newer (built-in fetch), no dependencies.
// Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi";
const CARDS_API = "https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi";
const DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274";
const TCGS = ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon", "cyberpunk", "riftbound"];

// Card search API call (correction search, corrections). Retries 429 after Retry-After and 502/503/504 with backoff.
async function cardsApi(path, body, apiKey = process.env.NEOSATOSHI_API_KEY || DEMO_KEY) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(CARDS_API + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const wait = Number(res.headers.get("retry-after")) || 2 ** (attempt + 1);
    if (![429, 502, 503, 504].includes(res.status) || attempt === 3 || wait > 120) {
      throw new Error(`HTTP ${res.status} ${data.error ?? ""}: ${data.message ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

// Free correction search, built from the card's review.search plus the number read on the photo.
export async function correctionSearch(result, card, number) {
  const body = { request_id: result.correction.request_id, ...card.review.search, ...(number ? { number } : {}) };
  return (await cardsApi("/search", body)).results;
}

// Free correction. Pokémon version: { cardmarket_id: <possible_variants id> } or { reverse_holo: true }.
export async function correct(result, card, cardId, version = {}) {
  const body = { request_id: result.correction.request_id, card_index: card.card_index, card_id: cardId, ...version };
  return (await cardsApi("/corrections", body)).card;
}

// Accept cards with review.needed false; ask a person for the set number of the others and correct them.
export async function reviewCards(result) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const out = [];
  try {
    for (let card of result.cards ?? []) {
      const review = card.review ?? {};
      if (!review.needed) { out.push(card); continue; }
      console.log(`Card ${card.card_index}: ${card.name} #${card.set?.number} needs review (${(review.reasons ?? []).join(", ")})`);
      if (!review.search || !result.correction) {
        console.log("  cannot be corrected here (card back, football, basketball, Riftbound or no correction window)");
        out.push(card);
        continue;
      }
      const number = (await rl.question("  Set number printed on the card (Enter keeps the match): ")).trim();
      if (!number || number === card.set?.number) { out.push(card); continue; }
      // An alternative with that number, else the free correction search. Never pick by score alone.
      let match = (card.alternatives ?? []).find((a) => a.number === number && a.card_id);
      if (!match) {
        const found = await correctionSearch(result, card, number);
        if (found.length === 1) match = found[0];
        else console.log(`  ${found.length} cards match, pick one by hand: ${found.map((c) => c.card_id).join(", ")}`);
      }
      if (match) {
        card = await correct(result, card, match.card_id);
        console.log(`  corrected to ${card.card_id}`);
      }
      out.push(card);
    }
  } finally {
    rl.close();
  }
  return out;
}

// Every detection that answers 200 is charged: do not send the same photo again to be sure.
export async function detect(imagePath, tcg = "pokemon", apiKey = process.env.NEOSATOSHI_API_KEY || DEMO_KEY) {
  const image = (await readFile(imagePath)).toString("base64");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image, tcg }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${data.error ?? ""}: ${data.message ?? text.slice(0, 300)}`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

function summarizeCard(card, i) {
  const s = card.set ?? {};
  const trend = card.prices?.cardmarket?.trend;
  const review = card.review ?? {};
  return [
    `${i + 1}. ${card.full_name ?? card.name}`,
    `${s.name ?? "?"} ${s.ptcgo_code ?? s.code ?? ""} #${s.number ?? "?"}`.replace("  ", " "),
    card.rarity ?? "?",
    card.language ?? "?",
    `Cardmarket ${card.cardmarket_id ?? "n/a"}`,
    `trend ${trend ?? "n/a"} EUR${card.price_basis ? ` (${card.price_basis})` : ""}`,
    `confidence ${card.confidence}`,
    `review: ${review.needed ? (review.reasons ?? []).join(", ") : "no"}`,
  ].join(" | ");
}

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const showJson = argv.includes("--json");
  const [imagePath, tcg = "pokemon"] = args;
  if (!imagePath) {
    console.error("Usage: node detect.mjs <image.jpg|image.png> [tcg] [--json]");
    return 2;
  }
  if (!TCGS.includes(tcg)) {
    console.error(`tcg must be one of ${TCGS.join(", ")}`);
    return 2;
  }
  let data;
  let cards;
  try {
    data = await detect(imagePath, tcg);
    cards = argv.includes("--review") ? await reviewCards(data) : data.cards ?? [];
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  console.log(`Detected ${data.count} card(s)`);
  cards.forEach((c, i) => console.log(summarizeCard(c, i)));
  if (data.demo) console.log(`Demo key: ${data.demo.remaining_today} of ${data.demo.limit_per_day} left today`);
  else if (data.credits) console.log(`Credits remaining: ${data.credits.remaining}`);
  if (showJson) console.log(JSON.stringify(data, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
