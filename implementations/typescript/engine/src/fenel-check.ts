// ---------------------------------------------------------------------------
// fenel-check.ts — FenelCheck: type inference, assignability, flow checking
//
// The orchestrator that ties propagation, inversion, and the set algebra
// together into a usable type-checking system.
//
// Key concepts:
//   - inferExprType: walks a JSON Logic expression, propagates types bottom-up
//   - checkAssignable: verifies source ⊆ target, computes the gap if not
//   - narrowFromCondition: liquid-type narrowing through if-branches
//   - inferFlow: full flow graph type inference (forward + backward)
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { Expression, SetExpr, FenelType } from "./types";
import { normalize } from "./set-algebra";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  engineFunctionReturnSpecs,
  marshalTraversalType,
  dispatchedTypeToSetProjection,
} from "./engine-bodies-dispatch";
import {
  setExprToTag,
  buildSetExpr,
  isDegradedTypeProjection,
} from "./set-marker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of checking if source type is assignable to target type. */
export type ProofResult = {
  /** Whether source ⊆ target */
  ok: boolean;
  /** If not ok, values possible in source but not in target */
  gap?: SetExpr;
  /** Confidence: "proven" = exact, "forward" = forward-only, "unknown" = opaque */
  confidence: "proven" | "forward" | "unknown";
};

/** A variable → type constraint binding. */
export type TypeBinding = {
  name: string;
  set: SetExpr;
  source: "declared" | "inferred" | "narrowed";
};

/** Type environment: variable names → SetExpr constraints. */
export type TypeEnv = Map<string, SetExpr>;

/** Flow graph node for type inference. */
export type FlowNode = {
  id: string;
  /** JSON Logic expression this node computes */
  expr?: Expression;
  /** Declared output type constraint (if any) */
  declaredType?: SetExpr;
  /** Variable bindings available in this node's scope */
  bindings?: Record<string, SetExpr>;
};

/** Flow graph edge. */
export type FlowEdge = {
  from: string;
  to: string;
  /** Which input slot on the target node */
  slot?: string;
};

/** Result of flow graph type inference. */
export type FlowTypeMap = {
  /** Inferred output type for each node */
  nodes: Map<string, SetExpr>;
  /** Type on each edge (propagated from source node) */
  edges: Map<string, SetExpr>;
  /** Proof results for each edge (source ⊆ target's expected input) */
  proofs: Map<string, ProofResult>;
};

// ---------------------------------------------------------------------------
// checkAssignable — subset check with gap computation
// ---------------------------------------------------------------------------

/**
 * Check if `source` is assignable to `target` (source ⊆ target).
 * If not, computes the gap: values in source but not in target.
 *
 * unified-static-analysis Phase 2 (D-A): the DECISION logic — the
 * proven-vs-forward-vs-unknown confidence ladder + the `canAnalyze` predicate —
 * is now the Fenel body `engine:checkAssignable` (`assignable.fenel`). This TS
 * function is the thin dispatch delegate (the `refine.fenel` / `kernel.ts`
 * discipline): it pre-computes the kernel subset fact and the exact normalized
 * gap, passes that canonical SetExpr evidence to the Fenel grader, then maps
 * its result to
 * `{ ok, gap?, confidence }`. No classification or decision logic survives
 * here.
 */
export function checkAssignable(source: SetExpr, target: SetExpr): ProofResult {
  if (isDegradedTypeProjection(source) || isDegradedTypeProjection(target)) {
    return {
      ok: false,
      gap: { $tag: "SeDiff", left: source, right: target },
      confidence: "unknown",
    };
  }
  // FACT 1 — `source ⊆ target`, decided through the KERNEL (part B: the thesis
  // demonstration). The subset JUDGMENT (jopSubset) → DecidableSetResult →
  // kernel:verify (judgment-native since decide-substrate Phase 2 K3). The
  // proposer pre-computes the SAME `isSubset(source, target)` the legacy fast
  // path used (the shared recognizer recovers (s, t) from the composed set), so
  // `subsetProven` ⟺ `isJustTrue(isSubset(source, target))`, but a positive
  // verdict now carries a kernel SolverChecked grade over the one lattice
  // judgment, not a hand-graded "proven". Lazy `require` breaks the
  // prover/kernel import cycle (the `dispatchedRefineType` precedent).
  const subsetProven = kernelDecidesSubset(source, target);

  // EVIDENCE 2 — the exact conservative gap. Fenel owns the SeNone case split;
  // this boundary only computes the normalized SetExpr that is also attached to
  // a negative ProofResult.
  const gap = normalize({ $tag: "SeDiff", left: source, right: target });

  // The body consumes the registered canonical SetExpr directly. The former
  // parallel SetMarker classifier and TS-owned gap-emptiness classifier were
  // retired by floor-kernel Phase 4.
  const marker = dispatchEngineBody("engine:checkAssignable", [
    subsetProven,
    gap,
    source,
    target,
  ]) as { ok: boolean; confidence: "proven" | "forward" | "unknown" };

  // Map the marker back to the real ProofResult. The `gap` is meaningful ONLY
  // when `!ok` (the legacy contract), and we already hold the pre-computed
  // SetExpr — reconstruct it here rather than crossing the `$`-key barrier.
  if (marker.ok) return { ok: true, confidence: marker.confidence };
  return { ok: false, gap, confidence: marker.confidence };
}

/** Decide `source ⊆ target` through the kernel, JUDGMENT-NATIVE
 *  (decide-substrate Phase 2 K3): build the subset judgment `JEmpty (¬target
 *  ∩ source)` via the kernel iso's own Fenel builder (`engine:jopSubset` — the
 *  same builder the K2+ law/quantifier producers use), propose it as a
 *  `DecidableSetResult`, then `kernel:verify` the claim. Both proposer and
 *  kernel shape-recognize the composed set back to `isSubset(source, target)`
 *  (the shared `engine:recheckPlan` — tri-precision preserved), so a
 *  kernel-accepted (SolverChecked) verdict is equal to
 *  `isJustTrue(isSubset(s, t))` by construction, now carried as a kernel
 *  verdict over the one lattice judgment. */
function kernelDecidesSubset(source: SetExpr, target: SetExpr): boolean {
  const claim = dispatchEngineBody("engine:jopSubset", [{ s: source, t: target }]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { decidableSetProposerNative } = engineRequire("modules/prover") as {
    decidableSetProposerNative: (p: unknown) => { $tag: string; _0: unknown };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { verify } = engineRequire("kernel") as {
    verify: (p: unknown, pf: unknown) => { $tag: string; _0: { $tag: string } };
  };
  const proposed = decidableSetProposerNative(claim);
  if (proposed.$tag !== "Ok") return false;
  const vr = verify(claim, proposed._0);
  return vr.$tag === "Ok" && vr._0.$tag === "SolverChecked";
}

// ---------------------------------------------------------------------------
// inferExprType — walk JSON Logic, propagate types bottom-up
//
// unified-static-analysis Phase 3b-3: the WALK is now the Fenel body
// `engine:inferExprType` (`fenel-check.fenel`) — bottom-up abstract
// interpretation over a JSON-Logic expression, composing the already-Fenel
// `propagate` / `invert` transfer leaves marker-native (one dispatch for the
// whole tree). This TS function retires to the thin marshal delegate (the
// `propagate.ts` / `invert.ts` discipline): it marshals the Expression into a
// `$`-free, op-free ExprMarker the body can walk structurally (a body can't
// read raw JSON-Logic — its keys ARE evaluator ops), marshals the env into an
// Se* assoc list (`setExprToTag` — Stage E: the body is Se*-native, no Sm*
// round-trip), dispatches the Fenel walk, then runs ONE final `normalize`
// (the body normalizes step-wise in-body — D-3b-3-2). No decision logic
// survives here.
// ---------------------------------------------------------------------------

/** A `$`-free, op-free mirror of a JSON-Logic Expression — the structural shape
 *  the Fenel `inferExprType` body walks (a body cannot read raw JSON-Logic: its
 *  keys `var` / `+` / `if` / `call` ARE evaluator ops). NOT a registered ADT —
 *  plain records dispatched by `tag` (the SetMarker / ExprMarker audit-green
 *  precedent). The raw JSON-Logic op string is kept VERBATIM so the body's
 *  switch mirrors the legacy `inferOp` byte-for-byte. */
type ExprMarker =
  | { tag: "Lit"; value: unknown }
  | { tag: "Var"; name: string; hasDefault: boolean; default: ExprMarker }
  | { tag: "Arr"; items: ExprMarker[] }
  | { tag: "Op"; op: string; args: ExprMarker[] };

/** Marshal raw JSON-Logic into an ExprMarker (TS can read it as plain objects).
 *  Mirrors the legacy `inferNode` structural reading 1:1: primitive/null/empty
 *  ⇒ `Lit`; array ⇒ `Arr`; single-key object ⇒ `Var` (for `var`, carrying the
 *  optional default arg) else `Op{op, args}` (normalising the legacy
 *  `Array.isArray(rawArgs) ? rawArgs : [rawArgs]` step TS-side). */
function marshalExpr(node: unknown): ExprMarker {
  if (node === null || node === undefined) return { tag: "Lit", value: null };
  if (typeof node === "number" || typeof node === "string" || typeof node === "boolean") {
    return { tag: "Lit", value: node };
  }
  if (Array.isArray(node)) return { tag: "Arr", items: node.map(marshalExpr) };
  if (typeof node === "object") {
    const keys = Object.keys(node);
    // Empty object ≡ the legacy `{$enum:[null]}` point set.
    if (keys.length === 0) return { tag: "Lit", value: null };
    const op = keys[0]!;
    const rawArgs = (node as Record<string, unknown>)[op];
    const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
    if (op === "var") {
      const name = typeof args[0] === "string" ? args[0] : String(args[0]);
      const hasDefault = args.length > 1;
      // The body only reads `default` under the `hasDefault` guard; supply a
      // dummy Lit when absent so the field is always present (no missing-key
      // read).
      return {
        tag: "Var",
        name,
        hasDefault,
        default: hasDefault ? marshalExpr(args[1]) : { tag: "Lit", value: null },
      };
    }
    return { tag: "Op", op, args: args.map(marshalExpr) };
  }
  // Unreachable for valid JSON-Logic; the legacy fell to $all here.
  return { tag: "Lit", value: null };
}

/** Marshal the TypeEnv into the assoc list `[{name, set: SetExpr}]` the body's
 *  `var` arm searches by name. Stage E: the sets ride as canonical `$tag` Se*
 *  (`setExprToTag` — the dual-read normalize), no `Sm*` round-trip. */
function marshalEnv(env: TypeEnv): Array<{ name: string; set: SetExpr }> {
  const out: Array<{ name: string; set: SetExpr }> = [];
  for (const [name, set] of env) out.push({ name, set: setExprToTag(set) });
  return out;
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 3b-6 — the registry return-table marshal (the
// seam, category B). The forward walk's `call` / key-as-fnId / `pipe` arms
// resolve a SATURATED application's RETURN type instead of stubbing `$all`. The
// return-types are a registry FACT (D-3b-6-1): the seam reads each function's
// declared `returns` from the harness registry, projects it once through the
// shared `$`-free TraversalType boundary (the body cannot read `$`-keyed
// FenelType values), and threads the `[{key, ret,
// arity}]` assoc list into the body as a third arg alongside the ExprMarker +
// env. The `FenelCodeEditor` / `FunctionSpecEditor` signatures stay byte-stable
// — the table is owned here, not editor-passed.
//
// The raw specs are registry-static (cached per harness in
// `engineFunctionReturnSpecs`), so the marshalled table is memoised by spec-array
// identity: the traversal projection runs ONCE, then every lint reuses it (the
// keystroke path stays cheap — the 3b-3 latency precedent).
// ---------------------------------------------------------------------------

type ReturnTableEntry = { key: string; ret: unknown; arity: number };

let _returnTableSpecs: ReturnType<typeof engineFunctionReturnSpecs> | null = null;
let _returnTable: Record<string, ReturnTableEntry> | null = null;

/** The return-table INDEX: a key→entry record the body reads via the O(1)
 *  opaque-map `mapGet` native (decide-substrate Phase 1 Stage E). The previous
 *  assoc-ARRAY forced the body's `tblLookup` into an O(|registry|)-deep
 *  interpreted scan that overflowed the bun-test worker stack on every miss
 *  (pre-existing since the registry outgrew the stack). FIRST occurrence wins
 *  on a duplicate key — byte-mirroring the first-match linear scan it replaces
 *  (the `fromEntries` native's own documented rule). */
function returnTable(): Record<string, ReturnTableEntry> {
  const specs = engineFunctionReturnSpecs();
  if (specs !== _returnTableSpecs || _returnTable === null) {
    _returnTableSpecs = specs;
    const idx = Object.create(null) as Record<string, ReturnTableEntry>;
    for (const s of specs) {
      if (!Object.prototype.hasOwnProperty.call(idx, s.key)) {
        idx[s.key] = { key: s.key, ret: marshalTraversalType(s.returns), arity: s.arity };
      }
    }
    _returnTable = idx;
  }
  return _returnTable;
}

/**
 * Infer the output SetExpr of a JSON Logic expression given variable bindings.
 *
 * The thin marshal delegate over the Fenel `engine:inferExprType` walk: marshal
 * the Expression → ExprMarker + the env → Se* assoc list (Stage E: the body is
 * Se*-native), dispatch the Fenel body (which composes the `propagate` /
 * `invert` leaves), then normalize the result. ONE Fenel dispatch.
 */
export function inferExprType(expr: Expression, env: TypeEnv): SetExpr {
  const exprMarker = marshalExpr(expr);
  const envMarker = marshalEnv(env);
  const result = setExprToTag(dispatchEngineBodyWithDeciderCtx("engine:inferExprType", [
    exprMarker,
    envMarker,
    returnTable(),
  ]));
  return normalize(result);
}

// ---------------------------------------------------------------------------
// narrowFromCondition — liquid type narrowing through if-branches
//
// unified-static-analysis Phase 3b-3c: the DECISION logic — the comparison /
// and / or / not narrowing arms + the mutate-two-`Map`s threading — is now the
// Fenel body `engine:narrowFromCondition` (`fenel-check.fenel`), reformulated as
// immutable env-PAIR threading (D-3b-3c-2). This TS function retires to the thin
// marshal delegate (the `inferExprType` discipline): it marshals the condition
// into the same `$`-free ExprMarker (reusing `marshalExpr`) + the env into the
// same Se* assoc list (reusing `marshalEnv`), dispatches the Fenel narrowing,
// then lifts each returned branch env (assoc list → Map).
// No decision logic survives here.
// ---------------------------------------------------------------------------

/** Narrowed bindings for true and false branches. */
export type NarrowResult = {
  trueBranch: TypeEnv;
  falseBranch: TypeEnv;
};

/** Lift an env assoc list back to a TypeEnv (`Map`) — the inverse of
 *  `marshalEnv`. Stage E: the sets are already canonical `$tag` Se* SetExprs
 *  (normalized in-body via `normMarker` = `setAlgebraNormalize`, matching the
 *  legacy's per-entry `normalize`), so this is a plain assoc→Map lift. */
function unmarshalEnv(assoc: Array<{ name: string; set: SetExpr }>): TypeEnv {
  return new Map(assoc.map((e) => [e.name, e.set]));
}

/**
 * Compute narrowed type environments for both branches of a condition.
 *
 * Example: `{">":[{"var":"age"}, 18]}` with age: ℤ
 *   → trueBranch: age: ℤ ∩ (18, ∞)
 *   → falseBranch: age: ℤ ∩ (-∞, 18]
 *
 * The thin marshal delegate over the Fenel `engine:narrowFromCondition` body:
 * marshal the condition → ExprMarker + the env → Se* assoc list, dispatch
 * the Fenel narrowing (which threads an immutable env pair), then lift each
 * returned branch env back to a `Map`.
 */
export function narrowFromCondition(condition: Expression, env: TypeEnv): NarrowResult {
  const condMarker = marshalExpr(condition);
  const envMarker = marshalEnv(env);
  const r = dispatchEngineBodyWithDeciderCtx("engine:narrowFromCondition", [
    condMarker,
    envMarker,
  ]) as {
    trueEnv: Array<{ name: string; set: SetExpr }>;
    falseEnv: Array<{ name: string; set: SetExpr }>;
  };
  return { trueBranch: unmarshalEnv(r.trueEnv), falseBranch: unmarshalEnv(r.falseEnv) };
}

// ---------------------------------------------------------------------------
// inferExprTypeNarrow — inference WITH liquid-type narrowing through ifs
//
// unified-static-analysis Phase 3b-3c: the `if`-narrowing walk is now the Fenel
// body `engine:inferExprTypeNarrow` (D-3b-3c-3 — ONE composed dispatch: it calls
// `narrowFromCondition` + the forward `inferExprType` bare-name in-body, so the
// whole narrowing walk is a single Fenel dispatch). This TS function retires to
// the thin marshal delegate: marshal → dispatch → unmarshal + normalize the
// result type, paired with the UNCHANGED input env (narrowing is branch-local —
// the top-level env is never mutated, exactly as the legacy).
// ---------------------------------------------------------------------------

/**
 * Like inferExprType but narrows bindings through if-conditions.
 * Returns both the result type and the final environment.
 */
export function inferExprTypeNarrow(
  expr: Expression,
  env: TypeEnv,
): { type: SetExpr; env: TypeEnv } {
  const exprMarker = marshalExpr(expr);
  const envMarker = marshalEnv(env);
  const result = setExprToTag(dispatchEngineBodyWithDeciderCtx("engine:inferExprTypeNarrow", [
    exprMarker,
    envMarker,
    returnTable(),
  ]));
  return { type: normalize(result), env };
}

// ---------------------------------------------------------------------------
// inferFlow — flow graph type inference
//
// unified-static-analysis Phase 3b-flow: the flow-graph orchestrators
// `inferFlow` + `backwardInfer` — the LAST pure-logic in this file — are now the
// Fenel bodies `engine:inferFlow` + `engine:backwardInfer` (`flow-infer.fenel`).
// The decision logic (Kahn's topological sort, the forward type-propagation
// pass, the declared-type intersect, the per-edge source-type + assignability
// CLASSIFICATION, and the binary-arith backward inversion) all moved to Fenel,
// composing the already-Fenel `inferExprType` / `invert` / `normMarker` leaves
// bare-name. These TS functions retire to thin marshal delegates: marshal the
// FlowNode/FlowEdge graph into `$`-free markers, dispatch the Fenel orchestrator,
// rebuild the Map-typed FlowTypeMap (the `$`-key-free authoring boundary,
// category B). After this the file is a 100% marshal seam.
//
// D-FLOW-4: the Fenel body DEFERS a declared-slot edge's proof to the existing
// `checkAssignable` seam via a `needsCheck` carrier (that seam owns the kernel
// round-trip + gap precompute + confidence grading composition). The
// CLASSIFICATION (which edges defer vs default) is decided in Fenel; this
// delegate only routes the carrier to the leaf — no decision logic survives
// here. Stage E note: the original "not body-reachable" premise dissolved (the
// body is Se*-native and could call decideSubset — the set:witnessSound
// precedent); folding the seam's composition in-body is decide-substrate
// Phase-2 territory, not this port.
// ---------------------------------------------------------------------------

/** The mirror of a FlowNode the `engine:inferFlow` body walks (`expr`
 *  → ExprMarker — still the `$`-free expr barrier; `bindings` / `declaredType`
 *  → canonical `$tag` Se* SetExpr since Stage E; presence flags so the body
 *  never reads a missing key). */
type FlowNodeMarker = {
  id: string;
  hasExpr: boolean;
  expr: ExprMarker;
  bindings: Array<{ name: string; set: SetExpr }>;
  hasDeclared: boolean;
  declaredType: SetExpr;
};

/** A `$`-free mirror of a FlowEdge (strings are verbatim; `slot` presence is a
 *  flag, with a dummy "" when absent so the body never reads a missing key). */
type FlowEdgeMarker = { from: string; to: string; hasSlot: boolean; slot: string };

/** The proof marker the body emits per edge — either a fully-decided default
 *  (no declared slot constraint) or a `needsCheck` carrier the delegate
 *  resolves through `checkAssignable` (D-FLOW-4). */
type ProofMarker =
  | { needsCheck: false; ok: boolean; confidence: "proven" | "forward" | "unknown" }
  | { needsCheck: true; source: SetExpr; target: SetExpr };

/** Marshal a FlowNode into its body-readable mirror. `expr` absent ⇒ a dummy
 *  Lit under the `hasExpr` guard; `declaredType` absent ⇒ a dummy SeAll under
 *  `hasDeclared`; `bindings` absent ⇒ the empty assoc list. Stage E: the sets
 *  ride as canonical `$tag` Se* (`setExprToTag`). */
function marshalNode(n: FlowNode): FlowNodeMarker {
  const hasExpr = n.expr !== undefined;
  const hasDeclared = n.declaredType !== undefined;
  const bindings: Array<{ name: string; set: SetExpr }> = [];
  if (n.bindings) {
    for (const [name, set] of Object.entries(n.bindings)) bindings.push({ name, set: setExprToTag(set) });
  }
  return {
    id: n.id,
    hasExpr,
    expr: hasExpr ? marshalExpr(n.expr) : { tag: "Lit", value: null },
    bindings,
    hasDeclared,
    declaredType: hasDeclared ? setExprToTag(n.declaredType!) : buildSetExpr.all(),
  };
}

/** Marshal a FlowEdge into its `$`-free marker (slot presence as a flag). */
function marshalEdge(e: FlowEdge): FlowEdgeMarker {
  return { from: e.from, to: e.to, hasSlot: e.slot !== undefined, slot: e.slot ?? "" };
}

/**
 * Run type inference over a flow graph.
 *
 * The thin marshal delegate over the Fenel `engine:inferFlow` body: marshal the
 * nodes / edges into `$`-free markers, dispatch the Fenel orchestrator (which
 * topo-sorts, forward-propagates, and classifies each edge), then rebuild the
 * Map-typed FlowTypeMap — building the cosmetic edgeId key host-side (D-FLOW-2)
 * and resolving each `needsCheck` carrier through `checkAssignable` (D-FLOW-4).
 */
export function inferFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowTypeMap {
  const r = dispatchEngineBodyWithDeciderCtx("engine:inferFlow", [
    nodes.map(marshalNode),
    edges.map(marshalEdge),
    returnTable(),
  ]) as {
    nodes: Array<{ id: string; set: SetExpr }>;
    edges: Array<{ source: SetExpr; proof: ProofMarker }>;
  };

  const result: FlowTypeMap = {
    nodes: new Map(r.nodes.map((n) => [n.id, n.set])),
    edges: new Map(),
    proofs: new Map(),
  };

  // Zip the per-edge results with the input edges (the body emits them in input
  // order). The edgeId is the cosmetic key (built host-side, D-FLOW-2); the
  // source type + the proof CLASSIFICATION are the Fenel body's decisions. A
  // `needsCheck` carrier resolves through the existing checkAssignable seam.
  edges.forEach((e, i) => {
    const edgeId = `${e.from}->${e.to}${e.slot ? `:${e.slot}` : ""}`;
    const er = r.edges[i]!;
    result.edges.set(edgeId, er.source);
    const p = er.proof;
    if (p.needsCheck) {
      result.proofs.set(edgeId, checkAssignable(p.source, p.target));
    } else {
      result.proofs.set(edgeId, { ok: p.ok, confidence: p.confidence });
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Backward flow inference
//
// unified-static-analysis Phase 3b-flow: the binary-arith backward inversion is
// now the Fenel body `engine:backwardInfer` (`flow-infer.fenel`). This TS
// function retires to the thin marshal delegate: marshal the expression →
// ExprMarker (reusing `marshalExpr`), the output constraint → `$tag` Se*
// (`setExprToTag`), the known inputs → the Se* env assoc list (reusing
// `marshalEnv`), dispatch the Fenel inversion, then lift the refined env.
// No decision logic survives here.
// ---------------------------------------------------------------------------

/**
 * Given a declared output constraint on a node and the node's expression,
 * compute what constraints the inputs must satisfy.
 *
 * The thin marshal delegate over the Fenel `engine:backwardInfer` body.
 */
export function backwardInfer(
  expr: Expression,
  outputConstraint: SetExpr,
  knownInputs: TypeEnv,
): TypeEnv {
  const r = dispatchEngineBodyWithDeciderCtx("engine:backwardInfer", [
    marshalExpr(expr),
    setExprToTag(outputConstraint),
    marshalEnv(knownInputs),
    returnTable(),
  ]) as Array<{ name: string; set: SetExpr }>;
  return unmarshalEnv(r);
}

// ---------------------------------------------------------------------------
// Convenience: typeToSetExpr
//
// unified-static-analysis Phase 3b-3b: the `FenelType → SetExpr` DECISION logic
// is now the Fenel body `engine:typeToSetExpr` (`type-to-set.fenel`) — the
// `$refined` recurse+intersect, the `$opaque.pure` recurse, the named-tower
// switch, the `$el`/`$type`/other ⇒ $all default. This TS function retires to
// the thin marshal delegate (the `propagate.ts` / `inferExprType` discipline):
// it projects the `$`-keyed FenelType once into the shared `$`-free,
// identity-total TraversalType that all semantic type consumers walk,
// dispatches the Se*-native Fenel body, then structurally validates and
// canonicalizes the result through the shared dual-read `setExprToTag` boundary.
// NO algebraic `normalize` runs: refinement predicate payloads remain verbatim,
// and no decision logic survives in this wrapper.
// ---------------------------------------------------------------------------

/**
 * Extract the SetExpr constraint from a FenelType, or $all if unconstrained.
 *
 *   $refined { base, set }  → set ∩ baseSet (intersection)
 *   $named "Number"         → ℝ (or ℤ via integer hint)
 *   $named "String"         → String
 *   $named "Boolean"        → { $enum: [true, false] }
 *   any other shape         → $all
 */
export function typeToSetExpr(type: FenelType): SetExpr {
  // Projection surface, not a verdict face or an authoring write: a BENIGN
  // identity-invalid shape (keyless anonymous record/arrow) degrades to the
  // unconstrained ⊤ projection via the Fenel body's own
  // `typeToSetSemanticError` arm, and named canonical shapes (the keyless
  // `List(a)` helper) are normalized through the registry's identified
  // declaration at the marshal seam. HOSTILE input — a shape the
  // descriptor-safe boundary could not snapshot (accessor-bearing / ambiguous
  // `$`-key envelope) — is still rejected loudly at every surface.
  const traversal = marshalTraversalType(type);
  return dispatchedTypeToSetProjection(traversal).set;
}
