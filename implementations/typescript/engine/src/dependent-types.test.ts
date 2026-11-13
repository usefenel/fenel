import { describe, it, expect } from "vitest";
import {
  Vec,
  LengthBoundedString,
  Sigma,
  SigmaGuards,
  resolveEl,
  peelEl,
  isFenelType,
} from "./dependent-types";
import { containsB as contains, typeToSetExpr } from "./index";
import { getSystemEvaluateContext } from "./system-registry";
import { pureEvaluateContext } from "./json-logic";
import type { FenelType, SetExpr } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";
import { Nothing } from "./type-foundation";
const evalCtx = pureEvaluateContext(getSystemEvaluateContext());

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of SetExprs but not the projection LOGIC. `cf` deeply
// lowers ANY-form SetExpr back to `$`-key so a byte-parity assertion vs a
// `$`-key expected literal stays a STRUCTURE/VALUE check (setExprToDollarKey
// rewrites only the discriminator, never a value or structure).
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

// array-substrate Phase 1a.5 — `Vec` is RETIRED-BY-SUBSUMPTION from the
// `$refined List (length==n)` encoding to the canonical `Vec n a = $map (Fin n)
// a` (total indexing, the Phase-1a algebra). The eager form is now the `$map`
// shape directly. NOTE the runtime-membership consequence (recorded surprise):
// `typeToSetExpr($map)` is `SeAll` (a `$map` type has no value-membership arm —
// the SAME state every `$map` type is in), so `containsType`/`contains` no longer
// length/element-VALIDATE a `Vec` value at this layer. That validation is the
// partial-vs-total distinction the Phase-0 prototype isolated (a TOTAL `Fin n`
// map's membership = "array of length n with elements ∈ a"); recovering it is the
// Phase-1b `Representable` (index/tabulate over `Fin n`) + Phase-4 conformance
// arms, NOT Phase 1a.5. So these tests assert the new SHAPE, not the deferred
// membership.
describe("Vec — `$map (Fin n) a` (eager form)", () => {
  it("Vec(T, n) with literal n returns `$map { keys: [0,n), values: T }`", () => {
    const Vec3 = Vec({ $ref: "Number" }, 3);
    expect("$map" in Vec3).toBe(true);
    if (!("$map" in Vec3)) return;
    expect(Vec3.$map.values).toEqual({ $ref: "Number" });
    expect(Vec3.$map.keys).toEqual({
      $tag: "SeInterval",
      interval: {
        lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
        hi: { $tag: "Just", _0: { value: 3, inclusive: false } },
      },
    } as never);
  });

  it("Vec(T, 0) is the empty index set `[0,0)` (rank-0-adjacent)", () => {
    const Vec0 = Vec({ $ref: "Number" }, 0);
    expect("$map" in Vec0).toBe(true);
    if (!("$map" in Vec0)) return;
    expect(Vec0.$map.keys).toMatchObject({
      $tag: "SeInterval",
      interval: { hi: { $tag: "Just", _0: { value: 0, inclusive: false } } },
    } as never);
  });
});

describe("Vec — late-bound form via `$el`", () => {
  it("Vec(T, { var: 'n' }) wraps in $el for runtime resolution (preserved)", () => {
    const VecN = Vec({ $ref: "Number" }, { var: "n" });
    expect("$el" in VecN).toBe(true);
  });

  it("the late-bound `$el` resolves to the `$map (Fin n)` form (vecOfLength redirected)", () => {
    const VecN = Vec({ $ref: "Number" }, { var: "n" });
    const resolved = resolveEl(VecN, { n: 3 }, evalCtx);
    expect(resolved && "$map" in resolved).toBe(true);
    if (resolved && "$map" in resolved) {
      expect(resolved.$map.values).toEqual({ $ref: "Number" });
    }
  });
});

describe("LengthBoundedString — `Vec n Char` (String = List Char)", () => {
  it("LengthBoundedString(6) is `Vec 6 Char` = `$map (Fin 6) Char`", () => {
    const Code6 = LengthBoundedString(6);
    expect("$map" in Code6).toBe(true);
    if (!("$map" in Code6)) return;
    expect(Code6.$map.values).toEqual({ $ref: "Char" });
    expect(Code6.$map.keys).toMatchObject({
      $tag: "SeInterval",
      interval: { hi: { $tag: "Just", _0: { value: 6, inclusive: false } } },
    } as never);
  });

  it("late-bound LengthBoundedString({ var: 'n' }) resolves to `$map (Fin n) Char`", () => {
    const CodeN = LengthBoundedString({ var: "n" });
    expect("$el" in CodeN).toBe(true);
    const resolved = resolveEl(CodeN, { n: 5 }, evalCtx);
    expect(resolved && "$map" in resolved).toBe(true);
    if (resolved && "$map" in resolved) {
      expect(resolved.$map.values).toEqual({ $ref: "Char" });
    }
  });
});

describe("Sigma — dependent pair", () => {
  it("Sigma(fst, snd) produces a record with fst & snd fields", () => {
    const t = Sigma({ $ref: "Number" }, { $ref: "String" });
    expect("$record" in t).toBe(true);
    if (!("$record" in t)) return;
    expect(t.$record.fields.map((f) => f.name)).toEqual(["fst", "snd"]);
  });
});

describe("SigmaGuards — fst chooses snd's type via $el", () => {
  it("snd's type uses $el for guarded selection", () => {
    const t = SigmaGuards(
      { $ref: "String" },
      [
        { when: { "==": [{ var: "fst" }, "a"] }, type: { $ref: "Number" } },
        { when: { "==": [{ var: "fst" }, "b"] }, type: { $ref: "Boolean" } },
      ],
      { $ref: "String" },
    );
    expect("$record" in t).toBe(true);
    if (!("$record" in t)) return;
    const sndField = t.$record.fields.find((f) => f.name === "snd")!;
    expect("$el" in sndField.type).toBe(true);
  });

  it("resolves the chosen type by evaluating the if-chain against fst", () => {
    const t = SigmaGuards(
      { $ref: "String" },
      [
        { when: { "==": [{ var: "fst" }, "a"] }, type: { $ref: "Number" } },
        { when: { "==": [{ var: "fst" }, "b"] }, type: { $ref: "Boolean" } },
      ],
      { $ref: "String" },
    );
    if (!("$record" in t)) throw new Error("expected $record");
    const sndType = t.$record.fields.find((f) => f.name === "snd")!.type;
    // fst = "a" → snd is Number
    expect(resolveEl(sndType, { fst: "a" }, evalCtx)).toEqual({ $ref: "Number" });
    // fst = "b" → snd is Boolean
    expect(resolveEl(sndType, { fst: "b" }, evalCtx)).toEqual({ $ref: "Boolean" });
    // fst = "z" → default String
    expect(resolveEl(sndType, { fst: "z" }, evalCtx)).toEqual({ $ref: "String" });
  });
});

describe("resolveEl / peelEl / isFenelType", () => {
  it("isFenelType recognises the canonical type constructors", () => {
    type ConstructorKey<T = FenelType> = T extends FenelType ? keyof T : never;
    const samples = {
      $void: { $void: true },
      $unit: { $unit: true },
      $ref: { $ref: "String" },
      $var: { $var: "a" },
      $record: { $record: { fields: [] } },
      $variant: { $variant: { cases: [{ name: "Present", label: Nothing }] } },
      $tuple: { $tuple: [{ $ref: "String" }, { $ref: "Number" }] },
      $map: { $map: { keys: { $tag: "SeAll" }, values: { $ref: "String" } } },
      $refined: { $refined: { base: { $ref: "Number" }, set: { $tag: "SeAll" } } },
      $union: { $union: [{ $ref: "String" }, { $ref: "Number" }] },
      $intersect: { $intersect: [{ $ref: "Number" }, { $ref: "Int" }] },
      $complement: { $complement: { $void: true } },
      $mu: { $mu: { var: "a", body: { $var: "a" } } },
      $tagged: { $tagged: { value: { $ref: "String" }, phantom: { $ref: "Email" } } },
      $opaque: { $opaque: { name: "Sample", pure: { $unit: true } } },
      $arrow: { $arrow: { params: [], returns: { $unit: true } } },
      $type: { $type: true },
      $el: { $el: { var: "t" } },
    } satisfies Record<ConstructorKey, FenelType>;
    for (const [key, sample] of Object.entries(samples)) {
      expect(isFenelType(sample), key).toBe(true);
    }
  });

  it("refuses non-objects, unknown keys and retired type forms", () => {
    const refused: unknown[] = [
      null, undefined, 42, "String", true, () => undefined,
      [], [{ $ref: "String" }], {}, { random: 1 }, { $unknown: true },
      Object.create({ $ref: "String" }),
      { $named: "String" }, { $app: ["List", { $ref: "String" }] },
      { $list: { $ref: "String" } }, { $maybe: { $ref: "String" } },
      { $result: { ok: { $ref: "String" }, err: { $ref: "String" } } },
    ];
    for (const value of refused) expect(isFenelType(value)).toBe(false);
  });

  it("resolves dependent union, intersection and complement types", () => {
    const types: FenelType[] = [
      { $union: [{ $ref: "String" }, { $ref: "Number" }] },
      { $intersect: [{ $ref: "Number" }, { $ref: "Int" }] },
      { $complement: { $void: true } },
    ];
    const inner: FenelType = { $el: { var: "t" } };
    const outer: FenelType = { $el: { var: "outer" } };
    for (const type of types) {
      expect(resolveEl(inner, { t: type }, evalCtx)).toEqual(type);
      expect(peelEl(outer, { outer: inner, t: type }, evalCtx)).toEqual(type);
    }
  });

  it("refuses retired or unknown types returned by a dependent expression", () => {
    const type: FenelType = { $el: { var: "t" } };
    for (const value of [{ $named: "String" }, { $unknown: true }, 42]) {
      expect(resolveEl(type, { t: value }, evalCtx)).toBeUndefined();
      expect(peelEl(type, { t: value }, evalCtx)).toBeUndefined();
    }
  });

  it("resolveEl evaluates the wrapped Expression against the context", () => {
    const t: FenelType = { $el: { var: "t" } };
    const resolved = resolveEl(t, { t: { $ref: "String" } });
    expect(resolved).toEqual({ $ref: "String" });
  });

  it("peelEl unwraps nested $el layers", () => {
    const inner: FenelType = { $el: { var: "inner" } };
    const outer: FenelType = { $el: { var: "outer" } };
    const result = peelEl(outer, { outer: inner, inner: { $ref: "Boolean" } });
    expect(result).toEqual({ $ref: "Boolean" });
  });
});

describe("typeToSetExpr — $el is opaque without a context", () => {
  it("Vec($el-wrapped) yields {$all: true} from typeToSetExpr alone", () => {
    const VecN = Vec({ $ref: "Number" }, { var: "n" });
    expect(cf(typeToSetExpr(VecN))).toEqual({ $all: true });
  });

  it("typeToSetExpr(Vec3) is a REAL value-membership predicate (the 1a.5 deferral CLOSED)", () => {
    // array-substrate Phase 1b deliverable 0 — the `$map` value-membership floor.
    // A finite-Fin-keyed `$map` (the canonical `Vec n a = $map (Fin n) a`) now
    // projects to a `$where` membership predicate (length(value)==n ∧ every
    // element ∈ ⟦values⟧), NOT `SeAll`. This RECOVERS the length/element runtime
    // validation 1a.5 deferred (the redirect surprise). The general finite-keyed
    // rule: a value inhabits `$map (Fin n) a` iff it is a TOTAL function
    // `Fin n → a` (an array of length n with conforming elements).
    const Vec3 = Vec({ $ref: "Number" }, 3);
    const setExpr = typeToSetExpr(Vec3);
    expect(cf(setExpr)).not.toEqual({ $all: true }); // no longer the universe
    expect(contains(setExpr, [1, 2, 3], null, {}, evalCtx)).toBe(true); // length 3, all numbers
    expect(contains(setExpr, [1, 2], null, {}, evalCtx)).toBe(false); // wrong length — REJECTED
    expect(contains(setExpr, ["a", "b", "c"], null, {}, evalCtx)).toBe(false); // wrong element kind
  });

  it("an OPEN-keyed `$map` (Map String Number) is UNCHANGED — stays `SeAll`", () => {
    // The membership floor tightens ONLY finite-keyed maps; open / infinite
    // key-domains (locale-strings, parser-env maps, dictionaries) keep today's
    // permissive behavior — the intelligently-deferred general-partial-membership
    // follow-on (design/array-substrate.md §2b).
    const mapStrNum: FenelType = {
      $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "Number" } },
    } as unknown as FenelType;
    expect(cf(typeToSetExpr(mapStrNum))).toEqual({ $all: true });
  });
});

describe("end-to-end: dependent types via $el substrate", () => {
  it("a record with a sibling-bound Vec type is constructible", () => {
    // type Frame = { n: Number, items: Vec(Number, n) }. The interesting
    // per-field validation (matching `items` length against `n`) happens via
    // validate.ts which walks each field and threads formData — covered in
    // validate.test.ts. Here we just confirm the substrate accepts the shape.
    const Frame: FenelType = {
      $record: {
        fields: [
          { name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "items", label: Nothing, type: Vec({ $ref: "Number" }, { var: "n" }), meta: {}, ui: Nothing },
        ],
      },
    };
    expect("$record" in Frame).toBe(true);
    if (!("$record" in Frame)) return;
    const itemsField = Frame.$record.fields.find((f) => f.name === "items")!;
    expect("$el" in itemsField.type).toBe(true);
  });
});
