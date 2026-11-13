// ---------------------------------------------------------------------------
// modules-as-values Phase 2c — DecidableMembership (`workstreams/modules-as-
// values/briefs/phase-2c-tag-classes-and-traversable.md` § "DecidableMembership").
//
// DecidableMembership's parameter is only a tag (the set shape: `SetInterval`,
// `SetEnum`, …), so its methods are typed over their general input (Rom's
// 2026-09-25 decision (a)): `contains : (SetExpr, Any) -> Maybe Boolean`,
// `decideSubset` / `decideDisjoint : (SetExpr, SetExpr) -> Maybe Boolean`,
// `decideEmpty : SetExpr -> Maybe Boolean`, `witness : SetExpr -> Maybe Any`,
// `enumerate : SetExpr -> Maybe (List Any)`. A two-argument method takes its
// arguments together, the arity of the natives that implement it. The class
// parameter appears in no argument, so dispatch does not change. The
// declaration lives twice — the `.fenel` record in `fenel/std/interfaces.fenel`
// and the hand-written TypeScript seed in `decidable-membership.ts` — so this
// suite pins:
//   (A) the six methods stay at RETURN_POSITION, on the live seed, the registry
//       lookup and a fresh derivation from the `.fenel` record;
//   (B) the TypeScript seed IS the `.fenel` record's derivation
//       (`seedFromType`), so the two declarations cannot drift;
//   (C) the system registry's bare-name routing table (routes, dispatch
//       positions, general classes, and the DecidableMembership instance keys)
//       is identical to the snapshot taken at HEAD 06302ef8 before any change
//       (`modules-as-values-decidable-membership.routing-snapshot.json`) — in
//       particular `contains` still routes to `Containable`;
//   (D) each of the 90 values is a qualified reference naming exactly the id
//       its HEAD string named: the 60 `set.*` handles resolve in the system
//       registry, the 30 `engine.*` handles in the engine harness (the registry
//       that loads the `engine` module);
//   (E) each instance's methods are a value of the class record's method
//       fields, and a wrong arity or a non-callable is refused;
//   (F) each reference computes what its HEAD id string computed;
//   (G) a shape-specific procedure given a set of another shape, or a value
//       that is not a SetExpr, answers `Nothing` (the natives threw before),
//       and `engine:seEnumNone` answers `Just []` only for `SeNone` (it
//       answered `Just []` for any set — tcb-ledger row `rig.witness`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  dispatchPositionForSeed,
  methodDispatchPosition,
  seedFromType,
  RETURN_POSITION,
} from "./effect-dispatch";
import { dispatchRegistry } from "./system-entities";
import { getSystemRegistry } from "./system-registry";
import { loadFenelModule } from "./fenel-module";
import { instanceMethodsValueType } from "./authoring/value-authoring";
import { validate } from "./validate";
import { evaluate, type EvaluateContext } from "./json-logic";
import { functionRefHandle, List } from "./type-foundation";
import { __getHarnessForTests, dispatchEngineBody } from "./engine-bodies-dispatch";
import { dmNatives } from "./modules/decidable-membership";
import type { FenelType, Interface } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";
import ROUTING_SNAPSHOT from "./modules-as-values-decidable-membership.routing-snapshot.json";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const dmEntity = specs.entities?.find((e) => e.id === "DecidableMembership");
if (!dmEntity?.type) throw new Error("missing .fenel class DecidableMembership");
const dmRecord: FenelType = dmEntity.type;
const classParam = String(dmEntity.params?.[0]);

const METHODS = ["contains", "decideSubset", "decideDisjoint", "decideEmpty", "witness", "enumerate"] as const;
const LAWS = [
  "decidableMembershipSubsetSoundness",
  "decidableMembershipDisjointSoundness",
  "decidableMembershipEmptySoundness",
  "decidableMembershipWitnessSoundness",
];

const liveSeed = (): Interface => {
  const seed = dispatchRegistry.getClass("DecidableMembership");
  if (!seed) throw new Error("class DecidableMembership is not registered");
  return seed;
};
const derivedSeed = (): Interface => seedFromType("DecidableMembership", dmRecord, classParam);
const signatures = (seed: Interface) =>
  seed.methods.map((m) => ({ name: m.name, params: m.params, returns: m.returns }));
type Field = { name: string; type: FenelType };
const fieldsOf = (t: FenelType): Field[] => (t as { $record: { fields: Field[] } }).$record.fields;

/** HEAD 06302ef8's instance values, per shape, in METHODS order
 *  (`contains = "set:setAllContains"`, …). Each became the qualified
 *  reference `{$ref: "<module>.<name>"}` of the same function. */
const HEAD_IDS: Array<[string, string[]]> = [
  ["SetAll", ["set:setAllContains", "set:setAllDecideSubset", "set:setAllDecideDisjoint", "set:setAllDecideEmpty", "engine:seWitnessNone", "engine:seEnumOpaque"]],
  ["SetNone", ["set:setNoneContains", "set:setNoneDecideSubset", "set:setNoneDecideDisjoint", "set:setNoneDecideEmpty", "engine:seWitnessNone", "engine:seEnumNone"]],
  ["SetEnum", ["set:setEnumContains", "set:setEnumDecideSubset", "set:setEnumDecideDisjoint", "set:setEnumDecideEmpty", "engine:seWitnessEnum", "engine:seEnumEnum"]],
  ["SetInterval", ["set:setIntervalContains", "set:setIntervalDecideSubset", "set:setIntervalDecideDisjoint", "set:setIntervalDecideEmpty", "engine:seWitnessInterval", "engine:seEnumOpaque"]],
  ["SetNamed", ["set:setNamedContains", "set:setNamedDecideSubset", "set:setNamedDecideDisjoint", "set:setNamedDecideEmpty", "engine:seWitnessRef", "engine:seEnumOpaque"]],
  ["SetPattern", ["set:setPatternContains", "set:setPatternDecideSubset", "set:setPatternDecideDisjoint", "set:setPatternDecideEmpty", "engine:seWitnessNone", "engine:seEnumOpaque"]],
  ["SetWhere", ["set:setWhereContains", "set:setWhereDecideSubset", "set:setWhereDecideDisjoint", "set:setWhereDecideEmpty", "engine:seWitnessNone", "engine:seEnumOpaque"]],
  ["SetUnion", ["set:setUnionContains", "set:setUnionDecideSubset", "set:setUnionDecideDisjoint", "set:setUnionDecideEmpty", "engine:seWitnessUnion", "engine:seEnumUnion"]],
  ["SetIntersect", ["set:setIntersectContains", "set:setIntersectDecideSubset", "set:setIntersectDecideDisjoint", "set:setIntersectDecideEmpty", "engine:seWitnessIntersect", "engine:seEnumIntersect"]],
  ["SetDiff", ["set:setDiffContains", "set:setDiffDecideSubset", "set:setDiffDecideDisjoint", "set:setDiffDecideEmpty", "engine:seWitnessDiff", "engine:seEnumOpaque"]],
  ["SetComplement", ["set:setComplementContains", "set:setComplementDecideSubset", "set:setComplementDecideDisjoint", "set:setComplementDecideEmpty", "engine:seWitnessNone", "engine:seEnumOpaque"]],
  ["SetCtor", ["set:contains", "set:decideSubset", "set:decideDisjoint", "set:decideEmpty", "engine:seWitnessCtor", "engine:seEnumOpaque"]],
  ["SetMu", ["set:contains", "set:decideSubset", "set:decideDisjoint", "set:decideEmpty", "engine:seWitnessMu", "engine:seEnumOpaque"]],
  ["SetArrow", ["set:contains", "set:decideSubset", "set:decideDisjoint", "set:decideEmpty", "engine:seWitnessArrow", "engine:seEnumOpaque"]],
  ["SetRigid", ["set:contains", "set:decideSubset", "set:decideDisjoint", "set:decideEmpty", "engine:seWitnessNone", "engine:seEnumOpaque"]],
];
/** `set:setAllContains` → `{$ref: "set.setAllContains"}`. */
const referenceOf = (id: string): { $ref: string } => ({ $ref: id.replace(":", ".") });

const liveMethods = (shape: string): Record<string, unknown> => {
  const inst = dispatchRegistry
    .listInstances("DecidableMembership")
    .find((i) => JSON.stringify(i.args) === JSON.stringify([shape]));
  if (!inst) throw new Error(`no DecidableMembership ${shape} instance`);
  return inst.methods as Record<string, unknown>;
};

const NOTHING = { $tag: "Nothing" };
const just = (value: unknown) => ({ $tag: "Just", _0: value });

// One SetExpr per shape (the instance's own), plus the fixtures the grids reuse.
const SE_ALL = { $tag: "SeAll" };
const SE_NONE = { $tag: "SeNone" };
const SE_ENUM = { $tag: "SeEnum", values: [1, 2, 3] };
const OWN: Record<string, unknown> = {
  SetAll: SE_ALL,
  SetNone: SE_NONE,
  SetEnum: SE_ENUM,
  SetInterval: { $tag: "SeInterval", interval: { lo: just({ value: 0, inclusive: true }), hi: just({ value: 10, inclusive: true }) } },
  SetNamed: { $tag: "SeRef", handle: "String" },
  SetPattern: { $tag: "SePattern", pattern: { t: "match", pred: { $tag: "SeRef", handle: "char:ascii-letter" } } },
  SetWhere: { $tag: "SeWhere", pred: { call: ["gt", { var: "x" }, 0] } },
  SetUnion: { $tag: "SeUnion", branches: [SE_NONE, { $tag: "SeEnum", values: [7] }] },
  SetIntersect: {
    $tag: "SeIntersect",
    branches: [
      { $tag: "SeInterval", interval: { lo: just({ value: 0, inclusive: true }), hi: NOTHING } },
      { $tag: "SeInterval", interval: { lo: NOTHING, hi: just({ value: 5, inclusive: true }) } },
    ],
  },
  SetDiff: { $tag: "SeDiff", left: SE_ENUM, right: { $tag: "SeEnum", values: [2] } },
  SetComplement: { $tag: "SeComplement", inner: SE_NONE },
  SetCtor: { $tag: "SeCtor", ctor: "Nothing", fields: [] },
  SetMu: { $tag: "SeMu", var: "X", body: { $tag: "SeCtor", ctor: "Nil", fields: [] } },
  SetArrow: {
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: { $tag: "PositionalField", index: 0 }, wireName: "_0", set: { $tag: "SeEnum", values: [1] } }],
    returns: { $tag: "SeEnum", values: [2] },
  },
  SetRigid: { $tag: "SeRigid", scopeToken: "t", ordinal: 0, kind: { $tag: "KType" } },
};

describe("Phase 2c DecidableMembership (A) — every method stays at return position", () => {
  it("the class parameter is the shape tag", () => {
    expect(classParam).toBe("s");
  });

  for (const method of METHODS) {
    it(`${method}: RETURN_POSITION on the live seed, the registry lookup, and the .fenel derivation`, () => {
      expect(dispatchPositionForSeed(liveSeed(), method)).toBe(RETURN_POSITION);
      expect(methodDispatchPosition(dispatchRegistry, "DecidableMembership", method)).toBe(RETURN_POSITION);
      expect(dispatchPositionForSeed(derivedSeed(), method)).toBe(RETURN_POSITION);
    });
  }
});

describe("Phase 2c DecidableMembership (B) — the TypeScript seed and the .fenel record declare the same methods", () => {
  it("seed class parameter and signatures ≡ seedFromType(.fenel record)", () => {
    expect(liveSeed().params).toEqual(derivedSeed().params);
    expect(signatures(liveSeed())).toEqual(signatures(derivedSeed()));
  });

  it("the record keeps its six methods and its four law fields, in order", () => {
    expect(fieldsOf(dmRecord).map((f) => f.name)).toEqual([...METHODS, ...LAWS]);
    for (const law of LAWS) {
      const cases = (fieldsOf(dmRecord).find((f) => f.name === law)!.type as { $variant: { cases: Array<{ name: string }> } })
        .$variant.cases;
      expect({ law, cases: cases.map((c) => c.name) }).toEqual({ law, cases: ["Verified"] });
    }
  });

  it("each method is function-typed on both sides, over its general input", () => {
    const SET_EXPR = { $ref: "SetExpr" };
    const ANY = { $ref: "Any" };
    const EXPECTED: Record<string, [FenelType[], FenelType]> = {
      contains: [[SET_EXPR, ANY], { $ref: "Boolean" }],
      decideSubset: [[SET_EXPR, SET_EXPR], { $ref: "Boolean" }],
      decideDisjoint: [[SET_EXPR, SET_EXPR], { $ref: "Boolean" }],
      decideEmpty: [[SET_EXPR], { $ref: "Boolean" }],
      witness: [[SET_EXPR], ANY],
      enumerate: [[SET_EXPR], List(ANY)],
    };
    /** `Maybe a` inlined as the parser's variant: `a` is the `Just` payload. */
    const maybePayload = (t: FenelType): FenelType | undefined => {
      const cases = (t as { $variant: { cases: Array<{ name: string; fields?: Array<{ type: FenelType }> }> } }).$variant.cases;
      expect(cases.map((c) => c.name)).toEqual(["Nothing", "Just"]);
      return cases[1]!.fields?.[0]?.type;
    };
    for (const method of METHODS) {
      expect({ method, record: fieldsOf(dmRecord).find((f) => f.name === method)?.type }).toHaveProperty("record.$arrow");
      const seed = liveSeed().methods.find((m) => m.name === method)!;
      const [params, payload] = EXPECTED[method]!;
      expect({ method, params: seed.params.map((p) => p.type) }).toEqual({ method, params });
      expect({ method, payload: maybePayload(seed.returns) }).toEqual({ method, payload });
    }
  });
});

type RoutingRow = { typeName: string; key: string; scope: unknown; priority: number; methods?: Record<string, unknown> };

describe("Phase 2c DecidableMembership (C) — the system registry's routing table is unchanged", () => {
  const table = getSystemRegistry().routingTable() as unknown as {
    routes: Array<{ name: string; resolution: unknown }>;
    posIdx: Record<string, number>;
    generalIdx: Record<string, true>;
    instanceIdx: Record<string, Record<string, RoutingRow[]>>;
  };
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it("no DecidableMembership method is a bare-name route; `contains` still routes to Containable", () => {
    for (const method of METHODS) {
      expect({ method, position: table.posIdx[`DecidableMembership.${method}`] }).toEqual({ method, position: RETURN_POSITION });
    }
    for (const method of METHODS.filter((m) => m !== "contains")) {
      expect({ method, routed: table.routes.some((r) => r.name === method) }).toEqual({ method, routed: false });
    }
    expect(plain(table.routes.filter((r) => r.name === "contains"))).toEqual([
      { name: "contains", resolution: { $tag: "RDispatch", _0: "Containable" } },
    ]);
  });

  it("bare-name routes are identical to the pre-change snapshot", () => {
    expect(plain(table.routes)).toEqual(ROUTING_SNAPSHOT.routes);
  });

  it("per-(class, method) dispatch positions are identical to the pre-change snapshot", () => {
    expect(plain(table.posIdx)).toEqual(ROUTING_SNAPSHOT.posIdx);
  });

  it("general (pattern-bearing) classes are identical to the pre-change snapshot", () => {
    expect(plain(table.generalIdx)).toEqual(ROUTING_SNAPSHOT.generalIdx);
  });

  it("the 15 DecidableMembership instances keep their keys, scopes, priorities and method names", () => {
    const projected = Object.fromEntries(
      Object.entries(table.instanceIdx.DecidableMembership ?? {}).map(([key, rows]) => [
        key,
        rows.map((r) => ({
          typeName: r.typeName,
          key: r.key,
          scope: r.scope,
          priority: r.priority,
          methodNames: Object.keys(r.methods ?? {}).sort(),
        })),
      ]),
    );
    expect(Object.keys(projected)).toHaveLength(15);
    expect(plain(projected)).toEqual(ROUTING_SNAPSHOT.instanceKeys.DecidableMembership);
  });
});

describe("Phase 2c DecidableMembership (D) — each value names the function its HEAD string named", () => {
  const systemCtx = getSystemRegistry().evaluateContext();
  const harnessCtx = __getHarnessForTests().ctx;

  it("the corpus is 60 `set.*` references and 30 `engine.*` references", () => {
    const handles = HEAD_IDS.flatMap(([shape]) => METHODS.map((m) => functionRefHandle(liveMethods(shape)[m])));
    expect(handles.filter((h) => h?.startsWith("set."))).toHaveLength(60);
    expect(handles.filter((h) => h?.startsWith("engine."))).toHaveLength(30);
  });

  for (const [shape, ids] of HEAD_IDS) {
    it(`DecidableMembership ${shape}: six qualified references, each resolving to its HEAD id`, () => {
      const methods = liveMethods(shape);
      expect(Object.keys(methods).sort()).toEqual([...METHODS].sort());
      METHODS.forEach((method, i) => {
        const id = ids[i]!;
        expect({ method, value: methods[method] }).toEqual({ method, value: referenceOf(id) });
        // `set` is a system module; `engine` is loaded by the engine harness.
        const ctx = id.startsWith("engine:") ? harnessCtx : systemCtx;
        const handle = functionRefHandle(methods[method]);
        expect({ method, id: handle === undefined ? undefined : ctx.getFunction?.(handle)?.id }).toEqual({ method, id });
      });
    });
  }
});

describe("Phase 2c DecidableMembership (E) — the instances' methods are a value of the class record type", () => {
  const registry = getSystemRegistry();
  // The class record also carries the four law fields, erasable obligations the
  // law audit discharges; an instance's `methods` object never holds them (true
  // at HEAD too), so each value is checked against the record's method fields.
  // In the system registry the `engine.*` references resolve to no function, and
  // validation admits a reference it cannot resolve (a pre-existing, refute-only
  // limit), so (D) is what pins those 30 handles.
  const methodFieldsType = (shape: string): FenelType => {
    const type = instanceMethodsValueType("DecidableMembership", [shape], registry) as { $record: { fields: Field[] } };
    expect(type.$record.fields.map((f) => f.name)).toEqual([...METHODS, ...LAWS]);
    for (const method of METHODS) {
      expect({ method, type: type.$record.fields.find((f) => f.name === method)?.type }).toHaveProperty("type.$arrow");
    }
    return { $record: { ...type.$record, fields: type.$record.fields.filter((f) => (METHODS as readonly string[]).includes(f.name)) } } as FenelType;
  };

  for (const [shape] of HEAD_IDS) {
    it(`DecidableMembership ${shape}: its methods validate`, () => {
      const result = validate(methodFieldsType(shape), liveMethods(shape), null, { registry });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  it("the arrows are checked: a wrong arity and a non-callable are refused", () => {
    const type = methodFieldsType("SetAll");
    const base = liveMethods("SetAll");
    expect(validate(type, { ...base, contains: { $ref: "set:decideEmpty" } }, null, { registry }).errors).toEqual([
      { path: "contains", message: 'Function "set:decideEmpty" has 1 param(s) but expected 2' },
    ]);
    expect(validate(type, { ...base, decideEmpty: { $ref: "set.setAllContains" } }, null, { registry }).errors).toEqual([
      { path: "decideEmpty", message: 'Function "set.setAllContains" has 2 param(s) but expected 1' },
    ]);
    expect(validate(type, { ...base, witness: { $ref: "std:add" } }, null, { registry }).errors).toEqual([
      { path: "witness", message: 'Function "std:add" has 2 param(s) but expected 1' },
    ]);
    expect(validate(type, { ...base, decideSubset: 42 }, null, { registry }).valid).toBe(false);
  });
});

describe("Phase 2c DecidableMembership (F) — each reference computes what its id string computed", () => {
  const systemCtx = getSystemRegistry().evaluateContext();
  const harnessCtx = __getHarnessForTests().ctx;
  const apply = (ctx: EvaluateContext, f: unknown, args: unknown[]): unknown => {
    const data: Record<string, unknown> = { f };
    args.forEach((a, i) => (data[`a${i}`] = a));
    try {
      return { ok: evaluate({ call: [{ var: "f" }, ...args.map((_, i) => ({ var: `a${i}` }))] } as never, data, ctx) };
    } catch (error) {
      return { threw: String((error as Error).message ?? error) };
    }
  };
  /** The arguments each method is applied to: the instance's own shape, two
   *  others, and (single-set methods) a value that is not a SetExpr. */
  const argGrid = (method: string, own: unknown): unknown[][] => {
    const sets = [own, ...[SE_ALL, SE_ENUM].filter((s) => s !== own)];
    if (method === "contains") return [...sets.map((s) => [s, 2]), [42, 2]];
    if (method === "decideSubset" || method === "decideDisjoint") return sets.flatMap((s) => [[s, SE_ALL], [s, SE_ENUM]]);
    return [...sets.map((s) => [s]), [42]];
  };

  for (const [shape, ids] of HEAD_IDS) {
    it(`DecidableMembership ${shape}: reference ≡ id string on every argument`, () => {
      const methods = liveMethods(shape);
      METHODS.forEach((method, i) => {
        const id = ids[i]!;
        const ctx = id.startsWith("engine:") ? harnessCtx : systemCtx;
        for (const args of argGrid(method, OWN[shape])) {
          const viaRef = apply(ctx, methods[method], args);
          expect({ method, args, result: viaRef }).toEqual({ method, args, result: apply(ctx, id, args) });
          expect({ method, args, result: viaRef }).toHaveProperty("result.ok");
        }
      });
    });
  }

  it("the references decide their own shapes", () => {
    const m = (shape: string, method: string) => liveMethods(shape)[method];
    expect(apply(systemCtx, m("SetAll", "contains"), [SE_ALL, 2])).toEqual({ ok: just(true) });
    expect(apply(systemCtx, m("SetNone", "contains"), [SE_NONE, 2])).toEqual({ ok: just(false) });
    expect(apply(systemCtx, m("SetEnum", "contains"), [SE_ENUM, 2])).toEqual({ ok: just(true) });
    expect(apply(systemCtx, m("SetEnum", "contains"), [SE_ENUM, 9])).toEqual({ ok: just(false) });
    expect(apply(systemCtx, m("SetInterval", "decideSubset"), [OWN.SetInterval, SE_ALL])).toEqual({ ok: just(true) });
    expect(apply(systemCtx, m("SetNone", "decideEmpty"), [SE_NONE])).toEqual({ ok: just(true) });
    expect(apply(harnessCtx, m("SetEnum", "witness"), [SE_ENUM])).toEqual({ ok: just(1) });
    expect(apply(harnessCtx, m("SetEnum", "enumerate"), [SE_ENUM])).toEqual({ ok: just([1, 2, 3]) });
    expect(apply(harnessCtx, m("SetNone", "enumerate"), [SE_NONE])).toEqual({ ok: just([]) });
  });
});

describe("Phase 2c DecidableMembership (G) — a wrong shape answers Nothing", () => {
  const systemCtx = getSystemRegistry().evaluateContext();
  const PER_SHAPE_CONTAINS: Array<[string, unknown]> = [
    ["setAllContains", SE_ALL],
    ["setNoneContains", SE_NONE],
    ["setEnumContains", SE_ENUM],
    ["setIntervalContains", OWN.SetInterval],
    ["setNamedContains", OWN.SetNamed],
    ["setPatternContains", OWN.SetPattern],
    ["setWhereContains", OWN.SetWhere],
    ["setUnionContains", OWN.SetUnion],
    ["setIntersectContains", OWN.SetIntersect],
    ["setDiffContains", OWN.SetDiff],
    ["setComplementContains", OWN.SetComplement],
  ];
  const NOT_SET_EXPRS: unknown[] = [42, "SeAll", { foo: 1 }, null, [SE_ALL]];
  const arity = (name: string): "member" | "pair" | "single" =>
    /contains$/i.test(name) ? "member" : /decide(Subset|Disjoint)$/i.test(name) ? "pair" : "single";

  it("each per-shape contains native answers Nothing for a set of every other shape", () => {
    for (const [name, own] of PER_SHAPE_CONTAINS) {
      for (const [otherShape, other] of Object.entries(OWN)) {
        if (other === own) continue;
        expect({ name, otherShape, result: dmNatives[name]!(other, 2) }).toEqual({ name, otherShape, result: NOTHING });
      }
    }
  });

  it("every decision native answers Nothing for a value that is not a SetExpr, in any set position", () => {
    for (const [name, native] of Object.entries(dmNatives)) {
      for (const bad of NOT_SET_EXPRS) {
        const kind = arity(name);
        const calls = kind === "member" ? [[bad, 2]] : kind === "pair" ? [[bad, SE_ALL], [SE_ALL, bad]] : [[bad]];
        for (const args of calls) {
          expect({ name, args, result: native(...args) }).toEqual({ name, args, result: NOTHING });
        }
      }
    }
  });

  it("through a qualified reference, a per-shape procedure given another shape answers Nothing", () => {
    const call = (f: unknown, s: unknown, x: unknown) =>
      evaluate({ call: [{ var: "f" }, { var: "s" }, { var: "x" }] } as never, { f, s, x }, systemCtx);
    // `setAllContains` answered `Just true` for any set it accepted; a `SeNone` is now undecided, not a member.
    expect(call(liveMethods("SetAll").contains, SE_NONE, 2)).toEqual(NOTHING);
    expect(call(liveMethods("SetEnum").contains, SE_ALL, 2)).toEqual(NOTHING);
    expect(call(liveMethods("SetInterval").contains, 42, 2)).toEqual(NOTHING);
  });

  it("each shape-specific engine face answers Nothing for a set of another shape, and for a non-SetExpr", () => {
    const FACES: Array<[string, string]> = [
      ["engine:seWitnessEnum", "SetEnum"],
      ["engine:seWitnessInterval", "SetInterval"],
      ["engine:seWitnessRef", "SetNamed"],
      ["engine:seWitnessUnion", "SetUnion"],
      ["engine:seWitnessIntersect", "SetIntersect"],
      ["engine:seWitnessCtor", "SetCtor"],
      ["engine:seWitnessMu", "SetMu"],
      ["engine:seWitnessArrow", "SetArrow"],
      ["engine:seEnumEnum", "SetEnum"],
      ["engine:seEnumNone", "SetNone"],
      ["engine:seEnumUnion", "SetUnion"],
      ["engine:seEnumIntersect", "SetIntersect"],
    ];
    for (const [face, ownShape] of FACES) {
      for (const [otherShape, other] of [...Object.entries(OWN), ["42", 42] as [string, unknown]]) {
        if (otherShape === ownShape) continue;
        expect({ face, otherShape, result: dispatchEngineBody(face, [other]) }).toEqual({ face, otherShape, result: NOTHING });
      }
    }
  });

  it("engine:seEnumNone claims the complete empty extension only for SeNone; enumerateSet is unchanged", () => {
    expect(dispatchEngineBody("engine:seEnumNone", [SE_NONE])).toEqual(just([]));
    // A rigid is non-enumerable (tcb-ledger `rig.witness`): `Just []` would call it decidably empty.
    expect(dispatchEngineBody("engine:seEnumNone", [OWN.SetRigid])).toEqual(NOTHING);
    expect(dispatchEngineBody("engine:seEnumNone", [SE_ALL])).toEqual(NOTHING);
    expect(dispatchEngineBody("engine:seEnumNone", [{ $tag: "SeEnum", values: [] }])).toEqual(NOTHING);
    // The live reader routes only SeNone to the face: its answers do not move.
    expect(dispatchEngineBody("engine:enumerateSet", [SE_NONE])).toEqual(just([]));
    expect(dispatchEngineBody("engine:enumerateSet", [OWN.SetRigid])).toEqual(NOTHING);
    expect(dispatchEngineBody("engine:enumerateSet", [{ $tag: "SeEnum", values: [] }])).toEqual(just([]));
  });
});
