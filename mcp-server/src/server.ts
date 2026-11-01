import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, detect, resolveApiKey, scrub, type DetectBody } from "./api.js";
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
