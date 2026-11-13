// ---------------------------------------------------------------------------
// Notion HTTP transport — direct calls to https://api.notion.com.
//
// `callNotion(token, method, path, body?)` handles auth, the `Notion-Version`
// header, JSON serialization, and snake-case body conversion via
// `toNotionWire`. Returns the parsed envelope with snake→camel applied;
// the handler then runs typed decoders (decodePage, decodeBlock, …) on
// top.
//
// Rate limiting: on HTTP 429 with `Retry-After`, we throw
// NotionRateLimitError carrying the wait time. The handler catches this
// and converts to a Fenel `waiting_timer` suspend (mirroring Telegram).
// Other non-2xx responses throw a plain Error.
// ---------------------------------------------------------------------------

import { toNotionWire, fromNotionWire } from "./notion-codec";

const API_BASE = "https://api.notion.com/v1";

/** The Notion API version we pin. Notion requires this header on every
 *  request; older versions can change response shapes. Bump deliberately
 *  and re-test response shapes against the engine module's declared
 *  return types when you do. */
const NOTION_VERSION = "2022-06-28";

export type NotionRequestMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Thrown when Notion returns 429 with a `Retry-After` indicator. The
 *  handler converts this into a Fenel `waiting_timer` suspend so the
 *  durable runtime resumes after the wait, mirroring Telegram's
 *  rate-limit path. */
export class NotionRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly description: string,
  ) {
    super(`Notion rate-limited: retry after ${retryAfterSeconds}s — ${description}`);
    this.name = "NotionRateLimitError";
  }
}

/** Send one HTTP request to the Notion API.
 *
 *  - `token` is the integration's internal token (`secret_…`).
 *  - `path` starts with `/` and does NOT include the API base; e.g.
 *    `"/pages/abc123"`, `"/databases/xyz/query"`.
 *  - `body`, when provided, is converted from Fenel camelCase to
 *    snake_case before serialization.
 *  - Returns the parsed JSON response with snake_case keys rewritten to
 *    camelCase. Throws on non-2xx; specifically throws
 *    NotionRateLimitError on 429 with Retry-After (or a default wait).
 */
export async function callNotion(
  token: string,
  method: NotionRequestMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!token) {
    throw new Error(`callNotion: 'token' is required (Notion integration secret)`);
  }
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(toNotionWire(body));
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Notion ${method} ${path} returned non-JSON (status ${resp.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  if (resp.status === 429) {
    const retryAfterHeader = resp.headers.get("Retry-After") ?? resp.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? parseRetryAfter(retryAfterHeader) : 30;
    const err = parsed as { message?: string } | null;
    throw new NotionRateLimitError(retryAfter, err?.message ?? `rate limited`);
  }

  if (!resp.ok) {
    const err = parsed as { message?: string; code?: string } | null;
    const message = err?.message ?? `request failed`;
    const code = err?.code ? ` [${err.code}]` : "";
    throw new Error(
      `Notion ${method} ${path} failed (${resp.status})${code}: ${message}`,
    );
  }

  return fromNotionWire(parsed);
}

/** Parse a `Retry-After` header value (RFC 7231): either a non-negative
 *  number of seconds OR an HTTP-date. Returns seconds, with a 1s floor
 *  to avoid tight resume loops and a 1h cap to avoid pathological
 *  blocking. Defaults to 30s on unparseable input. */
function parseRetryAfter(value: string): number {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (Number.isFinite(n) && n >= 0) return clamp(n);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const delta = Math.ceil((date - Date.now()) / 1000);
    return clamp(delta);
  }
  return 30;
}

function clamp(seconds: number): number {
  if (seconds < 1) return 1;
  if (seconds > 3600) return 3600;
  return seconds;
}
