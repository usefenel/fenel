// ---------------------------------------------------------------------------
// decompose — parser registry (TS) + matchesShape structural recogniser
// (Fenel body).
//
// Phase 7a (ts-elimination) — `matchesShape` moved to a Fenel body at
// `fenel/modules/engine/decompose.fenel`. The parser registry
// (`registerDecomposeParser` / `getDecomposeParser` /
// per-account variants) stays TS — parsers are arbitrary JS functions
// (host-language IO leaves) and the registry is an in-process Map.
//
// Field-identity Phase 3 removed the duplicate DcType classifier. The shared
// descriptor-safe TraversalType boundary is now the only type view; Fenel owns
// wrapper recognition, structural selection, optionality, and recursion.
// DcValue is only a mechanical own-data host-value snapshot.
// ---------------------------------------------------------------------------

import type { FenelType } from "./types";
import { dispatchedMatchesShape } from "./engine-bodies-dispatch";

// ---------------------------------------------------------------------------
// Parser registry — pure TS, in-process Map. Stays TS per Phase 7a brief
// (parsers themselves are host-language IO leaves).
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error?: string };

export type DecomposeParser = (input: unknown) => ParseResult;

const PARSERS = new Map<string, DecomposeParser>();
const ACCOUNT_PARSERS = new Map<string, Map<string, DecomposeParser>>();

/**
 * Register a parser by name.
 */
export function registerDecomposeParser(name: string, parser: DecomposeParser): void {
  PARSERS.set(name, parser);
}

/**
 * Look up a parser by name, optionally consulting an account-scoped
 * registry first.
 */
export function getDecomposeParser(name: string, accountId?: string): DecomposeParser | undefined {
  if (accountId) {
    const accountSet = ACCOUNT_PARSERS.get(accountId);
    const accountParser = accountSet?.get(name);
    if (accountParser) return accountParser;
  }
  return PARSERS.get(name);
}

export function listDecomposeParsers(accountId?: string): string[] {
  const globalNames = Array.from(PARSERS.keys());
  if (!accountId) return globalNames;
  const accountSet = ACCOUNT_PARSERS.get(accountId);
  if (!accountSet) return globalNames;
  const all = new Set(globalNames);
  for (const k of accountSet.keys()) all.add(k);
  return Array.from(all);
}

/** Register a parser scoped to a single account. */
export function registerAccountDecomposeParser(
  accountId: string,
  name: string,
  parser: DecomposeParser,
): void {
  let map = ACCOUNT_PARSERS.get(accountId);
  if (!map) {
    map = new Map();
    ACCOUNT_PARSERS.set(accountId, map);
  }
  map.set(name, parser);
}

/** Remove a single account-scoped parser. */
export function unregisterAccountDecomposeParser(accountId: string, name: string): void {
  const map = ACCOUNT_PARSERS.get(accountId);
  if (!map) return;
  map.delete(name);
  if (map.size === 0) ACCOUNT_PARSERS.delete(accountId);
}

/** Drop all account-scoped parsers for one account. */
export function clearAccountDecomposeParsers(accountId: string): void {
  ACCOUNT_PARSERS.delete(accountId);
}

/** List every parser name currently registered to an account (account-only). */
export function listAccountDecomposeParsers(accountId: string): string[] {
  const map = ACCOUNT_PARSERS.get(accountId);
  return map ? Array.from(map.keys()) : [];
}

// ---------------------------------------------------------------------------
// matchesShape — Fenel-bodied. Thin shim around the dispatched wrapper.
// ---------------------------------------------------------------------------

/**
 * Best-effort shape check: does `value` structurally inhabit `type`?
 *
 * Rules (best-effort and deliberately graded per arm/axis):
 *   $named — accepts anything (we don't dereference names here)
 *   $void — never
 *   $unit — accepts null / undefined / empty record
 *   $variant — value must have a `__case` (or `$tag`) matching one of the cases;
 *              if the matched case has fields, the value must be a record
 *   $record — value must be a non-array object with all required fields
 *   $list — value must be an array; items are not inspected, so this is only
 *           a carrier fact and is DEGRADE evidence for item membership
 *   $maybe — null/undefined OR matchesShape(value, $maybe.inner)
 *   $tuple — value must be an array of the right length
 *   $opaque — descend into pure
 *   $refined — descend into base (set is checked elsewhere)
 *   $tagged — descend into value
 *   anything else — accept (conservative)
 */
export function matchesShape(value: unknown, type: FenelType): boolean {
  return dispatchedMatchesShape(value, type);
}
