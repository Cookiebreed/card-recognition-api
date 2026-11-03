#!/usr/bin/env node
// Detect the trading cards in one photo with the NeoSatoshi card recognition API.
//
// Usage: node detect.mjs <image.jpg|image.png> [tcg] [--json]
//   tcg:    pokemon (default), onepiece, lorcana, yugioh, magic, star_wars_unlimited, digimon
//   --json: also print the full JSON response
//
// Node.js 18 or newer (built-in fetch), no dependencies.
// Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi";
const DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274";
const TCGS = ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon"];

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
  return [
    `${i + 1}. ${card.full_name ?? card.name}`,
    `${s.name ?? "?"} ${s.ptcgo_code ?? s.code ?? ""} #${s.number ?? "?"}`.replace("  ", " "),
    card.rarity ?? "?",
    card.language ?? "?",
    `Cardmarket ${card.cardmarket_id ?? "n/a"}`,
    `trend ${trend ?? "n/a"} EUR`,
    `confidence ${card.confidence}`,
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
  try {
    data = await detect(imagePath, tcg);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  console.log(`Detected ${data.count} card(s)`);
  (data.cards ?? []).forEach((c, i) => console.log(summarizeCard(c, i)));
  if (data.demo) console.log(`Demo key: ${data.demo.remaining_today} of ${data.demo.limit_per_day} left today`);
  else if (data.credits) console.log(`Credits remaining: ${data.credits.remaining}`);
  if (showJson) console.log(JSON.stringify(data, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
