// Turns an API response into a short, readable per-card summary.

type Obj = Record<string, any>;

function fmtPrice(p: Obj | undefined | null, field = "trend"): string | null {
  if (!p || p[field] === null || p[field] === undefined) return null;
  return `${p[field]} ${p.currency ?? ""}`.trim();
}

function fmtRun(run: unknown): string {
  return typeof run === "number" ? ` /${run}` : "";
}

function graded(card: Obj): string | null {
  const g: Obj | null | undefined = card.graded;
  if (!g || typeof g !== "object") return null;
  return `graded ${[g.grader ?? "unknown grader", g.grade].filter(Boolean).join(" ")}`;
}

/** Football cards: player, release, parallel; no Cardmarket id and no prices. */
function summarizeFootball(card: Obj, index: number): string {
  const set: Obj = card.set ?? {};
  const parts: string[] = [`${index + 1}. ${card.name ?? "(unknown)"}`];
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
  return parts.join(" | ");
}

export function summarizeCard(card: Obj, index: number): string {
  if (card.tcg === "football") return summarizeFootball(card, index);
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
  const g = graded(card);
  if (g) parts.push(g);
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
