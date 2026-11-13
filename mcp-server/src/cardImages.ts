// Reference images of recognised cards as MCP image content, so the assistant can compare them with the user's photo.
// Opt-in (include_images), only from our own card image CDN, at most MAX_IMAGES small images of at most 1 MB each.
// Football and basketball cards have no reference images.

export const CARD_IMAGE_HOST = "d1m1gwcombja0u.cloudfront.net";
export const MAX_IMAGES = 10;
const MAX_BYTES = 1024 * 1024;
/** All images of one answer together (Lorcana's "small" images are about 260 KB each). */
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);

type Obj = Record<string, any>;
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

function allowed(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === CARD_IMAGE_HOST;
  } catch {
    return false;
  }
}

/** Small reference images of the first MAX_IMAGES cards; a card without one, or a failed download, is skipped. */
export async function cardImages(cards: Obj[], fetchImpl: typeof fetch = fetch): Promise<{ images: ImageContent[]; labels: string[] }> {
  const picks = cards
    .map((c, i) => ({ i, c, url: c?.images?.small ?? c?.images?.large }))
    .filter((p) => allowed(p.url))
    .slice(0, MAX_IMAGES);
  const got = await Promise.all(
    picks.map(async (p) => {
      try {
        const res = await fetchImpl(p.url, { signal: AbortSignal.timeout(10_000) });
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!res.ok || !TYPES.has(type)) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_BYTES) return null;
        return { label: `${p.i + 1}. ${p.c.full_name ?? p.c.name ?? "card"}`, image: { type: "image" as const, data: buf.toString("base64"), mimeType: type } };
      } catch {
        return null;
      }
    }),
  );
  const ok: NonNullable<(typeof got)[number]>[] = [];
  let total = 0;
  for (const g of got) {
    if (!g) continue;
    total += g.image.data.length * 0.75;
    if (total > MAX_TOTAL_BYTES) break;
    ok.push(g);
  }
  return { images: ok.map((g) => g.image), labels: ok.map((g) => g.label) };
}
