// ---------------------------------------------------------------------------
// Structural traversal — head / length / map / fold derived from type shape
//
// Operations like `head`, `length`, `map`, `fold` are derived from the
// structural form of any recursive ADT, no per-type instance needed.
//
// unified-static-analysis Phase 6b/6c — RETIREMENT ASSESSMENT (the kill-2-birds
// steer, [[feedback_relitigate_f_permanent]] / [[feedback_dont_drop_unused_features]]):
//   • `structuralMap` was RETIRED in 6c — SUPERSEDED by the `$tag`-correct,
//     multi-param-SOUND Fenel successor `engine:deriveFmapFold`
//     (fenel/modules/engine/derive-functor.fenel), the decision half of the
//     derived `Functor` instance. The TS `structuralMap` used the RETIRED
//     `__case` discriminator (AGENTS.md: `$tag` is canonical), so on a real
//     `{$tag:"Box",…}` value it would not even fire — pure legacy with NO live
//     consumer (only index.ts re-export + structural.test.ts), so DELETED.
//   • `isFoldable` was RETIRED in 6c — subsumed by the kind predicate
//     `engine:isUnaryConstructor` + the always-on derived `Foldable` instance
//     (system-entities.ts). NO live consumer (index.ts + test only) → DELETED.
//   • `structuralFold` / `structuralHead` / `structuralLength` STAY (6c SURPRISE,
//     RE-AFFIRMED 6d): the brief's "no live consumer" premise was STALE — a
//     grep-fresh found a LIVE FRONTEND consumer, `distros/narthex/solid/src/
//     routes/app/engine-showcase.tsx` (the "types as data" demo calls all three
//     directly as TS funcs on `(FenelType, value)`). The derived `Foldable` /
//     `Traversable` are Fenel-DISPATCH surfaces (`Foldable.foldr` /
//     `Traversable.traverse` via the evaluator), NOT drop-in TS replacements.
//     unified-static-analysis Phase 6d ATTEMPTED the kill-2-birds migration and
//     re-deferred it (D-6d-3) on a GENUINE browser-ctx + registered-type blocker:
//     the showcase operates on an INLINE ANONYMOUS `$mu` FenelType + `__case`-keyed
//     values with NO live evaluate ctx, but the derived dispatch fundamentally
//     requires (a) a REGISTERED parametric type — the bridge reflects
//     value→owning-type-NAME via `typeConstructorOf`→`deriveResolveSchema`, and an
//     anonymous inline `$mu` Tree has no name to reflect; (b) `$tag`-keyed values
//     (not `__case`); (c) a live evaluate ctx in the browser. So the migration is
//     NOT a mechanical swap — it requires rebuilding the demo around a registered
//     ADT + live ctx + `$tag` values + a Fenel-expressed binop. Per
//     [[feedback_dont_drop_unused_features]] + D-6d-3: DEFER the live triad (never
//     break the live showcase to delete the TS). This is the EXACT structuralView-
//     audit surprise pattern from 6b.
//   • `structuralView` + `isVariantValue` have LIVE FRONTEND consumers — the
//     variant-value editor/renderer (distros/narthex/solid/src/lib/variant-value/
//     {ops,VariantValueEditor,VariantValueRenderer}) + engine-showcase.tsx. KEPT.
//
// Runtime convention for variant values (case-to-tag Step 2, 2026-07-07):
//   { $tag: "Name", ...fields }
// (legacy `__case`-keyed values are still READ via the dual-tolerant
// `caseTag` below; all producers emit `$tag`.)
// where each field is either:
//   - an "element" — carries the type parameter `a`
//   - a "recursive" position — carries a sub-structure of the same type
//
// A field is "recursive" iff its declared type equals the parent $mu
// (after one unfold). All other fields are treated as elements.
//
// Built-in fast paths (JS array, JS string) bypass the structural traversal
// for performance — but the semantics match exactly what the structural
// version would compute, by construction.
// ---------------------------------------------------------------------------

import type { FenelType } from "./types";
import { unfold } from "./set-algebra";
import { Nothing, refHandle } from "./type-foundation";

// ---------------------------------------------------------------------------
// Runtime variant value detection
// ---------------------------------------------------------------------------

// case-to-tag-discriminator Step 1 (dual-read tolerance): the canonical
// discriminator is `$tag` (AGENTS.md; the `construct` op emits it), but this
// structural layer historically keyed off the legacy `__case`. Readers now
// accept BOTH (`$tag` preferred, `__case` fallback) via `caseTag`; producers
// flip to `$tag`-only in Step 2. Until then a value may carry either key.
export type VariantValue = { __case?: string; $tag?: string } & Record<string, unknown>;

/** The variant discriminator of a runtime value — `$tag` (canonical) or the
 *  legacy `__case`, whichever is present. */
export function caseTag(v: VariantValue): string | undefined {
  const tag = v.$tag;
  if (typeof tag === "string") return tag;
  const legacy = v.__case;
  return typeof legacy === "string" ? legacy : undefined;
}

export function isVariantValue(v: unknown): v is VariantValue {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.$tag === "string" || typeof r.__case === "string";
}

// ---------------------------------------------------------------------------
// Structural view — classify variant cases and their fields
// ---------------------------------------------------------------------------

export type FieldRole = { name: string; type: FenelType; isRecursive: boolean };
export type CaseShape = { name: string; fields: FieldRole[] };
export type StructuralView = {
  cases: CaseShape[];
  /** The original $mu (or void if the type is non-recursive). Used to detect recursive fields. */
  selfRef: FenelType;
};

/**
 * Resolve a FenelType to its canonical $variant form (one $mu unfold deep) and
 * classify each field of each case as recursive or element-carrying.
 *
 * Returns null if the type doesn't reduce to a $variant (e.g. a $record,
 * $tuple, or atomic type).
 *
 * Recognises two recursive-reference encodings:
 *  - `$mu/$var` (legacy μ-binder): selfRef is the outer `$mu`, recursive
 *    fields point at `{$var: <name>}`.
 *  - `$named` self-reference (Phase 2.5): when an `$opaque` named `Foo`
 *    contains a direct `$variant`, recursive fields point at
 *    `{$named: "Foo"}` — matching the canonical encoding of
 *    `opaque "<repr>" Foo a = ... | Cons head: a tail: Foo a`.
 */
export function structuralView(t: FenelType): StructuralView | null {
  let core = t;

  // Track the outermost `$opaque.name` we peel through. If the inner core is
  // a bare `$variant` (Phase 2.5 self-reference shape), recursive fields
  // point at `{$named: <opaqueName>}` rather than at a `$mu` binder.
  let opaqueName: string | undefined;
  while ("$opaque" in core && core.$opaque.pure) {
    if (opaqueName === undefined) opaqueName = core.$opaque.name;
    core = core.$opaque.pure;
  }

  // Unfold $mu if present, remembering the original for recursive-field detection
  let selfRef: FenelType = { $void: true };
  if ("$mu" in core) {
    selfRef = core;
    core = unfold(core as { $mu: { var: string; body: FenelType } });
  } else if ("$variant" in core && opaqueName !== undefined) {
    // Phase 2.5 shape: the recursive self-reference is `{$named: opaqueName}`.
    selfRef = { $ref: opaqueName };
  }

  if (!("$variant" in core)) return null;

  const refKey = JSON.stringify(selfRef);
  // 7g-retire-2 fold: the Phase-2.5 self-reference may be authored as
  // `{$named: opaqueName}` OR its `{$ref: opaqueName}` twin (producers flip to
  // `{$ref}`). Match the name-handle, not the literal form, so a recursive field
  // is detected identically either way. The `$mu`/`$var` case has no handle and
  // falls through to the structural JSON compare unchanged.
  const selfName = refHandle(selfRef);
  const isSelf = (ty: FenelType): boolean =>
    JSON.stringify(ty) === refKey ||
    (selfName !== undefined && refHandle(ty) === selfName);
  return {
    selfRef,
    cases: core.$variant.cases.map((c) => ({
      name: c.name,
      label: Nothing,
      fields: (c.fields ?? []).map((f) => ({
        name: f.name,
        label: Nothing,
        type: f.type,
        isRecursive: isSelf(f.type),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Fast-path detection — JS array / JS string for List<a> and String
// ---------------------------------------------------------------------------

function strFirstCodePoint(s: string): string | null {
  const r = s[Symbol.iterator]().next();
  return r.done ? null : r.value;
}

// ---------------------------------------------------------------------------
// head : ∀a. T<a> → Maybe a
// ---------------------------------------------------------------------------

/**
 * Return the first element-typed value in the top constructor of `value`,
 * or null if the case has no element fields. For List, that's the head.
 * For Tree<a> with `Node(value: a, left, right)`, that's the root value.
 * For Maybe.Just, the wrapped value. For Nil/Nothing/Leaf, null.
 */
export function structuralHead(t: FenelType, value: unknown): unknown | null {
  if (typeof value === "string") return strFirstCodePoint(value);
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;

  if (!isVariantValue(value)) return null;
  const view = structuralView(t);
  if (!view) return null;
  const c = view.cases.find((x) => x.name === caseTag(value));
  if (!c) return null;

  for (const f of c.fields) {
    if (!f.isRecursive) {
      return value[f.name];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// length : ∀a. T<a> → ℕ — element count via natural fold of (+1)
// ---------------------------------------------------------------------------

export function structuralLength(t: FenelType, value: unknown): number {
  if (typeof value === "string") {
    let n = 0;
    for (const _ of value) n++;
    return n;
  }
  if (Array.isArray(value)) return value.length;

  if (!isVariantValue(value)) return 0;
  const view = structuralView(t);
  if (!view) return 0;
  const c = view.cases.find((x) => x.name === caseTag(value));
  if (!c) return 0;

  let count = 0;
  for (const f of c.fields) {
    if (f.isRecursive) {
      count += structuralLength(t, value[f.name]);
    } else {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// map : ∀a b. (a → b) → T<a> → T<b>
//
// `structuralMap` was RETIRED in unified-static-analysis Phase 6c — superseded
// by the Fenel `engine:deriveFmapFold` (the derived `Functor` instance). It had
// no live consumer (only index.ts re-export + structural.test.ts) and used the
// retired `__case` discriminator. See the file header.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// fold : ∀a b. (b → a → b) → b → T<a> → b
// ---------------------------------------------------------------------------

export function structuralFold(
  t: FenelType,
  value: unknown,
  fn: (acc: unknown, a: unknown) => unknown,
  init: unknown,
): unknown {
  if (typeof value === "string") {
    let acc = init;
    for (const c of value) acc = fn(acc, c);
    return acc;
  }
  if (Array.isArray(value)) return value.reduce(fn, init);

  if (!isVariantValue(value)) return init;
  const view = structuralView(t);
  if (!view) return init;
  const c = view.cases.find((x) => x.name === caseTag(value));
  if (!c) return init;

  let acc = init;
  for (const f of c.fields) {
    const v = value[f.name];
    acc = f.isRecursive ? structuralFold(t, v, fn, acc) : fn(acc, v);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Foldable predicate — RETIRED in unified-static-analysis Phase 6c.
//
// `isFoldable(t) = structuralView(t) !== null` is subsumed by the kind predicate
// `engine:isUnaryConstructor` + the always-on derived `Foldable` instance
// (system-entities.ts). No live consumer (index.ts re-export + test only). See
// the file header.
// ---------------------------------------------------------------------------
