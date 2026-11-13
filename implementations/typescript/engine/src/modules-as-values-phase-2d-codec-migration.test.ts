// ---------------------------------------------------------------------------
// modules-as-values Phase 2d, slice S5 — honest declarations and values for
// Iso, Decodable and Migration
// (`workstreams/modules-as-values/briefs/phase-2d-types-at-the-call-site.md`,
// "Implementation plan", decision 10).
//
// The three classes stop declaring their function-valued methods as `String`:
//   Iso s a         = Iso encode: a -> Result String s  decode: s -> Result String a …
//   Decodable s a   = Decodable decode: s -> Result String a
//   Migration v1 v2 = Migration forward: v1 -> Result MigrationError v2
//                               backward: Maybe (v2 -> Result MigrationError v1) …
// with `MigrationError` and `Losslessness` declared beside Migration, and the
// 13 corpus values become qualified references. This suite pins:
//   (A) every method of Encodable, Decodable, Iso, Lens and Migration stays at
//       RETURN_POSITION, and the system registry's routing table (routes,
//       positions, general classes, and the instance keys of the six
//       multi-argument classes) equals the pre-change snapshot
//       `modules-as-values-phase-2d.routing-snapshot.json`;
//   (B) each TypeScript seed's methods and parameters ARE the `.fenel`
//       record's (`seedFromType`, the header parameters), its law bodies are
//       kept, and Iso claims no superclass;
//   (C) each value is a qualified reference that resolves in the system
//       registry to exactly the id its HEAD string named, and computes what
//       that id computed;
//   (D) the laws discharge with the statuses and sample counts the HEAD id
//       strings get, and the migration check natives run on the real
//       instances;
//   (E) the compose helpers take references, and refuse malformed values
//       loudly (a malformed Just is never Nothing);
//   (F) `backward = Just migration.x` is lowered by the declared field type;
//   (G) `CanonicalJsonString` is a registered refinement of String decided
//       by a Fenel predicate; `decodeJsonInt` takes only finite integers;
//   (H) the qualified method signatures of Iso, Decodable and Migration are
//       Solved, with the class parameters quantified in header order.
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
import { evaluate, pureEvaluateContext } from "./json-logic";
import type { EvaluateContext } from "./json-logic";
import { functionRefHandle } from "./type-foundation";
import { buildProveMissingHook } from "./law-discharge";
import { composeIso, composeDecodable } from "./codec";
import { composeMigration, migration as migrationSeed } from "./migration";
import {
  forwardTotalCheckNative,
  lowerMaybeFunctionReferences,
  roundtripCheckNative,
} from "./modules/migration";
import { contains } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import type { FenelType, Instance, Interface } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";
import ROUTING_SNAPSHOT from "./modules-as-values-phase-2d.routing-snapshot.json";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const entityOf = (name: string) => {
  const entity = specs.entities?.find((e) => e.id === name);
  if (!entity) throw new Error(`missing .fenel declaration ${name}`);
  return entity;
};
const liveSeed = (name: string): Interface => {
  const seed = dispatchRegistry.getClass(name);
  if (!seed) throw new Error(`class ${name} is not registered`);
  return seed;
};
const signatures = (seed: Interface) =>
  seed.methods.map((m) => ({ name: m.name, params: m.params, returns: m.returns }));

const CLASSES = ["Encodable", "Decodable", "Iso", "Lens", "Migration"] as const;

// ---------------------------------------------------------------------------
// (A) Positions and the routing snapshot.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (A) — every method stays at return position; routing is unchanged", () => {
  for (const cls of CLASSES) {
    it(`${cls}: every method is RETURN_POSITION on the live seed and the registry lookup`, () => {
      const seed = liveSeed(cls);
      expect(seed.methods.length).toBeGreaterThan(0);
      for (const m of seed.methods) {
        expect(dispatchPositionForSeed(seed, m.name), `${cls}.${m.name}`).toBe(RETURN_POSITION);
        expect(methodDispatchPosition(dispatchRegistry, cls, m.name), `${cls}.${m.name}`).toBe(RETURN_POSITION);
      }
    });
  }

  const table = getSystemRegistry().routingTable() as unknown as {
    routes: unknown;
    posIdx: Record<string, number>;
    generalIdx: Record<string, true>;
    instanceIdx: Record<string, Record<string, Array<{ scope: unknown; priority: number; methods?: Record<string, unknown> }>>>;
  };
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it("bare-name routes equal the pre-change snapshot", () => {
    expect(plain(table.routes)).toEqual(ROUTING_SNAPSHOT.routes);
  });

  it("per-(class, method) positions equal the pre-change snapshot", () => {
    expect(plain(table.posIdx)).toEqual(ROUTING_SNAPSHOT.posIdx);
  });

  it("general classes equal the pre-change snapshot", () => {
    expect(plain(table.generalIdx)).toEqual(ROUTING_SNAPSHOT.generalIdx);
  });

  it("the six multi-argument class indexes retain the baseline plus the explicit CalendarDate codec", () => {
    const snapshot = ROUTING_SNAPSHOT.instanceKeys as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(["Decodable", "Encodable", "Iso", "Lens", "Migration", "Reprable"]);
    for (const cls of Object.keys(snapshot)) {
      const byKey = table.instanceIdx[cls] ?? {};
      const projected = Object.fromEntries(
        Object.keys(byKey).sort().map((key) => [
          key,
          byKey[key]!.map((row) => ({
            scope: plain(row.scope),
            priority: row.priority,
            methods: Object.keys(row.methods ?? {}).sort(),
          })),
        ]),
      );
      // One reviewed source instance is added: time.calendarDateIso has the
      // complete type Iso String CalendarDate. The dedicated CalendarDate suite
      // checks that exact owner and both function references. This snapshot's
      // projection indexes by first argument, so its String bucket gains one
      // otherwise identical global decode/encode row; all other bytes stay pinned.
      const expected = plain(snapshot[cls]) as Record<string, unknown[]>;
      if (cls === "Iso") {
        expected.String = [...(expected.String ?? []), {
          scope: { $tag: "RsvGlobalScope" }, priority: 0, methods: ["decode", "encode"],
        }];
      }
      expect(projected as unknown, cls).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// (B) The seeds are the records.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (B) — the TypeScript seeds declare what the .fenel records declare", () => {
  for (const cls of CLASSES) {
    it(`${cls}: methods ≡ seedFromType(.fenel record); parameters ≡ the record's header, in order`, () => {
      const entity = entityOf(cls);
      const header = entity.params ?? [];
      expect(signatures(liveSeed(cls))).toEqual(signatures(seedFromType(cls, entity.type, header[0]!)));
      expect((liveSeed(cls).params ?? []).map((p) => p.name)).toEqual(header.map(param => typeof param === "string" ? param : param.name));
      expect(header.length).toBeGreaterThan(1);
    });
  }

  it("the function-valued methods are function-typed (no `String` placeholder is left)", () => {
    const fnMethods: Array<[string, string]> = [
      ["Decodable", "decode"], ["Iso", "encode"], ["Iso", "decode"], ["Migration", "forward"],
    ];
    for (const [cls, m] of fnMethods) {
      const method = liveSeed(cls).methods.find((x) => x.name === m)!;
      expect(method.params.length, `${cls}.${m}`).toBe(1);
      expect(method.returns, `${cls}.${m}`).not.toEqual({ $ref: "String" });
    }
    const backward = liveSeed("Migration").methods.find((x) => x.name === "backward")!;
    expect(backward.params).toEqual([]);
    const just = (backward.returns as { $variant: { cases: Array<{ name: string; fields?: Array<{ type: FenelType }> }> } })
      .$variant.cases.find((c) => c.name === "Just");
    expect(just?.fields?.[0]?.type).toHaveProperty("$arrow");
  });

  it("the law bodies are kept (sample discharge reads `.laws`)", () => {
    expect(liveSeed("Iso").laws?.map((l) => l.name)).toEqual(["iso-decode-encode-roundtrip", "iso-encode-decode-roundtrip"]);
    expect(liveSeed("Migration").laws?.map((l) => l.name)).toEqual(["migration-roundtrip-lossless", "migration-forward-total"]);
    for (const law of [...liveSeed("Iso").laws!, ...liveSeed("Migration").laws!]) {
      expect(law.property, law.name).toBeDefined();
    }
  });

  it("Iso claims no superclass (an Iso instance does not make Encodable or Decodable resolve)", () => {
    expect(liveSeed("Iso").supers).toBeUndefined();
  });

  it("MigrationError and Losslessness are declared beside Migration with the wire shapes of the natives", () => {
    const cases = (name: string) =>
      (entityOf(name).type as { $variant: { cases: Array<{ name: string; fields?: Array<{ name: string }> }> } })
        .$variant.cases.map((c) => [c.name, (c.fields ?? []).map((f) => f.name)]);
    expect(cases("Losslessness")).toEqual([["Lossless", []], ["Lossy", ["reason"]]]);
    expect(cases("MigrationError")).toEqual([
      ["FieldMissing", ["field"]],
      ["TypeIncompatible", ["field", "expected", "actual"]],
      ["DefaultUnavailable", ["field"]],
      ["InvariantViolation", ["message"]],
    ]);
  });

  it("the demo profile types are declared in the migration module", () => {
    const registry = getSystemRegistry();
    for (const [name, fields] of [
      ["ProfileDemoV1", ["firstName", "lastName"]],
      ["ProfileDemoV2", ["firstName", "lastName", "email"]],
      ["ProfileDemoV1Narrow", ["firstName"]],
    ] as const) {
      const entity = registry.listEntities().find((e) => e.id === name);
      expect(entity, name).toBeDefined();
      expect((entity as { module?: string }).module).toBe("migration");
      const declared = (entity!.type as { $record: { fields: Array<{ name: string }> } }).$record.fields.map((f) => f.name);
      expect(declared).toEqual([...fields]);
    }
  });
});

// ---------------------------------------------------------------------------
// (C) The corpus: HEAD's id strings (extracted with `git show 3a7b4166:…`).
// ---------------------------------------------------------------------------

const HEAD_METHOD_IDS: Array<[string, string[], string, string]> = [
  ["Iso", ["String", "Bytes"], "encode", "codec:base64Encode"],
  ["Iso", ["String", "Bytes"], "decode", "codec:base64Decode"],
  ["Iso", ["String", "JsonValue"], "encode", "codec:jsonEncode"],
  ["Iso", ["String", "JsonValue"], "decode", "codec:jsonDecode"],
  ["Iso", ["CanonicalJsonString", "JsonValue"], "encode", "codec:canonicalJsonEncode"],
  ["Iso", ["CanonicalJsonString", "JsonValue"], "decode", "codec:canonicalJsonDecode"],
  ["Decodable", ["JsonValue", "String"], "decode", "codec:decodeJsonString"],
  ["Decodable", ["JsonValue", "Boolean"], "decode", "codec:decodeJsonBool"],
  ["Decodable", ["JsonValue", "Number"], "decode", "codec:decodeJsonNumber"],
  ["Decodable", ["JsonValue", "Int"], "decode", "codec:decodeJsonInt"],
  ["Migration", ["ProfileDemoV1", "ProfileDemoV2"], "forward", "migration:profileDemoV1ToV2"],
  ["Migration", ["ProfileDemoV2", "ProfileDemoV1Narrow"], "forward", "migration:profileDemoV2ToV1Narrow"],
];
/** `backward` held `Just "migration:profileDemoV2ToV1"` and `Nothing`. */
const HEAD_BACKWARD: Array<[string[], string | null]> = [
  [["ProfileDemoV1", "ProfileDemoV2"], "migration:profileDemoV2ToV1"],
  [["ProfileDemoV2", "ProfileDemoV1Narrow"], null],
];

const sameArgs = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const liveInstance = (cls: string, args: readonly string[]): Instance => {
  const inst = dispatchRegistry.listInstances(cls).find((i) => sameArgs(i.args, args));
  if (!inst) throw new Error(`no ${cls} ${args.join(" ")} instance`);
  return inst;
};
const methodsOf = (inst: Instance) => inst.methods as Record<string, unknown>;
/** The instance's methods with every converted value put back to HEAD's id string. */
const headMethods = (cls: string, args: string[], methods: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(methods)) {
    const row = HEAD_METHOD_IDS.find(([c, a, f]) => c === cls && sameArgs(a, args) && f === field);
    out[field] = row ? row[3] : value;
  }
  if (cls === "Migration") {
    const back = HEAD_BACKWARD.find(([a]) => sameArgs(a, args))![1];
    out["backward"] = back === null ? { $tag: "Nothing" } : { $tag: "Just", _0: back };
  }
  return out;
};

describe("Phase 2d S5 (C) — every value names the function its HEAD string named, and computes the same", () => {
  const ctx = getSystemRegistry().evaluateContext();
  const run = (rule: unknown, data: Record<string, unknown>): unknown => {
    try {
      return { ok: evaluate(rule as never, data, ctx) };
    } catch (error) {
      return { threw: String((error as Error).message ?? error) };
    }
  };
  const apply = (f: unknown, arg: unknown): unknown => run({ call: [{ var: "f" }, { var: "x" }] }, { f, x: arg });
  const agrees = (cls: string, args: string[], field: string, arg: unknown): unknown => {
    const row = HEAD_METHOD_IDS.find(([c, a, f]) => c === cls && sameArgs(a, args) && f === field)!;
    const viaRef = apply(methodsOf(liveInstance(cls, args))[field], arg);
    expect(viaRef, `${cls} ${args.join(" ")} .${field}`).toEqual(apply(row[3], arg));
    expect(viaRef, `${cls} ${args.join(" ")} .${field} returns`).toHaveProperty("ok");
    return (viaRef as { ok: unknown }).ok;
  };

  it("each value is a qualified `{$ref}` resolving, in the system registry, to its HEAD id", () => {
    const wrong: unknown[] = [];
    for (const [cls, args, field, id] of HEAD_METHOD_IDS) {
      const value = methodsOf(liveInstance(cls, args))[field];
      const handle = functionRefHandle(value);
      const qualified = typeof value === "object" && handle !== undefined && handle.includes(".") && !handle.includes(":");
      const resolved = handle === undefined ? undefined : ctx.getFunction?.(handle)?.id;
      if (!qualified || resolved !== id) wrong.push({ cls, args, field, value, resolved, expected: id });
    }
    expect(wrong).toEqual([]);
  });

  it("backward is Just a qualified reference to the HEAD id, or Nothing", () => {
    for (const [args, id] of HEAD_BACKWARD) {
      const backward = methodsOf(liveInstance("Migration", args))["backward"];
      if (id === null) {
        expect(backward).toEqual({ $tag: "Nothing" });
        continue;
      }
      expect(backward).toEqual({ $tag: "Just", _0: { $ref: "migration.profileDemoV2ToV1" } });
      const handle = functionRefHandle((backward as { _0: unknown })._0)!;
      expect(ctx.getFunction?.(handle)?.id).toBe(id);
    }
  });

  it("no Iso, Decodable or Migration corpus instance holds a function id string any more", () => {
    const strings: unknown[] = [];
    for (const cls of ["Iso", "Decodable", "Migration"]) {
      for (const inst of dispatchRegistry.listInstances(cls)) {
        for (const [field, value] of Object.entries(methodsOf(inst))) {
          if (typeof value === "string" && value.includes(":")) strings.push({ cls, args: inst.args, field, value });
        }
      }
    }
    expect(strings).toEqual([]);
  });

  it("Iso: encode / decode through the references equal the id strings, and round-trip", () => {
    const bytes = Uint8Array.of(0x48, 0x69);
    const b64 = agrees("Iso", ["String", "Bytes"], "encode", bytes) as { $tag: string; _0: string };
    expect(b64).toEqual({ $tag: "Ok", _0: "SGk=" });
    const back = agrees("Iso", ["String", "Bytes"], "decode", b64._0) as { $tag: string; _0: Uint8Array };
    expect(Array.from(back._0)).toEqual([0x48, 0x69]);
    expect((agrees("Iso", ["String", "Bytes"], "decode", "not base64!") as { $tag: string }).$tag).toBe("Err");

    const json = { $tag: "JsonArray", items: [{ $tag: "JsonNumber", value: 1 }, { $tag: "JsonString", value: "a" }] };
    const text = agrees("Iso", ["String", "JsonValue"], "encode", json) as { _0: string };
    expect(agrees("Iso", ["String", "JsonValue"], "decode", text._0)).toEqual({ $tag: "Ok", _0: json });

    const object = {
      $tag: "JsonObject",
      pairs: [
        { $tag: "JsonObjectEntry", key: "b", value: { $tag: "JsonNumber", value: 2 } },
        { $tag: "JsonObjectEntry", key: "a", value: { $tag: "JsonNull" } },
      ],
    };
    const canonical = agrees("Iso", ["CanonicalJsonString", "JsonValue"], "encode", object);
    expect(canonical).toEqual({ $tag: "Ok", _0: '{"a":null,"b":2}' });
    expect((agrees("Iso", ["CanonicalJsonString", "JsonValue"], "decode", '{"a":null,"b":2}') as { $tag: string }).$tag).toBe("Ok");
  });

  it("Decodable: the four JsonValue decoders through the references equal the id strings", () => {
    const J = (tag: string, value?: unknown) => (value === undefined ? { $tag: tag } : { $tag: tag, value });
    expect(agrees("Decodable", ["JsonValue", "String"], "decode", J("JsonString", "hi"))).toEqual({ $tag: "Ok", _0: "hi" });
    expect(agrees("Decodable", ["JsonValue", "Boolean"], "decode", J("JsonBool", true))).toEqual({ $tag: "Ok", _0: true });
    expect(agrees("Decodable", ["JsonValue", "Number"], "decode", J("JsonNumber", 2.5))).toEqual({ $tag: "Ok", _0: 2.5 });
    expect(agrees("Decodable", ["JsonValue", "Int"], "decode", J("JsonNumber", 7))).toEqual({ $tag: "Ok", _0: 7 });
    expect((agrees("Decodable", ["JsonValue", "Int"], "decode", J("JsonNull")) as { $tag: string }).$tag).toBe("Err");
    expect((agrees("Decodable", ["JsonValue", "String"], "decode", J("JsonNumber", 1)) as { $tag: string }).$tag).toBe("Err");
  });

  it("Migration: forward, and the Just-wrapped backward, through the references equal the id strings", () => {
    const v1 = { firstName: "Ada", lastName: "Lovelace" };
    const v2 = agrees("Migration", ["ProfileDemoV1", "ProfileDemoV2"], "forward", v1);
    expect(v2).toEqual({ $tag: "Ok", _0: { ...v1, email: "" } });
    const backward = methodsOf(liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"]))["backward"] as { _0: unknown };
    const viaRef = apply(backward._0, { ...v1, email: "" });
    expect(viaRef).toEqual(apply("migration:profileDemoV2ToV1", { ...v1, email: "" }));
    expect(viaRef).toEqual({ ok: { $tag: "Ok", _0: v1 } });
    expect(agrees("Migration", ["ProfileDemoV2", "ProfileDemoV1Narrow"], "forward", { ...v1, email: "a@b.c" }))
      .toEqual({ $tag: "Ok", _0: { firstName: "Ada" } });
    expect(agrees("Migration", ["ProfileDemoV1", "ProfileDemoV2"], "forward", { firstName: "Ada" }))
      .toEqual({ $tag: "Err", _0: { $tag: "FieldMissing", field: "lastName" } });
  });
});

// ---------------------------------------------------------------------------
// (D) Laws.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (D) — the laws discharge as they did with the id strings", () => {
  const LAWS: Record<string, string[]> = {
    Iso: ["isoDecodeEncodeRoundtrip", "isoEncodeDecodeRoundtrip"],
    Migration: ["migrationRoundtripLossless", "migrationForwardTotal"],
  };
  /** The statuses and sample counts, pinned (law-discharge-sample.test.ts pins
   *  the Iso String Bytes and Migration rows). */
  const EXPECTED: Record<string, unknown> = {
    "Iso String,Bytes isoDecodeEncodeRoundtrip": { status: "discharged", evidence: { $tag: "SampleTested", count: 6 } },
    "Iso String,Bytes isoEncodeDecodeRoundtrip": { status: "discharged", evidence: { $tag: "SampleTested", count: 5 } },
    "Migration ProfileDemoV1,ProfileDemoV2 migrationRoundtripLossless": { status: "discharged", evidence: { $tag: "SampleTested", count: 1 } },
    "Migration ProfileDemoV1,ProfileDemoV2 migrationForwardTotal": { status: "discharged", evidence: { $tag: "SampleTested", count: 1 } },
    "Migration ProfileDemoV2,ProfileDemoV1Narrow migrationRoundtripLossless": { status: "discharged", evidence: { $tag: "SampleTested", count: 1 } },
    "Migration ProfileDemoV2,ProfileDemoV1Narrow migrationForwardTotal": { status: "discharged", evidence: { $tag: "SampleTested", count: 1 } },
  };

  for (const cls of Object.keys(LAWS)) {
    it(`${cls}: every instance's laws get the outcome the HEAD id strings get`, () => {
      const { hookFor } = buildProveMissingHook();
      for (const inst of dispatchRegistry.listInstances(cls)) {
        const args = inst.args as string[];
        for (const law of LAWS[cls]!) {
          const key = `${cls} ${args.join(",")} ${law}`;
          const withRefs = hookFor(inst)(law, methodsOf(inst));
          const withStrings = hookFor(inst)(law, headMethods(cls, args, methodsOf(inst)));
          expect(withRefs, key).toEqual(withStrings);
          expect(withRefs, key).toBeDefined();
          if (EXPECTED[key] !== undefined) expect(withRefs as unknown, key).toEqual(EXPECTED[key]);
        }
      }
    });
  }

  it("the migration check natives run on the real instances", () => {
    const ctx = getSystemRegistry().evaluateContext();
    for (const args of [["ProfileDemoV1", "ProfileDemoV2"], ["ProfileDemoV2", "ProfileDemoV1Narrow"]]) {
      const m = methodsOf(liveInstance("Migration", args));
      expect(roundtripCheckNative(ctx, m.forward, m.backward, m.losslessness, m.roundtripSamples), args.join(" "))
        .toEqual({ $tag: "Just", _0: true });
      expect(forwardTotalCheckNative(ctx, m.forward, m.roundtripSamples), args.join(" "))
        .toEqual({ $tag: "Just", _0: true });
    }
  });

  it("the roundtrip check refutes a wrong backward reference, and throws on a malformed one", () => {
    const ctx = getSystemRegistry().evaluateContext();
    const m = methodsOf(liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"]));
    // backward = forward: V2 → V1 is not the inverse; the record gains `email`.
    const wrong = { $tag: "Just", _0: { $ref: "migration.profileDemoV1ToV2" } };
    expect(roundtripCheckNative(ctx, m.forward, wrong, m.losslessness, m.roundtripSamples)).toEqual({ $tag: "Just", _0: false });
    // A Lossless instance with Nothing backward is refuted, as before.
    expect(roundtripCheckNative(ctx, m.forward, { $tag: "Nothing" }, m.losslessness, m.roundtripSamples)).toEqual({ $tag: "Just", _0: false });
    expect(() => roundtripCheckNative(ctx, m.forward, { $tag: "Just", _0: 42 }, m.losslessness, m.roundtripSamples)).toThrow(/Just payload/);
    expect(() => roundtripCheckNative(ctx, m.forward, { $tag: "Just", var: "migration.profileDemoV2ToV1" }, m.losslessness, m.roundtripSamples)).toThrow(/Just without a payload/);
    expect(() => forwardTotalCheckNative(ctx, { $ref: "" }, m.roundtripSamples)).toThrow(/function reference/);
  });
});

// ---------------------------------------------------------------------------
// (E) Composition.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (E) — the compose helpers take references and refuse malformed values", () => {
  const ctx = getSystemRegistry().evaluateContext();
  // The composed methods are `{fn: […]}` EXPRESSIONS (what the evaluator and
  // the migration natives put in a call head), so they are applied in place.
  const call = (f: unknown, x: unknown) => evaluate({ call: [f, { var: "x" }] } as never, { x }, ctx);

  it("composeDecodable: String →(json) JsonValue →(Int) Int, over references", () => {
    const parse: Instance = { typeName: "Decodable", args: ["String", "JsonValue"], methods: { decode: { $ref: "codec.jsonDecode" } } };
    const composed = composeDecodable(parse, liveInstance("Decodable", ["JsonValue", "Int"]));
    expect(composed.args).toEqual(["String", "Int"]);
    expect(call(composed.methods.decode, "42")).toEqual({ $tag: "Ok", _0: 42 });
    expect((call(composed.methods.decode, "4.5") as { $tag: string }).$tag).toBe("Err");
    // The first stage's error propagates unchanged (it read as null before
    // Phase 2d: the closures passed it through as `{var: ""}`).
    const failed = call(composed.methods.decode, "{nope") as { $tag: string; _0: unknown };
    expect(failed.$tag).toBe("Err");
    expect(failed as unknown).toEqual(call({ $ref: "codec.jsonDecode" }, "{nope"));
  });

  it("composeIso: isoJson ∘ an identity Iso JsonValue JsonValue (closures) round-trips", () => {
    const ok = { fn: ["x", { construct: ["Ok", { var: "x" }] }] };
    const identity: Instance = { typeName: "Iso", args: ["JsonValue", "JsonValue"], methods: { encode: ok, decode: ok } };
    const composed = composeIso(liveInstance("Iso", ["String", "JsonValue"]), identity);
    expect(composed.args).toEqual(["String", "JsonValue"]);
    const value = { $tag: "JsonNumber", value: 3 };
    const text = call(composed.methods.encode, value) as { $tag: string; _0: string };
    expect(text).toEqual({ $tag: "Ok", _0: "3" });
    expect(call(composed.methods.decode, text._0)).toEqual({ $tag: "Ok", _0: value });
  });

  it("composeMigration over the real instances: Lossless ∘ Lossy is Lossy, and forward chains", () => {
    const composed = composeMigration(
      liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"]),
      liveInstance("Migration", ["ProfileDemoV2", "ProfileDemoV1Narrow"]),
    );
    expect(composed.args).toEqual(["ProfileDemoV1", "ProfileDemoV1Narrow"]);
    expect(composed.methods.backward).toEqual({ $tag: "Nothing" });
    expect((composed.methods.losslessness as { $tag: string }).$tag).toBe("Lossy");
    expect(call(composed.methods.forward, { firstName: "Ada", lastName: "L" })).toEqual({ $tag: "Ok", _0: { firstName: "Ada" } });
    expect(call(composed.methods.forward, { firstName: "Ada" })).toEqual({ $tag: "Err", _0: { $tag: "FieldMissing", field: "lastName" } });
  });

  it("composeMigration: a Lossless ∘ Lossless composition over references keeps a callable backward", () => {
    const there = liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"]);
    const back: Instance = {
      typeName: "Migration",
      args: ["ProfileDemoV2", "ProfileDemoV1"],
      methods: {
        forward: { $ref: "migration.profileDemoV2ToV1" },
        backward: { $tag: "Just", _0: { $ref: "migration.profileDemoV1ToV2" } },
        losslessness: { $tag: "Lossless" },
        roundtripSamples: [],
      },
    };
    const composed = composeMigration(there, back);
    const v1 = { firstName: "Ada", lastName: "Lovelace" };
    expect(call(composed.methods.forward, v1)).toEqual({ $tag: "Ok", _0: v1 });
    const m = methodsOf(composed);
    expect(roundtripCheckNative(ctx, m.forward, m.backward, m.losslessness, [v1])).toEqual({ $tag: "Just", _0: true });
  });

  it("malformed method values throw; a malformed Just is never read as Nothing", () => {
    const iso = (encode: unknown): Instance => ({ typeName: "Iso", args: ["A", "B"], methods: { encode, decode: { $ref: "codec.jsonDecode" } } });
    const isoJsonInst = liveInstance("Iso", ["String", "JsonValue"]);
    expect(() => composeIso(iso(42), isoJsonInst)).toThrow(/function reference/);
    expect(() => composeIso(iso({ $ref: "" }), isoJsonInst)).toThrow(/function reference/);
    expect(() => composeIso(iso(Object.create({ $ref: "codec.jsonEncode" })), isoJsonInst)).toThrow(/function reference/);
    expect(() => composeIso(iso(""), isoJsonInst)).toThrow(/function reference/);
    const dec: Instance = { typeName: "Decodable", args: ["A", "B"], methods: { decode: { fn: "not a list" } } };
    expect(() => composeDecodable(dec, dec)).toThrow(/function reference/);

    const lossless = liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"]);
    const withBackward = (backward: unknown): Instance => ({
      ...lossless,
      methods: { ...methodsOf(lossless), backward },
    });
    expect(() => composeMigration(withBackward({ $tag: "Just", _0: 42 }), lossless)).toThrow(/Just payload/);
    expect(() => composeMigration(withBackward({ $tag: "Just" }), lossless)).toThrow(/Just without a payload/);
    expect(() => composeMigration(withBackward({ $tag: "Just", var: "migration.x" }), lossless)).toThrow(/Just without a payload/);
    expect(() => composeMigration(withBackward(undefined), lossless)).toThrow(/Nothing or Just/);
    expect(() => composeMigration(withBackward("migration:profileDemoV2ToV1"), lossless)).toThrow(/Nothing or Just/);
    expect(() => composeMigration(
      { ...lossless, methods: { ...methodsOf(lossless), losslessness: "Lossless" } },
      lossless,
    )).toThrow(/Lossless or Lossy/);
  });
});

// ---------------------------------------------------------------------------
// (F) `Just migration.x`, lowered by the declared field type.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (F) — `backward = Just migration.x` becomes Just a reference", () => {
  const loaded = (...fields: string[]): Instance => {
    const inst = (loadFenelModule(
      ["inst : Migration A B", `inst = Migration { ${fields.join(", ")} }`].join("\n"),
      "probe",
      { dispatchInstanceFile: true },
    ).instances ?? []).find((i) => i.typeName === "Migration");
    if (!inst) throw new Error("no Migration instance projected");
    return inst;
  };
  const lowered = (...fields: string[]) => methodsOf(lowerMaybeFunctionReferences(loaded(...fields), migrationSeed));

  it("the application and the (same-JSON) record literal both lower under a Maybe (arrow) field", () => {
    expect(lowered("backward = Just migration.x").backward).toEqual({ $tag: "Just", _0: { $ref: "migration.x" } });
    expect(lowered('backward = Just { var = "migration.x" }').backward).toEqual({ $tag: "Just", _0: { $ref: "migration.x" } });
  });

  it("an explicit `{var}` payload lowers too; Nothing, a reference and a string id are left alone", () => {
    const base = loaded("forward = migration.f");
    const inst = (backward: unknown): Instance => ({ ...base, methods: { ...methodsOf(base), backward } });
    const lower = (backward: unknown) => methodsOf(lowerMaybeFunctionReferences(inst(backward), migrationSeed)).backward;
    expect(lower({ $tag: "Just", _0: { var: "migration.x" } })).toEqual({ $tag: "Just", _0: { $ref: "migration.x" } });
    expect(lower({ $tag: "Nothing" })).toEqual({ $tag: "Nothing" });
    expect(lower({ $tag: "Just", _0: { $ref: "migration.x" } })).toEqual({ $tag: "Just", _0: { $ref: "migration.x" } });
    expect(lower({ $tag: "Just", _0: "migration:x" })).toEqual({ $tag: "Just", _0: "migration:x" });
    // Not exactly the mis-lowered shape: left for validation to report.
    expect(lower({ $tag: "Just", var: "migration.x", extra: 1 })).toEqual({ $tag: "Just", var: "migration.x", extra: 1 });
    expect(lower({ $tag: "Just", _0: { var: "x", call: [] } })).toEqual({ $tag: "Just", _0: { var: "x", call: [] } });
    // Nothing changed ⇒ the same object.
    const untouched = inst({ $tag: "Nothing" });
    expect(lowerMaybeFunctionReferences(untouched, migrationSeed)).toBe(untouched);
  });

  it("fields of any other declared type are never touched (a record with a field named `var` stays a record)", () => {
    const methods = lowered('losslessness = Just { var = "x" }', 'roundtripSamples = [Just { var = "y" }]', 'packet = Packet { var = "hello" }');
    expect(methods.losslessness).toEqual({ $tag: "Just", var: "x" });
    expect(methods.roundtripSamples).toEqual([{ $tag: "Just", var: "y" }]);
    expect(methods.packet).toEqual({ $tag: "Packet", var: "hello" });
  });

  it("the class decides, not a flag: the lowering refuses an instance of another class", () => {
    expect(() => lowerMaybeFunctionReferences({ typeName: "Iso", args: [], methods: {} }, migrationSeed)).toThrow(/lowered against class Migration/);
  });

  it("the registered demo instance carries the lowered backward", () => {
    expect(methodsOf(liveInstance("Migration", ["ProfileDemoV1", "ProfileDemoV2"])).backward)
      .toEqual({ $tag: "Just", _0: { $ref: "migration.profileDemoV2ToV1" } });
  });
});

// ---------------------------------------------------------------------------
// (G) CanonicalJsonString and decodeJsonInt.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (G) — CanonicalJsonString membership; decodeJsonInt edge cases", () => {
  const registry = getSystemRegistry();
  const ctx = registry.evaluateContext();
  const pure: EvaluateContext = pureEvaluateContext(ctx);

  it("CanonicalJsonString is a registered refinement of String in the codec module", () => {
    const entity = registry.listEntities().find((e) => e.id === "CanonicalJsonString");
    expect(entity).toBeDefined();
    expect((entity as { module?: string }).module).toBe("codec");
    const refined = (entity!.type as { $refined?: { base: unknown } }).$refined;
    expect(refined?.base).toEqual({ $ref: "String" });
  });

  it("membership runs the Fenel predicate: a canonical string is in, a non-canonical one is out", () => {
    const entity = registry.listEntities().find((e) => e.id === "CanonicalJsonString")!;
    const set = typeToSetExpr(entity.type as FenelType);
    const member = (v: unknown) => contains(set, v, null, undefined, pure);
    for (const s of ["null", "42", '"hi"', "[1,2]", '{"a":1,"b":[true]}']) {
      expect(member(s), s).toEqual({ $tag: "Just", _0: true });
    }
    for (const s of ['{"b":1,"a":2}', "[1, 2]", " 42", "{nope", "", "1e3"]) {
      expect(member(s), s).toEqual({ $tag: "Just", _0: false });
    }
  });

  it("the predicate itself, and the canonical codec functions typed with the refinement", () => {
    const isCanonical = (s: string) => evaluate({ call: ["codec:isCanonicalJsonString", s] } as never, {}, ctx);
    expect(isCanonical('{"a":1}')).toBe(true);
    expect(isCanonical('{ "a": 1 }')).toBe(false);
    const fn = (id: string) => ctx.getFunction?.(id);
    const okType = (id: string) =>
      (fn(id)!.returns as { $variant: { cases: Array<{ name: string; fields?: Array<{ type: unknown }> }> } })
        .$variant.cases.find((c) => c.name === "Ok")!.fields![0]!.type;
    expect(okType("codec:canonicalJsonEncode")).toEqual({ $ref: "CanonicalJsonString" });
    expect(fn("codec:canonicalJsonDecode")!.params.map((p) => p.type)).toEqual([{ $ref: "CanonicalJsonString" }]);
  });

  it("decodeJsonInt accepts only finite integral numbers, keeping the JS-number representation", () => {
    const decode = (value: number) =>
      evaluate({ call: ["codec:decodeJsonInt", { var: "v" }] } as never, { v: { $tag: "JsonNumber", value } }, ctx) as {
        $tag: string;
        _0: unknown;
      };
    expect(decode(3)).toEqual({ $tag: "Ok", _0: 3 });
    expect(decode(-12)).toEqual({ $tag: "Ok", _0: -12 });
    expect(decode(2 ** 53 + 2)).toEqual({ $tag: "Ok", _0: 2 ** 53 + 2 });
    expect(decode(1e21)).toEqual({ $tag: "Ok", _0: 1e21 });
    const negZero = decode(-0);
    expect(negZero.$tag).toBe("Ok");
    expect(Object.is(negZero._0, -0) || negZero._0 === 0).toBe(true);
    expect(decode(2.5)).toEqual({ $tag: "Err", _0: "decodeJsonInt: expected Int, got fractional Number" });
    expect(decode(-0.1)).toEqual({ $tag: "Err", _0: "decodeJsonInt: expected Int, got fractional Number" });
    for (const v of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(decode(v), String(v)).toEqual({ $tag: "Err", _0: "decodeJsonInt: expected Int, got a non-finite Number" });
    }
  });
});

// ---------------------------------------------------------------------------
// (H) Qualified method signatures.
// ---------------------------------------------------------------------------

describe("Phase 2d S5 (H) — the qualified method signatures are Solved", () => {
  const registry = getSystemRegistry();
  const cases: Array<[string, string[]]> = [
    ["Iso.decode", ["s", "a"]],
    ["Iso.encode", ["s", "a"]],
    ["Decodable.decode", ["s", "a"]],
    ["Encodable.encode", ["s", "a"]],
    ["Lens.view", ["ctx", "s", "a"]],
    ["Lens.put", ["ctx", "s", "a"]],
    ["Migration.forward", ["v1", "v2"]],
    ["Migration.backward", ["v1", "v2"]],
  ];
  for (const [target, header] of cases) {
    it(`${target}: Solved, the class parameters quantified in header order`, () => {
      const row = registry.getCapabilityMethodSignature(target);
      expect(row, target).toBeDefined();
      expect(row!.outcome, target).toEqual({ $tag: "Solved" });
      const quantified = row!.scheme!.quantified.map((q) => q.sourceName);
      expect(quantified.slice(0, header.length), target).toEqual(header);
    });
  }
});
