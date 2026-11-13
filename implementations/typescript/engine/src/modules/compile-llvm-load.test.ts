// ---------------------------------------------------------------------------
// compile-llvm-load.test.ts — conformance test for the compile-llvm module's
// IR entity surface. Phase 4h authored the program-envelope tier
// (`fenel/modules/engine/ir-types.fenel`'s 7 shared entities + the
// target-specific LlvmModule envelope). Phase 4j consolidates the deep
// per-target AST ADTs that 4h had to leave as lazy `a` field refs — 22
// entities move from `lower-to-llvm-ast.fenel` into
// `fenel/modules/compile-llvm/types.fenel`, including the ~27-case
// LlvmInstr (Add/Sub/Mul/...) and the 12-case LlvmValType (I1/I8/.../Ptr).
// Post-4j the compile-llvm types file is the canonical declaration site
// for the full LLVM-target AST surface.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { compileLlvmModule } from "./compile-llvm";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";

test("compile-llvm module declares 29 entities (7 shared + 22 LLVM-target deep AST)", () => {
  const ids = (compileLlvmModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("LlvmModule");
  expect(ids).toContain("CompileFieldSlot");
  expect(ids).toContain("CompileSource");
  expect(ids).toContain("CompileError");
  expect(ids).toContain("CoreProgram");
  expect(ids).toContain("EffectsExplicitProgram");
  expect(ids).toContain("HandlerSite");
  expect(ids).toContain("ClosuresExplicitProgram");
  expect(ids).toContain("LlvmValType");
  expect(ids).toContain("LlvmInstr");
  expect(ids).toContain("LlvmTerminator");
  expect(ids).toContain("LlvmOperand");
  expect(ids).toContain("LlvmBasicBlock");
  expect((compileLlvmModule.entities ?? []).length).toBe(29);
});

test("LlvmModule entity carries the 7 expected sub-record list fields", () => {
  const llvmModule = (compileLlvmModule.entities ?? []).find(
    (e) => e.id === "LlvmModule",
  );
  expect(llvmModule).toBeDefined();
  const shape = llvmModule!.type as {
    $record?: { fields: Array<{ name: string }> };
  };
  // Single-constructor named-record parses as a `$record`.
  const fieldNames = (shape.$record?.fields ?? []).map((f) => f.name);
  expect(fieldNames).toEqual([
    "name",
    "fieldSlots",
    "declarations",
    "globals",
    "definitions",
    "effectImports",
    "stringPool",
  ]);
});

test("getSystemRegistry surfaces entity:LlvmModule in the catalog walk", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:LlvmModule")).toBeDefined();
});

test("compiler-envelope resolution smoke — shared and target refs resolve to registered catalog entries", () => {
  getSystemRegistry();
  for (const name of [
    "CompileFieldSlot",
    "CompileSource",
    "CompileError",
    "CoreProgram",
    "EffectsExplicitProgram",
    "ClosuresExplicitProgram",
    "LlvmModule",
  ]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

test("Phase 4j — LlvmInstr is a 27-case variant; Add 4-field + LlvmCall 4-field / LlvmCallVoid 3-field lock", () => {
  const llvmInstr = (compileLlvmModule.entities ?? []).find(
    (e) => e.id === "LlvmInstr",
  );
  expect(llvmInstr).toBeDefined();
  const shape = llvmInstr!.type as {
    $variant?: {
      cases: Array<{ name: string; fields?: Array<{ name: string }> }>;
    };
  };
  const cases = shape.$variant?.cases ?? [];
  expect(cases.length).toBe(27);
  // Add: 4 fields — result / opType / lhs / rhs.
  const addCase = cases.find((c) => c.name === "Add");
  expect(addCase).toBeDefined();
  expect((addCase!.fields ?? []).map((f) => f.name)).toEqual([
    "result",
    "opType",
    "lhs",
    "rhs",
  ]);
  // LlvmCall: 4 fields — result / retType / fn / args.
  const llvmCall = cases.find((c) => c.name === "LlvmCall");
  expect(llvmCall).toBeDefined();
  expect((llvmCall!.fields ?? []).map((f) => f.name)).toEqual([
    "result",
    "retType",
    "fn",
    "args",
  ]);
  // LlvmCallVoid: 3 fields — retType / fn / args (no result).
  const llvmCallVoid = cases.find((c) => c.name === "LlvmCallVoid");
  expect(llvmCallVoid).toBeDefined();
  expect((llvmCallVoid!.fields ?? []).map((f) => f.name)).toEqual([
    "retType",
    "fn",
    "args",
  ]);
});

test("Phase 2 — LLVM target variants retain collision-free constructor rosters", () => {
  const caseNames = (entityId: string): string[] => {
    const entity = (compileLlvmModule.entities ?? []).find((candidate) =>
      candidate.id === entityId
    );
    expect(entity).toBeDefined();
    const shape = entity!.type as {
      $variant?: { cases: Array<{ name: string }> };
    };
    return (shape.$variant?.cases ?? []).map(({ name }) => name);
  };

  expect(caseNames("LlvmValType")).toEqual([
    "I1",
    "I8",
    "I16",
    "LlvmI32",
    "LlvmI64",
    "Float",
    "Double",
    "Void",
    "Ptr",
    "Vector",
    "LlvmArrayT",
    "LlvmStructT",
  ]);
  expect(caseNames("LlvmDomain")).toEqual([
    "DomDouble",
    "DomI1",
    "DomPtr",
    "LlvmDomUnknown",
  ]);
  expect(caseNames("LlvmTerminator")).toEqual([
    "Ret",
    "RetVoid",
    "LlvmBr",
    "BrCond",
    "Switch",
    "LlvmUnreachable",
  ]);
});

test("Phase 4j — deep LLVM-target AST entities all surface in the system-registry catalog", () => {
  getSystemRegistry();
  for (const name of [
    "LlvmValType",
    "LlvmDomain",
    "LlvmInstr",
    "LlvmTerminator",
    "LlvmBasicBlock",
    "LlvmFunctionDef",
    "LlvmDirectArith",
    "LlvmDirectCmp",
    "LlvmLowerOutput",
  ]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

// ---------------------------------------------------------------------------
// Phase 3v.5 (module-substrate) — parity assertions for the spec-surface
// migration. The 7 compile-llvm sigs flipped from inline TS `defineFunction`
// blocks to the `loadFenelModuleUnion` over types/instances/sigs.fenel.
// Three of the seven sigs carry an `@codeName "*ForLlvm"` directive that
// preserves the byte-identical codeName the retired TS spec set.
// ---------------------------------------------------------------------------

test("Phase 3v.5 — compile-llvm function count is byte-identical to the retired TS spec list", () => {
  expect((compileLlvmModule.functions ?? []).length).toBe(7);
});

// modules-as-values (2026-09-24) — the container is the identifier
// `compileLlvm`; the function ids keep the `compile-llvm:` namespace, and the
// target types are stamped with the container they are members of.
test("the container is `compileLlvm`, its function namespace stays `compile-llvm`", () => {
  expect(compileLlvmModule.name).toBe("compileLlvm");
  expect(compileLlvmModule.functionNamespace).toBe("compile-llvm");
  expect((compileLlvmModule.functions ?? []).every((fn) => fn.id.startsWith("compile-llvm:"))).toBe(true);
  const owners = new Map((compileLlvmModule.entities ?? []).map((e) => [e.id, e.module]));
  for (const id of ["LlvmModule", "LlvmInstr", "LlvmDomain"]) {
    expect(owners.get(id), id).toBe("compileLlvm");
  }
  expect(owners.get("CoreProgram")).toBe("engine");
});

test("Phase 3v.5 — every compile-llvm fnId resolves through createRegistry by id and by codeName (three carry *ForLlvm codeNames)", () => {
  const reg = createRegistry([stdModule, compileLlvmModule]);
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["compile-llvm:normaliseToCore", "normaliseToCoreForLlvm"],
    ["compile-llvm:makeEffectsExplicit", "makeEffectsExplicitForLlvm"],
    ["compile-llvm:makeClosuresExplicit", "makeClosuresExplicitForLlvm"],
    ["compile-llvm:lowerToLlvmAst", "lowerToLlvmAst"],
    ["compile-llvm:serializeLlvmModule", "serializeLlvmModule"],
    ["compile-llvm:deserializeLlvmModule", "deserializeLlvmModule"],
    ["compile-llvm:compileFenelToLlvm", "compileFenelToLlvm"],
  ];
  for (const [id, codeName] of expected) {
    expect(reg.getFunction(id)).toBeDefined();
    expect(reg.getFunctionByCodeName(codeName)).toBeDefined();
  }
});
