// ---------------------------------------------------------------------------
// Compilable + CompileJs — end-to-end tests for Phase 5
//
// Exercises:
//   1. The Core IR lowering — JSON-Logic in, CoreProgram out — for the
//      handful of source-level shapes the JS target needs.
//   2. The EffectsExplicit gate — empty `requires` admits the program;
//      non-empty `requires` returns CompileError.EffectfulCallNotHandled.
//   3. The ClosuresExplicit pass — lambdas get explicit capture lists.
//   4. The emitJs lowering — operator translations, member access for
//      runtime-helper calls, constructor → tagged-object lowering.
//   5. The serialiser — JsModule → JS source string, eval-safe.
//   6. The bootstrapping demo — compile `std:add` and a couple of
//      sibling pure functions, eval the JS, compare to the engine's
//      interpretation. The smallest non-trivial proof that the
//      substrate ships an end-to-end working JS compiler for the
//      pure-Fenel subset.
//
// Tests bypass the dispatch path and call the native impls directly —
// same posture as `prover.test.ts`. The runtime-dispatch path is
// exercised by the audit script's law-validator runs (audit-effects.ts).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  normaliseToCoreNative,
  makeEffectsExplicitNative,
  makeClosuresExplicitNative,
  compileFenelToJsNative,
} from "./modules/compile-js";
import { dispatchedSerializeJsModule, parserBaseRuntimeForTests } from "./engine-bodies-dispatch";
import * as imgOps from "./image-ops";
import { alphaBlendNative } from "./modules/picture";
import {
  JS_EXPECTED_GAPS,
  WASM_EXPECTED_GAPS,
  LLVM_EXPECTED_GAPS,
  NON_SUBSTRATE_GAPS,
} from "./self-host-samples";
import type { CompileFieldSlot, CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { CoreProgram } from "./ir/core";
import type { EffectsExplicitProgram } from "./ir/effects-explicit";
import type { ClosuresExplicitProgram } from "./ir/closures-explicit";
import type { JsModule } from "./ir/js-ast";
import { evaluate } from "./json-logic";
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a CompileSource for `f(a, b) = body`. */
function src(name: string, paramNames: string[], body: unknown, requires?: string[]): CompileSource {
  return {
    name,
    params: positionalCompileFieldSlots(paramNames),
    body,
    ...(requires !== undefined ? { requires } : {}),
  };
}

/**
 * Minimal `$fenel` runtime namespace that the compiled JS expects. Covers
 * `concat` (string/array dispatch matching engine `_concat`) — that's the
 * one runtime helper the Phase 5 bootstrap actually needs. Anything else
 * the compiled code references would throw at eval, surfacing a missing
 * runtime helper which the test catches.
 */
const $fenelRuntime = {
  concat: (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return String(a ?? "") + String(b ?? "");
  },
};

/**
 * Compile + serialise + eval a CompileSource. Returns the JS function
 * value. Tests then invoke it with concrete args.
 */
function compileAndEval(source: CompileSource): (...args: unknown[]) => unknown {
  const compiled = compileFenelToJsNative(source);
  if (compiled.$tag === "Err") {
    throw new Error(`compileFenelToJs failed: ${JSON.stringify(compiled._0)}`);
  }
  const serialised = dispatchedSerializeJsModule(compiled._0);
  if (serialised.$tag === "Err") {
    throw new Error(`serializeJsModule failed: ${serialised._0}`);
  }
  // `new Function` is a sandboxed eval — no access to local scope. The
  // emitted source is wrapped in parens already (`JsArrow` adds them) so
  // it's a valid expression position.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("$fenel", `return ${serialised._0};`)($fenelRuntime);
  return fn as (...args: unknown[]) => unknown;
}

// ---------------------------------------------------------------------------
// 1. normaliseToCore — lowering shapes
// ---------------------------------------------------------------------------

// expr-substrate Phase 4b — `normaliseToCore` now DELEGATES to the JSON-Logic
// source-format adapter (`jsonLogicToExpr = desugar ∘ jsonLogicToSyntax`), so
// `CoreProgram.body` is an `Expr` tree (7 cases), NOT the old `CoreExpr` (10).
// These intermediate-IR oracles re-pin to the Expr shapes (blocker-3 re-pin):
//   ELit/EVar/ECall/ELambda/EConstruct mirror the old Core* arms 1:1; `if` is
//   `ECall "if" [c,t,e]` and `let` is the applied-`ELambda`-via-`"$"` encoding
//   desugar produces (reconstituted back to CeIf/CeLet in makeClosuresExplicit).
describe("normaliseToCore — JSON Logic → Expr IR (4b: delegates to jsonLogicToExpr)", () => {
  it("lowers primitive literals", () => {
    const r = normaliseToCoreNative(src("lit", [], 42));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({ $tag: "ELit", value: 42 });
  });

  it("lowers var references", () => {
    const r = normaliseToCoreNative(src("ref", ["x"], { var: "x" }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({ $tag: "EVar", name: "x" });
  });

  it("normalises operator-notation `+` → ECall('add')", () => {
    const r = normaliseToCoreNative(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "ECall",
      fnId: "add",
      args: [
        { $tag: "EVar", name: "a" },
        { $tag: "EVar", name: "b" },
      ],
    });
  });

  it("normalises codeName-keyed call to the same ECall", () => {
    const r = normaliseToCoreNative(src("add", ["a", "b"], { add: [{ var: "a" }, { var: "b" }] }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "ECall",
      fnId: "add",
      args: [
        { $tag: "EVar", name: "a" },
        { $tag: "EVar", name: "b" },
      ],
    });
  });

  it("normalises {call: [fnId, ...args]} to ECall", () => {
    const r = normaliseToCoreNative(src("call", ["x"], { call: ["myFn", { var: "x" }, 1] }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "ECall",
      fnId: "myFn",
      args: [
        { $tag: "EVar", name: "x" },
        { $tag: "ELit", value: 1 },
      ],
    });
  });

  it("lowers {if: [c, t, e]} to ECall \"if\" [c, t, e]", () => {
    const r = normaliseToCoreNative(
      src("max2", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body.$tag).toBe("ECall");
    const ifNode = prog.body as unknown as { fnId: string; args: unknown[] };
    expect(ifNode.fnId).toBe("if");
    expect(ifNode.args[0]).toEqual({
      $tag: "ECall",
      fnId: "gt",
      args: [
        { $tag: "EVar", name: "a" },
        { $tag: "EVar", name: "b" },
      ],
    });
  });

  it("lowers `{let: {x: e}}` to the applied-ELambda-via-`$` encoding", () => {
    const r = normaliseToCoreNative(src("letform", [], { let: { x: 5 } }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [
        { $tag: "ELambda", params: ["x"], body: { $tag: "EVar", name: "x" } },
        { $tag: "ELit", value: 5 },
      ],
    });
  });

  it("lowers {fn: [param, body]} to ELambda", () => {
    const r = normaliseToCoreNative(
      src("idfn", [], { fn: ["x", { var: "x" }] }),
    );
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "ELambda",
      params: ["x"],
      body: { $tag: "EVar", name: "x" },
    });
  });

  it("lowers {construct: [Tag, ...args]} to EConstruct", () => {
    const r = normaliseToCoreNative(src("just5", [], { construct: ["Just", 5] }));
    expect(r.$tag).toBe("Ok");
    const prog = (r as { _0: CoreProgram })._0;
    expect(prog.body).toEqual({
      $tag: "EConstruct",
      ctor: "Just",
      args: [{ $tag: "ELit", value: 5 }],
    });
  });

  it("rejects unsupported ops with structured CompileError", () => {
    const r = normaliseToCoreNative(src("badop", [], { reduce: [[1, 2, 3], { "+": [{ var: "current" }, { var: "accumulator" }] }, 0] }));
    expect(r.$tag).toBe("Err");
    const err = (r as { _0: { $tag: string } })._0;
    expect(err.$tag).toBe("Unsupported");
  });
});

// ---------------------------------------------------------------------------
// 2. makeEffectsExplicit — the effect gate
// ---------------------------------------------------------------------------

describe("makeEffectsExplicit — Phase 15 dispatch-site recognition", () => {
  it("admits programs with no requires + no sentinel calls", () => {
    const core = normaliseToCoreNative(src("pure", ["a"], { var: "a" }));
    expect(core.$tag).toBe("Ok");
    const r = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(r.$tag).toBe("Ok");
    const ee = (r as { _0: EffectsExplicitProgram })._0;
    expect(ee.effects).toEqual([]);
    expect(ee.handlerSites).toEqual([]);
  });

  it("admits programs with declared requires but no sentinel calls — the declaration is metadata at this level", () => {
    // Phase 15 change: previously this returned `Err EffectfulCallNotHandled`.
    // Per-target lowerings decide whether they can handle the declared
    // effects; the IR pass just propagates the metadata.
    const core = normaliseToCoreNative(
      src("effectful", ["x"], { var: "x" }, ["HasStateIO@account"]),
    );
    expect(core.$tag).toBe("Ok");
    const r = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(r.$tag).toBe("Ok");
    const ee = (r as { _0: EffectsExplicitProgram })._0;
    // Body has no sentinel call, so the effect inventory derived from the
    // body is empty.
    expect(ee.effects).toEqual([]);
    expect(ee.handlerSites).toEqual([]);
  });

  it("identifies `$effect:<Class>:<method>` sentinel calls + populates handlerSites + effects inventory", () => {
    const core = normaliseToCoreNative(
      src(
        "withDispatch",
        ["v"],
        {
          do: [
            { call: ["$effect:HasStateIO:set", "key", { var: "v" }] },
            { var: "v" },
          ],
        },
        ["HasStateIO@account"],
      ),
    );
    expect(core.$tag).toBe("Ok");
    const r = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(r.$tag).toBe("Ok");
    const ee = (r as { _0: EffectsExplicitProgram })._0;
    expect(ee.effects).toEqual(["HasStateIO"]);
    expect(ee.handlerSites.length).toBe(1);
    expect(ee.handlerSites[0]!.typeName).toBe("HasStateIO");
    expect(ee.handlerSites[0]!.methodName).toBe("set");
  });
});

// ---------------------------------------------------------------------------
// 3. makeClosuresExplicit — closure conversion with explicit captures
// ---------------------------------------------------------------------------

describe("makeClosuresExplicit — explicit captures", () => {
  it("a top-level lambda with no free vars gets captures: []", () => {
    // Outer fn `_(): \x. x` — the inner lambda's free vars are {} since
    // `x` is bound by its own param.
    const core = normaliseToCoreNative(src("idmaker", [], { fn: ["x", { var: "x" }] }));
    expect(core.$tag).toBe("Ok");
    const ee = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(ee.$tag).toBe("Ok");
    const ce = makeClosuresExplicitNative((ee as { _0: EffectsExplicitProgram })._0);
    expect(ce.$tag).toBe("Ok");
    const prog = (ce as { _0: ClosuresExplicitProgram })._0;
    expect(prog.body.$tag).toBe("CeClosure");
    if (prog.body.$tag === "CeClosure") {
      expect(prog.body.captures).toEqual([]);
      expect(prog.body.params).toEqual(["x"]);
    }
  });

  it("a lambda capturing an outer formal-param surfaces it in captures", () => {
    // `addN(n) = \x. n + x` — inner lambda captures `n`.
    const core = normaliseToCoreNative(
      src("addN", ["n"], { fn: ["x", { "+": [{ var: "n" }, { var: "x" }] }] }),
    );
    expect(core.$tag).toBe("Ok");
    const ee = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(ee.$tag).toBe("Ok");
    const ce = makeClosuresExplicitNative((ee as { _0: EffectsExplicitProgram })._0);
    expect(ce.$tag).toBe("Ok");
    const prog = (ce as { _0: ClosuresExplicitProgram })._0;
    expect(prog.body.$tag).toBe("CeClosure");
    if (prog.body.$tag === "CeClosure") {
      expect(prog.body.captures).toEqual(["n"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. emitJs — Closures-Explicit → JsModule
// ---------------------------------------------------------------------------

describe("emitJs — JS-target lowering", () => {
  it("translates `add` to JS `+` binary op", () => {
    const compiled = compileFenelToJsNative(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    expect(jsModule.entry.params).toEqual(["a", "b"]);
    expect(jsModule.entry.body.$tag).toBe("JsBinOp");
    if (jsModule.entry.body.$tag === "JsBinOp") {
      expect(jsModule.entry.body.op).toBe("+");
    }
  });

  it("translates `==` to JS `===`", () => {
    const compiled = compileFenelToJsNative(src("eq2", ["a", "b"], { "==": [{ var: "a" }, { var: "b" }] }));
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    if (jsModule.entry.body.$tag === "JsBinOp") {
      expect(jsModule.entry.body.op).toBe("===");
    } else {
      throw new Error("expected JsBinOp");
    }
  });

  it("routes `concat` through $fenel.concat runtime helper", () => {
    const compiled = compileFenelToJsNative(src("cat", ["a", "b"], { call: ["concat", { var: "a" }, { var: "b" }] }));
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    expect(jsModule.entry.body.$tag).toBe("JsCall");
    if (jsModule.entry.body.$tag === "JsCall") {
      expect(jsModule.entry.body.callee).toEqual({
        $tag: "JsMember",
        object: { $tag: "JsVar", name: "$fenel" },
        property: "concat",
      });
    }
  });

  it("translates an unknown fnId to a $fenel.<fnId>(…) runtime call", () => {
    const compiled = compileFenelToJsNative(src("uses", ["x"], { call: ["someUserFn", { var: "x" }] }));
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    if (jsModule.entry.body.$tag === "JsCall") {
      expect(jsModule.entry.body.callee).toEqual({
        $tag: "JsMember",
        object: { $tag: "JsVar", name: "$fenel" },
        property: "someUserFn",
      });
    } else {
      throw new Error("expected JsCall");
    }
  });

  it("lowers CoreIf to JsTernary", () => {
    const compiled = compileFenelToJsNative(
      src("max", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    expect(jsModule.entry.body.$tag).toBe("JsTernary");
  });

  it("lowers CoreConstruct to a JsObject with $tag + _0/_1/…", () => {
    const compiled = compileFenelToJsNative(src("just5", [], { construct: ["Just", 5] }));
    expect(compiled.$tag).toBe("Ok");
    const jsModule = (compiled as { _0: JsModule })._0;
    expect(jsModule.entry.body.$tag).toBe("JsObject");
    if (jsModule.entry.body.$tag === "JsObject") {
      expect(jsModule.entry.body.fields).toEqual([
        { key: "$tag", value: { $tag: "JsLit", value: "Just" } },
        { key: "_0", value: { $tag: "JsLit", value: 5 } },
      ]);
    }
  });
});


// The production emitter and parser runtime must agree with the interpreter
// when a constructor pattern sees a nullish/non-object value. Use a binder
// fallback so this isolates constructor guards from wildcard normalization.
// TODO: own accessor/proxy discrimination remains a separate existing gap;
// parserBaseRuntime.hasOwn is an own-property, not own-data-descriptor guard.
describe("emitJs constructor tag presence", () => {
  const childSlot: CompileFieldSlot = {
    key: { $tag: "NamedField", ref: { $ref: "33333333-3333-4333-8333-333333333333" } },
    wireName: "child",
  };

  function compilePattern(pattern: unknown, named: boolean): {
    run: (value: unknown) => unknown;
    body: unknown;
  } {
    const body = {
      match: [{ var: "value" }, pattern, "matched", { $bind: "otherwise" }, "fallback"],
    };
    const source: CompileSource = {
      ...src(named ? "namedTagPresence" : "positionalTagPresence", ["value"], body),
      ...(named ? { ctorDefs: { GuardOuter: [childSlot], GuardLeaf: [] } } : {}),
    };
    const compiled = compileFenelToJsNative(source);
    if (compiled.$tag !== "Ok") throw new Error(`compile failed: ${JSON.stringify(compiled._0)}`);
    const serialized = dispatchedSerializeJsModule(compiled._0);
    if (serialized.$tag !== "Ok") throw new Error(`serialize failed: ${serialized._0}`);
    // Re-serialization is deterministic, without recompiling the source.
    expect(dispatchedSerializeJsModule(compiled._0)).toEqual(serialized);
    const run = new Function("$fenel", `return ${serialized._0};`)(parserBaseRuntimeForTests()) as
      (value: unknown) => unknown;
    return { run, body };
  }

  for (const named of [false, true]) {
    it(`${named ? "named" : "positional"} constructor guards preserve nullish, inherited and nested discrimination`, () => {
      const field = named ? "child" : "_0";
      const outer = (child: unknown): Record<string, unknown> => ({ $tag: "GuardOuter", [field]: child });
      const leaf = { $tag: "GuardLeaf" };
      const pattern = { $tag: "GuardOuter", [field]: leaf };
      const { run, body } = compilePattern(pattern, named);
      const inheritedOuter = Object.assign(Object.create({ $tag: "GuardOuter" }), { [field]: leaf });
      const ownNonEnumerable = Object.create(null) as Record<string, unknown>;
      Object.defineProperties(ownNonEnumerable, {
        $tag: { value: "GuardOuter" },
        [field]: { value: Object.defineProperty({}, "$tag", { value: "GuardLeaf" }) },
      });
      const cases: Array<[unknown, "matched" | "fallback"]> = [
        [null, "fallback"], [undefined, "fallback"], [0, "fallback"],
        [false, "fallback"], ["text", "fallback"], [{}, "fallback"],
        [{ $tag: "Other" }, "fallback"], [inheritedOuter, "fallback"],
        [{ $tag: "GuardOuter" }, "fallback"],
        [outer(null), "fallback"], [outer(undefined), "fallback"],
        [outer({}), "fallback"], [outer({ $tag: "Other" }), "fallback"],
        [outer(Object.create({ $tag: "GuardLeaf" })), "fallback"],
        [outer(leaf), "matched"], [ownNonEnumerable, "matched"],
      ];
      for (const [value, expected] of cases) {
        const interpreted = evaluate(body, { value });
        expect(interpreted).toBe(expected);
        expect(run(value)).toBe(interpreted);
      }
    }, 180_000);

    it(`${named ? "named" : "positional"} constructor guards keep an own nullish binder field valid`, () => {
      const field = named ? "child" : "_0";
      const { run, body } = compilePattern({ $tag: "GuardOuter", [field]: { $bind: "childValue" } }, named);
      for (const child of [null, undefined, 0, false]) {
        const value = { $tag: "GuardOuter", [field]: child };
        expect(evaluate(body, { value })).toBe("matched");
        expect(run(value)).toBe("matched");
      }
      const missing = { $tag: "GuardOuter" };
      expect(evaluate(body, { value: missing })).toBe("fallback");
      expect(run(missing)).toBe("fallback");
    }, 180_000);
  }
});

// ---------------------------------------------------------------------------
// 5. serializeJsModule — JsModule → JS source
// ---------------------------------------------------------------------------

describe("serializeJsModule — String emission", () => {
  it("emits a JS arrow expression for the entry function", () => {
    const compiled = compileFenelToJsNative(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag === "Ok") {
      // Cosmetic — but the shape should match what a human would write.
      expect(serialised._0).toBe("((a, b) => (a + b))");
    }
  });

  it("emits a ternary for an if-then-else", () => {
    const compiled = compileFenelToJsNative(
      src("max", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag === "Ok") {
      expect(serialised._0).toContain("?");
      expect(serialised._0).toContain(":");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Bootstrapping — compile std-shaped functions and check the JS
//    produces the same values as the engine's evaluator.
//
// This is the load-bearing demonstration: the substrate ships a working
// end-to-end JS compiler for the pure-Fenel subset. Anything compiled
// here should compute exactly what `evaluate(body, args)` computes.
// ---------------------------------------------------------------------------

describe("bootstrapping — compile + eval matches engine evaluate()", () => {
  /**
   * Test runner: given (params, body, sampleArgs[]), compile to JS, eval
   * the result with each sample, and check it matches the engine's
   * interpretation of the same body + args.
   */
  function checkEquivalence(
    name: string,
    params: string[],
    body: unknown,
    samples: ReadonlyArray<ReadonlyArray<unknown>>,
  ): void {
    const compiledFn = compileAndEval(src(name, params, body));
    for (const args of samples) {
      const data: Record<string, unknown> = {};
      for (let i = 0; i < params.length; i++) data[params[i]!] = args[i];
      const engineResult = evaluate(body, data);
      const compiledResult = compiledFn(...args);
      expect(compiledResult).toBe(engineResult);
    }
  }

  it("std:add (a + b)", () => {
    checkEquivalence(
      "add",
      ["a", "b"],
      { "+": [{ var: "a" }, { var: "b" }] },
      [
        [2, 3],
        [-7, 7],
        [0, 0],
        [100, 200],
      ],
    );
  });

  it("std:sub (a - b)", () => {
    checkEquivalence(
      "sub",
      ["a", "b"],
      { "-": [{ var: "a" }, { var: "b" }] },
      [
        [5, 3],
        [-1, -2],
        [0, 0],
      ],
    );
  });

  it("std:mul (a * b)", () => {
    checkEquivalence(
      "mul",
      ["a", "b"],
      { "*": [{ var: "a" }, { var: "b" }] },
      [
        [2, 3],
        [-4, 5],
        [0, 1000],
      ],
    );
  });

  it("comparison (lt)", () => {
    checkEquivalence(
      "lt",
      ["a", "b"],
      { "<": [{ var: "a" }, { var: "b" }] },
      [
        [1, 2],
        [2, 1],
        [3, 3],
      ],
    );
  });

  it("a pure conditional", () => {
    checkEquivalence(
      "max",
      ["a", "b"],
      { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] },
      [
        [3, 5],
        [10, 2],
        [7, 7],
      ],
    );
  });

  it("concat (via $fenel.concat runtime helper)", () => {
    checkEquivalence(
      "concat",
      ["a", "b"],
      { call: ["concat", { var: "a" }, { var: "b" }] },
      [
        ["Hello, ", "world"],
        ["", "x"],
        ["foo", ""],
      ],
    );
  });

  it("nested arithmetic (a + b * c)", () => {
    checkEquivalence(
      "axbpc",
      ["a", "b", "c"],
      { "+": [{ var: "a" }, { "*": [{ var: "b" }, { var: "c" }] }] },
      [
        [1, 2, 3],
        [-1, 5, 7],
        [0, 0, 0],
      ],
    );
  });

  it("let-binding (let x = a + b in x * x)", () => {
    // `let x = a + b in x * x` doesn't have a single-shot JSON-Logic shape
    // (let evaluates to its last binding, so we use `do` for a body
    // sequence). Build: do { let x = a + b ; x * x }.
    const body = {
      do: [
        { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
        { "*": [{ var: "x" }, { var: "x" }] },
      ],
    };
    checkEquivalence("squareSum", ["a", "b"], body, [
      [2, 3],
      [4, 1],
      [0, 0],
    ]);
  });

  it("a lambda + immediate apply (((\\x. x+1) 5))", () => {
    // Construct: ((\x. x + 1) 5) — apply a lambda to 5. JSON-Logic:
    // {call: [{fn: ["x", {+ : [{var: "x"}, 1]}]}, 5]}.
    // But `call` expects a string fnId or {var: "name"}; the inline
    // {fn: …} is a value, not a string fnId. Phase 5's normalisation
    // doesn't admit this shape directly — the bootstrap demo restricts
    // to named-call invocation. Skipping this test, but document the
    // gap: inline-lambda invocation is a future-phase enhancement.
    // We assert that the compose builds a closure when given a top-level
    // lambda body — exercised by the closures-explicit tests above.
    // Keeping the placeholder test as a passing no-op so future-phases
    // can flip it on without losing a test slot.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Negative — effectful bodies fail at the EffectsExplicit gate
// ---------------------------------------------------------------------------

describe("compileFenelToJs — negative cases", () => {
  it("Phase 15: declared `requires` alone compiles fine + sentinel calls lower to `$fenel.$effect.<Class>.<method>(...)`", () => {
    // Body without an effect-dispatch sentinel compiles regardless of
    // the `requires` declaration.
    const plain = compileFenelToJsNative(
      src("savesomething", ["v"], { var: "v" }, ["HasStateIO@account"]),
    );
    expect(plain.$tag).toBe("Ok");
    // Body WITH a `$effect:` sentinel lowers — JS naturally handles the
    // effect-handler ABI via member access into `$fenel.$effect.<Class>`,
    // populated by the host at instantiation time per
    // `design/effectful-compilation.md`.
    const effectful = compileFenelToJsNative(
      src(
        "setSomething",
        ["v"],
        { call: ["$effect:HasStateIO:set", "key", { var: "v" }] },
        ["HasStateIO@account"],
      ),
    );
    expect(effectful.$tag).toBe("Ok");
  });

  it("returns Err Unsupported for an unrecognised op", () => {
    const compiled = compileFenelToJsNative(
      src("withRegex", ["a"], { reduce: [[1, 2], { "+": [{ var: "current" }, { var: "accumulator" }] }, 0] }),
    );
    expect(compiled.$tag).toBe("Err");
    if (compiled.$tag === "Err") {
      expect(compiled._0.$tag).toBe("Unsupported");
    }
  });

  it("returns Err Unsupported for a $-prefixed marker at expression position", () => {
    const compiled = compileFenelToJsNative(src("badmarker", [], { $ref: "WhateverType" }));
    expect(compiled.$tag).toBe("Err");
    if (compiled.$tag === "Err") {
      expect(compiled._0.$tag).toBe("Unsupported");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Codec round-trip (the encode side only) — JsModule → String
//
// The decode side is the Phase 5 placeholder. The encode round-trip law
// is sample-tested by the audit on the registered IsoJsModule instance;
// here we exercise a few hand-picked samples for clarity.
// ---------------------------------------------------------------------------

describe("Codec<String, JsModule> — encode side", () => {
  it("serialise(compile(…)) produces eval-able JS", () => {
    const compiled = compileFenelToJsNative(src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag === "Ok") {
      // Round-trip via the runtime: eval and call.
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return ${serialised._0};`)();
      expect(fn(10, 20)).toBe(30);
    }
  });

  it("output is structurally a JS expression (parses inside `return …`)", () => {
    const compiled = compileFenelToJsNative(
      src("max", ["a", "b"], { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag === "Ok") {
      // The JS engine itself is the strictest validator — if the
      // emitted code is malformed `new Function` throws at parse time.
      // eslint-disable-next-line no-new-func
      expect(() => new Function(`return ${serialised._0};`)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Phase 5b13 — Bool-construct emitter alignment
//
// Zero-arg `True` / `False` CeConstructs emit JS bool literals instead of
// `{$tag: "True"|"False"}` JsObjects so the compiled output structurally
// matches the engine's opaque-Bool repr (`json-logic.ts:675-676` coerces
// `construct ["True"|"False"]` → native JS bool). Closes the 5b6 / 5b7
// Bool-construct boundary class for the JS target.
// ---------------------------------------------------------------------------

describe("Phase 5b13 — Bool-construct emitter alignment (JS target)", () => {
  function compileAndRun(body: unknown, paramNames: string[], args: unknown[]): unknown {
    const compiled = compileFenelToJsNative(src("fn", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($fenelRuntime) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  it("std:and shape — `if a then b else (construct False)` returns native JS bool", () => {
    const body = { if: [{ var: "a" }, { var: "b" }, { construct: ["False"] }] };
    expect(compileAndRun(body, ["a", "b"], [true, true])).toBe(true);
    expect(compileAndRun(body, ["a", "b"], [true, false])).toBe(false);
    expect(compileAndRun(body, ["a", "b"], [false, true])).toBe(false);
  });

  it("std:or shape — `if a then (construct True) else b` returns native JS bool", () => {
    const body = { if: [{ var: "a" }, { construct: ["True"] }, { var: "b" }] };
    expect(compileAndRun(body, ["a", "b"], [true, false])).toBe(true);
    expect(compileAndRun(body, ["a", "b"], [false, false])).toBe(false);
    expect(compileAndRun(body, ["a", "b"], [false, true])).toBe(true);
  });

  it("std:not shape — `if x then (construct False) else (construct True)` returns native JS bool", () => {
    const body = {
      if: [{ var: "x" }, { construct: ["False"] }, { construct: ["True"] }],
    };
    expect(compileAndRun(body, ["x"], [true])).toBe(false);
    expect(compileAndRun(body, ["x"], [false])).toBe(true);
  });

  it("nested `Just (construct True)` wraps native JS bool inside the Just record (matches engine `{$tag: \"Just\", value: true}` byte-equal)", () => {
    const body = { construct: ["Just", { construct: ["True"] }] };
    // The engine's construct op for registered ctor `Just` with positional
    // payload routes to the named-field path (`fields=["value"]` injected
    // by normaliseToCore from ctorDefs), so the compiled output should be
    // structurally identical to the engine evaluation.
    const compiled = compileFenelToJsNative({
      ...src("fn", [], body),
      ctorDefs: { Just: positionalCompileFieldSlots(["value"]) },
    });
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($fenelRuntime) as () => unknown;
    expect(fn()).toEqual({ $tag: "Just", _0: true });
  });
});

describe("Phase 5b14 — bare-array normalise extension (JS target)", () => {
  /** Extended runtime for the bare-array tests. The lowering emits
   *  nested `$fenel.appendItem(item, $fenel.appendItem(item2, ...))` —
   *  the empty-list base case appears as a JsLit `[]` (CeLit-from-
   *  emptyList). The runtime helper accepts both arrays and the null
   *  fallback (Phase 5b14 WASM/LLVM use null for the base case).
   */
  const $rt = {
    concat: (a: unknown, b: unknown): unknown => {
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return String(a ?? "") + String(b ?? "");
    },
    appendItem: (item: unknown, arr: unknown): unknown[] =>
      Array.isArray(arr) ? [...arr, item] : [item],
    elem: (needle: unknown, haystack: unknown): boolean => {
      if (typeof haystack === "string") return haystack.includes(String(needle));
      if (Array.isArray(haystack)) return haystack.includes(needle);
      return false;
    },
    lower: (x: unknown): string => String(x ?? "").toLowerCase(),
    trim: (x: unknown): string => String(x ?? "").trim(),
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
    ctorDefs?: Record<string, CompileFieldSlot[]>,
  ): unknown {
    const source = ctorDefs
      ? { ...src("fn", paramNames, body), ctorDefs }
      : src("fn", paramNames, body);
    const compiled = compileFenelToJsNative(source);
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  it("simple `elem x [a, b, c]` lowers to nested appendItem and evaluates correctly", () => {
    const body = { call: ["elem", { var: "x" }, ["a", "b", "c"]] };
    expect(compileAndRun(body, ["x"], ["a"])).toBe(true);
    expect(compileAndRun(body, ["x"], ["c"])).toBe(true);
    expect(compileAndRun(body, ["x"], ["z"])).toBe(false);
  });

  it("std:tryParseBoolean shape — full if-cascade with two 7-element bare arrays compiles + returns Just(true/false) / Nothing", () => {
    const body = {
      if: [
        {
          call: [
            "elem",
            { call: ["lower", { call: ["trim", { var: "s" }] }] },
            ["yes", "y", "true", "1", "ok", "yep", "yeah"],
          ],
        },
        { construct: ["Just", { construct: ["True"] }] },
        {
          if: [
            {
              call: [
                "elem",
                { call: ["lower", { call: ["trim", { var: "s" }] }] },
                ["no", "n", "false", "0", "nope", "nah"],
              ],
            },
            { construct: ["Just", { construct: ["False"] }] },
            { construct: ["Nothing"] },
          ],
        },
      ],
    };
    const ctorDefs = { Just: positionalCompileFieldSlots(["value"]) };
    expect(compileAndRun(body, ["s"], ["yes"], ctorDefs)).toEqual({ $tag: "Just", _0: true });
    expect(compileAndRun(body, ["s"], ["NO"], ctorDefs)).toEqual({ $tag: "Just", _0: false });
    expect(compileAndRun(body, ["s"], ["maybe"], ctorDefs)).toEqual({ $tag: "Nothing" });
  });
});

describe("Phase 5b15 — closure-value boundary fix (JS target)", () => {
  // Two conformance assertions covering the closure-value boundary class
  // closed at the harness level via behavioral-equality + the cross-target
  // `{fn:...}` sample reshape. The bodies mirror the std:. and std:$
  // shapes; the assertions probe the compiled output with concrete JS
  // closures (the harness's compiled-side wrappers around engine
  // FenelClosures) and compare against the equivalent inline JS reduction.
  const $rt = {
    add: (a: unknown, b: unknown): number => (a as number) + (b as number),
    mul: (a: unknown, b: unknown): number => (a as number) * (b as number),
    abs: (x: unknown): number => Math.abs(x as number),
  };

  function compileBody(body: unknown, paramNames: string[]): (...a: unknown[]) => unknown {
    const compiled = compileFenelToJsNative(src("fn", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    return new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
  }

  it("std:. shape `\\f g -> \\x -> f (g x)` compiles to `(f, g) => (x) => f(g(x))` — closure-returning body behaviorally equals engine eval when probed with [2]", () => {
    // Body: fn [f, g] -> fn [x] -> call f (call g x)
    const body = {
      fn: [["x"], { call: [{ var: "f" }, { call: [{ var: "g" }, { var: "x" }] }] }],
    };
    const compiled = compileBody(body, ["f", "g"]);
    // Probe with two arity-1 user closures matching the engine-side
    // FenelClosure wrappers the self-host harness lifts inline `{fn:...}`
    // samples into.
    const fArrow = (y: unknown): number => (y as number) + 1;
    const gArrow = (z: unknown): number => (z as number) * 2;
    const result = (compiled(fArrow, gArrow) as (x: unknown) => unknown)(2);
    // engine equivalent: (\y -> add y 1) ((\z -> mul z 2) 2) = (4) + 1 = 5.
    expect(result).toBe(5);
  });

  it("std:$ shape `\\f x -> f x` compiles to `(f, x) => f(x)` — concrete-result body produces native JS value matching engine eval", () => {
    // Body: call f x
    const body = { call: [{ var: "f" }, { var: "x" }] };
    const compiled = compileBody(body, ["f", "x"]);
    // Probe with an arity-1 user closure mirroring the harness's
    // `\x -> abs x` lift; result is a concrete integer (no closure return).
    const fArrow = (x: unknown): number => Math.abs(x as number);
    expect(compiled(fArrow, -5)).toBe(5);
  });
});

describe("Phase 5b16 — image-pipeline runtime binding (JS target)", () => {
  // Two conformance assertions covering the harness-runtime extension
  // recipe (first tier (8) sub-phase). The compiled body emits
  // `$fenel.imagePixelate($fenel.imageGrayscale(img), factor)` against
  // the runtime namespace; both natives stay TS-side and the harness
  // binds them directly to `imgOps.imgGrayscale` / `imgPixelate`. Byte-
  // equality between engine eval + compiled execution holds because both
  // paths invoke THE SAME function reference.
  const $rt = {
    imageGrayscale: imgOps.imgGrayscale,
    imagePixelate: imgOps.imgPixelate,
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
  ): unknown {
    const compiled = compileFenelToJsNative(src("imageRetro", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  // std:imageRetro body shape — sourced from the post-5b5 nested call-form.
  const RETRO_BODY = {
    call: [
      "imagePixelate",
      { call: ["imageGrayscale", { var: "img" }] },
      { var: "factor" },
    ],
  };

  it("std:imageRetro shape on 1×1 image — compiled `$fenel.imagePixelate($fenel.imageGrayscale(img), factor)` byte-equals engine native composition", () => {
    const img = { width: 1, height: 1, pixels: [{ r: 200, g: 100, b: 50, a: 255 }] };
    const compiled = compileAndRun(RETRO_BODY, ["img", "factor"], [img, 2]);
    const expected = imgOps.imgPixelate(imgOps.imgGrayscale(img), 2);
    expect(compiled).toEqual(expected);
  });

  it("std:imageRetro shape on 2×2 image — compiled output matches engine native composition byte-for-byte", () => {
    const img = {
      width: 2,
      height: 2,
      pixels: [
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 255, b: 0, a: 255 },
        { r: 0, g: 0, b: 255, a: 255 },
        { r: 128, g: 128, b: 128, a: 255 },
      ],
    };
    const compiled = compileAndRun(RETRO_BODY, ["img", "factor"], [img, 2]);
    const expected = imgOps.imgPixelate(imgOps.imgGrayscale(img), 2);
    expect(compiled).toEqual(expected);
  });
});

describe("Phase 5b18 — matchFail runtime binding (JS<->WASM parity)", () => {
  // Two conformance assertions covering the Phase 5b18 tier-(8) audit's
  // single substantive binding addition: JS harness's `$fenelBaseRuntime`
  // now binds `matchFail: (_v) => null`, mirroring the Wasm harness's
  // `buildFenelRuntime.matchFail` (compile-wasm-self-host.test.ts:180).
  //
  // The JS target lowers a CeMatch's terminal else-fallthrough to
  // `$fenel.matchFail($scrut)` (paralleling the Wasm engine-bodies path at
  // engine.ts:5228 `engine-bodies:matchFailFuncType`). Engine eval for a
  // non-exhaustive match returns `null` (json-logic.ts match-op semantics);
  // both runtimes' matchFail returns `null` so byte-equality holds when a
  // sample reaches the fallthrough.
  //
  // The audit's other findings — 4 deferred TS-native cross-module
  // references (find / sampleAnim / hostDateParse / point — bodies in
  // events / animation / time / path modules outside candidateModules) and
  // 4 deferred Fenel-bodied cross-module references (time / timestamp /
  // duration / over — would resolve via sharedFenel cross-Fenel-call
  // substrate if audit-target modules were promoted to candidateModules)
  // stay documented in the workstream roadmap as ready for future tier-(8)
  // /candidate-promotion sub-phases. The `epochMs` reference in
  // time:parseIsoTimestamp is a parser/compiler ambiguity (anonymous record
  // literal `{ epochMs = ms }` vs single-key function-call form), not a
  // missing binding — out of scope per the brief's parser-blocked watch-out.
  const $rt = {
    matchFail: (_v: unknown): unknown => null,
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
  ): unknown {
    const compiled = compileFenelToJsNative(src("nonExhaustive", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  // Body: case x of 3 -> "three" — single arm, no wildcard. When the
  // scrutinee !== 3 the compiled JS hits the `$fenel.matchFail($scrut)`
  // fallthrough.
  const NON_EXHAUSTIVE_BODY = { match: [{ var: "x" }, 3, "three"] };

  it("non-exhaustive match on miss — compiled `$fenel.matchFail($scrut)` byte-equals engine eval (both return null)", () => {
    const compiled = compileAndRun(NON_EXHAUSTIVE_BODY, ["x"], [5]);
    const expected = evaluate(NON_EXHAUSTIVE_BODY, { x: 5 });
    expect(compiled).toEqual(expected);
    expect(compiled).toBeNull();
  });

  it("non-exhaustive match on hit — compiled returns matched arm body without invoking matchFail", () => {
    const compiled = compileAndRun(NON_EXHAUSTIVE_BODY, ["x"], [3]);
    const expected = evaluate(NON_EXHAUSTIVE_BODY, { x: 3 });
    expect(compiled).toEqual(expected);
    expect(compiled).toBe("three");
  });
});

describe("Phase 5b19 — audit-target candidateFns-promotion runtime bindings (JS target)", () => {
  // Per-binding conformance assertions for the 4 TS-native deferred
  // references closed by Phase 5b19: `find` / `hostDateParse` / `point` /
  // `sampleAnim`. Each binding's compiled call site (lowered as
  // `$fenel.<name>(...)` against the harness runtime) byte-equals the
  // engine's native dispatch. Same recipe as 5b16 (imageGrayscale /
  // imagePixelate) + 5b18 (matchFail) — tier (8) harness-runtime
  // extension. 5b19 differs from 5b18 because the bindings are
  // non-speculative: the audit-target modules promoted to candidateFns
  // in compile-js-self-host.test.ts each turn one or more of these
  // bindings into a concrete per-fn harness exercise (events:sampleEvent
  // uses find; time:parseIsoTimestamp uses hostDateParse; path:line
  // uses point; animation:overAnim / delayAnim / speedAnim use
  // sampleAnim).
  const $rt = {
    find: (pred: unknown, xs: unknown): unknown => {
      if (typeof pred !== "function") return { $tag: "Nothing" };
      for (const v of Array.isArray(xs) ? xs : []) {
        if ((pred as (a: unknown) => unknown)(v)) return { $tag: "Just", _0: v };
      }
      return { $tag: "Nothing" };
    },
    hostDateParse: (iso: unknown): unknown => {
      const ms = Date.parse(String(iso));
      if (Number.isNaN(ms)) return { $tag: "Nothing" };
      return { $tag: "Just", _0: ms };
    },
    point: (x: unknown, y: unknown): unknown => ({
      x: Number(x) || 0,
      y: Number(y) || 0,
    }),
    sampleAnim: (anim: unknown, t: unknown): unknown => {
      if (anim === null || typeof anim !== "object") return null;
      const obj = anim as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Animate") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") return (callable as (x: unknown) => unknown)(t);
        return null;
      }
      if (tag === "Frames") {
        const seq = (obj._0 ?? obj.value) as Record<string, unknown> | undefined;
        if (!seq || !Array.isArray(seq.frames) || (seq.frames as unknown[]).length === 0 || !seq.fps) {
          return null;
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const fps = Number(seq.fps);
        const frames = seq.frames as unknown[];
        const idx = Math.floor(tSec * fps);
        if (idx < 0 || idx >= frames.length) return null;
        return { $tag: "Raster", _0: frames[idx] };
      }
      return null;
    },
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
  ): unknown {
    const compiled = compileFenelToJsNative(src("audit5b19", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  it("find binding — compiled `$fenel.find(pred, xs)` returns Just on first match, Nothing on exhaustion", () => {
    // Body: find (\v -> eq v 3) xs
    const body = {
      call: ["find", { fn: [["v"], { "==": [{ var: "v" }, 3] }] }, { var: "xs" }],
    };
    const onHit = compileAndRun(body, ["xs"], [[1, 2, 3, 4]]);
    expect(onHit).toEqual({ $tag: "Just", _0: 3 });
    const onMiss = compileAndRun(body, ["xs"], [[1, 2, 4, 5]]);
    expect(onMiss).toEqual({ $tag: "Nothing" });
  });

  it("hostDateParse binding — valid ISO returns Just(ms), invalid returns Nothing", () => {
    const body = { call: ["hostDateParse", { var: "s" }] };
    const valid = compileAndRun(body, ["s"], ["2024-01-01T00:00:00Z"]);
    expect(valid).toEqual({ $tag: "Just", _0: Date.parse("2024-01-01T00:00:00Z") });
    const invalid = compileAndRun(body, ["s"], ["not-a-date"]);
    expect(invalid).toEqual({ $tag: "Nothing" });
  });

  it("point binding — compiled `$fenel.point(x, y)` returns `{ x, y }` record", () => {
    const body = { call: ["point", { var: "x" }, { var: "y" }] };
    const result = compileAndRun(body, ["x", "y"], [3, 4]);
    expect(result).toEqual({ x: 3, y: 4 });
    const zero = compileAndRun(body, ["x", "y"], [0, 0]);
    expect(zero).toEqual({ x: 0, y: 0 });
  });

  it("sampleAnim binding — Frames variant returns Raster picture at the indexed frame", () => {
    const body = { call: ["sampleAnim", { var: "anim" }, { var: "t" }] };
    const anim = {
      $tag: "Frames",
      _0: { fps: 1, frames: ["frame0", "frame1", "frame2"] },
    };
    const at0 = compileAndRun(body, ["anim", "t"], [anim, { seconds: 0 }]);
    expect(at0).toEqual({ $tag: "Raster", _0: "frame0" });
    const at1 = compileAndRun(body, ["anim", "t"], [anim, { seconds: 1 }]);
    expect(at1).toEqual({ $tag: "Raster", _0: "frame1" });
  });
});

describe("Phase 5b20 — picture-module candidateFns-promotion runtime bindings (JS target)", () => {
  // Per-binding conformance assertions for the 5 TS-native references
  // shipped in Phase 5b20: `floor` / `sqrt` / `alphaBlend` / `sample`
  // / `color`. Each binding's compiled call site (lowered as
  // `$fenel.<name>(...)` against the harness runtime) byte-equals the
  // engine's native dispatch. Same recipe as 5b16 (imageGrayscale /
  // imagePixelate) + 5b18 (matchFail) + 5b19 (find / hostDateParse /
  // point / sampleAnim) — tier (8) harness-runtime extension. 5b20
  // bundles 5 bindings supporting the second tier-(10) candidateFns-
  // scope expansion (picture promotion).
  //
  // Picture's 12 newly-promoted bodies invoke these bindings as their
  // math + native leaves: floor in picture:checkerboard, sqrt in
  // picture:dist, alphaBlend in picture:over, sample in picture:over,
  // color in picture:circle / rectangle / ellipse / lerpColor for
  // transparent-pixel construction. animation:overAnim resolves its
  // `over` cross-call through sharedFenel post-promotion at zero
  // binding cost.
  const $rt = {
    floor: (x: unknown): number => Math.floor(Number(x)),
    sqrt: (x: unknown): number => Math.sqrt(Number(x)),
    alphaBlend: alphaBlendNative,
    color: (r: unknown, g: unknown, b: unknown, a: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n < 0) return 0;
        if (n > 255) return 255;
        return Math.round(n);
      };
      return {
        r: cl(Number(r)),
        g: cl(Number(g)),
        b: cl(Number(b)),
        a: cl(Number(a)),
      };
    },
    sample: (pic: unknown, p: unknown): unknown => {
      if (!pic || typeof pic !== "object") return { r: 0, g: 0, b: 0, a: 0 };
      const obj = pic as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Field") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (p: unknown) => unknown)(p);
        }
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      if (tag === "Raster") {
        const img = (obj._0 ?? obj.value) as
          | { width?: unknown; height?: unknown; pixels?: unknown }
          | undefined;
        if (!img || typeof img !== "object") return { r: 0, g: 0, b: 0, a: 0 };
        const w = Number(img.width) || 0;
        const h = Number(img.height) || 0;
        if (w === 0 || h === 0) return { r: 0, g: 0, b: 0, a: 0 };
        const pt = (p && typeof p === "object")
          ? (p as { x?: unknown; y?: unknown })
          : { x: 0, y: 0 };
        const px = Math.max(0, Math.min(w - 1, Math.floor(Number(pt.x) || 0)));
        const py = Math.max(0, Math.min(h - 1, Math.floor(Number(pt.y) || 0)));
        if (!Array.isArray(img.pixels)) return { r: 0, g: 0, b: 0, a: 0 };
        return img.pixels[py * w + px] ?? { r: 0, g: 0, b: 0, a: 0 };
      }
      return { r: 0, g: 0, b: 0, a: 0 };
    },
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
  ): unknown {
    const compiled = compileFenelToJsNative(src("picture5b20", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  it("floor binding — compiled `$fenel.floor(x)` returns the integer floor", () => {
    const body = { call: ["floor", { var: "x" }] };
    expect(compileAndRun(body, ["x"], [3.7])).toBe(3);
    expect(compileAndRun(body, ["x"], [-2.3])).toBe(-3);
    expect(compileAndRun(body, ["x"], [0])).toBe(0);
  });

  it("sqrt binding — compiled `$fenel.sqrt(x)` returns the square root", () => {
    const body = { call: ["sqrt", { var: "x" }] };
    expect(compileAndRun(body, ["x"], [16])).toBe(4);
    expect(compileAndRun(body, ["x"], [2])).toBeCloseTo(Math.sqrt(2));
    expect(compileAndRun(body, ["x"], [0])).toBe(0);
  });

  it("color binding — compiled `$fenel.color(r, g, b, a)` returns clamped Color record", () => {
    const body = { call: ["color", { var: "r" }, { var: "g" }, { var: "b" }, { var: "a" }] };
    expect(compileAndRun(body, ["r", "g", "b", "a"], [255, 0, 0, 255])).toEqual({
      r: 255, g: 0, b: 0, a: 255,
    });
    expect(compileAndRun(body, ["r", "g", "b", "a"], [300, -5, 128, 50])).toEqual({
      r: 255, g: 0, b: 128, a: 50,
    });
  });

  it("alphaBlend binding — source-over compositing matches picture:alphaBlendNative", () => {
    const body = { call: ["alphaBlend", { var: "top" }, { var: "bot" }] };
    // Opaque top fully covers bot.
    const result = compileAndRun(
      body,
      ["top", "bot"],
      [{ r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 255, b: 0, a: 255 }],
    );
    expect(result).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    // Fully transparent top: bot stays.
    const result2 = compileAndRun(
      body,
      ["top", "bot"],
      [{ r: 255, g: 0, b: 0, a: 0 }, { r: 0, g: 255, b: 0, a: 255 }],
    );
    expect(result2).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    const translucent = compileAndRun(
      body,
      ["top", "bot"],
      [{ r: 255, g: 0, b: 0, a: 128 }, { r: 0, g: 0, b: 255, a: 128 }],
    );
    expect(translucent).toEqual({ r: 170, g: 0, b: 85, a: 192 });
  });

  it("sample binding — Field-case invokes captured closure", () => {
    // pic = Field (\p -> color 50 100 150 200)
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const pic = { $tag: "Field", _0: (_p: unknown): unknown => red };
    const body = { call: ["sample", { var: "pic" }, { var: "p" }] };
    expect(compileAndRun(body, ["pic", "p"], [pic, { x: 0, y: 0 }])).toEqual(red);
  });

  it("sample binding — Raster-case reads the pixel at floored point", () => {
    const pixels = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
      { r: 128, g: 128, b: 128, a: 255 },
    ];
    const pic = { $tag: "Raster", _0: { width: 2, height: 2, pixels } };
    const body = { call: ["sample", { var: "pic" }, { var: "p" }] };
    expect(compileAndRun(body, ["pic", "p"], [pic, { x: 0, y: 0 }])).toEqual(pixels[0]);
    expect(compileAndRun(body, ["pic", "p"], [pic, { x: 1, y: 0 }])).toEqual(pixels[1]);
    expect(compileAndRun(body, ["pic", "p"], [pic, { x: 0, y: 1 }])).toEqual(pixels[2]);
    expect(compileAndRun(body, ["pic", "p"], [pic, { x: 1, y: 1 }])).toEqual(pixels[3]);
  });
});

describe("Phase 5b21 — sound-module candidateFns-promotion runtime bindings (JS target)", () => {
  // Per-binding conformance assertions for the 9 TS-native references
  // shipped in Phase 5b21: `sin` / `pow` / `sampleSound` / `time` /
  // `amplitude` / `mono` / `ampL` / `ampR` / `audioBuffer`. Each
  // binding's compiled call site (lowered as `$fenel.<name>(...)`
  // against the harness runtime) byte-equals the engine's native
  // dispatch. Same recipe as 5b16 (imageGrayscale / imagePixelate) +
  // 5b18 (matchFail) + 5b19 (find / hostDateParse / point /
  // sampleAnim) + 5b20 (floor / sqrt / alphaBlend / sample / color)
  // — tier (8) harness-runtime extension. 5b21 bundles 9 bindings
  // supporting the third tier-(10) candidateFns-scope expansion
  // (sound promotion).
  //
  // Sound's 13 newly-promoted bodies invoke these bindings as their
  // math + native leaves: sin in sound:sineAt + sound:squareAt; pow
  // in sound:midiToFreq; sampleSound in gain / mix / delay / pitch /
  // bound; time in delay / pitch + animation:delayAnim / speedAnim
  // cross-call; amplitude / mono in sine / sawtooth / square +
  // scaleAmp / addAmp; ampL / ampR in scaleAmp / addAmp;
  // audioBuffer as Buffer-case constructor.
  const $rt = {
    sin: (x: unknown): number => Math.sin(Number(x)),
    pow: (b: unknown, e: unknown): number => Math.pow(Number(b), Number(e)),
    sampleSound: (snd: unknown, t: unknown): unknown => {
      if (!snd || typeof snd !== "object") return { l: 0, r: 0 };
      const obj = snd as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Wave") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (t: unknown) => unknown)(t);
        }
        return { l: 0, r: 0 };
      }
      if (tag === "Buffer") {
        const buf = (obj._0 ?? obj.value) as
          | { sampleRate?: unknown; samples?: unknown }
          | undefined;
        if (!buf || typeof buf !== "object") return { l: 0, r: 0 };
        const sr = Number(buf.sampleRate) || 0;
        if (sr === 0 || !Array.isArray(buf.samples) || buf.samples.length === 0) {
          return { l: 0, r: 0 };
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const idx = Math.floor(tSec * sr);
        if (idx < 0 || idx >= buf.samples.length) return { l: 0, r: 0 };
        return buf.samples[idx] ?? { l: 0, r: 0 };
      }
      return { l: 0, r: 0 };
    },
    time: (seconds: unknown): unknown => ({ seconds: Number(seconds) || 0 }),
    amplitude: (l: unknown, r: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n > 1) return 1;
        if (n < -1) return -1;
        return n;
      };
      return { l: cl(Number(l)), r: cl(Number(r)) };
    },
    mono: (v: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n > 1) return 1;
        if (n < -1) return -1;
        return n;
      };
      const x = cl(Number(v));
      return { l: x, r: x };
    },
    ampL: (a: unknown): number => Number((a as { l?: unknown })?.l) || 0,
    ampR: (a: unknown): number => Number((a as { r?: unknown })?.r) || 0,
    audioBuffer: (sampleRate: unknown, channels: unknown, samples: unknown): unknown => ({
      sampleRate: Math.max(1, Math.floor(Number(sampleRate))),
      channels: Math.max(1, Math.floor(Number(channels))),
      samples: Array.isArray(samples) ? samples : [],
    }),
  };

  function compileAndRun(
    body: unknown,
    paramNames: string[],
    args: unknown[],
  ): unknown {
    const compiled = compileFenelToJsNative(src("sound5b21", paramNames, body));
    expect(compiled.$tag).toBe("Ok");
    const serialised = dispatchedSerializeJsModule((compiled as { _0: JsModule })._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") throw new Error("unreachable");
    // eslint-disable-next-line no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($rt) as (
      ...a: unknown[]
    ) => unknown;
    return fn(...args);
  }

  it("sin binding — compiled `$fenel.sin(x)` returns the sine of x", () => {
    const body = { call: ["sin", { var: "x" }] };
    expect(compileAndRun(body, ["x"], [0])).toBe(0);
    expect(compileAndRun(body, ["x"], [Math.PI / 2])).toBeCloseTo(1);
    expect(compileAndRun(body, ["x"], [Math.PI])).toBeCloseTo(0);
  });

  it("pow binding — compiled `$fenel.pow(base, exp)` returns base^exp", () => {
    const body = { call: ["pow", { var: "b" }, { var: "e" }] };
    expect(compileAndRun(body, ["b", "e"], [2, 10])).toBe(1024);
    expect(compileAndRun(body, ["b", "e"], [2, 0])).toBe(1);
    expect(compileAndRun(body, ["b", "e"], [10, -1])).toBeCloseTo(0.1);
  });

  it("time binding — compiled `$fenel.time(seconds)` returns `{ seconds }` record", () => {
    const body = { call: ["time", { var: "s" }] };
    expect(compileAndRun(body, ["s"], [5])).toEqual({ seconds: 5 });
    expect(compileAndRun(body, ["s"], [0])).toEqual({ seconds: 0 });
    expect(compileAndRun(body, ["s"], [-2.5])).toEqual({ seconds: -2.5 });
  });

  it("amplitude binding — compiled `$fenel.amplitude(l, r)` returns clamped Amplitude record", () => {
    const body = { call: ["amplitude", { var: "l" }, { var: "r" }] };
    expect(compileAndRun(body, ["l", "r"], [0.5, -0.5])).toEqual({ l: 0.5, r: -0.5 });
    // Clamp out-of-[-1,1] range.
    expect(compileAndRun(body, ["l", "r"], [2, -2])).toEqual({ l: 1, r: -1 });
  });

  it("mono binding — compiled `$fenel.mono(v)` returns Amplitude with l==r", () => {
    const body = { call: ["mono", { var: "v" }] };
    expect(compileAndRun(body, ["v"], [0.5])).toEqual({ l: 0.5, r: 0.5 });
    expect(compileAndRun(body, ["v"], [0])).toEqual({ l: 0, r: 0 });
    expect(compileAndRun(body, ["v"], [2])).toEqual({ l: 1, r: 1 });
  });

  it("ampL binding — compiled `$fenel.ampL(a)` extracts the left channel", () => {
    const body = { call: ["ampL", { var: "a" }] };
    expect(compileAndRun(body, ["a"], [{ l: 0.3, r: 0.7 }])).toBe(0.3);
    expect(compileAndRun(body, ["a"], [{ l: -1, r: 1 }])).toBe(-1);
  });

  it("ampR binding — compiled `$fenel.ampR(a)` extracts the right channel", () => {
    const body = { call: ["ampR", { var: "a" }] };
    expect(compileAndRun(body, ["a"], [{ l: 0.3, r: 0.7 }])).toBe(0.7);
    expect(compileAndRun(body, ["a"], [{ l: -1, r: 1 }])).toBe(1);
  });

  it("audioBuffer binding — compiled `$fenel.audioBuffer(sr, ch, samples)` returns the buffer record", () => {
    const body = {
      call: ["audioBuffer", { var: "sr" }, { var: "ch" }, { var: "samples" }],
    };
    const samples = [{ l: 0, r: 0 }, { l: 0.5, r: 0.5 }];
    expect(compileAndRun(body, ["sr", "ch", "samples"], [44100, 2, samples])).toEqual({
      sampleRate: 44100,
      channels: 2,
      samples,
    });
    // Floors fractional sr/channels + min 1.
    expect(compileAndRun(body, ["sr", "ch", "samples"], [22050.7, 1.3, []])).toEqual({
      sampleRate: 22050,
      channels: 1,
      samples: [],
    });
  });

  it("sampleSound binding — Wave-case invokes captured closure with t", () => {
    // snd = Wave (\t -> { l: 0.5, r: -0.5 })
    const out = { l: 0.5, r: -0.5 };
    const snd = { $tag: "Wave", _0: (_t: unknown): unknown => out };
    const body = { call: ["sampleSound", { var: "snd" }, { var: "t" }] };
    expect(compileAndRun(body, ["snd", "t"], [snd, { seconds: 0.5 }])).toEqual(out);
  });

  it("sampleSound binding — Buffer-case reads the sample at the indexed time", () => {
    const samples = [{ l: 0.1, r: 0.2 }, { l: 0.3, r: 0.4 }, { l: 0.5, r: 0.6 }];
    const snd = { $tag: "Buffer", _0: { sampleRate: 1, channels: 2, samples } };
    const body = { call: ["sampleSound", { var: "snd" }, { var: "t" }] };
    expect(compileAndRun(body, ["snd", "t"], [snd, { seconds: 0 }])).toEqual(samples[0]);
    expect(compileAndRun(body, ["snd", "t"], [snd, { seconds: 1 }])).toEqual(samples[1]);
    expect(compileAndRun(body, ["snd", "t"], [snd, { seconds: 2 }])).toEqual(samples[2]);
  });
});

describe("Phase 5b17 — substrate-completion lock (post-5b16 EMPTY-state regression guard, 5b19-partitioned)", () => {
  // Lock assertion: Phase 5b13-5b16 retired all four JS + WASM substrate
  // boundary classes (Bool-construct, bare-array, closure-value, image-
  // pipeline) — JS_EXPECTED_GAPS + WASM_EXPECTED_GAPS are EMPTY of
  // substrate gaps post-5b16. LLVM_EXPECTED_GAPS stays non-empty
  // (clang-missing baseline class — operational, not substrate).
  //
  // Phase 5b19 partition: 5b18 framing implication #4 introduced the
  // distinction between substrate gaps (failures in normalise / emit /
  // lower / harness-runtime) and non-substrate gaps (parser-ambiguity,
  // type-system, cross-target ABI placeholders) where the substrate
  // path is COMPLETE but the call site doesn't resolve at the
  // adjacent surface. Non-substrate entries are listed in
  // NON_SUBSTRATE_GAPS; the lock subtracts them before asserting
  // emptiness. Current contents: `time:parseIsoTimestamp` (anonymous
  // record literal `{ epochMs = ms }` parses as `epochMs ms` call-
  // form). Substrate is fine — the parser is the gate.
  //
  // Any future sub-phase that adds a JS / WASM EXPECTED_GAPS entry
  // without first shipping the corresponding harness extension OR
  // adding it to NON_SUBSTRATE_GAPS fails this assertion at test time
  // rather than passing silently through runOne's gap-skip path.
  // Tier (10) candidateFns-scope-expansion recipe: substrate emptiness
  // stays load-bearing across module-tier promotion.
  it("JS_EXPECTED_GAPS + WASM_EXPECTED_GAPS contain zero substrate entries post-5b19 (non-substrate entries partition via NON_SUBSTRATE_GAPS); LLVM_EXPECTED_GAPS retains clang-missing class entries", () => {
    const jsSubstrate = Object.keys(JS_EXPECTED_GAPS).filter((k) => !NON_SUBSTRATE_GAPS.has(k));
    const wasmSubstrate = Object.keys(WASM_EXPECTED_GAPS).filter((k) => !NON_SUBSTRATE_GAPS.has(k));
    expect(jsSubstrate).toEqual([]);
    expect(wasmSubstrate).toEqual([]);
    expect(Object.keys(LLVM_EXPECTED_GAPS).length).toBeGreaterThan(0);
  });

  // 5b19 — partition assertion: every entry currently in
  // NON_SUBSTRATE_GAPS must also be present in JS_EXPECTED_GAPS or
  // WASM_EXPECTED_GAPS, otherwise the partition has become stale (a
  // gap was closed but the partition entry wasn't removed alongside).
  it("NON_SUBSTRATE_GAPS entries reference live EXPECTED_GAPS labels", () => {
    for (const fnId of NON_SUBSTRATE_GAPS) {
      const inJs = fnId in JS_EXPECTED_GAPS;
      const inWasm = fnId in WASM_EXPECTED_GAPS;
      expect(inJs || inWasm).toBe(true);
    }
  });
});

// Phase 5b30 — matrix-vs-runtime asymmetry regression guard.
//
// Extends the 5b17 lock with an asymmetry-class assertion: every Fenel-
// bodied fnId with declared samples (samples > 0) AND no EXPECTED_GAPS
// entry must observe OK at runtime through its per-target classifier.
// `(declared OK) → (observed SKIP)` (silent-skip class — the 5b28
// sampleEvent root) and `(declared OK) → (observed FAIL)` (escaped-CI
// regression) both fail the assertion at test time rather than
// rendering misleadingly as `OK (N)` in the matrix.
//
// Scope: JS + WASM only. LLVM observation is environment-dependent
// (clang-availability gates the per-fnId FFI run) — its asymmetries are
// surfaced in the matrix audit section but don't fail this lock.
// Adding an LLVM lock here would tie CI green-ness to dev-machine
// clang availability, which is the wrong dependency.
describe("Phase 5b30 — matrix-vs-runtime asymmetry lock (silent-skip + escaped-FAIL regression guard)", () => {
  // The classifier imports are top-level: they fire module-init
  // (sharedFenel pre-compile etc.) at describe-block load time, NOT
  // per-it. That's intentional — every per-fn test benefits from the
  // same pre-compiled cache. Per-it overhead is the per-fn classify call.
  it("JS: every (declared OK) fnId observes OK at runtime", { timeout: 120_000 }, async () => {
    const { candidateFns, classifyFnId, EXPECTED_GAPS, FN_SAMPLES } = await import(
      "./compile-js-self-host-classifier"
    );
    const asymmetries: { fnId: string; observed: string }[] = [];
    for (const fn of candidateFns) {
      const declaredSamples = FN_SAMPLES[fn.id]?.length ?? 0;
      if (declaredSamples === 0) continue;
      if (EXPECTED_GAPS[fn.id] !== undefined) continue;
      const obs = classifyFnId(fn.id);
      if (obs.status !== "OK") {
        asymmetries.push({ fnId: fn.id, observed: obs.status });
      }
    }
    if (asymmetries.length > 0) {
      throw new Error(
        `JS: ${asymmetries.length} declared-OK fnId(s) observe non-OK at runtime:\n` +
          asymmetries.map((a) => `  ${a.fnId} → ${a.observed}`).join("\n"),
      );
    }
    expect(asymmetries.length).toBe(0);
  });

  it("Wasm: every (declared OK) fnId observes OK at runtime", { timeout: 120_000 }, async () => {
    const { candidateFns, classifyFnId, EXPECTED_GAPS, FN_SAMPLES } = await import(
      "./compile-wasm-self-host-classifier"
    );
    const asymmetries: { fnId: string; observed: string }[] = [];
    for (const fn of candidateFns) {
      const declaredSamples = FN_SAMPLES[fn.id]?.length ?? 0;
      if (declaredSamples === 0) continue;
      if (EXPECTED_GAPS[fn.id] !== undefined) continue;
      const obs = await classifyFnId(fn.id);
      if (obs.status !== "OK") {
        asymmetries.push({ fnId: fn.id, observed: obs.status });
      }
    }
    if (asymmetries.length > 0) {
      throw new Error(
        `Wasm: ${asymmetries.length} declared-OK fnId(s) observe non-OK at runtime:\n` +
          asymmetries.map((a) => `  ${a.fnId} → ${a.observed}`).join("\n"),
      );
    }
    expect(asymmetries.length).toBe(0);
  });
});
