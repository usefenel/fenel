// ---------------------------------------------------------------------------
// module-migrate-evaluator-strategies.test.ts — module-substrate Phase 3h
// parity proof.
//
// evaluator-strategies isolates the LAST unproven native-tier axis: the
// BOTH-MAPS-FALLBACK. `time` (3b) + `codec` (3d) proved the plain `nativeImpls`
// split; `picture` (3f) + the media cluster (3g) proved the ctx tier with a
// clean DISJOINT plain/ctx split. None forced a fnId into BOTH native maps.
// evaluator-strategies does — every one of the four fnIds (eagerEval / lazyEval
// / partialEval / jitEval) is dual-registered: the SAME codeName lands in BOTH
// `evaluatorNatives` (plain) AND `evaluatorNativesCtx` (ctx).
//
// This is a PARITY migration — the ~563-LOC hand-assembled
// `engine/src/modules/evaluator-strategies.ts` (4 `defineFunction` specs + the
// inline native impls + helpers) was replaced by `types.fenel` (HEADER-LESS,
// 4 `@native` foreign decls) + `ffi/evaluator-strategies-ffi.ts` (the 4 impls +
// helpers + BOTH native maps) + the unchanged `instances.fenel` (the 4
// `Evaluator <Strategy>` dispatch instances) + a thin seam, with NOTHING
// dropped. The structural proof below asserts:
//   - all 4 functions resolve by id under the legacy `evaluator-strategies:`
//     prefix (preserved header-less via the loader name arg);
//   - all 4 are bodyless foreign declarations;
//   - nativeImpls (plain) AND nativeImplsCtx (ctx) are BOTH present, id-keyed,
//     and SHARE ALL 4 KEYS — the headline (the INVERSE of picture's
//     "disjoint maps" assertion);
//   - identity-facet parity (the 4 natives' rich Labelable/Describable/Taggable
//     + category "evaluator", NOT the header default);
//   - the 4 Evaluator dispatch instances ride the seam (+ the exported consts);
//   - end-to-end dual-dispatch: `applyOp` STRICTLY prefers the ctx map for a
//     both-maps id, and the ctx native genuinely re-enters the evaluator WITH
//     the threaded ctx (reads `_localData`), while the plain copy at the same id
//     stays callable (the load-bearing direct-reader contract).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  evaluatorStrategiesModule,
  eagerEvaluatorInstance,
  lazyEvaluatorInstance,
  partialEvaluatorInstance,
  jitEvaluatorInstance,
  eagerEvalNative,
  lazyEvalNative,
  jitEvalNative,
  evaluatorNatives,
} from "./modules/evaluator-strategies";
import { createRegistry } from "./registry";
import { evaluate, resolveCompleteMethodForEvaluation, type EvaluateContext } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// All 4 natives carried rich `defineFunction` identity (codeName + label +
// description + category="evaluator" + tags). The migration is HEADER-LESS, so
// the `evaluator-strategies` name comes from the loader arg; @category
// "evaluator" overrides the would-be `evaluator-strategies` default.
type Expected = { label: string; tags: string[]; description: string };
const NATIVES: Record<string, Expected> = {
  eagerEval: {
    label: "Eager evaluate (call-by-value)",
    tags: ["evaluator", "strategy", "eager", "call-by-value"],
    description:
      "Today's default Fenel evaluator wrapped as a typeclass-dispatched method. Evaluates every sub-expression in source order before passing values to operators / functions; throws-as-Err wraps exceptions into `Err InternalError`. Behaviour-faithful to the direct `evaluate` function from `json-logic.ts` — the EagerEvaluator instance's `eval` method id points here.",
  },
  lazyEval: {
    label: "Lazy evaluate (call-by-name)",
    tags: ["evaluator", "strategy", "lazy", "call-by-name"],
    description:
      "Call-by-name evaluator: function arguments are NOT pre-evaluated; each parameter reference inside the body re-evaluates the corresponding arg expression. Recognises `{call: [fnName, …args]}` shapes for user functions with a Fenel body; falls through to the eager path for everything else (literal expressions, single operator-ops, primitive calls). NOT call-by-need (no thunk memoisation) — re-evaluates each access. Phase 6 proof of concept; upgrade to call-by-need is straightforward.",
  },
  partialEval: {
    label: "Partial evaluate (symbolic / Futamura specialiser)",
    tags: ["evaluator", "strategy", "partial", "symbolic", "futamura", "specialiser"],
    description:
      "Symbolic evaluator: walks the AST, substitutes known variable bindings, constant-folds pure sub-expressions, prunes dead branches under known conditions, β-reduces pure user-function calls (full eval when all args known; partial inline when some args remain residual). The output's value channel is either a concrete value (full reduction) or a residual JSON-Logic AST that, re-evaluated under any extension of the known-inputs context, computes the same value as the original. Composes with `Compilable JsModule` to derive the Futamura projection: specialise an interpreter to a program → the residual IS the program compiled. Reads known inputs from `ctx._known` and a recursive-inline depth budget from `ctx._partialBudget` (default 8).",
  },
  jitEval: {
    label: "JIT evaluate (PE ∘ CompileJs ∘ exec)",
    tags: ["evaluator", "strategy", "jit", "compile-and-exec", "futamura"],
    description:
      "Just-in-time evaluator: partial-evaluate the input expression with known bindings, then if a residual remains, compile to JS via `compileFenelToJs` and execute via `new Function`. When PE fully reduces the input, the compile-and-exec round-trip is skipped and the concrete value passes through. This is the smallest demonstration of the Futamura projection composition working through the dispatch substrate; production-grade JIT (speculative deoptimisation, polymorphic inline caches, tiered compilation) is Phase 8+ work.",
  },
};

const NATIVE_NAMES = Object.keys(NATIVES); // eagerEval / lazyEval / partialEval / jitEval
const IDS = NATIVE_NAMES.map((n) => `evaluator-strategies:${n}`);

// expr-substrate Phase 8 (2026-06-16) — the 5th native `evalApply` is the
// ctx-threaded apply seam behind the explicit-strategy entry `engine:evaluateWith`.
// It is CTX-ONLY (NOT part of the both-maps-fallback): it genuinely needs the
// live ctx to re-enter the evaluator, so it has no plain-map copy. The 4 `*Eval`
// natives keep the total-overlap both-maps-fallback; `evalApply` rides only the
// ctx map. Counts that span "every function in the module" use ALL_FN_IDS.
const EVAL_APPLY_ID = "evaluator-strategies:evalApply";
// partial-evaluator-substrate Phase 1 (2026-07-03) — the 6th + 7th natives
// `peEval` (the ctx-threaded const-fold seam) and `peFnSpec` (the β-reduce
// fn-spec introspection) behind the Fenel-bodied `engine:partialEvaluate`
// walker. Like `evalApply` both are CTX-ONLY (NOT part of the both-maps-
// fallback): peEval needs the live ctx to re-enter the host evaluator for
// user-function dispatch; peFnSpec reads the threaded ctx's getFunction.
const PE_EVAL_ID = "evaluator-strategies:peEval";
const PE_FNSPEC_ID = "evaluator-strategies:peFnSpec";
const ALL_FN_IDS = [...IDS, EVAL_APPLY_ID, PE_EVAL_ID, PE_FNSPEC_ID];
const ALL_NATIVE_NAMES = [...NATIVE_NAMES, "evalApply", "peEval", "peFnSpec"];

// The 4 `Evaluator <Strategy>` dispatch instances (from instances.fenel) —
// strategy tag → eval method. modules-as-values Phase 2b: the field is typed
// as the strategy function, so each instance holds a qualified reference to
// the same function its id string named (`evaluator-strategies:eagerEval`).
const STRATEGIES: Record<string, { $ref: string }> = {
  EagerStrategy: { $ref: "evaluatorStrategies.eagerEval" },
  LazyStrategy: { $ref: "evaluatorStrategies.lazyEval" },
  PartialStrategy: { $ref: "evaluatorStrategies.partialEval" },
  JitStrategy: { $ref: "evaluatorStrategies.jitEval" },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("evaluator-strategies migration — header-less identity", () => {
  // modules-as-values (2026-09-24): the loader arg (header-less — the hyphen
  // blocks `module … where`) stays the function-id namespace; the container is
  // the identifier `evaluatorStrategies`, so its members can be written dotted.
  test("the container is `evaluatorStrategies`; the loader arg is its function namespace", () => {
    expect(evaluatorStrategiesModule.name).toBe("evaluatorStrategies");
    expect(evaluatorStrategiesModule.functionNamespace).toBe("evaluator-strategies");
  });

  test("all functions registered under the legacy `evaluator-strategies:` id-prefix (4 *Eval + the Phase-8 evalApply seam)", () => {
    expect((evaluatorStrategiesModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ALL_FN_IDS].sort());
  });

  test("all four strategy arguments are real nominal declarations of the source container", () => {
    const entities = evaluatorStrategiesModule.entities ?? [];
    expect(entities.map(entity => entity.id).sort()).toEqual(Object.keys(STRATEGIES).sort());
    for (const entity of entities) {
      expect(entity.module).toBe("evaluatorStrategies");
      expect(entity.type).toEqual({ $variant: { cases: [{ name: entity.id, label: { $tag: "Nothing" }, fields: [] }] } });
    }
    const reader = createRegistry([evaluatorStrategiesModule]).evaluateContext();
    for (const strategy of Object.keys(STRATEGIES)) {
      const declared = reader._callSiteTyping?.resolveType({ $ref: `evaluatorStrategies.${strategy}` }, undefined);
      expect(declared).toMatchObject({ ok: true });
      expect(resolveCompleteMethodForEvaluation(reader, "Evaluator", "eval", [strategy]))
        .toMatchObject({ $tag: "Resolved" });
    }
  });

  test("module label preserved", () => {
    expect(JSON.stringify(evaluatorStrategiesModule.label)).toContain("Evaluator strategies");
  });
});

describe("evaluator-strategies migration — the BOTH-MAPS-FALLBACK seam (the headline)", () => {
  test("all native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (evaluatorStrategiesModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual([...ALL_FN_IDS].sort());
  });

  test("nativeImpls (PLAIN map) holds exactly the 4 *Eval ids (evalApply is ctx-only)", () => {
    expect(evaluatorStrategiesModule.nativeImpls, "nativeImpls must be present").toBeDefined();
    expect(Object.keys(evaluatorStrategiesModule.nativeImpls ?? {}).sort()).toEqual([...IDS].sort());
  });

  test("nativeImplsCtx (CTX map) holds the 4 *Eval ids + the Phase-8 evalApply seam", () => {
    expect(evaluatorStrategiesModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(evaluatorStrategiesModule.nativeImplsCtx ?? {}).sort()).toEqual([...ALL_FN_IDS].sort());
  });

  // THE HEADLINE — the INVERSE of picture's "disjoint maps". The 4 `*Eval` fnIds
  // are in BOTH maps (total 4/4 overlap) — the both-maps-fallback. Axis #4 still
  // holds: the @native foreign decl is uniform; the seam routes into both maps;
  // no `@nativeCtx` marker is needed. expr-substrate Phase 8's `evalApply` is the
  // one EXCEPTION (ctx-only — it needs the live ctx), so the total-overlap claim
  // is scoped to the 4 *Eval natives.
  test("the 4 *Eval natives SHARE BOTH KEYS (both-maps-fallback); evalApply is ctx-only", () => {
    const plain = new Set(Object.keys(evaluatorStrategiesModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(evaluatorStrategiesModule.nativeImplsCtx ?? {}));
    expect([...plain].sort()).toEqual([...IDS].sort());
    expect([...ctx].sort()).toEqual([...ALL_FN_IDS].sort());
    for (const id of IDS) {
      expect(plain.has(id), `${id} must be in the plain map`).toBe(true);
      expect(ctx.has(id), `${id} must be in the ctx map`).toBe(true);
    }
    // The Phase-8 evalApply seam + the Phase-1 peEval/peFnSpec seams are
    // ctx-only: present in ctx, absent from plain.
    expect(ctx.has(EVAL_APPLY_ID)).toBe(true);
    expect(plain.has(EVAL_APPLY_ID)).toBe(false);
    expect(ctx.has(PE_EVAL_ID)).toBe(true);
    expect(plain.has(PE_EVAL_ID)).toBe(false);
    expect(ctx.has(PE_FNSPEC_ID)).toBe(true);
    expect(plain.has(PE_FNSPEC_ID)).toBe(false);
  });

  test("no ioHandlers / credentialRequirements (both native maps only)", () => {
    expect(evaluatorStrategiesModule.ioHandlers).toBeUndefined();
    expect(evaluatorStrategiesModule.credentialRequirements).toBeUndefined();
  });
});

describe("evaluator-strategies migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = evaluatorStrategiesModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function (incl. the Phase-8 evalApply)", () => {
    for (const n of ALL_NATIVE_NAMES) {
      expect(methodOf(insts, "Codeable", `evaluator-strategies:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Categorizable: every function categorized 'evaluator' (explicit @category, NOT the header default)", () => {
    for (const n of ALL_NATIVE_NAMES) {
      expect(methodOf(insts, "Categorizable", `evaluator-strategies:${n}`)).toEqual({ category: "evaluator" });
    }
  });

  test("Labelable: explicit @label preserved for all 4 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `evaluator-strategies:${n}`)).toEqual({ label: NATIVES[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for all 4 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Describable", `evaluator-strategies:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `evaluator-strategies:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("identity-facet counts: 7 Codeable/Labelable/Categorizable/Describable/Taggable (4 *Eval + evalApply + peEval + peFnSpec), 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(7);
    expect(counts.Labelable).toBe(7);
    expect(counts.Categorizable).toBe(7);
    expect(counts.Describable).toBe(7);
    expect(counts.Taggable).toBe(7);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("evaluator-strategies migration — Evaluator dispatch instances ride the seam", () => {
  const insts = evaluatorStrategiesModule.instances ?? [];

  test("the 4 `Evaluator <Strategy>` instances are present, keyed off the strategy tag", () => {
    for (const [strategy, evalId] of Object.entries(STRATEGIES)) {
      const inst = insts.find((i) => i.typeName === "Evaluator" && i.args[0] === strategy);
      expect(inst, `Evaluator ${strategy} must be present`).toBeDefined();
      expect((inst!.methods as Record<string, unknown>).eval).toEqual(evalId);
    }
    expect(insts.filter((i) => i.typeName === "Evaluator").length).toBe(4);
  });

  test("the 4 exported instance consts project the corresponding strategy tag", () => {
    expect(eagerEvaluatorInstance.typeName).toBe("Evaluator");
    expect(eagerEvaluatorInstance.args[0]).toBe("EagerStrategy");
    expect(lazyEvaluatorInstance.args[0]).toBe("LazyStrategy");
    expect(partialEvaluatorInstance.args[0]).toBe("PartialStrategy");
    expect(jitEvaluatorInstance.args[0]).toBe("JitStrategy");
  });

  test("the `*Native` + `evaluatorNatives` re-exports are preserved (the load-bearing direct readers)", () => {
    expect(typeof eagerEvalNative).toBe("function");
    expect(typeof lazyEvalNative).toBe("function");
    expect(typeof jitEvalNative).toBe("function");
    // evaluator-dispatch.test.ts builds its plain `natives` map from this.
    expect(Object.keys(evaluatorNatives).sort()).toEqual(NATIVE_NAMES.sort());
  });
});

describe("evaluator-strategies migration — end-to-end dual-dispatch through createRegistry", () => {
  const reg = createRegistry([evaluatorStrategiesModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of NATIVE_NAMES) {
      const id = `evaluator-strategies:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers includes native functions, actual strategy types and named instance values", () => {
    // Source bundle reflection includes all declaration kinds. Function wire
    // identities retain their legacy namespace; the named values and types
    // are ordinary members of the source container.
    expect(reg.listModuleMembers("evaluatorStrategies").sort()).toEqual([
      ...ALL_NATIVE_NAMES, ...Object.keys(STRATEGIES),
      "eagerEvaluatorInstance", "lazyEvaluatorInstance", "partialEvaluatorInstance", "jitEvaluatorInstance",
    ].sort());
    expect(reg.listModuleMembers("evaluator-strategies")).toEqual([]);
  });

  test("the registry context exposes BOTH native maps for all 4 ids (plain via `natives`, ctx via `nativesCtx`)", () => {
    const ctx = reg.evaluateContext();
    for (const id of IDS) {
      expect(typeof ctx.natives?.[id], `plain native present: ${id}`).toBe("function");
      expect(typeof ctx.nativesCtx?.[id], `ctx native present: ${id}`).toBe("function");
    }
  });

  // Each strategy dispatches through `applyOp` to an Ok-shaped result. eagerEval
  // has 2 params (expression, context), so a 2-arg call avoids currying; the
  // second arg is ignored by the ctx impl (which threads the REAL ctx). The arg
  // expression `{"+":[2,3]}` is eager-evaluated to 5 by applyOp, so each
  // strategy receives the concrete value and reduces it to Ok(5).
  test("all 4 strategies dispatch end-to-end through applyOp → Ok(5)", () => {
    const ctx = reg.evaluateContext();
    for (const n of NATIVE_NAMES) {
      const out = evaluate({ call: [n, { "+": [2, 3] }, 0] }, {}, ctx);
      expect(out, `${n} should reduce to Ok(5)`).toEqual({ $tag: "Ok", _0: 5 });
    }
  });

  // THE CRUX — `applyOp` STRICTLY prefers the ctx map when a fnId is in BOTH
  // (json-logic.ts ~L1470). Override both maps at the same id with distinct
  // sentinels and confirm the ctx sentinel is the one applyOp invokes.
  test("applyOp strictly prefers the ctx map for a both-maps id (ctx wins)", () => {
    const base = reg.evaluateContext();
    const id = "evaluator-strategies:eagerEval";
    const ctx: EvaluateContext = {
      ...base,
      natives: { ...base.natives, [id]: () => "PLAIN" },
      nativesCtx: { ...base.nativesCtx, [id]: () => "CTX" },
    };
    expect(evaluate({ call: ["eagerEval", 1, 2] }, {}, ctx)).toBe("CTX");
  });

  // The ctx impl genuinely re-enters the evaluator WITH the threaded ctx — it
  // reads `ctx._localData`, so a `{var: "x"}` rule resolves to the bound value.
  // The plain copy at the SAME id gets `ctx = undefined` → empty data → the same
  // rule resolves to its null fallback. This proves (a) the ctx native threads
  // and re-enters, and (b) the plain copy stays callable (the load-bearing
  // direct-reader contract), distinguishing the two impls behind one fnId.
  test("ctx native threads the ctx (reads _localData); the plain copy at the same id stays callable", () => {
    const base = reg.evaluateContext();
    const id = "evaluator-strategies:eagerEval";
    const ctxNative = base.nativesCtx![id]!;
    const plainNative = base.natives![id]!;
    const ctxWithData: EvaluateContext = { ...base, _localData: { x: 99 } };
    expect(ctxNative(ctxWithData, { var: "x" })).toEqual({ $tag: "Ok", _0: 99 });
    expect(plainNative({ var: "x" })).toEqual({ $tag: "Ok", _0: null });
  });
});
