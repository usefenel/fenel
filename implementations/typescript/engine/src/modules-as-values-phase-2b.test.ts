// ---------------------------------------------------------------------------
// modules-as-values Phase 2b — honest method types, then references in the
// corpus (`workstreams/modules-as-values/briefs/phase-2b-honest-method-types-and-conversion.md`,
// and § Traversable of `phase-2c-tag-classes-and-traversable.md`).
//
// Five classes stop declaring a function-valued method as `String`:
// Aggregable (`imageOf`, `preimageOf : SetExpr -> Maybe SetExpr`), Lens
// (`view : s -> a`, `put : (s, a) -> s`), Encodable (`encode : a -> Result
// String s`), Evaluator (`eval : (Expression, EvaluateContext) -> Result
// EvalError Value`) and Compilable (`compile : CompileSource -> Result
// CompileError target`). The declaration lives twice — the `.fenel` record in
// `fenel/std/interfaces.fenel` and the hand-written TypeScript seed. Reprable
// and the nine algebra classes (Functor, Monad, Monoid, Foldable, Applicative,
// Traversable, Representable, Sequential, Containable) already declared their
// methods as arrows. Every class's corpus values then become qualified
// references (`imageOf = aggregable.lengthImageOf`, `lift =
// std.natToNumber`, `fmap = algebra.maybeFmap`, `traverse =
// engine.deriveTraverse`). `Compilable JsAst` is re-keyed `Compilable
// JsModule`: its compiler returns a `JsModule`. This suite pins:
//   (A) the five honest declarations keep every changed method at
//       RETURN_POSITION, and every other converted class keeps HEAD's
//       dispatch position;
//   (B) the TypeScript seed's method signatures ARE the `.fenel` record's
//       (`seedFromType`), so the two declarations cannot drift;
//   (C) the system registry's bare-name routing table (routes, dispatch
//       positions, general classes, and the persisted-instance keys of every
//       class touched here) is identical to the snapshot taken at HEAD
//       665a9029 before any change (`modules-as-values-phase-2b.routing-
//       snapshot.json`); the one deliberate edit to the snapshot is the
//       Compilable key `JsAst` → `JsModule`;
//   (D) the instance editor's methods type (`instanceMethodsValueType`)
//       yields arrow fields for Aggregable, with and without a registry;
//   (E) every value is a qualified reference that resolves, in the registry
//       where the class's instances run (the system registry; the engine
//       harness for `engine.*`), to exactly the id its HEAD string named;
//   (F) each reference computes what its HEAD id string computed, applied
//       directly and through bare-name dispatch;
//   (G) each instance validates against its class record type as it did with
//       HEAD's strings; the function-typed fields of the non-curried classes
//       are admitted, and the gaps that remain are pinned (see (G)).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import type { EvaluateContext } from "./json-logic";
import { functionRefHandle } from "./type-foundation";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import { createEngineBootstrapRegistry, createRegistry } from "./registry";
import { inferJsonLogicType } from "./signature-inference";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { deriveFunctorModule, __getHarnessForTests } from "./engine-bodies-dispatch";
import type { FenelType, Interface } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";
import ROUTING_SNAPSHOT from "./modules-as-values-phase-2b.routing-snapshot.json";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const recordOf = (name: string): FenelType => {
  const type = specs.entities?.find((e) => e.id === name)?.type;
  if (!type) throw new Error(`missing .fenel class ${name}`);
  return type;
};

/** The five classes whose declarations change, with their dispatch parameter
 *  (the first type parameter) and the methods that became function-typed. */
const HONEST: Array<[string, string, string[]]> = [
  ["Aggregable", "agg", ["imageOf", "preimageOf"]],
  ["Lens", "ctx", ["view", "put"]],
  ["Encodable", "s", ["encode"]],
  ["Evaluator", "strategy", ["eval"]],
  ["Compilable", "target", ["compile"]],
];

/** The converted classes whose declarations did not change: their methods keep
 *  HEAD's dispatch positions (the snapshot's `posIdx`). */
const UNCHANGED_METHODS = [
  "Reprable.native", "Reprable.lift", "Reprable.lower",
  "Functor.fmap", "Monad.bind", "Monad.return", "Monoid.mappend", "Monoid.mempty",
  "Foldable.foldr", "Applicative.pure", "Applicative.ap", "Traversable.traverse",
  "Representable.index", "Representable.tabulate",
  "Sequential.take", "Sequential.drop", "Sequential.splitAt", "Containable.contains",
];

const liveSeed = (name: string): Interface => {
  const seed = dispatchRegistry.getClass(name);
  if (!seed) throw new Error(`class ${name} is not registered`);
  return seed;
};
const signatures = (seed: Interface) =>
  seed.methods.map((m) => ({ name: m.name, params: m.params, returns: m.returns }));

describe("Phase 2b (A) — dispatch positions", () => {
  for (const [cls, param, methods] of HONEST) {
    for (const m of methods) {
      it(`${cls}.${m}: RETURN_POSITION on the live seed, the registry lookup, and the .fenel derivation`, () => {
        expect(dispatchPositionForSeed(liveSeed(cls), m)).toBe(RETURN_POSITION);
        expect(methodDispatchPosition(dispatchRegistry, cls, m)).toBe(RETURN_POSITION);
        expect(dispatchPositionForSeed(seedFromType(cls, recordOf(cls), param), m)).toBe(RETURN_POSITION);
      });
    }
  }

  it("Reprable and the algebra classes keep HEAD's dispatch position for every method", () => {
    const heads = ROUTING_SNAPSHOT.posIdx as Record<string, number>;
    const moved: unknown[] = [];
    for (const key of UNCHANGED_METHODS) {
      const [cls, m] = key.split(".") as [string, string];
      const now = methodDispatchPosition(dispatchRegistry, cls, m);
      if (heads[key] === undefined || now !== heads[key]) moved.push({ key, head: heads[key], now });
    }
    expect(moved).toEqual([]);
  });
});

describe("Phase 2b (B) — the TypeScript seed and the .fenel record declare the same methods", () => {
  for (const [cls, param, methods] of HONEST) {
    it(`${cls}: seed signatures ≡ seedFromType(.fenel record)`, () => {
      expect(signatures(liveSeed(cls))).toEqual(signatures(seedFromType(cls, recordOf(cls), param)));
    });
    it(`${cls}: ${methods.join(", ")} are function-typed on both sides`, () => {
      const seed = liveSeed(cls);
      const fields = (recordOf(cls) as { $record: { fields: Array<{ name: string; type: FenelType }> } }).$record.fields;
      for (const m of methods) {
        expect(seed.methods.find((x) => x.name === m)!.params.length).toBeGreaterThan(0);
        expect(fields.find((f) => f.name === m)!.type).toHaveProperty("$arrow");
      }
    });
  }
});

type RoutingRow = { typeName: string; key: string; scope: unknown; priority: number; methods?: Record<string, unknown> };

describe("Phase 2b (C) — the system registry's routing table is unchanged", () => {
  const table = getSystemRegistry().routingTable() as unknown as {
    routes: unknown;
    posIdx: Record<string, number>;
    generalIdx: Record<string, true>;
    instanceIdx: Record<string, Record<string, RoutingRow[]>>;
  };
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it("bare-name routes are identical to the pre-change snapshot", () => {
    expect(plain(table.routes)).toEqual(ROUTING_SNAPSHOT.routes);
  });

  it("per-(class, method) dispatch positions are identical to the pre-change snapshot", () => {
    expect(plain(table.posIdx)).toEqual(ROUTING_SNAPSHOT.posIdx);
  });

  it("general (pattern-bearing) classes are identical to the pre-change snapshot", () => {
    expect(plain(table.generalIdx)).toEqual(ROUTING_SNAPSHOT.generalIdx);
  });

  it("the persisted instances of every touched class keep their keys, scopes, priorities and method names", () => {
    const snapshot = ROUTING_SNAPSHOT.instanceKeys as Record<string, unknown>;
    for (const cls of Object.keys(snapshot)) {
      const byKey = table.instanceIdx[cls] ?? {};
      const projected = Object.fromEntries(
        Object.entries(byKey).map(([key, rows]) => [
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
      expect(plain(projected), cls).toEqual(snapshot[cls]);
    }
  });

  it("the one deliberate change: Compilable is keyed JsModule, the type its compiler returns, not JsAst", () => {
    expect(Object.keys(table.instanceIdx.Compilable ?? {}).sort()).toEqual(["JsModule", "LlvmModule", "WasmModule"]);
  });
});

describe("Phase 2b (D) — the instance editor's methods type has arrow fields for Aggregable", () => {
  const fieldsOf = (t: FenelType) =>
    (t as { $record: { fields: Array<{ name: string; type: FenelType }> } }).$record.fields;
  const expectArrowFields = (t: FenelType) => {
    const fields = fieldsOf(t);
    for (const name of ["imageOf", "preimageOf"]) {
      const type = fields.find((f) => f.name === name)?.type as
        | { $arrow?: { params: Array<{ type: FenelType }>; returns: FenelType } }
        | undefined;
      expect(type?.$arrow, name).toBeDefined();
      expect(type!.$arrow!.params.map((p) => p.type)).toEqual([{ $ref: "SetExpr" }]);
      const cases = (type!.$arrow!.returns as { $variant: { cases: Array<{ name: string }> } }).$variant.cases;
      expect(cases.map((c) => c.name).sort()).toEqual(["Just", "Nothing"]);
    }
    // The static metadata fields stay values.
    expect(fields.find((f) => f.name === "inputType")?.type).toEqual({ $ref: "FenelType" });
  };

  it("with the system registry (the `.fenel` record, the editor's registry path)", () => {
    expectArrowFields(instanceMethodsValueType("Aggregable", ["length"], getSystemRegistry()));
  });

  it("without a registry (the dispatch seed fallback)", () => {
    expectArrowFields(instanceMethodsValueType("Aggregable", ["length"]));
  });
});

// ---------------------------------------------------------------------------
// (E) The corpus. The table is HEAD's colon-id strings (84 literals from the
// Phase 2b brief, extracted with `git show HEAD:<file>`, plus the three
// Traversable `engine:deriveTraverse` values). The one row whose instance key
// changed: HEAD keyed the JS compiler `Compilable JsAst`; it is keyed
// `Compilable JsModule` now. Each value must be a qualified `{$ref:
// "bundle.member"}` reference, and the registry where the class's instances
// run must resolve its handle (`getFunction(handle)?.id`, the readers' own
// resolution) to exactly that id: the system registry, or the engine harness
// for `engine.*` (the system registry carries no `engine` container).
// ---------------------------------------------------------------------------

const HEAD_METHOD_IDS: Array<[string, string[], string, string]> = [
  ["Reprable", ["JsRuntime", "Nat"], "lift", "std:natToNumber"],
  ["Reprable", ["JsRuntime", "Nat"], "lower", "std:numberToNat"],
  ["Reprable", ["JsRuntime", "Int"], "lift", "std:intToNumber"],
  ["Reprable", ["JsRuntime", "Int"], "lower", "std:numberToInt"],
  ["Reprable", ["JsRuntime", "Rational"], "lift", "std:rationalToNumber"],
  ["Reprable", ["JsRuntime", "Rational"], "lower", "std:numberToRational"],
  ["Reprable", ["JsRuntime", "Real"], "lift", "std:realToNumber"],
  ["Reprable", ["JsRuntime", "Real"], "lower", "std:numberToReal"],
  ["Reprable", ["JsRuntime", "Number"], "lift", "std:towerToDouble"],
  ["Reprable", ["JsRuntime", "Number"], "lower", "std:doubleToTower"],
  ["Reprable", ["JsRuntime", "List"], "lift", "std:listToArray"],
  ["Reprable", ["JsRuntime", "List"], "lower", "std:arrayToList"],
  ["Reprable", ["JsRuntime", "String"], "lift", "std:charListToString"],
  ["Reprable", ["JsRuntime", "String"], "lower", "std:stringToCharList"],
  ["Reprable", ["JsRuntime", "Char"], "lift", "std:charFromCode"],
  ["Reprable", ["JsRuntime", "Char"], "lower", "std:charCode"],
  ["Reprable", ["Jsonb", "Nat"], "lift", "std:natToNumber"],
  ["Reprable", ["Jsonb", "Nat"], "lower", "std:numberToNat"],
  ["Reprable", ["Jsonb", "Int"], "lift", "std:intToNumber"],
  ["Reprable", ["Jsonb", "Int"], "lower", "std:numberToInt"],
  ["Reprable", ["Jsonb", "Rational"], "lift", "std:rationalToNumber"],
  ["Reprable", ["Jsonb", "Rational"], "lower", "std:numberToRational"],
  ["Reprable", ["Jsonb", "Real"], "lift", "std:realToNumber"],
  ["Reprable", ["Jsonb", "Real"], "lower", "std:numberToReal"],
  ["Reprable", ["Jsonb", "Number"], "lift", "std:towerToDouble"],
  ["Reprable", ["Jsonb", "Number"], "lower", "std:doubleToTower"],
  ["Reprable", ["Jsonb", "List"], "lift", "std:listToArray"],
  ["Reprable", ["Jsonb", "List"], "lower", "std:arrayToList"],
  ["Reprable", ["Jsonb", "String"], "lift", "std:charListToString"],
  ["Reprable", ["Jsonb", "String"], "lower", "std:stringToCharList"],
  ["Reprable", ["Jsonb", "Char"], "lift", "std:charFromCode"],
  ["Reprable", ["Jsonb", "Char"], "lower", "std:charCode"],
  ["Functor", ["Maybe"], "fmap", "algebra:maybeFmap"],
  ["Functor", ["List"], "fmap", "std:map"],
  ["Functor", ["Result"], "fmap", "algebra:resultFmap"],
  ["Monad", ["Maybe"], "bind", "algebra:maybeBind"],
  ["Monad", ["List"], "bind", "algebra:listBind"],
  ["Monad", ["Result"], "bind", "algebra:resultBind"],
  ["Monoid", ["List"], "mappend", "std:concat"],
  ["Monoid", ["String"], "mappend", "std:concat"],
  ["Foldable", ["Maybe"], "foldr", "algebra:maybeFoldr"],
  ["Foldable", ["List"], "foldr", "algebra:listFoldr"],
  ["Foldable", ["Result"], "foldr", "algebra:resultFoldr"],
  ["Applicative", ["Maybe"], "pure", "algebra:maybePure"],
  ["Applicative", ["Maybe"], "ap", "algebra:maybeAp"],
  ["Applicative", ["List"], "pure", "algebra:listPure"],
  ["Applicative", ["List"], "ap", "algebra:listAp"],
  ["Applicative", ["Result"], "pure", "algebra:resultPure"],
  ["Applicative", ["Result"], "ap", "algebra:resultAp"],
  ["Traversable", ["Maybe"], "traverse", "engine:deriveTraverse"],
  ["Traversable", ["List"], "traverse", "engine:deriveTraverse"],
  ["Traversable", ["Result"], "traverse", "engine:deriveTraverse"],
  ["Representable", ["Vec"], "index", "algebra:vecIndex"],
  ["Sequential", ["List"], "take", "std:take"],
  ["Sequential", ["List"], "drop", "std:drop"],
  ["Sequential", ["List"], "splitAt", "algebra:splitAt"],
  ["Sequential", ["Vec"], "take", "algebra:take"],
  ["Sequential", ["Vec"], "drop", "algebra:drop"],
  ["Sequential", ["Vec"], "splitAt", "algebra:splitAt"],
  ["Containable", ["String"], "contains", "std:contains"],
  ["Containable", ["List"], "contains", "std:includes"],
  ["Aggregable", ["length"], "imageOf", "aggregable:lengthImageOf"],
  ["Aggregable", ["length"], "preimageOf", "aggregable:lengthPreimageOf"],
  ["Aggregable", ["count"], "imageOf", "aggregable:countImageOf"],
  ["Aggregable", ["count"], "preimageOf", "aggregable:countPreimageOf"],
  ["Aggregable", ["sum"], "imageOf", "aggregable:sumImageOf"],
  ["Aggregable", ["sum"], "preimageOf", "aggregable:sumPreimageOf"],
  ["Aggregable", ["avg"], "imageOf", "aggregable:avgImageOf"],
  ["Aggregable", ["avg"], "preimageOf", "aggregable:avgPreimageOf"],
  ["Aggregable", ["minimum"], "imageOf", "aggregable:minimumImageOf"],
  ["Aggregable", ["minimum"], "preimageOf", "aggregable:minimumPreimageOf"],
  ["Aggregable", ["maximum"], "imageOf", "aggregable:maximumImageOf"],
  ["Aggregable", ["maximum"], "preimageOf", "aggregable:maximumPreimageOf"],
  ["Aggregable", ["distinctCount"], "imageOf", "aggregable:distinctCountImageOf"],
  ["Aggregable", ["distinctCount"], "preimageOf", "aggregable:distinctCountPreimageOf"],
  ["Lens", ["Record", "Record", "String"], "view", "codec:recordFirstNameView"],
  ["Lens", ["Record", "Record", "String"], "put", "codec:recordFirstNamePut"],
  // HEAD keyed this instance `Compilable JsAst`.
  ["Compilable", ["JsModule"], "compile", "compile-js:compileFenelToJs"],
  ["Encodable", ["String", "JsModule"], "encode", "compile-js:serializeJsModule"],
  ["Compilable", ["LlvmModule"], "compile", "compile-llvm:compileFenelToLlvm"],
  ["Encodable", ["String", "LlvmModule"], "encode", "compile-llvm:serializeLlvmModule"],
  ["Compilable", ["WasmModule"], "compile", "compile-wasm:compileFenelToWasm"],
  ["Encodable", ["Bytes", "WasmModule"], "encode", "compile-wasm:serializeWasmModule"],
  ["Evaluator", ["EagerStrategy"], "eval", "evaluator-strategies:eagerEval"],
  ["Evaluator", ["LazyStrategy"], "eval", "evaluator-strategies:lazyEval"],
  ["Evaluator", ["PartialStrategy"], "eval", "evaluator-strategies:partialEval"],
  ["Evaluator", ["JitStrategy"], "eval", "evaluator-strategies:jitEval"],
];

/** Every class this suite converts. */
const CLASSES = [
  "Reprable", "Functor", "Monad", "Monoid", "Foldable", "Applicative", "Traversable",
  "Representable", "Sequential", "Containable",
  "Aggregable", "Lens", "Encodable", "Evaluator", "Compilable",
];

const sameArgs = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const liveInstance = (cls: string, args: readonly string[]) => {
  const inst = dispatchRegistry.listInstances(cls).find((i) => sameArgs(i.args, args));
  if (!inst) throw new Error(`no ${cls} ${args.join(" ")} instance`);
  return inst;
};
/** The corpus instances: those keyed by plain names. The derived structural
 *  instances (`{$pattern}` keys, registered as TypeScript data in
 *  system-entities.ts) are not corpus literals. */
const corpusInstances = (cls: string) =>
  dispatchRegistry.listInstances(cls).filter((i) => i.args.every((a) => typeof a === "string"));
const headIdOf = (cls: string, args: readonly string[], field: string) => {
  const row = HEAD_METHOD_IDS.find(([c, a, f]) => c === cls && sameArgs(a, args) && f === field);
  if (!row) throw new Error(`no HEAD id for ${cls} ${args.join(" ")} .${field}`);
  return row[3];
};

describe("Phase 2b (E) — every converted method names the function its HEAD string named", () => {
  const ctx = getSystemRegistry().evaluateContext();

  it("the table covers the brief's 84 literals and the three Traversable values, class by class", () => {
    const counts: Record<string, number> = {};
    for (const [cls] of HEAD_METHOD_IDS) counts[cls] = (counts[cls] ?? 0) + 1;
    expect(counts).toEqual({
      Reprable: 32, Functor: 3, Monad: 3, Monoid: 2, Foldable: 3, Applicative: 6, Traversable: 3,
      Representable: 1, Sequential: 6, Containable: 2,
      Aggregable: 14, Lens: 2, Encodable: 3, Evaluator: 4, Compilable: 3,
    });
    expect(HEAD_METHOD_IDS).toHaveLength(87);
  });

  it("no corpus instance of a converted class holds a colon-id string any more", () => {
    const strings: unknown[] = [];
    for (const cls of CLASSES) {
      for (const inst of corpusInstances(cls)) {
        for (const [field, value] of Object.entries(inst.methods as Record<string, unknown>)) {
          if (typeof value === "string" && value.includes(":")) strings.push({ cls, args: inst.args, field, value });
        }
      }
    }
    expect(strings).toEqual([]);
  });

  it("the table lists every function reference held by the converted corpus instances", () => {
    // `native`, `inputType` and `outputType` hold type references, not functions.
    const TYPE_VALUED = new Set(["native", "inputType", "outputType"]);
    const listed = new Set(HEAD_METHOD_IDS.map(([c, a, f]) => `${c} ${a.join(" ")} .${f}`));
    const references: string[] = [];
    for (const cls of CLASSES) {
      for (const inst of corpusInstances(cls)) {
        for (const [field, value] of Object.entries(inst.methods as Record<string, unknown>)) {
          if (value && typeof value === "object" && "$ref" in value && !TYPE_VALUED.has(field)) {
            references.push(`${cls} ${(inst.args as string[]).join(" ")} .${field}`);
          }
        }
      }
    }
    expect(references.sort()).toEqual([...listed].sort());
  });

  for (const cls of CLASSES.filter((c) => c !== "Traversable")) {
    it(`${cls}: each value is a qualified reference resolving, in the system registry, to its HEAD id`, () => {
      const wrong: unknown[] = [];
      for (const [c, args, field, id] of HEAD_METHOD_IDS) {
        if (c !== cls) continue;
        const value = (liveInstance(cls, args).methods as Record<string, unknown>)[field];
        const handle = functionRefHandle(value);
        const qualified = typeof value === "object" && handle !== undefined && handle.includes(".") && !handle.includes(":");
        const resolved = handle === undefined ? undefined : ctx.getFunction?.(handle)?.id;
        if (!qualified || resolved !== id) wrong.push({ args, field, value, resolved, expected: id });
      }
      expect(wrong).toEqual([]);
    });
  }

  it("Traversable: `engine.deriveTraverse` resolves in the engine harness to the declared bridge", () => {
    const { ctx: harnessCtx, reg } = __getHarnessForTests();
    for (const t of ["Maybe", "List", "Result"]) {
      expect(liveInstance("Traversable", [t]).methods).toEqual({ traverse: { $ref: "engine.deriveTraverse" } });
    }
    const fn = reg.getFunction("engine.deriveTraverse");
    expect(fn?.id).toBe("engine:deriveTraverse");
    // The declaration: two parameters, no body, no effect; the harness runs the
    // `derive-functor` container's context native under that id.
    expect(fn?.params.map((p) => p.name)).toEqual(["f", "value"]);
    expect(fn?.body).toBeUndefined();
    expect(fn?.requires ?? []).toEqual([]);
    expect(harnessCtx.nativesCtx?.["engine:deriveTraverse"]).toBeDefined();
    // It shadows nothing: the bare name and the id name the same function.
    expect(reg.getFunction("deriveTraverse")?.id).toBe("engine:deriveTraverse");
    expect(reg.getFunction("engine:deriveTraverse")?.id).toBe("engine:deriveTraverse");
    // The system registry carries no `engine` container, so the editor shows
    // this reference as stored, as it did the id string.
    expect(ctx.getFunction?.("engine.deriveTraverse")).toBeUndefined();
  });

  it("Compilable: no instance is keyed JsAst; the JS compiler's declared result is a JsModule", () => {
    expect(dispatchRegistry.listInstances("Compilable").some((i) => sameArgs(i.args, ["JsAst"]))).toBe(false);
    const compiler = ctx.getFunction?.("compileJs.compileFenelToJs");
    const ok = (compiler?.returns as { $variant: { cases: Array<{ name: string; fields?: Array<{ type: unknown }> }> } })
      .$variant.cases.find((c) => c.name === "Ok");
    expect(ok?.fields?.map((f) => f.type)).toEqual([{ $ref: "JsModule" }]);
  });
});

// ---------------------------------------------------------------------------
// (F) The converted values run: a reference is applied exactly as the id
// string it replaces (the same result through the same `evaluate` path), and
// bare-name dispatch reaches the converted instances. Traversable and the Vec
// cuts that fold (`drop`, `splitAt` read a derived Foldable) need the engine
// bodies and the `derive-functor` natives, so they run in a bootstrap registry
// of std + engine + algebra + derive-functor, built once.
// ---------------------------------------------------------------------------

describe("Phase 2b (F) — the converted methods compute what their id strings computed", () => {
  const ctx = getSystemRegistry().evaluateContext();
  let derivedCtx: EvaluateContext | undefined;
  const derived = (): EvaluateContext => {
    derivedCtx ??= createEngineBootstrapRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], {
      dispatchRegistry,
      publishCatalogEntities: false,
    }).evaluateContext();
    return derivedCtx;
  };
  const run = (rule: unknown, data: Record<string, unknown> = {}, c: EvaluateContext = ctx): unknown => {
    try {
      return { ok: evaluate(rule as never, data, c) };
    } catch (error) {
      return { threw: String((error as Error).message ?? error) };
    }
  };
  const apply = (f: unknown, args: unknown[], c: EvaluateContext = ctx): unknown => {
    const data: Record<string, unknown> = { f };
    args.forEach((a, i) => {
      data[`a${i}`] = a;
    });
    return run({ call: [{ var: "f" }, ...args.map((_, i) => ({ var: `a${i}` }))] }, data, c);
  };
  const methodOf = (cls: string, args: readonly string[], field: string) =>
    (liveInstance(cls, args).methods as Record<string, unknown>)[field];
  /** The reference and the HEAD id string, applied to the same arguments, agree. */
  const agrees = (cls: string, args: readonly string[], field: string, callArgs: unknown[], c: EvaluateContext = ctx) => {
    const viaRef = apply(methodOf(cls, args, field), callArgs, c);
    expect(viaRef, `${cls} ${args.join(" ")} .${field}`).toEqual(apply(headIdOf(cls, args, field), callArgs, c));
    expect(viaRef, `${cls} ${args.join(" ")} .${field} returns`).toHaveProperty("ok");
    return (viaRef as { ok: unknown }).ok;
  };
  const closure = (rule: unknown): unknown => (run(rule) as { ok: unknown }).ok;
  const inc = () => closure({ fn: ["x", { call: ["add", { var: "x" }, 1] }] });
  const plus = () => closure({ fn: ["x", { fn: ["acc", { call: ["add", { var: "x" }, { var: "acc" }] }] }] });
  const J = (x: unknown) => ({ $tag: "Just", _0: x });
  const OK = (x: unknown) => ({ $tag: "Ok", _0: x });
  const VEC4 = { $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 };

  it("Aggregable: imageOf / preimageOf through the references equal the id strings", () => {
    const outputSet = { $tag: "SeEnum", values: [5] };
    for (const agg of ["length", "count", "sum", "avg", "minimum", "maximum", "distinctCount"]) {
      agrees("Aggregable", [agg], "imageOf", [outputSet]);
      agrees("Aggregable", [agg], "preimageOf", [outputSet]);
    }
  });

  it("Lens: view / put through the references", () => {
    const whole = { firstName: "Ada", lastName: "Lovelace" };
    agrees("Lens", ["Record", "Record", "String"], "view", [whole]);
    expect(agrees("Lens", ["Record", "Record", "String"], "put", [whole, "Augusta"])).toEqual({
      firstName: "Augusta",
      lastName: "Lovelace",
    });
  });

  it("Compilable + Encodable: compile then encode a JS module through the references", () => {
    const source = {
      name: "inc",
      params: positionalCompileFieldSlots(["x"]),
      body: { call: ["add", { var: "x" }, 1] },
      requires: [],
    };
    const compiled = agrees("Compilable", ["JsModule"], "compile", [source]) as { $tag: string; _0: unknown };
    expect(compiled.$tag).toBe("Ok");
    const encoded = agrees("Encodable", ["String", "JsModule"], "encode", [compiled._0]) as { $tag: string; _0: unknown };
    expect(encoded.$tag).toBe("Ok");
    expect(typeof encoded._0).toBe("string");
  });

  it("Evaluator: each strategy instance, used as a block frame, evaluates as its id string did", () => {
    for (const strategy of ["EagerStrategy", "LazyStrategy", "PartialStrategy", "JitStrategy"]) {
      const methods = liveInstance("Evaluator", [strategy]).methods;
      // A closed body: the partial and JIT strategies read known inputs from
      // `ctx._known`, not from the data, so a free variable would stay residual
      // (partial) or be unbound at exec (JIT) — the same either way, but not 7.
      const body = { call: ["add", { call: ["mul", 2, 3] }, 1] };
      const frame = (m: unknown) => ({ typeName: "Evaluator", args: [strategy], methods: m });
      const viaRef = run({ withInstance: [frame(methods), body] });
      const viaId = run({ withInstance: [frame({ eval: headIdOf("Evaluator", [strategy], "eval") }), body] });
      expect(viaRef, strategy).toEqual(viaId);
      expect(viaRef, strategy).toEqual({ ok: 7 });
    }
  });

  it("Reprable: every lower / lift pair through the references equals the id strings, and round-trips", () => {
    const natives: Array<[string, unknown]> = [
      ["Nat", 5], ["Int", -3], ["Rational", 4], ["Real", 2], ["Number", 7],
      ["List", [1, 2]], ["String", "hey"], ["Char", "A"],
    ];
    for (const target of ["JsRuntime", "Jsonb"]) {
      for (const [type, native] of natives) {
        const pure = agrees("Reprable", [target, type], "lower", [native]);
        expect(agrees("Reprable", [target, type], "lift", [pure]), `${target} ${type}`).toEqual(native);
      }
    }
  });

  it("Functor / Monad / Monoid / Foldable / Applicative: every method through the references", () => {
    expect(agrees("Functor", ["Maybe"], "fmap", [inc(), J(3)])).toEqual(J(4));
    expect(agrees("Functor", ["List"], "fmap", [inc(), [1, 2, 3]])).toEqual([2, 3, 4]);
    expect(agrees("Functor", ["Result"], "fmap", [inc(), OK(3)])).toEqual(OK(4));
    expect(agrees("Monad", ["Maybe"], "bind", [J(3), closure({ fn: ["x", { construct: ["Just", { var: "x" }] }] })])).toEqual(J(3));
    expect(agrees("Monad", ["List"], "bind", [[1, 2], closure({ fn: ["x", [{ var: "x" }, { var: "x" }]] })])).toEqual([1, 1, 2, 2]);
    expect(agrees("Monad", ["Result"], "bind", [OK(3), closure({ fn: ["x", { construct: ["Ok", { var: "x" }] }] })])).toEqual(OK(3));
    expect(agrees("Monoid", ["List"], "mappend", [[1, 2], [3]])).toEqual([1, 2, 3]);
    expect(agrees("Monoid", ["String"], "mappend", ["ab", "c"])).toBe("abc");
    expect(agrees("Foldable", ["Maybe"], "foldr", [plus(), 10, J(3)])).toBe(13);
    expect(agrees("Foldable", ["List"], "foldr", [plus(), 0, [1, 2, 3]])).toBe(6);
    expect(agrees("Foldable", ["Result"], "foldr", [plus(), 10, OK(3)])).toBe(13);
    expect(agrees("Applicative", ["Maybe"], "pure", [3])).toEqual(J(3));
    expect(agrees("Applicative", ["Maybe"], "ap", [J(inc()), J(3)])).toEqual(J(4));
    expect(agrees("Applicative", ["List"], "pure", [3])).toEqual([3]);
    expect(agrees("Applicative", ["List"], "ap", [[inc()], [1, 2]])).toEqual([2, 3]);
    expect(agrees("Applicative", ["Result"], "pure", [3])).toEqual(OK(3));
    expect(agrees("Applicative", ["Result"], "ap", [OK(inc()), OK(3)])).toEqual(OK(4));
  });

  it("Representable / Sequential / Containable: every method through the references", () => {
    expect(agrees("Representable", ["Vec"], "index", [VEC4, 1])).toBe(20);
    expect(agrees("Sequential", ["List"], "take", [2, [1, 2, 3, 4]])).toEqual([1, 2]);
    expect(agrees("Sequential", ["List"], "drop", [2, [1, 2, 3, 4]])).toEqual([3, 4]);
    agrees("Sequential", ["List"], "splitAt", [2, [1, 2, 3, 4]]);
    expect(agrees("Sequential", ["Vec"], "take", [2, VEC4])).toEqual({ $tag: "Vec", "0": 10, "1": 20 });
    expect(agrees("Containable", ["String"], "contains", ["hello", "ell"])).toBe(true);
    expect(agrees("Containable", ["List"], "contains", [[1, 2, 3], 2])).toBe(true);
  });

  it("bare-name dispatch reaches the converted instances (the resolver applies the references)", () => {
    // A literal call head: the bare code name the resolver routes to the class.
    const bare = (name: string, args: unknown[]) => {
      const data: Record<string, unknown> = {};
      args.forEach((a, i) => {
        data[`a${i}`] = a;
      });
      return run({ call: [name, ...args.map((_, i) => ({ var: `a${i}` }))] }, data);
    };
    expect(bare("take", [2, [1, 2, 3, 4]])).toEqual({ ok: [1, 2] });
    expect(bare("drop", [2, [1, 2, 3, 4]])).toEqual({ ok: [3, 4] });
    expect(bare("take", [2, VEC4])).toEqual({ ok: { $tag: "Vec", "0": 10, "1": 20 } });
    expect(bare("fmap", [inc(), J(3)])).toEqual({ ok: J(4) });
    expect(bare("fmap", [inc(), [1, 2]])).toEqual({ ok: [2, 3] });
    expect(bare("bind", [J(3), closure({ fn: ["x", { construct: ["Just", { var: "x" }] }] })])).toEqual({ ok: J(3) });
    expect(bare("mappend", [[1], [2]])).toEqual({ ok: [1, 2] });
    expect(bare("foldr", [plus(), 0, [1, 2, 3]])).toEqual({ ok: 6 });
    expect(bare("ap", [J(inc()), J(3)])).toEqual({ ok: J(4) });
    expect(bare("index", [VEC4, 2])).toEqual({ ok: 30 });
    expect(bare("contains", ["hello", "ell"])).toEqual({ ok: true });
    expect(bare("contains", [[1, 2, 3], 4])).toEqual({ ok: false });
    expect(run({ method: ["Sequential", "take", 1, { var: "xs" }] }, { xs: [7, 8] })).toEqual({ ok: [7] });
  });

  it("Traversable and the folding Vec cuts: the references equal the id strings (engine + derive-functor registry)", () => {
    const c = derived();
    const maybePure = { $ref: "algebra:maybePure" }; // declared `a -> Maybe a`: fixes the applicative
    expect(agrees("Traversable", ["Maybe"], "traverse", [maybePure, J(3)], c)).toEqual(J(J(3)));
    expect(agrees("Traversable", ["List"], "traverse", [maybePure, [1, 2]], c)).toEqual(J([1, 2]));
    expect(agrees("Traversable", ["Result"], "traverse", [maybePure, OK(3)], c)).toEqual(J(OK(3)));
    expect(run({ call: ["traverse", { var: "f" }, { var: "xs" }] }, { f: maybePure, xs: [1, 2] }, c)).toEqual({ ok: J([1, 2]) });
    expect(agrees("Sequential", ["Vec"], "drop", [2, VEC4], c)).toEqual({ $tag: "Vec", "0": 30, "1": 40 });
    expect(agrees("Sequential", ["Vec"], "splitAt", [2, VEC4], c)).toEqual([
      { $tag: "Vec", "0": 10, "1": 20 },
      { $tag: "Vec", "0": 30, "1": 40 },
    ]);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// (G) Validation against the class record type (`instanceMethodsValueType` +
// `validate`, the instance editor's path), in the system registry.
//
// What must hold: (1) every instance gets the verdict its HEAD id strings get
// when put back in place of the references (the messages differ only in the
// handle's spelling); (2) the
// function-typed fields of the non-curried classes (Lens, Encodable,
// Evaluator, Reprable, Aggregable, Compilable) are admitted — the value is a
// function of the declared arity. The arrows of Encodable (`JsModule` and its
// siblings), Aggregable (`SetExpr`) and Compilable (`CompileSource`) mention
// types keyed by `FieldKey`, so they elaborate only with FieldKey published in
// the system registry (the FieldKey publication batch); without it these read
// "field semantic slot: invalid named field" under the field. The assertions
// are kept either way.
//
// Known gaps, pinned so a change to them is seen, none caused by the
// conversion and none fixed here:
//   (a) the `Verified Boolean` law fields are required by `validate` although
//       instances omit them (they are erasable obligations, not methods);
//   (b) `FenelType` (Aggregable's input/output types, Reprable's `native`) and
//       `Monotonicity` name no declared Fenel type, so they are "Unknown";
//   (c) the loader's `{fn: [...]}` lambda (Bool's Reprable lift / lower) is not
//       recognised as a callable value;
//   (d) the curried declarations (Functor, Monad, Monoid, Foldable,
//       Applicative.ap, Representable, Sequential, Containable) are refused:
//       the validator counts an arrow's written arity, the loader flattens a
//       function's parameters (`validate.fenel` ~907-912, ~1586; the paramCount
//       refuter in `containment.fenel` ~1626-1635 — the type-substrate
//       arrow-recovery slice owns it). The HEAD strings were refused the same
//       way; `Monad.return`, `Representable.tabulate`, a `""` `mempty` and the
//       Sequential law fields also read "required";
//   (e) Traversable: the system registry has no `engine` container, so
//       `engine.deriveTraverse` names no function there and is admitted
//       unchecked, exactly as the id string was.
// ---------------------------------------------------------------------------

type Verdict = { valid: boolean; errors: Array<{ path: string; message: string }> };

describe("Phase 2b (G) — the instances validate against their class record types", () => {
  const registry = getSystemRegistry();
  const verdict = (cls: string, args: string[], methods: Record<string, unknown>): Verdict => {
    const result = validate(instanceMethodsValueType(cls, args, registry), methods, null, { registry }) as Verdict;
    return { valid: result.valid, errors: result.errors };
  };
  /** The instance's methods with each converted value put back to HEAD's id string. */
  const headMethods = (cls: string, args: string[], methods: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(methods).map(([field, value]) => {
        const row = HEAD_METHOD_IDS.find(([c, a, f]) => c === cls && sameArgs(a, args) && f === field);
        return [field, row ? row[3] : value];
      }),
    );
  /** Error paths, and messages with every converted handle spelled as its id. */
  const normalized = (cls: string, args: string[], methods: Record<string, unknown>, v: Verdict) => {
    let errors = JSON.stringify(v.errors);
    for (const [field, value] of Object.entries(methods)) {
      const handle = functionRefHandle(value);
      const row = HEAD_METHOD_IDS.find(([c, a, f]) => c === cls && sameArgs(a, args) && f === field);
      if (handle !== undefined && row) errors = errors.split(`\\"${handle}\\"`).join(`\\"${row[3]}\\"`);
    }
    return { valid: v.valid, errors: JSON.parse(errors) as unknown };
  };
  const corpus = () =>
    CLASSES.flatMap((cls) =>
      corpusInstances(cls).map((inst) => ({
        cls,
        args: inst.args as string[],
        methods: inst.methods as Record<string, unknown>,
      })),
    );

  it("(1) every instance gets the verdict its HEAD id strings get in the same place", () => {
    const changed: unknown[] = [];
    for (const { cls, args, methods } of corpus()) {
      const withRefs = normalized(cls, args, methods, verdict(cls, args, methods));
      const withStrings = normalized(cls, args, methods, verdict(cls, args, headMethods(cls, args, methods)));
      if (JSON.stringify(withRefs) !== JSON.stringify(withStrings)) changed.push({ cls, args, withRefs, withStrings });
    }
    expect(changed).toEqual([]);
  });

  /** The function-typed fields of the non-curried classes. Bool's Reprable
   *  lambdas are not converted values (gap (c)). */
  const FUNCTION_FIELDS: Record<string, string[]> = {
    Lens: ["view", "put"],
    Encodable: ["encode"],
    Evaluator: ["eval"],
    Reprable: ["lift", "lower"],
    Aggregable: ["imageOf", "preimageOf"],
    Compilable: ["compile"],
  };

  for (const [cls, fields] of Object.entries(FUNCTION_FIELDS)) {
    it(`(2) ${cls}: the references at ${fields.join(", ")} are admitted as values of the declared arrows`, () => {
      const refused: unknown[] = [];
      for (const inst of corpusInstances(cls)) {
        if (cls === "Reprable" && inst.args[1] === "Boolean") continue;
        const v = verdict(cls, inst.args as string[], inst.methods as Record<string, unknown>);
        // An error at the field or anywhere inside its type (`imageOf._0.fields.key`
        // when an argument type cannot elaborate) refuses the reference.
        for (const e of v.errors) {
          if (fields.some((f) => e.path === f || e.path.startsWith(`${f}.`))) refused.push({ args: inst.args, ...e });
        }
      }
      expect(refused).toEqual([]);
    });
  }

  it("(2) Encodable is valid outright (it has no law field)", () => {
    for (const inst of corpusInstances("Encodable")) {
      expect(verdict("Encodable", inst.args as string[], inst.methods as Record<string, unknown>)).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("(2) a wrong arity and a non-callable are refused at a converted field", () => {
    const type = instanceMethodsValueType("Aggregable", ["length"], registry);
    const good = liveInstance("Aggregable", ["length"]).methods as Record<string, unknown>;
    expect(validate(type, { ...good, imageOf: { $ref: "std:add" } }, null, { registry }).errors).toContainEqual({
      path: "imageOf",
      message: 'Function "std:add" has 2 param(s) but expected 1',
    });
    expect(validate(type, { ...good, imageOf: 42 }, null, { registry }).errors.map((e) => e.path)).toContain("imageOf");
  });

  /** The remaining error paths of every instance: gaps (a)–(e), pinned. */
  const LAW = (cls: string) => {
    const fields = (recordOf(cls) as { $record?: { fields: Array<{ name: string; type: FenelType }> } }).$record?.fields;
    return (fields ?? [])
      .filter((f) => JSON.stringify(f.type).includes('"Verified"'))
      .map((f) => f.name);
  };

  it("known gaps (a)–(c): the non-curried classes' other errors are the law fields and the undeclared types", () => {
    const expectedPaths = (cls: string, args: string[]): string[] => {
      const law = LAW(cls);
      switch (cls) {
        case "Aggregable": return ["inputType", "outputType", "monotonicity", ...law];
        case "Reprable": return args[1] === "Boolean" ? ["native", "lift", "lower", ...law] : ["native", ...law];
        default: return law;
      }
    };
    const unexpected: unknown[] = [];
    for (const cls of Object.keys(FUNCTION_FIELDS)) {
      for (const inst of corpusInstances(cls)) {
        const args = inst.args as string[];
        const paths = verdict(cls, args, inst.methods as Record<string, unknown>).errors.map((e) => e.path);
        if (JSON.stringify(paths) !== JSON.stringify(expectedPaths(cls, args))) {
          unexpected.push({ cls, args, paths, expected: expectedPaths(cls, args) });
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("known gap (d): the curried declarations refuse the references exactly as they refused the id strings", () => {
    const arityRefusals: string[] = [];
    for (const cls of ["Functor", "Monad", "Monoid", "Foldable", "Applicative", "Representable", "Sequential", "Containable"]) {
      for (const inst of corpusInstances(cls)) {
        const args = inst.args as string[];
        const v = verdict(cls, args, inst.methods as Record<string, unknown>);
        expect(v.valid, `${cls} ${args.join(" ")}`).toBe(false);
        for (const e of v.errors) {
          if (e.message.includes("param(s) but expected")) arityRefusals.push(`${cls} ${args.join(" ")} .${e.path}: ${e.message}`);
        }
      }
    }
    expect(arityRefusals.sort()).toEqual([
      'Applicative List .ap: Function "algebra.listAp" has 2 param(s) but expected 1',
      'Applicative Maybe .ap: Function "algebra.maybeAp" has 2 param(s) but expected 1',
      'Applicative Result .ap: Function "algebra.resultAp" has 2 param(s) but expected 1',
      'Containable List .contains: Function "std.includes" has 2 param(s) but expected 1',
      'Containable String .contains: Function "std.contains" has 2 param(s) but expected 1',
      'Foldable List .foldr: Function "algebra.listFoldr" has 3 param(s) but expected 1',
      'Foldable Maybe .foldr: Function "algebra.maybeFoldr" has 3 param(s) but expected 1',
      'Foldable Result .foldr: Function "algebra.resultFoldr" has 3 param(s) but expected 1',
      'Functor List .fmap: Function "std.map" has 2 param(s) but expected 1',
      'Functor Maybe .fmap: Function "algebra.maybeFmap" has 2 param(s) but expected 1',
      'Functor Result .fmap: Function "algebra.resultFmap" has 2 param(s) but expected 1',
      'Monad List .bind: Function "algebra.listBind" has 2 param(s) but expected 1',
      'Monad Maybe .bind: Function "algebra.maybeBind" has 2 param(s) but expected 1',
      'Monad Result .bind: Function "algebra.resultBind" has 2 param(s) but expected 1',
      'Monoid List .mappend: Function "std.concat" has 2 param(s) but expected 1',
      'Monoid String .mappend: Function "std.concat" has 2 param(s) but expected 1',
      'Representable Vec .index: Function "algebra.vecIndex" has 2 param(s) but expected 1',
      'Sequential List .drop: Function "std.drop" has 2 param(s) but expected 1',
      'Sequential List .splitAt: Function "algebra.splitAt" has 2 param(s) but expected 1',
      'Sequential List .take: Function "std.take" has 2 param(s) but expected 1',
      'Sequential Vec .drop: Function "algebra.drop" has 2 param(s) but expected 1',
      'Sequential Vec .splitAt: Function "algebra.splitAt" has 2 param(s) but expected 1',
      'Sequential Vec .take: Function "algebra.take" has 2 param(s) but expected 1',
    ]);
  });

  it("known gap (e): Traversable's reference names no function in the system registry and is admitted unchecked", () => {
    for (const t of ["Maybe", "List", "Result"]) {
      const methods = liveInstance("Traversable", [t]).methods as Record<string, unknown>;
      expect(verdict("Traversable", [t], methods)).toEqual({ valid: true, errors: [] });
      expect(verdict("Traversable", [t], headMethods("Traversable", [t], methods))).toEqual({ valid: true, errors: [] });
    }
  });
});

// ---------------------------------------------------------------------------
// (H) `engine:deriveTraverse`'s declared result is `Any`, never a free type
// variable. The native returns the traversed value inside the applicative, or
// its input unchanged when it cannot resolve the applicative, so a free result
// variable (`… -> d`) let a caller pick any type: a gpt-6-astra review probe
// inferred `consumeString (engine.deriveTraverse (\x -> x) 7)` as `String`
// while it evaluated to the number 7. The declaration is read from the source
// file, so a regression to a free variable reddens here.
// ---------------------------------------------------------------------------

describe("Phase 2b (H) — deriveTraverse's declared result cannot be chosen by the caller", () => {
  it("a String consumer of its result is refused by inference; execution is unchanged", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "fenel", "modules", "engine", "derive-traversable.fenel"),
      "utf8",
    );
    const declaration = source.match(/@native[\s\S]*?deriveTraverse : [^\r\n]+/)?.[0];
    expect(declaration).toBeDefined();
    expect(declaration!.trimEnd().endsWith("-> Any")).toBe(true);
    const probe = loadFenelModule(
      `module engine where\n${declaration}\nconsumeString : (x: String) -> String\nconsumeString x = x\n`,
      "engine",
      { bootstrapParser: "typescript" },
    );
    const registry = createRegistry([probe, deriveFunctorModule], { publishCatalogEntities: false });
    const resolveFunction = (id: string) => {
      const fn = registry.getFunction(id);
      if (!fn) return undefined;
      return {
        params: fn.params,
        returns: fn.returns,
        scheme: registry.getFunctionScheme(fn.id),
        targetId: fn.id,
        signatureOutcome: registry.getFunctionSignatureInfo(fn.id)?.outcome,
      };
    };
    const inner = { call: ["engine.deriveTraverse", { fn: [["x"], { var: "x" }] }, 7] };
    const consumer = { call: ["engine.consumeString", inner] };
    const innerType = inferJsonLogicType(inner, { resolveFunction } as never) as { outcome: { $tag: string }; type?: unknown };
    expect(innerType.outcome.$tag).toBe("Solved");
    expect(innerType.type).toEqual({ $ref: "Any" });
    const consumerType = inferJsonLogicType(consumer, { resolveFunction } as never) as { outcome: { $tag: string } };
    expect(consumerType.outcome.$tag).toBe("Invalid");
    expect(evaluate(inner, {}, registry.evaluateContext())).toBe(7);
  }, 300_000);
});
