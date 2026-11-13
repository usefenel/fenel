// ---------------------------------------------------------------------------
// Where a request's session token comes from — ONE reader for the auth
// middleware (`./auth`) and the rate limiter (`./rate-limit`).
//
// The two must agree exactly. When they did not (the limiter took the bearer
// header first and the FIRST duplicate cookie, while auth falls through to the
// cookie when the bearer does not resolve and keeps the LAST duplicate), a
// client with a valid cookie could send a random bearer token, or a decoy
// cookie before the real one, and pay a fresh session bucket on every request
// while still being authenticated by the real cookie.
//
// Host HTTP framing (header parsing). No runtime import, so the limiter can use
// it without pulling in the engine.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "fenel_session";

/** Cookie header to a record. A name that appears twice keeps its LAST value,
 *  and values are percent-decoded (a malformed escape throws). */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** The token of an `Authorization: Bearer <token>` header, or `undefined`. */
export function bearerTokenOf(authorization: string | undefined): string | undefined {
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) return undefined;
  const token = authorization.slice(7).trim();
  return token || undefined;
}

/** The session cookie's value, or `undefined` when absent or empty. */
export function sessionCookieOf(cookie: string | undefined): string | undefined {
  return parseCookies(cookie)[SESSION_COOKIE] || undefined;
}

/** Every token the auth middleware might authenticate this request with, in
 *  the order it tries them: the bearer token, then the session cookie. The
 *  limiter charges a bucket for EACH, so a decoy only adds a bucket and never
 *  replaces the real one. */
export function sessionTokenCandidates(
  authorization: string | undefined,
  cookie: string | undefined,
): string[] {
  const out: string[] = [];
  const bearer = bearerTokenOf(authorization);
  if (bearer) out.push(bearer);
  let fromCookie: string | undefined;
  try {
    fromCookie = sessionCookieOf(cookie);
  } catch {
    // A malformed escape makes the auth middleware throw on this request, so
    // it never authenticates by cookie; the IP bucket still applies.
    fromCookie = undefined;
  }
  if (fromCookie && fromCookie !== bearer) out.push(fromCookie);
  return out;
}
