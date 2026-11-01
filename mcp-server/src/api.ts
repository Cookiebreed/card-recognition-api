// Client for the one endpoint this server calls. The API key is sent only in the
// Authorization header and is scrubbed from every message that leaves this module.

import { API_ENDPOINT, DEMO_API_KEY, REQUEST_TIMEOUT_MS, SERVER_VERSION, type Tcg } from "./constants.js";

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
  let res: Response;
  try {
    res = await fetchImpl(API_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": `neosatoshi-card-mcp/${SERVER_VERSION}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ApiError(`No answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again.`, null, "client_timeout");
    }
    throw new ApiError(scrub(`Could not reach the API: ${e?.message ?? String(err)}`, key), null, "network_error");
  }

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
