// Value-only Maybe transport, independent of type construction and registry loading.
import type { Maybe } from "./type-foundation";

/** Value-side constructor for `Maybe.Just`. Positional binding emits `_0`
 *  (Phase 10a-6 — no more `value` field name). */
export function Just<T>(value: T): Maybe<T> {
  return { $tag: "Just", _0: value };
}

/** Value-side constant for `Maybe.Nothing`. Annotated `Maybe<never>` so it
 *  widens to `Maybe<T>` at any use site. */
export const Nothing: Maybe<never> = { $tag: "Nothing" };

/** Peel a Maybe value to its inner T, returning `null` for Nothing. The
 *  value-level companion to `peelMaybe(t)` in `set-algebra.ts` (which works
 *  on FenelType, not values). Use sparingly — prefer pattern-matching on the
 *  Fenel side, and direct `$tag` discrimination on the TS side. This helper
 *  exists for the thin "if (m.$tag === 'Just') use m._0" branches that
 *  otherwise need a guarded local. */
export function peelMaybeValue<T>(m: Maybe<T> | null | undefined): T | null {
  if (m == null) return null;
  return m.$tag === "Just" ? m._0 : null;
}

/** Recognise a Fenel `Bool` VALUE in either of its representations: the
 *  JS-boolean carrier (`true` / `false`, what comparators, literals and the
 *  `construct` fast path produce) or the pure ADT value (`{$tag: "True"}` /
 *  `{$tag: "False"}`, what decoded data and tag-built values carry). Answers
 *  `undefined` for every non-Bool, so each caller keeps its OWN fallback for
 *  other values (the evaluator's `truthy` and JS truthiness differ on `"0"`
 *  and `[]` on purpose). Like a `True` / `False` pattern, it reads only an own
 *  data `$tag`; an inherited or accessor `$tag` is not a Bool. */
export function boolValueOf(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  // No `catch`: a throwing Proxy trap must leave through the evaluator's door
  // unchanged (tcb-ledger `mem.where.frame`, the door invariant), never be
  // absorbed into a verdict here.
  const d = Object.getOwnPropertyDescriptor(v, "$tag");
  if (d === undefined || !Object.hasOwn(d, "value")) return undefined;
  return d.value === "True" ? true : d.value === "False" ? false : undefined;
}
