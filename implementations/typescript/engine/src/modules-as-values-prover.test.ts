// ---------------------------------------------------------------------------
// modules-as-values Phase 2c — Prover (`workstreams/modules-as-values/briefs/
// phase-2c-tag-classes-and-traversable.md` § "Prover").
//
// Prover's parameter is only a strategy tag (`Prover Structural`, `Prover
// Smt`), not the proposition's shape, so its method is typed over its general
// input (Rom's 2026-09-25 decision (a)): `Prover strategy = Prover propose:
// Any -> Result UnprovedReason Any`. The class parameter appears in no
// argument, so dispatch does not change. The declaration lives twice — the
// `.fenel` record in `fenel/std/interfaces.fenel` and the hand-written
// TypeScript seed in `prover.ts` — so this suite pins:
//   (A) `propose` stays at RETURN_POSITION, on the live seed, the registry
//       lookup and a fresh derivation from the `.fenel` record;
//   (B) the TypeScript seed IS the `.fenel` record's derivation
//       (`seedFromType`), so the two declarations cannot drift;
//   (C) the system registry's bare-name routing table (routes, dispatch
//       positions, general classes, and the Prover instance keys) is identical
//       to the snapshot taken at HEAD 8e36c8cc before any change
//       (`modules-as-values-prover.routing-snapshot.json`);
//   (D) each instance's `propose` is a qualified reference resolving, in the
//       system registry, to exactly the id its HEAD string named;
//   (E) each instance validates against the class record type (the instance
//       editor's `instanceMethodsValueType`), and a wrong value does not;
//   (F) each reference computes what its HEAD id string computed.
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
import { evaluate } from "./json-logic";
import { functionRefHandle } from "./type-foundation";
import type { FenelType, Interface } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";
import ROUTING_SNAPSHOT from "./modules-as-values-prover.routing-snapshot.json";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const proverEntity = specs.entities?.find((e) => e.id === "Prover");
if (!proverEntity?.type) throw new Error("missing .fenel class Prover");
const proverRecord: FenelType = proverEntity.type;
const classParam = String(proverEntity.params?.[0]);

const liveSeed = (): Interface => {
  const seed = dispatchRegistry.getClass("Prover");
  if (!seed) throw new Error("class Prover is not registered");
  return seed;
};
const derivedSeed = (): Interface => seedFromType("Prover", proverRecord, classParam);
const signatures = (seed: Interface) =>
  seed.methods.map((m) => ({ name: m.name, params: m.params, returns: m.returns }));
const fieldsOf = (t: FenelType) =>
  (t as { $record: { fields: Array<{ name: string; type: FenelType }> } }).$record.fields;

/** HEAD 8e36c8cc's instance values (`propose = "prover:structuralPropose"`),
 *  and the qualified reference each became. */
const PROPOSE: Array<[string, { $ref: string }, string]> = [
  ["Structural", { $ref: "prover.structuralPropose" }, "prover:structuralPropose"],
  ["Smt", { $ref: "prover.smtPropose" }, "prover:smtPropose"],
];
const liveMethods = (strategy: string): Record<string, unknown> => {
  const inst = dispatchRegistry.listInstances("Prover").find((i) => JSON.stringify(i.args) === JSON.stringify([strategy]));
  if (!inst) throw new Error(`no Prover ${strategy} instance`);
  return inst.methods as Record<string, unknown>;
};

describe("Phase 2c Prover (A) — propose stays at return position", () => {
  it("the class parameter is the strategy tag", () => {
    expect(classParam).toBe("strategy");
  });

  it("RETURN_POSITION on the live seed, the registry lookup, and the .fenel derivation", () => {
    expect(dispatchPositionForSeed(liveSeed(), "propose")).toBe(RETURN_POSITION);
    expect(methodDispatchPosition(dispatchRegistry, "Prover", "propose")).toBe(RETURN_POSITION);
    expect(dispatchPositionForSeed(derivedSeed(), "propose")).toBe(RETURN_POSITION);
  });
});

describe("Phase 2c Prover (B) — the TypeScript seed and the .fenel record declare the same method", () => {
  it("seed class parameter and signatures ≡ seedFromType(.fenel record)", () => {
    expect(liveSeed().params).toEqual(derivedSeed().params);
    expect(signatures(liveSeed())).toEqual(signatures(derivedSeed()));
  });

  it("propose is function-typed on both sides: one Any argument, Result UnprovedReason Any", () => {
    expect(fieldsOf(proverRecord).find((f) => f.name === "propose")?.type).toHaveProperty("$arrow");
    const method = liveSeed().methods.find((m) => m.name === "propose")!;
    expect(method.params.map((p) => p.type)).toEqual([{ $ref: "Any" }]);
    const cases = (method.returns as { $variant: { cases: Array<{ name: string; fields: Array<{ type: FenelType }> }> } })
      .$variant.cases;
    expect(cases.map((c) => [c.name, c.fields.map((f) => f.type)])).toEqual([
      ["Err", [{ $ref: "UnprovedReason" }]],
      ["Ok", [{ $ref: "Any" }]],
    ]);
  });
});

type RoutingRow = { typeName: string; key: string; scope: unknown; priority: number; methods?: Record<string, unknown> };

describe("Phase 2c Prover (C) — the system registry's routing table is unchanged", () => {
  const table = getSystemRegistry().routingTable() as unknown as {
    routes: Array<{ name: string }>;
    posIdx: Record<string, number>;
    generalIdx: Record<string, true>;
    instanceIdx: Record<string, Record<string, RoutingRow[]>>;
  };
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it("propose is no bare-name route and keeps its return position", () => {
    expect(table.routes.some((r) => r.name === "propose")).toBe(false);
    expect(table.posIdx["Prover.propose"]).toBe(RETURN_POSITION);
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

  it("the Prover instances keep their keys, scopes, priorities and method names", () => {
    const projected = Object.fromEntries(
      Object.entries(table.instanceIdx.Prover ?? {}).map(([key, rows]) => [
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
    expect(plain(projected)).toEqual(ROUTING_SNAPSHOT.instanceKeys.Prover);
  });
});

describe("Phase 2c Prover (D) — each propose names the function its HEAD string named", () => {
  const ctx = getSystemRegistry().evaluateContext();
  for (const [strategy, reference, id] of PROPOSE) {
    it(`Prover ${strategy}: ${reference.$ref} resolves to ${id}`, () => {
      const value = liveMethods(strategy).propose;
      expect(value).toEqual(reference);
      const handle = functionRefHandle(value);
      expect(handle === undefined ? undefined : ctx.getFunction?.(handle)?.id).toBe(id);
    });
  }
});

describe("Phase 2c Prover (E) — the instances validate against the class record type", () => {
  const registry = getSystemRegistry();
  for (const [strategy] of PROPOSE) {
    it(`Prover ${strategy}: its methods are a value of the class record type`, () => {
      const type = instanceMethodsValueType("Prover", [strategy], registry);
      expect(fieldsOf(type).find((f) => f.name === "propose")?.type).toHaveProperty("$arrow");
      const result = validate(type, liveMethods(strategy), null, { registry });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  it("the arrow is checked: a wrong arity and a non-callable are refused", () => {
    const type = instanceMethodsValueType("Prover", ["Structural"], registry);
    expect(validate(type, { propose: { $ref: "std:add" } }, null, { registry }).errors).toEqual([
      { path: "propose", message: 'Function "std:add" has 2 param(s) but expected 1' },
    ]);
    expect(validate(type, { propose: 42 }, null, { registry }).valid).toBe(false);
  });
});

describe("Phase 2c Prover (F) — each reference computes what its id string computed", () => {
  const ctx = getSystemRegistry().evaluateContext();
  const apply = (f: unknown, claim: unknown): unknown => {
    try {
      return { ok: evaluate({ call: [{ var: "f" }, { var: "claim" }] } as never, { f, claim }, ctx) };
    } catch (error) {
      return { threw: String((error as Error).message ?? error) };
    }
  };
  const CLAIMS: Array<Record<string, unknown>> = [
    { $tag: "PropEq", type: { $ref: "Number" }, lhs: 5, rhs: 5 },
    { $tag: "PropSubset", s: { $tag: "SeEnum", values: [1, 2] }, t: { $tag: "SeEnum", values: [1, 2, 3] } },
    { $tag: "JInhabited", _0: { $tag: "SeEnum", values: [1, 2] } },
    { $tag: "CompilableSemanticEquivalence" },
  ];

  it("the reference and the HEAD id string agree on every claim shape", () => {
    for (const [strategy, , id] of PROPOSE) {
      for (const claim of CLAIMS) {
        const viaRef = apply(liveMethods(strategy).propose, claim);
        expect(viaRef, `${strategy} ${String(claim.$tag)}`).toEqual(apply(id, claim));
        expect(viaRef, `${strategy} ${String(claim.$tag)} returns`).toHaveProperty("ok");
      }
    }
  });

  it("Structural proves a PropEq by reduction; Smt stays the OutOfScope stub", () => {
    expect(apply(liveMethods("Structural").propose, CLAIMS[0])).toEqual({
      ok: { $tag: "Ok", _0: { $tag: "Refl", value: 5 } },
    });
    expect(apply(liveMethods("Smt").propose, CLAIMS[0])).toEqual({
      ok: { $tag: "Err", _0: { $tag: "OutOfScope", note: "Smt bridge not integrated (post-workstream arc)" } },
    });
  });
});
