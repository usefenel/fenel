// ---------------------------------------------------------------------------
// set-marker.ts — THE canonical SetExpr recognizer, constructor surface, and
// legacy host-boundary codecs. Canonical internal values use the registered
// fifteen-case `$tag` ADT (SeRigid is the 15th, signature-substrate P4 3a); exact historical `$`-key values are accepted only
// over `unknown` at the remaining host boundaries.
//
// set-algebra-to-fenel Phase 3b-0 (EXPAND stage; brief:
// `workstreams/set-algebra-to-fenel/briefs/phase-3b-0-centralize-recognizer.md`).
// This file is the HOME of the ONE canonical dual-read recognizer
// (`peelSetExpr`). Before 3b-0 the repo had THREE parallel `$`-key→tag SetExpr
// recognizers (`marshalSet` here, the 8 `marshalSetExprFor*` in
// `engine-bodies-dispatch.ts`, `setShape` in `decidable-membership.ts`) plus
// ~17 readers each open-coding `if ("$union" in set) … else if …`. 3b-0
// consolidated the readers onto `peelSetExpr`; floor-kernel Phase 4 then made
// that recognizer the sole fourteen-case owner and retired the parallel public
// legacy union and SetMarker classifier (fifteen-case since signature-substrate
// P4 slice 3a added SeRigid).
//
// unified-static-analysis Phase 3b-2 (brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-2-invert-backward-transfer.md`,
// section A / decision D-3b-2-1). EXTRACTED from `propagate.ts` (Phase 3b-1)
// so the FORWARD (`propagate`) AND BACKWARD (`invert`) transfer seams — plus
// the parity tests — share ONE foundation rather than the round-trip living
// privately inside `propagate.ts`. Pure refactor, zero logic change: the proof
// is `propagate.test.ts` staying byte-green after the move.
//
// THE `$`-KEY BARRIER — the SET side is RESOLVED (decide-substrate Phase 1
// Stage E). The `$tag` `Se*` form is readable/authorable from a `.fenel` body
// (a real registered ADT it pattern-matches on), so the inference bodies now
// read and build the canonical SetExpr DIRECTLY; the `Sm*` SetMarker mirror +
// the `marshalSet`/`unmarshalSet` round-trip + `marshalBound` are RETIRED. The
// TS seams normalize any-form input via `setExprToTag` (below). `±Infinity`
// stays gone Fenel-side: the bodies' `numBound` adapter (propagate.fenel) maps
// an object-valued (`{$expr}`) bound to `Nothing` (the legacy `numLo` /
// `numHi` ±Infinity reads on the supported fragment).
//
// `peelSetExpr` is irreducibly TS — it reads `$`-prefixed keys, which no
// `.fenel` body can do. It is the sanctioned `$`-key→`$tag` boundary
// (ts-exceptions-ledger D1 / B3). It carries ZERO decision logic — pure
// structural recognition — so the content-granular audit gate sees it as a
// boundary, not logic.
// ---------------------------------------------------------------------------

import type {
  SetExpr,
  SetCtorField,
  SetArrowParam,
  FieldKey,
  Interval,
  Pattern,
  PatternOf,
  Expression,
} from "./types";

// ---------------------------------------------------------------------------
// SetExprView — the canonical dual-read view of a SetExpr the backend
// readers switch on (`view.kind`) instead of open-coding `"$x" in set`. The
// `kind` values mirror the registered `SetExpr` entity's `Se*` cases 1:1
// (`fenel/modules/engine/set-expr-types.fenel`), and the payload field names
// + shapes match the registered ADT. Recursive payloads expose the input child
// unchanged; boundary normalizers recurse through them, so mixed canonical /
// legacy trees remain readable without making legacy input a public type.
// ---------------------------------------------------------------------------

type SetCtorFieldView<Child> = {
  $tag: "SetCtorField";
  key: FieldKey;
  wireName: string;
  set: Child;
};

type SetArrowParamView<Child> = {
  $tag: "SetArrowParam";
  key: FieldKey;
  wireName: string;
  set: Child;
};

export type SetExprView<Child = unknown> =
  | { kind: "SeAll" }
  | { kind: "SeNone" }
  | { kind: "SeEnum"; values: unknown[] }
  | { kind: "SeInterval"; interval: Interval }
  | { kind: "SeRef"; handle: string }
  | { kind: "SePattern"; pattern: PatternOf<Child> }
  | { kind: "SeWhere"; pred: Expression }
  | { kind: "SeCtor"; ctor: string; fields: SetCtorFieldView<Child>[] }
  | { kind: "SeMu"; var: string; body: Child }
  | { kind: "SeArrow"; params: SetArrowParamView<Child>[]; returns: Child }
  // signature-substrate Phase 4 slice 3a — the validation rigid atom. Its own
  // `kind` field is projected as `rigidKind` because `kind` is this view's
  // discriminant.
  | { kind: "SeRigid"; scopeToken: string; ordinal: number; rigidKind: unknown }
  | { kind: "SeUnion"; branches: Child[] }
  | { kind: "SeIntersect"; branches: Child[] }
  | { kind: "SeDiff"; left: Child; right: Child }
  | { kind: "SeComplement"; inner: Child };

/** The canonical Se*-tag set — used to recognize a `$tag`-form SetExpr and
 *  pinned against the registered `SetExpr` entity cases. Producers and storage
 *  emit this form. The `$`-key arm below is boundary tolerance for historical
 *  inputs and for the one regex `predInfo` host adapter that still deliberately
 *  emits the legacy envelope. Both forms are characterized in
 *  `set-expr-recognizer.test.ts`. */
/* signature-substrate Phase 4 slice 3a — `SeRigid` IS a member of the roster,
 * in registered declaration order. The recognizer must KNOW a rigid: a rigid is
 * a first-class internal SetExpr constructor (that is the whole reason S0 chose
 * a constructor over a reserved `SeRef` namespace), and leaving it out of the
 * roster would make every host boundary silently reclassify it as "not a set
 * expression at all" — the swallow class this slice exists to eliminate.
 *
 * Non-escape is enforced ASYMMETRICALLY instead, at the one place it belongs:
 * `setExprToDollarKey` — the legacy/external OUTPUT codec — REJECTS a rigid
 * (there is no `$`-key spelling to emit), including a rigid nested anywhere in
 * the tree, because the recursive arms route back through the same guard.
 * Recognition is internal; egress is closed. */
export const SET_EXPR_TAGS = [
  "SeAll", "SeNone", "SeEnum", "SeInterval", "SeRef", "SePattern",
  "SeWhere", "SeCtor", "SeMu", "SeArrow", "SeRigid", "SeUnion", "SeIntersect",
  "SeDiff", "SeComplement",
] as const satisfies readonly SetExpr["$tag"][];

/** signature-substrate Phase 4 slice 3a — the validation rigid tag, named once
 * so the egress guard below and the rigid battery's roster/non-escape scans
 * agree on one spelling rather than repeating a string literal. */
export const VALIDATION_RIGID_TAG = "SeRigid";

/** Descriptor-safe rigid probe for the host boundary guards. Reads only an own
 * data slot, so a hostile accessor cannot make a rigid look like anything else
 * (or anything else look like a rigid). */
function isRigidValue(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$tag");
  return descriptor !== undefined
    && "value" in descriptor
    && descriptor.value === VALIDATION_RIGID_TAG;
}

/** signature-substrate Phase 4 slice 3a — is this a well-formed `Kind`?
 *
 * `SeRigid.kind` is declared `Any` in the registered ADT because the kind
 * vocabulary lives in the signature layer, not the set layer. That `Any` is a
 * REAL hole if left unchecked: the whole μ-metadata group (`substSet`,
 * `sePositiveP`, `seVarOccurs`, `seVarUnderPattern`, `seMuGuarded`,
 * `seRefHandles`) treats a rigid as a LEAF "because it has no SetExpr child",
 * and the `fenel.validation.rigid.v1` digest copies `kind` verbatim. A rigid
 * whose `kind` transitively carried a SetExpr — or another rigid — would break
 * both claims at once, putting a foreign `scopeToken` into the one projection
 * that is allowed to leave the validation frame.
 *
 * So the recognizer enforces the closed `Kind` ADT (`types.ts`:
 * `KType | KArrow {input, output}`) structurally and descriptor-safely. A
 * malformed kind makes the value NOT a rigid, which is the fail-closed answer.
 * With this check the leafness argument is a fact about every value the host
 * will ever call a rigid, not an assumption about well-behaved callers. */
function isWellFormedKind(value: unknown, budget = { nodes: 4096 }): boolean {
  // A NODE BUDGET rather than a depth cap. A depth cap both rejected legitimate
  // deeply-curried kinds and did nothing about a shared-DAG kind whose repeated
  // sub-validation is exponential in depth. Counting nodes bounds total work and
  // terminates on a cyclic structure, without declaring any particular arity
  // malformed. Exhausting it is a rejection: a kind this large is not one the
  // signature layer produces.
  if (budget.nodes-- <= 0) return false;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  // `Reflect.ownKeys` (not `Object.keys`) so a non-enumerable or SYMBOL-keyed
  // extra cannot smuggle a payload past the exact-shape check, and a hostile
  // `ownKeys` trap makes the value malformed rather than throwing out of a
  // structural recognizer.
  let keys: readonly (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  const tag = ownDataSlot(value, "$tag");
  if (tag.kind !== "data") return false;
  // BOTH arms check their COMPLETE own-key set. Checking it only for `KType`
  // was the hole: `{$tag:"KArrow", input, output, leak: <a rigid>}` was accepted,
  // which is exactly the transitively-nested SetExpr the leafness invariant
  // forbids.
  if (tag.value === "KType") return keys.length === 1;
  if (tag.value !== "KArrow") return false;
  if (keys.length !== 3) return false;
  const input = ownDataSlot(value, "input");
  const output = ownDataSlot(value, "output");
  return input.kind === "data"
    && output.kind === "data"
    && isWellFormedKind(input.value, budget)
    && isWellFormedKind(output.value, budget);
}

/** signature-substrate Phase 4 slice 3a — the rigid PROVENANCE boundary.
 *
 * A validation rigid is meaningful only inside a validation frame. Recognizing
 * it in `SET_EXPR_TAGS` is what lets the internal deciders reason about one —
 * but it also means an untrusted `unknown` could be canonicalized INTO one, and
 * `setExprToTag` is exactly the gateway the query API, the permission-policy
 * store, and the policy evaluator use to sanitize caller-supplied filters.
 *
 * A forged rigid is harmless to the SET ALGEBRA (it is the most-abstaining leaf
 * — its only `Just true` rows hold for every set), but it is NOT harmless to
 * the non-algebra projections, because no CONSTANT lowering of an unknown set
 * is stable under negation: a rigid lowers to SQL `FALSE`, so `¬κ` lowers to
 * `NOT FALSE` = `TRUE` and silently disables a filter (the JSON-Schema
 * `{not:{}}` arm inverts the same way). That is why admission is opt-in: the
 * DEFAULT rejects, and only the engine-internal decider seams — which receive
 * rigids that a validation frame minted — pass `admitValidationRigid`. */
export type SetExprToTagOptions = {
  readonly admitValidationRigid?: boolean;
};

const SET_EXPR_TAG_SET: ReadonlySet<string> = new Set(SET_EXPR_TAGS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type OwnDataSlot =
  | { readonly kind: "missing" }
  | { readonly kind: "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

/** Read one host-boundary slot without consulting prototypes or invoking an
 * accessor.  The three-way result lets optional slots distinguish absence
 * from a hostile getter. */
function ownDataSlot(record: object, key: PropertyKey): OwnDataSlot {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return { kind: "missing" };
  return "value" in descriptor
    ? { kind: "data", value: descriptor.value }
    : { kind: "accessor" };
}

/** A legacy envelope has one own spelling key, optionally accompanied by the
 * projection provenance bit. Keep that bit enumerable so JSON persistence
 * retains it; hiding it to satisfy the old single-key check would launder it.
 * No other sidecars or accessor-valued markers belong to this wire shape. */
function legacySetEnvelopeKey(value: object): string | null {
  const marker = ownDataSlot(value, DEGRADED_TYPE_PROJECTION_FLAG);
  if (marker.kind === "accessor"
    || (marker.kind === "data" && marker.value !== true)) return null;
  const keys = Reflect.ownKeys(value)
    .filter((key) => key !== DEGRADED_TYPE_PROJECTION_FLAG);
  return keys.length === 1 && typeof keys[0] === "string" ? keys[0] : null;
}

/** Snapshot a dense array through own data descriptors. Holes, inherited
 * numeric values, and index accessors are not array elements at this boundary. */
function denseOwnDataArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const length = ownDataSlot(value, "length");
  if (
    length.kind !== "data"
    || typeof length.value !== "number"
    || !Number.isSafeInteger(length.value)
    || length.value < 0
  ) return null;
  const out: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const item = ownDataSlot(value, String(index));
    if (item.kind !== "data") return null;
    out.push(item.value);
  }
  return out;
}

function isBinder(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const bind = ownDataSlot(value, "$bind");
  return bind.kind === "data" && typeof bind.value === "string";
}

/** Structural recognition only. UUID syntax, ordinal/container agreement,
 * duplicate keys, and projection conflicts are decided by the Fenel field-slot
 * kernel before a semantic judgment runs. */
function peelFieldKeyView(value: unknown): FieldKey | null {
  if (!isRecord(value)) return null;
  const tag = ownDataSlot(value, "$tag");
  if (tag.kind !== "data") return null;
  if (tag.value === "NamedField") {
    const ref = ownDataSlot(value, "ref");
    if (ref.kind !== "data" || !isRecord(ref.value)) return null;
    const handle = ownDataSlot(ref.value, "$ref");
    return handle.kind === "data" && typeof handle.value === "string"
      ? { $tag: "NamedField", ref: { $ref: handle.value } }
      : null;
  }
  if (tag.value !== "PositionalField") return null;
  const index = ownDataSlot(value, "index");
  return index.kind === "data"
    && typeof index.value === "number"
    && Number.isInteger(index.value)
    && index.value >= 0
    ? { $tag: "PositionalField", index: index.value }
    : null;
}

/** B3 carrier codec: registered Sp* and legacy .t values reach the same host
 * Pattern representation. Predicate decisions stay in the existing matcher. */
export function normalizeSetPattern(value: unknown): PatternOf<unknown> | null {
  try {
    return peelPattern(value, new WeakSet<object>(), { nodes: 10000 }, 0);
  } catch {
    return null;
  }
}

/** Validate and expose the mutually-recursive Pattern structure without
 * claiming that its SetExpr child slots are canonical. */
function peelPattern(value: unknown, active: WeakSet<object>, budget: { nodes: number }, depth: number): PatternOf<unknown> | null {
  // Bound decoding before recursive carrier reconstruction can unfold a shared
  // DAG exponentially or exhaust the host stack. These are codec refusals.
  if (budget.nodes-- <= 0 || depth > 256) return null;
  if (!isRecord(value)) return null;
  if (active.has(value)) return null;
  active.add(value);
  try {
    return peelPatternFields(value, active, budget, depth);
  } finally {
    active.delete(value);
  }
}

function peelPatternFields(value: Record<string, unknown>, active: WeakSet<object>, budget: { nodes: number }, depth: number): PatternOf<unknown> | null {
  const registered = ownDataSlot(value, "$tag");
  if (registered.kind === "accessor") return null;
  const tag = registered.kind === "missing" ? ownDataSlot(value, "t") : registered;
  if (tag.kind !== "data" || typeof tag.value !== "string") return null;
  // The two discriminators have different closed vocabularies. A hybrid must
  // not choose whichever spelling happens to reach a supported switch arm.
  if (registered.kind === "data") {
    if (ownDataSlot(value, "t").kind !== "missing" || !tag.value.startsWith("Sp")) return null;
  } else if (tag.value.startsWith("Sp")) return null;
  switch (tag.value) {
    case "SpEmpty":
    case "empty": return { t: "empty" };
    case "SpEps":
    case "eps": return { t: "eps" };
    case "SpMatch":
    case "match": {
      const pred = ownDataSlot(value, "pred");
      return pred.kind === "data" && !isBinder(pred.value)
        ? { t: "match", pred: pred.value }
        : null;
    }
    case "SpSeq":
    case "SpAlt":
    case "seq":
    case "alt": {
      const rawA = ownDataSlot(value, "a");
      const rawB = ownDataSlot(value, "b");
      if (rawA.kind !== "data" || rawB.kind !== "data") return null;
      const a = peelPattern(rawA.value, active, budget, depth + 1);
      const b = peelPattern(rawB.value, active, budget, depth + 1);
      if (a === null || b === null) return null;
      return tag.value === "seq" || tag.value === "SpSeq" ? { t: "seq", a, b } : { t: "alt", a, b };
    }
    case "SpRep":
    case "rep": {
      const rawChild = ownDataSlot(value, "child");
      const min = ownDataSlot(value, "min");
      const max = ownDataSlot(value, "max");
      if (rawChild.kind !== "data") return null;
      const child = peelPattern(rawChild.value, active, budget, depth + 1);
      return child !== null
        && min.kind === "data"
        && typeof min.value === "number"
        && max.kind === "data"
        && (typeof max.value === "number" || (tag.value === "rep" && max.value === "unbounded"))
        ? { t: "rep", child, min: min.value, max: max.value === "unbounded" ? Infinity : max.value as number }
        : null;
    }
    case "SpGroup":
    case "group": {
      const rawChild = ownDataSlot(value, "child");
      const name = ownDataSlot(value, "name");
      const type = ownDataSlot(value, "type");
      if (rawChild.kind !== "data" || name.kind !== "data" || typeof name.value !== "string") {
        return null;
      }
      const child = peelPattern(rawChild.value, active, budget, depth + 1);
      if (child === null || type.kind === "accessor") return null;
      if (tag.value === "SpGroup") {
        if (type.kind !== "data" || !isRecord(type.value)) return null;
        const maybeTag = ownDataSlot(type.value, "$tag");
        if (maybeTag.kind !== "data") return null;
        if (maybeTag.value === "Nothing") return { t: "group", name: name.value, child };
        if (maybeTag.value !== "Just") return null;
        const payload = ownDataSlot(type.value, "_0");
        return payload.kind === "data" && payload.value !== undefined && payload.value !== null && !isBinder(payload.value)
          ? { t: "group", name: name.value, child, type: payload.value }
          : null;
      }
      if (type.kind === "missing" || type.value === undefined) {
        return { t: "group", name: name.value, child };
      }
      return !isBinder(type.value)
        ? { t: "group", name: name.value, child, type: type.value }
        : null;
    }
    default:
      return null;
  }
}

/** Map only Pattern's recursive SetExpr slots, preserving the regex shape. */
function mapPatternSets<From, To>(
  pattern: PatternOf<From>,
  mapSet: (set: From) => To,
): PatternOf<To> {
  switch (pattern.t) {
    case "empty": return pattern;
    case "eps": return pattern;
    case "match": return { t: "match", pred: mapSet(pattern.pred) };
    case "seq": return {
      t: "seq",
      a: mapPatternSets(pattern.a, mapSet),
      b: mapPatternSets(pattern.b, mapSet),
    };
    case "alt": return {
      t: "alt",
      a: mapPatternSets(pattern.a, mapSet),
      b: mapPatternSets(pattern.b, mapSet),
    };
    case "rep": return {
      t: "rep",
      child: mapPatternSets(pattern.child, mapSet),
      min: pattern.min,
      max: pattern.max,
    };
    case "group": return pattern.type === undefined
      ? { t: "group", name: pattern.name, child: mapPatternSets(pattern.child, mapSet) }
      : {
          t: "group",
          name: pattern.name,
          child: mapPatternSets(pattern.child, mapSet),
          type: mapSet(pattern.type),
        };
  }
}

function peelSetCtorFieldView(value: unknown): SetCtorFieldView<unknown> | null {
  if (!isRecord(value)) return null;
  const tag = ownDataSlot(value, "$tag");
  const rawKey = ownDataSlot(value, "key");
  const wireName = ownDataSlot(value, "wireName");
  const set = ownDataSlot(value, "set");
  if (
    tag.kind !== "data"
    || tag.value !== "SetCtorField"
    || rawKey.kind !== "data"
    || wireName.kind !== "data"
    || typeof wireName.value !== "string"
    || set.kind !== "data"
    || isBinder(set.value)
  ) return null;
  const key = peelFieldKeyView(rawKey.value);
  return key === null
    ? null
    : { $tag: "SetCtorField", key, wireName: wireName.value, set: set.value };
}

function peelSetArrowParamView(value: unknown): SetArrowParamView<unknown> | null {
  if (!isRecord(value)) return null;
  const tag = ownDataSlot(value, "$tag");
  const rawKey = ownDataSlot(value, "key");
  const wireName = ownDataSlot(value, "wireName");
  const set = ownDataSlot(value, "set");
  if (
    tag.kind !== "data"
    || tag.value !== "SetArrowParam"
    || rawKey.kind !== "data"
    || wireName.kind !== "data"
    || typeof wireName.value !== "string"
    || set.kind !== "data"
    || isBinder(set.value)
  ) return null;
  const key = peelFieldKeyView(rawKey.value);
  return key === null
    ? null
    : { $tag: "SetArrowParam", key, wireName: wireName.value, set: set.value };
}

/**
 * The canonical structural SetExpr recognizer. Canonical internal values use
 * the registered `$tag` ADT. The eleven exact legacy `$`-key spellings remain
 * accepted only because this function is also the `unknown` boundary gateway;
 * both forms project to the same `SetExprView`.
 *
 * Returns `null` for anything that is not a structural SetExpr value (a point
 * value, a `{$expr}` wrapper, a non-object, or a constructor-pattern binder).
 *
 * The eleven retained legacy spellings have one envelope key, optionally
 * accompanied by an own true degraded-projection provenance data slot.
 * `$named` is not one of them; canonical and legacy name handles are SeRef and
 * `$ref`, respectively.
 */
export function peelSetExpr(set: SetExpr): SetExprView<SetExpr> | null;
export function peelSetExpr(set: unknown): SetExprView<unknown> | null;
export function peelSetExpr(set: unknown): SetExprView<unknown> | null {
  if (!isRecord(set)) return null;

  // --- $tag form (canonical) -----------------------------------------------
  const tag = ownDataSlot(set, "$tag");
  if (tag.kind === "accessor") return null;
  if (tag.kind === "data") {
    if (typeof tag.value !== "string" || !SET_EXPR_TAG_SET.has(tag.value)) return null;
    switch (tag.value) {
      case "SeAll": return { kind: "SeAll" };
      case "SeNone": return { kind: "SeNone" };
      case "SeEnum": {
        const values = ownDataSlot(set, "values");
        const snapshot = values.kind === "data" ? denseOwnDataArray(values.value) : null;
        return snapshot === null ? null : { kind: "SeEnum", values: snapshot };
      }
      case "SeInterval": {
        const interval = ownDataSlot(set, "interval");
        return interval.kind === "data" && isRecord(interval.value) && !isBinder(interval.value)
          ? { kind: "SeInterval", interval: interval.value as Interval }
          : null;
      }
      case "SeRef": {
        const handle = ownDataSlot(set, "handle");
        return handle.kind === "data" && typeof handle.value === "string"
          ? { kind: "SeRef", handle: handle.value }
          : null;
      }
      case "SePattern": {
        const rawPattern = ownDataSlot(set, "pattern");
        if (rawPattern.kind !== "data") return null;
        const pattern = normalizeSetPattern(rawPattern.value);
        return pattern === null ? null : { kind: "SePattern", pattern };
      }
      case "SeWhere": {
        const pred = ownDataSlot(set, "pred");
        return pred.kind === "data" && isRecord(pred.value) && !isBinder(pred.value)
          ? { kind: "SeWhere", pred: pred.value }
          : null;
      }
      case "SeCtor": {
        const ctor = ownDataSlot(set, "ctor");
        const rawFields = ownDataSlot(set, "fields");
        const fieldValues = rawFields.kind === "data" ? denseOwnDataArray(rawFields.value) : null;
        if (ctor.kind !== "data" || typeof ctor.value !== "string" || fieldValues === null) return null;
        const fields: SetCtorFieldView<unknown>[] = [];
        for (const value of fieldValues) {
          const field = peelSetCtorFieldView(value);
          if (field === null) return null;
          fields.push(field);
        }
        return { kind: "SeCtor", ctor: ctor.value, fields };
      }
      case "SeMu": {
        const variable = ownDataSlot(set, "var");
        const body = ownDataSlot(set, "body");
        return variable.kind === "data"
          && typeof variable.value === "string"
          && body.kind === "data"
          && !isBinder(body.value)
          ? { kind: "SeMu", var: variable.value, body: body.value }
          : null;
      }
      case "SeArrow": {
        const rawParams = ownDataSlot(set, "params");
        const returns = ownDataSlot(set, "returns");
        const paramValues = rawParams.kind === "data" ? denseOwnDataArray(rawParams.value) : null;
        if (paramValues === null || returns.kind !== "data" || isBinder(returns.value)) return null;
        const params: SetArrowParamView<unknown>[] = [];
        for (const value of paramValues) {
          const param = peelSetArrowParamView(value);
          if (param === null) return null;
          params.push(param);
        }
        return { kind: "SeArrow", params, returns: returns.value };
      }
      // signature-substrate Phase 4 slice 3a — the validation rigid atom.
      // Descriptor-safe like every arm here: a hostile accessor on any of the
      // three slots makes the value unrecognized rather than a rigid whose
      // identity is read twice with two different answers. `ordinal` must be a
      // finite non-negative integer (it is a `Nat` in the registered ADT) — an
      // out-of-domain ordinal is malformed, not a rigid, because the digest and
      // `setSemanticEq` both key on it.
      case "SeRigid": {
        const scopeToken = ownDataSlot(set, "scopeToken");
        const ordinal = ownDataSlot(set, "ordinal");
        const rigidKind = ownDataSlot(set, "kind");
        return scopeToken.kind === "data"
          && typeof scopeToken.value === "string"
          && ordinal.kind === "data"
          && typeof ordinal.value === "number"
          && Number.isSafeInteger(ordinal.value)
          && ordinal.value >= 0
          && rigidKind.kind === "data"
          && isWellFormedKind(rigidKind.value)
          ? {
            kind: "SeRigid",
            scopeToken: scopeToken.value,
            ordinal: ordinal.value,
            rigidKind: rigidKind.value,
          }
          : null;
      }
      // `branches` must be an ARRAY for a SetExpr VALUE. A constructor PATTERN
      // over the `SeUnion`/`SeIntersect` ADT case (e.g. `case s of SeIntersect
      // { branches = bs } -> …` in widget-hint.fenel) marshals to the SAME
      // `{$tag:"SeIntersect", branches:{$bind:"bs"}}` shape but with a binder, not
      // an array — NOT a value. Reject it so the recogniser stays a value-only
      // recogniser and the recursive lowerings (`setExprToDollarKey`/`…ToTag`,
      // which `.map` over `branches`) never see a pattern (they `return set`
      // verbatim on a `null` peel).
      case "SeUnion":
      case "SeIntersect": {
        const rawBranches = ownDataSlot(set, "branches");
        const branches = rawBranches.kind === "data" ? denseOwnDataArray(rawBranches.value) : null;
        if (branches === null) return null;
        return tag.value === "SeUnion"
          ? { kind: "SeUnion", branches }
          : { kind: "SeIntersect", branches };
      }
      case "SeDiff": {
        const left = ownDataSlot(set, "left");
        const right = ownDataSlot(set, "right");
        return left.kind === "data"
          && right.kind === "data"
          && !isBinder(left.value)
          && !isBinder(right.value)
          ? { kind: "SeDiff", left: left.value, right: right.value }
          : null;
      }
      case "SeComplement": {
        const inner = ownDataSlot(set, "inner");
        return inner.kind === "data" && !isBinder(inner.value)
          ? { kind: "SeComplement", inner: inner.value }
          : null;
      }
    }
  }

  // --- `$`-key form (retained boundary input only) -------------------------
  const legacyKey = legacySetEnvelopeKey(set);
  if (legacyKey === null) return null;
  const payload = ownDataSlot(set, legacyKey);
  if (payload.kind !== "data") return null;
  switch (legacyKey) {
    case "$all": return payload.value === true ? { kind: "SeAll" } : null;
    case "$none": return payload.value === true ? { kind: "SeNone" } : null;
    case "$enum": {
      const values = denseOwnDataArray(payload.value);
      return values === null ? null : { kind: "SeEnum", values };
    }
    case "$interval": return isRecord(payload.value) && !isBinder(payload.value)
      ? { kind: "SeInterval", interval: payload.value as Interval }
      : null;
    case "$ref": return typeof payload.value === "string"
      ? { kind: "SeRef", handle: payload.value }
      : null;
    case "$pattern": {
      const pattern = normalizeSetPattern(payload.value);
      return pattern === null ? null : { kind: "SePattern", pattern };
    }
    case "$where": return isRecord(payload.value) && !isBinder(payload.value)
      ? { kind: "SeWhere", pred: payload.value }
      : null;
    // value-only (array `branches`) — a `{$union}`/`{$intersect}` PATTERN binder
    // is not a value; reject so recursive lowerings never map a non-dense array.
    case "$union":
    case "$intersect": {
      const branches = denseOwnDataArray(payload.value);
      if (branches === null) return null;
      return legacyKey === "$union"
        ? { kind: "SeUnion", branches }
        : { kind: "SeIntersect", branches };
    }
    case "$diff": {
      const children = denseOwnDataArray(payload.value);
      return children !== null
        && children.length === 2
        && !isBinder(children[0])
        && !isBinder(children[1])
        ? { kind: "SeDiff", left: children[0], right: children[1] }
        : null;
    }
    case "$complement": return !isBinder(payload.value)
      ? { kind: "SeComplement", inner: payload.value }
      : null;
    default: return null;
  }
}

/** Boolean projection of the one structural recognizer. It deliberately is not
 * a type predicate because legacy boundary input is recognized but is not a
 * member of canonical `SetExpr`. */
export function isSetExpr(value: unknown): boolean {
  return peelSetExpr(value) !== null;
}

// ---------------------------------------------------------------------------
// buildSetExpr — the one canonical host constructor surface. Every builder
// emits a registered `$tag` value, including the typed recursive records used
// by SeCtor and SeArrow.
// ---------------------------------------------------------------------------

// This is the only host constructor surface. It is 1:1 with the registered
// `SetExpr` entity and never emits a legacy `$`-key value.
export const buildSetExpr = {
  all: (): SetExpr => ({ $tag: "SeAll" }),
  none: (): SetExpr => ({ $tag: "SeNone" }),
  enum: (values: unknown[]): SetExpr => ({ $tag: "SeEnum", values }),
  interval: (interval: Interval): SetExpr => ({ $tag: "SeInterval", interval }),
  ref: (handle: string): SetExpr => ({ $tag: "SeRef", handle }),
  pattern: (pattern: Pattern): SetExpr => ({ $tag: "SePattern", pattern }),
  where: (pred: Expression): SetExpr => ({ $tag: "SeWhere", pred }),
  union: (branches: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches }),
  intersect: (branches: SetExpr[]): SetExpr => ({ $tag: "SeIntersect", branches }),
  diff: (left: SetExpr, right: SetExpr): SetExpr => ({ $tag: "SeDiff", left, right }),
  complement: (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner }),
  ctorField: (key: FieldKey, wireName: string, set: SetExpr): SetCtorField => ({
    $tag: "SetCtorField",
    key,
    wireName,
    set,
  }),
  ctor: (ctor: string, fields: SetCtorField[]): SetExpr => ({ $tag: "SeCtor", ctor, fields }),
  mu: (variable: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: variable, body }),
  arrowParam: (key: FieldKey, wireName: string, set: SetExpr): SetArrowParam => ({
    $tag: "SetArrowParam",
    key,
    wireName,
    set,
  }),
  arrow: (params: SetArrowParam[], returns: SetExpr): SetExpr => ({ $tag: "SeArrow", params, returns }),
  /* signature-substrate Phase 4 slice 3a — the validation rigid atom κ.
   *
   * A rigid is MINTED IN THE VALIDATION FRAME (`vrgMint` in
   * fenel/modules/engine/validation-rigid.fenel); this builder exists so the
   * host canonicalization gateway and the rigid test battery have ONE
   * construction site instead of scattered `{$tag:"SeRigid"}` literals that no
   * scan could find. The discipline "no production path outside the validation
   * frame constructs a rigid" is enforced by the phase-4 static gate, not by
   * the absence of a builder. */
  rigid: (scopeToken: string, ordinal: number, kind: unknown): SetExpr =>
    ({ $tag: "SeRigid", scopeToken, ordinal, kind }),
};

// field-identity Phase 4b — `typeToSetExpr` is also used as an editor-facing
// suggestion projection, where an identity-incomplete source type still needs
// the historical SeAll fallback.  That fallback is not evidence that the type
// denotes the universe, though.  Carry this orthogonal flag on the returned
// SetExpr so judgment boundaries can abstain instead of proving facts about a
// lossy projection.  It is deliberately not a SetExpr constructor (and hence
// not a new TS/Fenel kind); ordinary codecs continue to see the underlying
// registered node.
const DEGRADED_TYPE_PROJECTION_FLAG = "semanticProjectionDegraded";

export function markDegradedTypeProjection(set: SetExpr): SetExpr {
  return {
    ...set,
    [DEGRADED_TYPE_PROJECTION_FLAG]: true,
  } as unknown as SetExpr;
}

/** Descriptor-safe read of the Phase-4b projection flag, including canonical
 * SetExpr composition. A judgment over `A ∪ degraded`, `A \\ degraded`, an
 * arrow containing a degraded slot, etc. is just as under-specified as the
 * degraded leaf itself; wrapping it must never launder the abstention bit. */
export function isDegradedTypeProjection(set: unknown): boolean {
  const seen = new WeakSet<object>();
  const ownData = (value: unknown, key: PropertyKey): unknown => {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  };
  const arrayValues = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) return [];
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor !== undefined && "value" in descriptor) out.push(descriptor.value);
    }
    return out;
  };
  const visitPattern = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    switch (ownData(value, "t")) {
      case "match":
        return visit(ownData(value, "pred"));
      case "seq":
      case "alt":
        return visitPattern(ownData(value, "a"))
          || visitPattern(ownData(value, "b"));
      case "rep":
        return visitPattern(ownData(value, "child"));
      case "group":
        return visitPattern(ownData(value, "child"))
          || visit(ownData(value, "type"));
      default:
        return false;
    }
  };
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (ownData(value, DEGRADED_TYPE_PROJECTION_FLAG) === true) return true;
    const tag = ownData(value, "$tag");
    switch (tag) {
      case "SeCtor":
        return arrayValues(ownData(value, "fields"))
          .some((field) => visit(ownData(field, "set")));
      case "SeMu":
        return visit(ownData(value, "body"));
      case "SePattern":
        return visitPattern(ownData(value, "pattern"));
      case "SeArrow":
        return arrayValues(ownData(value, "params"))
          .some((param) => visit(ownData(param, "set")))
          || visit(ownData(value, "returns"));
      case "SeUnion":
      case "SeIntersect":
        return arrayValues(ownData(value, "branches")).some(visit);
      case "SeDiff":
        return visit(ownData(value, "left")) || visit(ownData(value, "right"));
      case "SeComplement":
        return visit(ownData(value, "inner"));
      default: {
        // The public SetExpr boundaries deliberately dual-read the eleven
        // historical `$`-key envelopes. Inspect those envelopes here too,
        // before a later `setExprToTag` reconstruction can discard a marked
        // descendant. Keep this descriptor-safe and cycle-safe just like the
        // canonical walk above; malformed legacy values remain non-evidence.
        const legacyKey = legacySetEnvelopeKey(value);
        if (legacyKey === null) return false;
        const payload = ownData(value, legacyKey);
        switch (legacyKey) {
          case "$union":
          case "$intersect":
            return arrayValues(payload).some(visit);
          case "$diff": {
            const children = arrayValues(payload);
            return children.length === 2
              && (visit(children[0]) || visit(children[1]));
          }
          case "$complement":
            return visit(payload);
          case "$pattern":
            return visitPattern(payload);
          default:
            return false;
        }
      }
    }
  };
  return visit(set);
}

// ---------------------------------------------------------------------------
// setExprToDollarKey — the explicit legacy/external output codec. The eleven
// forms that have historical `$`-key spellings are reconstructed exactly. The
// three deep formers have no such spelling, so their outer node stays tagged
// while every recursive child is lowered. This function accepts `unknown`,
// performs structural reconstruction only, and never makes a SetExpr decision.
// ---------------------------------------------------------------------------

export function setExprToDollarKey(set: unknown): unknown {
  // signature-substrate Phase 4 slice 3a — the egress REJECTION, and the ONE
  // place non-escape is enforced. A validation rigid IS recognized by
  // `peelSetExpr` (the internal deciders must reason about one), so without
  // this guard the switch below would simply have no `$`-key spelling to emit.
  // The guard runs BEFORE the peel so the failure is named rather than falling
  // out as a missing case, and because every recursive arm re-enters this
  // function, a rigid nested at ANY depth is rejected too. A rigid reaching
  // egress is a validator bug: fail loud.
  if (isRigidValue(set)) {
    throw new TypeError(
      "fenel.validation.rigid: a validation rigid reached the `$`-key egress marshal. "
      + "Rigids may not leave a validation frame; only the fenel.validation.rigid.v1 digest may.",
    );
  }
  const v = peelSetExpr(set);
  if (v === null) return set;
  const normalized = setViewToDollarKey(v);
  return isDegradedTypeProjection(set)
    ? { ...normalized, [DEGRADED_TYPE_PROJECTION_FLAG]: true }
    : normalized;
}

/** Structural reconstruction, separated so every legacy envelope receives
 * the same provenance preservation as the canonical input gateway. Recursive
 * SetExpr slots re-enter that gateway; enum values and predicates stay data. */
function setViewToDollarKey(v: SetExprView): Record<string, unknown> {
  switch (v.kind) {
    case "SeAll": return { $all: true };
    case "SeNone": return { $none: true };
    case "SeEnum": return { $enum: v.values };
    case "SeInterval": return { $interval: v.interval };
    case "SeRef": return { $ref: v.handle };
    case "SePattern": return { $pattern: mapPatternSets(v.pattern, setExprToDollarKey) };
    case "SeWhere": return { $where: v.pred };
    // The three deep formers have no legacy spelling. Keep the outer node
    // tagged while lowering any nested legacy-capable children.
    case "SeCtor": return {
      $tag: "SeCtor",
      ctor: v.ctor,
      fields: v.fields.map((field) => ({
        $tag: "SetCtorField",
        key: field.key,
        wireName: field.wireName,
        set: setExprToDollarKey(field.set),
      })),
    };
    case "SeMu": return { $tag: "SeMu", var: v.var, body: setExprToDollarKey(v.body) };
    case "SeArrow": return {
      $tag: "SeArrow",
      params: v.params.map((param) => ({
        $tag: "SetArrowParam",
        key: param.key,
        wireName: param.wireName,
        set: setExprToDollarKey(param.set),
      })),
      returns: setExprToDollarKey(v.returns),
    };
    // Recursive arms — rebuild with lowered children so a mixed-form tree
    // normalizes through. On an all-`$`-key tree the rebuild is structurally
    // identical (children return verbatim ⇒ `JSON.stringify`-stable).
    case "SeUnion": return { $union: v.branches.map(setExprToDollarKey) };
    case "SeIntersect": return { $intersect: v.branches.map(setExprToDollarKey) };
    case "SeDiff": return { $diff: [setExprToDollarKey(v.left), setExprToDollarKey(v.right)] };
    case "SeComplement": return { $complement: setExprToDollarKey(v.inner) };
    // signature-substrate Phase 4 slice 3a — unreachable (the guard at the top
    // of the public codec already threw), written so the exhaustive view switch
    // states the rejection rather than falling off the end.
    case "SeRigid": throw new TypeError(
      "fenel.validation.rigid: a validation rigid has no `$`-key spelling.",
    );
  }
}

// ---------------------------------------------------------------------------
// setExprToTag — the canonical input gateway. It accepts canonical or exact
// legacy boundary input over `unknown`, rejects malformed values, and rebuilds
// the complete recursive tree through `buildSetExpr`. Internal callers receive
// one registered 15-case representation. The orthogonal degraded-projection
// provenance bit is retained across this structural normalization.
// ---------------------------------------------------------------------------

export function setExprToTag(set: unknown, options?: SetExprToTagOptions): SetExpr {
  // signature-substrate Phase 4 slice 3a — the provenance boundary (see
  // `SetExprToTagOptions`). This gateway sanitizes UNTRUSTED input for the
  // query API, the permission-policy store, and the policy evaluator, so a
  // caller-supplied rigid is rejected by default; the engine-internal decider
  // seams opt in. Nested rigids are covered by the recursive arms below, which
  // re-enter this function with the same options.
  if (options?.admitValidationRigid !== true && isRigidValue(set)) {
    throw new TypeError(
      "fenel.validation.rigid: a validation rigid reached the SetExpr boundary gateway from an "
      + "untrusted or non-validation caller. Rigids are minted only inside a validation frame; "
      + "pass { admitValidationRigid: true } from an engine-internal decider seam if this value "
      + "genuinely came from one.",
    );
  }
  const v = peelSetExpr(set);
  if (v === null) throw new TypeError("Expected a SetExpr value at the SetExpr boundary");
  // Canonicalization is structural, but the projection marker is semantic
  // provenance carried alongside that structure. Preserve it at every
  // normalization boundary so marshal/env/ref-resolution paths cannot turn a
  // deliberately lossy suggestion into proof-bearing SetExpr evidence.
  const degraded = isDegradedTypeProjection(set);
  const preserveProjectionStatus = (normalized: SetExpr): SetExpr =>
    degraded ? markDegradedTypeProjection(normalized) : normalized;
  switch (v.kind) {
    case "SeAll": return preserveProjectionStatus(buildSetExpr.all());
    case "SeNone": return preserveProjectionStatus(buildSetExpr.none());
    case "SeEnum": return preserveProjectionStatus(buildSetExpr.enum(v.values));
    case "SeInterval": return preserveProjectionStatus(buildSetExpr.interval(v.interval));
    case "SeRef": return preserveProjectionStatus(buildSetExpr.ref(v.handle));
    // The point-free `mapPatternSets(v.pattern, setExprToTag)` dropped `options`
    // here, so an engine-internal opt-in call over a pattern-carried rigid threw
    // instead of canonicalizing. It never LEAKED (the default is reject), but it
    // over-rejected — the mirror of the leak, and just as wrong.
    case "SePattern": return preserveProjectionStatus(
      buildSetExpr.pattern(mapPatternSets(v.pattern, (child) => setExprToTag(child, options))),
    );
    case "SeWhere": return preserveProjectionStatus(buildSetExpr.where(v.pred));
    case "SeCtor": return preserveProjectionStatus(buildSetExpr.ctor(
      v.ctor,
      v.fields.map((field) => buildSetExpr.ctorField(field.key, field.wireName, setExprToTag(field.set, options))),
    ));
    case "SeMu": return preserveProjectionStatus(buildSetExpr.mu(v.var, setExprToTag(v.body, options)));
    case "SeArrow": return preserveProjectionStatus(buildSetExpr.arrow(
      v.params.map((param) => buildSetExpr.arrowParam(param.key, param.wireName, setExprToTag(param.set, options))),
      setExprToTag(v.returns, options),
    ));
    case "SeUnion": return preserveProjectionStatus(
      buildSetExpr.union(v.branches.map((child) => setExprToTag(child, options))),
    );
    case "SeIntersect": return preserveProjectionStatus(
      buildSetExpr.intersect(v.branches.map((child) => setExprToTag(child, options))),
    );
    case "SeDiff": return preserveProjectionStatus(
      buildSetExpr.diff(setExprToTag(v.left, options), setExprToTag(v.right, options)),
    );
    case "SeComplement": return preserveProjectionStatus(
      buildSetExpr.complement(setExprToTag(v.inner, options)),
    );
    // signature-substrate Phase 4 slice 3a — canonicalize a rigid through the
    // same descriptor-safe rebuild as every other node. The rebuild is what
    // lets the internal decider entries (set-algebra.ts's `isSubset` /
    // `contains` / `decideEmpty`, all of which normalize through this gateway)
    // reason about a rigid at all. Egress stays closed at
    // `setExprToDollarKey`, not here.
    case "SeRigid": return preserveProjectionStatus(
      buildSetExpr.rigid(v.scopeToken, v.ordinal, v.rigidKind),
    );
  }
}

/** @deprecated `typeToSetExpr` now emits SetExpr directly. Use
 * `setExprToTag` for structural boundary canonicalization. */
export function liftTypeSetMarkers(set: unknown): SetExpr {
  return setExprToTag(set);
}

export { assertJsonAuthoringValue } from "./authoring/json-value";

/** JSON boundary grammar for a Pattern repetition maximum: a finite number or
 * the schema-local token "unbounded". Host Pattern algorithms continue to use
 * Infinity. In particular neither null nor -1 acquires an unbounded meaning.
 * This codec is called only for declared SetExpr/type slots, never as a generic
 * JSON replacer over arbitrary records or expression patterns. */
export function setExprToJsonWire(set: unknown): unknown {
  const canonical = setExprToTag(set);
  function pattern(value: PatternOf<SetExpr>): unknown {
    switch (value.t) {
      case "rep": return { ...value, child: pattern(value.child), max: value.max === Infinity ? "unbounded" : value.max };
      case "seq": case "alt": return { ...value, a: pattern(value.a), b: pattern(value.b) };
      case "group": return { ...value, child: pattern(value.child), ...(value.type === undefined ? {} : { type: encode(value.type) }) };
      case "match": return { ...value, pred: encode(value.pred) };
      default: return value;
    }
  }
  function encode(value: SetExpr): unknown {
    switch (value.$tag) {
      case "SeRigid": throw new TypeError("A validation rigid cannot be persisted as an authored set.");
      case "SePattern": return { ...value, pattern: pattern(value.pattern) };
      case "SeUnion": case "SeIntersect": return { ...value, branches: value.branches.map(encode) };
      case "SeDiff": return { ...value, left: encode(value.left), right: encode(value.right) };
      case "SeComplement": return { ...value, inner: encode(value.inner) };
      case "SeMu": return { ...value, body: encode(value.body) };
      case "SeCtor": return { ...value, fields: value.fields.map((field) => ({ ...field, set: encode(field.set) })) };
      case "SeArrow": return { ...value, params: value.params.map((param) => ({ ...param, set: encode(param.set) })), returns: encode(value.returns) };
      default: return value;
    }
  }
  return encode(canonical);
}

/** Type-schema-directed JSON projection. Field metadata and expression payloads
 * remain opaque; the boundary only visits the type/set slots of FenelType. */
export function fenelTypeToJsonWire(type: import("./types").FenelType): unknown {
  if (!type || typeof type !== "object") return type;
  const fields = (values: import("./types").FieldDef[]) => values.map((field) => ({ ...field, type: fenelTypeToJsonWire(field.type) }));
  if ("$refined" in type) return { ...type, $refined: { ...type.$refined, base: fenelTypeToJsonWire(type.$refined.base), set: setExprToJsonWire(type.$refined.set) } };
  if ("$map" in type) return { ...type, $map: { ...type.$map, keys: setExprToJsonWire(type.$map.keys), values: fenelTypeToJsonWire(type.$map.values) } };
  if ("$record" in type) return { ...type, $record: { ...type.$record, fields: fields(type.$record.fields) } };
  if ("$variant" in type) return { ...type, $variant: { ...type.$variant, cases: type.$variant.cases.map((c) => ({ ...c, ...(c.fields ? { fields: fields(c.fields) } : {}) })) } };
  if ("$arrow" in type) return { ...type, $arrow: { ...type.$arrow, params: fields(type.$arrow.params), returns: fenelTypeToJsonWire(type.$arrow.returns) } };
  if ("$tuple" in type) return { ...type, $tuple: type.$tuple.map(fenelTypeToJsonWire) };
  if ("$union" in type) return { ...type, $union: type.$union.map(fenelTypeToJsonWire) };
  if ("$intersect" in type) return { ...type, $intersect: type.$intersect.map(fenelTypeToJsonWire) };
  if ("$complement" in type) return { ...type, $complement: fenelTypeToJsonWire(type.$complement) };
  if ("$mu" in type) return { ...type, $mu: { ...type.$mu, body: fenelTypeToJsonWire(type.$mu.body) } };
  if ("$tagged" in type) return { ...type, $tagged: { ...type.$tagged, value: fenelTypeToJsonWire(type.$tagged.value), phantom: fenelTypeToJsonWire(type.$tagged.phantom) } };
  if ("$opaque" in type && type.$opaque.pure) return { ...type, $opaque: { ...type.$opaque, pure: fenelTypeToJsonWire(type.$opaque.pure) } };
  return type;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("set-marker") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// ---------------------------------------------------------------------------
// decide-substrate Phase 4T Step W2 — the CHARACTER-TOTAL predicate fragment.
//
// A `Pattern`'s per-element predicates are decided two different ways depending
// on which face you enter through:
//
//   • direct membership  — `contains(pred, value)`, deep structural equality and
//     JavaScript UTF-16 LEXICAL ordering on strings;
//   • the pattern walk    — `dispatchedPatternMember` lowers every element to a
//     CODE POINT (`predValueToCodePoint`) and reasons numerically.
//
// Those two are NOT equivalent in general, and where they disagree the pattern
// face can return a definite verdict the direct face refutes. Measured:
// `Complement(SeEnum([120]))` — the NUMBER 120 — contains the string `"x"`
// directly (deep-eq says `"x" !== 120`) but the lowering maps both to code point
// 120, so the pattern face answers the opposite. Astral characters diverge too
// (UTF-16 lexical order vs code-point order), and the marshaller's
// `JSON.stringify` predicate dedup collapses `"x"` with `new String("x")`.
//
// This predicate is the SUFFICIENT CONDITION under which the two faces provably
// agree: the Boolean closure of `SeAll` / `SeNone` / `SeEnum` / `SeInterval`
// whose every value and endpoint is a single-UTF-16-code-unit primitive string
// (so code unit == code point, lexical order == code-point order, and no
// non-string can be conflated with a character). Everything else — a number in
// an enum, an astral or multi-char string, a boxed String, an expression-valued
// endpoint, a nested name/pattern/where — is OUTSIDE, and callers must abstain.
//
// It lives here, not beside its consumers, because `format-presets.ts` needs it
// at REGISTRATION time and already imports this module: reaching into the
// dispatch layer from a spec/registration file changes module eval order and
// breaks the engine bootstrap (measured, W2).
function charTotalAtom(v: unknown): boolean {
  if (typeof v !== "string" || v.length !== 1) return false;
  const c = v.charCodeAt(0);
  // Exclude lone surrogates: a single code unit in D800-DFFF is half of an
  // astral pair, where the two orderings part company.
  return !(c >= 0xd800 && c <= 0xdfff);
}

function charTotalBound(mb: unknown): boolean {
  if (!mb || typeof mb !== "object") return false;
  const m = mb as { $tag?: unknown; _0?: unknown };
  if (m.$tag === "Nothing") return true;              // an open end is fine
  if (m.$tag !== "Just") return false;
  const b = m._0 as { value?: unknown } | undefined;
  return !!b && typeof b === "object" && charTotalAtom(b.value);
}

/** True when `se` decides identically through direct membership and through the
 *  pattern walk's code-point lowering — see the note above. Never throws: any
 *  shape it cannot normalize or recognize is reported as OUTSIDE the fragment,
 *  which is the abstaining direction for every caller. */
export function setExprIsCharTotal(se: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  let t: ({ $tag?: string } & Record<string, unknown>) | undefined;
  try {
    t = setExprToTag(se as SetExpr) as unknown as { $tag?: string } & Record<string, unknown>;
  } catch {
    return false;
  }
  if (!t || typeof t !== "object" || typeof t.$tag !== "string") return false;
  switch (t.$tag) {
    case "SeAll":
    case "SeNone":
      return true;
    case "SeEnum": {
      const vs = t.values;
      return Array.isArray(vs) && vs.every(charTotalAtom);
    }
    case "SeInterval": {
      const iv = t.interval as { lo?: unknown; hi?: unknown } | undefined;
      if (!iv || typeof iv !== "object") return false;
      return charTotalBound(iv.lo) && charTotalBound(iv.hi);
    }
    case "SeUnion":
    case "SeIntersect": {
      const bs = t.branches;
      return Array.isArray(bs) && bs.every((b) => setExprIsCharTotal(b, depth + 1));
    }
    case "SeDiff":
      return setExprIsCharTotal(t.left, depth + 1) && setExprIsCharTotal(t.right, depth + 1);
    case "SeComplement":
      return setExprIsCharTotal(t.inner, depth + 1);
    default:
      return false;
  }
}

/** True when every predicate the pattern walk could consult is character-total
 *  AND the pattern carries no TYPED GROUP. A typed group re-enters `contains`
 *  on a CAPTURED substring, and capture attribution (`activeGroups`) picks a
 *  greedy left branch that need not be the accepting derivative path — so the
 *  type constraint can be checked against the wrong substring and yield a
 *  definite verdict for a shape that does not actually match that way. Until
 *  captures are attributed along the accepting path, a typed group means the
 *  whole membership answer is uncertifiable. Never throws. */
export function patternPredsAreCharTotal(pattern: unknown): boolean {
  const normalized = normalizeSetPattern(pattern);
  if (normalized === null) return false;
  const stack: unknown[] = [normalized];
  let seen = 0;
  while (stack.length > 0) {
    if (++seen > 10000) return false;                 // pathological/cyclic guard
    const p = stack.pop();
    if (!p || typeof p !== "object") continue;
    const n = p as { t?: unknown; pred?: unknown; type?: unknown; a?: unknown; b?: unknown; child?: unknown };
    if (n.t === "match") {
      if (!setExprIsCharTotal(n.pred)) return false;
    }
    if (n.t === "group" && n.type !== undefined && n.type !== null) return false;
    if (n.a !== undefined) stack.push(n.a);
    if (n.b !== undefined) stack.push(n.b);
    if (n.child !== undefined) stack.push(n.child);
  }
  return true;
}

// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_set_marker from "./set-marker";
import { registerEngineModule as __reg_set_marker } from "./engine-require";
__reg_set_marker("set-marker", __self_set_marker);
