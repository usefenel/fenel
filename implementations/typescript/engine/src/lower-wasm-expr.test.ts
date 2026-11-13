// ---------------------------------------------------------------------------
// Phase 21.7 commit 3 + 4 — `lowerWasmExpr` substrate test.
//
// Validates the per-CeExpr Fenel-bodied lowering pipeline end-to-end:
//
//   1. `engine:lowerWasmExpr` and `engine:lowerExprWithTarget` are
//      registered with Fenel bodies parsed from `lower-to-wasm-ast.
//      fenel`; the registry resolves the function ids and the dispatch
//      wrappers invoke their bodies via `evaluate()`.
//   2. The bodies' bare-codeName calls to `internString` /
//      `internImport` / `lookupLocal` / `allocLocal` resolve through
//      `ctx.natives` populated by the per-call dispatch wrapper. State
//      mutation on the underlying ModuleBuilder + locals map is
//      observable from the test.
//   3. CeLit emits the expected (WasmInstr[], WasmDomain) shape for
//      each of the 5 JS value-type arms (number, boolean, null, string,
//      unsupported). [commit 3]
//   4. CeVar emits the expected `(LocalGet idx, domain)` shape when the
//      name is in scope; emits Err Unsupported when out of scope; and
//      [commit 4] emits the head-LocalGet + per-segment-getFieldNamed
//      chain for dotted access.
//   5. [commit 4] CeIf, CeDo, CeLet emit the structurally-correct
//      composition of their children's instructions, with coerceDomain
//      inserting box/unbox helpers at each target-mismatched boundary.
//      The substrate exercises allocLocal (CeLet) and inferBranchDom
//      (CeIf).
//   6. The result Ok / Err discriminants match what the TS oracle
//      (compile-wasm.ts:lowerExprInternal) produces for the same inputs.
//      This is NOT the full byte-equality gate (that ships with the
//      top-level program-lowering entry in a follow-on commit); it's
//      the focused substrate gate that ALL future arms lean on.
//
// Future commits port the remaining 5 CeExpr arms (CeCall, CeClosure,
// CeConstruct, CeRecord, CeMatch). Each will reuse the same dispatch
// substrate and add per-arm cases here or in a sibling test file.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  dispatchedLowerWasmExpr,
  dispatchedLowerExprWithTarget,
  newLowerWasmExprState,
  seedLocal,
  type LowerWasmExprResult,
} from "./engine-bodies-dispatch";
// Tiny shorthand for inline expectations: a CeExpr literal value of the
// given JS-side $tag + fields. The Fenel body's case patterns read $tag,
// so we construct in the same shape the makeClosuresExplicit pass would.
function ceLit(value: unknown): { $tag: "CeLit"; value: unknown } {
  return { $tag: "CeLit", value };
}

function ceVar(name: string): { $tag: "CeVar"; name: string } {
  return { $tag: "CeVar", name };
}

function ceIf(
  cond: unknown,
  then_: unknown,
  else_: unknown,
): { $tag: "CeIf"; cond: unknown; then: unknown; else: unknown } {
  return { $tag: "CeIf", cond, then: then_, else: else_ };
}

function ceDo(exprs: unknown[]): { $tag: "CeDo"; exprs: unknown[] } {
  return { $tag: "CeDo", exprs };
}

function ceLet(
  bindings: { name: string; value: unknown }[],
  body: unknown,
): { $tag: "CeLet"; bindings: { name: string; value: unknown }[]; body: unknown } {
  return { $tag: "CeLet", bindings, body };
}

function asOk(r: LowerWasmExprResult): {
  $tag: "LowerOutput";
  instrs: unknown[];
  domain: { $tag: string };
} {
  if (r.$tag !== "Ok") {
    throw new Error(
      `expected Ok, got Err: ${JSON.stringify(r._0)}`,
    );
  }
  return r._0;
}

describe("lowerWasmExpr — CeLit arms (Phase 21.7 commit 3)", () => {
  it("CeLit number → F64Const + DomNum", () => {
    const r = dispatchedLowerWasmExpr(ceLit(42) as never);
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "F64Const", value: 42 }]);
    expect(out.domain).toEqual({ $tag: "DomNum" });
  });

  it("CeLit true → I32Const 1 + DomBool", () => {
    const r = dispatchedLowerWasmExpr(ceLit(true) as never);
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "I32Const", value: 1 }]);
    expect(out.domain).toEqual({ $tag: "DomBool" });
  });

  it("CeLit false → I32Const 0 + DomBool", () => {
    const r = dispatchedLowerWasmExpr(ceLit(false) as never);
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "I32Const", value: 0 }]);
    expect(out.domain).toEqual({ $tag: "DomBool" });
  });

  it("CeLit null → RefNull externref + DomRef", () => {
    const r = dispatchedLowerWasmExpr(ceLit(null) as never);
    const out = asOk(r);
    expect(out.instrs).toEqual([
      { $tag: "RefNull", heapType: "externref" },
    ]);
    expect(out.domain).toEqual({ $tag: "DomRef" });
  });

  it("CeLit string → I32Const idx + Call litStringIdx + DomRef, with builder state observable", () => {
    // Drive the call with an explicit state so we can inspect the
    // ModuleBuilder afterwards. The Fenel body invokes internString +
    // internImport via the natives map; both mutate state.builder.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(ceLit("hello") as never, state);
    const out = asOk(r);
    // The body pushes I32Const first then Call — matching the TS oracle's
    // out.push(...) sequence at compile-wasm.ts:697-699.
    expect(out.instrs).toHaveLength(2);
    expect(out.instrs[0]).toEqual({ $tag: "I32Const", value: 0 });
    expect(out.instrs[1]).toEqual({ $tag: "Call", funcIdx: 0 });
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // Builder state — the string interned at idx 0; the litString
    // import registered at imports[0].
    expect(state.builder.stringPool.get("hello")).toBe(0);
    expect(state.builder.imports).toHaveLength(1);
    expect(state.builder.imports[0]?.name).toBe("litString");
    expect(state.builder.imports[0]?.module).toBe("$fenel");
  });

  it("CeLit string dedup — repeated literal returns same pool idx", () => {
    // Both calls share a state so the dedup property is observable.
    const state = newLowerWasmExprState();
    const r1 = dispatchedLowerWasmExpr(ceLit("dup") as never, state);
    const r2 = dispatchedLowerWasmExpr(ceLit("dup") as never, state);
    const out1 = asOk(r1);
    const out2 = asOk(r2);
    // Same string → same pool idx → same I32Const value.
    expect((out1.instrs[0] as { value: number }).value).toBe(0);
    expect((out2.instrs[0] as { value: number }).value).toBe(0);
    expect(state.builder.stringPool.size).toBe(1);
    // The litString import is also dedup'd (Phase 21.7 commit 2's
    // substrate test verified this property; here we re-verify under
    // the production wrapper's call path).
    expect(state.builder.imports).toHaveLength(1);
  });

  it("CeLit of unsupported value type → Err Unsupported", () => {
    // Pass a plain object — the 5-arm dispatch falls through.
    const r = dispatchedLowerWasmExpr(
      ceLit({ weird: "shape" }) as never,
    );
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      expect(r._0.reason).toMatch(/CeLit/);
    }
  });
});

describe("lowerWasmExpr — CeVar arms (Phase 21.7 commit 3)", () => {
  it("undotted CeVar in scope → LocalGet idx + the local's domain", () => {
    // Pre-seed the builder with a local named `x` at idx 5 with DomNum.
    // The Fenel body calls lookupLocal "x" → Just {value = {index = 5,
    // domain = DomNum}} → emits LocalGet 5 + DomNum.
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 5, { $tag: "DomNum" });
    const r = dispatchedLowerWasmExpr(ceVar("x") as never, state);
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "LocalGet", index: 5 }]);
    expect(out.domain).toEqual({ $tag: "DomNum" });
  });

  it("undotted CeVar with DomRef-typed local preserves domain", () => {
    // The local's domain flows through; here we seed DomRef and expect
    // the same back in the Ok output.
    const state = newLowerWasmExprState();
    seedLocal(state, "s", 2, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(ceVar("s") as never, state);
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "LocalGet", index: 2 }]);
    expect(out.domain).toEqual({ $tag: "DomRef" });
  });

  it("undotted CeVar out of scope → Err Unsupported", () => {
    // No locals seeded; lookupLocal returns Nothing; the body's
    // Nothing arm builds the Err.
    const r = dispatchedLowerWasmExpr(ceVar("unbound") as never);
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      expect(r._0.reason).toMatch(/not in scope/);
    }
  });

  it("dotted CeVar with DomRef head emits the chain (commit 4)", () => {
    // input.body — head local 'input' seeded as DomRef. The body should
    // emit LocalGet 0 (no coerce since head domain == DomRef target),
    // then for segment 'body': I32Const(internedIdx) + Call litStrIdx
    // + Call getFieldNamedIdx. Result domain DomRef.
    const state = newLowerWasmExprState();
    seedLocal(state, "input", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(ceVar("input.body") as never, state);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // Instr sequence: LocalGet, I32Const, Call, Call (4 instrs).
    expect(out.instrs).toHaveLength(4);
    expect(out.instrs[0]).toEqual({ $tag: "LocalGet", index: 0 });
    // The interned string "body" is at idx 0 (first intern in the
    // builder's stringPool); the litString + getFieldNamed imports
    // get their own indices via internImport's dedup.
    expect(out.instrs[1]).toEqual({ $tag: "I32Const", value: 0 });
    expect((out.instrs[2] as { $tag: string }).$tag).toBe("Call");
    expect((out.instrs[3] as { $tag: string }).$tag).toBe("Call");
    expect(state.builder.stringPool.get("body")).toBe(0);
  });

  it("dotted CeVar with DomNum head inserts boxNum coerce before chain", () => {
    // Head domain DomNum needs a boxNum call to coerce → DomRef before
    // the chain can proceed (since getFieldNamed expects externref).
    // Sequence: LocalGet 0; Call boxNumIdx; I32Const segIdx; Call
    // litStrIdx; Call getFieldNamedIdx.
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 0, { $tag: "DomNum" });
    const r = dispatchedLowerWasmExpr(ceVar("x.field") as never, state);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    expect(out.instrs).toHaveLength(5);
    expect(out.instrs[0]).toEqual({ $tag: "LocalGet", index: 0 });
    // [1] is the boxNum Call inserted by coerceDomain.
    expect((out.instrs[1] as { $tag: string }).$tag).toBe("Call");
    // boxNum should be in the imports — verify it's registered.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("boxNum");
  });

  it("dotted CeVar with chained segments a.b.c emits 3 triples", () => {
    // 'a.b.c' — head a (DomRef), segments [b, c]. Per the chain helper,
    // each segment contributes (I32Const, Call litStr, Call getField
    // Named). So total: LocalGet a + 2 * 3 instr = 7.
    const state = newLowerWasmExprState();
    seedLocal(state, "a", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(ceVar("a.b.c") as never, state);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    expect(out.instrs).toHaveLength(7);
    expect(out.instrs[0]).toEqual({ $tag: "LocalGet", index: 0 });
    // Both interned segment strings present.
    expect(state.builder.stringPool.has("b")).toBe(true);
    expect(state.builder.stringPool.has("c")).toBe(true);
  });

  it("dotted CeVar with missing head → Err Unsupported", () => {
    // No locals seeded; the head lookup fails, surfacing Err.
    const r = dispatchedLowerWasmExpr(ceVar("missing.field") as never);
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      expect(r._0.reason).toMatch(/not in scope/);
    }
  });
});

describe("lowerWasmExpr — CeIf arms (Phase 21.7 commit 4)", () => {
  it("CeIf with numeric branches → resolved DomNum + If block carrying then/else instrs", () => {
    // cond=true → CeLit boolean → emits I32Const 1 (already DomBool, no
    // coerce). then=1 → F64Const 1, DomNum. else=0 → F64Const 0, DomNum.
    // inferBranchDom picks DomNum from the then-branch. Final shape:
    // [I32Const 1 (cond), If { blockType=BlockTypeValue F64,
    //                          then=[F64Const 1],
    //                          else=[F64Const 0] }].
    const r = dispatchedLowerWasmExpr(
      ceIf(ceLit(true), ceLit(1), ceLit(0)) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toHaveLength(2);
    expect(out.instrs[0]).toEqual({ $tag: "I32Const", value: 1 });
    const ifInstr = out.instrs[1] as {
      $tag: string;
      blockType: { $tag: string; valType: { $tag: string } };
      then: unknown[];
      else: unknown[];
    };
    expect(ifInstr.$tag).toBe("If");
    expect(ifInstr.blockType.$tag).toBe("BlockTypeValue");
    expect(ifInstr.blockType.valType.$tag).toBe("F64");
    expect(ifInstr.then).toEqual([{ $tag: "F64Const", value: 1 }]);
    expect(ifInstr.else).toEqual([{ $tag: "F64Const", value: 0 }]);
  });

  it("CeIf with null branches → DomRef + Externref block type", () => {
    // null literals → DomRef. inferBranchDom picks DomRef.
    const r = dispatchedLowerWasmExpr(
      ceIf(ceLit(true), ceLit(null), ceLit(null)) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const ifInstr = out.instrs[1] as {
      blockType: { valType: { $tag: string } };
    };
    expect(ifInstr.blockType.valType.$tag).toBe("Externref");
  });

  it("CeIf with CeClosure branches resolves DomRef from domainOf fallback", () => {
    // Both branches are CeClosure — domainOf returns DomUnknown for each
    // (no productive case in the inference helpers), so inferBranchDom
    // falls through to DomRef as its safe default. After commit 8 the
    // CeClosure arm is ported, so both branches lower successfully and
    // the whole CeIf returns Ok with the externref block type.
    const r = dispatchedLowerWasmExpr(
      ceIf(
        ceLit(true),
        { $tag: "CeClosure", params: [], captures: [], body: ceLit(1) },
        { $tag: "CeClosure", params: [], captures: [], body: ceLit(1) },
      ) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const ifInstr = out.instrs[1] as {
      blockType: { valType: { $tag: string } };
    };
    expect(ifInstr.blockType.valType.$tag).toBe("Externref");
  });
});

describe("lowerWasmExpr — CeDo arms (Phase 21.7 commit 4)", () => {
  it("CeDo with [1, 2, 3] → 2 drops + final F64Const 3 + DomNum", () => {
    // Three non-last items emit (lit, Drop) each, except the last
    // which leaves its value on the stack. Sequence:
    //   F64Const 1, Drop, F64Const 2, Drop, F64Const 3 (no drop).
    const r = dispatchedLowerWasmExpr(
      ceDo([ceLit(1), ceLit(2), ceLit(3)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 1 },
      { $tag: "Drop" },
      { $tag: "F64Const", value: 2 },
      { $tag: "Drop" },
      { $tag: "F64Const", value: 3 },
    ]);
  });

  it("CeDo with single expr → no drops, just the expr's instrs", () => {
    const r = dispatchedLowerWasmExpr(ceDo([ceLit(42)]) as never);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([{ $tag: "F64Const", value: 42 }]);
  });

  it("CeDo with empty exprs → DomUnknown + no instrs", () => {
    const r = dispatchedLowerWasmExpr(ceDo([]) as never);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomUnknown" });
    expect(out.instrs).toEqual([]);
  });
});

describe("lowerWasmExpr — CeLet arms (Phase 21.7 commit 4)", () => {
  it("CeLet x = 42 + body CeVar x → F64Const 42 + LocalSet 0 + LocalGet 0 + DomNum", () => {
    // The binding allocates a fresh local at idx 0; the body's CeVar x
    // looks it up via lookupLocal and emits LocalGet 0. After the call,
    // state.locals should have x at idx 0 with DomNum.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceLet([{ name: "x", value: ceLit(42) }], ceVar("x")) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 42 },
      { $tag: "LocalSet", index: 0 },
      { $tag: "LocalGet", index: 0 },
    ]);
    const xEntry = state.locals.get("x");
    expect(xEntry).toBeDefined();
    expect(xEntry?.index).toBe(0);
    expect(xEntry?.domain).toEqual({ $tag: "DomNum" });
  });

  it("CeLet with two sequential bindings allocates idx 0 + 1", () => {
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceLet(
        [
          { name: "a", value: ceLit(1) },
          { name: "b", value: ceLit(true) },
        ],
        ceVar("b"),
      ) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 1 },
      { $tag: "LocalSet", index: 0 },
      { $tag: "I32Const", value: 1 },
      { $tag: "LocalSet", index: 1 },
      { $tag: "LocalGet", index: 1 },
    ]);
    expect(state.locals.get("a")?.index).toBe(0);
    expect(state.locals.get("b")?.index).toBe(1);
  });

  it("CeLet with empty bindings just lowers the body", () => {
    const r = dispatchedLowerWasmExpr(ceLet([], ceLit(7)) as never);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([{ $tag: "F64Const", value: 7 }]);
  });
});

describe("lowerExprWithTarget — coerceDomain insertion (Phase 21.7 commit 4)", () => {
  it("CeLit number with target=DomRef inserts boxNum Call", () => {
    // Produced DomNum, target DomRef → coerceDomain appends a boxNum
    // Call. Sequence: F64Const 42, Call boxNumIdx.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerExprWithTarget(
      ceLit(42) as never,
      { $tag: "DomRef" },
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    expect(out.instrs).toHaveLength(2);
    expect(out.instrs[0]).toEqual({ $tag: "F64Const", value: 42 });
    expect((out.instrs[1] as { $tag: string }).$tag).toBe("Call");
    // boxNum should be in imports.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("boxNum");
  });

  it("CeLit number with target=DomNum is a no-op (no coercion)", () => {
    const r = dispatchedLowerExprWithTarget(
      ceLit(42) as never,
      { $tag: "DomNum" },
    );
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "F64Const", value: 42 }]);
    expect(out.domain).toEqual({ $tag: "DomNum" });
  });

  it("CeLit number with target=DomUnknown passes through with produced DomNum", () => {
    const r = dispatchedLowerExprWithTarget(
      ceLit(42) as never,
      { $tag: "DomUnknown" },
    );
    const out = asOk(r);
    expect(out.instrs).toEqual([{ $tag: "F64Const", value: 42 }]);
    expect(out.domain).toEqual({ $tag: "DomNum" });
  });

  it("CeLit boolean with target=DomNum inserts F64ConvertI32S", () => {
    const r = dispatchedLowerExprWithTarget(
      ceLit(true) as never,
      { $tag: "DomNum" },
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "I32Const", value: 1 },
      { $tag: "F64ConvertI32S" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 21.7 commit 5 — CeCall arm. Nine dispatch paths over (fnId, args):
// direct numeric / string-typed-eq / direct comparison / and-or / not /
// negate / $dyn: / $effect: / default. Each gets a focused test case here.
// ---------------------------------------------------------------------------

function ceCall(fnId: string, args: unknown[]): {
  $tag: "CeCall";
  fnId: string;
  args: unknown[];
} {
  return { $tag: "CeCall", fnId, args };
}

describe("lowerWasmExpr — CeCall direct-numeric (Phase 21.7 commit 5)", () => {
  it("add 1 2 → F64Const 1, F64Const 2, F64Add + DomNum", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("add", [ceLit(1), ceLit(2)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 1 },
      { $tag: "F64Const", value: 2 },
      { $tag: "F64Add" },
    ]);
  });

  it("add 1 2 3 → left-fold: 3 F64Consts + 2 F64Adds + DomNum", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("add", [ceLit(1), ceLit(2), ceLit(3)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 1 },
      { $tag: "F64Const", value: 2 },
      { $tag: "F64Add" },
      { $tag: "F64Const", value: 3 },
      { $tag: "F64Add" },
    ]);
  });

  it("add with <2 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(ceCall("add", [ceLit(1)]) as never);
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.reason).toMatch(/at least 2 args/);
    }
  });

  it("sub / mul / div use F64Sub / F64Mul / F64Div", () => {
    const subR = asOk(
      dispatchedLowerWasmExpr(
        ceCall("sub", [ceLit(5), ceLit(2)]) as never,
      ),
    );
    expect(subR.instrs[2]).toEqual({ $tag: "F64Sub" });
    const mulR = asOk(
      dispatchedLowerWasmExpr(
        ceCall("mul", [ceLit(5), ceLit(2)]) as never,
      ),
    );
    expect(mulR.instrs[2]).toEqual({ $tag: "F64Mul" });
    const divR = asOk(
      dispatchedLowerWasmExpr(
        ceCall("div", [ceLit(5), ceLit(2)]) as never,
      ),
    );
    expect(divR.instrs[2]).toEqual({ $tag: "F64Div" });
  });
});

describe("lowerWasmExpr — CeCall direct comparison (Phase 21.7 commit 5)", () => {
  it("lt 1 2 → F64Const 1, F64Const 2, F64Lt + DomBool", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("lt", [ceLit(1), ceLit(2)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 1 },
      { $tag: "F64Const", value: 2 },
      { $tag: "F64Lt" },
    ]);
  });

  it("lte / gt / gte / eq / neq (numeric, no string-typed signal)", () => {
    const checkCmp = (fnId: string, opTag: string): void => {
      const out = asOk(
        dispatchedLowerWasmExpr(
          ceCall(fnId, [ceLit(1), ceLit(2)]) as never,
        ),
      );
      expect(out.domain).toEqual({ $tag: "DomBool" });
      expect(out.instrs[2]).toEqual({ $tag: opTag });
    };
    checkCmp("lte", "F64Le");
    checkCmp("gt", "F64Gt");
    checkCmp("gte", "F64Ge");
    // Numeric-typed eq / neq (no string-typed signal in args) route
    // through the f64 fast path, not litEq.
    checkCmp("eq", "F64Eq");
    checkCmp("neq", "F64Ne");
  });

  it("lt with !=2 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(ceCall("lt", [ceLit(1)]) as never);
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.reason).toMatch(/expects 2 args/);
    }
  });
});

describe("lowerWasmExpr — CeCall string-typed eq (Phase 21.7 commit 5)", () => {
  it("eq \"foo\" x → both args at DomRef + Call litEq + DomBool", () => {
    // CeLit string in args triggers Phase 21.5.2's string-typed eq path.
    // Both args lower at DomRef → litString import + I32Const + Call
    // litString for the literal, LocalGet x for the var (DomRef-typed).
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceCall("eq", [ceLit("foo"), ceVar("x")]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    // The litEq import should be registered.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("litEq");
    // Should NOT have an F64Eq instruction — routed via litEq, not the
    // numeric fast path.
    const hasF64Eq = out.instrs.some(
      (i) => (i as { $tag: string }).$tag === "F64Eq",
    );
    expect(hasF64Eq).toBe(false);
  });

  it("neq \"foo\" x → litEq + I32Eqz + DomBool", () => {
    // For neq, the i32 result of litEq gets flipped via I32Eqz.
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceCall("neq", [ceLit("foo"), ceVar("x")]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    // The final instruction should be I32Eqz (the neq flip).
    const last = out.instrs[out.instrs.length - 1] as { $tag: string };
    expect(last.$tag).toBe("I32Eqz");
  });

  it("eq with !=2 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("eq", [ceLit("foo")]) as never,
    );
    expect(r.$tag).toBe("Err");
  });
});

describe("lowerWasmExpr — CeCall and/or/not/negate (Phase 21.7 commit 5)", () => {
  it("and true false → I32Const 1, I32Const 0, I32And + DomBool", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("and", [ceLit(true), ceLit(false)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    expect(out.instrs).toEqual([
      { $tag: "I32Const", value: 1 },
      { $tag: "I32Const", value: 0 },
      { $tag: "I32And" },
    ]);
  });

  it("or true false → I32Const 1, I32Const 0, I32Or + DomBool", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("or", [ceLit(true), ceLit(false)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    expect(out.instrs[2]).toEqual({ $tag: "I32Or" });
  });

  it("and with <2 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("and", [ceLit(true)]) as never,
    );
    expect(r.$tag).toBe("Err");
  });

  it("not true → I32Const 1, I32Eqz + DomBool", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("not", [ceLit(true)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomBool" });
    expect(out.instrs).toEqual([
      { $tag: "I32Const", value: 1 },
      { $tag: "I32Eqz" },
    ]);
  });

  it("not with !=1 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(ceCall("not", []) as never);
    expect(r.$tag).toBe("Err");
  });

  it("negate 5 → F64Const 5, F64Neg + DomNum", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("negate", [ceLit(5)]) as never,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomNum" });
    expect(out.instrs).toEqual([
      { $tag: "F64Const", value: 5 },
      { $tag: "F64Neg" },
    ]);
  });

  it("negate with !=1 args → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("negate", [ceLit(1), ceLit(2)]) as never,
    );
    expect(r.$tag).toBe("Err");
  });
});

describe("lowerWasmExpr — CeCall $dyn:/effect/default (Phase 21.7 commit 5)", () => {
  it("$dyn:f x → LocalGet 0 + lowered-x + Call callClosure_1 + DomRef", () => {
    // f is seeded as a DomRef local at idx 0. The arm should LocalGet 0
    // (no coerce since head is already DomRef), lower x at DomRef, then
    // Call $fenel.callClosure_1.
    const state = newLowerWasmExprState();
    seedLocal(state, "f", 0, { $tag: "DomRef" });
    seedLocal(state, "x", 1, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceCall("$dyn:f", [ceVar("x")]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // First instr: LocalGet of f.
    expect(out.instrs[0]).toEqual({ $tag: "LocalGet", index: 0 });
    // Second: LocalGet of x.
    expect(out.instrs[1]).toEqual({ $tag: "LocalGet", index: 1 });
    // Last: Call to callClosure_1.
    const last = out.instrs[out.instrs.length - 1] as {
      $tag: string;
      funcIdx: number;
    };
    expect(last.$tag).toBe("Call");
    // The callClosure_1 import should be registered.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("callClosure_1");
  });

  it("$dyn: with out-of-scope target → Err Unsupported", () => {
    const r = dispatchedLowerWasmExpr(
      ceCall("$dyn:missing", []) as never,
    );
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.reason).toMatch(/not in scope/);
    }
  });

  it("$effect:HasStateIO:get x → lowered-x + Call effect-import + DomRef", () => {
    // The effect-dispatch sentinel routes through internImportInModule
    // with module name $effect.HasStateIO. The import's module field
    // distinguishes it from the default $fenel.
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceCall("$effect:HasStateIO:get", [ceVar("x")]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // The import should have module=$effect.HasStateIO, name=get.
    const effectImport = state.builder.imports.find(
      (i) => i.name === "get" && i.module === "$effect.HasStateIO",
    );
    expect(effectImport).toBeDefined();
  });

  it("default → Call $fenel.<fnId> import + DomRef", () => {
    // someUnknownFn doesn't match any prefix; falls through to default.
    const state = newLowerWasmExprState();
    seedLocal(state, "x", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceCall("someUnknownFn", [ceVar("x")]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // The default import should be in $fenel module.
    const fenelImport = state.builder.imports.find(
      (i) => i.name === "someUnknownFn" && i.module === "$fenel",
    );
    expect(fenelImport).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 21.7 commit 6 — CeConstruct + CeRecord arms. Both share the same
// lowerWasmTaggedRecord helper (mirrors compile-wasm.ts:1060). Positional
// path uses setField, named path uses setFieldNamed; the construct import
// always fires; the value is stashed in a fresh local and pushed at the
// end as the externref result.
// ---------------------------------------------------------------------------

function ceConstruct(
  ctor: string,
  args: unknown[],
  fields?: string[],
): {
  $tag: "CeConstruct";
  ctor: string;
  args: unknown[];
  fields?: string[];
} {
  return fields === undefined
    ? { $tag: "CeConstruct", ctor, args }
    : { $tag: "CeConstruct", ctor, args, fields };
}

function ceRecord(
  fields: { name: string; value: unknown }[],
): { $tag: "CeRecord"; fields: { name: string; value: unknown }[] } {
  return { $tag: "CeRecord", fields };
}

describe("lowerWasmExpr — CeConstruct positional (Phase 21.7 commit 6)", () => {
  it("CeConstruct \"Just\" [1] [] → construct + LocalSet + setField + LocalGet + DomRef", () => {
    // Positional: empty fields list (or absent) routes every field through
    // setField. Result must end with LocalGet so the value sits on the
    // stack as the externref result of the construct expression.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceConstruct("Just", [ceLit(1)], []) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // construct + setField imports registered, setFieldNamed NOT registered
    // (positional path doesn't use it).
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).toContain("setField");
    expect(importNames).not.toContain("setFieldNamed");
    // Final instruction is LocalGet of the stashed local.
    const last = out.instrs[out.instrs.length - 1] as {
      $tag: string;
      index: number;
    };
    expect(last.$tag).toBe("LocalGet");
    // The stringPool should contain the tag.
    expect(state.builder.stringPool.has("Just")).toBe(true);
  });

  it("CeConstruct without fields key (legacy shape) routes through positional", () => {
    // make-closures-explicit's fallback arm (line 122) emits a CeConstruct
    // without a `fields` key when the source-side CoreConstruct didn't
    // carry named-field metadata. The Fenel body must accept this shape
    // and route every field through positional mode.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceConstruct("Wrapper", [ceLit(42)]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("setField");
    expect(importNames).not.toContain("setFieldNamed");
  });

  it("CeConstruct \"Nothing\" [] [] (nullary) → construct + LocalSet + LocalGet, no setField", () => {
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceConstruct("Nothing", [], []) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // n_fields is 0 → no setField call.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).not.toContain("setField");
    expect(importNames).not.toContain("setFieldNamed");
    // Sequence: I32Const tagIdx, Call litString, I32Const 0, Call construct,
    // LocalSet idx, LocalGet idx. Total 6 instrs.
    expect(out.instrs.length).toBe(6);
    expect((out.instrs[2] as { $tag: string; value: number })).toEqual({
      $tag: "I32Const",
      value: 0,
    });
  });
});

describe("lowerWasmExpr — CeConstruct named (Phase 21.7 commit 6)", () => {
  it("CeConstruct \"Pair\" [1,2] [\"fst\",\"snd\"] → setFieldNamed + name strings", () => {
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceConstruct("Pair", [ceLit(1), ceLit(2)], ["fst", "snd"]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("setFieldNamed");
    // The positional setField import must NOT fire for fully-named ctors.
    expect(importNames).not.toContain("setField");
    // The stringPool should contain the tag + both field names.
    expect(state.builder.stringPool.has("Pair")).toBe(true);
    expect(state.builder.stringPool.has("fst")).toBe(true);
    expect(state.builder.stringPool.has("snd")).toBe(true);
  });
});

describe("lowerWasmExpr — CeRecord (Phase 21.7 commit 6)", () => {
  it("CeRecord [{name:\"x\", value: ceLit(1)}] → $record sentinel + setFieldNamed", () => {
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceRecord([{ name: "x", value: ceLit(1) }]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).toContain("setFieldNamed");
    expect(importNames).not.toContain("setField");
    // The sentinel "$record" tag and the field name should be interned.
    expect(state.builder.stringPool.has("$record")).toBe(true);
    expect(state.builder.stringPool.has("x")).toBe(true);
  });

  it("CeRecord [] (empty) → construct + LocalSet + LocalGet only", () => {
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(ceRecord([]) as never, state);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).not.toContain("setField");
    expect(importNames).not.toContain("setFieldNamed");
    // n_fields is 0 → no per-field calls.
    expect((out.instrs[2] as { $tag: string; value: number })).toEqual({
      $tag: "I32Const",
      value: 0,
    });
  });

  it("CeRecord field-value error propagates Err", () => {
    // A CeRecord whose field value is itself an Err-producing lowering
    // (e.g. a CeVar against an out-of-scope name) propagates the Err
    // from the recursive lowerExprWithTarget call.
    const r = dispatchedLowerWasmExpr(
      ceRecord([
        {
          name: "x",
          value: ceVar("unbound-in-record"),
        },
      ]) as never,
    );
    expect(r.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// Phase 21.7 commit 7 — CeMatch arm + pattern-matching trio. The lowering
// walks the arms list as a nested if/else chain; each arm emits an i32
// guard + a then-branch that binds pattern names + lowers the arm body.
// The base case falls through to $fenel.matchFail. Tests cover the four
// pattern variants (PatLit, PatVar, PatWildcard, PatConstruct in both
// positional and named-field flavours), nested PatConstruct sub-guards,
// and multi-arm fallthrough with matchFail.
// ---------------------------------------------------------------------------

function ceMatch(
  scrutinee: unknown,
  arms: { pattern: unknown; body: unknown }[],
): { $tag: "CeMatch"; scrutinee: unknown; arms: unknown[] } {
  return { $tag: "CeMatch", scrutinee, arms };
}

function patLit(value: unknown): { $tag: "PatLit"; value: unknown } {
  return { $tag: "PatLit", value };
}

function patVar(name: string): { $tag: "PatVar"; name: string } {
  return { $tag: "PatVar", name };
}

const patWildcard = { $tag: "PatWildcard" };

function patConstruct(
  ctor: string,
  args: unknown[],
  fields?: string[],
): {
  $tag: "PatConstruct";
  ctor: string;
  args: unknown[];
  fields?: string[];
} {
  return fields === undefined
    ? { $tag: "PatConstruct", ctor, args }
    : { $tag: "PatConstruct", ctor, args, fields };
}

describe("lowerWasmExpr — CeMatch arm (Phase 21.7 commit 7)", () => {
  it("matchFail import registered for the terminal fallthrough", () => {
    // The base case of emitWasmMatchArms (arms exhausted) emits a LocalGet
    // scrut + Call matchFail. Even a single-wildcard match registers the
    // import because the else-branch still recurses past the last arm.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(1), [{ pattern: patWildcard, body: ceLit(42) }]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("matchFail");
  });

  it("PatWildcard arm → trivial I32Const 1 guard + Externref If block", () => {
    // Single arm with wildcard pattern: the guard is just I32Const 1; the
    // body lowers and gets boxed to DomRef (via coerceDomain). The If's
    // blockType is BlockTypeValue Externref.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(1), [{ pattern: patWildcard, body: ceLit(42) }]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // Find the If instruction — should be present and wrap externref.
    const ifInstr = out.instrs.find(
      (i) => (i as { $tag: string }).$tag === "If",
    ) as { blockType: { $tag: string; valType: { $tag: string } } } | undefined;
    expect(ifInstr).toBeDefined();
    expect(ifInstr!.blockType.$tag).toBe("BlockTypeValue");
    expect(ifInstr!.blockType.valType.$tag).toBe("Externref");
  });

  it("PatVar arm → aliases scrutinee local (body's CeVar resolves to scrut idx)", () => {
    // The PatVar arm body references the bound name; bindWasmPattern's
    // setLocalAlias points it at the scrutinee's local idx. The body
    // lowers as LocalGet of that idx — i.e. the scrutinee's value flows
    // through unchanged.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(1), [
        { pattern: patVar("y"), body: ceVar("y") },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // The scrutinee got stashed in some local; that same local is what
    // PatVar's body's CeVar resolves to. Find the LocalSet in the prelude
    // and the LocalGet in the If's then-branch — they should share idx.
    const ifInstr = out.instrs.find(
      (i) => (i as { $tag: string }).$tag === "If",
    ) as { then: { $tag: string; index?: number }[] } | undefined;
    expect(ifInstr).toBeDefined();
    const localGetInThen = ifInstr!.then.find(
      (i) => i.$tag === "LocalGet",
    ) as { index: number } | undefined;
    expect(localGetInThen).toBeDefined();
    const localSetInPrelude = out.instrs.find(
      (i) => (i as { $tag: string }).$tag === "LocalSet",
    ) as { index: number } | undefined;
    expect(localSetInPrelude).toBeDefined();
    expect(localGetInThen!.index).toBe(localSetInPrelude!.index);
  });

  it("PatLit arm → litEq guard (Call litEq with i32 result)", () => {
    // Pattern is `1`; the guard pushes scrut + boxed-1 + Call litEq → i32.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(1), [
        { pattern: patLit(1), body: ceLit(99) },
        { pattern: patWildcard, body: ceLit(0) },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("litEq");
    expect(importNames).toContain("matchFail");
  });

  it("PatConstruct \"Just\" [PatVar y] → tag check + presence + body alias", () => {
    // Pattern matches Just-tagged values. The guard emits tagEq + (per-
    // sub) hasField. The sub-pattern is PatVar so the recursive sub-guard
    // is skipped (presence-only). bindWasmPattern then field-loads the
    // payload and binds y to the field's local.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        {
          pattern: patConstruct("Just", [patVar("y")]),
          body: ceVar("y"),
        },
        { pattern: patWildcard, body: ceLit(0) },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    // tagEq + hasField (positional, no field-names) + getField (for the
    // bind step) all fire. matchFail for the wildcard fallthrough.
    expect(importNames).toContain("tagEq");
    expect(importNames).toContain("hasField");
    expect(importNames).toContain("getField");
    expect(importNames).toContain("matchFail");
    expect(state.builder.stringPool.has("Just")).toBe(true);
  });

  it("PatConstruct \"Pair\" [PatVar a, PatVar b] [\"fst\",\"snd\"] → named-field path", () => {
    // Same shape as the positional Just test but with named-field
    // metadata; the guard + bind route through hasFieldNamed +
    // getFieldNamed instead of the positional siblings.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        {
          pattern: patConstruct(
            "Pair",
            [patVar("a"), patVar("b")],
            ["fst", "snd"],
          ),
          body: ceVar("a"),
        },
        { pattern: patWildcard, body: ceLit(0) },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("tagEq");
    expect(importNames).toContain("hasFieldNamed");
    expect(importNames).toContain("getFieldNamed");
    // The positional siblings must NOT fire for fully-named patterns.
    expect(importNames).not.toContain("hasField");
    // The interned tag + field names should be in the pool.
    expect(state.builder.stringPool.has("Pair")).toBe(true);
    expect(state.builder.stringPool.has("fst")).toBe(true);
    expect(state.builder.stringPool.has("snd")).toBe(true);
  });

  it("Multi-arm fallthrough: Nothing | Just y | _ → nested if/else + matchFail", () => {
    // Three arms — Nothing (PatConstruct), Just y (PatConstruct + PatVar),
    // wildcard (catch-all). The else chain nests two If instructions; the
    // deepest else recurses past the last arm and emits matchFail.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        { pattern: patConstruct("Nothing", []), body: ceLit(1) },
        { pattern: patConstruct("Just", [patVar("y")]), body: ceLit(2) },
        { pattern: patWildcard, body: ceLit(3) },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("matchFail");
    // Both tag-checks fire (Nothing and Just).
    expect(state.builder.stringPool.has("Nothing")).toBe(true);
    expect(state.builder.stringPool.has("Just")).toBe(true);
  });

  it("nested PatConstruct: Just (Pair a b) → recursive sub-guard AND-fold", () => {
    // Pattern is Just whose payload is itself a Pair. The outer
    // emitWasmPatternGuard does tag(Just) + presence(arg[0]) + recursive
    // sub-guard on (Pair a b) — which itself does tag(Pair) + presence
    // of both subs. AND-folded into one i32 0/1.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        {
          pattern: patConstruct("Just", [
            patConstruct("Pair", [patVar("a"), patVar("b")]),
          ]),
          body: ceVar("a"),
        },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // Both tags should appear; the nested guard exercises the recursive
    // emitWasmPatternGuard path.
    expect(state.builder.stringPool.has("Just")).toBe(true);
    expect(state.builder.stringPool.has("Pair")).toBe(true);
    // I32And appears multiple times in the guard fold.
    const i32Ands = out.instrs.filter(
      (i) => (i as { $tag: string }).$tag === "I32And",
    );
    // Outer-Just contributes 1 per sub-position * 2 (presence + sub-guard)
    // = 2 ANDs for the sub-position with a recurse. The recursive
    // Pair-guard contributes 2 more (one per sub, presence-only since
    // PatVar). The outer's recursive-sub I32And fires after the inner
    // guard returns. So conservatively expect >= 2 I32Ands; the exact
    // count depends on the AND-fold layout (the recurse is wrapped under
    // a fresh local, so its ANDs are emitted INSIDE the recurse before
    // the outer's terminal AND fires).
    expect(i32Ands.length).toBeGreaterThanOrEqual(2);
  });

  it("empty arms → matchFail-only (terminal fallthrough)", () => {
    // No arms at all. The base case fires immediately, emitting LocalGet
    // scrut + Call matchFail. No If, no guard work.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(ceMatch(ceLit(1), []) as never, state);
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("matchFail");
    // No If should be present — base case fires straight away.
    const hasIf = out.instrs.some(
      (i) => (i as { $tag: string }).$tag === "If",
    );
    expect(hasIf).toBe(false);
  });

  it("per-arm bindings don't leak across arms (snapshot/restore scoping)", () => {
    // First arm binds `y` via PatVar; the second arm's body references a
    // free name `y` which is NOT in scope (no binding survives the
    // restore). The Fenel body's recursive emitWasmPatternGuard +
    // emitWasmMatchArms must snapshot/restore between arms.
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        { pattern: patVar("y"), body: ceLit(1) },
        { pattern: patWildcard, body: ceVar("y") },
      ]) as never,
    );
    // The second arm should fail to lower because `y` is out of scope.
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.reason).toMatch(/not in scope/);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 21.7 commit 8 — CeClosure arm. The single arm is recursive (the
// closure body is itself a CeExpr lowered via lowerExprWithTarget) AND
// emits TWO instruction streams (caller's `out` + the body's `bodyOut`)
// into separate WasmFuncs within the same compilation. Tests cover the
// canonical empty/single/multi capture shapes, the out-of-scope capture
// error, sibling-closure id increment, closure inside a match arm body
// (cross-cut with commit 7), and rleLocals' RLE output property.
// ---------------------------------------------------------------------------

function ceClosure(
  params: string[],
  captures: string[],
  body: unknown,
): {
  $tag: "CeClosure";
  params: string[];
  captures: string[];
  body: unknown;
} {
  return { $tag: "CeClosure", params, captures, body };
}

describe("lowerWasmExpr — CeClosure arms (Phase 21.7 commit 8)", () => {
  it("empty captures, identity body \\x -> x → __cl0 + envAlloc/makeClosure sequence, empty prologue", () => {
    // \x -> x with no captures. The caller's out gets envAlloc(0) +
    // makeClosure; the body's WasmFunc has an empty prologue (no captures
    // to load) and lowers `x` via the pre-bound body-frame param at idx 1
    // ($env is idx 0, x is idx 1). pendingFuncs grows by 1; pendingExports
    // grows by 1; nextClosureId advances to 1.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceClosure(["x"], [], ceVar("x")) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // The body WasmFunc is registered.
    expect(state.builder.pendingFuncs).toHaveLength(1);
    expect(state.builder.pendingExports).toHaveLength(1);
    expect(state.builder.pendingFuncs[0]?.name).toBe("test-entry__cl0");
    expect(state.builder.pendingExports[0]?.name).toBe("test-entry__cl0");
    expect(state.builder.pendingExports[0]?.index).toBe(-1);
    // The body's function type: (externref env, externref x) -> externref.
    const bodyFt = state.builder.pendingFuncs[0]?.funcType;
    expect(bodyFt?.params).toHaveLength(2);
    expect(bodyFt?.params[0]).toEqual({ $tag: "Externref" });
    expect(bodyFt?.params[1]).toEqual({ $tag: "Externref" });
    expect(bodyFt?.results).toEqual([{ $tag: "Externref" }]);
    // Caller's out registered the unconditional imports: envAlloc,
    // envSet, makeClosure, litString (all interned at the closure-
    // construction phase regardless of captures count, matching the TS
    // oracle's unconditional intern calls at compile-wasm.ts:952-961).
    // envGet is the only conditional one — it's interned inside the
    // body's prologue for-loop, so empty captures means no envGet.
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("envAlloc");
    expect(importNames).toContain("envSet");
    expect(importNames).toContain("makeClosure");
    expect(importNames).toContain("litString");
    expect(importNames).not.toContain("envGet");
    // Closure id counter advanced.
    expect(state.builder.nextClosureId).toBe(1);
    // String pool interns the closure name.
    expect(state.builder.stringPool.has("test-entry__cl0")).toBe(true);
  });

  it("single capture, free-var body \\x -> y where y captured → envGet prologue in body", () => {
    // Caller has `y` in scope (seeded as DomRef). The closure captures y;
    // its body returns y (which is captured into the env at body-frame
    // local idx 1). Verifies the capture-resolve-in-caller-scope path
    // AND the body's envGet prologue.
    const state = newLowerWasmExprState();
    seedLocal(state, "y", 0, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceClosure(["x"], ["y"], ceVar("y")) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    const importNames = state.builder.imports.map((i) => i.name);
    expect(importNames).toContain("envAlloc");
    expect(importNames).toContain("envSet");
    expect(importNames).toContain("envGet");
    expect(importNames).toContain("makeClosure");
    // Body has 1 captured local, prologue should LocalGet env + I32Const 0
    // + Call envGet + LocalSet ... → at least 4 instrs in the body's
    // body field before the lowered body's own instrs.
    const body = state.builder.pendingFuncs[0]?.body;
    expect(body).toBeDefined();
    expect(body!.length).toBeGreaterThanOrEqual(4);
    // The body's first instr is LocalGet $env (idx 0 within the body
    // frame).
    expect(body![0]).toEqual({ $tag: "LocalGet", index: 0 });
    expect(body![1]).toEqual({ $tag: "I32Const", value: 0 });
  });

  it("multi-capture \\() -> add a b with captures [a, b] → both in envSet + envGet", () => {
    // Both captures appear in the envSet sequence (caller side) and in
    // the envGet prologue (body side). The body's body-prologue allocates
    // two body-frame locals (one per capture); the lowered add uses both
    // via the captured-local LocalGets.
    const state = newLowerWasmExprState();
    seedLocal(state, "a", 0, { $tag: "DomRef" });
    seedLocal(state, "b", 1, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceClosure(
        [],
        ["a", "b"],
        { $tag: "CeCall", fnId: "add", args: [ceVar("a"), ceVar("b")] },
      ) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // Body has params (just $env, since no lambda params): 1 externref.
    const bodyFt = state.builder.pendingFuncs[0]?.funcType;
    expect(bodyFt?.params).toHaveLength(1);
    // Body has 2 declared locals for the 2 captures (rleLocals collapses
    // them since both are Externref → DomRef): single WasmLocalDecl with
    // count=2.
    const bodyLocals = state.builder.pendingFuncs[0]?.locals;
    expect(bodyLocals).toEqual([
      { $tag: "WasmLocalDecl", count: 2, valType: { $tag: "Externref" } },
    ]);
  });

  it("capture-out-of-scope → Err Unsupported with the brief's message", () => {
    // No `missing` local seeded; the capture-resolve loop bails with the
    // brief's "CeClosure capture '<name>' not in scope at Wasm lowering"
    // error message.
    const r = dispatchedLowerWasmExpr(
      ceClosure(["x"], ["missing"], ceVar("x")) as never,
    );
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      expect(r._0.reason).toMatch(
        /CeClosure capture 'missing' not in scope at Wasm lowering/,
      );
    }
  });

  it("two sibling closures in CeDo → __cl0 + __cl1 ids increment", () => {
    // Two siblings → nextClosureId increments per emission. First closure
    // gets __cl0, second gets __cl1.
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceDo([
        ceClosure(["x"], [], ceVar("x")),
        ceClosure(["y"], [], ceVar("y")),
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    expect(state.builder.pendingFuncs).toHaveLength(2);
    expect(state.builder.pendingFuncs[0]?.name).toBe("test-entry__cl0");
    expect(state.builder.pendingFuncs[1]?.name).toBe("test-entry__cl1");
    expect(state.builder.nextClosureId).toBe(2);
  });

  it("closure inside CeMatch arm body → enter/exitClosureBody interacts with snapshot/restoreLocals", () => {
    // Cross-cut with commit 7. Lowering a CeMatch whose arm body is itself
    // a CeClosure (with a capture referencing the per-arm binding) must
    // play correctly with the pattern-matching trio's snapshot/restore
    // around the arm body. The closure captures the per-arm bound name
    // `bound`; it must resolve in the CALLER's scope (i.e. inside the
    // arm body where bound is set).
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceMatch(ceLit(null), [
        {
          pattern: patVar("bound"),
          body: ceClosure(["x"], ["bound"], ceVar("x")),
        },
      ]) as never,
      state,
    );
    const out = asOk(r);
    expect(out.domain).toEqual({ $tag: "DomRef" });
    // The closure was emitted as a pending body.
    expect(state.builder.pendingFuncs).toHaveLength(1);
    // After the closure returns, the caller's frame is restored — the
    // commit-7 snapshot/restoreLocals isn't disturbed by the body switch.
    // (The body-arm scope finishes with `bound` still in scope; after the
    // arm fully lowers, restoreLocals rolls it back.)
    expect(state.locals.has("bound")).toBe(false);
  });

  it("rleLocals collapses N consecutive Externref locals into one WasmLocalDecl(count=N)", () => {
    // Body with N captures, all DomRef. The body's declaredLocals list
    // has N entries each {domain=DomRef}. rleLocals collapses them into a
    // single {count=N, valType=Externref}.
    const state = newLowerWasmExprState();
    seedLocal(state, "p", 0, { $tag: "DomRef" });
    seedLocal(state, "q", 1, { $tag: "DomRef" });
    seedLocal(state, "r", 2, { $tag: "DomRef" });
    const r = dispatchedLowerWasmExpr(
      ceClosure([], ["p", "q", "r"], ceVar("p")) as never,
      state,
    );
    expect(r.$tag).toBe("Ok");
    const bodyLocals = state.builder.pendingFuncs[0]?.locals;
    expect(bodyLocals).toEqual([
      { $tag: "WasmLocalDecl", count: 3, valType: { $tag: "Externref" } },
    ]);
  });

  it("empty body locals → empty rleLocals output", () => {
    // No captures, no body bindings → declaredLocals is [] → rleLocals
    // returns [].
    const state = newLowerWasmExprState();
    const r = dispatchedLowerWasmExpr(
      ceClosure(["x"], [], ceVar("x")) as never,
      state,
    );
    expect(r.$tag).toBe("Ok");
    const bodyLocals = state.builder.pendingFuncs[0]?.locals;
    expect(bodyLocals).toEqual([]);
  });
});

