import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, cardsApi, detect, detectStream, resolveApiKey, scrub, type DetectBody } from "./api.js";
import { cardImages, MAX_IMAGES } from "./cardImages.js";
import { FOOTBALL_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES, SERVER_NAME, SERVER_VERSION, SEARCH_TCG_VALUES, SUPPORTED_GAMES, TCG_VALUES } from "./constants.js";
import { InputError, normalizeBase64Image, parseAllowedDirs, readImageFile, validateImageUrl } from "./images.js";
import { summarize } from "./summary.js";
import { csvRows, listImages, resolveFolder, stamp, toCsv, writeNew } from "./folder.js";

export interface ServerOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Fetch for the card images (tests); defaults to fetchImpl, then the global fetch. */
  imageFetchImpl?: typeof fetch;
}

const RECOGNIZE_DESCRIPTION = [
  "Identify trading cards in a photo with the NeoSatoshi card recognition API.",
  "Games: Pokémon (default), One Piece, Disney Lorcana, Yu-Gi-Oh! TCG, Magic: The Gathering, Star Wars: Unlimited, Digimon Card Game (English, Japanese), Cyberpunk TCG (English, French) and Riftbound (English; French and Chinese prints recognized without a price; one card per photo for now), several cards per photo (binder pages work, one game per photo), and football (soccer) cards with tcg \"football\" (Topps, Panini and other makers; one card front per photo, max 4 MB).",
  "Returns per card: name, language, set, number, rarity, Cardmarket product ID, daily Cardmarket prices in EUR (TCGplayer USD where available), confidence and alternatives.",
  "Football cards instead: the player, release (set, number), season, subset, teams, rookie flag, a sure flag, alternatives and the parallel (three candidates with print runs, a pick only when the recognizer is sure; a person should confirm it). No prices and no images for football yet; it takes about 6 to 25 seconds.",
  "Digimon (tcg \"digimon\"): recognised by card number and name; alternative arts share the number, so the printing comes from the picture or stays open (print_unconfirmed) with the printings as alternatives. TCGplayer prices only for English Digimon printings. Older Digimon products (the 1999 card game, the 2000 trading cards) are not recognised.",
  "Cyberpunk TCG (tcg \"cyberpunk\"): Beta (Kickstarter) and Retail base cards share the same art, only the β before the number tells them apart (beta flag, print_id WNCB-132 vs WNC-132), and their prices differ a lot; when the photo cannot tell, the printing stays open (print_unconfirmed) with the printings as alternatives. The finish is fixed per printing (finish, is_foil). TCGplayer prices only for English Cyberpunk cards.",
  "Riftbound (tcg \"riftbound\", the League of Legends TCG by Riot Games): detection only, search_cards, get_card and correct_card do not cover it. The printing is the set code + printed number (print_id OGN-066, OGN-066a alternate art, OGN-299* signed; variant Overnumbered, Signature, Prize Wall or Best Of); when the photo cannot tell it, the printing stays open (print_unconfirmed, card_id rb-c-<card_key>, no price) with the printings as priced alternatives to pick yourself. Common and Uncommon exist normal and foil (finish says normal: take prices.cardmarket_foil and prices.tcgplayer.foil for a foil copy), Rare and above foil only. French and Chinese prints (rb-fr-..., rb-zh-...) have no price (review reason language_not_listed).",
  "Graded slabs (PSA, BGS, CGC, for football also SGC; not Riftbound yet) fill graded with the grade read from the label. It does not grade card condition.",
  "Give exactly one image source: image_path (local .jpg/.jpeg/.png, max 12 MB, football 4 MB), image_url (public https URL, forwarded to the API) or image_base64.",
  "Uses the API key in NEOSATOSHI_API_KEY; without it, the public demo key is used (10 detections per day per network).",
  "One card usually takes about 4 seconds, about 10 to 12 seconds on the first request after a quiet period; with a progress token the cards are reported one by one while a binder page is read.",
  `include_images: true adds the catalog image of up to ${MAX_IMAGES} recognised cards, to compare them with the photo.`,
].join(" ");

const SEARCH_DESCRIPTION = [
  "Search the NeoSatoshi card catalog. Results are full card objects like a detection returns (set, number, rarity, Cardmarket product ID, daily prices, images), at most 10, with has_more but no total.",
  "Use it first to fix a wrong detection: pass request_id and card_index from recognize_cards. That correction search is free (5 searches per detected card within 24 hours, at most 5 results), then call correct_card.",
  "Without request_id it is the paid card search: 0.5 credits when it returns a card, nothing for no result.",
  "Query: q (a card name, at least 3 letters, optionally with the number like \"charizard 4/102\", or a printed code like OP01-003; Digimon: a card number alone like BT1-025 works; Cyberpunk: a name in English or French, or a printed number like B132), or set + number (Cyberpunk: set WNCB with number B132 or 132). Wildcards and set-only or number-only queries are refused.",
  "Not for Riftbound: it is detection only (the API answers 400 unsupported_tcg), and a Riftbound detection cannot be corrected.",
  "Football (tcg \"football\"): q only, the player with optional set or season words (\"kane chrome 2023\"), no language, set or number, no prices yet; each result carries a ref for get_card. Football detections cannot be corrected yet.",
].join(" ");

const CORRECT_DESCRIPTION = [
  "Correct a card of a detection to the right catalog card. Free, within 24 hours of the detection, 3 times per card, only for the API key that made the detection.",
  "card_id comes from a correction search result or from the detected card's alternatives. Returns the full corrected card. Corrections also improve the recognition.",
  "Yu-Gi-Oh!: card_id is the passcode, set the printed code (LOB-EN001) to pick a printing. Magic: card_id is the oracle_id with set + number for the printing. One Piece: cardmarket_id picks a parallel. Pokémon: cardmarket_id of one of the card's possible_variants picks that special version (its price comes back), reverse_holo says whether the copy is a reverse holo. Digimon: card_id is a printing id (dg-BT1-025_P1, dg-ja-BT1-025_P1) or dg-c-<number> while the printing is open. Cyberpunk: card_id is a printing id (cp-WNC-132, the Beta cp-WNCB-132, French cp-fr-WNC-132) or cp-c-<card_key> while the printing is open. Riftbound detections cannot be corrected (detection only): pick a printing from the card's alternatives yourself.",
].join(" ");

const GET_DESCRIPTION = [
  "Get one card by its card_id (for example to refresh its price or resolve a stored id). 0.5 credits when the card exists, nothing for an unknown card.",
  "For a wrong detection use search_cards with request_id and correct_card instead: those are free.",
  "Football: pass the ref of a search_cards result (same API key, within 24 hours); the card then comes with all parallels of its subset and their print runs. Without a valid ref the call is refused and free.",
  "Not for Riftbound (detection only).",
].join(" ");

const EXPORT_DESCRIPTION = [
  "Export the cards of up to 20 detections (request_id of recognize_cards or recognize_folder, within 48 hours) as the same file the NeoSatoshi website exports, built by the website's own export code: your account's condition for new cards, corrections made with correct_card, your saved settings, price rules and templates.",
  "Formats: csv/json (custom export; preset = a saved preset id from list_export_presets, or fields and json_mode \"api\"/\"custom\"), tcgpowertools (the TCGPowerTools CSV for Cardmarket), shopify (the Shopify product CSV, prices in the store currency) and ebay (the eBay Seller Hub CSV for one eBay site).",
  "Price options for tcgpowertools, shopify and ebay, like the buttons of the website's pricing step: price_source, min_price, markup_percent and rounding (a markup or rounding replaces your saved price rules; 0 = no markup). tcgpowertools: comment. shopify: store_currency, variant_mode. ebay: marketplace, one_row_per_card. Cards that cannot be exported are named in the answer, never guessed.",
  "Free (no credits). Needs your own API key (demo detections keep no cards) and exports enabled for the account. Football detections cannot be exported yet.",
  "save_to_folder writes the file into a local folder (allowed by NEOSATOSHI_ALLOWED_DIRS, never overwrites); without it the file content comes back in the answer (up to 100 KB).",
].join(" ");

const EXPORT_INLINE_MAX_CHARS = 100_000;

const LANGUAGE = z.string().optional().describe("Card language, e.g. en, de, fr, it, es, pt, ja, ko, zh (per game; Digimon en or ja; Cyberpunk en or fr). Default: the detected card's language, else en. Leave it out for football.");

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
          .describe("Path to a local JPEG or PNG file (max 12 MB, football 4 MB). Absolute paths work best; ~ is expanded."),
        image_url: z
          .string()
          .optional()
          .describe("Public https URL of a JPEG or PNG (max 12 MB). Sent to the API as is; this server does not download it."),
        image_base64: z
          .string()
          .optional()
          .describe("Base64-encoded JPEG or PNG (max 12 MB, football 4 MB). A data:image/...;base64, prefix is accepted."),
        tcg: z
          .enum(TCG_VALUES)
          .optional()
          .describe("Which game the photo shows. Default: pokemon. football for football (soccer) cards. riftbound for Riftbound (detection only)."),
        include_images: z
          .boolean()
          .optional()
          .describe(`Also return the catalog image of up to ${MAX_IMAGES} recognised cards (small images from our CDN). Default false. Football cards have none.`),
      },
      annotations: {
        title: "Recognize trading cards",
        readOnlyHint: false, // each detected card uses one credit of the key
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
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
        const maxBytes = body.tcg === "football" ? FOOTBALL_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
        if (args.image_path) {
          const bytes = await readImageFile(args.image_path, { allowedDirs, maxBytes });
          body.image = bytes.toString("base64");
        } else if (args.image_base64) {
          body.image = normalizeBase64Image(args.image_base64, maxBytes);
        } else {
          body.image_url = validateImageUrl(args.image_url!);
        }

        // With a progress token the client shows progress: stream the detection and report each stage and card.
        const progressToken = extra?._meta?.progressToken;
        let resp: Record<string, unknown>;
        if (progressToken !== undefined) {
          let step = 0;
          let cards = 0;
          resp = await detectStream(body, key, async ({ event, data }) => {
            const message =
              event === "card"
                ? `Card ${++cards}: ${data.card?.full_name ?? data.card?.name ?? "recognised"}`
                : event === "progress"
                  ? `Stage: ${data.stage ?? "working"}`
                  : event === "accepted"
                    ? "Photo accepted"
                    : null;
            if (!message) return;
            try {
              await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: ++step, message } });
            } catch {
              // progress is best effort; the result still comes back
            }
          }, opts.fetchImpl);
        } else {
          resp = await detect(body, key, opts.fetchImpl);
        }
        let text = summarize(resp);
        if (isDemo) text += "\n(Using the public demo key. Set NEOSATOSHI_API_KEY for your own quota.)";
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          { type: "text" as const, text },
          { type: "text" as const, text: JSON.stringify(resp) },
        ];
        if (args.include_images && Array.isArray(resp.cards)) {
          const { images, labels } = await cardImages(resp.cards as Record<string, any>[], opts.imageFetchImpl ?? opts.fetchImpl);
          if (images.length) content.push({ type: "text" as const, text: `Catalog images, in this order: ${labels.join("; ")}` }, ...images);
        }
        return { content, structuredContent: resp };
      } catch (err) {
        if (err instanceof InputError || err instanceof ApiError) return errorResult(scrub(err.message, key));
        return errorResult(scrub(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, key));
      }
    },
  );

  server.registerTool(
    "recognize_folder",
    {
      title: "Recognize every card photo in a folder",
      description: [
        "Recognize all JPEG and PNG photos in one local folder (not its subfolders), one detection per photo, in name order, and write the cards to a new CSV file (and/or a JSON file in the API format) in that folder.",
        "CSV columns: file, card_index, name, tcg, language, set_name, set_code, number, rarity, cardmarket_id, Cardmarket trend and 30 day average in EUR, TCGplayer market in USD, confidence, graded, season, subset, parallel, request_id.",
        "Costs like recognize_cards: one credit per detected card. The demo key allows only 10 detections per day, so use your own key for folders. Stops at max_files (default 20, at most 100) and on errors that would fail every photo (no credits, invalid key, demo limit).",
        "Existing files are never overwritten. With a progress token each photo is reported as it is done.",
      ].join(" "),
      inputSchema: {
        folder: z.string().describe("Path to the folder with the photos. ~ is expanded."),
        tcg: z.enum(TCG_VALUES).optional().describe("Which game the photos show, one game per folder. Default: pokemon."),
        max_files: z.number().int().min(1).max(100).optional().describe("At most this many photos, in name order. Default 20."),
        output: z.enum(["csv", "json", "both"]).optional().describe("Result file(s) to write into the folder. Default csv."),
      },
      annotations: { title: "Recognize a folder", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args, extra) => {
      const { key, isDemo } = resolveApiKey(env);
      const tcg = args.tcg ?? "pokemon";
      const maxBytes = tcg === "football" ? FOOTBALL_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
      try {
        const { dir, files: all } = await listImages(args.folder, allowedDirs);
        const files = all.slice(0, args.max_files ?? 20);
        if (!files.length) return errorResult(`No .jpg, .jpeg or .png files in ${dir}.`);
        const progressToken = extra?._meta?.progressToken;
        const results: { file: string; resp: Record<string, any> }[] = [];
        const problems: string[] = [];
        let stopped: string | null = null;
        for (const [i, file] of files.entries()) {
          try {
            const bytes = await readImageFile(file, { allowedDirs, maxBytes });
            const resp = await detect({ tcg, image: bytes.toString("base64") }, key, opts.fetchImpl);
            results.push({ file, resp });
          } catch (err) {
            const code = err instanceof ApiError ? err.code : null;
            const msg = err instanceof InputError || err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
            problems.push(`${path.basename(file)}: ${scrub(msg, key)}`);
            if (code && ["out_of_credits", "invalid_api_key", "missing_api_key", "demo_limit_reached", "feature_not_enabled"].includes(code)) {
              stopped = code;
              break;
            }
          }
          if (progressToken !== undefined) {
            try {
              await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: i + 1, total: files.length, message: path.basename(file) } });
            } catch {
              // best effort
            }
          }
        }
        const rows = results.flatMap((r) => csvRows(r.file, r.resp));
        const out = args.output ?? "csv";
        const base = `neosatoshi_cards_${stamp()}`;
        const written: string[] = [];
        if (results.length && (out === "csv" || out === "both")) written.push(await writeNew(dir, base, ".csv", toCsv(rows)));
        if (results.length && (out === "json" || out === "both")) {
          const json = results.map((r) => ({ file: path.basename(r.file), ...r.resp }));
          written.push(await writeNew(dir, base, ".json", JSON.stringify(json, null, 2) + "\n"));
        }
        const last = results.at(-1)?.resp;
        const lines = [
          `${results.length} of ${files.length} photo(s) recognised, ${rows.length} card(s)${all.length > files.length ? ` (${all.length - files.length} more photo(s) in the folder, raise max_files)` : ""}.`,
          ...(written.length ? [`Written: ${written.join(", ")}`] : ["Nothing written: no photo was recognised."]),
          ...results.flatMap((r) => [`${path.basename(r.file)}:`, ...summarize(r.resp).split("\n").slice(1).filter((l) => /^\d+\. /.test(l))]),
          ...(problems.length ? ["Not recognised:", ...problems] : []),
          ...(stopped ? [`Stopped early: ${stopped}.`] : []),
        ];
        if (last?.credits && typeof last.credits.remaining === "number") lines.push(`Credits remaining: ${last.credits.remaining}`);
        if (isDemo) lines.push("(Using the public demo key, 10 detections per day. Set NEOSATOSHI_API_KEY for folders.)");
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          structuredContent: { photos: files.length, recognised: results.length, cards: rows.length, files_written: written, problems, stopped },
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
        tcg: z.enum(SEARCH_TCG_VALUES).optional().describe("Game. Required without request_id; default with it: the detected card's game. Riftbound is not in the card search."),
        q: z.string().optional().describe("Card name (at least 3 letters), optionally with the number, or a printed code (Digimon: a card number like BT1-025; Cyberpunk: a printed number like B132). Football: the player, optionally with set or season words."),
        set: z.string().optional().describe("Set id or code, together with number (Digimon: the set code, e.g. BT1 with number 025; Cyberpunk: e.g. WNCB with number B132 or 132)."),
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
        cardmarket_id: z.number().int().positive().optional().describe("One Piece: picks a parallel printing. Pokémon: a possible_variants cardmarket_id of that card picks the special version (any other id: 400 unsupported_cardmarket_id)."),
        reverse_holo: z.boolean().optional().describe("Pokémon only: the copy is (true) or is not (false) a reverse holo. Default: as detected."),
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
        tcg: z.enum(SEARCH_TCG_VALUES).describe("Game of the card. Riftbound is not in the card search."),
        card_id: z.string().describe("card_id (Yu-Gi-Oh!: passcode; Magic: oracle_id; SWU: printing id or card_key; Digimon: dg-... printing id, dg-c-<number> or the bare number BT1-025; Cyberpunk: cp-... printing id, cp-c-<card_key> or the bare card key v-streetkid; football: fb-...)."),
        ref: z.string().optional().describe("Football only, required there: the ref of the search_cards result for this card_id (valid 24 hours)."),
        language: LANGUAGE,
        cardmarket_id: z.number().int().positive().optional().describe("One Piece: picks a parallel printing. Pokémon: a possible_variants cardmarket_id of that card picks the special version (any other id: 400 unsupported_cardmarket_id)."),
        reverse_holo: z.boolean().optional().describe("Pokémon only: true returns the reverse holo price."),
        set: z.string().optional().describe("Magic, SWU: set of the printing; Yu-Gi-Oh!: the printed code."),
        number: z.string().optional().describe("Magic, SWU: collector number of the printing."),
      },
      annotations: { title: "Get a card", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const qs = new URLSearchParams(
        clean({ language: args.language, cardmarket_id: args.cardmarket_id?.toString(), reverse_holo: args.reverse_holo?.toString(), set: args.set, number: args.number, ref: args.ref }) as Record<string, string>,
      ).toString();
      return callCards("GET", `/cards/${encodeURIComponent(args.tcg)}/${encodeURIComponent(args.card_id)}${qs ? `?${qs}` : ""}`);
    },
  );

  server.registerTool(
    "export_cards",
    {
      title: "Export detected cards as CSV or JSON",
      description: EXPORT_DESCRIPTION,
      inputSchema: {
        request_ids: z.array(z.string()).min(1).max(20).describe("request_id of each detection to export, in the order the rows should have."),
        preset: z.string().optional().describe("Id of a saved export preset (list_export_presets). Not together with format, fields or json_mode."),
        format: z.enum(["csv", "json", "tcgpowertools", "shopify", "ebay"]).optional().describe("Default csv (the custom export)."),
        fields: z.array(z.string()).max(100).optional().describe("Field ids in column order (list_export_presets). Default: the recommended columns."),
        json_mode: z.enum(["api", "custom"]).optional().describe("JSON only: api = the documented card shape (fields ignored), custom = your fields. Default api."),
        price_source: z.enum(["cardmarket_30d", "cardmarket_trend", "tcgplayer"]).optional().describe("tcgpowertools, shopify, ebay: the market price to start from. Default cardmarket_30d (tcgplayer not for tcgpowertools)."),
        min_price: z.number().min(0).optional().describe("tcgpowertools, shopify, ebay: a floor for every row (EUR, the store currency, or the eBay site's currency)."),
        markup_percent: z.number().optional().describe("tcgpowertools, shopify, ebay: markup in percent from the market price; replaces the saved price rules. 0 = no markup."),
        rounding: z.enum(["up_full", "down_full", "nearest_10", "end_90", "end_99", "end_49_99", "end_9", "end_5_9"]).optional().describe("tcgpowertools, shopify, ebay: round every price; replaces the saved price rules."),
        comment: z.string().max(500).optional().describe("tcgpowertools: the Cardmarket comment for every row (default: the one saved on the website)."),
        store_currency: z.string().length(3).optional().describe("shopify: your Shopify store's currency, e.g. EUR (default: read from your connected store)."),
        variant_mode: z.enum(["variants", "single"]).optional().describe("shopify: one product per card with variants, or one product per language, condition and printing (default: your saved choice)."),
        marketplace: z.string().optional().describe("ebay: the eBay site, e.g. EBAY_DE, EBAY_US, EBAY_GB (default: your saved one)."),
        one_row_per_card: z.boolean().optional().describe("ebay: one CSV row per copy instead of one row with a quantity."),
        save_to_folder: z.string().optional().describe("Local folder to write the file into (~ is expanded). Existing files are never overwritten."),
      },
      annotations: { title: "Export cards", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const { key } = resolveApiKey(env);
      try {
        // Checked before the call, so a refused folder costs no export.
        const dir = args.save_to_folder ? await resolveFolder(args.save_to_folder, allowedDirs) : null;
        const resp: Record<string, any> = await cardsApi(
          "POST",
          "/exports",
          clean({
            request_ids: args.request_ids, preset: args.preset, format: args.format, fields: args.fields, json_mode: args.json_mode,
            price_source: args.price_source, min_price: args.min_price, markup_percent: args.markup_percent, rounding: args.rounding,
            comment: args.comment, store_currency: args.store_currency, variant_mode: args.variant_mode, marketplace: args.marketplace,
            one_row_per_card: args.one_row_per_card,
          }),
          key,
          opts.fetchImpl,
        );
        const content = typeof resp.content === "string" ? resp.content : "";
        const meta = { ...resp };
        delete meta.content;
        const lines = [`${resp.row_count ?? 0} row(s), ${resp.format ?? "csv"}, ${resp.filename ?? ""}.`];
        if (Array.isArray(resp.missing) && resp.missing.length) lines.push(`Not found: ${resp.missing.map((m: any) => `${m.request_id} (${m.reason})`).join(", ")}`);
        if (Array.isArray(resp.skipped) && resp.skipped.length) lines.push(`Left out: ${resp.skipped.map((m: any) => `${m.request_id} card ${m.card_index} (${m.reason})`).join(", ")}`);
        if (Array.isArray(resp.warnings) && resp.warnings.length) lines.push(`Check: ${resp.warnings.map((m: any) => `${m.request_id} card ${m.card_index} (${m.code})`).join(", ")}`);
        if (Array.isArray(resp.dropped_fields) && resp.dropped_fields.length) lines.push(`Unknown fields ignored: ${resp.dropped_fields.join(", ")}`);
        if (resp.store_currency) lines.push(`Store currency: ${resp.store_currency}${resp.store_currency_source ? ` (${resp.store_currency_source})` : ""}`);
        if (resp.marketplace) lines.push(`eBay site: ${resp.marketplace}${resp.currency ? `, ${resp.currency}` : ""}`);
        if (Array.isArray(resp.notices) && resp.notices.length) lines.push(`Notes: ${resp.notices.map((n: any) => (typeof n === "string" ? n : n?.code ?? JSON.stringify(n))).join(", ")}`);
        if (dir) {
          const name = String(resp.filename || `neosatoshi-export.${resp.format === "json" ? "json" : "csv"}`);
          const ext = resp.format === "json" ? ".json" : ".csv";
          const base = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "neosatoshi-export";
          const file = await writeNew(dir, base, ext, content);
          lines.push(`Written: ${file}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }], structuredContent: { ...meta, file_written: file } };
        }
        if (content.length > EXPORT_INLINE_MAX_CHARS) {
          return errorResult(`${lines[0]} The file is ${content.length} characters, too large to return here: call export_cards again with save_to_folder. Nothing was charged.`);
        }
        return {
          content: [{ type: "text" as const, text: `${lines.join("\n")}\n\n${content}` }],
          structuredContent: { ...meta, content },
        };
      } catch (err) {
        if (err instanceof InputError || err instanceof ApiError) return errorResult(scrub(err.message, key));
        return errorResult(scrub(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, key));
      }
    },
  );

  server.registerTool(
    "list_export_presets",
    {
      title: "List export presets and fields",
      description: "Lists the account's saved export presets (from the NeoSatoshi website, plus the built-in recommended CSV) and every field id export_cards takes. Free. Needs your own API key.",
      inputSchema: {},
      annotations: { title: "List export presets", readOnlyHint: true, openWorldHint: true },
    },
    async () => callCards("GET", "/exports/presets"),
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
        `Digimon: ${g.limits.digimon}.`,
        `Cyberpunk TCG: ${g.limits.cyberpunk}.`,
        `Riftbound: ${g.limits.riftbound}.`,
        `Football: ${g.limits.football}.`,
        `Card search: ${g.limits.card_search}.`,
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
