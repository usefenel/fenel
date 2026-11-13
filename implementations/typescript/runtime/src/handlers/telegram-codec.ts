// ---------------------------------------------------------------------------
// camelCase ↔ snake_case codec for the Telegram wire protocol.
//
// Phase 11b sub-step 1 — all 4 public exports are now Fenel-bodied via
// `runtime-bodies-dispatch.ts`. The bodies live at
// `fenel/modules/runtime/codecs.fenel`; the marshalling layer lives
// in `runtime/src/runtime-bodies-dispatch.ts`. These exports are thin
// lazy-require shims so callers continue to import from the same path.
//
// Conversion semantics (preserved byte-for-byte by the Fenel bodies):
//   - The codec walks plain objects + arrays recursively. Strings
//     inside values (e.g. message text) are NEVER touched — only
//     object keys.
//   - Sum-type discriminators (the `$tag` field that Fenel uses for
//     sums) are preserved unchanged through the walk.
//   - Outbound: camelCase keys -> snake_case keys.
//   - Inbound: snake_case keys -> camelCase keys.
// ---------------------------------------------------------------------------

/** Convert a camelCase identifier to snake_case. Numbers are kept attached
 *  to the trailing segment (e.g. `httpRequest2` → `http_request2`). */
export function camelToSnake(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedCamelToSnake } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedCamelToSnake(s);
}

/** Convert a snake_case identifier to camelCase. Leading underscores are
 *  preserved (we don't normally see them, but if Telegram ever emits one
 *  we leave it alone). */
export function snakeToCamel(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSnakeToCamel } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedSnakeToCamel(s);
}

/** Outbound: convert a Fenel-shaped record (camelCase keys) to the Telegram
 *  wire shape (snake_case keys). Used on every request body. */
export function toTelegramWire(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedToTelegramWire } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedToTelegramWire(value);
}

/** Inbound: convert a Telegram response (snake_case keys) to the Fenel
 *  shape (camelCase keys). Used on the `result` field of every response. */
export function fromTelegramWire(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedFromTelegramWire } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedFromTelegramWire(value);
}
