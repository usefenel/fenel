// ---------------------------------------------------------------------------
// ir-ast-load.test.ts — conformance test for the shared front-of-pipeline
// deep IR ADT entities (CoreExpr / CorePattern / CeExpr). Phase 4i of the
// ts-elimination workstream consolidates these three ADTs into the single
// canonical declaration site `fenel/modules/engine/ir-ast.fenel`. Pre-4i
// the same three were declared inside multiple body fenel files
// (normalise-to-core.fenel / make-effects-explicit.fenel /
// make-closures-explicit.fenel) with shape-divergent field counts that the
// `_extraEntities` first-registration-wins dedup silently papered over —
// concretely, `CoreConstruct` carried 3 fields in normalise-to-core but
// only 2 in make-effects-explicit (the Phase 21.1 `fields?` named-field
// metadata), same divergence on `PatConstruct`.
//
// These tests assert against the canonical 3-field shapes per the TS
// source-of-truth in `ir/core.ts:133-138` (CoreConstruct) +
// `ir/core.ts:166-185` (PatConstruct) + `ir/closures-explicit.ts:80-97`
// (CeClosure + CeConstruct). The shape-lock prevents a regression where
// a future body file accidentally reintroduces the leaner 2-field shape
// and the canonical declaration loses the dedup race.
//
// The engine module is NOT in `system-registry`'s SYSTEM_MODULES list, so
// `getCatalogEntry` via `getSystemRegistry()` doesn't surface these
// entities. The catalog-surfacing path that DOES work is
// `createRegistry([engineModule])` (which calls `registerCatalogEntities`
// on every module passed); this is the path consumed by the self-host
// harness + the engine-bodies dispatch.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { engineModule } from "./modules/engine";
import { createRegistry } from "./registry";
import { getCatalogEntry } from "./type-catalog";

type VariantCase = { name: string; fields?: ReadonlyArray<{ name: string }> };
type VariantType = { $variant?: { cases: VariantCase[] } };

function findEntity(id: string) {
  return (engineModule.entities ?? []).find((e) => e.id === id);
}

function variantCases(id: string): VariantCase[] {
  const e = findEntity(id);
  const v = (e?.type as VariantType | undefined)?.$variant;
  return v?.cases ?? [];
}

function caseFields(id: string, ctor: string): string[] {
  const c = variantCases(id).find((c) => c.name === ctor);
  return (c?.fields ?? []).map((f) => f.name);
}

test("ir-ast.fenel surfaces CorePattern / CeExpr in engineModule.entities (CoreExpr RETIRED — expr-substrate 4c)", () => {
  const ids = (engineModule.entities ?? []).map((e) => e.id);
  // CoreExpr retired in expr-substrate Phase 4c — the compile front-end's
  // inter-pass IR is now the irreducible core `Expr` (fenel/std/expr.fenel);
  // CorePattern + CeExpr stay (CeExpr is P0-locked; CorePattern's Pat* tags are
  // shared with std Pattern, a flagged collapse follow-up).
  expect(ids).not.toContain("CoreExpr");
  expect(ids).toContain("CorePattern");
  expect(ids).toContain("CeExpr");
});

test("CorePattern is a 4-case variant with PatConstruct carrying 3 fields", () => {
  const cases = variantCases("CorePattern").map((c) => c.name);
  expect(cases).toEqual(["PatLit", "PatVar", "PatWildcard", "PatConstruct"]);
  expect(caseFields("CorePattern", "PatConstruct")).toEqual([
    "ctor",
    "args",
    "fields",
  ]);
});

test("CeExpr is a 10-case variant; CeClosure carries 3 fields (params/captures/body); CeConstruct mirrors CoreConstruct's 3-field shape", () => {
  const cases = variantCases("CeExpr").map((c) => c.name);
  expect(cases).toEqual([
    "CeLit",
    "CeVar",
    "CeCall",
    "CeIf",
    "CeLet",
    "CeDo",
    "CeClosure",
    "CeConstruct",
    "CeRecord",
    "CeMatch",
  ]);
  // CeClosure is the load-bearing structural difference from CoreLambda:
  // the closure-conversion pass surfaces lexical captures as an explicit
  // field (per ir/closures-explicit.ts:80-85).
  expect(caseFields("CeExpr", "CeClosure")).toEqual([
    "params",
    "captures",
    "body",
  ]);
  // CeConstruct passes through CoreConstruct.fields unchanged
  // (per ir/closures-explicit.ts:87-97).
  expect(caseFields("CeExpr", "CeConstruct")).toEqual([
    "ctor",
    "args",
    "fields",
  ]);
});

test("createRegistry([engineModule]) surfaces entity:CorePattern / CeExpr through registerCatalogEntities (CoreExpr retired — 4c)", () => {
  createRegistry([engineModule]);
  expect(getCatalogEntry("entity:CoreExpr")).toBeUndefined();
  expect(getCatalogEntry("entity:CorePattern")).toBeDefined();
  expect(getCatalogEntry("entity:CeExpr")).toBeDefined();
});
