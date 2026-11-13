// ---------------------------------------------------------------------------
// compile-wasm-load.test.ts — conformance test for the compile-wasm module's
// IR entity surface. Phase 4h authored the program-envelope tier
// (`fenel/modules/engine/ir-types.fenel`'s 7 shared entities + the
// target-specific WasmModule envelope). Phase 4j consolidates the deep
// per-target AST ADTs that 4h had to leave as lazy `a` field refs — 20
// entities move from `lower-to-wasm-ast.fenel` into
// `fenel/modules/compile-wasm/types.fenel`, including the 50+-case
// WasmInstr (largest variant in the workstream). Post-4j the compile-wasm
// types file is the canonical declaration site for the full Wasm-target
// AST surface.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { compileWasmModule } from "./compile-wasm";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";

test("compile-wasm module declares 27 entities (7 shared + 20 Wasm-target deep AST)", () => {
  const ids = (compileWasmModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("WasmModule");
  expect(ids).toContain("CompileFieldSlot");
  expect(ids).toContain("CompileSource");
  expect(ids).toContain("CompileError");
  expect(ids).toContain("CoreProgram");
  expect(ids).toContain("EffectsExplicitProgram");
  expect(ids).toContain("HandlerSite");
  expect(ids).toContain("ClosuresExplicitProgram");
  expect(ids).toContain("WasmValType");
  expect(ids).toContain("WasmInstr");
  expect(ids).toContain("WasmFuncType");
  expect(ids).toContain("WasmDirectOp");
  expect(ids).toContain("CallDomain");
  expect(ids).toContain("LowerOutput");
  expect((compileWasmModule.entities ?? []).length).toBe(27);
});

test("WasmModule entity carries the 8 expected sub-record list fields", () => {
  const wasmModule = (compileWasmModule.entities ?? []).find(
    (e) => e.id === "WasmModule",
  );
  expect(wasmModule).toBeDefined();
  const shape = wasmModule!.type as {
    $record?: { fields: Array<{ name: string }> };
  };
  // Single-constructor named-record parses as a `$record`.
  const fieldNames = (shape.$record?.fields ?? []).map((f) => f.name);
  expect(fieldNames).toEqual([
    "name",
    "fieldSlots",
    "types",
    "imports",
    "funcs",
    "exports",
    "componentExports",
    "stringPool",
  ]);
});

test("getSystemRegistry surfaces entity:WasmModule in the catalog walk", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:WasmModule")).toBeDefined();
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
    "WasmModule",
  ]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

test("Phase 4j — WasmInstr is a 50+-case variant; spot-checks I32Const / LocalGet / If / nullaries", () => {
  const wasmInstr = (compileWasmModule.entities ?? []).find(
    (e) => e.id === "WasmInstr",
  );
  expect(wasmInstr).toBeDefined();
  const shape = wasmInstr!.type as {
    $variant?: {
      cases: Array<{ name: string; fields?: Array<{ name: string }> }>;
    };
  };
  const cases = shape.$variant?.cases ?? [];
  // The 50+-case Wasm opcode surface — sanity-check the upper bound + key
  // cases. Largest single variant in the workstream so far.
  expect(cases.length).toBeGreaterThanOrEqual(50);
  const caseNames = cases.map((c) => c.name);
  // Field-carrying cases — confirm value / index field names byte-equal
  // the TS oracle.
  const i32Const = cases.find((c) => c.name === "I32Const");
  expect(i32Const).toBeDefined();
  expect((i32Const!.fields ?? []).map((f) => f.name)).toEqual(["value"]);
  const localGet = cases.find((c) => c.name === "LocalGet");
  expect(localGet).toBeDefined();
  expect((localGet!.fields ?? []).map((f) => f.name)).toEqual(["index"]);
  // 3-field control-flow case
  const ifInstr = cases.find((c) => c.name === "If");
  expect(ifInstr).toBeDefined();
  expect((ifInstr!.fields ?? []).map((f) => f.name)).toEqual([
    "blockType",
    "then",
    "else",
  ]);
  // Nullary spot-check — these have no fields (or empty).
  for (const nullaryName of ["I32Add", "Return", "Unreachable"]) {
    expect(caseNames).toContain(nullaryName);
    const nullary = cases.find((c) => c.name === nullaryName);
    expect((nullary!.fields ?? []).length).toBe(0);
  }
});

test("Phase 4j — deep Wasm-target AST entities all surface in the system-registry catalog", () => {
  getSystemRegistry();
  for (const name of [
    "WasmValType",
    "WasmDomain",
    "WasmInstr",
    "WasmBlockType",
    "WasmFunc",
    "WasmDirectOp",
    "CallDomain",
    "LowerOutput",
  ]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

// ---------------------------------------------------------------------------
// Phase 3v.5 (module-substrate) — parity assertions for the spec-surface
// migration. The 7 compile-wasm sigs flipped from inline TS `defineFunction`
// blocks to the `loadFenelModuleUnion` over types/instances/sigs.fenel.
// Three of the seven sigs carry an `@codeName "*ForWasm"` directive that
// preserves the byte-identical codeName the retired TS spec set.
// ---------------------------------------------------------------------------

test("Phase 3v.5 — compile-wasm function count is byte-identical to the retired TS spec list", () => {
  expect((compileWasmModule.functions ?? []).length).toBe(7);
});

// modules-as-values (2026-09-24) — the container is the identifier
// `compileWasm`; the function ids keep the `compile-wasm:` namespace, and the
// target types are stamped with the container they are members of.
test("the container is `compileWasm`, its function namespace stays `compile-wasm`", () => {
  expect(compileWasmModule.name).toBe("compileWasm");
  expect(compileWasmModule.functionNamespace).toBe("compile-wasm");
  expect((compileWasmModule.functions ?? []).every((fn) => fn.id.startsWith("compile-wasm:"))).toBe(true);
  const owners = new Map((compileWasmModule.entities ?? []).map((e) => [e.id, e.module]));
  for (const id of ["WasmModule", "WasmInstr", "WasmDomain"]) {
    expect(owners.get(id), id).toBe("compileWasm");
  }
  expect(owners.get("CoreProgram")).toBe("engine");
});

test("Phase 3v.5 — every compile-wasm fnId resolves through createRegistry by id and by codeName (three carry *ForWasm codeNames)", () => {
  const reg = createRegistry([stdModule, compileWasmModule]);
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["compile-wasm:normaliseToCore", "normaliseToCoreForWasm"],
    ["compile-wasm:makeEffectsExplicit", "makeEffectsExplicitForWasm"],
    ["compile-wasm:makeClosuresExplicit", "makeClosuresExplicitForWasm"],
    ["compile-wasm:lowerToWasmAst", "lowerToWasmAst"],
    ["compile-wasm:serializeWasmModule", "serializeWasmModule"],
    ["compile-wasm:deserializeWasmModule", "deserializeWasmModule"],
    ["compile-wasm:compileFenelToWasm", "compileFenelToWasm"],
  ];
  for (const [id, codeName] of expected) {
    expect(reg.getFunction(id)).toBeDefined();
    expect(reg.getFunctionByCodeName(codeName)).toBeDefined();
  }
});
