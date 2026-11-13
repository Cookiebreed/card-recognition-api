// Facts about the NeoSatoshi card recognition API that the server relies on.

export const SERVER_NAME = "neosatoshi-card-recognition";
export const SERVER_VERSION = "0.10.0";

/** The detection endpoint. */
export const API_ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi";

/** The card search and correction API (search, corrections, lookup by id). Same key as detection. */
export const CARDS_API_BASE = "https://europe-west1-neosatoshi.cloudfunctions.net/cardsApi";

/**
 * Public demo key. It is intentionally public and printed in the official docs.
 * 10 detections per day per network, no signup.
 */
export const DEMO_API_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274";

export const REQUEST_TIMEOUT_MS = 120_000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Football and basketball photos go to their own recognizer, which takes at most 4 MB. */
export const FOOTBALL_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const TCG_VALUES = ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon", "cyberpunk", "riftbound", "football", "basketball"] as const;
export type Tcg = (typeof TCG_VALUES)[number];

/** The games of the card search API (search, lookup, corrections): every game but Riftbound, which is detection only (400 unsupported_tcg). */
export const SEARCH_TCG_VALUES = ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited", "digimon", "cyberpunk", "football", "basketball"] as const;

/** Sports cards (football, basketball): own recognizer, player instead of a card name, no prices, no images, no corrections. */
export function isSport(tcg: unknown): boolean {
  return tcg === "football" || tcg === "basketball";
}

/** The image size limit for a game. */
export function maxImageBytes(tcg: unknown): number {
  return isSport(tcg) ? FOOTBALL_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

export const SUPPORTED_GAMES = {
  games: [
    {
      tcg: "pokemon",
      name: "Pokémon TCG",
      languages: ["en", "de", "fr", "it", "es", "ja", "ko", "zh (Simplified Chinese)"],
      cards_per_photo: "several (binder pages work, best up to about 20 cards)",
      default: true,
    },
    { tcg: "onepiece", name: "One Piece Card Game", languages: ["en", "ja"], cards_per_photo: "several (binder pages work)" },
    { tcg: "lorcana", name: "Disney Lorcana", languages: ["en", "de", "fr", "it"], cards_per_photo: "several (binder pages work)" },
    {
      tcg: "yugioh",
      name: "Yu-Gi-Oh! TCG (not OCG)",
      languages: ["en", "de", "fr", "it", "es", "pt"],
      cards_per_photo: "several (binder pages work)",
    },
    { tcg: "magic", name: "Magic: The Gathering", languages: ["en", "de", "fr", "it", "es"], cards_per_photo: "several (binder pages work)" },
    { tcg: "star_wars_unlimited", name: "Star Wars: Unlimited", languages: ["en", "de", "fr", "it", "es"], cards_per_photo: "several (binder pages work)" },
    {
      tcg: "digimon",
      name: "Digimon Card Game (not the 1999 card game or the 2000 trading cards)",
      languages: ["en", "ja"],
      cards_per_photo: "several (binder pages work)",
    },
    { tcg: "cyberpunk", name: "Cyberpunk TCG (by WeirdCo)", languages: ["en", "fr"], cards_per_photo: "several (binder pages work)" },
    {
      tcg: "riftbound",
      name: "Riftbound (the League of Legends TCG by Riot Games; detection only, not in the card search)",
      languages: ["en", "fr and zh (recognized, no price)"],
      cards_per_photo: "several (binder pages work)",
    },
    {
      tcg: "football",
      name: "Football (soccer) cards: Topps, Panini and other makers",
      languages: ["none (football cards have no card language)"],
      cards_per_photo: "several card fronts (binder pages work, best up to about 20 cards; at most 4 MB)",
    },
    {
      tcg: "basketball",
      name: "Basketball cards: NBA and EuroLeague, Panini and Topps",
      languages: ["none (basketball cards have no card language)"],
      cards_per_photo: "several card fronts (binder pages work, best up to about 20 cards; at most 4 MB)",
    },
  ],
  limits: {
    image_formats: ["JPEG", "PNG"],
    max_image_size: "12 MB",
    request: "one card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a binder page with 9 Pokémon cards about 17 seconds, 8 Lorcana cards about 8 seconds; client timeout 120 seconds",
    demo_key: "10 detections per day per network, no signup",
    billing: "own keys: one credit per detected card; images without a card are not charged",
    football:
      "player, release (set, number), season, subset, teams, rookie flag and the suggested parallel with print run; no prices and no images yet; about 6 to 25 seconds per photo; 5 football or basketball photos in progress per key",
    basketball:
      "works like football (same fields, card_id bk-...); NBA cards from Panini and Topps, mainly seasons 2018-19 to 2026-27 plus some older releases, and Panini EuroLeague sets from 2023-24; not WNBA, college, G League or NBL",
    digimon:
      "recognised by card number and name; alternative arts share the number, the printing comes from the picture or is picked from the alternatives (print_unconfirmed); Cardmarket prices (EUR) for English and Japanese printings, TCGplayer (USD) for English only",
    cyberpunk:
      "Beta (Kickstarter) and Retail base cards share the same art, only the β before the number tells them apart (beta flag), and their prices differ a lot; when the photo cannot tell, the printing is picked from the alternatives (print_unconfirmed); finish fixed per printing (Rare and above foil); Cardmarket prices (EUR) for English and French cards, TCGplayer (USD) for English only",
    riftbound:
      "detection only: search_cards, get_card and correct_card do not cover Riftbound (tcg riftbound there is 400 unsupported_tcg, review.search is always null); the printing is the set code + printed number (print_id OGN-066, OGN-066a alternate art, OGN-299* signed, card_id rb-OGN-066), variant names Overnumbered, Signature, Prize Wall or Best Of; when the photo cannot tell the printing, card_id is rb-c-<card_key> without a price and the printings come as alternatives, each priced (print_unconfirmed), to pick yourself; Common and Uncommon exist normal and foil (finish says normal, the photo does not tell them apart: take prices.cardmarket_foil for a foil copy), Rare and above foil only; English prints are priced, Cardmarket (EUR) and TCGplayer (USD) for both finishes; French and Chinese prints are recognized (card_id rb-fr-..., rb-zh-...) without a price, review reason language_not_listed",
    card_search:
      "search_cards and get_card: 0.5 credits per call that returns a card, nothing for no result; correction searches and correct_card are free; demo key: 10 searches and 3 lookups per day per network; football and basketball lookups need the ref of a search result (24 hours); not for Riftbound (detection only)",
  },
  not_supported: ["card condition grading"],
  docs: "https://neosatoshi.com/developers/detection-api",
} as const;
