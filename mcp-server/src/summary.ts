// Turns an API response into a short, readable per-card summary.

type Obj = Record<string, any>;

function fmtPrice(p: Obj | undefined | null, field = "trend"): string | null {
  if (!p || p[field] === null || p[field] === undefined) return null;
  return `${p[field]} ${p.currency ?? ""}`.trim();
}

function fmtRun(run: unknown): string {
  return typeof run === "number" ? ` /${run}` : "";
}

/** "1. " plus the card_index that search_cards and correct_card need (older responses lack it). */
function lead(card: Obj, index: number): string {
  return `${index + 1}. ${typeof card.card_index === "number" ? `(card_index ${card.card_index}) ` : ""}`;
}

const PRICE_BASIS: Record<string, string> = { reverse_holo: "reverse holo", first_edition: "1st Edition" };

/** What prices.cardmarket describes when it is not the plain card (Pokémon). */
function priceBasis(card: Obj): string | null {
  const b = card.price_basis;
  if (typeof b !== "string" || !b || b === "normal") return null;
  if (b === "special_variant") return `${typeof card.special_variant === "string" && card.special_variant ? card.special_variant : "special version"} price`;
  return `${PRICE_BASIS[b] ?? b.replace(/_/g, " ")} price`;
}

/** The review hint: its reasons, plus how to fix the card when it can be corrected. */
function review(card: Obj, requestId: string | null, shown: string[] = []): string | null {
  const r: Obj | null | undefined = card.review;
  if (!r || typeof r !== "object" || r.needed !== true) return null;
  const reasons = (Array.isArray(r.reasons) ? r.reasons : []).filter((x: unknown): x is string => typeof x === "string" && !shown.includes(x));
  let text = `review needed${reasons.length ? `: ${reasons.map((x) => x.replace(/_/g, " ")).join(", ")}` : ""}`;
  const s: Obj | null | undefined = r.search;
  if (s && typeof s === "object" && typeof s.card_index === "number") {
    const args = [`request_id ${requestId ?? "of this detection"}`, `card_index ${s.card_index}`];
    if (typeof s.q === "string" && s.q) args.push(`q "${s.q}"`);
    text += `; to fix: search_cards with ${args.join(", ")} (free) or an alternative whose set number matches the photo, then correct_card`;
  }
  return text;
}

function graded(card: Obj): string | null {
  const g: Obj | null | undefined = card.graded;
  if (!g || typeof g !== "object") return null;
  return `graded ${[g.grader ?? "unknown grader", g.grade].filter(Boolean).join(" ")}`;
}

/** Football cards: player, release, parallel; no Cardmarket id and no prices. */
function summarizeFootball(card: Obj, index: number, requestId: string | null): string {
  const set: Obj = card.set ?? {};
  const parts: string[] = [`${lead(card, index)}${card.name ?? "(unknown)"}`];
  if (set.name || set.number) parts.push(`${set.name ?? "set ?"}${set.number ? ` #${set.number}` : ""}`);
  if (card.subset) parts.push(card.subset);
  if (Array.isArray(card.teams) && card.teams.length) parts.push(card.teams.join(", "));
  if (card.rookie) parts.push("rookie");
  const p: Obj | null | undefined = card.parallel;
  if (p?.pick?.name) parts.push(`parallel ${p.pick.name}${fmtRun(p.pick.print_run)} (suggested, confirm it)`);
  else if (Array.isArray(p?.candidates) && p.candidates.length) {
    parts.push(`parallel unsure: ${p.candidates.map((c: Obj) => `${c.name}${fmtRun(c.print_run)}`).join(", ")}`);
  }
  if (p?.serial_number) parts.push(`serial ${p.serial_number}`);
  if (Array.isArray(card.parallels)) parts.push(`${card.parallels.length} parallels`);
  const g = graded(card);
  if (g) parts.push(g);
  if (card.sure === false) parts.push("not sure, check the alternatives");
  if (Array.isArray(card.alternatives) && card.alternatives.length) parts.push(`${card.alternatives.length} alternatives`);
  parts.push("no price yet");
  const rv = review(card, requestId, card.sure === false ? ["not_sure"] : []);
  if (rv) parts.push(rv);
  return parts.join(" | ");
}

/** Riftbound: the printing id with its kind of print ("OGN-299* Signature"); a signed print (star) without a variant says "signed". */
function riftboundPrint(card: Obj): string {
  const variant = typeof card.variant === "string" && card.variant ? card.variant : null;
  const signed = !variant && String(card.print_id).endsWith("*");
  return variant ? `${card.print_id} ${variant}` : signed ? `${card.print_id} signed` : card.print_id;
}

export function summarizeCard(card: Obj, index: number, requestId: string | null = null): string {
  if (card.tcg === "football") return summarizeFootball(card, index, requestId);
  const name = card.full_name ?? card.name ?? "(unknown)";
  const set: Obj = card.set ?? {};
  const setCode = set.ptcgo_code ?? set.code;
  const setPart = [set.name, setCode && setCode !== set.name ? `(${setCode})` : null].filter(Boolean).join(" ");
  const parts: string[] = [`${lead(card, index)}${name}`];
  if (card.name_en && card.name_en !== card.name) parts.push(`EN name ${card.full_name_en ?? card.name_en}`);
  if (setPart || set.number) parts.push(`${setPart || "set ?"}${set.number ? ` #${set.number}` : ""}`);
  if (card.card_id && card.tcg === "onepiece") parts.push(card.card_id);
  if (card.tcg === "digimon" && card.print_id) parts.push(card.variant ? `${card.print_id} ${card.variant}` : card.print_id);
  if (card.tcg === "cyberpunk" && card.print_id) parts.push(card.beta === true ? `${card.print_id} Beta` : card.print_id);
  if (card.tcg === "riftbound" && card.print_id) parts.push(riftboundPrint(card));
  if (card.passcode) parts.push(`passcode ${card.passcode}`);
  if (card.rarity) parts.push(card.rarity);
  if (card.language) parts.push(card.language);
  if (card.edition && card.edition !== "unlimited") parts.push(card.edition);
  if (card.first_edition) parts.push("1st edition");
  if (card.reverse_holo) parts.push("reverse holo");
  if (typeof card.special_variant === "string" && card.special_variant) parts.push(card.special_variant);
  if (card.is_foil) parts.push("foil");
  parts.push(`Cardmarket ${card.cardmarket_id ?? "n/a"}`);
  const trend = fmtPrice(card.prices?.cardmarket);
  const basis = priceBasis(card);
  if (trend) parts.push(`trend ${trend}${basis ? ` (${basis})` : ""}`);
  else if (basis) parts.push(`no ${basis} on Cardmarket`);
  const foilTrend = fmtPrice(card.prices?.cardmarket_foil);
  if (foilTrend) parts.push(`foil trend ${foilTrend}`);
  const tcgp = fmtPrice(card.prices?.tcgplayer, "market");
  if (tcgp) parts.push(`TCGplayer ${tcgp}`);
  // Riftbound only: Common / Uncommon carry a normal and a foil family; every other game's line stays as it was
  const tcgpFoil = card.tcg === "riftbound" ? fmtPrice(card.prices?.tcgplayer, "foil") : null;
  if (tcgpFoil) parts.push(`TCGplayer foil ${tcgpFoil}`);
  const g = graded(card);
  if (g) parts.push(g);
  if (typeof card.confidence === "number") parts.push(`confidence ${card.confidence}`);
  if (card.image_quality?.blurred) parts.push("photo looks blurred");
  const unsure = Object.keys(card).filter((k) => k.endsWith("_unconfirmed") && card[k] === true);
  if (unsure.length) parts.push(`unconfirmed: ${unsure.map((k) => k.replace(/_unconfirmed$/, "")).join(", ")}`);
  if (Array.isArray(card.alternatives) && card.alternatives.length) {
    parts.push(`${card.alternatives.length} alternatives`);
  }
  const rv = review(card, requestId, [...unsure, ...(card.image_quality?.blurred ? ["blurred"] : [])]);
  if (rv) parts.push(rv);
  return parts.join(" | ");
}

export function summarize(resp: Obj): string {
  const cards: Obj[] = Array.isArray(resp.cards) ? resp.cards : [];
  const lines = [`Detected ${resp.count ?? cards.length} card(s). request_id ${resp.request_id ?? "n/a"}`];
  const fixId = resp.correction?.request_id ?? resp.request_id;
  cards.forEach((c, i) => lines.push(summarizeCard(c, i, typeof fixId === "string" ? fixId : null)));
  if (resp.demo && typeof resp.demo === "object") {
    lines.push(`Demo key: ${resp.demo.remaining_today} of ${resp.demo.limit_per_day} detections left today on this network.`);
  } else if (resp.credits && typeof resp.credits.remaining === "number") {
    lines.push(`Credits remaining: ${resp.credits.remaining}`);
  }
  return lines.join("\n");
}
