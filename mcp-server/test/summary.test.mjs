// The text summary an assistant reads per card: card_index, price basis and the review hint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, summarizeCard } from "../dist/summary.js";

const base = {
  name: "Gallopa",
  tcg: "pokemon",
  set: { name: "Silver Tempest", ptcgo_code: "SIT", number: "189" },
  cardmarket_id: 682000,
  prices: { cardmarket: { trend: 1.2, currency: "EUR" } },
  confidence: 0.85,
};

test("an older response without card_index, review or price_basis still reads cleanly", () => {
  const line = summarizeCard(base, 0);
  assert.match(line, /^1\. Gallopa \| Silver Tempest \(SIT\) #189/);
  assert.match(line, /trend 1\.2 EUR \|/);
  assert.doesNotMatch(line, /undefined|null|review|card_index/);
});

test("card_index, a non-normal price basis and the review hint with the correction request_id", () => {
  const card = {
    ...base,
    card_index: 2,
    reverse_holo: true,
    price_basis: "reverse_holo",
    review: { needed: true, reasons: ["low_confidence"], search: { card_index: 2, tcg: "pokemon", q: "Gallopa" } },
  };
  const text = summarize({ request_id: "req_1", correction: { request_id: "req_fix" }, count: 1, cards: [card] });
  const line = text.split("\n")[1];
  assert.match(line, /^1\. \(card_index 2\) Gallopa/);
  assert.match(line, /trend 1\.2 EUR \(reverse holo price\)/);
  assert.match(line, /review needed: low confidence; to fix: search_cards with request_id req_fix, card_index 2, q "Gallopa" \(free\)/);
  assert.match(line, /then correct_card/);
});

test("special version without its own price; review without a search body; no hint when not needed", () => {
  const special = summarizeCard(
    { ...base, special_variant: "Pokeball", price_basis: "special_variant", prices: { cardmarket: { trend: null } }, review: { needed: true, reasons: ["variant_price_missing"], search: null } },
    0,
  );
  assert.match(special, /Pokeball/);
  assert.match(special, /no Pokeball price on Cardmarket/);
  assert.match(special, /review needed: variant price missing$/);
  const fine = summarizeCard({ ...base, price_basis: "normal", review: { needed: false, reasons: [], search: null } }, 0);
  assert.doesNotMatch(fine, /review|price\)/);
});

test("reasons already shown elsewhere on the line are not repeated", () => {
  const line = summarizeCard(
    { ...base, tcg: "yugioh", print_unconfirmed: true, review: { needed: true, reasons: ["print_unconfirmed", "low_confidence"], search: { card_index: 0, q: "Gallopa" } } },
    0,
    "req_9",
  );
  assert.match(line, /unconfirmed: print/);
  assert.match(line, /review needed: low confidence;/);
  assert.equal(line.match(/print/g).length, 1);
});
