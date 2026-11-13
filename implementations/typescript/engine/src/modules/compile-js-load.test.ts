// ---------------------------------------------------------------------------
// compile-js-load.test.ts — conformance test for the compile-js module's
// IR entity surface. Phase 4h authored the program-envelope tier
// (`fenel/modules/engine/ir-types.fenel`'s 7 shared entities + the
// target-specific JsModule envelope). Phase 4j consolidates the deep
// per-target AST ADTs that 4h had to leave as lazy `a` field refs — JsAst
// (12-case variant) and CallMapping (4-case variant) move from
// `emit-js.fenel` into `fenel/modules/compile-js/types.fenel`. Post-4j the
// compile-js types file is the canonical declaration site for the full JS-
// target AST surface.
//
// Unlike phases 4a–4g (which extracted from inline `*_SRC` template
// literals), 4h is the first phase that AUTHORS entity declarations from
// scratch against TS source-of-truth type definitions
// (`compilable.ts:CompileSource`/`CompileError`, `ir/core.ts:CoreProgram`,
// `ir/effects-explicit.ts:EffectsExplicitProgram`/`HandlerSite`,
// `ir/closures-explicit.ts:ClosuresExplicitProgram`, `ir/js-ast.ts:JsModule`).
// Phase 4j extends the same recipe to the deep per-target AST ADTs.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { compileJsModule } from "./compile-js";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";

test("compile-js module declares 12 entities (7 shared + 5 JS-target deep AST)", () => {
  const ids = (compileJsModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("JsModule");
  expect(ids).toContain("CompileFieldSlot");
  expect(ids).toContain("CompileSource");
  expect(ids).toContain("CompileError");
  expect(ids).toContain("CoreProgram");
  expect(ids).toContain("EffectsExplicitProgram");
  expect(ids).toContain("HandlerSite");
  expect(ids).toContain("ClosuresExplicitProgram");
  expect(ids).toContain("JsAst");
  expect(ids).toContain("JsStmt");
  expect(ids).toContain("JsLoopFn");
  expect(ids).toContain("CallMapping");
  expect((compileJsModule.entities ?? []).length).toBe(12);
});

test("JsModule entity is a record with name + fieldSlots + entry fields", () => {
  const jsModule = (compileJsModule.entities ?? []).find(
    (e) => e.id === "JsModule",
  );
  expect(jsModule).toBeDefined();
  const shape = jsModule!.type as {
    $record?: { fields: Array<{ name: string }> };
  };
  // Single-constructor named-record parses as a `$record` (the parser
  // collapses `Foo = Foo a: T b: U` to a `$record` when the constructor
  // name matches the type name).
  const fieldNames = (shape.$record?.fields ?? []).map((f) => f.name);
  expect(fieldNames).toEqual(["name", "fieldSlots", "entry"]);
});

test("getSystemRegistry surfaces entity:JsModule in the catalog walk", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:JsModule")).toBeDefined();
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
    "JsModule",
  ]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

test("Phase 4j — JsAst is a 12-case variant; JsArrow carries 3 fields (params / captures / body)", () => {
  const jsAst = (compileJsModule.entities ?? []).find((e) => e.id === "JsAst");
  expect(jsAst).toBeDefined();
  const shape = jsAst!.type as {
    $variant?: {
      cases: Array<{ name: string; fields?: Array<{ name: string }> }>;
    };
  };
  const cases = shape.$variant?.cases ?? [];
  const caseNames = cases.map((c) => c.name);
  // 12 cases — full JsAst surface. Order matters (matches emit-js.fenel
  // walker order); regression-asserts against any silent reshape.
  expect(caseNames).toEqual([
    "JsLit",
    "JsVar",
    "JsMember",
    "JsCall",
    "JsArrow",
    "JsLet",
    "JsTernary",
    "JsBinOp",
    "JsUnaryOp",
    "JsObject",
    "JsArray",
    "JsSequence",
  ]);
  // JsArrow 3-field lock — params / captures / body. Closures-explicit
  // pass populates these and emit-js renders them verbatim.
  const jsArrow = cases.find((c) => c.name === "JsArrow");
  expect(jsArrow).toBeDefined();
  const jsArrowFieldNames = (jsArrow!.fields ?? []).map((f) => f.name);
  expect(jsArrowFieldNames).toEqual(["params", "captures", "body"]);
});

test("Phase 4j+ — deep JS-target AST entities all surface in the system-registry catalog", () => {
  getSystemRegistry();
  for (const name of ["JsAst", "JsStmt", "JsLoopFn", "CallMapping"]) {
    expect(getCatalogEntry(`entity:${name}`)).toBeDefined();
  }
});

// ---------------------------------------------------------------------------
// Phase 3v.5 (module-substrate) — parity assertions for the spec-surface
// migration. The 7 compile-js sigs flipped from inline TS `defineFunction`
// blocks to the `loadFenelModuleUnion` over types/instances/sigs.fenel; this
// describe-block guards against silent count / identity / registry-resolution
// regressions from the new source.
// ---------------------------------------------------------------------------

test("Phase 3v.5 — compile-js function count is byte-identical to the retired TS spec list", () => {
  expect((compileJsModule.functions ?? []).length).toBe(7);
});

// modules-as-values (2026-09-24) — the container is the identifier `compileJs`;
// the function ids keep the `compile-js:` namespace, and the target types are
// stamped with the container they are members of.
test("the container is `compileJs`, its function namespace stays `compile-js`", () => {
  expect(compileJsModule.name).toBe("compileJs");
  expect(compileJsModule.functionNamespace).toBe("compile-js");
  expect((compileJsModule.functions ?? []).every((fn) => fn.id.startsWith("compile-js:"))).toBe(true);
  const owners = new Map((compileJsModule.entities ?? []).map((e) => [e.id, e.module]));
  for (const id of ["JsAst", "JsStmt", "JsLoopFn", "JsModule", "CallMapping"]) {
    expect(owners.get(id), id).toBe("compileJs");
  }
  expect(owners.get("CoreProgram")).toBe("engine");
});

test("Phase 3v.5 — every compile-js fnId resolves through createRegistry by id and by codeName", () => {
  const reg = createRegistry([stdModule, compileJsModule]);
  const expectedIds = [
    "compile-js:normaliseToCore",
    "compile-js:makeEffectsExplicit",
    "compile-js:makeClosuresExplicit",
    "compile-js:emitJs",
    "compile-js:serializeJsModule",
    "compile-js:deserializeJsModule",
    "compile-js:compileFenelToJs",
  ];
  for (const id of expectedIds) {
    expect(reg.getFunction(id)).toBeDefined();
    const codeName = id.slice("compile-js:".length);
    expect(reg.getFunctionByCodeName(codeName)).toBeDefined();
  }
});
