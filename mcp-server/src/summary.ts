// Turns an API response into a short, readable per-card summary.

type Obj = Record<string, any>;

function fmtPrice(p: Obj | undefined | null, field = "trend"): string | null {
  if (!p || p[field] === null || p[field] === undefined) return null;
  return `${p[field]} ${p.currency ?? ""}`.trim();
}

export function summarizeCard(card: Obj, index: number): string {
  const name = card.full_name ?? card.name ?? "(unknown)";
  const set: Obj = card.set ?? {};
  const setCode = set.ptcgo_code ?? set.code;
  const setPart = [set.name, setCode && setCode !== set.name ? `(${setCode})` : null].filter(Boolean).join(" ");
  const parts: string[] = [`${index + 1}. ${name}`];
  if (card.name_en && card.name_en !== card.name) parts.push(`EN name ${card.full_name_en ?? card.name_en}`);
  if (setPart || set.number) parts.push(`${setPart || "set ?"}${set.number ? ` #${set.number}` : ""}`);
  if (card.card_id && card.tcg === "onepiece") parts.push(card.card_id);
  if (card.passcode) parts.push(`passcode ${card.passcode}`);
  if (card.rarity) parts.push(card.rarity);
  if (card.language) parts.push(card.language);
  if (card.edition && card.edition !== "unlimited") parts.push(card.edition);
  if (card.first_edition) parts.push("1st edition");
  if (card.reverse_holo) parts.push("reverse holo");
  if (card.is_foil) parts.push("foil");
  parts.push(`Cardmarket ${card.cardmarket_id ?? "n/a"}`);
  const trend = fmtPrice(card.prices?.cardmarket);
  if (trend) parts.push(`trend ${trend}`);
  const foilTrend = fmtPrice(card.prices?.cardmarket_foil);
  if (foilTrend) parts.push(`foil trend ${foilTrend}`);
  const tcgp = fmtPrice(card.prices?.tcgplayer, "market");
  if (tcgp) parts.push(`TCGplayer ${tcgp}`);
  if (typeof card.confidence === "number") parts.push(`confidence ${card.confidence}`);
  if (card.image_quality?.blurred) parts.push("photo looks blurred");
  const unsure = Object.keys(card).filter((k) => k.endsWith("_unconfirmed") && card[k] === true);
  if (unsure.length) parts.push(`unconfirmed: ${unsure.map((k) => k.replace(/_unconfirmed$/, "")).join(", ")}`);
  if (Array.isArray(card.alternatives) && card.alternatives.length) {
    parts.push(`${card.alternatives.length} alternatives`);
  }
  return parts.join(" | ");
}

export function summarize(resp: Obj): string {
  const cards: Obj[] = Array.isArray(resp.cards) ? resp.cards : [];
  const lines = [`Detected ${resp.count ?? cards.length} card(s). request_id ${resp.request_id ?? "n/a"}`];
  cards.forEach((c, i) => lines.push(summarizeCard(c, i)));
  if (resp.demo && typeof resp.demo === "object") {
    lines.push(`Demo key: ${resp.demo.remaining_today} of ${resp.demo.limit_per_day} detections left today on this network.`);
  } else if (resp.credits && typeof resp.credits.remaining === "number") {
    lines.push(`Credits remaining: ${resp.credits.remaining}`);
  }
  return lines.join("\n");
}
