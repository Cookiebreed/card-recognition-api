import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, cardsApi, detect, resolveApiKey, scrub, type DetectBody } from "./api.js";
import { SERVER_NAME, SERVER_VERSION, SUPPORTED_GAMES, TCG_VALUES } from "./constants.js";
import { InputError, normalizeBase64Image, parseAllowedDirs, readImageFile, validateImageUrl } from "./images.js";
import { summarize } from "./summary.js";

export interface ServerOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const RECOGNIZE_DESCRIPTION = [
  "Identify trading cards in a photo with the NeoSatoshi card recognition API.",
  "Games: Pokémon (default; several cards per photo, binder pages work), One Piece, Disney Lorcana, Yu-Gi-Oh! TCG, Magic: The Gathering and Star Wars: Unlimited (one card per photo).",
  "Returns per card: name, language, set, number, rarity, Cardmarket product ID, daily Cardmarket prices in EUR (TCGplayer USD where available), confidence and alternatives.",
  "It does not grade card condition.",
  "Give exactly one image source: image_path (local .jpg/.jpeg/.png, max 12 MB), image_url (public https URL, forwarded to the API) or image_base64.",
  "Uses the API key in NEOSATOSHI_API_KEY; without it, the public demo key is used (10 detections per day per network).",
  "One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period.",
].join(" ");

const SEARCH_DESCRIPTION = [
  "Search the NeoSatoshi card catalog. Results are full card objects like a detection returns (set, number, rarity, Cardmarket product ID, daily prices, images), at most 10, with has_more but no total.",
  "Use it first to fix a wrong detection: pass request_id and card_index from recognize_cards. That correction search is free (5 searches per detected card within 24 hours, at most 5 results), then call correct_card.",
  "Without request_id it is the paid card search: 0.5 credits when it returns a card, nothing for no result.",
  "Query: q (a card name, at least 3 letters, optionally with the number like \"charizard 4/102\", or a printed code like OP01-003), or set + number. Wildcards and set-only or number-only queries are refused.",
].join(" ");

const CORRECT_DESCRIPTION = [
  "Correct a card of a detection to the right catalog card. Free, within 24 hours of the detection, 3 times per card, only for the API key that made the detection.",
  "card_id comes from a correction search result or from the detected card's alternatives. Returns the full corrected card. Corrections also improve the recognition.",
  "Yu-Gi-Oh!: card_id is the passcode, set the printed code (LOB-EN001) to pick a printing. Magic: card_id is the oracle_id with set + number for the printing. One Piece: cardmarket_id picks a parallel.",
].join(" ");

const GET_DESCRIPTION = [
  "Get one card by its card_id (for example to refresh its price or resolve a stored id). 0.5 credits when the card exists, nothing for an unknown card.",
  "For a wrong detection use search_cards with request_id and correct_card instead: those are free.",
].join(" ");

const LANGUAGE = z.string().optional().describe("Card language, e.g. en, de, fr, it, es, pt, ja, ko, zh (per game). Default: the detected card's language, else en.");

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const env = opts.env ?? process.env;
  const allowedDirs = parseAllowedDirs(env.NEOSATOSHI_ALLOWED_DIRS);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "recognize_cards",
    {
      title: "Recognize trading cards in a photo",
      description: RECOGNIZE_DESCRIPTION,
      inputSchema: {
        image_path: z
          .string()
          .optional()
          .describe("Path to a local JPEG or PNG file (max 12 MB). Absolute paths work best; ~ is expanded."),
        image_url: z
          .string()
          .optional()
          .describe("Public https URL of a JPEG or PNG (max 12 MB). Sent to the API as is; this server does not download it."),
        image_base64: z
          .string()
          .optional()
          .describe("Base64-encoded JPEG or PNG (max 12 MB). A data:image/...;base64, prefix is accepted."),
        tcg: z
          .enum(TCG_VALUES)
          .optional()
          .describe("Which game the photo shows. Default: pokemon."),
      },
      annotations: {
        title: "Recognize trading cards",
        readOnlyHint: false, // each detected card uses one credit of the key
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const sources = (["image_path", "image_url", "image_base64"] as const).filter(
        (k) => typeof args[k] === "string" && args[k]!.trim() !== "",
      );
      if (sources.length !== 1) {
        return errorResult(
          sources.length === 0
            ? "Give one image source: image_path, image_url or image_base64."
            : `Give exactly one image source, not ${sources.join(" and ")}.`,
        );
      }

      const { key, isDemo } = resolveApiKey(env);
      try {
        const body: DetectBody = { tcg: args.tcg ?? "pokemon" };
        if (args.image_path) {
          const bytes = await readImageFile(args.image_path, { allowedDirs });
          body.image = bytes.toString("base64");
        } else if (args.image_base64) {
          body.image = normalizeBase64Image(args.image_base64);
        } else {
          body.image_url = validateImageUrl(args.image_url!);
        }

        const resp = await detect(body, key, opts.fetchImpl);
        let text = summarize(resp);
        if (isDemo) text += "\n(Using the public demo key. Set NEOSATOSHI_API_KEY for your own quota.)";
        return {
          content: [
            { type: "text" as const, text },
            { type: "text" as const, text: JSON.stringify(resp) },
          ],
          structuredContent: resp,
        };
      } catch (err) {
        if (err instanceof InputError || err instanceof ApiError) return errorResult(scrub(err.message, key));
        return errorResult(scrub(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, key));
      }
    },
  );

  async function callCards(method: "GET" | "POST", pathAndQuery: string, body?: Record<string, unknown>) {
    const { key } = resolveApiKey(env);
    try {
      const resp = await cardsApi(method, pathAndQuery, body, key, opts.fetchImpl);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp) }],
        structuredContent: resp,
      };
    } catch (err) {
      if (err instanceof ApiError) return errorResult(scrub(err.message, key));
      return errorResult(scrub(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, key));
    }
  }

  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

  server.registerTool(
    "search_cards",
    {
      title: "Search the card catalog",
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        request_id: z.string().optional().describe("request_id of a detection: makes this a free correction search."),
        card_index: z.number().int().min(0).optional().describe("cards[].card_index of the card to correct (with request_id)."),
        tcg: z.enum(TCG_VALUES).optional().describe("Game. Required without request_id; default with it: the detected card's game."),
        q: z.string().optional().describe("Card name (at least 3 letters), optionally with the number, or a printed code."),
        set: z.string().optional().describe("Set id or code, together with number."),
        number: z.string().optional().describe("Card number, together with set (or q)."),
        language: LANGUAGE,
        limit: z.number().int().min(1).max(10).optional().describe("1 to 10 results (correction search: at most 5)."),
      },
      annotations: { title: "Search cards", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => callCards("POST", "/search", clean({ ...args })),
  );

  server.registerTool(
    "correct_card",
    {
      title: "Correct a detected card",
      description: CORRECT_DESCRIPTION,
      inputSchema: {
        request_id: z.string().describe("request_id of the detection."),
        card_index: z.number().int().min(0).describe("cards[].card_index of the card to correct."),
        card_id: z.string().describe("card_id of a search result or an alternative."),
        language: LANGUAGE,
        cardmarket_id: z.number().int().positive().optional().describe("One Piece: picks a parallel printing."),
        set: z.string().optional().describe("Magic, SWU: set of the printing; Yu-Gi-Oh!: the printed code."),
        number: z.string().optional().describe("Magic, SWU: collector number of the printing."),
      },
      annotations: { title: "Correct a card", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => callCards("POST", "/corrections", clean({ ...args })),
  );

  server.registerTool(
    "get_card",
    {
      title: "Get one card by id",
      description: GET_DESCRIPTION,
      inputSchema: {
        tcg: z.enum(TCG_VALUES).describe("Game of the card."),
        card_id: z.string().describe("card_id (Yu-Gi-Oh!: passcode; Magic: oracle_id; SWU: printing id or card_key)."),
        language: LANGUAGE,
        cardmarket_id: z.number().int().positive().optional().describe("One Piece: picks a parallel printing."),
        set: z.string().optional().describe("Magic, SWU: set of the printing; Yu-Gi-Oh!: the printed code."),
        number: z.string().optional().describe("Magic, SWU: collector number of the printing."),
      },
      annotations: { title: "Get a card", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const qs = new URLSearchParams(
        clean({ language: args.language, cardmarket_id: args.cardmarket_id?.toString(), set: args.set, number: args.number }) as Record<string, string>,
      ).toString();
      return callCards("GET", `/cards/${encodeURIComponent(args.tcg)}/${encodeURIComponent(args.card_id)}${qs ? `?${qs}` : ""}`);
    },
  );

  server.registerTool(
    "list_supported_games",
    {
      title: "List supported games",
      description:
        "Lists the games, card languages, tcg values and limits of the NeoSatoshi card recognition API. No API call, no cost.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const g = SUPPORTED_GAMES;
      const lines = g.games.map(
        (x) => `${x.name}: tcg="${x.tcg}", languages ${x.languages.join(", ")}, cards per photo: ${x.cards_per_photo}`,
      );
      lines.push(
        `Images: ${g.limits.image_formats.join(" or ")}, max ${g.limits.max_image_size}.`,
        `Timing: ${g.limits.request}.`,
        `Demo key: ${g.limits.demo_key}. Billing: ${g.limits.billing}.`,
        `Not supported: ${g.not_supported.join(", ")}. Docs: ${g.docs}`,
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: JSON.parse(JSON.stringify(g)) as Record<string, unknown>,
      };
    },
  );

  return server;
}
