// Client for the one endpoint this server calls. The API key is sent only in the
// Authorization header and is scrubbed from every message that leaves this module.

import { API_ENDPOINT, CARDS_API_BASE, DEMO_API_KEY, REQUEST_TIMEOUT_MS, SERVER_VERSION, type Tcg } from "./constants.js";

export interface DetectBody {
  image?: string;
  image_url?: string;
  tcg: Tcg;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): { key: string; isDemo: boolean } {
  const fromEnv = env.NEOSATOSHI_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, isDemo: fromEnv === DEMO_API_KEY };
  return { key: DEMO_API_KEY, isDemo: true };
}

/** Removes the key from any text, in case an upstream message ever echoed it. */
export function scrub(text: string, key: string): string {
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

const RETRY_HINT: Record<number, string> = {
  502: "A backend step failed. Retrying usually works.",
  504: "Detection timed out (often a cold start). Retrying usually works.",
};

export async function detect(
  body: DetectBody,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return request(API_ENDPOINT, "POST", body, key, fetchImpl);
}

export interface StreamEvent {
  event: string;
  data: Record<string, any>;
}

/**
 * The detection as Server-Sent Events ("stream": true): onEvent sees accepted, progress and each card as it is
 * recognised; resolves with the `done` body (the same body as the plain JSON response). Errors before the detection
 * starts come back as plain JSON and throw like detect(). A stream without a final event throws and is NOT resent:
 * a resend is a new, charged detection.
 */
export async function detectStream(
  body: DetectBody,
  key: string,
  onEvent: (e: StreamEvent) => void | Promise<void>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(API_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": `neosatoshi-card-mcp/${SERVER_VERSION}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err, key);
  }
  if (!res.headers.get("content-type")?.startsWith("text/event-stream") || !res.body) {
    return parseResponse(res, key);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: ?(.*)$/m.exec(block)?.[1]?.trim();
        const raw = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.replace(/^data: ?/, "")).join("\n");
        if (!event || !raw) continue;
        let data: Record<string, any>;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        if (event === "done") return data;
        if (event === "error") {
          const parts = [`API error ${data.status ?? ""} ${data.error ?? ""}`.replace(/\s+/g, " ").trim()];
          if (data.message) parts.push(String(data.message));
          throw new ApiError(scrub(parts.join(": "), key), typeof data.status === "number" ? data.status : null, data.error ?? null);
        }
        await onEvent({ event, data });
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw networkError(err, key);
  }
  throw new ApiError(
    "The stream ended without a result. Cards may have been charged; check before sending the photo again.",
    null,
    "stream_incomplete",
  );
}

function networkError(err: unknown, key: string): ApiError {
  const e = err as Error;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new ApiError(`No answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again.`, null, "client_timeout");
  }
  return new ApiError(scrub(`Could not reach the API: ${e?.message ?? String(err)}`, key), null, "network_error");
}

/** One call to the card search and correction API: POST /search, POST /corrections, GET /cards/{tcg}/{card_id}. */
export async function cardsApi(
  method: "GET" | "POST",
  pathAndQuery: string,
  body: Record<string, unknown> | undefined,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return request(`${CARDS_API_BASE}${pathAndQuery}`, method, body, key, fetchImpl);
}

async function request(
  url: string,
  method: "GET" | "POST",
  body: unknown,
  key: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": `neosatoshi-card-mcp/${SERVER_VERSION}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err, key);
  }
  return parseResponse(res, key);
}

async function parseResponse(res: Response, key: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const code = typeof json?.error === "string" ? json.error : null;
    const msg = typeof json?.message === "string" ? json.message : null;
    const parts = [`API error ${res.status}${code ? ` ${code}` : ""}`];
    if (msg) parts.push(msg);
    else if (!json && text) parts.push(text.slice(0, 300));
    if (RETRY_HINT[res.status]) parts.push(RETRY_HINT[res.status]);
    if (code === "demo_limit_reached") {
      parts.push("Set NEOSATOSHI_API_KEY to your own key: https://neosatoshi.com/dashboard/settings/settings#api-keys");
    }
    throw new ApiError(scrub(parts.join(": "), key), res.status, code);
  }
  if (!json) throw new ApiError("The API answered with something that is not JSON.", res.status, "bad_response");
  return json;
}
