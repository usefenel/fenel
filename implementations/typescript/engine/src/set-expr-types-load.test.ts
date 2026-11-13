// ---------------------------------------------------------------------------
// set-expr-types-load.test.ts — conformance test for
// `fenel/modules/engine/set-expr-types.fenel` (Phase 4 canonical boundary).
//
// The source registers the canonical SetExpr / SetPattern entity ADTs and all
// five payload records/ADTs. `SetExpr` is the public 14-case shape; legacy
// `$`-key values exist only as unknown input at the boundary. This file pins:
//
//   1. The .fenel source parses to the 7-entity roster.
//   2. Each entity's shape (case set + per-case field names + field types)
//      matches the locked D1 spec (Phase-0 audit §3 D1 + §2.1 table), with the
//      `types.ts` field names mirrored (left/right/inner/branches/values/
//      interval/handle/pattern/pred/ctor/fields/var/body/params/returns — and
//      the SetPattern / Bound* / constructor-field / arrow-param payloads).
//   3. The entities surface in `getCatalog()` with the right kind, AND the
//      pre-existing occupants of the names the brief's locked D1 set collided
//      with — `Pattern` (expr-substrate match-arm), `Interval` / `Bound` (the
//      deciders' marshalled shapes) — are UNDISTURBED (the additive invariant).
//
// NAMING: the `Set`-prefixed family (Rom decision 2026-06-16, brief Option 1).
// The colliding ENTITY names take the `Set` prefix; SetPattern's cases use the
// distinct Sp* namespace so they cannot collide with pattern-algebra's Pat P*
// constructors. See the .fenel header for the full rationale.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import setExprTypesSrc from "../../../../fenel/modules/engine/set-expr-types.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { stripEmptyVariantFields } from "./type-foundation";
import { getCatalog } from "./index";
import type { FenelType } from "./types";

const MOD = loadFenelModule(setExprTypesSrc, "engine");

function entityType(id: string): FenelType {
  const e = (MOD.entities ?? []).find((x) => x.id === id);
  if (!e) throw new Error(`set-expr-types.fenel missing entity "${id}"`);
  return stripEmptyVariantFields(e.type);
}

// Compact, label/meta/ui-agnostic type-reference summary. Pins the load-bearing
// facts (the reference handle + the List / Maybe wrapper) without asserting the
// (Nothing) label / {} meta / (Nothing) ui noise on every field.
function typeRepr(t: unknown): string {
  if (t == null || typeof t !== "object") return JSON.stringify(t);
  const x = t as Record<string, any>;
  if ("$ref" in x && Object.keys(x).length === 1) return `ref:${x.$ref}`;
  if ("$opaque" in x && x.$opaque?.name === "List") {
    const cons = x.$opaque.pure?.$variant?.cases?.find((c: any) => c.name === "Cons");
    return `List(${typeRepr(cons.fields[0].type)})`;
  }
  if ("$variant" in x) {
    const names = x.$variant.cases.map((c: any) => c.name);
    if (names[0] === "Nothing" && names.includes("Just")) {
      const just = x.$variant.cases.find((c: any) => c.name === "Just");
      return `Maybe(${typeRepr(just.fields[0].type)})`;
    }
    return `variant[${names.join("|")}]`;
  }
  if ("$record" in x) {
    return `{${x.$record.fields.map((field: any) =>
      `${field.name}:${typeRepr(field.type)}`
    ).join(",")}}`;
  }
  return JSON.stringify(x).slice(0, 60);
}

// Extract `{ caseName -> [[fieldName, typeRepr], ...] }` from a $variant.
function variantSkeleton(t: FenelType): Record<string, Array<[string, string]>> {
  const v = (t as any).$variant;
  if (!v) throw new Error("not a $variant");
  const out: Record<string, Array<[string, string]>> = {};
  for (const c of v.cases) {
    out[c.name] = (c.fields ?? []).map((f: any) => [f.name, typeRepr(f.type)] as [string, string]);
  }
  return out;
}

// Extract `[[fieldName, typeRepr], ...]` from a $record.
function recordSkeleton(t: FenelType): Array<[string, string]> {
  const r = (t as any).$record;
  if (!r) throw new Error("not a $record");
  return (r.fields ?? []).map((f: any) => [f.name, typeRepr(f.type)] as [string, string]);
}

// ---------------------------------------------------------------------------
// 1. Roster
// ---------------------------------------------------------------------------

test("set-expr-types.fenel parses to the canonical 7-entity roster", () => {
  const ids = (MOD.entities ?? []).map((e) => e.id).sort();
  expect(ids).toEqual([
    "SetArrowParam",
    "SetBound",
    "SetBoundValue",
    "SetCtorField",
    "SetExpr",
    "SetInterval",
    "SetPattern",
  ]);
});

// ---------------------------------------------------------------------------
// 2. Locked D1 shapes
// ---------------------------------------------------------------------------

test("SetExpr is the canonical 15-case $variant (Se* cases, types.ts field names)", () => {
  // 15th case since signature-substrate P4 slice 3a: the validation-only rigid
  // atom SeRigid. (Fable audit 2026-07-31 — this skeleton was left at 14 cases
  // by 3a and the exact-compare had been failing silently outside the curated
  // P4 suites ever since.)
  expect(variantSkeleton(entityType("SetExpr"))).toEqual({
    SeAll: [],
    SeNone: [],
    SeEnum: [["values", "List(ref:Any)"]],
    SeInterval: [["interval", "{lo:Maybe({value:ref:Any,inclusive:ref:Boolean}),hi:Maybe({value:ref:Any,inclusive:ref:Boolean})}"]],
    SeRef: [["handle", "ref:String"]],
    SePattern: [["pattern", "ref:SetPattern"]], // mutual recursion
    SeWhere: [["pred", "ref:Any"]], // JSON-Logic Expression → explicit boundary carrier
    SeCtor: [["ctor", "ref:String"], ["fields", "List(ref:SetCtorField)"]],
    SeMu: [["var", "ref:String"], ["body", "ref:SetExpr"]],
    SeArrow: [["params", "List(ref:SetArrowParam)"], ["returns", "ref:SetExpr"]],
    SeRigid: [["scopeToken", "ref:String"], ["ordinal", "ref:Nat"], ["kind", "ref:Any"]],
    SeUnion: [["branches", "List(ref:SetExpr)"]],
    SeIntersect: [["branches", "List(ref:SetExpr)"]],
    SeDiff: [["left", "ref:SetExpr"], ["right", "ref:SetExpr"]],
    SeComplement: [["inner", "ref:SetExpr"]],
  });
});

test("SetPattern is the collision-free 7-case $variant (Sp* cases, mutual recursion to SetExpr)", () => {
  expect(variantSkeleton(entityType("SetPattern"))).toEqual({
    SpEmpty: [],
    SpEps: [],
    SpMatch: [["pred", "ref:SetExpr"]], // mutual recursion back to SetExpr
    SpSeq: [["a", "ref:SetPattern"], ["b", "ref:SetPattern"]],
    SpAlt: [["a", "ref:SetPattern"], ["b", "ref:SetPattern"]],
    SpRep: [["child", "ref:SetPattern"], ["min", "ref:Number"], ["max", "ref:Number"]],
    SpGroup: [["name", "ref:String"], ["child", "ref:SetPattern"], ["type", "Maybe(ref:SetExpr)"]],
  });
});

test("SetBoundValue is the locked 3-case $variant (number | string | expr)", () => {
  expect(variantSkeleton(entityType("SetBoundValue"))).toEqual({
    BvNumber: [["value", "ref:Number"]],
    BvString: [["value", "ref:String"]],
    BvExpr: [["expr", "ref:Any"]], // { $expr: Expression } → explicit boundary carrier
  });
});

test("SetBound is the locked single-ctor record (value + inclusive)", () => {
  expect(recordSkeleton(entityType("SetBound"))).toEqual([
    ["value", "ref:SetBoundValue"],
    ["inclusive", "ref:Boolean"],
  ]);
});

test("SetInterval is the locked single-ctor record (Maybe SetBound lo/hi)", () => {
  expect(recordSkeleton(entityType("SetInterval"))).toEqual([
    ["lo", "Maybe(ref:SetBound)"],
    ["hi", "Maybe(ref:SetBound)"],
  ]);
});

test("SetCtorField is the typed recursive child record for SeCtor", () => {
  expect(recordSkeleton(entityType("SetCtorField"))).toEqual([
    ["key", "ref:FieldKey"],
    ["wireName", "ref:String"],
    ["set", "ref:SetExpr"],
  ]);
});

test("SetArrowParam is the typed recursive child record for SeArrow", () => {
  expect(recordSkeleton(entityType("SetArrowParam"))).toEqual([
    ["key", "ref:FieldKey"],
    ["wireName", "ref:String"],
    ["set", "ref:SetExpr"],
  ]);
});

// ---------------------------------------------------------------------------
// 3. Catalog appearance (additive — pre-existing occupants undisturbed)
// ---------------------------------------------------------------------------

function catalogKinds(): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const section of getCatalog()) {
    for (const e of section.entries) {
      if (e.entity?.id && e.entity.type) {
        kinds.set(e.entity.id, Object.keys(e.entity.type)[0] ?? "?");
      }
    }
  }
  return kinds;
}

test("the 7 canonical entities surface in getCatalog() with the right kind", () => {
  const kinds = catalogKinds();
  expect(kinds.get("SetExpr")).toBe("$variant");
  expect(kinds.get("SetPattern")).toBe("$variant");
  expect(kinds.get("SetBoundValue")).toBe("$variant");
  expect(kinds.get("SetBound")).toBe("$record");
  expect(kinds.get("SetInterval")).toBe("$record");
  expect(kinds.get("SetCtorField")).toBe("$record");
  expect(kinds.get("SetArrowParam")).toBe("$record");
});

test("the colliding names' pre-existing occupants are undisturbed (additive)", () => {
  const kinds = catalogKinds();
  // expr-substrate's match-arm Pattern (PatLit | PatVar | …) still owns "Pattern".
  expect(kinds.get("Pattern")).toBe("$variant");
  // the deciders' marshalled Interval (record) / Bound (BoundNumber|String|Expr).
  expect(kinds.get("Interval")).toBe("$record");
  expect(kinds.get("Bound")).toBe("$variant");
});
