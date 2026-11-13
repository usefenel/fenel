// ---------------------------------------------------------------------------
// Fenel Engine — Universal Type System
//
// The foundational types for the Fenel platform.
// Everything is expressed through this type system: form fields, action
// parameters, entity schemas, event payloads, flow variables.
//
// Zero dependencies. Pure types + data structures.
// ---------------------------------------------------------------------------

// The dispatch class + instance types live in `./class-types` and are
// re-exported here. Phase 3.3a (typeclass-substrate-completion) retired the
// four nominal `Spec*` names (`SpecRecordSeed` / `SpecRecordMethod` /
// `SpecRecordLaw` / `SpecInstance`) — which themselves succeeded the legacy
// `Typeclass*` ADTs — for the neutral `Class*` names. Same runtime shapes.
import type { Instance } from "./class-types";
import type { AuthorityRef } from "./authority";
export type {
  Instance,
  InstanceDeclaration,
  Interface,
  InterfaceMethod,
  InterfaceLaw,
} from "./class-types";

// ---------------------------------------------------------------------------
// Expression — JSON Logic as the universal expression language
// ---------------------------------------------------------------------------

/**
 * A JSON Logic expression (stored as JSON, evaluated client + server).
 * See https://jsonlogic.com/operations.html
 *
 * Expressions are pure data — no eval(), read-only access to context.
 * They can return any type (boolean, number, string, array, object).
 */
export type Expression = Record<string, unknown>;

/**
 * A value that is either a literal T or an expression that evaluates to T
 * at runtime. The `$expr` wrapper disambiguates from plain objects.
 */
export type MaybeExpr<T> = T | { $expr: Expression };

// ---------------------------------------------------------------------------
// Composite — generic AND/OR tree
// ---------------------------------------------------------------------------

/**
 * A composable tree where leaves are `Leaf` and branches are AND/OR groups.
 * This is the universal composition mechanism for conditions, triggers,
 * and any other domain that needs boolean combination of primitives.
 *
 * Instantiations:
 * - Composite<BooleanExpr>  → branch conditions, field visibility
 * - Composite<TriggerSpec>  → wait conditions (AND = all, OR = any)
 * - Composite<Effect>       → composite actions (future)
 */
export type Composite<Leaf> =
  | Leaf
  | { op: "and"; children: Composite<Leaf>[] }
  | { op: "or"; children: Composite<Leaf>[] };

/** Check if a Composite node is an AND/OR group (not a leaf) */
export function isCompositeGroup<L>(node: Composite<L>): node is { op: "and" | "or"; children: Composite<L>[] } {
  return typeof node === "object" && node !== null && "op" in node && ("op" in node && ((node as any).op === "and" || (node as any).op === "or")) && "children" in node;
}

/** Map over all leaves in a Composite tree */
export function mapComposite<A, B>(node: Composite<A>, fn: (leaf: A) => B): Composite<B> {
  if (isCompositeGroup(node)) {
    return { op: node.op, children: node.children.map((c) => mapComposite(c, fn)) };
  }
  return fn(node as A);
}

/** Fold a Composite tree to a single value */
export function foldComposite<L, R>(
  node: Composite<L>,
  onLeaf: (leaf: L) => R,
  onGroup: (op: "and" | "or", results: R[]) => R,
): R {
  if (isCompositeGroup(node)) {
    return onGroup(node.op, node.children.map((c) => foldComposite(c, onLeaf, onGroup)));
  }
  return onLeaf(node as L);
}

// ---------------------------------------------------------------------------
// Set Algebra — the universal constraint language
//
// Types ARE sets. Validation = set membership. Subtyping = set inclusion.
// Replaces ad-hoc constraint bags with a closed algebra:
//   union, intersection, complement, intervals, predicates.
//
// Every legacy constraint (min, max, format, pattern, options) desugars
// into a SetExpr. New code uses SetExpr directly.
// ---------------------------------------------------------------------------

/** A boundary value in an interval — can be literal or expression-based */
export type Bound = {
  value: number | string | { $expr: Expression };
  inclusive: boolean;
};

/** An interval on an ordered type — Nothing on lo/hi = unbounded */
export type Interval = {
  lo: Maybe<Bound>;
  hi: Maybe<Bound>;
};

/**
 * A set expression — defines a set of values.
 *
 * Dual role: BOTH a constraint language AND a value type.
 *
 * As constraint: field.set = { $tag: "SeInterval", interval: { lo: ... } }
 * As value:      a date "2025" at year resolution IS a SeInterval value.
 *                a multi-country selection IS a SeEnum value.
 *
 * Any scalar field (string, number, date) accepts T | SetExpr as its value.
 * The canonical host representation is the registered `$tag` ADT. Legacy
 * `$`-key values are accepted only by the structural boundary in
 * `set-marker.ts`; they are not members of this type.
 *
 * Composable via union, intersection, difference, complement.
 * Intervals for ordered types, patterns for strings, predicates for anything.
 *
 * Examples use `buildSetExpr` from `set-marker.ts`; direct values use the
 * corresponding SeInterval / SeRef / SeIntersect / SeEnum / SePattern /
 * SeUnion / SeWhere registered constructors.
 */
export type SetCtorField = {
  $tag: "SetCtorField";
  /** Stable semantic axis. Named fields use their UUID-backed FieldRef;
   * positional fields use the containing constructor ordinal. */
  key: FieldKey;
  /** Current source/JSON/object-property projection. Never an equality key. */
  wireName: string;
  set: SetExpr;
};

export type SetArrowParam = {
  $tag: "SetArrowParam";
  /** Retained identity metadata. Arrow variance still pairs by list position. */
  key: FieldKey;
  /** Current source/emission projection; not used to align parameters. */
  wireName: string;
  set: SetExpr;
};

/** The registered 15-case Fenel `SetExpr` ADT's mandatory host value shape.
 *
 * `SeRigid` (signature-substrate Phase 4 slice 3a) is the VALIDATION-ONLY rigid
 * atom κ. It is mirrored here so exhaustive host switches over `SetExpr` fail
 * to COMPILE rather than silently inherit some other constructor's default arm
 * — this mirror IS the TypeScript-side census. Non-escape is ASYMMETRIC: the
 * structural recognizer and the canonicalization gateway DO know a rigid (the
 * internal deciders must be able to reason about one), while the `$`-key egress
 * codec `setExprToDollarKey` REJECTS it — at any depth, since its recursive
 * arms route back through the same guard. There is no `$`-key spelling, no
 * named-set resolution, and no UI authoring surface; the only rigid projection
 * that may leave a validation frame is the `fenel.validation.rigid.v1` digest.
 * This extends the already-ledgered registered-ADT mirror boundary; it adds no
 * new semantics. */
export type SetExpr =
  | { $tag: "SeAll" }
  | { $tag: "SeNone" }
  | { $tag: "SeEnum"; values: unknown[] }
  | { $tag: "SeInterval"; interval: Interval }
  | { $tag: "SeRef"; handle: string }
  | { $tag: "SePattern"; pattern: Pattern }
  | { $tag: "SeWhere"; pred: Expression }
  | { $tag: "SeCtor"; ctor: string; fields: SetCtorField[] }
  | { $tag: "SeMu"; var: string; body: SetExpr }
  | { $tag: "SeArrow"; params: SetArrowParam[]; returns: SetExpr }
  | { $tag: "SeRigid"; scopeToken: string; ordinal: number; kind: unknown }
  | { $tag: "SeUnion"; branches: SetExpr[] }
  | { $tag: "SeIntersect"; branches: SetExpr[] }
  | { $tag: "SeDiff"; left: SetExpr; right: SetExpr }
  | { $tag: "SeComplement"; inner: SetExpr };
// `$preimage` and `$decompose` SetExpr constructors retired in Phase 3
// of the implementation roadmap. The function-composition shape behind
// `$preimage` (a predicate `set(agg(value))`) now lives directly inside
// `$where`; the `$decompose` parser-then-shape-match flow migrates to
// `Decodable<String, T>` typeclass-instance lookup. See
// design/structural-introspection.md Instance 1 and Instance 2 for the
// design rationale; the migration is mechanical at call sites because
// `$where` and Decodable already exist as substrate.

/**
 * Pattern — algebraic regex over sequences of values.
 *
 * Mutually recursive with SetExpr: each `match` carries a SetExpr predicate
 * over the element type (typically Char for string patterns, but any value
 * type works — events, tokens, records). Brzozowski-derivative-friendly.
 *
 * Defined here (not in pattern.ts) because SetExpr.$pattern : Pattern and
 * Pattern.match.pred : SetExpr is a true mutual recursion. Algorithms
 * (deriv, patternMatch, patternSubset, smart constructors) live in pattern.ts.
 *
 * The `group` constructor is the typed-capture form: when the pattern
 * matches, the subsequence consumed inside the group is captured under
 * `name`. If `type` is present, the captured value (joined as a string for
 * Char sequences) must additionally satisfy that SetExpr — letting one
 * SetExpr say "URL whose path segment is a valid Path" or "phone whose
 * country-code segment is one of {US, CA}".
 */
export type PatternOf<Set> =
  | { t: "empty" }
  | { t: "eps" }
  | { t: "match"; pred: Set }
  | { t: "seq"; a: PatternOf<Set>; b: PatternOf<Set> }
  | { t: "alt"; a: PatternOf<Set>; b: PatternOf<Set> }
  | { t: "rep"; child: PatternOf<Set>; min: number; max: number }
  | { t: "group"; name: string; child: PatternOf<Set>; type?: Set };

/** Canonical Pattern values carry canonical SetExpr children. `PatternOf` is
 * exported so the unknown host codec can represent its raw child slots
 * honestly without pretending legacy children are canonical SetExpr. */
export type Pattern = PatternOf<SetExpr>;

// Runtime ownership lives beside the one structural recognizer. Re-exporting
// preserves the historical `@fenel/engine/types` entry without duplicating a
// tag/key roster here. This is intentionally a Boolean, not a type predicate:
// it also recognizes legacy boundary input, which is not canonical `SetExpr`.
export { isSetExpr } from "./set-marker";

// ---------------------------------------------------------------------------
// Resolution — granularity constraints
//
// Resolution is orthogonal to range (SetExpr). Range says WHERE a value can
// be. Resolution says HOW PRECISELY it can be specified.
//
// One concept, multiple domains:
//   Numbers:   step size as a fraction [num, den] — e.g. [1, 100] = cents
//   Dates:     precision level — year, month, day, hour, minute, second
//   Trees:     max depth in a hierarchy (geo zones, taxonomies, org charts)
//
// The unifying abstraction: a value must land on a grid. The grid can be
// arithmetic (numbers), temporal (dates), or structural (tree depth).
//
// Resolution is enforced by validation (snap/reject) and by UI (input type).
// ---------------------------------------------------------------------------

/** Date precision levels — ordered coarse → fine */
export type DateResolution = "year" | "month" | "day" | "hour" | "minute" | "second";

/** All date resolution levels in order, for comparison */
export const DATE_RESOLUTION_LEVELS: DateResolution[] = [
  "year", "month", "day", "hour", "minute", "second",
];

/**
 * A resolution lattice — defines the granularity levels for a domain.
 *
 * For numbers: levels are generated lazily (infinite decimal precision).
 * For dates: fixed list of 6 levels.
 * For tree-based types: levels come from the tree's depth labels.
 */
export type ResolutionLattice = {
  /** Lattice name (e.g. "decimal", "time", "geography") */
  name: string;
  /** Ordered levels, coarse → fine. May be lazy (generator). */
  levels: () => Iterable<ResolutionLevel>;
  /** Compare two level names: -1 = a coarser, 0 = same, 1 = a finer */
  compare: (a: string, b: string) => -1 | 0 | 1;
  /** Validate that a value conforms to the given resolution level */
  validate: (value: unknown, level: string) => boolean;
  /** Truncate a value to fit the given resolution level */
  truncate: (value: unknown, level: string) => unknown;
};

export type ResolutionLevel = {
  /** Level name (e.g. "cents", "month", "postal_code") */
  name: string;
  /** For numeric lattices: the step size as [numerator, denominator].
   *  Canonical-maybe Phase 7d (2026-05-27): lifted from `?:` to
   *  `Maybe<[number, number]>`. */
  step: Maybe<[number, number]>;
  /** Human-readable label */
  label?: LocaleString;
};

// ---------------------------------------------------------------------------
// Type Foundation — Σ + μ
//
// Two primitives. Everything else derived.
//   Σ (dependent sum) → products, sums, records, unions, refinement
//   μ (fixpoint)      → recursion (Nat, List, Tree, ...)
//
// The "pure" layer — mathematical definitions for type-level reasoning.
// Each pure type maps to a "real-world" runtime representation.
// ---------------------------------------------------------------------------

/** Stable identity of a named field. The handle is a UUID once a definition
 * enters an identified registry view. */
export type FieldRef = { readonly $ref: string };

/** The explicit identity mode of a field occurrence (field-identity Phase 1).
 *
 * Named fields carry the one universal Ref shape. The ref handle is the
 * owner-qualified field code-name in a lock-less registry and the pinned UUID
 * in a lock-bearing registry. Positional fields are structural: their ordinal
 * in the containing field list is their identity, so they never mint UUIDs. */
export type FieldKey =
  | {
      readonly $tag: "NamedField";
      readonly ref: FieldRef;
    }
  | {
      readonly $tag: "PositionalField";
      readonly index: number;
    };

/** A field in a record (product type). Optionality is encoded as `type: Maybe a`
 *  (a `$variant`); codec-boundary absence goes via `Undefinable` + `isErasableType`.
 *  The `label` / `ui` / `meta` slots carry presentation and form-only metadata —
 *  same data the legacy FormField sub-`fields[]` sidecar carried, now inline so
 *  the type itself owns its surface. Pure-type consumers ignore these. */
export type FieldDef = {
  /** Compatibility/source/wire projection. Phase 1 deliberately keeps this
   * mandatory and authoritative for existing consumers while UUID identity is
   * staged beside it. */
  name: string;
  /** Optional explicit identity/reuse pin. Legacy definitions omit it and are
   * normalized registry-locally: canonical `_n` spellings become positional;
   * other names resolve through the owner-qualified universal lock. Requiring
   * this slot is a later cleanup after all producers have converged. */
  key?: FieldKey;
  type: FenelType;
  /** Display label for this sub-field.
   *  Canonical-maybe Phase 7a (2026-05-26): lifted from `?:` to
   *  `Maybe<LocaleString>`. The "humanize from name when absent"
   *  cascade lives at every consumer site (the FieldRenderer
   *  `<FieldLabel>`, validation error message builder, type-foundation's
   *  the registry field-presentation resolver — read legacy values via
   *  `peelMaybeValue(field.label) ?? humanizeCodeName(field.name)`. */
  label: Maybe<LocaleString>;
  /** Edit-mode display hints (placeholder, options, widget …).
   *  Canonical-maybe Phase 7b (2026-05-26+): lifted from `?:` to
   *  `Maybe<EditDisplay>`. Read via the local-bind idiom for multi-slot
   *  cascades:
   *    const ui = peelMaybeValue(field.ui);
   *    if (ui?.widget.$tag === "Just") …
   *  or the typed-extract idiom for single-slot reads:
   *    field.ui.$tag === "Just" && field.ui._0.widget.$tag === "Just". */
  ui: Maybe<EditDisplay>;
  /** Form-only metadata sidecar (transforms, units, refEntityType …).
   *  Canonical-maybe Phase 9 (2026-05-27): lifted from `?:` to
   *  mandatory. Empty `{}` is the natural absence-marker; the
   *  codec layer reads `isErasableType(FieldMetadata) === true`
   *  (via the Phase 8 `fieldMetadataUndefinable` preview-instance)
   *  to know it can omit the slot from JSON Schema's `required[]`. */
  meta: import("./field-meta").FieldMetadata;
};

/** Registry-resolved view: every declaration has a total key without mutating
 * the shared FieldDef object stored in a module/type definition. */
export type IdentifiedFieldDef = FieldDef & { readonly key: FieldKey };
// FM-retire-Z (2026-06-10): the `default: Maybe<unknown>` slot is RETIRED.
// Per-field defaults are an anti-pattern — a default value of a type is the
// type-level `HasDefault` typeclass (`field-meta.ts:defaultValueFor` →
// `registry.resolve(handle, "HasDefault")`). The class-method-default channel
// (`field: T = expr`) now rides the harvested `FenelModule.methodDefaults`
// sidecar into `InterfaceMethod.body` (see `seedFromType`). No `default` slot, no
// `@default` directive.

/** A variant (constructor) in a sum type. Optional `label` for the case's
 *  display name; payload fields carry their own metadata via FieldDef.
 *  Canonical-maybe Phase 7a (2026-05-26): `label` lifted from `?:` to
 *  `Maybe<LocaleString>` in lockstep with FieldDef.label. */
export type CaseDef = {
  name: string;
  /** Owned ordinary constructor Function value; its UUID is independent of
   * this type and every payload Field. Names remain Codeable projections. */
  constructorFunction?: { $ref: string };
  fields?: FieldDef[];
  label: Maybe<LocaleString>;
};

/**
 * FenelType — the universal type definition.
 *
 * Everything is Σ + μ underneath, but practical shorthands are provided
 * for common patterns (list, maybe, result, tagged).
 */
export type FenelType =
  // --- Atoms ---
  | { $void: true }
  | { $unit: true }
  // 7g-retire-4c (typed-function-references): `{$named}` REMOVED — a type
  // reference is `{$ref: H}` now (the `Ref` substrate; H = codeable-name or
  // UUID, resolved via the registry). The four ad-hoc name-keyed reference
  // forms (`$named` / SchemaRef / the editor saved-value ref / the function
  // ref) collapse onto the one `{$ref}`. 7g-retire-final: `{$named}` FULLY
  // RETIRED (producers + on-disk migration 0086 + read paths all `{$ref}`).
  | { $ref: string }
  | { $var: string }

  // --- Σ specializations ---
  | { $record: { fields: FieldDef[] } }
  | { $variant: { cases: CaseDef[]; discriminator?: string } }
  | { $tuple: FenelType[] }
  // --- Map: heterogeneous indexed dictionary, keys ∈ SetExpr, uniform value type ---
  // - keys: $ref "String" → open string-keyed map (TS-style index signature)
  // - keys: $ref "UserId" → typed-key map (Map<UserId, User>)
  // - keys: $enum [...] → finite-keyed (record-shaped, but partial: keys may be absent)
  // Subtyping is covariant in both: K1 ⊆ K2 ∧ V1 <: V2 ⇒ Map<K1,V1> <: Map<K2,V2>.
  // Records remain a separate, exhaustive constructor — see `$record` above.
  | { $map: { keys: SetExpr; values: FenelType } }

  // NOTE: the `$app` constructor for generic application is RETIRED as of
  // Phase 1 of typeclass-substrate-completion. Deferred type-level apps now
  // uniformly use `{$el: {call: [con, ...args]}}` — the same unified
  // dependent-type substrate. The parser canonicalises every production
  // type constructor (`Maybe<T>` / `List<T>` / `Result<E,A>` / `Map<K,V>` /
  // `Tagged<T,P>` / `Verified<P>` / `EntityRef<"name">`) to its actual
  // FenelType shape via `liftGenericApp` / `liftJuxApp` in
  // `fenel-parser.ts:2123-2179`; anything that falls through (no
  // production callsite reaches it today) is emitted as `$el.call`.
  //
  // `$list` / `$maybe` / `$result` were also legacy shorthand encodings;
  // collapsed to their canonical forms:
  //   List a  = $opaque { name: "List", pure: Nil | Cons { head: a, tail: List } }
  //   Maybe a = $variant { Nothing | Just { _0: a } }
  //   Result e a = $variant { Err { _0: e } | Ok { _0: a } }
  // Construct via the `List(a)` / `Maybe(a)` / `Result(e, a)` helpers in
  // `type-foundation.ts`; recognise via `peelList` / `peelMaybe` / `peelResult`
  // in `set-algebra.ts`.

  // --- Refinement: Σ(x : base, proof : P(x)) with proof erasure ---
  | { $refined: { base: FenelType; set: SetExpr } }

  // --- Tier-2 cross-base Boolean formers (containment-substrate Phase 2 Step 1b)
  // The set lattice promoted to sit BESIDE $variant/$record as first-class
  // FenelType constructors, composing across DIFFERENT base types (`Int ∪ String`,
  // not just `Int refined by P ∪ Q`). The tier-1 refinement smart-ctors
  // (unionT/intersectT/… in type-foundation.ts) stay the efficient shared-base
  // special case (`$refined{base, SeUnion}`); these are the general conceptual
  // form (the $opaque{repr,pure} discipline — keep the cheap rep, promote the
  // general one). There is ONE `$union` former over FenelType BRANCHES; a SetExpr
  // predicate branch is admitted as `$refined{base, set}` (presentation-lift, NOT
  // a literal Se*-into-FenelType fold — design-lock §3.0). `$ref` is the precedent:
  // the one node already in BOTH the FenelType and SetExpr unions.
  //   • $union      — untagged `A ∪ B`, branches arbitrary types
  //   • $intersect  — `A & B` (ISO-1 `$refined ≡ intersect` + ISO-4 need it)
  //   • $complement — `¬A` (diff = intersect(A, ¬B); ISO-1's leaf identity)
  // `diff` gets NO real ctor (sugar intersect(A, ¬B)); base-relative `top` is
  // `$refined{base, $all}`; the universal Anything is `complement(Void)`.
  // `bottom` = `$void` (already first-class — ISO-3).
  // Decided structurally by the containment trio (subset/disjoint/empty) via the
  // marshalled TtUnion/TtIntersect/TtComplement (marshalTraversalType) + the tsKind
  // dispatch; REUSING the open DecidableMembership deciders (no private theory list).
  | { $union: FenelType[] }
  | { $intersect: FenelType[] }
  | { $complement: FenelType }

  // --- μ: fixpoint for recursive types ---
  | { $mu: { var: string; body: FenelType } }

  // --- Phantom tag: value + erased type tag ---
  | { $tagged: { value: FenelType; phantom: FenelType } }

  // --- Nominal-newtype marker: a NAME + its pure-ADT definition ---
  // `{ name, pure }` is the NOMINAL IDENTITY of a newtype over its pure ADT:
  // `name` distinguishes a type from a STRUCTURALLY-IDENTICAL one (the load-
  // bearing case: `String` is `$opaque{name:"String", pure: List Char}` — strip
  // the wrapper and it is byte-identical to `List Char`; the name is the only
  // thing that separates them, and `isStringType` / `typeConstructorName` /
  // `peelList(String)=null` all depend on it). This is a LANGUAGE fact (it drives
  // IR string-const emit, dispatch, display), NOT a perf decoration.
  //
  // representation-substrate Phase 5a retired the decorative `repr: string`
  // field; the native runtime rep now lives in the per-`(target, type)`
  // `Reprable JsRuntime` instance (Bool/Nat/Int/Rational/List/String/Char all
  // shipped, Phases 1–4 — the precise per-type lift/lower, not a coarse string;
  // Nat & Int were BOTH "number"). Phase 5b-final KEPT the wrapper: Step-0 proved
  // full removal collapses `String` into `List Char` (R2 option (ii); see
  // `workstreams/representation-substrate/notes/phase-5b-step0-probe.md`). The
  // surface syntax `opaque "<repr>" Name` survives as a now-ignored annotation; a
  // `$opaque`→`$nominal` rename is deferred to its own phase (the name no longer
  // connotes a perf rep, but the rename is a cross-cutting + persisted-data sweep).
  | { $opaque: { name: string; pure?: FenelType } }

  // --- Arrow: function type (callable value of this signature) ---
  // The value of an `$arrow`-typed field is any callable:
  //   - a function-name string (referring to a registered FenelFunction)
  //   - a `fn` lambda closure
  //   - a partial application of either
  //
  // Identity (label / description / codeName) for named callables flows
  // through Labelable / Describable / Codeable typeclass dispatch keyed by
  // the function's id, the same way entity identity does — so `getLabel("add")`
  // works exactly like `getLabel("profile")`. The arrow type's `params` /
  // `returns` describe the structural signature; the runtime accepts any
  // callable shape that fits. To constrain a field to "must be a registered
  // name (no inline lambdas)", refine: `$refined: { base: $arrow{...}, set: <isRegisteredName> }`.
  //
  // Subtyping is contravariant in params, covariant in returns. Empty
  // params represents a thunk `() → T`. Partial application: invoking a
  // function with fewer args than `params.length` yields an arrow value
  // with the remaining params.
  //
  // signature-substrate Phase 1: the former `requires?: Constraint[]` slot is
  // RETIRED (`design/signatures-and-contracts.md` §6). Capability constraints
  // are the function SPEC's `requires` (contract judgment 2 — a property of
  // `(function, scope)`), never part of the arrow VALUE type; the arrow's set
  // denotation (`SeArrow`) never carried them either (SC-eff quantifies over
  // pure signatures). The retirement census found zero producers: the parser
  // cannot write it (no `=>` sugar, no `$`-keys from `.fenel`), no TS builder
  // set it, and the loader ignored it — which would be silent capability-
  // declaration LOSS on foreign data, so the normalize gateway
  // (`normalizeFenelTypeShorthand`) now strips a stale slot WITH a distinct
  // diagnostic instead.
  | { $arrow: { params: FieldDef[]; returns: FenelType } }

  // --- Universe of types ---
  // `$type` is the "type of types" — a value of type `$type` is itself a
  // FenelType. Lets fields, params, and stored configs hold types as
  // first-class data without resorting to fake `$named: "Type"` markers.
  | { $type: true }

  // --- El: the unified dependent-type substrate ---
  //
  // `$el { e }` uses an Expression `e` whose evaluated value (against the
  // current dependency context) must be a FenelType. This is the single
  // primitive for *every* dependent-type construct in Fenel. The four
  // mechanisms that used to overlap collapse here:
  //
  //   • Sibling-as-type:   { $el: { var: "type" } }
  //                        → use a sibling field's value as this field's type
  //   • Type-level call:   { $el: { call: ["Vec", { var: "n" }, T] } }
  //                        → invoke a Fenel function returning a Type
  //                          (replaces the legacy `$apply` AND the `$app`
  //                           constructor retired in Phase 1 of typeclass-
  //                           substrate-completion)
  //   • Guarded selection: { $el: { if: [cond, typeA, typeB] } }
  //                          or { $el: { match: [...] } }
  //                        → multi-branch type choice
  //                          (replaces the legacy `$depend { guards, default }`)
  //   • Type abstraction:  a Fenel function `(T : Type, n : Nat) -> Type`
  //                        is the type-level lambda
  //                          (replaces the legacy `$dep { params, body }`)
  //
  // The validator merges surrounding record values into the eval context
  // (`formData` threading does this), so siblings resolve naturally.
  //
  //   { $record: { fields: [
  //       { name: "type",  type: { $type: true } },
  //       { name: "value", type: { $el: { var: "type" } } },
  //   ]}}
  //
  // The full power of JSON Logic is available (var / call / if / fn /
  // match / let / …). See `design/structural-introspection.md` Instance 4
  // for the conceptual collapse and `design/implementation-roadmap.md`
  // Phase 1 for the migration history.
  | { $el: Expression };

// ---------------------------------------------------------------------------
// Rational — exact arithmetic (no IEEE 754 precision loss)
// ---------------------------------------------------------------------------

/**
 * Exact integer-string runtime representation of a rational num/den. Source
 * admission requires a positive denominator; arithmetic normalizes results.
 *
 * The number tower: ℕ ⊂ ℤ ⊂ ℚ
 *   ℕ = { r ∈ ℚ | r.den = 1 ∧ r.num ≥ 0 }
 *   ℤ = { r ∈ ℚ | r.den = 1 }
 *   ℚ = all Rationals
 */
export type NativeRational = {
  readonly $tag: "Rational";
  readonly num: string;
  readonly den: string;
};

/** Admitted runtime representations; numerical/resource bounds are checked by
 *  the source Membership instance, independently of this transport shape. */
export type NaturalRepresentation =
  | number
  | { readonly $tag: "Zero" }
  | { readonly $tag: "Succ"; readonly _0: NaturalRepresentation };

export type IntegerRepresentation =
  | number
  | { readonly $tag: "Int"; readonly magnitude: NaturalRepresentation;
      readonly negative: boolean | { readonly $tag: "True" | "False" } };

export type Rational = NativeRational | {
  readonly $tag: "Rational";
  readonly num: IntegerRepresentation;
  readonly den: NaturalRepresentation;
};

// ---------------------------------------------------------------------------
// Input channels — how raw input becomes typed data for a field
//
// A field can have MULTIPLE input channels, each with a different UX,
// all producing the same typed output.
//
// Channel kinds:
//   text   — text input with optional coercion/autocomplete (local or remote)
//   widget — interactive UI (map picker, calendar, color picker)
//   action — one-shot operation (get GPS location, import from contacts)
//   ai     — AI-powered interpretation (image → data, NLP → structured)
//
// Types declare default channels. Fields can override/extend.
// ---------------------------------------------------------------------------

/**
 * A single input channel — one way for data to enter a field.
 *
 * Every channel produces the same output type (determined by the field's schema).
 * The `kind` determines the UX pattern and what config is available.
 */
export type InputChannel =
  | TextChannel
  | WidgetChannel
  | ActionChannel
  | AiChannel;

/** Text input with optional processing (coercion, autocomplete) */
export type TextChannel = {
  kind: "text";
  id: string;
  name: string;
  icon?: string;
  /** Processing strategy ID (e.g. "normalize-phone", "autocomplete-address") */
  strategy?: string;
  /** When processing runs: "live" (each keystroke), "blur", "submit" */
  trigger?: "live" | "blur" | "submit";
  /** Min chars before triggering (for autocomplete) */
  minLength?: number;
  /** Debounce delay in ms (for remote strategies) */
  debounceMs?: number;
  /** Strategy-specific config */
  config?: Record<string, unknown>;
};

/** Interactive widget (map picker, calendar, file upload, etc.) */
export type WidgetChannel = {
  kind: "widget";
  id: string;
  name: string;
  icon?: string;
  /** Widget component identifier — resolved by the rendering platform */
  widget: string;
  /** Widget-specific config */
  config?: Record<string, unknown>;
};

/** One-shot action (GPS, import from contacts, clipboard parse) */
export type ActionChannel = {
  kind: "action";
  id: string;
  name: string;
  icon?: string;
  /** Action identifier — resolved by the platform */
  action: string;
  /** Action-specific config */
  config?: Record<string, unknown>;
};

/** AI-powered interpretation (image → data, voice → text, NLP → structured) */
export type AiChannel = {
  kind: "ai";
  id: string;
  name: string;
  icon?: string;
  /** What input the AI accepts */
  accepts: "text" | "image" | "audio" | "file";
  /** Optional prompt template for the AI */
  prompt?: string;
  /** API endpoint for processing */
  endpoint?: string;
  /** Config */
  config?: Record<string, unknown>;
};

/** Shorthand: channel ID string or full config (for single-channel fields) */
export type InputStrategy = string | InputChannel;

/** Registry entry defining a named input strategy (used by coerce functions) */
export type InputStrategyDef = {
  id: string;
  name: string;
  mode: "local" | "remote";
  /** Remote interaction pattern */
  interaction?: "autocomplete" | "enrich";
  /** Default trigger if not overridden per-field */
  defaultTrigger: "live" | "blur" | "submit";
  /** What structured type this produces (if different from raw input) */
  outputType?: string;
};

// ---------------------------------------------------------------------------
// File — typed descriptor, not opaque blob
//
// A file value is a record: { url, name, size, mimeType, hash }.
// Constraints are direct fields on FileSchema, not a wrapper.
// Storage is a typeclass (S3, R2, local) — Fenel never touches bytes.
// ---------------------------------------------------------------------------

export type BlobValue = {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  hash: string;
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
};

// ---------------------------------------------------------------------------
// List constraints (structural — uniqueBy is graph-level)
// ---------------------------------------------------------------------------

export type ListConstraints = {
  minItems?: number;
  maxItems?: number;
  uniqueBy?: string;
};

// ---------------------------------------------------------------------------
// UI option — for select/radio/checkbox rendering
// ---------------------------------------------------------------------------

/** A display option for select/radio/checkbox fields */
export type SelectOption = {
  value: unknown;
  label: LocaleString;
  image?: string;
};


/** A resolved option from a ref resolver */
export type RefOption = {
  value: string;
  label: LocaleString;
  /** Full entity data — available for rich rendering / template display */
  data?: Record<string, unknown>;
};

export type RefResolver = (
  entityType: string,
  context: Record<string, unknown>,
  filter?: Expression,
) => Promise<RefOption[]>;

// ---------------------------------------------------------------------------
// Re-export LocaleString from locale module — used throughout types below
// ---------------------------------------------------------------------------

export type { LocaleString, Locale, LocaleContext } from "./locale";
import type { LocaleString } from "./locale";
import { Maybe, refHandle } from "./type-foundation";

// ---------------------------------------------------------------------------
// The unit source module's self-contained values. Names and symbols belong to
// catalogue choices; a measure carries its actual definition.
// ---------------------------------------------------------------------------

export type DimensionVector = {
  $tag: "DimensionVector";
  length: Rational;
  mass: Rational;
  time: Rational;
  current: Rational;
  temperature: Rational;
  information: Rational;
  angle: Rational;
};

export type UnitCalibration =
  | { $tag: "Linear"; scale: Rational }
  | { $tag: "Affine"; scale: Rational; origin: Rational; offset: Rational }
  | { $tag: "ApproximateLinear"; scale: number };

export type UnitDefinition = {
  $tag: "UnitDefinition";
  dimension: DimensionVector;
  calibration: UnitCalibration;
};

export type UnitChoice = {
  $tag: "UnitChoice";
  code: string;
  label: string;
  symbol: string;
  unit: UnitDefinition;
};

export type UnitFamily = {
  $tag: "UnitFamily";
  name: string;
  label: string;
  description: string;
  choices: UnitChoice[];
};

export type MeasureExpr =
  | { $tag: "MeasureAtom"; unit: UnitDefinition }
  | { $tag: "MeasureProduct"; left: MeasureExpr; right: MeasureExpr }
  | { $tag: "MeasureQuotient"; left: MeasureExpr; right: MeasureExpr }
  | { $tag: "MeasurePower"; base: MeasureExpr; exponent: Rational }
  | { $tag: "MeasureOne" };

// ---------------------------------------------------------------------------
// Scope — multi-tenancy + system catalog wrapper
//
// Every registered Fenel row (Typeclass, TypeclassInstance, FenelFunction,
// TypeView, EntitySpec, FormDefinition, FenelModule registrations …) lives
// in a Scope. A row with no `accountId` is system / std — visible to all
// accounts. A row with an `accountId` is private to that account.
//
// Storage rule: every persisted row table has an optional `account_id`
// column. Queries that load "everything visible to account X" union the
// system rows (account_id IS NULL) with the account's own rows.
//
// This is orthogonal to TypeclassInstance.scope (the "global" vs "account"
// dispatch category) — that field describes whether an instance is allowed
// to overlap per-account, while Scope describes ownership of the row.
// ---------------------------------------------------------------------------

/**
 * Ownership wrapper for any registered Fenel row.
 *
 * `accountId` absent  → system / std row, visible platform-wide.
 * `accountId` present → row owned by that account.
 */
export type Scope = {
  /** Account-owned row vs. system row. Canonical-maybe Phase 7d
   *  (2026-05-27): lifted from `?:` to `Maybe<string>`. Nothing = system
   *  / std row visible platform-wide; Just(uuid) = account-owned. */
  accountId: Maybe<string>;
};

// ---------------------------------------------------------------------------
// TypeView — unified presentation layer
//
// Separates HOW data is displayed from WHAT the data is (FenelType).
// One concept, three facets:
//   display  → primitives: read/edit formatting
//   layout   → composites: sections, rows, columns, responsive
//   listDisplay → lists: stack/table/chips, item template
//
// Templates are reusable, named, and resolved via conditional rules.
// Custom components provide an escape hatch when declarative config
// isn't enough — each channel registers its own implementations.
// ---------------------------------------------------------------------------

/** Read-mode display config — how a value looks when not editing */
export type ReadDisplay = {
  /** Format hint — "badge"/"chip"/"link"/"date-short"/"relative-time"/etc.
   *  Canonical-maybe Phase 6.5 (2026-05-27): lifted from `?:` to
   *  `Maybe<string>`. Paired with EditDisplay.format. */
  format: Maybe<string>;
  /** Transform hint — "phone-format" / "uppercase" / etc.
   *  Canonical-maybe Phase 6.5: lifted from `?:` to `Maybe<string>`. */
  transform: Maybe<string>;
  /** Per-value color overlay map. Canonical-maybe Phase 6.5:
   *  lifted from `?:` to `Maybe<Record<string, string>>`. */
  colorMap: Maybe<Record<string, string>>;
  /** Per-value display-label override map. Canonical-maybe Phase
   *  6.5: lifted from `?:` to `Maybe<Record<string, string>>`. */
  labelMap: Maybe<Record<string, string>>;
  /** Icon name for display. Canonical-maybe Phase 6.5: lifted
   *  from `?:` to `Maybe<string>`. */
  icon: Maybe<string>;
  /** Text shown when the value is empty/null. Canonical-maybe
   *  Phase 6.5: lifted from `?:` to `Maybe<LocaleString>`. */
  emptyText: Maybe<LocaleString>;
  /** Visual prefix (e.g. "$"). Canonical-maybe Phase 6.5: lifted
   *  from `?:` to `Maybe<LocaleString>`. Paired with EditDisplay.prefix. */
  prefix: Maybe<LocaleString>;
  /** Visual suffix (e.g. "USD"). Canonical-maybe Phase 6.5: lifted
   *  from `?:` to `Maybe<LocaleString>`. Paired with EditDisplay.suffix. */
  suffix: Maybe<LocaleString>;
  /**
   * TypeView name for inline ref display.
   * When a ref field is rendered in read mode, this template controls
   * how the referenced entity appears. Cascade:
   *   1. This refTemplate (explicit override)
   *   2. Referenced entity's defaultTemplateInline
   *   3. Referenced entity's defaultTemplate
   *   4. Inferred display field (first "name"/"label"/"title" or first string field)
   *   5. Raw ID
   *  Canonical-maybe Phase 6.5: lifted from `?:` to `Maybe<string>`.
   */
  refTemplate: Maybe<string>;
};

/** Edit-mode display config — controls the editor widget.
 *  Used both inline as `FormField.ui` and inside a TypeView's
 *  `display.edit`. */
export type EditDisplay = {
  /** Widget identifier — picked up by the rendering platform's component registry.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<string>`. */
  widget: Maybe<string>;
  /** Placeholder shown in empty input.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<LocaleString>`. */
  placeholder: Maybe<LocaleString>;
  /** Help text shown alongside the input.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<LocaleString>`. */
  helpText: Maybe<LocaleString>;
  /** Visual prefix in the input row (e.g. currency symbol).
   *  Canonical-maybe Phase 6.5 (2026-05-27): lifted from `?:` to
   *  `Maybe<LocaleString>`. Paired with ReadDisplay.prefix. */
  prefix: Maybe<LocaleString>;
  /** Visual suffix in the input row (e.g. unit).
   *  Canonical-maybe Phase 6.5: lifted from `?:` to `Maybe<LocaleString>`.
   *  Paired with ReadDisplay.suffix. */
  suffix: Maybe<LocaleString>;
  /** For enum-like inputs: the option list with display labels.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<SelectOption[]>`.
   *  Note: `Nothing` = "no options declared"; `Just([])` = "options explicitly empty". */
  options: Maybe<SelectOption[]>;
  /** Input format hint — e.g. "datetime" for datetime-local, "time" for time input.
   *  Canonical-maybe Phase 6.5 (2026-05-27): lifted from `?:` to
   *  `Maybe<string>`. Paired with ReadDisplay.format. */
  format: Maybe<string>;
  /** Grid columns this field spans in a layout.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<number>`. */
  columns: Maybe<number>;
  /** Picker filter — JSON-Logic Expression evaluated against
   *  `{_self, candidate}` to narrow the entity picker's candidate
   *  set. Phase 5b of field-meta-collapse (migration `0051`,
   *  2026-05-26) relocated this from `FieldMetadata.refFilter` —
   *  it's a per-field UX hint, not a type-level constraint. Phase
   *  5b.2 (2026-05-26) landed the per-typeclass
   *  `Filterable<X>.defaultFilter` instance underneath: this slot
   *  is now a **per-field override** that wins on collision, and
   *  the default is sourced from the typeclass instance keyed on
   *  the candidate entity's name. See `field-meta.ts:defaultFilterFor`
   *  + `builtin-classes.ts:filterableClass`.
   *  Canonical-maybe Phase 6 (2026-05-26): lifted from `?:` to `Maybe<Expression>`. */
  refFilter: Maybe<Expression>;
};

/** A slot places a field in the layout grid */
export type FieldSlot = {
  field: string;
  span?: number;
  template?: string;
  when?: Expression;
};

/** A row arranges slots horizontally */
export type LayoutRow = {
  slots: FieldSlot[];
  gap?: string;
  when?: Expression;
};

/** A section groups rows under an optional heading */
export type LayoutSection = {
  title?: LocaleString;
  description?: LocaleString;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  when?: Expression;
  rows: LayoutRow[];
};

/** Responsive override — different layout at different widths */
export type ResponsiveOverride = {
  maxWidth: number;
  sections: LayoutSection[];
};

/** Layout definition for composite types */
export type LayoutDef = {
  sections: LayoutSection[];
  responsive?: ResponsiveOverride[];
};

// ---------------------------------------------------------------------------
// Slide mode — present forms as navigable slides instead of scrollable pages
// ---------------------------------------------------------------------------

/** How a form is presented */
export type FormMode = "scroll" | "slide";

/**
 * A single slide in slide mode.
 * Each slide can contain one field, a section, or a group of fields.
 * When a field is a complex record type, its sub-fields can be further
 * sliced into sub-slides (recursive depth).
 */
export type SlideDef = {
  /** Optional title for this slide */
  title?: LocaleString;
  /** Field paths to render on this slide (e.g. ["name", "email"] or ["address"]) */
  fields: string[];
  /** If this slide drills into a complex field, which field path is the parent */
  parent?: string;
};

/**
 * Slide layout configuration for a form or entity template.
 * When mode is "slide", sections from LayoutDef are ignored in favor of slides.
 * Auto-generation: if slides is omitted, each section becomes one slide,
 * and each complex (record) field gets its own depth level.
 */
export type SlideConfig = {
  mode: FormMode;
  /** Explicit slide definitions. If omitted, auto-generated from layout sections. */
  slides?: SlideDef[];
  /** Show progress indicator: "dots" | "bar" | "fraction" | "none" */
  progress?: "dots" | "bar" | "fraction" | "none";
  /** Transition style */
  transition?: "slide-h" | "slide-v" | "fade" | "none";
};

/** Column definition for list table display */
export type ListColumn = {
  field: string;
  label?: LocaleString;
  span?: number;
  template?: string;
  /** Allow inline editing of this cell. The renderer uses the value's
   *  type to pick a default editor (Boolean → clickable badge, …) and
   *  calls back to the table's `onCellEdit` to persist. */
  editable?: boolean;
};

/** List display config */
export type ListDisplayConfig = {
  style: "stack" | "table" | "chips" | "inline" | "cards";
  itemTemplate?: string;
  columns?: ListColumn[];
  addLabel?: LocaleString;
  emptyText?: LocaleString;
};

/** Conditional template selection rule */
export type TemplateRule = {
  when: Expression;
  template: string;
};

/**
 * TypeView — the unified presentation concept.
 *
 * Templates target a specific FenelType (concrete via `$named`, inline,
 * or polymorphic via `$var` with a typeclass constraint). Different
 * facets activate based on the target type's shape:
 *   - Primitives use `display`
 *   - Records use `layout`
 *   - Lists use `listDisplay`
 *
 * "Edit display" mode is what was historically called "form" — there's
 * no separate "form" concept; a form is a TypeView with non-trivial
 * `display.edit` / `layout`. Templates form their own registry, keyed
 * by name, and can reference each other via `extends`.
 *
 * Custom components provide an escape hatch for each facet:
 *   - `component` → full override
 *   - `readComponent` → override just read display
 *   - `editComponent` → override just edit widget
 */
export type TypeView = {
  /** Template registry name. */
  name: string;
  description?: LocaleString;
  extends?: string;

  /**
   * The type this template is built for. Polymorphic templates use
   * `{ $var: "a" }` (typically with a typeclass constraint expressed
   * outside the template). Omit `targetType` to mean "any type."
   */
  targetType?: FenelType;

  // ---- Declarative: primitives ----
  /** Read+edit-mode declarative display. Canonical-maybe Phase 7d
   *  (2026-05-27+): outer slot lifted from `?:` to `Maybe<{...}>`;
   *  inner `read` and `edit` slots lifted from `?:` to
   *  `Maybe<ReadDisplay>` / `Maybe<EditDisplay>`. After Phase 7d both
   *  outer and inner are canonical Maybe — display arc 100% closed. */
  display: Maybe<{
    read: Maybe<ReadDisplay>;
    edit: Maybe<EditDisplay>;
  }>;

  // ---- Declarative: composite layout ----
  layout?: LayoutDef;

  // ---- Declarative: list display ----
  listDisplay?: ListDisplayConfig;

  // ---- Component escape hatch (registered per channel) ----
  component?: string;
  readComponent?: string;
  editComponent?: string;
};

// ---------------------------------------------------------------------------
// Form definition — the top-level form structure
// ---------------------------------------------------------------------------

export type OnSubmitAction =
  /** Canonical-maybe Phase 7d (2026-05-27): `stepSlug` lifted from
   *  `?:` to `Maybe<string>`. Variant payload field. */
  | { $tag: "CreatePaymentLink"; planSlug: string; stepSlug: Maybe<string> }
  | { $tag: "ShowPage"; page: string }
  | { $tag: "Redirect"; url: string }
  | { $tag: "SetValue"; target: string; value: string };

export type OnSubmitRule = {
  if: Maybe<Expression>;
  then: OnSubmitAction;
};

export type FormTrigger = {
  when: Expression;
  action: "set_value";
  target: string;
  value: unknown | { $expr: Expression };
};

export type FormScope = "account" | "entity";
export type FormEntityType = string; // extensible: "profile", "item", "plan", "flow_step", "order", ...

export type FormDefinition = {
  slug: string;
  /** Canonical FenelType ($record) describing the form's input fields.
   *  Reads in code that operate on a raw DB row (which may still carry a
   *  legacy `fields: FormField[]`) should go through
   *  `formDefinitionFields(def)`. */
  type: FenelType;
  $defs?: Record<string, FenelType>;
  config?: {
    submitLabel?: LocaleString;
    capturesProfile?: boolean;
    [key: string]: unknown;
  };
  /** Top-level layout template for this form */
  template?: string;
  scope?: FormScope;
  scopeEntityType?: FormEntityType;
  scopeEntityId?: string;
};

// ---------------------------------------------------------------------------
// Registry specs — data-only definitions for actions, events, entities
//
// These are the "shape" — modules provide the implementation (handlers).
// The frontend uses specs to render parameter editors and event pickers.
// ---------------------------------------------------------------------------

// EntitySpec / EntityRelation removed in 9b-L. The wrapper has fully
// collapsed — every facet now lives in its own home:
//   - structural type     → FenelType, registered via systemEntities (just
//                            { name, type } pairs) and the entity_definitions
//                            DB table for user-defined types
//   - identity            → Labelable / Describable / Iconable typeclass
//                            instances, accessed via getLabel / getDescription /
//                            getIcon (./identifiable.ts)
//   - default views       → Viewable typeclass instances, accessed via
//                            getDefaultView / getDefaultInlineView
//   - static reference data → `.fenel` value-decls (reference-data.ts), read
//                            through the universal by-type register query
//                            (`dispatchRegistry.listInstances`); the frontend's
//                            `~/lib/reference-data` adapter resolves codeName→
//                            type-name via `referenceTypeByCodeName`
//   - 1:N relations       → setRelations / getRelations (./relations-registry.ts)

// ---------------------------------------------------------------------------
// Field providers — virtual fields with external data sources
//
// Entity schemas are pure — they describe WHAT the data is, not WHERE it
// comes from. Field providers supply data for fields that are too large,
// too dynamic, or too per-entity to bake into staticData or the DB.
//
// The binding connects a provider to a specific entity.field. The runtime
// resolves fields by checking: staticData → DB → provider bindings.
//
// Examples:
//   country.geometry  → geo-boundaries provider (GeoJSON polygons, ~50MB)
//   currency.rate     → exchange-rates provider (changes daily)
//   city.population   → demographics provider (changes yearly)
// ---------------------------------------------------------------------------

/**
 * A field provider — knows how to fetch data for virtual fields.
 *
 * Providers are infrastructure, not type information. Registration is scoped
 * explicitly; no provider API has an implicit process-global account scope.
 */
export type FieldProvider = {
  /** Unique provider name (e.g. "geo-boundaries", "exchange-rates") */
  name: string;
  /** Fetch a single field value by entity key */
  get: (key: string, context?: Record<string, unknown>) => Promise<unknown>;
  /** Batch fetch — returns { [key]: value } map. Optional but recommended. */
  getBatch?: (keys: string[], context?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** Structural provider scope. `registryId` identifies one immutable registry
 * view/snapshot; account scopes additionally name the owning account. */
export type ProviderScope =
  | {
      readonly $tag: "RepositoryProviderScope";
      readonly registryId: string;
    }
  | {
      readonly $tag: "AccountProviderScope";
      readonly accountId: string;
      readonly registryId: string;
    };

/** One occurrence-specific provider target. Field identity is always the
 * UUID-backed FieldRef; owner and scope select the occurrence/registry only. */
export type ProviderFieldTarget = {
  readonly scope: ProviderScope;
  readonly owner: string;
  readonly field: FieldRef;
};

/**
 * A field binding — connects a provider to a specific entity.field.
 *
 * Bindings are external to the schema. The same entity can have different
 * bindings in different environments (staging uses mock geometry, prod uses Mapbox).
 */
export type FieldBinding = {
  /** Structural occurrence target; never an `entity.field` string. */
  target: ProviderFieldTarget;
  /** Provider name (must be registered in the same scope). */
  provider: string;
  /** Stable identity of the entity field used as the provider lookup key. */
  keyField: FieldRef;
};

/** Constraint-provider sibling of FieldProvider. The semantic request carries
 * a structural target; readable codenames are not passed to providers. */
export type ConstraintProvider = {
  name: string;
  description?: string;
  resolve(
    target: ProviderFieldTarget,
    context?: Record<string, unknown>,
  ): Promise<SetExpr | undefined>;
};

export type ConstraintBinding = {
  target: ProviderFieldTarget;
  provider: string;
};

export type ConstraintResolution = {
  target: ProviderFieldTarget;
  constraint: SetExpr;
};

export type ProviderRegistrationResult<T> =
  | { $tag: "ProviderRegistered"; value: T }
  | { $tag: "ProviderDuplicate"; value: T }
  | { $tag: "ProviderConflict"; message: string }
  | { $tag: "ProviderInvalid"; message: string };

export type ProviderLookupResult<T> =
  | { $tag: "ProviderFound"; value: T }
  | { $tag: "ProviderMissing"; message: string }
  | { $tag: "ProviderAmbiguous"; message: string };

// ---------------------------------------------------------------------------
// Display-field inference — replaces the old refLabel concept
//
// When no defaultTemplateInline is set, infer the best field to use as a
// display label from the entity schema. Priority:
//   1. Field named "name"
//   2. Field named "label"
//   3. Field named "title"
//   4. First unconstrained string field (no set/enum restriction)
//   5. First string field
//   6. First field
// ---------------------------------------------------------------------------

export function inferDisplayField(fields: FieldDef[]): string {
  const wellKnown = ["name", "label", "title"];
  for (const k of wellKnown) {
    if (fields.some((f) => f.name === k)) return k;
  }
  // 7g-retire-2c fold: a String field may be declared `{$named:"String"}` OR its
  // `{$ref:"String"}` twin — compare the name-handle, not the literal form.
  const isPlainString = (f: FieldDef) => refHandle(f.type) === "String";
  const unconstrainedString = fields.find(isPlainString);
  if (unconstrainedString) return unconstrainedString.name;
  // Any string-shaped (refined or otherwise)
  const anyString = fields.find((f) => {
    if (refHandle(f.type) === "String") return true;
    if ("$refined" in f.type && refHandle(f.type.$refined.base) === "String") return true;
    return false;
  });
  if (anyString) return anyString.name;
  return fields[0]?.name ?? "id";
}

// ---------------------------------------------------------------------------
// Typeclasses — bounded polymorphism for the FenelType system
//
// Improvements over Haskell's typeclasses:
//   1. First-class — classes, instances, and kinds are runtime data
//   2. Scoped instances — instances can be global or per-account
//   3. Explicit priority — no fragile overlap heuristics
//   4. Laws as data — machine-checkable, not just comments
//   5. Runtime introspection — "what does this type implement?"
//   6. No orphan problem — instances live in a registry with explicit control
// ---------------------------------------------------------------------------

// unified-static-analysis Phase 5b — the structural `Kind` ADT
// (`"Type" | "Constraint" | {from, to}`) is RETIRED, SUBSUMED by the
// kinds-as-predicate-bounds substrate. A kind is now a predicate FUNCTION
// (`engine:isUnaryConstructor : Type -> Bool`, `fenel/modules/engine/kinds.fenel`)
// checked at a class application via `effect-dispatch.ts:checkKindBound` — not a
// `Kind` VALUE stored on a slot. The ADT was a dead placeholder: only the unused
// `kind?: Kind` fields on `TypeParam` / `TypeConstructorParam` referenced it (no
// code populated or read them), so it is removed, not narrowed. "Subsumption is
// the direction of travel": a more general construct (the predicate substrate)
// absorbed the specialized one. ([[feedback_dont_drop_unused_features]]: retired
// because SUPERSEDED — a kind is now expressible as a predicate — not merely unused.)

/**
 * A type expression in FenelType's type language.
 *
 *   "Profile"                                            → concrete type
 *   { $var: "a" }                                        → type variable
 *   { $el: { call: ["Group", "Profile"] } }              → applied constructor
 *
 * Phase 1 of typeclass-substrate-completion: the `$app` shape (string-headed
 * generic application) is retired. Type-level applications uniformly use
 * the `$el { call: [...] }` substrate — the same primitive the parser
 * emits for deferred type apps in FenelType.
 */
export type TypeExpr =
  | string
  | { $var: string }
  | { $el: { call: [string, ...TypeExpr[]] } };

/** A constraint: "type must implement this typeclass".
 *
 *  Phase 10a-5c — `class` migrated from raw string class name to typed
 *  `Id<Type>` reference. The `entityId` field carries the spec record
 *  entity codename (e.g. `"RenderableSpec"`); back-compat with the
 *  legacy string form is preserved via `resolveConstraintClass`'s
 *  spec-codename-aware lookup. The bulk migration flipped ~150
 *  declaration sites in this sub-phase. `args` keeps `TypeExpr[]` for
 *  this sub-phase — the `FenelType` tightening lands in 10a-5d when
 *  the `Typeclass` ADT also deletes. */
export type Constraint = {
  class: { readonly $tag: "Id"; readonly entityId: string };
  args: TypeExpr[];
};

/** A type parameter in a typeclass or constructor definition */
export type TypeParam = {
  name: string;
};

/**
 * A `forall` quantifier entry on a spec-record law.
 *
 *   - **Bare string** — a type variable name (e.g. `"a"`). Phase 9.1
 *     behaviour: the law-validator marks the law uncheckable if its
 *     property references the var. Backward-compatible with all existing
 *     law declarations.
 *   - **`{ name, type }`** — a value-level variable bound to samples of
 *     a type. The validator iterates `Exemplifiable<type>` samples (or
 *     inline `samples`) and evaluates the property once per sample.
 *     `type` may be:
 *       - a spec-record-param name (e.g. `"a"` for `Iso s a`'s `a` slot —
 *         resolved per-instance to `inst.args[idx]`)
 *       - a concrete type-name string (e.g. `"String"`)
 *   - **`{ name, samples }`** — value-level variable with inline samples
 *     (skips the Exemplifiable lookup). Useful when the test wants
 *     deterministic / hand-picked inputs, or when no Exemplifiable
 *     instance exists for the type yet.
 *
 * See `design/laws-and-proofs.md` Stage 9.2 for the full design.
 */
export type ForallEntry =
  | string
  | { name: string; type: string }
  | { name: string; samples: unknown[] };

/**
 * Scope-bucket for spec instances. Determines visibility to the
 * dispatch resolver.
 *
 * - **Global**: visible everywhere
 * - **Tag**: visible when the runtime context's tag-set contains
 *   the instance's tag. Used for per-account, per-tenant,
 *   per-environment, per-experiment overlays.
 *
 * Block-scope (lexical / dynamic extent) is NOT modelled here — those
 * instances live on `EvaluateContext._dictStack` and disappear when
 * the block exits.
 *
 * The legacy string form (`"global"` / `"account"`) is kept as an alias
 * to ease migration: persisted rows from before the ADT landing still
 * resolve. New code should write the ADT form.
 *
 * ⚠ rights R3a — the bare `"account"` string is a DEAD spelling. It was never
 * an ownership coordinate: it named ONE shared bucket with no id, which
 * `removeInstancesByScope("account")` wiped for every account at once. No write
 * path produces it after R3a, the dispatch-instance loader refuses it, and
 * after the flip it is INVISIBLE — even under an active `account` tag. It stays
 * in the union only so an un-swept persisted row still has a legal type.
 */
export type InstanceScope =
  | "global"
  | "account"
  | { kind: "global" }
  | { kind: "tag"; tag: string }
  /** rights R3a — THE OWNERSHIP COORDINATE. An instance written from a frame
   *  whose authenticated authority names an account is OWNED by that account:
   *  it is selected only under a frame that derives the SAME account, and only
   *  that account's frame may delete it.
   *
   *  It is DERIVED, never authored (Ruling 3): the write paths compute it from
   *  `authenticateAuthority(ctx._authority).accountId` and ignore any `scope`
   *  the caller argues. A frame with no account — the registry bootstrap, the
   *  engine harness, the kernel frame — may not write one at all; global and
   *  tag instances are boot-DECLARED.
   *
   *  `accountId` must be a non-empty string. Anything else is an unrecognised
   *  shape, and after the flip an unrecognised shape is INVISIBLE. */
  | { kind: "account"; accountId: string };

/** A parameter in a type constructor definition */
export type TypeConstructorParam = {
  name: string;
  constraints: Constraint[];
};

/**
 * A type constructor — a parameterized type definition.
 *
 * Example:
 *   Maybe :: Type -> Type
 *
 * (FM-retire-E1 Step 4 deleted the imperative `instantiate` callback + its
 * `ResolvedArgs` arg — `Group`, its sole user, was removed. The surviving
 * shape is purely declarative: `id` + `params` + an optional `description`.)
 */
export type TypeConstructor = {
  /** Canonical machine identifier (today: codeName string like "Maybe";
   *  future: UUID). Human-readable identity (label/codeName/description/
   *  icon) lives in the typeclass registry — read via getLabel(id) /
   *  getCodeName(id) / etc. */
  id: string;
  description?: LocaleString;
  params: TypeConstructorParam[];
};

// ---------------------------------------------------------------------------
// Functions — first-class callable values
// ---------------------------------------------------------------------------

/**
 * Function body — a JSON Logic expression OR a primitive literal that IS
 * the function's implementation. Primitives (string / number / boolean /
 * null) self-evaluate via JSON Logic — useful for constant-returning
 * methods like `default = 0` on a typeclass HasDefault Number instance.
 */
export type FunctionBody = Expression | string | number | boolean | null | unknown[];

/**
 * Describes a callable function in the Fenel expression system.
 * Functions are first-class values: typed, browsable, composable.
 *
 * Built-in std functions use the same FenelFunction as user-defined functions.
 * The only difference: built-in functions MAY have a native JS implementation
 * for performance; user-defined functions are always evaluated via JSON Logic.
 *
 * A function body can be:
 * - JSON Logic expression (body) — inspectable, serializable, evaluatable
 * - Prompt template (prompt) — natural language, executed via LLM
 * - Native-only (neither body nor prompt) — JS implementation only
 *
 * Lisp-style calling: {"call": ["add", 1, 2]}
 * Pipe composition:  {"pipe": [value, "trim", "upper"]}
 */
/**
 * Describes a callable function in the Fenel expression system.
 *
 * The function value carries ONLY the spec — `id`, `params`, `returns`,
 * and an optional `body`. Identity (codeName, label, description, category,
 * icon, tags, aliases) is representation, not function state, and lives
 * in typeclass instances keyed by the function's id (Codeable / Labelable
 * / Describable / Iconable / Categorizable / Taggable / Aliasable).
 *
 * Functions are referenced from Expressions via codeName:
 *   { "call": ["add", 1, 2] }
 * The runtime resolves the codeName through the Codeable typeclass to
 * find the function id, then fetches this spec from the registry.
 *
 * Native JS implementations (when present) live in `FenelModule.nativeImpls`
 * keyed by id (`<module>:<name>`).
 */
export type FenelFunction = {
  /** Canonical immutable identity. Stable across versions / rebuilds.
   *  Today a code-name slug (`module:name`); the registry key + the natives
   *  key. The opaque UUID identity (typed-function-references Phase 6) is held
   *  registry-LOCAL — deliberately NOT a field on this shared spec object, so a
   *  lock-bearing build can't leak a UUID into a later lock-less registry built
   *  over the same module's specs (that mismatch — UUID emitted, no UUID key —
   *  was the Phase-6 interference). Resolve the UUID via the lockfile +
   *  `createRegistry`'s `uuidBySlug` / `ModuleRegistry.getUuid`. */
  id: string;
  /** Typed parameter list (positional). */
  params: FieldDef[];
  /** Return type. */
  returns: FenelType;
  /**
   * Function body as a JSON Logic expression. When omitted, the function
   * is either a native (look up `nativeImpls[id]`) or an IO primitive
   * (the runtime registers an IO handler for it).
   */
  body?: FunctionBody;
  /**
   * Typeclass constraints this function's execution needs. Each entry is
   * the ERASABLE STATIC OBLIGATION "∃ an instance of `class` for `args`
   * resolvable in scope" (Cornerstone 1) — and it is NEVER read on the
   * runtime dispatch path: ordinary calls bind raw args and evaluate;
   * effect dispatch resolves the instance by reflection on the dispatch
   * argument's runtime type (block → tag → global); no method dictionary
   * is ever threaded to the body. What DOES read it — the field is
   * load-bearing static classification metadata, not inert: the post-load
   * transitive effect-inference pass (registry), the `audit-effects` gate
   * (undeclared-requires), and the self-host / partial-evaluation
   * placement classifiers. "Erasable" means erased from the value's type
   * and from dispatch — not unused. The resolved D8 facts:
   * `design/signatures-and-contracts.md` §8; the dispatch model:
   * `design/unified-dispatch.md` + `design/effect-system.md`.
   *
   * Replaces the legacy `ioAction` string tag — which was a coarse
   * single-string identifier with no structure. Effects + capabilities
   * + DI all declare through this one field.
   *
   * Pure functions omit this field entirely. The `$arrow` TYPE constructor
   * carries no `requires` (retired, signature-substrate P1): capability
   * obligations are contract judgment 2, never part of the arrow value type.
   */
  requires?: Constraint[];
  /** Saved authoring ingress, projected into the existing module declaration
   * sidecar when this ordinary function definition is loaded. Absent slots
   * request inference; effective Inferred evidence is never saved here. */
  signatureDeclaration?: FunctionSignatureDeclaration;
};

// ---------------------------------------------------------------------------
// Function signature schemes and registry-local declaration evidence
// ---------------------------------------------------------------------------

/** Kind of a declaration-scoped scheme variable. Quantified schemes live
 * above the ground FenelType/set algebra; KArrow is used for constructor
 * variables such as `f` in `f a`. */
export type Kind =
  | { readonly $tag: "KType" }
  | {
      readonly $tag: "KArrow";
      readonly input: Kind;
      readonly output: Kind;
    };

/** One rigid, declaration-scoped variable quantified by a TypeScheme. */
export type SchemeVar = {
  readonly id: string;
  readonly sourceName: string;
  readonly kind: Kind;
};

/** Authoritative scheme-level application identity/kind information. The
 * compatibility FenelType body may spell the same source application as
 * `$el`; `path` selects it and `args` is a body-derived redundant projection
 * kept for transport/debug readability. Consumers that need kind/scheme
 * semantics must use the sidecar head identity and kind. */
type SchemeApplicationBase = {
  readonly path: readonly string[];
  readonly args: readonly FenelType[];
  readonly kind: Kind;
};

export type SchemeApplication = SchemeApplicationBase & (
  | { readonly headVarId: string; readonly headRef?: never }
  | { readonly headRef: string; readonly headVarId?: never }
);

/** Stable nominal identity retained alongside the compatibility/display
 * spelling stored in a FenelType `$ref`. `path` selects the named/application
 * node in `TypeScheme.body`; inference equality uses `identity`, while public
 * authoring surfaces continue to render `publicName`. */
export type SchemeNominal = {
  readonly path: readonly string[];
  readonly identity: string;
  readonly publicName: string;
};

/** Stable parser/binding diagnostic retained with a source scheme. */
export type SchemeDiagnostic = {
  readonly code: string;
  readonly declaration: string;
  readonly path: readonly string[];
  readonly spelling: string;
  readonly message: string;
};

/** A prenex rank-1 scheme. `body` is the compatibility FenelType projection;
 * quantified identity and higher-kinded applications are authoritative here. */
export type TypeScheme = {
  readonly quantified: readonly SchemeVar[];
  readonly body: FenelType;
  readonly applications?: readonly SchemeApplication[];
  readonly nominals?: readonly SchemeNominal[];
  readonly diagnostics?: readonly SchemeDiagnostic[];
};

/** Where an authored slot obtained its declaration authority. */
export type SignatureDeclarationSource =
  | {
      readonly $tag: "SourceTypeSig";
      readonly module: string;
      readonly declaration: string;
    }
  | {
      readonly $tag: "HostSpec";
      readonly module: string;
    };

/** Loader/input provenance. Absent is deliberately a fact requesting
 * inference, not a FenelType and not a fabricated shared generic. */
export type SlotDeclaration =
  | {
      readonly $tag: "Authored";
      readonly source: SignatureDeclarationSource;
    }
  | {
      readonly $tag: "Inferred";
      readonly engine: string;
      readonly version: string;
      readonly derivation: unknown;
    }
  | { readonly $tag: "Absent" };

export type InferenceDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly functionId: string;
  readonly slot?:
    | { readonly $tag: "Param"; readonly index: number; readonly name: string }
    | { readonly $tag: "Return" };
  readonly path?: readonly string[];
};

/** Result of the Fenel-owned inference boundary. Solver metavariables are not
 * representable in this transport result. */
export type InferenceOutcome =
  | {
      readonly $tag: "Solved";
      readonly plan?: unknown;
      readonly derivation?: unknown;
      readonly diagnostics?: readonly InferenceDiagnostic[];
    }
  | {
      readonly $tag: "AnnotationRequired";
      readonly diagnostics: readonly InferenceDiagnostic[];
    }
  | {
      readonly $tag: "Invalid";
      readonly diagnostics: readonly InferenceDiagnostic[];
    };

/** Trust is independent from whether a useful scheme was inferred. */
export type SignatureTrust =
  | { readonly $tag: "Advisory"; readonly reason?: string }
  | { readonly $tag: "InferredDerivation"; readonly evidence: unknown }
  | { readonly $tag: "TrustedPrimitive"; readonly evidence: unknown };

/** Which implementation the runtime will actually select for a registration. */
export type ImplementationOrigin =
  | { readonly $tag: "FenelBody" }
  | {
      readonly $tag: "HostNative";
      readonly map: "nativeImpls" | "nativeImplsCtx" | "both";
    }
  | {
      readonly $tag: "NativeWithFallback";
      readonly map: "nativeImpls" | "nativeImplsCtx" | "both";
    }
  | { readonly $tag: "ExternalHandler" };

/** Source/host declaration input captured before inference. This may contain
 * Absent slots; it is never itself a public effective signature. */
export type FunctionSignatureDeclaration = {
  readonly functionId: string;
  readonly declarationName: string;
  readonly codeName: string;
  readonly scheme?: TypeScheme;
  readonly params: readonly SlotDeclaration[];
  readonly returns: SlotDeclaration;
};

export type EffectiveSlotDeclaration = Exclude<
  SlotDeclaration,
  { readonly $tag: "Absent" }
>;

/** Public registry-local signature evidence. Every slot is resolved here. */
export type FunctionSignatureInfo = {
  readonly functionId: string;
  readonly scheme: TypeScheme;
  readonly params: readonly EffectiveSlotDeclaration[];
  readonly returns: EffectiveSlotDeclaration;
  readonly outcome: InferenceOutcome;
  readonly trust: SignatureTrust;
  readonly implementationOrigin: ImplementationOrigin;
};

/** Retained source-only field control directive. Dotted selectors are resolved
 * by the Fenel field-representation kernel after field identity collection;
 * they are never runtime representation targets. */
export type FieldFacetSourceDirective = {
  readonly owner:
    | { readonly module: string; readonly entityId: string }
    | { readonly functionId: string };
  readonly selector: string;
  readonly source:
    | { readonly kind: "label"; readonly label: LocaleString }
    | { readonly kind: "widget"; readonly widget: string }
    | { readonly kind: "helpText"; readonly helpText: string }
    | { readonly kind: "repositoryReuse" };
  readonly provenance: {
    readonly module: string;
    readonly declaration: string;
    readonly selector: string;
  };
};

/** Storybook entries are values *about* a function — they live in a
 *  `Storyboardable` typeclass instance keyed by `fn.id`, NOT inside the
 *  pure function spec. Read via `getStoryboard(fn.id)`. */

/** A single storybook entry for a function — positional args, plus an
 *  optional pre-computed output. When `output` is absent the storybook
 *  may evaluate it live for pure functions with a registered native
 *  impl. The `description` is a short caption for the row. */
export type FunctionExample = {
  args: unknown[];
  output?: unknown;
  description?: string;
};

// ---------------------------------------------------------------------------
// Module — domain-specific registrations
// ---------------------------------------------------------------------------

/**
 * A module registers domain-specific entities and functions.
 * The engine is universal; modules make it specific.
 */
export type FenelModule = {
  name: string;
  label: LocaleString;
  /** Exact namespace that owns this module's function ids when it deliberately
   * differs from the display/container `name`. Compiler metadata defaults this
   * to `name`; it never infers authority from an encountered function id. */
  functionNamespace?: string;
  /** Exact per-function namespace exceptions for deliberate re-id seams. The
   * function id must exist in this module and still begin with the declared
   * namespace; stale, duplicate, or prefix-forged entries are rejected. */
  functionNamespaceOverrides?: Array<{
    functionId: string;
    namespace: string;
  }>;
  /** Module-supplied entity registrations — `{ id, type }`. Identity
   *  facets (codeName / label / description / icon / …) ride on sibling
   *  typeclass-instance registries keyed by `id`, same convention as
   *  `SystemEntity` in `system-entities.ts`. */
  entities?: Array<{
    id: string;
    type: FenelType;
    codeName?: string;
    params?: string[] | TypeConstructorParam[];
    module?: string;
    /** Declaration-scoped binding/kind/application evidence for this type
     * definition. The body is the entity's compatibility `type` projection. */
    typeScheme?: TypeScheme;
  }>;
  /** Source-only @fieldLabel/@widget/@helpText/@fieldReusable declarations. */
  fieldFacetDirectives?: FieldFacetSourceDirective[];
  /** FM-retire-Z — harvested `field: T = expr` method defaults, keyed by
   *  type_def name → method (field) name → coerced default body. Replaces the
   *  retired `FieldDef.default` slot as the channel that carries a class
   *  method's default implementation; consumed by `seedFromType` (threaded by
   *  the boot path) to populate `InterfaceMethod.body`. */
  methodDefaults?: Record<string, Record<string, unknown>>;
  instances?: Instance[];
  constructors?: TypeConstructor[];
  functions?: FenelFunction[];
  /** Loader-captured source declaration evidence. Registry construction clones
   * this transport data and publishes only resolved registry-local info. */
  functionSignatureDeclarations?: FunctionSignatureDeclaration[];
  /** Native JS implementations for built-in functions (keyed by function name) */
  nativeImpls?: Record<string, (...args: unknown[]) => unknown>;
  /** Ctx-aware native impls — receive the EvaluateContext as the first arg
   *  so the function can re-enter the evaluator (invokeFunction) to dispatch
   *  callable arguments (function names, lambdas, partial applications).
   *  This is the escape hatch higher-order builtins use (map / filter / fold)
   *  to apply the user's callback per element. The ctx parameter is typed
   *  loosely (`unknown`) to keep this module dependency-free; consumers
   *  cast to EvaluateContext. */
  nativeImplsCtx?: Record<string, (ctx: unknown, ...args: unknown[]) => unknown>;
  /** Env-var dependencies for capability providers — separate from the
   *  capability/typeclass system itself (pure dispatch vs runtime config).
   *  Phase 10a-5d-followup-2 retired the `capabilities` + `providers` +
   *  `typeclasses` slots; spec records now register directly into the
   *  shared `dispatchRegistry` via per-module named-const exports
   *  consumed by `system-entities.ts`. */
  credentialRequirements?: ProviderCredentials[];
  /** IO effect handlers (keyed by function name). Registered at runtime. */
  ioHandlers?: Record<string, IOHandler>;
  /** Operator fixity declarations from the module source. Captured by
   *  `loadFenelModule` so a re-parse of source generated from this module
   *  picks up the same operator precedences. Each entry corresponds to a
   *  Fenel-source `infixl/infixr/infix N op` declaration. */
  fixities?: Array<{ op: string; assoc: "l" | "r" | "n"; prec: number }>;
  /** Phase 2a (module-substrate) — captured Haskell-style `import`
   *  declarations from the module source (`import M`, `import M (a, b)`,
   *  `import M as N`, `import M hiding (a)`). Surfaced here but NOT yet
   *  resolved — name resolution against these imports (qualified → members,
   *  unqualified → import bindings → flat-global fallback) is Phase 2b. The
   *  `qualified` (bare, qualified-access-only) / selective `names` / `as`
   *  alias / `hiding` exclusion variants are mutually exclusive, mirroring
   *  Haskell's import grammar. */
  imports?: Array<{ module: string; qualified?: boolean; names?: string[]; as?: string; hiding?: string[] }>;
};

// ---------------------------------------------------------------------------
// read(T) at source — unified input primitive
// ---------------------------------------------------------------------------

/**
 * A read source — where typed input comes from.
 * The evaluator suspends on read(); the effect handler resolves the source.
 * Widget derivation happens from the schema, source determines the channel.
 */
export type ReadSource =
  | { kind: "web_form" }
  | { kind: "telegram"; chatId?: string }
  | { kind: "webhook"; path?: string }
  | { kind: "api" }
  | { kind: "ai_agent"; model?: string }
  | { kind: "channel"; id: string; config?: Record<string, unknown> };

/**
 * A read request — what the evaluator yields when it hits read().
 * Type = the T (what type of data to read).
 * Source = resolved at runtime by the effect handler.
 */
export type ReadRequest = {
  type: FenelType;
  source?: ReadSource;
  prompt?: LocaleString;
  timeout?: string;
};

// ---------------------------------------------------------------------------
// Provider credentials — declarative env-var dependencies for capability
// providers (typeclass instances dispatched by backend rather than by type).
// Lives at module-registration time alongside `providers`, separate from
// the typeclass system itself (which describes pure dispatch, not runtime
// config).
// ---------------------------------------------------------------------------

/**
 * Declarative credential requirement for a capability provider — what env
 * vars must be present for the provider's runtime methods to succeed.
 */
export type ProviderCredentials = {
  capability: string;
  provider: string;
  envVars: string[];
};

// ---------------------------------------------------------------------------
// Observability — typed execution traces
// ---------------------------------------------------------------------------

/**
 * TraceMeta — typed sidecar payload on a Trace. Phase 12 of canonical-maybe
 * (trace-meta-classify) replaced the prior `Record<string, unknown>` bag
 * with a closed `$tag`-discriminated variant; readers dispatch on `$tag`
 * instead of duck-typing magic keys. Add a new `$tag` case when a new
 * trace-sidecar shape needs to ship.
 */
export type TraceMeta =
  | { $tag: "LetBinding"; letName: string };

/**
 * A Trace represents one function invocation in the execution log.
 * Emitted automatically by the evaluator — no manual instrumentation.
 * The full trace of a flow instance IS a list of Traces.
 * Also serves as the persistence mechanism for durable execution / resumability.
 */
export type Trace = {
  id: string;
  instanceId: string;
  parentId: Maybe<string>;
  name: string;
  kind: "call" | "read" | "wait" | "io" | "pure" | "let";
  startedAt: string;
  completedAt: Maybe<string>;
  durationMs: Maybe<number>;
  status: "running" | "completed" | "failed" | "suspended";
  /** IO request params on the call that produced this trace. Phase 14 of
   *  canonical-maybe lifted this from `?:` to mandatory `Maybe<...>` —
   *  `Nothing` means "no input params" (e.g. `end_function` handler).
   *  Readers use `peelMaybeValue(input)` for null-tolerant access. */
  input: Maybe<Record<string, unknown>>;
  /** Output value produced by the call. Phase 14 of canonical-maybe lifted
   *  this from `?:` to mandatory `Maybe<...>`. `Nothing` means "no output
   *  yet" (running) OR "void return". New versioned trace rows preserve the
   *  complete Maybe carrier, including Just(null). Unmarked legacy rows retain
   *  their older nullable-column codec, where Just(null) reads as Nothing. */
  output: Maybe<unknown>;
  error: Maybe<string>;
  capability: Maybe<string>;
  provider: Maybe<string>;
  meta: Maybe<TraceMeta>;
  /** Flat list of $named type references appearing anywhere in the called
   *  function's params or returns. Populated at emission time so the type
   *  detail page can answer "show me traces touching values of type T"
   *  without re-walking signatures at query time. Phase 14 of
   *  canonical-maybe lifted this from `?:` to mandatory `Maybe<...>`;
   *  `Nothing` means "no type-tracking" (older traces / pure traces
   *  without function lookup / empty-list writers). Empty array writers
   *  emit `Nothing` (no semantic difference from `Just([])`). */
  valueTypes: Maybe<string[]>;
  /** Position of this trace within the body's expression tree, encoded
   *  as a dotted list of frame indices (e.g. `"0.2.1"` = stmt 1 inside
   *  stmt 2 inside the top-level stmt 0). Lets the editor overlay align
   *  each trace with the expression node that produced it. Phase 14 of
   *  canonical-maybe lifted this from `?:` to mandatory `Maybe<...>`;
   *  `Nothing` means "no step path" (back-compat with traces emitted
   *  before stepPath landed). */
  stepPath: Maybe<string>;
};

// ---------------------------------------------------------------------------
// AI — typeclass-based LLM integration
// ---------------------------------------------------------------------------

export type ReasoningLevel = "low" | "medium" | "high";

export type Reasoning =
  | { $tag: "Budget"; budget: number }
  | { $tag: "Effort"; level: ReasoningLevel }
  | { $tag: "Auto" };

export type LLMConfig = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  reasoning?: Reasoning;
};

export type AIGen = {
  prompt: string;
  outputSchema?: FenelType;
  system?: string;
};

export type AIResponse =
  | { $tag: "Parsed"; value: unknown }
  | { $tag: "Raw"; text: string };

export type AIError =
  | { $tag: "NetworkError"; message: string }
  | { $tag: "RateLimit"; retryAfter: Maybe<number> }
  | { $tag: "AuthError"; message: string }
  | { $tag: "TokenLimit"; used: number; max: number };

// ---------------------------------------------------------------------------
// IO handlers — registry-driven effect interpretation
// ---------------------------------------------------------------------------

/** rights R1 — the execution realm an IO leaf is being exercised under.
 *
 *  `"privileged"` is minted at exactly one place (the private auth door in
 *  `core/src/auth.ts`, via `invokeIOActionPrivileged`) and propagated through
 *  nested calls by `FunctionContext.realm`. Every other IO context constructor
 *  omits it, so the identity leaves — which can mint a session or set a
 *  password hash — refuse by default.
 *
 *  This is deliberately a BIT, not a policy. It is the hand-rolled shape of
 *  rights R2's opaque `AuthorityRef`: one authenticated marker on the frame,
 *  consulted at exercise rather than at resolution. R2 replaces it.
 *  See `workstreams/rights/briefs/r1-containment-ii.md` §4.2. */
export type ExecutionRealm = "privileged";

export type IOHandlerContext = {
  accountId: string;
  profileId: string;
  /** rights R2a — the authority this leaf is being exercised under. REQUIRED,
   *  with no default: R1's outage was a default, and the TypeScript compiler is
   *  the constructor census that keeps every frame builder honest.
   *
   *  It is the same handle the frame carries; `performIODescriptor` copies it
   *  onto the frame it builds rather than inheriting the registry bootstrap. */
  authority: AuthorityRef;
  /** Absent = ordinary account code. See `ExecutionRealm`. Fail closed.
   *
   *  ⚠ RETAINED ON PURPOSE past R2a. The member envelope now excludes the
   *  identity leaves too, so this bit and the gate refuse the same acts twice.
   *  That redundancy is defence in depth until rights R6 replaces the hand
   *  split with a real binding; do not retire it as "covered". */
  realm?: ExecutionRealm;
  callFunction: (slug: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Durable callers preserve a child's suspension instead of fabricating a value. */
  callFunctionResult?: (slug: string, args: Record<string, unknown>) => Promise<IOHandlerResult>;
  dispatchAction: (action: string, params: Record<string, unknown>) => Promise<unknown>;
};

/**
 * SuspendStatus — the closed set of status values an IO handler can return
 * when suspending a durable function. Phase 12 of canonical-maybe lifted
 * this from `string` to a string-literal union; audit identified four
 * actually-emitted values (`waiting_event`, `awaiting_choice`,
 * `waiting_timer` from `read` / `sleep` / `wait` handlers + `completed`
 * from `end_function`). The broader `InstanceStatus` (which also includes
 * `running` / `cancelled` / `failed`) is set by the runtime itself in
 * non-suspend paths and is distinct from what handlers return.
 */
export type SuspendStatus =
  | "waiting_event"
  | "awaiting_choice"
  | "waiting_timer"
  | "completed";

/**
 * RetryReason — typed sidecar payload on a `WaitTimer` SuspendMeta when the
 * timer-suspend was triggered by a provider-rate-limit-retry. Phase 12 of
 * canonical-maybe lifted the prior implicit-via-underscored-keys
 * (`_telegramRetryReason` / `_notionRetryReason`) into this closed
 * variant; add a new `$tag` case (e.g. `StripeRetry`) when a new provider
 * needs to surface a retry-with-description shape.
 */
export type RetryReason =
  | { $tag: "TelegramRetry"; description: string }
  | { $tag: "NotionRetry"; description: string };

/**
 * SuspendMeta — typed sidecar payload on a `suspend` IOHandlerResult.
 * Phase 12 of canonical-maybe replaced the prior `Record<string, unknown>`
 * bag (which encoded per-status payload via underscored-key convention:
 * `_waitFilter` / `_readSchema` / `_wakeAt` / `_telegramRetryReason` /
 * `_notionRetryReason`) with this closed `$tag`-discriminated variant.
 * Readers dispatch on `$tag` instead of duck-typing magic keys. The
 * shape is parallel-but-independent of `SuspendStatus` (the parallel
 * `status` field on the same suspend result names the status; this
 * carries the typed payload).
 */
export type SuspendMeta =
  | { $tag: "WaitEvent"; event: string; filter: Record<string, unknown>; schema?: Maybe<FenelType>; prompt?: Maybe<string>; timeoutAt?: Maybe<string> }
  | { $tag: "AwaitingChoice"; schema: Record<string, unknown>; timeoutAt?: Maybe<string> }
  | { $tag: "WaitChild"; instanceId: string }
  | { $tag: "WaitTimer"; wakeAt: string; retryReason: Maybe<RetryReason> };

export type IOHandlerResult =
  | { action: "continue"; value: unknown }
  | { action: "suspend"; status: SuspendStatus; meta: Maybe<SuspendMeta> };

export type IOHandler = (params: Record<string, unknown>, ctx: IOHandlerContext) => Promise<IOHandlerResult>;

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("types") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_types from "./types";
import { registerEngineModule as __reg_types } from "./engine-require";
__reg_types("types", __self_types);
