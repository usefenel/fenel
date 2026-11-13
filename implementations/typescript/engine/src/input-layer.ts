// ---------------------------------------------------------------------------
// Input layer — unified parseInput contract
//
// One function powers all input parsing across web / API / Telegram / CLI:
//
//   parseInput(raw: unknown, type: FenelType, ctx?) → ParseResult<unknown>
//
// Dispatch is type-driven, not channel-driven. The same `type` yields the
// same parsed value regardless of where the raw input came from. Callers
// follow up with a SetExpr membership check via `validate.ts`.
//
// Phase 9 sub-step 3 — the dispatcher (parseInput / resolveAtom /
// setExprAtom) is Fenel-bodied via engine-bodies-dispatch.ts's
// `dispatchedParseInput`. The TS function here is a thin shim that
// delegates to the dispatched wrapper. The parseFns registry stays
// TS-side (public extension hook via registerParseFn).
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { FenelType } from "./types";

export type ParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ParseContext = {
  /** Country prefix for ambiguous local phone numbers (e.g. "+33"). */
  countryPrefix?: string;
  /** Pass through anything else parsers might want. */
  [key: string]: unknown;
};

export type ParseFn = (raw: unknown, ctx?: ParseContext) => ParseResult;

// ---------------------------------------------------------------------------
// Registry — keyed by atom name (resolved from FenelType)
// ---------------------------------------------------------------------------

const parseFns = new Map<string, ParseFn>();

/** Register a parse function for the given atom name. */
export function registerParseFn(atomName: string, fn: ParseFn): void {
  parseFns.set(atomName, fn);
}

/** Look up a registered parse function. */
export function getParseFn(atomName: string): ParseFn | undefined {
  return parseFns.get(atomName);
}

// ---------------------------------------------------------------------------
// parseInput — the dispatcher. Phase 9 sub-step 3 — Fenel-bodied via
// dispatchedParseInput.
// ---------------------------------------------------------------------------

export function parseInput(
  raw: unknown,
  type: FenelType,
  ctx?: ParseContext,
): ParseResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const d = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return d.dispatchedParseInput(raw, type, ctx);
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("input-layer") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_input_layer from "./input-layer";
import { registerEngineModule as __reg_input_layer } from "./engine-require";
__reg_input_layer("input-layer", __self_input_layer);
