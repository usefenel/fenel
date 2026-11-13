// ---------------------------------------------------------------------------
// Type Foundation — built-in FenelTypes
//
// The pure mathematical types and their real-world mappings.
// Everything built from Σ + μ.
//
// Number tower: ℕ ⊂ ℤ ⊂ ℚ
//   ℕ = μX. 1 + X           (Peano naturals — pure)
//   ℤ = opaque "integer"    (real-world: JS integer)
//   ℚ = opaque "rational"   (real-world: { num, den })
//
// Bool = 1 + 1 = True | False
// Maybe a = 1 + a = Nothing | Just a
// List a = μX. 1 + (a × X) = [] | a : List a
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import { Just, Nothing, peelMaybeValue } from "./maybe-value";
export { Just, Nothing, peelMaybeValue };
import type {
  Bound,
  Expression,
  FenelFunction,
  FenelModule,
  FenelType,
  FieldKey,
  Instance,
  FieldFacetSourceDirective,
  SetExpr,
  TypeScheme,
  TypeConstructorParam,
} from "./types";
import type { LocaleString } from "./locale";
import { regexStringToPattern } from "./regex-shim";
import { loadFenelModule } from "./fenel-module";
import foundationSrc from "../../../../fenel/std/foundation.fenel?raw";
import langNumbersSrc from "../../../../fenel/std/lang-numbers.fenel?raw";
import pathsSrc from "../../../../fenel/std/paths.fenel?raw";
import currencySrc from "../../../../fenel/std/entities/currency.fenel?raw";
import languageSrc from "../../../../fenel/std/entities/language.fenel?raw";
import savedQuerySrc from "../../../../fenel/std/entities/saved_query.fenel?raw";
import queryCategorySrc from "../../../../fenel/std/entities/query_category.fenel?raw";
import platformSrc from "../../../../fenel/std/entities/platform.fenel?raw";
import countrySrc from "../../../../fenel/std/entities/country.fenel?raw";
import profilePhoneSrc from "../../../../fenel/std/entities/profile_phone.fenel?raw";
import profileIntentSrc from "../../../../fenel/std/entities/profile_intent.fenel?raw";
import profileRelationshipSrc from "../../../../fenel/std/entities/profile_relationship.fenel?raw";
import profileTagSrc from "../../../../fenel/std/entities/profile_tag.fenel?raw";
import profileHandleSrc from "../../../../fenel/std/entities/profile_handle.fenel?raw";
import emailTemplateSrc from "../../../../fenel/std/entities/email_template.fenel?raw";
import proxyLinkSrc from "../../../../fenel/std/entities/proxy_link.fenel?raw";
// forms-collapse Phase 5 (R2) — the `Link` typed value a funnel function returns
// as its "next screen". Reuses proxy_link's UrlStr atom (loaded above), so it
// sits right after proxyLinkSrc in the load list below.
import linkSrc from "../../../../fenel/std/entities/link.fenel?raw";
import portfolioMemberSrc from "../../../../fenel/std/entities/portfolio_member.fenel?raw";
import portfolioSrc from "../../../../fenel/std/entities/portfolio.fenel?raw";
import reservationSrc from "../../../../fenel/std/entities/reservation.fenel?raw";
import entitlementSrc from "../../../../fenel/std/entities/entitlement.fenel?raw";
import paymentStepSrc from "../../../../fenel/std/entities/payment_step.fenel?raw";
import subscriptionSrc from "../../../../fenel/std/entities/subscription.fenel?raw";
import botSrc from "../../../../fenel/std/entities/Bot.fenel?raw";
// `Conversation` (PascalCase) — the in-flight form-fill state-machine.
// Phase 11c sub-step 4 removed the vestigial lowercase
// `CollectorConversation` entity that used to share this file (Phase 3d
// Surprise §2's case-insensitive-FS workaround is no longer load-bearing
// since CollectorConversation is gone).
import conversationSrc from "../../../../fenel/std/entities/conversation.fenel?raw";
import functionSrc from "../../../../fenel/std/entities/function.fenel?raw";
import planSrc from "../../../../fenel/std/entities/plan.fenel?raw";
import inventorySrc from "../../../../fenel/std/entities/inventory.fenel?raw";
import itemSrc from "../../../../fenel/std/entities/item.fenel?raw";
import purchaseSrc from "../../../../fenel/std/entities/purchase.fenel?raw";
import profileSrc from "../../../../fenel/std/entities/profile.fenel?raw";
// forms-collapse Phase 4 Stage 3 — the `form` entity (form.fenel) RETIRED with
// the forms surface (the funnel is a registered type, not a `form` entity).
// Phase 3e — page closes the system-entities arc at 29/29. The .fenel
// source uses the new `@discriminator "<name>"` directive (defined in
// fenel-parser.ts / fenel-module.ts / fenel-printer.ts) to author the
// custom `"type"` discriminator slot on the single-case Block variant.
// See workstreams/ts-elimination/briefs/phase-3e-page-entity-discriminator.md.
import pageSrc from "../../../../fenel/std/entities/page.fenel?raw";
import addressesSrc from "../../../../fenel/std/entities/addresses.fenel?raw";
// FM-retire-E1 Step 6 — the 7 inline-TS domain-record entities, now
// authored as `.fenel` files (no facet-flip — these had no `.fenel` file).
import accountSrc from "../../../../fenel/std/entities/account.fenel?raw";
import integrationSrc from "../../../../fenel/std/entities/integration.fenel?raw";
import entityDefinitionSrc from "../../../../fenel/std/entities/entity_definition.fenel?raw";
import buttonPayloadSrc from "../../../../fenel/std/entities/ButtonPayload.fenel?raw";
import planGrantSrc from "../../../../fenel/std/entities/PlanGrant.fenel?raw";
import planStepSrc from "../../../../fenel/std/entities/PlanStep.fenel?raw";
import profileHandleInputSrc from "../../../../fenel/std/entities/ProfileHandleInput.fenel?raw";
// FM-retire-E1 Step 7 — LookupResult: the dispatch explicit-ambiguity ADT. The
// `LookupResult(a)` helper (below) stays the dispatch-side producer; this decl
// is the catalog-facing source (its `defineSystemEntity` in system-entities.ts
// is deleted). Loaded through the per-entity loop so the auto-register loop
// surfaces it with its head param.
import lookupResultSrc from "../../../../fenel/std/entities/LookupResult.fenel?raw";
// FM-retire-E1 Step 7 — core `Module` decl (module-substrate Phase 1). Threaded
// into the auto-register path below; its `defineSystemEntity` is deleted.
import moduleCoreSrc from "../../../../fenel/modules/core/module.fenel?raw";
// expr-substrate Phase 1 — the Syntax / Expr / Pattern ADTs (the surface +
// core expression substrate). Threaded into the auto-register path below via
// the same Step-7 (stripEmptyVariantFields-only, label-less fields) discipline
// CoreExpr uses; the parser does NOT emit Syntax yet (that swap lands with
// desugar / the compiler re-layer in later phases).
import exprSrc from "../../../../fenel/std/expr.fenel?raw";
import syntaxSrc from "../../../../fenel/std/syntax.fenel?raw";

function regexSet(re: string): SetExpr {
  const p = regexStringToPattern(re);
  if (!p) throw new Error(`type-foundation: invalid regex /${re}/`);
  // 3b-2 — canonical `$tag` SePattern (inlined; the buildSetExpr.pattern shape).
  return { $tag: "SePattern", pattern: p };
}

// ---------------------------------------------------------------------------
// Parametric type-constructor helpers — Maybe / Result / Either
//
// These three are pure `$variant` ADTs with no opaque-wrap layer. The
// canonical Fenel-syntax definition lives in `fenel/std/foundation.fenel`;
// the TS helpers below resolve those parametric templates (Maybe a,
// Result e a, Either a b) and substitute the caller's type-vars to produce
// the same shape callers got from the pre-migration inline literals.
//
// Runtime loading from .fenel was unblocked by Phase 1.5 of ts-elimination,
// which moved the 14 Infixable instances + the unary `not` / `-` Prefixable
// instances out of `builtin-classes.ts` and into `parser-fixities.ts` (later,
// typed-function-references Phase 12 moved the instance DATA itself to
// `fenel/std/parser-fixities.fenel`, leaving `parser-fixities.ts` a lazy
// projector — the cycle stays broken because that projection is lazy-use only).
// Before that, the pre-cycle `Maybe(...)` call at the top of
// `builtin-classes` left every loader binding (foundationSrc, the parser's
// KW table, the module cache) in TDZ at the moment of construction. With
// the parser no longer reaching `builtin-classes`, the load chain
// completes cleanly.
//
// Templates are resolved lazily on first call (see `foundationTemplates`
// below) rather than at module top-level: the
// `type-foundation → fenel-module → fenel-parser → type-foundation`
// import edge is still structurally present (the parser imports
// Maybe/List/Result for parsing C-style generic syntax), so a top-level
// `loadFenelModule` call here would be order-sensitive on which module
// happens to be the initial load entrypoint. Resolving on first
// constructor call sidesteps that.
// ---------------------------------------------------------------------------

/** Walk a FenelType AST and substitute authoritative `{$var: <var>}` nodes
 *  whose `<var>` is a key in `bindings`. Pure recursion — every other branch
 *  is identity-recurse on subtrees.
 *
 *  `$ref` is always nominal. Its spelling must never acquire binder semantics
 *  merely because it happens to match a binding key: `type Box a = Box a`
 *  carries `{$var:"a"}`, while a nominal entity genuinely named `a` carries
 *  `{$ref:"a"}` and remains a reference. The source binder establishes this
 *  distinction before templates reach this consumer.
 *
 *  Used by the conformance test in `foundation-load.test.ts` to substitute
 *  the parsed foundation.fenel templates with caller types and compare to
 *  the inline TS literals below. */
export function substituteTypeVars(
  template: FenelType,
  bindings: Record<string, FenelType>,
): FenelType {
  if (template === null || template === undefined) return template;
  if (typeof template !== "object") return template;
  if (Array.isArray(template)) {
    return (template as unknown[]).map((it) =>
      substituteTypeVars(it as FenelType, bindings),
    ) as unknown as FenelType;
  }
  const obj = template as Record<string, unknown>;
  if (Object.keys(obj).length === 1) {
    if (
      typeof obj.$var === "string"
      && Object.prototype.hasOwnProperty.call(bindings, obj.$var)
    ) {
      return bindings[obj.$var]!;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = substituteTypeVars(v as FenelType, bindings);
  }
  return out as FenelType;
}

/** Strip empty `fields: []` arrays from variant cases so the parsed
 *  template's shape matches the hand-written TS literals
 *  (`{name: "Nothing"}` rather than `{name: "Nothing", fields: []}`).
 *  Semantically equivalent — downstream consumers treat both forms
 *  identically — but exact-AST callers (tests, snapshots) need the
 *  shape normalised. Recurses into $opaque.pure and $record.fields so
 *  atoms whose pure side is a variant (Bool's `True | False`) and
 *  records whose fields hold variant types still get normalised.
 *  Exported for use by the conformance test. */
export function stripEmptyVariantFields(t: FenelType): FenelType {
  if (!t || typeof t !== "object") return t;
  if ("$variant" in t) {
    const v = (t as { $variant: { discriminator?: string; cases: Array<{ name: string; label?: Maybe<LocaleString>; fields?: Array<{ name: string; key?: FieldKey; type: FenelType }> }> } }).$variant;
    const cases = v.cases.map((c) => {
      if (!c.fields || c.fields.length === 0) {
        return { name: c.name, label: Nothing };
      }
      return {
        name: c.name,
        label: Nothing,
        fields: c.fields.map((f) => ({
          name: f.name,
          ...(f.key === undefined ? {} : { key: f.key }),
          label: Nothing,
          type: stripEmptyVariantFields(f.type),
          meta: {},
          ui: Nothing,
        })),
      };
    });
    // Phase 3e — preserve the custom `discriminator` slot when present
    // (sourced from `@discriminator "<name>"` directive at authoring time).
    return {
      $variant: v.discriminator !== undefined
        ? { discriminator: v.discriminator, cases }
        : { cases },
    } as FenelType;
  }
  if ("$opaque" in t) {
    // representation-substrate Phase 5a — `repr` retired; carry name + pure only.
    const o = (t as { $opaque: { name: string; pure: FenelType } }).$opaque;
    return {
      $opaque: {
        name: o.name,
        pure: stripEmptyVariantFields(o.pure),
      },
    } as FenelType;
  }
  if ("$record" in t) {
    const r = (t as { $record: { fields: Array<{ name: string; key?: FieldKey; type: FenelType }> } }).$record;
    return {
      $record: {
        fields: r.fields.map((f) => ({
          name: f.name,
          ...(f.key === undefined ? {} : { key: f.key }),
          label: Nothing,
          type: stripEmptyVariantFields(f.type),
          meta: {},
          ui: Nothing,
        })),
      },
    } as FenelType;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Maybe<T> value shape — the helpers are imported from maybe-value so the
// atom factory consts can use Nothing without a runtime dependency cycle.
// ---------------------------------------------------------------------------

/**
 * TS-data-level Maybe<T>. The runtime shape Fenel pattern-matches against
 * `Just x -> …` / `Nothing -> …` (positional binding by ORDER per Phase
 * 10a-6 — the inner field is `_0`, not `value`). Use this anywhere a TS-side
 * data slot carries a semantic-optional value (vs. a codec-boundary absence —
 * see Undefinable for that).
 */
export type Maybe<T> =
  | { $tag: "Just"; _0: T }
  | { $tag: "Nothing" };

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

export const Void: FenelType = { $void: true };
export const Unit: FenelType = { $unit: true };

// ---------------------------------------------------------------------------
// Bool = True | False (isomorphic to 1 + 1)
//
// Pure: $variant { True | False }                      — the canonical ADT
// Native (JS boolean): the `Reprable JsRuntime Boolean` instance
//   (`fenel/std/dispatch-instances.fenel`) — NOT a type-level `repr` string
//   (retired Phase 5a). The `$opaque { name, pure }` wrapper is the NOMINAL-
//   NEWTYPE marker; Phase 5b-final KEPT it (full removal collapses String into
//   List Char — R2 (ii); see representation-substrate/notes/phase-5b-step0-probe.md).
//
// The opaque wrapper unifies the two: the type system sees Boolean as
// `True | False` (so it composes with every other ADT — `Maybe Bool`,
// `Either E Bool`, pattern-matching, etc. — uniformly), but the runtime
// keeps using JS booleans for cheap evaluation. `construct` coerces
// `{construct: ["True"|"False"]}` → JS true/false, and `matchPattern`
// coerces JS true/false → `{$tag: "True"|"False"}` for pattern
// dispatch. Together they make `case b of True -> … | False -> …` work
// against any Boolean value, regardless of whether it came from a
// literal, a comparator, or a constructor call. These two arms are the
// IRREDUCIBLE Bool↔JS-boolean primitive (value-rep-driven, not wrapper-
// driven — Bool values flow as JS booleans from comparators / literals /
// and/or); `Reprable JsRuntime Boolean`.lift/lower are DERIVED from them
// (their `if … then True else False` bodies presuppose this construction),
// so the coercion cannot be routed through the instance — ledger B5.
// ---------------------------------------------------------------------------

export const Bool: FenelType = {
  $opaque: {
    name: "Boolean",
    pure: {
      $variant: {
        cases: [
          { name: "True", label: Nothing },
          { name: "False", label: Nothing },
        ],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Number tower
// ---------------------------------------------------------------------------

/**
 * ℕ — Peano naturals
 * Pure: $variant { Zero | Succ pred: Nat }   (named self-reference)
 * Real-world: JS number (integer >= 0)
 *
 * The pure form uses `{$named: "Nat"}` for the recursive `pred` field rather
 * than `{$mu, var, body}` with `{$var}` — both encode the same fixed-point,
 * but `$named` is the natural Fenel idiom (the runtime entity registry
 * resolves the reference at lookup time), and it's what
 * `fenel/std/foundation.fenel`'s `opaque "number" Nat = Zero | Succ pred:
 * Nat` parses to. `foundation-load.test.ts` asserts the two paths agree.
 */
export const Nat: FenelType = {
  $opaque: {
    name: "Nat",
    pure: {
      $variant: {
        cases: [
          { name: "Zero", label: Nothing },
          { name: "Succ", label: Nothing, fields: [{ name: "pred", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
        ],
      },
    },
  },
};

/**
 * ℤ — Integers
 * Pure: ℕ × Bool (magnitude + sign), or quotient type on ℕ²
 * Real-world: JS number (integer)
 *
 * The `negative` field references Bool by name (`{$named: "Bool"}`) rather
 * than embedding the full opaque-wrapped value inline. The registry resolves
 * the reference at lookup time — semantically equivalent, but the named form
 * matches what foundation.fenel's `opaque "number" Int = Int magnitude: Nat
 * negative: Bool` parses to.
 */
export const Int: FenelType = {
  $opaque: {
    name: "Int",
    pure: {
      $record: {
        fields: [
          { name: "magnitude", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
          { name: "negative", label: Nothing, type: { $ref: "Bool" }, meta: {}, ui: Nothing },
        ],
      },
    },
  },
};

/** ℕ⁺ = { n ∈ ℕ | n > 0 } */
// 3b-2 — canonical `$tag` SeInterval (the `buildSetExpr.interval` shape, inlined
// — this is an init-time const, so the type-foundation↔set-marker cycle forbids
// importing buildSetExpr here; the literal IS its output).
const positiveNat: SetExpr = {
  $tag: "SeInterval",
  interval: { lo: Just({ value: 1, inclusive: true }), hi: Nothing },
};

/**
 * ℚ — Rationals
 * Pure: ℤ × ℕ⁺ (numerator / positive denominator)
 * Real-world: { num: number, den: number }
 *
 * The `den` field references `PositiveNat` by name rather than inlining
 * the `$refined{base: Nat, set: positiveNat}` shape — same canonical
 * named-ref move as Phase 2 / 2.5 / 2.6 made for Nat / Int / List / Char
 * self-refs. Matches what `fenel/std/foundation.fenel`'s `opaque
 * "rational" Rational = Rational num: Int den: PositiveNat` parses to.
 */
export const Rational: FenelType = {
  $opaque: {
    name: "Rational",
    pure: {
      $record: {
        fields: [
          { name: "num", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
          { name: "den", label: Nothing, type: { $ref: "PositiveNat" }, meta: {}, ui: Nothing },
        ],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Char — a Unicode scalar
//
// Conceptually a Char is an enum: one constructor per Unicode codepoint. The
// pure form is therefore a giant `$variant` (1.1M nullary cases — refined
// here as the codespace minus surrogates), and the runtime representation
// is a codepoint Nat for compact dispatch. This mirrors the same pure/perf
// duality as `Bool` (pure `True | False`, runtime JS boolean) and `Nat`
// (pure Peano `Zero | Succ X`, runtime JS number).
//
// We don't materialize all 1.1M cases in the AST — that's encoding-aware
// shorthand. The pure form is declared as a refinement of Nat over the
// valid Unicode codepoint set (excluding the UTF-16 surrogate range
// 0xD800–0xDFFF, which aren't scalars). Set-algebra operations on Char
// can use codepoint intervals; semantic operations (script, category,
// case, …) live in named-set predicates layered on top.
//
// References:
//   { $named: "Char" } — the canonical reference
//   Refined(Char, { $interval: [0x61, 0x7A] }) — lowercase Latin letter
//   Refined(Char, { $named: "char:script:cyrl" }) — Cyrillic script
// ---------------------------------------------------------------------------

/** The Unicode scalar codespace: [0, 0x10FFFF] minus surrogates. */
// 3b-2 — canonical `$tag` Se* form (inlined; init-time const, see positiveNat).
const unicodeScalarSet: SetExpr = {
  $tag: "SeUnion",
  branches: [
    { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 0xd7ff, inclusive: true }) } },
    { $tag: "SeInterval", interval: { lo: Just({ value: 0xe000, inclusive: true }), hi: Just({ value: 0x10ffff, inclusive: true }) } },
  ],
};

/**
 * Char — a Unicode scalar value.
 *
 * Pure: an enumeration of Unicode codepoint constructors (modeled as a
 * refined Nat for compact AST). Runtime: a codepoint number, surfaced as
 * a one-character JS string at the boundary.
 *
 * The `base` is `{$named: "Nat"}` (a registry reference) rather than the
 * inline `Nat` opaque so the inline TS shape matches the parsed form
 * emitted by `fenel/std/foundation.fenel`. Char stays as a top-level
 * inline literal (not lazy-resolved) because `Str.pure = List(Char)` at
 * module top-level still hits the same TDZ that blocks List from being
 * lazy — see Phase 2.5 surprise §1.
 */
export const Char: FenelType = {
  $opaque: {
    name: "Char",
    pure: { $refined: { base: { $ref: "Nat" }, set: unicodeScalarSet } },
  },
};

// ---------------------------------------------------------------------------
// Common constructors
//
// These helpers emit the canonical `$variant` (or `$opaque`-wrapped `$mu`-`$variant`)
// shape — `$maybe` / `$list` / `$result` are legacy structural shorthands no
// longer recognised as `FenelType` members; helper-emitted values are the
// only valid encoding for new code. Peel via `peelMaybe` / `peelList` /
// `peelResult` (in `set-algebra.ts`) — they still recognise the legacy
// shorthand at runtime, so persisted data from before the migration keeps
// working uniformly.
//
// These declarations live *above* `Str` because `Str.pure` calls `List(Char)`
// inline. solid-refresh rewrites `function` declarations into `const`s during
// dev HMR, which kills hoisting — having `List` declared first ensures the
// reference resolves under both Bun and Vite. (`List` stays inline rather
// than lazy-resolved for the same reason: Str/Path top-level eval would fire
// a re-entrant parse before the parser's Parser class finishes initialising —
// see the longer note above `function List` below.)
// ---------------------------------------------------------------------------

// Lazy-load the canonical templates from `fenel/std/foundation.fenel`. The
// import cycle `type-foundation → fenel-module → fenel-parser → type-
// foundation` (the parser pulls Maybe/List/Result for parsing C-style
// generics) is still structurally present, so calling `loadFenelModule` at
// THIS module's top level is order-sensitive: if `fenel-parser` happens to
// be loading when our top-level call fires, the parser's `const KW = …`
// would still be in TDZ. Resolving the templates on the first
// Maybe/Result/Either call sidesteps that — by then every module in the
// chain has finished evaluating, regardless of which one was the load
// entrypoint. Normalised once via `stripEmptyVariantFields` so the shape
// matches the legacy inline-literal form (nullary cases as
// `{name: "Nothing"}`, not `{name: "Nothing", fields: []}`).
type FoundationTemplates = {
  Maybe: FenelType;
  Result: FenelType;
  Either: FenelType;
  Bool: FenelType;
  Nat: FenelType;
  Int: FenelType;
  List: FenelType;
  Char: FenelType;
  PositiveNat: FenelType;
  NonNegInt: FenelType;
  Rational: FenelType;
  /** Phase 2.11 — opaque-wrapped String, sourced from
   *  `opaque "string" String = List Char` in `fenel/std/foundation.fenel`.
   *  Pure side is the parsed `$opaque "array" List` whose `head` field is a
   *  `{$named: "Char"}` registry-ref (matches the canonical-named-ref
   *  pattern every prior opaque atom uses). The TS `Str` export is a Proxy
   *  that lazy-resolves through this slot on first property access. */
  Str: FenelType;
  /** Per-language number atoms parsed from `fenel/std/lang-numbers.fenel`
   *  (Phase 2.8). Sub-map rather than flat slots so the ~38 atoms scale
   *  cleanly and so the conformance loop can iterate without enumerating
   *  every name at the type level. */
  langNumbers: Record<string, FenelType>;
  /** Path family + NonEmptyStr parsed from `fenel/std/paths.fenel`
   *  (Phase 2.9). Holds 4 entities — NonEmptyStr, PathSegment, PathRoot,
   *  Path. Sub-map mirrors the `langNumbers` pattern: the conformance
   *  loop iterates without enumerating each name at the type level. */
  paths: Record<string, FenelType>;
  /** System-entity structural types parsed from
   *  `fenel/std/entities/*.fenel` (Phase 3a — currency pilot). Each
   *  entry is keyed by the .fenel-side entity id (PascalCase, e.g.
   *  `Currency`) — distinct from the `defineSystemEntity` `codeName`
   *  (lowercase, e.g. `currency`). Declaration-level presentation stays
   *  empty; UUID facets and Codeable fallback are resolved by the registry. */
  entities: Record<string, FenelType>;
};

let _foundationTemplates: FoundationTemplates | undefined;

/**
 * FM-retire-E1 Step 2 — the identity-facet ClassInstances lifted by
 * `loadFenelModule` off the per-entity `.fenel` files' `@label` / `@description`
 * / `@icon` / `@fieldLabel` directives (Codeable / Labelable / Describable /
 * Iconable / per-field Labelable). `foundationTemplates()` consumes each entity
 * module's `.entities` but historically DISCARDED its `.instances`; this
 * accumulator threads them out so the auto-register loop in `system-entities.ts`
 * can register the facets of any `.fenel`-flipped entity (the ones whose
 * `defineSystemEntity` was deleted). Populated as a side effect of the
 * `foundationTemplates()` load pass — read it only after calling
 * `foundationTemplates()` (the load is memoized + idempotent, so the array is
 * accumulated exactly once).
 */
// NB: `Array<Instance>` (not the bracket-suffix form) — this is a runtime
// ACCUMULATOR of loader-lifted (`.fenel`-sourced) instances, NOT a TS-authored
// instance const, so it is deliberately outside the ts-elimination Check-3
// `no-new-instance-const` surface (the detector keys on the annotation form
// `<colon> Instance`; the `Array<…>` collection form carries no authored
// instance, matching how the audit treats collection-typed substrate fields).
export const foundationEntityInstances: Array<Instance> = [];
/** Retained source-only field facets, retargeted to the actual system entity
 * owner used by registry field identity. */
export const foundationFieldFacetDirectives: FieldFacetSourceDirective[] = [];

/**
 * FM-retire-E1 Step 2 — the per-entity `{ codeName, type, typeScheme? }`
 * registrations the auto-register loop in `system-entities.ts` consumes. `codeName` is the
 * REGISTERED system-entity id (from `@codeName`, defaulting to the type_def
 * name); `type` is the structurally normalized declaration shape. Kept distinct from
 * `entities` (which stays keyed by the type_def name for the deferred
 * `defineSystemEntity` callers + the load test) so the auto-loop can register a
 * lowercase-id entity (`currency`) whose `.fenel` type_def name is PascalCase
 * (`Currency`). Source-authored entities retain their kinded scheme sidecar;
 * its body is rebased to the same normalized `type`. Populated alongside
 * `foundationEntityInstances`.
 */
export type FoundationEntityRegistration = {
  /** Actual defining source/import frame; distinct from its promoted owner. */
  sourceModule?: FenelModule;
  sourceDeclarationName?: string;
  codeName: string;
  type: FenelType;
  params?: string[] | TypeConstructorParam[];
  /** Source binding/kind evidence, with `body` normalized to exactly `type`. */
  typeScheme?: TypeScheme;
};

export const foundationEntityRegs: FoundationEntityRegistration[] = [];

function foundationEntityRegistration(entity: {
  id: string;
  codeName?: string;
  type: FenelType;
  params?: string[] | TypeConstructorParam[];
  typeScheme?: TypeScheme;
}, sourceModule?: FenelModule): FoundationEntityRegistration {
  const type = stripEmptyVariantFields(entity.type);
  return {
    codeName: entity.codeName ?? entity.id,
    sourceDeclarationName: entity.id,
    type,
    ...(sourceModule === undefined ? {} : { sourceModule }),
    ...(entity.params && entity.params.length > 0 ? { params: entity.params } : {}),
    ...(entity.typeScheme === undefined
      ? {}
      : { typeScheme: { ...entity.typeScheme, body: type } }),
  };
}

export function foundationTemplates(): FoundationTemplates {
  if (_foundationTemplates) return _foundationTemplates;
  const mod = loadFenelModule(foundationSrc, "std");
  const lookup = (id: string): FenelType => {
    const entity = (mod.entities ?? []).find((e) => e.id === id);
    if (!entity) {
      throw new Error(
        `type-foundation: fenel/std/foundation.fenel missing entity "${id}"`,
      );
    }
    return stripEmptyVariantFields(entity.type);
  };
  const langMod = loadFenelModule(langNumbersSrc, "std");
  const langNumbers: Record<string, FenelType> = {};
  for (const entity of langMod.entities ?? []) {
    langNumbers[entity.id] = stripEmptyVariantFields(entity.type);
  }
  const pathsMod = loadFenelModule(pathsSrc, "std");
  const paths: Record<string, FenelType> = {};
  for (const entity of pathsMod.entities ?? []) {
    paths[entity.id] = stripEmptyVariantFields(entity.type);
  }
  // Phase 3c — assign `_foundationTemplates` BEFORE loading the per-entity
  // .fenel files. Phase 3c is the first batch where entity sources use
  // `Maybe T` at field-position; the parser's `liftJuxApp("Maybe", …)`
  // dispatches through the TS `Maybe(arg)` helper, which calls
  // `foundationTemplates()` to resolve the parametric template. Without
  // this early assignment that call would re-enter the loader recursively
  // (the cache is still undefined mid-load), which crashes when the
  // re-entry tries to re-parse `paths.fenel`'s `/regex/` SetExpr literal
  // (re-entrant parser-state mutation makes `regexStringToPattern` return
  // null). Setting the cache to a stub with the Maybe/Result/Either
  // templates already populated breaks the recursion: the inner Maybe()
  // call returns immediately with the cached template, and the entity-
  // load loop continues normally. The `entities` sub-map is mutated in
  // place by the loop below — the partial-assignment is sound because
  // (a) it's the same object identity the loop will populate, and (b)
  // no caller reads `entities` before the loop finishes (it's the load
  // pass itself).
  const entities: Record<string, FenelType> = {};
  _foundationTemplates = {
    Maybe: lookup("Maybe"),
    Result: lookup("Result"),
    Either: lookup("Either"),
    Bool: lookup("Bool"),
    Nat: lookup("Nat"),
    Int: lookup("Int"),
    List: lookup("List"),
    Char: lookup("Char"),
    PositiveNat: lookup("PositiveNat"),
    NonNegInt: lookup("NonNegInt"),
    Rational: lookup("Rational"),
    Str: lookup("String"),
    langNumbers,
    paths,
    entities,
  };
  for (const src of [
    currencySrc,
    languageSrc,
    savedQuerySrc,
    queryCategorySrc,
    platformSrc,
    countrySrc,
    profilePhoneSrc,
    profileIntentSrc,
    profileRelationshipSrc,
    profileTagSrc,
    profileHandleSrc,
    // Phase 3d — remaining 18 concrete entities. Page was deferred in
    // 3d because its discriminator: "type" slot on $variant is consumed
    // by validate / field-meta / json-schema / widget-hint, and the
    // parser didn't emit that slot; Phase 3e closed that gap with the
    // `@discriminator "<name>"` directive (added below the array).
    emailTemplateSrc,
    proxyLinkSrc,
    // forms-collapse Phase 5 (R2) — Link (references proxyLinkSrc's UrlStr atom).
    linkSrc,
    portfolioMemberSrc,
    portfolioSrc,
    reservationSrc,
    entitlementSrc,
    paymentStepSrc,
    subscriptionSrc,
    botSrc,
    conversationSrc,
    functionSrc,
    planSrc,
    inventorySrc,
    itemSrc,
    purchaseSrc,
    profileSrc,
    // Phase 3e — page (closes the system-entities arc at 29/29).
    pageSrc,
    // Phase 3.3c (typeclass-substrate-completion) — the 6 per-country postal
    // address `$record` types + their refined-String postal-code atoms, the
    // `addressType : Type` carrier for AddressFormat instances.
    addressesSrc,
    // FM-retire-E1 Step 6 — the 7 inline-TS domain records (account /
    // integration / entity_definition + the 4 label-less PascalCase records).
    accountSrc,
    integrationSrc,
    entityDefinitionSrc,
    buttonPayloadSrc,
    planGrantSrc,
    planStepSrc,
    profileHandleInputSrc,
  ]) {
    const entityMod = loadFenelModule(src, "std");
    for (const directive of entityMod.fieldFacetDirectives ?? []) {
      const owner = directive.owner;
      if ("functionId" in owner) {
        foundationFieldFacetDirectives.push(directive);
        continue;
      }
      const entity = entityMod.entities?.find(
        (candidate) => candidate.id === owner.entityId,
      );
      foundationFieldFacetDirectives.push({
        ...directive,
        owner: {
          module: "system",
          entityId: entity?.codeName ?? entity?.id ?? owner.entityId,
        },
      });
    }
    for (const entity of entityMod.entities ?? []) {
      const registration = foundationEntityRegistration(entity, entityMod);
      entities[entity.id] = registration.type;
      // FM-retire-E1 Step 2 — the auto-register loop registers under the
      // codeName (the byte-identical lowercase id where it differs from the
      // PascalCase type_def name); `entities` above stays keyed by the type_def
      // name for the deferred callers + the load test.
      foundationEntityRegs.push(registration);
    }
    // FM-retire-E1 Step 2 — thread the loader-lifted identity-facet instances
    // out so `system-entities.ts`'s auto-register loop can register the facets
    // of `.fenel`-flipped entities. Pre-E1 these were silently discarded.
    for (const inst of entityMod.instances ?? []) foundationEntityInstances.push(inst);
  }
  // FM-retire-E1 Step 7 — thread the parametric / core entities whose `.fenel`
  // decls live OUTSIDE the per-entity src list into the auto-register path:
  //   • foundation.fenel's own parametric ADTs (Maybe / Result / Either) —
  //     loaded as `mod` above, consumed until now only via `lookup`.
  //   • LookupResult (the dispatch explicit-ambiguity ADT).
  //   • core `Module` (module-substrate Phase 1).
  // These are processed with `stripEmptyVariantFields` only because their
  // pre-flip registrations did the same
  // (`Maybe(...)` / `Result(...)` / the `LookupResult(a)` helper / raw
  // `moduleCoreType`): every field carried `label: Nothing`, so a label-fill
  // here would diverge from the locked shape. Only decls carrying an identity
  // directive emit a Codeable; the bare atoms (Bool / Nat / Int / List / Char /
  // String / Ref) stay inert — the auto-loop's `hasLiftedCodeable` gate skips
  // them. The head params (`Maybe a` → `["a"]`) ride on `entity.params`.
  for (const src of [foundationSrc, lookupResultSrc, moduleCoreSrc, exprSrc, syntaxSrc]) {
    const stepMod = loadFenelModule(src, "std");
    for (const entity of stepMod.entities ?? []) {
      const codeName = entity.codeName ?? entity.id;
      if (foundationEntityRegs.some((r) => r.codeName === codeName)) continue;
      foundationEntityRegs.push(foundationEntityRegistration(entity, stepMod));
    }
    for (const inst of stepMod.instances ?? []) foundationEntityInstances.push(inst);
  }
  return _foundationTemplates;
}

/** Maybe a = $variant { Nothing | Just { _0: a } }.
 *  Spec: `fenel/std/foundation.fenel`. Conformance: `foundation-load.test.ts`. */
export function Maybe(a: FenelType): FenelType {
  return substituteTypeVars(foundationTemplates().Maybe, { a });
}

/**
 * Value-side companion to the `Maybe()` type constructor. Lifts a JS
 * nullable `T | null | undefined` into the canonical Fenel Maybe shape
 * (`{$tag: "Nothing"}` / `{$tag: "Just", _0: T}`). Use at the
 * boundary where a TS-internal helper that returns `T | null` is
 * exposed as a Fenel-callable: the host-language null is the runtime
 * repr of Nothing, but Fenel callers only see Just/Nothing.
 *
 * Phase 10a-6: inner field is `_0` (positional binding), not `value`.
 */
export function valueAsMaybe<T>(
  x: T | null | undefined,
): { $tag: "Just"; _0: T } | { $tag: "Nothing" } {
  return x === null || x === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: x };
}

/**
 * List a = $opaque { name: "List", pure: $variant { Nil | Cons { head: a, tail: List } } }
 *
 * representation-substrate Phase 5a — the `repr: "array"` field RETIRED; the
 * JS-array runtime rep now lives in the `Reprable JsRuntime List` instance
 * (`fenel/std/dispatch-instances.fenel`, lift/lower = the list-repr spine
 * bridges). The `pure` carries the canonical variant view with a named self-
 * reference (`{$ref: "List"}`) for the recursive tail — the entity registry
 * resolves the reference at lookup time. The shape matches what
 * `fenel/std/foundation.fenel`'s `opaque "array" List a = Nil | Cons head: a
 * tail: List a` parses to (Phase 2.5; the `"array"` surface token is a now-
 * ignored annotation until 5b removes the wrapper). The raw factory remains
 * keyless exactly like the parsed declaration. Field identity is projected by
 * the registry from its owner/path + lock facts; this bootstrap constructor is
 * not a second authority for the canonical Cons.head/Cons.tail UUIDs.
 *
 * Stays as an inline TS literal — unlike Maybe / Result / Either, the lazy-
 * resolve pattern doesn't fit: `Str` and `Path` below call `List(...)` at
 * type-foundation's top-level eval, which fires before the parser's `Parser`
 * class (a non-hoisted class declaration) has finished evaluating. The same
 * approach Bool / Nat / Int take — an inline TS literal whose structural shape
 * matches the parsed template, with `foundation-load.test.ts` pinning the raw
 * authoring shape modulo this explicit identity projection.
 *
 * Spec: `fenel/std/foundation.fenel`. Conformance: `foundation-load.test.ts`.
 */
export function List(a: FenelType): FenelType {
  return {
    $opaque: {
      name: "List",
      pure: {
        $variant: {
          cases: [
            { name: "Nil", label: Nothing },
            {
              name: "Cons",
              label: Nothing,
              fields: [
                {
                  name: "head",
                  label: Nothing,
                  type: a,
                  meta: {},
                  ui: Nothing,
                },
                {
                  name: "tail",
                  label: Nothing,
                  type: { $ref: "List" },
                  meta: {},
                  ui: Nothing,
                },
              ],
            },
          ],
        },
      },
    },
  };
}

/** Result e a = $variant { Err { _0: e } | Ok { _0: a } }.
 *  Spec: `fenel/std/foundation.fenel`. Conformance: `foundation-load.test.ts`. */
export function Result(err: FenelType, ok: FenelType): FenelType {
  return substituteTypeVars(foundationTemplates().Result, { e: err, a: ok });
}

// ---------------------------------------------------------------------------
// Ref — the general, id-backed, type-transparent reference value
// ---------------------------------------------------------------------------

/**
 * Runtime value form of a reference: `{ $ref: <id> }`.
 *
 * A reference is a general, id-backed, **type-transparent** value — its type
 * IS the referent's type, resolved from the id via the registry (NOT embedded
 * in the value, NOT a distinct reference *type*). A ref to `f : Markup ->
 * String` is a value of type `Markup -> String`, exactly like an inline
 * `FenelClosure`; the bare code-name string was the lone *untyped* member of
 * `invokeFunction`'s callable union — `{$ref}` is the typed replacement.
 *
 * General by design: the referent may be a function (the first slice — wired
 * this phase), a saved value/expression (Phase 4 folds the editor's `ref` onto
 * this), or — once `$named`/`SchemaRef` merge (Phase 7) — a type/entity. The
 * handle is the **id**; the human name is a `Codeable` projection over it.
 *
 * It is a `$`-prefixed *serializable* structural marker (instance methods and
 * persisted bodies store it), unlike the runtime-only `__fenelClosure` /
 * `__fenelPartial` sentinels. `evaluate` passes it through untouched (the
 * single-key `$`-prefixed-marker path), so it is self-evaluating.
 *
 * Canonical reference: `design/typed-function-references.md` ("References —
 * the `Ref` substrate"). `Ref()` is a VALUE marker, NOT a `FenelType`
 * constructor — don't add it to the type-of-types union.
 */
export type RefValue = { $ref: string };

export function Ref(id: string): RefValue {
  return { $ref: id };
}

export function isRef(v: unknown): v is RefValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "$ref" in v &&
    typeof (v as { $ref: unknown }).$ref === "string"
  );
}

/**
 * The name-handle of a name-keyed reference, written `{$ref: X}` (the `Ref`
 * substrate). Returns `X`, else `undefined`.
 *
 * 7g-retire-final: `{$named}` is fully retired (producers flipped + on-disk
 * migration 0086); `{$ref}` is the sole name-handle. This is the single read
 * leaf for it.
 */
export function refHandle(t: unknown): string | undefined {
  if (typeof t !== "object" || t === null) return undefined;
  if ("$ref" in t && typeof (t as { $ref: unknown }).$ref === "string") {
    return (t as { $ref: string }).$ref;
  }
  return undefined;
}

/**
 * The handle of a function-valued method field: a function id string, or a
 * `{$ref: handle}` reference to a function. A string returns itself; an
 * object whose OWN data property `$ref` holds a non-empty string returns that
 * handle; anything else returns `undefined`.
 *
 * For the readers of typeclass-instance method values (validation, law and
 * dispatch paths). Unlike `refHandle` it never reads an inherited `$ref` and
 * never runs an accessor, so a prototype cannot make a value look like a
 * reference. The handle is not resolved here: a caller that needs the
 * canonical id asks its registry's `getFunction(handle)`.
 */
export function functionRefHandle(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$ref");
  if (descriptor === undefined || !("value" in descriptor)) return undefined;
  const handle: unknown = descriptor.value;
  return typeof handle === "string" && handle.length > 0 ? handle : undefined;
}

/**
 * Resolve the type of a reference value — type-transparent: the type IS the
 * referent's. `typeOf({$ref}) = typeOf(referent)`.
 *
 * The handle is a UUID **or** a codeable-name (both first-class; codeable-name is
 * the common authoring form — typed-function-references Phase 7). It is resolved:
 *   1. as a **function** id (`getFunction` bridges id / slug / codeName / UUID,
 *      Phase 6) → the function's `$arrow` (the value-position transparent type), then
 *   2. as a **type/entity** code-name (`getEntityType`, injected — Phase 7b) → that
 *      entity's registered `$record`/`$variant` kind (the type-position case).
 *
 * Function-first is purely to preserve the existing value-position behavior
 * byte-for-byte (a function handle returns its arrow without consulting the entity
 * lookup); under the one universal code-name namespace (D2) a handle names exactly
 * one thing, so the order is immaterial to correctness. Both lookups are in-memory
 * (not I/O). Degrades gracefully to `{$void}` on an unresolvable handle — never throws.
 *
 * 7b is the resolver primitive only — it does NOT add `{$ref}` to the FenelType
 * union or teach any structural recognizer to match it (that is 7f/7g). Later
 * sub-phases (7d–7e entity refs) route through this one resolver.
 */
export function refType(
  ref: RefValue,
  getFunction: (id: string) => FenelFunction | undefined,
  getEntityType?: (name: string) => FenelType | undefined,
): FenelType {
  const handle = ref.$ref;
  const spec = getFunction(handle);
  if (spec) return { $arrow: { params: spec.params, returns: spec.returns } };
  const entity = getEntityType?.(handle);
  if (entity) return entity;
  return { $void: true };
}

/** Verified p = $variant { Verified { predicate: p, evidence: Evidence } } —
 *  the law-field envelope from `fenel/std/typeclass-specs.fenel:51-53`.
 *  Phase 1 of typeclass-substrate-completion lifts `Verified` to a parser-
 *  side canonical container (same template as `Maybe<T>` / `Result<E,A>` /
 *  `List<T>` / `Map<K,V>` / `Tagged<T,P>`); the previous `$app{Verified,
 *  [P]}` shape retires alongside the `$app` constructor itself.
 *
 *  Built inline (mirrors `List`) — `Verified` lives in typeclass-specs.fenel
 *  which loads AFTER `foundationTemplates()` populates, so the
 *  `substituteTypeVars(foundationTemplates().Verified, ...)` form would
 *  TDZ. The inline shape matches what typeclass-specs.fenel's parser would
 *  emit for `Verified p = Verified predicate: p evidence: Evidence`. */
export function Verified(p: FenelType): FenelType {
  return {
    $variant: {
      cases: [
        {
          name: "Verified",
          label: Nothing,
          fields: [
            { name: "predicate", label: Nothing, type: p, meta: {}, ui: Nothing },
            { name: "evidence", label: Nothing, type: { $ref: "Evidence" }, meta: {}, ui: Nothing },
          ],
        },
      ],
    },
  };
}

/** Either a b = $variant { Left { value: a } | Right { value: b } } —
 *  the standard Haskell-style biased sum. Use Result when one side is
 *  a failure; use Either for value-level Or-shapes without failure
 *  semantics. Draft<T>'s field wrappers are `Either<String, T_field>`:
 *  Left = raw user input awaiting reconciliation, Right = parsed-and-
 *  validated typed value.
 *  Spec: `fenel/std/foundation.fenel`. Conformance: `foundation-load.test.ts`. */
export function Either(left: FenelType, right: FenelType): FenelType {
  return substituteTypeVars(foundationTemplates().Either, { a: left, b: right });
}

/** LookupResult a = $variant { Unique { value: a } | Conflict { items: List a } | None } —
 *  the explicit-ambiguity surface for dispatch lookups (Phase 10a sub-step 1).
 *
 *  `dispatch.lookup` returns LookupResult so callers can distinguish a
 *  unique match from a multi-candidate ambiguity from no match. Today's
 *  registry still does "highest priority wins" silent picking; Conflict
 *  is reserved for when 10a-4's typed-Id dispatch makes duplicates
 *  structurally detectable. Until then the runtime only populates
 *  Unique / None.
 *
 *  Built inline (mirrors `List` rather than the foundation-templates
 *  lazy-load) — LookupResult is dispatch-specific rather than foundational,
 *  and the inline build avoids the foundation-loader TDZ window that
 *  `Maybe` / `Result` / `Either` have to manage.
 *
 *  Spec: `fenel/modules/engine/dispatch.fenel`. */
export function LookupResult(a: FenelType): FenelType {
  return {
    $variant: {
      cases: [
        { name: "Unique", label: Nothing, fields: [{ name: "value", label: Nothing, type: a, meta: {}, ui: Nothing }] },
        {
          name: "Conflict",
          label: Nothing,
          fields: [{ name: "items", label: Nothing, type: List(a), meta: {}, ui: Nothing }],
        },
        { name: "None", label: Nothing },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// String — Phase 2.11 lazy-resolve via `foundationTemplates().Str`
//
// `Str` is the first non-parametric atom whose pure side is a parametric
// type-application (`List Char`), not a constructor list. Phase 2.11 added
// the opaque-decl type-expr-RHS grammar to admit `opaque "string" String =
// List Char` in `fenel/std/foundation.fenel`. The TS literal flips from
// the inline `{$opaque: {…, pure: List(Char)}}` build to a Proxy that
// lazy-resolves through `foundationTemplates().Str` on first access — the
// same canonical-named-ref pattern every prior opaque atom uses (the inner
// List's `head` field is `{$named: "Char"}` post-flip, not an inline
// Char). Consumers reading `Str.$opaque.pure` keep working transparently;
// the `$named ↔ $opaque` bridge in `set-algebra.ts:2625` resolves the
// named-ref vs. inline-opaque comparisons.
//
// Lazy via Proxy rather than eager-init because `foundationTemplates()`
// triggers `loadFenelModule`, which re-enters the parser — module-load
// time is inside the parser/builtin-classes TDZ window. The Proxy
// resolves on first property access, by which point every module on the
// import chain has finished evaluating regardless of which one was the
// entrypoint. Same posture the parametric helpers (Maybe / Result /
// Either / List) take, just at value-shape instead of function-call shape.
// ---------------------------------------------------------------------------

let _Str: FenelType | undefined;
function resolveStr(): FenelType {
  if (!_Str) _Str = foundationTemplates().Str;
  return _Str;
}
export const Str: FenelType = new Proxy({} as FenelType, {
  get(_t, k) {
    return (resolveStr() as Record<string | symbol, unknown>)[k as string];
  },
  has(_t, k) {
    return k in (resolveStr() as object);
  },
  ownKeys() {
    return Reflect.ownKeys(resolveStr() as object);
  },
  getOwnPropertyDescriptor(_t, k) {
    return Object.getOwnPropertyDescriptor(resolveStr() as object, k);
  },
});

/** Pair a b = (a, b) */
export function Pair(a: FenelType, b: FenelType): FenelType {
  return { $tuple: [a, b] };
}

/** Tagged value — phantom type for units, currencies, etc. */
export function Tagged(value: FenelType, phantom: FenelType): FenelType {
  return { $tagged: { value, phantom } };
}

/**
 * `Id h a` — a phantom-tagged, id-backed reference to a registry entity `a`,
 * with handle kind `h`. The canonical `Id<X>` type shape, in ONE producer.
 *
 * Two typing modes over one value (`{$ref: handle}`): transparent (typeOf
 * erases `Id h` → the referent type `a`, what Phases 1–7g built) and opaque
 * (typeOf keeps it → `Id<X>`, explicit deref — what the `$tagged` phantom +
 * `EntityIdPicker` express). Phase 8a of typed-function-references introduces
 * this builder so 8b's `typeOf` two-mode resolver and 8c's resolution-as-
 * dispatch have a single shape to evolve; the ~5 hand-rolled sites
 * (`builtin-classes.ts`, `admin-forms/profiles.ts`) now call it.
 *
 * `referent` is `a` — today encoded as a stringly entity name inside the
 * `$enum` phantom (the existing shape, kept BYTE-IDENTICAL). 8a does NOT
 * remove the `$enum`-name phantom; 8b's `typeOf` adds the `a`-as-referent
 * erasure on top.
 *
 * `handleKind` is `h` — the handle's type, defaulting to the canonical
 * `{$ref:"Id"}` handle every current call site uses (the open `Identifiable h`
 * class — `fenel/std/typeclass-specs.fenel`, declared inertly in 8a — names the
 * other handle kinds; resolution-as-dispatch lands in 8c).
 *
 * Signature note: param order is `(referent, handleKind?)`, not the brief's
 * sketched `(handleKind, referent)` — the referent is the always-supplied arg,
 * the handle defaults, so required-first keeps every migrated site a single-arg
 * byte-identical call.
 *
 * Discriminability (hard scope boundary, audit §F′): the `value` slot stays
 * `{$ref:"Id"}` so `Id` stays told apart from the other `$tagged` envelope
 * users — typed `MeasureExpr` scalars (value = `{$ref:"Rational"}`) and
 * `Place`/`GeoLevel` (value = `{$ref/$named:"GeoPath"}`) — by the same `value`
 * content the phantom readers (`phantomEntityName` / `phantomUnitOf` /
 * `phantomGeoLevelOf`) already disambiguate on.
 */
export function Id(
  referent: string,
  handleKind: FenelType = { $ref: "Id" },
): FenelType {
  // set-algebra-to-fenel Phase 3b-2 — the Id<X> phantom's `$refined.set` is a
  // SetExpr SLOT; route it through `buildSetExpr` (the ONE flip point) so it
  // emits the canonical `Se*` form post-flip. Lazy `require` breaks the
  // type-foundation ↔ set-marker load-time cycle (set-marker imports
  // Just/Nothing/refHandle from here) — the same deferred-require pattern
  // `idReferentType` uses for field-meta. The surrounding `$tagged` / `$ref`
  // FenelType envelope is the Ref substrate (typed-fn-refs 7g) — NOT flipped.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return {
    $tagged: {
      value: handleKind,
      phantom: { $refined: { base: { $ref: "String" }, set: buildSetExpr.enum([referent]) } },
    },
  };
}

/**
 * `idReferentType(idType, getEntityType?)` — the type-level ERASE direction of the
 * opaque mode's two-mode `typeOf`. Given an `Id h a` TYPE (the `$tagged` envelope
 * `Id(...)` emits), return the referent type `a`: read the phantom entity name,
 * resolve it through the catalog, return that entity's registered
 * `$record`/`$variant` kind. The type-level analogue of `Identifiable.resolve` —
 * the **deref primitive** every later step (8c's resolution-as-dispatch) folds
 * onto, and the thing that closes 8a's gap #1 at the TYPE level.
 *
 * Sibling to `refType` (the transparent value→type half) — same discipline:
 * optional injected lookup, pure, total, in-memory (no I/O), graceful `{$void}`
 * on a miss; never throws. Mirror its exact shape so 8c's dispatch can reuse it.
 *
 * The HARD scope boundary (audit §F′): an Id is recognised by its `value` slot
 * being the Id handle (`refHandle(value) === "Id"`) — the SAME discriminator that
 * keeps Id distinct from `Q` (tagged `Rational` base) and `Place` (`value` =
 * `GeoPath`). A `Q`/`Place` `$tagged` shape returns `{$void}` (they are NOT Id
 * refs). This is the line `phantomGeoLevelOf` already gates on, restated at the
 * resolver. (Note: `phantomEntityName` itself is a NON-disambiguating enum reader,
 * 8a surprise #1 — so the gate MUST be the `value`-slot check, not the name read.)
 *
 * typed-function-references Phase 8b. Pure-additive — no producer, no recognizer
 * rewiring, no dispatch flip (that is 8c); the class `Identifiable` stays inert.
 */
export function idReferentType(
  idType: FenelType,
  getEntityType?: (name: string) => FenelType | undefined,
): FenelType {
  const tagged = (idType as { $tagged?: { value?: unknown } } | null | undefined)?.$tagged;
  if (!tagged) return { $void: true };
  // Value-slot gate (the hard scope boundary): only the Id handle qualifies — a
  // `Q` (value = the tagged `Rational` base) or a `Place` (value = `GeoPath`)
  // shares the `$tagged` envelope but is NOT an Id ref.
  if (refHandle(tagged.value) !== "Id") return { $void: true };
  // Read the referent name off the phantom — reuse the Fenel-bodied
  // `phantomEntityName` walk (do NOT re-hand-roll the 4-level $enum descent). Lazy
  // `require` mirrors field-meta's own cycle break: type-foundation ↔ field-meta
  // (field-meta imports `refHandle` from here), so a static import would close a
  // load-time cycle; the deferred require resolves after both modules evaluate.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { phantomEntityName } = engineRequire("field-meta") as typeof import("./field-meta");
  const name = phantomEntityName(idType);
  if (name == null) return { $void: true };
  const entity = getEntityType?.(name);
  return entity ?? { $void: true };
}

/**
 * Refined type — base type constrained by a set.
 * Email = Refined String { $pattern: "^..." }
 * PositiveInt = Refined Int { $interval: { lo: { value: 0, inclusive: false } } }
 */
export function Refined(base: FenelType, set: SetExpr): FenelType {
  return { $refined: { base, set } };
}

// ===========================================================================
// array-substrate Phase 1a.5 — the `Fin` / `Vec` canonical builders.
//
// `Vec n a = $map (Fin n) a` is THE canonical vector: a TOTAL function from the
// finite index set `Fin n` to `a` (the representable / Naperian atom). It
// supersedes the retired `$refined List (length == n)` encoding (which only
// tracked length — you still got `List`'s partial `Maybe` indexing). The `$map`
// form proves indexing is TOTAL (`i : Fin n` is in-bounds by construction) AND
// is `$map`-shaped, so it inherits the Phase-1a `Functor`/`Foldable`/
// `Traversable (Map k)` algebra for FREE (Step 0 makes it fire parametrically).
// design/array-substrate.md § 1 is the locked encoding.
//
// `$opaque.repr` is optimization — the JS array is the shared runtime repr of
// the vector; the `$map`/pure view here is the source of truth.
// ===========================================================================

/** `Fin n` as a SetExpr — the index set of ONE axis = the half-open integer
 *  interval `[0, n)`. This is the `$map.keys` SLOT face (the slot wants a
 *  SetExpr, not a FenelType). `n` may be a literal Number or an Expression (a
 *  value-param ref `{var:"n"}` / sibling-field ref), carried as the `{$expr}`
 *  exclusive upper bound — `Bound.value` already admits `{$expr: Expression}`
 *  (types.ts), so a runtime-`n` `Fin` needs no primitive stretch. The bounds are
 *  wrapped `Maybe<Bound>` (`Just(...)`) — a bare `{value,inclusive}` crashes
 *  `marshalBound` (Phase-0 surprise #4). Canonical `$tag`-form `SeInterval` (the
 *  `positiveNat` precedent), NOT the legacy `$interval` `$`-key. */
export function FinInterval(n: number | Expression): SetExpr {
  const hiValue: Bound["value"] = typeof n === "number" ? n : { $expr: n };
  return {
    $tag: "SeInterval",
    interval: {
      lo: Just({ value: 0, inclusive: true }),
      hi: Just({ value: hiValue, inclusive: false }),
    },
  };
}

/** `Fin n : Type` — the index TYPE of one axis: `$refined Nat [0, n)`. The
 *  standalone-type face (the future `index`/`tabulate` arg in Phase 1b); `Vec`'s
 *  keys use the bare SetExpr face `FinInterval`. design § 1. */
export function Fin(n: number | Expression): FenelType {
  return { $refined: { base: Nat, set: FinInterval(n) } };
}

/** `Vec n a = $map (Fin n) a` — THE canonical vector (array-substrate Phase
 *  1a.5). A TOTAL function from `Fin n` to `a`; `$map`-shaped ⇒ inherits the
 *  Phase-1a algebra. Strictly stronger than the retired `$refined List
 *  (length==n)` (total indexing, not just length-tracking). */
export function Vec(elemType: FenelType, n: number | Expression): FenelType {
  return { $map: { keys: FinInterval(n), values: elemType } };
}

/**
 * `Array [d0, d1, …] a` — the multi-rank array (array-substrate Phase 1c).
 *
 * The subsumption (NO `$array` primitive, ever): a multi-rank array IS just a
 * NESTED `Vec` — `Array [n0,n1,…] a = Vec n0 (Vec n1 (… a))` — `$opaque`-wrapped
 * to carry the `Array` type-identity marker (the deferred strided-buffer
 * "ndbuffer" view; Phase 7). design/array-substrate.md § 1.
 *
 * - `dims = []` ⇒ **`elem`** (scalar rank-0 = the bare element type — atoms
 *   aren't special; a KIND difference from `$map`, design § 2c). The builder
 *   returns the literal element type, NOT an `$opaque`, NOT a `$map`.
 * - `dims = [n0, …, nk]` ⇒ `$opaque { name: "Array", pure: <nested Vec chain> }`
 *   where the chain is `Vec(n0, Vec(n1, … Vec(nk, elem)))`. The `$opaque` wraps
 *   the OUTER only (design § 1's literal formula `pure: Vec n0 (Vec n1 a)`), and
 *   is UNIFORM across ranks ≥ 1 (a single-rank `Array [n] a` is the `$opaque`-
 *   wrapped `Vec n a`, not a bare `Vec` — D2 decision: preserves the Array
 *   type-identity marker uniformly; the `$opaque` is transparent for membership
 *   / covariance / dispatch so the runtime VALUE is identical to a nested `Vec`
 *   value, `{$tag:"Vec"}` at every rank — the subsumption).
 *
 * D1 (the repr-duality, SETTLED by the Phase-1c Step-0 probe): the canonical
 * runtime VALUE of an `Array` is the nested tagged `Vec` value (`{$tag:"Vec"}`
 * at every rank — NO `{$tag:"Array"}` value tag is minted). So it inherits
 * `fmap`/`foldr` at the outer-frame rank directly via the structural `(Map k)`
 * instance, and indexes by rank-recursion (`index (index arr i) j`) from
 * `Representable Vec` — ZERO new dispatch work. The nested JS-array form
 * `[[…]]` is the `$opaque.repr` boundary/wire view (reflects to `List`; the
 * one-repr reconciliation is Phase 7). NO `repr` field on the `$opaque` (retired
 * representation-substrate Phase 5a — the `name` is the only marker;
 * [[feedback_opaque_is_optimization]]).
 *
 * Rides the SAME ledgered `$`-key marshal boundary the `Vec`/`List`/`Maybe`
 * builders do (the `$opaque`/`$map` `$`-keys a `.fenel` body cannot author) — a
 * marshal, not new logic. The variadic `dims` make `Array` primarily a BUILDER
 * (like `Vec(elem,n)`), not a fixed-arity parametric entity — see the
 * builder-only registration note (`fenel-surface-extensions` candidate: a
 * nested-array authoring surface is the real north-star fix).
 *
 * Named `ArrayT` (not `Array`) to avoid shadowing the JS global `Array` (a
 * module-hoisted `function Array` would break `Array.isArray` above) — the same
 * `T`-suffix collision-avoidance the nearby `unionT`/`intersectT`/`complementT`
 * type builders use. The Fenel-surface name / catalog codeName is still `Array`.
 */
export function ArrayT(dims: number[], elem: FenelType): FenelType {
  if (dims.length === 0) return elem;
  const n0 = dims[0]!;
  const rest = dims.slice(1);
  return { $opaque: { name: "Array", pure: Vec(ArrayT(rest, elem), n0) } };
}

// ===========================================================================
// set-algebra-to-fenel Phase 7 Step 1a — the tier-1 refinement-former smart
// constructors. The 6 SetExpr Boolean formers (union / intersect / complement
// / diff / top / bottom) made AUTHORABLE and DECIDED as first-class tier-1
// refinement forms (north-star §5), with ZERO core type-system blast radius:
// each (except bottom) is a `$refined{base, set:Se*}` — a `$refined` marshals
// to `TtRefined`, so the Phase-6 containment trio (subset/disjoint/empty)
// decides it FOR FREE via the already-Fenel SetExpr predicate arm (the Step-0
// probe proved this empirically — `notes/phase-7-step1a-step0-probe.md` §Q1).
//
// AUTHORING PATH (probe §Q2 = path 3): a `.fenel` body CANNOT author the
// `$refined`/`$void` envelope (the `$`-key marshal barrier `refine.fenel`
// documents), and there is no Fenel-callable `$refined` surface. So these are
// thin TS compositions of the EXISTING ledgered `Refined` builder (above) +
// the EXISTING `buildSetExpr.*` `$tag` constructors — NEW `$`-key marshal arms
// on an existing ledgered exception (`design/ts-exceptions-ledger.md`),
// allowed-with-flag per AGENTS.md (NOT a new KIND of TS; flagged in the probe
// note). At tier 1 the formers are refinements over ONE `base`, so the
// branches are SetExpr PREDICATES over that base (not arbitrary cross-base
// types — that is the tier-2 real-`FenelType`-constructor promotion, gated on
// a cross-base client + paying the ~10-TS-site blast radius; explicitly NOT
// built here). `bottomT` is `$void` directly (already first-class; `$none` is
// its SetExpr shadow, the `$void ≅ $none` iso already holds — `empty` agrees).
//
// Lazy `require("./set-marker")` mirrors `Id` (above): it breaks the
// type-foundation ↔ set-marker load-time cycle (set-marker imports
// Just/Nothing/refHandle from here).
// ---------------------------------------------------------------------------

/** `A ∪ B` over one base — `Int` refined by `{1,2} ∪ {3,4}`. The branches are
 *  SetExpr predicates over `base`; decided by `subset` (a union RHS is matched
 *  branch-wise) for free. */
export function unionT(base: FenelType, branches: SetExpr[]): FenelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return Refined(base, buildSetExpr.union(branches));
}

/** `A & B` over one base — `Int` refined by `(≥0) ∩ (≤10)`. Decided by `empty`
 *  (disjoint branches ⇒ `Just true`; inhabitation of overlapping branches is the
 *  tier-2 component-wise fold, P7-6) + `disjoint`. */
export function intersectT(base: FenelType, branches: SetExpr[]): FenelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return Refined(base, buildSetExpr.intersect(branches));
}

/** `¬A` over one base — `Int` refined by `¬(≥0)`. Decided by `disjoint`
 *  (`A` is disjoint from `¬A`). */
export function complementT(base: FenelType, inner: SetExpr): FenelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return Refined(base, buildSetExpr.complement(inner));
}

/** `A ∖ B` over one base — `Int` refined by `A ∖ B`. Decided by `empty`
 *  (`A ⊆ B ⇒ A∖B = ∅`). NOT canonicalized to `intersect(A, ¬B)` — that rewrite
 *  is a tier-2 generating-set choice with a universe-dependency obligation
 *  (P7-5, tightened); diff is the more total operation and stays first-class. */
export function diffT(base: FenelType, left: SetExpr, right: SetExpr): FenelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return Refined(base, buildSetExpr.diff(left, right));
}

/** Top over one base — `Int` refined by `⊤` (admits everything of `base`). Any
 *  `X` over the same base is `subset X (topT base)` ⇒ `Just true`. A BARE
 *  universal-type constructor is deferred (P7-2); `$refined{base, ⊤}` covers
 *  every tier-1 use. `Anything` below uses the existing tier-2 identity ¬Void
 *  when the requested universe is every Fenel value. */
export function topT(base: FenelType): FenelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { buildSetExpr } = engineRequire("set-marker") as typeof import("./set-marker");
  return Refined(base, buildSetExpr.all());
}

/** Bottom — the uninhabited type. `$void` directly (the ONE former already
 *  first-class). `bottomT ≡ Void`; `empty bottomT = Just true`. `$none`/`SeNone`
 *  is its SetExpr shadow (`$refined{base, SeNone}` is `empty` too). */
export const bottomT: FenelType = { $void: true };

/** Every Fenel value. This is the existing Boolean type algebra identity
 * ¬Void, not an unresolved reference named "Any" and not a new core former.
 * The live Fenel validator recognizes precisely this universal case. */
export const Anything: FenelType = { $complement: { $void: true } };

// ---------------------------------------------------------------------------
// Tier-2 cross-base former smart-ctors (containment-substrate Phase 2 Step 1b)
//
// The general form of `unionT`/`intersectT`/`complementT` (above) — these emit
// the REAL `{$union}`/`{$intersect}`/`{$complement}` FenelType constructors over
// arbitrary cross-base BRANCHES (`Int ∪ String`), not refinement predicates over
// ONE base. The tier-1 ctors stay the efficient shared-base special case.
//
// The predicate-branch LIFT (1a probe P1(b)): a branch that is a bare `SetExpr`
// predicate is NOT a type on its own (a predicate denotes a set only relative to
// a base/universe — ISO-1). Callers with a bare predicate must supply a base via
// `setExprAsType(base, se)` first; the tier-2 ctors take FenelType branches only.
// This is the §3.0 presentation-lift: ONE `$union` former over FenelType, a
// predicate branch admitted as `$refined{base, set}`.
// ---------------------------------------------------------------------------

/** Lift a bare `SetExpr` predicate to a FenelType by supplying its base/universe:
 *  `$refined{base, se}` (≡ `intersect(base, se)`, ISO-1). The clean home for a
 *  predicate branch entering a tier-2 union/intersect (never left bare). */
export function setExprAsType(base: FenelType, se: SetExpr): FenelType {
  return Refined(base, se);
}

/** Tier-2 untagged union `A ∪ B` over arbitrary FenelType branches
 *  (`unionTypes([Int, String])` ⇒ `{$union: [Int, String]}`). The general form
 *  of `unionT` (which is the shared-base `$refined{base, SeUnion}` special case).
 *  A predicate branch must be `setExprAsType(base, se)`-lifted first. */
export function unionTypes(branches: FenelType[]): FenelType {
  return { $union: branches };
}

/** Tier-2 intersection `A & B` over arbitrary FenelType branches. Built because
 *  ISO-1 (`$refined ≡ intersect`) and ISO-4 (`$record ≅ ∩-of-fields`) need a real
 *  `intersect` ctor to have content. */
export function intersectTypes(branches: FenelType[]): FenelType {
  return { $intersect: branches };
}

/** Tier-2 complement `¬A` over an arbitrary FenelType. Built because
 *  `diff = intersect(A, ¬B)` and ISO-1's leaf identity reference it. */
export function complementType(inner: FenelType): FenelType {
  return { $complement: inner };
}

// ---------------------------------------------------------------------------
// The inductive↔refinement ISO STATEMENTS (P7-3) — NAMED, TYPED STUBS ONLY.
//
// An iso is a pair of `$el` witness functions + round-trip laws (proof =
// inhabitant — laws/supers are `$el` dependent typing, NOT a `Presentations`
// typeclass, NOT a new substrate). These STATE the three conceptual identities
// the formers participate in; their BODIES are tier-2 / numeric-tower
// deliverables (the tower's rungs are the canonical iso-carriers — the witness
// shape is CO-DECIDED with `numeric-tower`'s Phase 0, D§4). They are documented
// here, beside the constructors, but NOT implemented (no registered fns ⇒
// law-count / codename-lock +0, the audit-green invariant). Do NOT add bodies
// in tier 1.
//
//   ISO-1  refinedAsIntersect : `$refined{base, P}` ≅ `intersect(base, refined-by-P)`
//          witnesses:  toIntersect : $refined{base,P} -> intersect(base, P)
//                      fromIntersect : intersect(base, P) -> $refined{base,P}
//          law: round-trip identity both ways (∀ t. fromIntersect (toIntersect t) = t).
//          STATUS: the §5 identity to PROVE; `intersect` is not yet a real
//          FenelType constructor (tier 2), so the witnesses have no content yet.
//
//   ISO-2  variantAsTaggedUnion : `$variant` ≅ tagged-disjoint-`$union`
//          witnesses:  variantToUnion : $variant -> tagged $union
//                      unionToVariant : tagged $union -> $variant
//          law: round-trip + tag-disjointness preserved.
//          STATUS: the load-bearing posture-lock (P7-1) — `$variant` STAYS the
//          efficient primitive (the `$opaque{repr,pure}` precedent: $variant is
//          the perf form, tagged-union is the language-conceptual form). The
//          CONSTRUCTION is deferred to tier 2 (cannot write it while `$union` is
//          not a real constructor). Until then subset/disjoint/empty treat
//          `$variant` case-wise exactly as `containment.fenel` already does.
//
//   ISO-3  voidAsNone : `$void` ≅ `$none` (= `$refined{base, SeNone}`)
//          witnesses:  identity both ways (both denote ∅).
//          law: `empty $void = empty (refined SeNone) = Just true`.
//          STATUS: ALREADY HOLDS — the ONE fully-settled iso (the probe confirms
//          both sides decide `Just true`); `bottomT` and `$none` agree today.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Common refinements
// ---------------------------------------------------------------------------

/** ℕ⁺ — positive natural (> 0).
 *  Base is `{$named: "Nat"}` (a registry reference) rather than the
 *  inline opaque-wrapped Nat so the shape matches what
 *  `fenel/std/foundation.fenel`'s `PositiveNat = Nat | value ∈ [1..)`
 *  parses to. Same canonical-shape move Phase 2 / 2.5 / 2.6 made for
 *  Nat / Int / List / Char self-refs. */
export const PositiveNat: FenelType = {
  $refined: { base: { $ref: "Nat" }, set: positiveNat },
};

/** NonNegative integer (ℕ as a refinement of ℤ). Base is `{$named:
 *  "Int"}` for the same canonical-named-ref reason as PositiveNat. */
export const NonNegInt: FenelType = {
  $refined: {
    base: { $ref: "Int" },
    // 3b-2 — canonical `$tag` SeInterval (inlined; init-time const).
    set: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } },
  },
};

/** containment-substrate Phase 3 — the inductive↔refinement iso codomain
 *  aliases for the Int / Rational / Real tower rungs (the NonNegInt twin
 *  precedent). Each is the REFINEMENT presentation of a rung: `{ x: Number |
 *  x ∈ <glyph> }`, with the glyph the registered numeric named-set (ℤ →
 *  membershipInt, ℚ/ℝ → membershipReal). These are the precise codomains the
 *  numeric tower's `int/rat/real ToRefined` witnesses retype onto (off their
 *  former codomain-`Number` stub). The `$tag SeRef` form matches what
 *  `fenel/std/foundation.fenel`'s `Integer = Number | value ∈ ℤ` (etc.) parses
 *  to — the ledgered `$`-key marshal twin, NOT new language logic.
 *  `foundation-load.test.ts` asserts the two paths agree byte-for-byte. */
export const Integer: FenelType = {
  $refined: { base: { $ref: "Int" }, set: { $tag: "SeRef", handle: "ℤ" } },
};

export const RationalNumber: FenelType = {
  $refined: { base: { $ref: "Rational" }, set: { $tag: "SeRef", handle: "ℚ" } },
};

export const RealNumber: FenelType = {
  $refined: { base: { $ref: "Number" }, set: { $tag: "SeRef", handle: "ℝ" } },
};

/** NonEmpty string — String | value.length > 0.
 *
 *  Predicate refinement (Phase 1 syntax). Base is `{$named: "String"}`
 *  (a registry reference) rather than the inline opaque-wrapped `Str` so
 *  the shape matches what `fenel/std/paths.fenel`'s
 *  `NonEmptyStr = String | value.length > 0` parses to — same canonical
 *  named-ref move Phase 2 / 2.5 / 2.6 / 2.7 made for self-refs.
 *
 *  The `$where` body is the canonical call-form `{call: ["gt", …]}` —
 *  the legacy operator-form (`{">": [...]}`) was retired by migration
 *  `0040_operator_form_to_call.sql` at the storage layer; this in-memory
 *  TS literal finally catches up. Semantically equivalent — the runtime
 *  evaluates both shapes through the same operator-form fallback in
 *  `BUILTIN_OP_NATIVES` — but the conformance assertions check byte-for-
 *  byte equality, so the in-memory literal must match the parsed shape. */
export const NonEmptyStr: FenelType = {
  $refined: {
    base: { $ref: "String" },
    // 3b-2 — canonical `$tag` SeWhere (inlined; init-time const).
    set: { $tag: "SeWhere", pred: { call: ["gt", { var: "value.length" }, 0] } },
  },
};

/** A string of emoji characters only — every codepoint must satisfy
 *  Unicode's Emoji_Presentation property. The `str:emoji` named set is
 *  registered in char-classes.ts (paired with the per-char `char:emoji`).
 *  Used by the `Emojiable` typeclass's `emoji` method.
 *
 *  Phase 2.10 — base flipped from inline `Str` opaque to `{$named: "String"}`
 *  so the shape matches what `fenel/std/paths.fenel`'s `EmojiString = String
 *  | value ∈ str:emoji` parses to. Unblocked by the parseSetForm source-
 *  slice rewrite — the lexer no longer collapses the `str:emoji` `:` into
 *  the lossy `parts.join(" ")` reassembly. */
export const EmojiString: FenelType = {
  $refined: {
    base: { $ref: "String" },
    // 3b-2 — canonical `$tag` SeRef (inlined; init-time const). The FenelType
    // `base: {$ref:"String"}` above is NOT a SetExpr — it stays a `$ref` atom.
    set: { $tag: "SeRef", handle: "str:emoji" },
  },
};

// ---------------------------------------------------------------------------
// Phantom type tags (used with Tagged)
// ---------------------------------------------------------------------------

/** A currency tag — e.g. Tagged(Rational, CurrencyTag("USD")) */
export function CurrencyTag(code: string): FenelType {
  // 3b-2 — canonical `$tag` SeEnum in the `$refined.set` slot (base stays a $ref atom).
  return { $refined: { base: { $ref: "CurrencyCode" }, set: { $tag: "SeEnum", values: [code] } } };
}

// ---------------------------------------------------------------------------
// Filesystem path — algebraic representation
//
// Sister to the string-side `format:path:*` named-set family. Same domain
// (filesystem paths), two views:
//
//   format:path:* (refined String)  — for user input, validation, storage
//   Path (this type)                — for structured manipulation, pattern
//                                     matching, capability proofs
//
// Modeled as a discriminated union so that "absolute vs relative" is a
// type-level fact (you can't accidentally call `parent` on an absolute path
// expecting a relative result, etc.). Roots are themselves a sum:
//
//   PathRoot = PosixRoot                     (`/`)
//            | DriveRoot { letter: 'A'..'Z' }  (`C:\`)
//            | UncRoot   { server, share }     (`\\srv\share\`)
//
//   PathSegment = NameSeg String | ParentSeg | CurrentSeg
//
//   Path = AbsolutePath { root, segments }
//        | RelativePath { segments }
//
// Drive letters are a refined single-character String (case-insensitive
// accept; canonical form is uppercase). Modeled as String — not Char
// (codepoint) — so the on-the-wire shape is what users actually type.
// ---------------------------------------------------------------------------

/** A drive letter — single ASCII letter, case-insensitive (canonical: uppercase).
 *
 *  Phase 2.10 — base flipped from inline `Str` opaque to `{$named: "String"}`
 *  matching the parsed `fenel/std/paths.fenel` template. `regexSet(...)`
 *  stays — the regex-shim AST it produces is identical to what
 *  `parseSetExpr.parsePattern` emits for the same `/^[A-Za-z]$/` literal
 *  (both call paths reach `regexStringToPattern`). */
// regex-derivative-to-fenel Phase 2 (Slice B) — `regexSet` now dispatches to
// the Fenel `engine:regexToPatternMarker` body (via regexStringToPattern),
// which needs the engine harness. Building the `set` EAGERLY at this
// top-level `export const` would fire that dispatch DURING type-foundation's
// module load — re-firing the load cycle the file header documents (the
// harness build re-enters the foundation modules). So the `set` is resolved
// LAZILY + memoized on first ACCESS (a getter): by then every module has
// loaded and the dispatch is safe (the same load-order discipline the
// dispatchedPattern* deciders rely on by being called only at validation
// time). `builtinTypes` is never deep-walked at registry-build time (only
// re-exported), so the getter never fires mid-build.
let _driveLetterSet: SetExpr | undefined;
export const DriveLetter: FenelType = {
  $refined: {
    base: { $ref: "String" },
    get set(): SetExpr {
      if (_driveLetterSet === undefined) _driveLetterSet = regexSet("^[A-Za-z]$");
      return _driveLetterSet;
    },
  },
} as unknown as FenelType;

/** A single path segment. Variant: NameSeg(NonEmptyStr) | ParentSeg | CurrentSeg.
 *  Field types use `{$named: "NonEmptyStr"}` refs (registry-resolved at
 *  lookup time) rather than the inline `NonEmptyStr` const so the shape
 *  matches what `fenel/std/paths.fenel`'s `PathSegment = NameSeg value:
 *  NonEmptyStr | …` parses to. */
export const PathSegment: FenelType = {
  $variant: {
    cases: [
      { name: "NameSeg", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "NonEmptyStr" }, meta: {}, ui: Nothing }] },
      { name: "ParentSeg", label: Nothing },
      { name: "CurrentSeg", label: Nothing },
    ],
  },
};

/** Path root — the discriminator for absolute paths. UncRoot's server /
 *  share fields use `{$named: "NonEmptyStr"}` refs for the same canonical-
 *  named-ref reason as PathSegment.NameSeg.value. */
export const PathRoot: FenelType = {
  $variant: {
    cases: [
      { name: "PosixRoot", label: Nothing },
      { name: "DriveRoot", label: Nothing, fields: [{ name: "letter", label: Nothing, type: { $ref: "DriveLetter" }, meta: {}, ui: Nothing }] },
      {
        name: "UncRoot",
        label: Nothing,
        fields: [
          { name: "server", label: Nothing, type: { $ref: "NonEmptyStr" }, meta: {}, ui: Nothing },
          { name: "share", label: Nothing, type: { $ref: "NonEmptyStr" }, meta: {}, ui: Nothing },
        ],
      },
    ],
  },
};

/** Path = AbsolutePath { root, segments } | RelativePath { segments }. */
export const Path: FenelType = {
  $variant: {
    cases: [
      {
        name: "AbsolutePath",
        label: Nothing,
        fields: [
          { name: "root", label: Nothing, type: { $ref: "PathRoot" }, meta: {}, ui: Nothing },
          { name: "segments", label: Nothing, type: List({ $ref: "PathSegment" }), meta: {}, ui: Nothing },
        ],
      },
      {
        name: "RelativePath",
        label: Nothing,
        fields: [
          { name: "segments", label: Nothing, type: List({ $ref: "PathSegment" }), meta: {}, ui: Nothing },
        ],
      },
    ],
  },
};

/** A path-shaped string — refined String with the base format:path predicate.
 *
 *  Phase 2.10 — base flipped from inline `Str` opaque to `{$named: "String"}`
 *  matching the parsed `fenel/std/paths.fenel` template. */
export const PathStr: FenelType = {
  $refined: {
    base: { $ref: "String" },
    set: { $tag: "SeRef", handle: "format:path" },
  },
};

// ---------------------------------------------------------------------------
// Registry of built-in type definitions
// ---------------------------------------------------------------------------

export const builtinTypes: Record<string, FenelType> = {
  Void,
  Unit,
  Bool,
  Nat,
  Int,
  Rational,
  Char,
  String: Str,
  PositiveNat,
  NonNegInt,
  // containment-substrate Phase 3 — the Int/Rational/Real refinement-presentation
  // aliases (the NonNegInt resolution-path precedent: bare refinement aliases
  // resolve as `$ref` targets via builtinTypes, not the directive-gated
  // foundationEntityRegs auto-loop).
  Integer,
  RationalNumber,
  RealNumber,
  NonEmptyStr,
  DriveLetter,
  PathSegment,
  PathRoot,
  Path,
  PathStr,
};

// Per-language number types (JsNumber, PyInt, RustI8, …) live in
// `lang-numbers.ts` and are merged into `builtinTypes` from `index.ts`
// (after both modules load), to avoid the import cycle that would arise
// here (lang-numbers imports Int / Rational / Refined from this file).

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("type-foundation") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_type_foundation from "./type-foundation";
import { registerEngineModule as __reg_type_foundation } from "./engine-require";
__reg_type_foundation("type-foundation", __self_type_foundation);
