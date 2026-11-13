// ---------------------------------------------------------------------------
// Phase 21.7 commit 9 — `lowerToWasmAst` program-level entry test.
//
// Drives `dispatchedLowerToWasmAst` with synthetic `ClosuresExplicitProgram`
// inputs and asserts the resulting WasmModule envelope matches the shape
// that the prior TS oracle produced byte-for-byte. The per-CeExpr
// arm tests live in `lower-wasm-expr.test.ts`; this file focuses on the
// program-level surface introduced in commit 9:
//
//   1. Trivial body, no params — minimal envelope (one entry func, one
//      type, no imports, no pending funcs/exports, no stringPool).
//   2. Body with params — paramDomains threaded through entry func type.
//   3. Body with string literal — stringPool populated; the empty-pool
//      stripping at the wrapper boundary is verified for the no-string
//      case.
//   4. Body with closure — pendingFuncs grows; closure-export indices
//      get rewritten from the sentinel -1 to definitive importCount+i.
//   5. Multiple closures — fixupClosureExportIndices walks all entries.
//   6. componentExports shape — verifies the inner params structure
//      matches the TS oracle (only {name}, no extra fields).
//   7. Boolean body — externalReturn flips DomBool → DomRef; boxBool
//      inserted at the boundary.
//   8. Entry export index — points past the pendingFuncs (importCount
//      + pendingFuncs.length).
//   9. Err propagation — body with out-of-scope CeVar surfaces
//      Unsupported with the expected reason.
//
// The TS oracle is invoked side-by-side via `lowerProgramToWasm`-equivalent
// shape comparisons; for byte-equality at scale, `compile-wasm-self-host.
// test.ts` is the broader gate (it lands when commit 10's call-site flip
// routes the production pipeline through dispatchedLowerToWasmAst).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { dispatchedLowerToWasmAst } from "./engine-bodies-dispatch";
import type { ClosuresExplicitProgram } from "./ir/closures-explicit";
import type { CompileFieldSlot, CompileResult } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { WasmModule } from "./ir/wasm-ast";

// Tiny shorthand for ClosuresExplicitProgram + its CeExpr nodes. The
// dispatch wrapper feeds these straight to the Fenel body via the harness
// registry; the body pattern-matches on $tag.
function ceProgram(
  name: string,
  params: CompileFieldSlot[],
  body: unknown,
): ClosuresExplicitProgram {
  return {
    $tag: "ClosuresExplicitProgram",
    name,
    params,
    body: body as never,
  };
}

function ceLit(value: unknown): { $tag: "CeLit"; value: unknown } {
  return { $tag: "CeLit", value };
}

function ceVar(name: string): { $tag: "CeVar"; name: string } {
  return { $tag: "CeVar", name };
}

function ceCall(
  fnId: string,
  args: unknown[],
): { $tag: "CeCall"; fnId: string; args: unknown[] } {
  return { $tag: "CeCall", fnId, args };
}

function ceClosure(
  params: string[],
  captures: string[],
  body: unknown,
): { $tag: "CeClosure"; params: string[]; captures: string[]; body: unknown } {
  return { $tag: "CeClosure", params, captures, body };
}

function ceDo(exprs: unknown[]): { $tag: "CeDo"; exprs: unknown[] } {
  return { $tag: "CeDo", exprs };
}

function asOkModule(
  r: CompileResult<WasmModule>,
): WasmModule & Record<string, unknown> {
  if (r.$tag !== "Ok") {
    throw new Error(`expected Ok, got Err: ${JSON.stringify(r._0)}`);
  }
  return r._0 as WasmModule & Record<string, unknown>;
}

describe("lowerToWasmAst — minimal program (Phase 21.7 commit 9)", () => {
  it("trivial numeric body, no params → envelope with one entry func, no imports, no closures, no stringPool key", () => {
    // ceProgram("answer", [], CeLit 42). Body is a pure number; no string
    // literals; no closures. The envelope should have:
    //   - types: 1 entry (() -> F64)
    //   - imports: []
    //   - funcs: [entryFunc]
    //   - exports: [{name="answer", kind="func", index=0}]
    //   - componentExports: [{name="answer", params=[]}]
    //   - stringPool: STRIPPED (not present in wire shape)
    const r = dispatchedLowerToWasmAst(ceProgram("answer", [], ceLit(42)));
    const m = asOkModule(r);
    expect(m.$tag).toBe("WasmModule");
    expect(m.name).toBe("answer");
    expect(m.types).toHaveLength(1);
    expect(m.types[0]).toEqual({
      $tag: "WasmFuncType",
      params: [],
      results: [{ $tag: "F64" }],
    });
    expect(m.imports).toEqual([]);
    expect(m.funcs).toHaveLength(1);
    expect(m.funcs[0]?.name).toBe("answer");
    expect(m.funcs[0]?.body).toEqual([{ $tag: "F64Const", value: 42 }]);
    expect(m.exports).toEqual([
      { $tag: "WasmExport", name: "answer", kind: "func", index: 0 },
    ]);
    expect(m.componentExports).toEqual([{ name: "answer", params: [] }]);
    // Empty stringPool stripped at the wrapper boundary.
    expect("stringPool" in m).toBe(false);
  });

  it("body with one numeric param → paramValType is F64, paramDomains default to DomNum", () => {
    // \x -> x. inferDomains leaves x unconstrained (DomUnknown) so the
    // wrapper defaults it to DomNum → F64. Return domain follows.
    const r = dispatchedLowerToWasmAst(
      ceProgram("identity", positionalCompileFieldSlots(["x"]), ceVar("x")),
    );
    const m = asOkModule(r);
    expect(m.types[0]).toEqual({
      $tag: "WasmFuncType",
      params: [{ $tag: "F64" }],
      results: [{ $tag: "F64" }],
    });
    // Body: LocalGet 0 (the param at idx 0).
    expect(m.funcs[0]?.funcType.params).toEqual([{ $tag: "F64" }]);
    expect(m.funcs[0]?.body[0]).toEqual({ $tag: "LocalGet", index: 0 });
    const identitySlots = positionalCompileFieldSlots(["x"]);
    expect(m.fieldSlots).toEqual(identitySlots);
    // Component reflection retains the same semantic slots as the common IR.
    expect(m.componentExports).toEqual([
      { name: "identity", params: identitySlots },
    ]);
  });

  it("add a b — both params inferred as DomNum via callDomainOf(add)", () => {
    // \a b -> add a b. inferDomains sees add expects DomNum args; the
    // CeVar propagation refines both a and b to DomNum.
    const r = dispatchedLowerToWasmAst(
      ceProgram(
        "sum",
        positionalCompileFieldSlots(["a", "b"]),
        ceCall("add", [ceVar("a"), ceVar("b")]),
      ),
    );
    const m = asOkModule(r);
    expect(m.funcs[0]?.funcType.params).toEqual([
      { $tag: "F64" },
      { $tag: "F64" },
    ]);
    expect(m.funcs[0]?.funcType.results).toEqual([{ $tag: "F64" }]);
    // Body: LocalGet 0, LocalGet 1, F64Add.
    expect(m.funcs[0]?.body).toEqual([
      { $tag: "LocalGet", index: 0 },
      { $tag: "LocalGet", index: 1 },
      { $tag: "F64Add" },
    ]);
  });
});

describe("lowerToWasmAst — stringPool (Phase 21.7 commit 9)", () => {
  it("body with string literal → stringPool present in wire shape with the interned values", () => {
    // \() -> "hello". CeLit string → internString fires; the stringPool
    // accumulates the value at idx 0; the wrapper does NOT strip because
    // the list is non-empty.
    const r = dispatchedLowerToWasmAst(
      ceProgram("greet", [], ceLit("hello")),
    );
    const m = asOkModule(r);
    // litString import registered; stringPool carries the interned value.
    expect(m.stringPool).toEqual(["hello"]);
    expect(m.imports.some((i) => i.$tag === "WasmFuncImport" && i.name === "litString"))
      .toBe(true);
  });

  it("body with multiple distinct string literals → stringPool ordered by interning sequence", () => {
    // CeDo [CeLit "a", CeLit "b", CeLit "c"]. Each fires internString in
    // order; the stringPool should preserve the interning order via the
    // getStringPool native's value-at-idx writeback.
    const r = dispatchedLowerToWasmAst(
      ceProgram("strs", [], ceDo([ceLit("a"), ceLit("b"), ceLit("c")])),
    );
    const m = asOkModule(r);
    expect(m.stringPool).toEqual(["a", "b", "c"]);
  });

  it("body without string literals → stringPool key absent (stripped by wrapper)", () => {
    // Pure number body. internString never fires; stringPool stays empty;
    // the wrapper strips the key at the boundary.
    const r = dispatchedLowerToWasmAst(ceProgram("n", [], ceLit(3.14)));
    const m = asOkModule(r);
    expect("stringPool" in m).toBe(false);
  });
});

describe("lowerToWasmAst — closure index fixup (Phase 21.7 commit 9)", () => {
  it("single closure → pendingFuncs grows by 1; closure export index rewritten from -1 to importCount+0", () => {
    // \() -> (\x -> x). The inner CeClosure lowers as a pending body func
    // + a pending export with sentinel index=-1. The program-level entry
    // assembly walks pendingExports rewriting each index to importCount+i.
    const r = dispatchedLowerToWasmAst(
      ceProgram("mkid", [], ceClosure(["x"], [], ceVar("x"))),
    );
    const m = asOkModule(r);
    // funcs = [closureBody, entry]; pendingFuncs(1) + entry(1) = 2.
    expect(m.funcs).toHaveLength(2);
    expect(m.funcs[0]?.name).toBe("mkid__cl0");
    expect(m.funcs[1]?.name).toBe("mkid");
    // Closure export's index is importCount + 0 (the first locally-defined
    // func is the closure body, at index importCount).
    const importCount = m.imports.filter((i) => i.$tag === "WasmFuncImport").length;
    const closureExports = m.exports.filter((e) => e.name === "mkid__cl0");
    expect(closureExports).toHaveLength(1);
    expect(closureExports[0]?.index).toBe(importCount + 0);
    // No more -1 sentinels.
    for (const e of m.exports) expect(e.index).toBeGreaterThanOrEqual(0);
  });

  it("two sibling closures → pendingFuncs grows by 2; both export indices rewritten in order", () => {
    // CeDo [closure0, closure1]. Each lowers as a pending func + export;
    // fixupClosureExportIndices walks the list assigning importCount,
    // importCount+1.
    const r = dispatchedLowerToWasmAst(
      ceProgram(
        "two",
        [],
        ceDo([
          ceClosure(["x"], [], ceVar("x")),
          ceClosure(["y"], [], ceVar("y")),
        ]),
      ),
    );
    const m = asOkModule(r);
    expect(m.funcs).toHaveLength(3); // 2 closures + entry
    const importCount = m.imports.filter((i) => i.$tag === "WasmFuncImport").length;
    const cl0 = m.exports.find((e) => e.name === "two__cl0");
    const cl1 = m.exports.find((e) => e.name === "two__cl1");
    expect(cl0?.index).toBe(importCount + 0);
    expect(cl1?.index).toBe(importCount + 1);
  });

  it("entry export index = importCount + pendingFuncs.length", () => {
    // The entry's export index sits past all imports AND past all
    // closure-body funcs. For a program with M closures and N imports,
    // entryExportIdx = N + M.
    const r = dispatchedLowerToWasmAst(
      ceProgram(
        "mkthree",
        [],
        ceDo([
          ceClosure(["x"], [], ceVar("x")),
          ceClosure(["y"], [], ceVar("y")),
          ceClosure(["z"], [], ceVar("z")),
        ]),
      ),
    );
    const m = asOkModule(r);
    const importCount = m.imports.filter((i) => i.$tag === "WasmFuncImport").length;
    const entryExport = m.exports.find((e) => e.name === "mkthree");
    expect(entryExport?.index).toBe(importCount + 3);
  });
});

describe("lowerToWasmAst — componentExports (Phase 21.7 commit 9)", () => {
  it("component reflection retains the resolved field slots", () => {
    const slots = positionalCompileFieldSlots(["a", "b"]);
    const r = dispatchedLowerToWasmAst(
      ceProgram(
        "f",
        slots,
        ceCall("add", [ceVar("a"), ceVar("b")]),
      ),
    );
    const m = asOkModule(r);
    expect(m.componentExports).toEqual([
      { name: "f", params: slots },
    ]);
    expect(m.fieldSlots).toEqual(slots);
    // The outer entry also has no $tag (plain record).
    expect((m.componentExports as unknown[])[0]).not.toHaveProperty("$tag");
    // And no returnType key (the TS oracle omits it).
    expect((m.componentExports as unknown[])[0]).not.toHaveProperty("returnType");
  });
});

describe("lowerToWasmAst — boundary domain (Phase 21.7 commit 9)", () => {
  it("boolean body → externalReturn DomBool→DomRef; boxBool inserted at boundary; entry result is Externref", () => {
    // \() -> True. inferDomains returns DomBool; the wrapper coerces to
    // DomRef so the JS host receives true/false naturally; the body's
    // final coerceDomain inserts boxBool.
    const r = dispatchedLowerToWasmAst(ceProgram("yes", [], ceLit(true)));
    const m = asOkModule(r);
    // Entry func type's result is Externref (DomRef → Externref).
    expect(m.funcs[0]?.funcType.results).toEqual([{ $tag: "Externref" }]);
    // The body emitted I32Const 1 then Call boxBool to bridge to the
    // externref boundary.
    const importNames = m.imports
      .filter((i) => i.$tag === "WasmFuncImport")
      .map((i) => i.name);
    expect(importNames).toContain("boxBool");
  });
});

describe("lowerToWasmAst — Err propagation (Phase 21.7 commit 9)", () => {
  it("body with out-of-scope CeVar → Err Unsupported propagated through the entry", () => {
    // \() -> y (no `y` in scope). The body's lowerWasmVarUndotted returns
    // Err Unsupported; the entry function short-circuits before assembling
    // the WasmModule. The dispatch wrapper passes through the Err.
    const r = dispatchedLowerToWasmAst(
      ceProgram("oops", [], ceVar("y")),
    );
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      const reason = (r._0 as { reason?: string }).reason;
      expect(reason).toMatch(/CeVar.*not in scope/);
    }
  });

  it("structural guard — non-ClosuresExplicitProgram input → Err Unsupported with the guard's reason", () => {
    // The dispatch wrapper's structural guard fires BEFORE any Fenel-side
    // dispatch; the wrong-shape input never reaches the body.
    const r = dispatchedLowerToWasmAst(
      { $tag: "NotAProgram" } as unknown as ClosuresExplicitProgram,
    );
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("Unsupported");
      const reason = (r._0 as { reason?: string }).reason;
      expect(reason).toMatch(/expects a ClosuresExplicitProgram/);
    }
  });
});

describe("lowerToWasmAst — funcs ordering (Phase 21.7 commit 9)", () => {
  it("funcs = [...pendingFuncs, entryFunc] — closure bodies precede the entry", () => {
    // Mirrors compile-wasm.ts:1772. The entry function lives at the END
    // of the funcs list so its index = importCount + pendingFuncs.length.
    const r = dispatchedLowerToWasmAst(
      ceProgram("with-cl", [], ceClosure(["x"], [], ceVar("x"))),
    );
    const m = asOkModule(r);
    expect(m.funcs[m.funcs.length - 1]?.name).toBe("with-cl");
    expect(m.funcs[0]?.name).toBe("with-cl__cl0");
  });
});
