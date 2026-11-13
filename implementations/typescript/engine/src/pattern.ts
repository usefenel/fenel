// ---------------------------------------------------------------------------
// Generic Pattern Engine — regex over List<a> for any element type a
//
// Each "match" node carries a SetExpr predicate over the element type. The
// algebra is otherwise identical to regex over List<Char>:
//
//   match(p)            single element satisfying p
//   seq(a, b)           concatenation
//   alt(a, b)           alternation (union of languages)
//   rep(c, min, max)    bounded/unbounded repetition
//   eps                 empty sequence
//   empty               failure (matches nothing)
//
// This is the value-level analog of the regex passes (regex-shim.ts +
// fenel/modules/engine/regex-*.fenel), generalized so that
// patterns can describe sequences over arbitrary element types — events,
// tokens, integers, records — not just code points.
//
// Algorithms are Brzozowski derivatives:
//   nullable(p)         — does p match the empty sequence?
//   deriv(p, x, ctx)    — pattern matching what's left after consuming x
//   patternMatch(p, xs, ctx)   — does the sequence xs match p?
//
// The match() predicate is evaluated via the existing contains() machinery,
// so the full SetExpr algebra (interval, enum, $pattern for chars, $where
// for record fields, $named, intersect/union/diff/complement) is available.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { SetExpr, Pattern } from "./types";
import type { EvaluateContext } from "./json-logic";
import { contains, isJustTrue } from "./set-algebra";
// 3b-2 — route SetExpr producer through buildSetExpr
import { peelSetExpr, buildSetExpr } from "./set-marker";
import { Nothing, type Maybe } from "./type-foundation";
import { peelMaybeValue } from "./maybe-value";

// ---------------------------------------------------------------------------
// AST is defined in types.ts (mutually recursive with SetExpr).
// Re-export for convenience.
// ---------------------------------------------------------------------------

export type { Pattern };

// ---------------------------------------------------------------------------
// Smart constructors — simplify on the fly so the AST stays small
// ---------------------------------------------------------------------------

export const empty: Pattern = { t: "empty" };
export const eps: Pattern = { t: "eps" };

export function match(pred: SetExpr): Pattern {
  return { t: "match", pred };
}

function mkSeq(a: Pattern, b: Pattern): Pattern {
  if (a.t === "empty" || b.t === "empty") return empty;
  if (a.t === "eps") return b;
  if (b.t === "eps") return a;
  return { t: "seq", a, b };
}

function mkAlt(a: Pattern, b: Pattern): Pattern {
  if (a.t === "empty") return b;
  if (b.t === "empty") return a;
  if (a.t === "eps" && b.t === "eps") return eps;
  return { t: "alt", a, b };
}

/** seq(a, b, c, ...) = a then b then c then ... */
export function seq(...parts: Pattern[]): Pattern {
  if (parts.length === 0) return eps;
  return parts.reduce((acc, p) => mkSeq(acc, p));
}

/** alt(a, b, c, ...) = a OR b OR c OR ... */
export function alt(...parts: Pattern[]): Pattern {
  if (parts.length === 0) return empty;
  return parts.reduce((acc, p) => mkAlt(acc, p));
}

/** Bounded repetition: child appears between min and max times (inclusive). */
export function rep(child: Pattern, min = 0, max: number = Infinity): Pattern {
  if (min < 0) min = 0;
  if (max < min) return empty;
  if (child.t === "empty") return min === 0 ? eps : empty;
  return { t: "rep", child, min, max };
}

/** Kleene star — zero or more. */
export const star = (p: Pattern): Pattern => rep(p, 0, Infinity);

/** Plus — one or more. */
export const plus = (p: Pattern): Pattern => rep(p, 1, Infinity);

/** Optional — zero or one. */
export const optional = (p: Pattern): Pattern => rep(p, 0, 1);

/** Capture group — when the pattern matches, the subsequence consumed
 *  inside `child` is bound to `name`. Optional `type` is a SetExpr the
 *  captured value (joined as a string for Char sequences) must satisfy. */
export function group(name: string, child: Pattern, type?: SetExpr): Pattern {
  if (child.t === "empty") return empty;
  return type === undefined
    ? { t: "group", name, child }
    : { t: "group", name, child, type };
}

// ---------------------------------------------------------------------------
// Nullability — does the pattern match the empty sequence?
// ---------------------------------------------------------------------------

export function nullable(p: Pattern): boolean {
  switch (p.t) {
    case "eps":
      return true;
    case "empty":
    case "match":
      return false;
    case "seq":
      return nullable(p.a) && nullable(p.b);
    case "alt":
      return nullable(p.a) || nullable(p.b);
    case "rep":
      return p.min === 0 || nullable(p.child);
    case "group":
      return nullable(p.child);
  }
}

// ---------------------------------------------------------------------------
// Derivative — pattern remaining after consuming one element
// ---------------------------------------------------------------------------

/**
 * Compute the derivative of pattern `p` with respect to element `value`.
 * The result is a pattern that matches the rest of the input sequence.
 *
 *   ctx — context for $where predicates that reference outer variables
 *         (e.g. cross-element constraints). For most patterns, omit.
 */
export function deriv(
  p: Pattern,
  value: unknown,
  ctx?: Record<string, unknown>,
): Pattern {
  switch (p.t) {
    case "empty":
    case "eps":
      return empty;
    case "match":
      // `contains` returns MaybeBool (Phase 4); the pattern engine wants
      // a binary decision — collapse with default false so undecidable
      // predicates abort the match-path (conservative-false posture,
      // matching pre-Phase 4 behaviour).
      return isJustTrue(contains(p.pred, value, null, ctx)) ? eps : empty;
    case "seq": {
      const da = mkSeq(deriv(p.a, value, ctx), p.b);
      return nullable(p.a) ? mkAlt(da, deriv(p.b, value, ctx)) : da;
    }
    case "alt":
      return mkAlt(deriv(p.a, value, ctx), deriv(p.b, value, ctx));
    case "rep": {
      if (p.max === 0) return empty;
      const next: Pattern = {
        t: "rep",
        child: p.child,
        min: Math.max(0, p.min - 1),
        max: p.max === Infinity ? Infinity : p.max - 1,
      };
      return mkSeq(deriv(p.child, value, ctx), next);
    }
    case "group": {
      // Groups are transparent to derivative — they only matter for capture
      // extraction (see extractCaptures). We preserve the group wrapper
      // around the derivative so the structure stays for later analysis.
      const dc = deriv(p.child, value, ctx);
      if (dc.t === "empty") return empty;
      return p.type === undefined
        ? { t: "group", name: p.name, child: dc }
        : { t: "group", name: p.name, child: dc, type: p.type };
    }
  }
}

// ---------------------------------------------------------------------------
// Sequence matching — does the input sequence match the pattern?
// ---------------------------------------------------------------------------

export function patternMatch(
  p: Pattern,
  values: readonly unknown[],
  ctx?: Record<string, unknown>,
): boolean {
  let cur = p;
  for (const v of values) {
    cur = deriv(cur, v, ctx);
    if (cur.t === "empty") return false;
  }
  return nullable(cur);
}

/**
 * Pattern language subset — does L(a) ⊆ L(b)?
 *
 * regex-derivative-to-fenel Phase 1 (Slice A, shape B) — thin marshal-boundary
 * shim. The decision logic (the generic 2^N atom-enumeration Brzozowski walk,
 * the co-inductive visited memo, the 16-pred cap, atom satisfiability, and the
 * atom derivative) lives in `fenel/modules/engine/regex-containment.fenel`
 * (`engine:decidePatternSubset`). The shim collects the distinct predicates,
 * pre-computes the $all / proven-subset facts TS-side via `isSubset`, and
 * marshals (a, b) to the Fenel `Pat` ADT (the 21.6.2 / set-algebra 2a/2b
 * single-path discipline — the Fenel body is the sole decider, not a fallback).
 */
export function patternSubset(a: Pattern, b: Pattern, evalCtx?: EvaluateContext): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPatternSubset } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPatternSubset(a, b, evalCtx);
}

// regex-derivative-to-fenel Phase 1 (Slice A, shape B) — `isAtomSatisfiable`,
// `collectPreds`, and `derivAtom` (the 2^N atom-enumeration internals) were
// ported to `fenel/modules/engine/regex-containment.fenel` and DELETED here;
// the Fenel body is the sole decision path (no TS fallback). The pred-fact
// pre-compute (`isAtomSatisfiable`'s $all / `isSubset` implication check) now
// happens in the dispatch shim's `buildPatternPredInfo`
// (engine-bodies-dispatch.ts), TS-side, feeding the Fenel walk plain data.

/**
 * Pattern language disjointness — does L(a) ∩ L(b) = ∅?
 *
 * regex-derivative-to-fenel Phase 1 (Slice A, shape B) — thin marshal-boundary
 * shim (mirror of `patternSubset`). The decision logic — the same atom-based
 * Brzozowski walk with the both-nullable terminal, the empty-precheck-before-
 * memo order, and the dead-branch (db empty) skip — lives in
 * `engine:decidePatternDisjoint` (`regex-containment.fenel`).
 */
export function patternDisjoint(a: Pattern, b: Pattern, evalCtx?: EvaluateContext): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPatternDisjoint } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPatternDisjoint(a, b, evalCtx);
}

/**
 * Find the longest prefix of `values` that the pattern accepts. Returns the
 * length of that prefix (0 if the pattern doesn't match the empty prefix).
 *
 * Useful for streaming consumers (e.g. funnel evaluators) that want to know
 * "how far did we get?" rather than just yes/no.
 */
export function longestMatch(
  p: Pattern,
  values: readonly unknown[],
  ctx?: Record<string, unknown>,
): number {
  let cur = p;
  let lastAccepted = nullable(cur) ? 0 : -1;
  for (let i = 0; i < values.length; i++) {
    cur = deriv(cur, values[i], ctx);
    if (cur.t === "empty") break;
    if (nullable(cur)) lastAccepted = i + 1;
  }
  return Math.max(0, lastAccepted);
}

// ---------------------------------------------------------------------------
// First set + forced prefix — "what could / must come next?"
//
// These power input-mask widgets: after each accepted keystroke, the widget
// asks what the residual pattern allows next. If exactly one specific
// character is forced (e.g. "/" after "12" in dd/MM/yyyy), the widget
// auto-inserts it. If multiple characters are legal, the widget waits for
// the user to type. firstSet is the underlying primitive; forcedNextLiteral
// and forcedPrefix are the convenience wrappers a UI typically calls.
// ---------------------------------------------------------------------------

/**
 * Predicates that could fire on the next consumed element. For `seq(a, b)`,
 * includes b's first set when a is nullable (so the next element could
 * already belong to b). Deduplicated by structural identity.
 */
export function firstSet(p: Pattern): SetExpr[] {
  const out: SetExpr[] = [];
  const seen = new Set<string>();
  function walk(p: Pattern): void {
    switch (p.t) {
      case "empty":
      case "eps":
        return;
      case "match": {
        const k = JSON.stringify(p.pred);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(p.pred);
        }
        return;
      }
      case "seq":
        walk(p.a);
        if (nullable(p.a)) walk(p.b);
        return;
      case "alt":
        walk(p.a);
        walk(p.b);
        return;
      case "rep":
        if (p.max > 0) walk(p.child);
        return;
      case "group":
        walk(p.child);
        return;
    }
  }
  walk(p);
  return out;
}

/**
 * If the pattern admits exactly one possible next character (a single
 * forced literal — typically a separator like "/" or ":"), return it.
 * Otherwise null.
 */
export function forcedNextLiteral(p: Pattern): string | null {
  // B3: the existing Pattern observations enter the Fenel hint owner; only
  // the physical Maybe -> nullable host API remains at this boundary.
  // GLOBAL_ONLY: this pure standard hint reads no account or reader authority.
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const canEnd = nullable(p);
  const selected = peelMaybeValue(dispatchEngineBody("engine:patternForcedPredicate", [canEnd, firstSet(p)]) as Maybe<SetExpr>);
  if (selected === null) return null;
  // B3: snapshot admitted enum carriers through the canonical recognizer;
  // other predicate shapes use the existing none marker in this enum fragment.
  const view = peelSetExpr(selected);
  const predicate = view?.kind === "SeEnum" ? buildSetExpr.enum(view.values) : buildSetExpr.none();
  return peelMaybeValue(dispatchEngineBody("engine:patternForcedNextLiteral", [canEnd, [predicate]]) as Maybe<string>);
}

/**
 * The longest run of consecutively-forced literal characters starting from
 * the current pattern state. Used by a masking widget to auto-insert
 * separators all at once when more than one is determined (e.g. "://"
 * after "https").
 */
export function forcedPrefix(p: Pattern): string {
  let result = "";
  let cur = p;
  while (true) {
    const lit = forcedNextLiteral(cur);
    if (lit === null) break;
    result += lit;
    cur = deriv(cur, lit);
    if (cur.t === "empty") break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Flat decomposition — split a Pattern that is structurally a left-leaning
// `seq` of literals and groups into a list of segments. Used by segmented-
// input widgets ("one input per part") to know where the boundaries are.
//
// A "literal" segment is a maximal run of `match({$enum: [singleChar]})`
// nodes — the fixed separators between groups, like "/" or ":".
// A "group" segment is a top-level named `group` node.
//
// Patterns with `alt` or `rep` at the top level can't be cleanly flattened
// to a fixed sequence — those return null. Optional wrappers around literals
// or groups (`optional(seq("/", group(...)))` etc.) are left untouched and
// surface as a single "group"-shaped segment whose Pattern is the optional;
// the widget can decide whether to render it as a hide-when-empty input.
// ---------------------------------------------------------------------------

export type FlatSegment =
  | { kind: "literal"; text: string; optional: boolean }
  | { kind: "group"; name: string; pattern: Pattern; optional: boolean };

/**
 * Decompose a flat-seq pattern into ordered segments. Returns null if the
 * top-level structure isn't a flat sequence of literals + groups (e.g. has
 * `alt` or `rep` at the top, can't be rendered as a fixed segmented input).
 *
 * Both literals and groups inherit `optional: true` when they sit inside an
 * `optional(...)` wrapper, so a separator like "-" between zip5 and zip4
 * can be hidden by the widget when its trailing group is empty.
 */
export function decomposeFlatPattern(p: Pattern): FlatSegment[] | null {
  const out: FlatSegment[] = [];
  let literalRun = "";
  let literalRunOptional = false;
  function flushLiteral() {
    if (literalRun) {
      out.push({ kind: "literal", text: literalRun, optional: literalRunOptional });
      literalRun = "";
      literalRunOptional = false;
    }
  }
  function walk(p: Pattern, isOptional: boolean): boolean {
    switch (p.t) {
      case "eps":
      case "empty":
        return true;
      case "match": {
        // single-char literal? (singleton $enum)
        // 3b-0: route through the canonical dual-read recognizer.
        const pv = peelSetExpr(p.pred);
        if (
          pv?.kind === "SeEnum" && Array.isArray(pv.values) &&
          pv.values.length === 1 && typeof pv.values[0] === "string"
        ) {
          // If this literal's optional context differs from the run we've
          // been accumulating, flush first so each segment is uniform.
          if (literalRun && literalRunOptional !== isOptional) flushLiteral();
          literalRun += pv.values[0] as string;
          literalRunOptional = isOptional;
          return true;
        }
        return false; // unnamed non-literal match — not a flat structure
      }
      case "seq":
        return walk(p.a, isOptional) && walk(p.b, isOptional);
      case "group":
        flushLiteral();
        out.push({ kind: "group", name: p.name, pattern: p.child, optional: isOptional });
        return true;
      case "rep":
        // Treat optional(...) (rep with 0..1) as a transparent wrapper; for
        // a single-child rep with bounds 0..1 of a literal-or-group seq,
        // we propagate isOptional. Other reps aren't flat-decomposable.
        if (p.min === 0 && p.max === 1) {
          return walk(p.child, true);
        }
        return false;
      case "alt":
        return false; // not a flat sequence
    }
  }
  if (!walk(p, false)) return null;
  flushLiteral();
  return out;
}

// ---------------------------------------------------------------------------
// Pattern → FenelType lowering — the keystone bridge that turns a Pattern
// (with named groups) into a structural FenelType describing the values
// matching the pattern. Two views, one type:
//
//   - The Pattern view is the regex-shaped surface: `seq(group("scheme", ...),
//     "://", group("host", ...))`. Good for authoring, masking, parsing.
//   - The FenelType view is the structural target: `{$record: {fields: [
//     {name: "scheme", type: ...}, {name: "host", type: ...}
//     ]}}`. Good for validation, propagation, derivation.
//
// patternToType makes the equivalence explicit so consumers can ask "what
// type are the values matching this pattern?" without re-implementing the
// walk.
//
// Rules:
//   - Pattern with no groups → refined String (matches the pattern).
//   - Pattern with groups → record whose fields are the group names.
//   - Group inside a rep (non-optional) → field type wrapped in $list.
//   - Group inside an optional (rep 0..1) → field stays scalar (a future
//     pass could mark it $maybe; for now we record presence-or-absence
//     at validation time, not at type level).
//   - Group with explicit `type: SetExpr` → field type refined by that set.
//   - alt with grouped branches → fields from both branches merged into the
//     record. Tagged-variant detection (matching constructor names → $variant)
//     is a future enhancement; today the result is "all fields, possibly
//     not all populated at runtime".
//   - Same group name appearing both list-wrapped and bare (e.g. URL `kv`
//     repeated under a star but also outside it): list wins, since one
//     list-context occurrence implies repetition is possible.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef } from "./types";

/** Build the FenelType describing values that match `p`. */
export function patternToType(p: Pattern): FenelType {
  if (!hasGroups(p)) {
    return {
      $refined: {
        base: { $ref: "String" },
        set: buildSetExpr.pattern(p),
      },
    };
  }
  const entries = walkForFields(p, { inRep: false });
  const fields: FieldDef[] = [];
  const byName = new Map<string, number>();
  for (const e of entries) {
    const existingIdx = byName.get(e.name);
    if (existingIdx === undefined) {
      byName.set(e.name, fields.length);
      fields.push({ name: e.name, label: Nothing, type: e.type, meta: {}, ui: Nothing });
    } else {
      const existing = fields[existingIdx]!;
      // List wins on collision — if either occurrence is list-typed, keep that.
      if (isListType(e.type) && !isListType(existing.type)) {
        existing.type = e.type;
      }
      // Otherwise leave existing as-is.
    }
  }
  return { $record: { fields } };
}

/** Does the pattern contain any group, anywhere? */
function hasGroups(p: Pattern): boolean {
  switch (p.t) {
    case "group":
      return true;
    case "seq":
    case "alt":
      return hasGroups(p.a) || hasGroups(p.b);
    case "rep":
      return hasGroups(p.child);
    default:
      return false;
  }
}

function isListType(t: FenelType): boolean {
  if (typeof t !== "object" || t === null) return false;
  return declaredListElement(t) !== null;
}

/** Pattern conversion emits declarations. Use the shared source-authoring
 * lens before the registry supplies semantic field identities. */
function declaredListElement(t: FenelType): { elem: FenelType } | null {
  const { dispatchedPeelListForAuthoring } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPeelListForAuthoring(t);
}

type WalkCtx = { inRep: boolean };

/** Recurse through the pattern collecting (name, type) pairs for each
 *  group. The `inRep` flag tracks list-context wrapping. */
function walkForFields(
  p: Pattern,
  ctx: WalkCtx,
): { name: string; type: FenelType }[] {
  switch (p.t) {
    case "empty":
    case "eps":
    case "match":
      return [];
    case "seq":
      return [...walkForFields(p.a, ctx), ...walkForFields(p.b, ctx)];
    case "alt":
      // v1: merge fields from both branches. Future: detect tagged variants
      // and produce `$variant` instead.
      return [...walkForFields(p.a, ctx), ...walkForFields(p.b, ctx)];
    case "rep": {
      const isOptional = p.min === 0 && p.max === 1;
      // Optional doesn't list-wrap (one or zero of). Anything else does.
      const newCtx: WalkCtx = isOptional ? ctx : { inRep: true };
      return walkForFields(p.child, newCtx);
    }
    case "group": {
      let type: FenelType = patternToType(p.child);
      if (p.type) {
        type = { $refined: { base: type, set: p.type } };
      }
      if (ctx.inRep) {
        // Inlined `List(type)` to avoid an import cycle —
        // type-foundation.ts → regex-shim.ts → pattern.ts.
        type = {
          $opaque: {
            name: "List",
            pure: {
              $mu: {
                var: "X",
                body: {
                  $variant: {
                    cases: [
                      { name: "Nil", label: Nothing },
                      {
                        name: "Cons",
                        label: Nothing,
                        fields: [
                          { name: "head", label: Nothing, type, ui: Nothing, meta: {} },
                          { name: "tail", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        };
      }
      return [{ name: p.name, type }];
    }
  }
}

// ---------------------------------------------------------------------------
// Typed parse — turns a string matching the pattern into a value at the
// type produced by `patternToType`. Direct recursive walk:
//
//   - `match`: consume one char into the surrounding char buffer.
//   - `seq(a, b)`: parse a, then b; merge the resulting field maps. Same
//     name on both sides means concat into a list (for rep/star nesting).
//   - `alt(a, b)`: try a, fall back to b on failure with state rolled back.
//   - `rep`: optional (0..1) is a thin pass-through; non-optional rep
//     produces list-mode merge across iterations (each item's fields become
//     list elements).
//   - `group(name, child)`: opens a fresh char buffer, parses `child`, then
//     emits a field named `name`. The field's value is the inner record if
//     the inner had nested groups, else the captured chars.
//
// Returns null when the string doesn't fully match. When it does match,
// the result is type-aligned via `applyTypeDefaults` so absent optional
// fields surface as "" / [] / {} matching `patternToType(p)`.
// ---------------------------------------------------------------------------

/** Parse `value` against `p`. Returns the typed structural value (matching
 *  `patternToType(p)`) on success, or `null` when the input doesn't match. */
export function parse(p: Pattern, value: string): unknown | null {
  if (!hasGroups(p)) {
    return patternMatch(p, [...value]) ? value : null;
  }
  const ctx: ParseCtx = { value: [...value], pos: 0, charBuffer: [] };
  const raw = parseStructured(p, ctx);
  if (raw === null) return null;
  if (ctx.pos !== ctx.value.length) return null;
  return applyTypeDefaults(patternToType(p), raw);
}

type ParseCtx = {
  value: readonly string[];
  pos: number;
  charBuffer: string[];
};

/** Recursive walk. Returns a record (possibly empty) of group contributions,
 *  or null on match failure. Side-effect: pushes consumed chars into
 *  `ctx.charBuffer` so the surrounding group can collect them. */
function parseStructured(p: Pattern, ctx: ParseCtx): Record<string, unknown> | null {
  switch (p.t) {
    case "empty":
      return null;
    case "eps":
      return {};
    case "match": {
      if (ctx.pos >= ctx.value.length) return null;
      const ch = ctx.value[ctx.pos]!;
      // MaybeBool collapse (Phase 4) — only consume on a positive proof.
      if (!isJustTrue(contains(p.pred, ch, null))) return null;
      ctx.pos++;
      ctx.charBuffer.push(ch);
      return {};
    }
    case "seq": {
      const a = parseStructured(p.a, ctx);
      if (a === null) return null;
      const b = parseStructured(p.b, ctx);
      if (b === null) return null;
      return mergeRecord(a, b);
    }
    case "alt": {
      const savedPos = ctx.pos;
      const savedBuf = ctx.charBuffer.length;
      const a = parseStructured(p.a, ctx);
      if (a !== null) return a;
      ctx.pos = savedPos;
      ctx.charBuffer.length = savedBuf;
      return parseStructured(p.b, ctx);
    }
    case "rep": {
      // Optional — pass through, no list wrapping.
      if (p.min === 0 && p.max === 1) {
        const savedPos = ctx.pos;
        const savedBuf = ctx.charBuffer.length;
        const item = parseStructured(p.child, ctx);
        if (item === null) {
          ctx.pos = savedPos;
          ctx.charBuffer.length = savedBuf;
          return {};
        }
        return item;
      }
      // Real repetition — collect items, then merge across iterations.
      // Each field name becomes a list of per-iteration values.
      const items: Record<string, unknown>[] = [];
      while (items.length < p.max) {
        const savedPos = ctx.pos;
        const savedBuf = ctx.charBuffer.length;
        const item = parseStructured(p.child, ctx);
        if (item === null || ctx.pos === savedPos) {
          ctx.pos = savedPos;
          ctx.charBuffer.length = savedBuf;
          break;
        }
        items.push(item);
      }
      if (items.length < p.min) return null;
      const merged: Record<string, unknown> = {};
      for (const item of items) {
        for (const [name, value] of Object.entries(item)) {
          const existing = merged[name];
          if (existing === undefined) {
            merged[name] = [value];
          } else if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            merged[name] = [existing, value];
          }
        }
      }
      return merged;
    }
    case "group": {
      const savedBuf = ctx.charBuffer;
      ctx.charBuffer = [];
      const inner = parseStructured(p.child, ctx);
      const captured = ctx.charBuffer.join("");
      ctx.charBuffer = savedBuf;
      ctx.charBuffer.push(captured);
      if (inner === null) return null;
      const value = Object.keys(inner).length === 0 ? captured : inner;
      return { [p.name]: value };
    }
  }
}

/** Merge two field maps from a seq. Same-name collisions concat into lists
 *  (so `seq(group("kv", ...), star(seq("&", group("kv", ...))))` yields one
 *  list-typed `kv` field). */
function mergeRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const existing = out[k];
    if (existing === undefined) {
      out[k] = v;
    } else if (Array.isArray(existing) && Array.isArray(v)) {
      out[k] = [...existing, ...v];
    } else if (Array.isArray(existing)) {
      out[k] = [...existing, v];
    } else if (Array.isArray(v)) {
      out[k] = [existing, ...v];
    } else {
      out[k] = [existing, v];
    }
  }
  return out;
}

/** Default value for a FenelType: "" for refined-String, [] for List,
 *  defaulted record for $record. Used to fill in absent fields. */
function defaultForType(t: FenelType): unknown {
  if (typeof t !== "object" || t === null) return "";
  if (declaredListElement(t)) return [];
  if ("$record" in t) {
    const out: Record<string, unknown> = {};
    for (const f of t.$record.fields) out[f.name] = defaultForType(f.type);
    return out;
  }
  return "";
}

/** Walk the type alongside the parsed value, defaulting absent fields and
 *  recursing into nested records / lists. Coerces a raw captured string
 *  into a record/list when the type says so but the parser produced a
 *  scalar (happens when an optional containing groups doesn't fire). */
function applyTypeDefaults(t: FenelType, parsed: unknown): unknown {
  if (typeof t !== "object" || t === null) return parsed;
  if ("$record" in t) {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaultForType(t);
    }
    const obj = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const f of t.$record.fields) {
      out[f.name] = f.name in obj
        ? applyTypeDefaults(f.type, obj[f.name])
        : defaultForType(f.type);
    }
    return out;
  }
  {
    const list = declaredListElement(t);
    if (list) {
      if (Array.isArray(parsed)) {
        return parsed.map((it) => applyTypeDefaults(list.elem, it));
      }
      // Type says list but the parser produced a single scalar — happens when
      // a repeated group fired only once (no iteration through the rep), so
      // mergeRecord didn't get a chance to list-wrap. Lift to a singleton.
      if (parsed === undefined || parsed === null || parsed === "") return [];
      return [applyTypeDefaults(list.elem, parsed)];
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Capture extraction — walk the pattern over `values` and bind each `group`
// to the subsequence it consumes. Used by typed-group validation: callers
// can then check each captured value against its group's optional `type`.
// ---------------------------------------------------------------------------

export type Capture = {
  name: string;
  values: unknown[];
  type?: SetExpr;
};

/**
 * Run the pattern over `values` and extract every group's capture.
 *
 * Algorithm: at each step, find which `match` node currently consumes the
 * value. Walk up the pattern AST tracking which groups contain that match
 * node, append the value to each group's accumulator. Returns the captures
 * once the pattern matches; null if it doesn't.
 *
 * NB: this is greedy and assumes unambiguous group structure. For
 * alternations, captures from the chosen branch are returned. For
 * unbounded reps, captures from all iterations are concatenated.
 */
export function extractCaptures(
  p: Pattern,
  values: readonly unknown[],
  ctx?: Record<string, unknown>,
): Capture[] | null {
  // Pre-walk: collect all groups in the pattern with empty value arrays.
  const captures = new Map<string, Capture>();
  collectGroups(p, captures);
  if (captures.size === 0) {
    // Fast path: no groups → just check membership.
    return patternMatch(p, values, ctx) ? [] : null;
  }

  // Walk: at each step, descend through the active match path and find
  // which groups contain the consuming match node. Append the value to
  // each containing group's accumulator.
  let cur = p;
  for (const v of values) {
    const groupsConsuming = activeGroups(cur, v, ctx);
    for (const name of groupsConsuming) {
      const cap = captures.get(name);
      if (cap) cap.values.push(v);
    }
    cur = deriv(cur, v, ctx);
    if (cur.t === "empty") return null;
  }
  if (!nullable(cur)) return null;
  return Array.from(captures.values());
}

function collectGroups(p: Pattern, out: Map<string, Capture>): void {
  switch (p.t) {
    case "empty":
    case "eps":
    case "match":
      return;
    case "seq":
    case "alt":
      collectGroups(p.a, out);
      collectGroups(p.b, out);
      return;
    case "rep":
      collectGroups(p.child, out);
      return;
    case "group":
      if (!out.has(p.name)) {
        out.set(p.name, { name: p.name, values: [], type: p.type });
      }
      collectGroups(p.child, out);
      return;
  }
}

/** Names of groups that currently CONSUME `value` at this state. */
function activeGroups(
  p: Pattern,
  value: unknown,
  ctx?: Record<string, unknown>,
): string[] {
  switch (p.t) {
    case "empty":
    case "eps":
    case "match":
      return [];
    case "seq": {
      // The active match is in `a` (if a still has unconsumed input) or
      // in `b` (if a is nullable so we may have moved past it).
      if (deriv(p.a, value, ctx).t !== "empty") return activeGroups(p.a, value, ctx);
      if (nullable(p.a)) return activeGroups(p.b, value, ctx);
      return [];
    }
    case "alt": {
      // Prefer `a` if it can consume, else `b`.
      if (deriv(p.a, value, ctx).t !== "empty") return activeGroups(p.a, value, ctx);
      return activeGroups(p.b, value, ctx);
    }
    case "rep":
      return activeGroups(p.child, value, ctx);
    case "group": {
      // This group consumes the value if its child can. Add this group's
      // name plus any nested group names.
      const inner = activeGroups(p.child, value, ctx);
      const childCanMatch = deriv(p.child, value, ctx).t !== "empty";
      return childCanMatch ? [p.name, ...inner] : inner;
    }
  }
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("pattern") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_pattern from "./pattern";
import { registerEngineModule as __reg_pattern } from "./engine-require";
__reg_pattern("pattern", __self_pattern);
