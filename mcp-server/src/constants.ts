// Facts about the NeoSatoshi card recognition API that the server relies on.

export const SERVER_NAME = "neosatoshi-card-recognition";
export const SERVER_VERSION = "0.1.0";

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

export const TCG_VALUES = ["pokemon", "onepiece", "lorcana", "yugioh", "magic", "star_wars_unlimited"] as const;
export type Tcg = (typeof TCG_VALUES)[number];

export const SUPPORTED_GAMES = {
  games: [
    {
      tcg: "pokemon",
      name: "Pokémon TCG",
      languages: ["en", "de", "fr", "it", "es", "ja", "ko", "zh (Simplified Chinese)"],
      cards_per_photo: "several (binder pages work, best up to about 20 cards)",
      default: true,
    },
    { tcg: "onepiece", name: "One Piece Card Game", languages: ["en", "ja"], cards_per_photo: "one" },
    { tcg: "lorcana", name: "Disney Lorcana", languages: ["en", "de", "fr", "it"], cards_per_photo: "one" },
    {
      tcg: "yugioh",
      name: "Yu-Gi-Oh! TCG (not OCG)",
      languages: ["en", "de", "fr", "it", "es", "pt"],
      cards_per_photo: "one",
    },
    { tcg: "magic", name: "Magic: The Gathering", languages: ["en", "de", "fr", "it", "es"], cards_per_photo: "one" },
    { tcg: "star_wars_unlimited", name: "Star Wars: Unlimited", languages: ["en", "de", "fr", "it", "es"], cards_per_photo: "one" },
  ],
  limits: {
    image_formats: ["JPEG", "PNG"],
    max_image_size: "12 MB",
    request: "one card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; a binder page with 9 cards about 17 seconds; client timeout 120 seconds",
    demo_key: "10 detections per day per network, no signup",
    billing: "own keys: one credit per detected card; images without a card are not charged",
  },
  not_supported: ["card condition grading"],
  docs: "https://neosatoshi.com/developers/detection-api",
} as const;
