// modules-as-values Phase 2d — the two typed paths the corpus cannot reach,
// over a CONTROLLED registry.
//
// `modules-as-values-phase-2d-typed-dispatch.test.ts` proves the typed path on
// the corpus's own classes (Iso, Decodable, Migration). No corpus class has a
// method whose ARGUMENTS fix every class parameter, and no corpus case checks
// an unreflectable argument against a parameter solved from the WRITTEN type
// alone. This suite declares two two-parameter classes in a small test module
// and registers them exactly as boot registers a `.fenel` class
// (`registerClassEntityInto`: `seedFromType` with every header parameter, and
// the parser-owned scheme sidecar with its source module):
//
//   Both s a = Both both: s -> a -> String      (Both String Number, Both String Boolean)
//   Echo s a = Echo echo: a -> Result s a       (Echo String EchoPoint)
//
// It proves:
//   (0) seeds keep every class parameter (brief Stage 1): the system routing
//       table is unchanged, every system class keeps its parameters, and a
//       two-parameter class gets a two-parameter seed at return position;
//   (a) an UNANNOTATED `Both.both "x" 5` takes the typed path because its
//       arguments fix both parameters, selecting by the complete tuple; a tuple
//       with no instance is an error and never falls back;
//   (b) an argument the rule cannot reflect (an untagged record), whose
//       parameter is solved from the written type, is checked by strict
//       membership before the selected method runs.
//
// The registry is the whole repository corpus plus the test module, over a
// fresh dispatch registry holding every system class and instance plus the
// test classes and instances (the shared system dispatch registry is not
// mutated).
import { beforeAll, describe, expect, test } from "bun:test";

import { createDispatchRegistry, type DispatchRegistry } from "./dispatch-registry";
import { dispatchPositionForSeed, methodDispatchPosition, RETURN_POSITION } from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { ModuleRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { dispatchRegistry as systemDispatchRegistry, registerClassEntityInto } from "./system-entities";
import { getSystemRegistry } from "./system-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import type { FenelModule } from "./types";
import ROUTING_SNAPSHOT from "./modules-as-values-phase-2d.routing-snapshot.json";

const LONG = 600_000;
const MODULE = "mav2dt";

// Account-authored parameters must be positional (`_n`) or carry a UUID key.
function positionalParams(mod: FenelModule): FenelModule {
  return {
    ...mod,
    functions: (mod.functions ?? []).map((fn) => ({
      ...fn,
      params: fn.params.map((param, index) => ({
        ...param,
        key: { $tag: "PositionalField", index } as const,
      })),
    })),
  };
}

// Account-authored named fields must carry an explicit UUID key. Each named
// field of the test module's types gets a fixed UUID (both in the declared
// type and in its parser-owned scheme body).
const FIELD_UUIDS: Record<string, string> = {
  both: "6d2a1c3e-0b1f-4c1a-9e2d-000000000001",
  echo: "6d2a1c3e-0b1f-4c1a-9e2d-000000000002",
  x: "6d2a1c3e-0b1f-4c1a-9e2d-000000000003",
  y: "6d2a1c3e-0b1f-4c1a-9e2d-000000000004",
};
function uuidKeyed<T>(value: T): T {
  if (Array.isArray(value)) return value.map(uuidKeyed) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === "fields" && Array.isArray(child)
      ? child.map((field: Record<string, unknown>) => {
        const uuid = FIELD_UUIDS[field.name as string];
        const keyed = uuidKeyed(field);
        return field.key === undefined && uuid !== undefined
          ? { ...keyed, key: { $tag: "NamedField", ref: { $ref: uuid } } }
          : keyed;
      })
      : uuidKeyed(child);
  }
  return out as T;
}
function uuidKeyedEntities(mod: FenelModule): FenelModule {
  return {
    ...mod,
    entities: (mod.entities ?? []).map((entity) => ({
      ...entity,
      type: uuidKeyed(entity.type),
      ...(entity.typeScheme === undefined ? {} : { typeScheme: uuidKeyed(entity.typeScheme) }),
    })),
  };
}

const SOURCE = String.raw`module mav2dt where
Both s a = Both both: s -> a -> String
Echo s a = Echo echo: a -> Result s a
EchoPoint = EchoPoint x: Number y: Number
bothNumber : String -> Number -> String
bothNumber _0 _1 = "number"
bothBoolean : String -> Boolean -> String
bothBoolean _0 _1 = "boolean"
echoPoint : EchoPoint -> Result String EchoPoint
echoPoint _0 = Ok _0
`;

let testModule: FenelModule;
let dispatch: DispatchRegistry;
let registry: ModuleRegistry;
let ctx: EvaluateContext;

beforeAll(() => {
  testModule = uuidKeyedEntities(positionalParams(loadFenelModule(SOURCE, MODULE, { bootstrapParser: "typescript" })));
  dispatch = createDispatchRegistry();
  for (const cls of systemDispatchRegistry.listClasses()) dispatch.defineClass(cls);
  for (const inst of systemDispatchRegistry.listInstances()) dispatch.addInstance(inst);
  registerClassEntityInto(dispatch, testModule, "Both");
  registerClassEntityInto(dispatch, testModule, "Echo");
  dispatch.addInstance({ typeName: "Both", args: ["String", "Number"], methods: { both: { $ref: `${MODULE}.bothNumber` } } });
  dispatch.addInstance({ typeName: "Both", args: ["String", "Boolean"], methods: { both: { $ref: `${MODULE}.bothBoolean` } } });
  dispatch.addInstance({ typeName: "Echo", args: ["String", "EchoPoint"], methods: { echo: { $ref: `${MODULE}.echoPoint` } } });
  registry = createAccountRegistry(SYSTEM_REGISTRY_MODULES, [testModule], { dispatchRegistry: dispatch });
  ctx = registry.evaluateContext();
}, LONG);

/** Evaluate as a body of the test module evaluates (the source-function
 *  coordinate the written types resolve at). */
const IN_MODULE = `${MODULE}:echoPoint`;
const at = (base: EvaluateContext): EvaluateContext => ({ ...base, _sourceFunction: IN_MODULE });
const run = (source: string, data: Record<string, unknown> = {}, context: EvaluateContext = at(ctx)) =>
  evaluate(parse(source), data, context);

/** A context in which the test module's three implementing functions are
 *  replaced by recording natives (a native shadows a Fenel body of the same
 *  id), each answering what its Fenel body answers. */
function spying(): { context: EvaluateContext; calls: string[] } {
  const calls: string[] = [];
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    [`${MODULE}:bothNumber`]: () => "number",
    [`${MODULE}:bothBoolean`]: () => "boolean",
    [`${MODULE}:echoPoint`]: (p) => ({ $tag: "Ok", _0: p }),
  };
  const natives = Object.assign(Object.create(null), ctx.natives) as Record<string, (...args: unknown[]) => unknown>;
  for (const [id, answer] of Object.entries(answers)) {
    natives[id] = (...args: unknown[]) => {
      calls.push(id);
      return answer(...args);
    };
  }
  return { context: at({ ...ctx, natives }), calls };
}

describe("(0) seeds keep every class parameter", () => {
  test("the system routing table equals the pre-change snapshot", () => {
    const table = getSystemRegistry().routingTable() as unknown as {
      routes: unknown;
      posIdx: unknown;
      generalIdx: unknown;
    };
    const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
    expect(plain(table.routes)).toEqual(ROUTING_SNAPSHOT.routes);
    expect(plain(table.posIdx)).toEqual(ROUTING_SNAPSHOT.posIdx);
    expect(plain(table.generalIdx)).toEqual(ROUTING_SNAPSHOT.generalIdx);
  }, LONG);

  test("every system class keeps its parameters: only the hand-written multi-parameter seeds have more than one, and Reprable keeps [a]", () => {
    getSystemRegistry();
    const multi: Record<string, string[]> = {};
    const classes = systemDispatchRegistry.listClasses();
    expect(classes.length).toBeGreaterThan(100);
    for (const cls of classes) {
      const params = (cls.params ?? []).map((p) => p.name);
      expect(params.length, cls.name).toBeGreaterThan(0);
      if (params.length > 1) multi[cls.name] = params;
    }
    expect(multi).toEqual({
      Decodable: ["s", "a"],
      Encodable: ["s", "a"],
      Iso: ["s", "a"],
      Lens: ["ctx", "s", "a"],
      Migration: ["v1", "v2"],
    });
    // `Reprable target a` routes on `a` (DISPATCH_PARAM_OVERRIDE) until Stage 3.
    expect((systemDispatchRegistry.getClass("Reprable")?.params ?? []).map((p) => p.name)).toEqual(["a"]);
  }, LONG);

  test("a two-parameter .fenel class registered through the boot path gets a two-parameter seed at return position", () => {
    for (const name of ["Both", "Echo"]) {
      const seed = dispatch.getClass(name)!;
      expect((seed.params ?? []).map((p) => p.name), name).toEqual(["s", "a"]);
      expect(seed.methods.length, name).toBe(1);
      for (const m of seed.methods) {
        expect(dispatchPositionForSeed(seed, m.name), `${name}.${m.name}`).toBe(RETURN_POSITION);
        expect(methodDispatchPosition(dispatch, name, m.name), `${name}.${m.name}`).toBe(RETURN_POSITION);
      }
    }
    // The shared system registry is untouched.
    expect(systemDispatchRegistry.getClass("Both")).toBeUndefined();
    // The parser-owned scheme sidecar makes the qualified method Solved, with
    // the class parameters quantified in header order.
    for (const name of ["Both.both", "Echo.echo"]) {
      const scheme = registry.callSiteTyping.methodScheme(name);
      expect(scheme.ok, name).toBe(true);
      if (scheme.ok) expect(scheme.classParameters).toEqual(["s", "a"]);
    }
  }, LONG);
});

describe("(a) the arguments fix every parameter: an unannotated call is typed", () => {
  test("Both.both \"x\" 5 selects Both String Number; Both.both \"x\" true selects Both String Boolean", () => {
    const { context, calls } = spying();
    expect(run(`Both.both "x" 5`, {}, context)).toBe("number");
    expect(run(`Both.both "x" true`, {}, context)).toBe("boolean");
    expect(calls).toEqual([`${MODULE}:bothNumber`, `${MODULE}:bothBoolean`]);
    // The Fenel bodies answer the same.
    expect(run(`Both.both "x" 5`)).toBe("number");
    expect(run(`Both.both "x" true`)).toBe("boolean");
  }, LONG);

  test("the call is on the typed path: without call-site typing it fails closed", () => {
    const { _callSiteTyping: _dropped, ...bare } = at(ctx);
    expect(() => evaluate(parse(`Both.both "x" 5`), {}, bare as EvaluateContext))
      .toThrow(/^Both\.both: this method is selected by its complete type, and this evaluation context has no call-site typing$/);
  }, LONG);

  test("a tuple with no instance is an error and never falls back to a first-argument match", () => {
    const { context, calls } = spying();
    // `Both String String` shares its first argument with both instances: a
    // first-argument matcher would have run one of them.
    expect(() => run(`Both.both "x" "y"`, {}, context))
      .toThrow(/^no Both String String instance in scope \(Both\.both\)$/);
    expect(() => run(`Both.both 5 5`, {}, context))
      .toThrow(/^no Both Number Number instance in scope \(Both\.both\)$/);
    expect(calls).toEqual([]);
  }, LONG);
});

describe("(b) an unreflectable argument is fixed by the written type and checked by strict membership", () => {
  test("an untagged record in EchoPoint proceeds and returns Ok p", () => {
    const p = { x: 1, y: 2 };
    expect(run(`(Echo.echo p : Result String EchoPoint)`, { p })).toEqual({ $tag: "Ok", _0: p });
    const { context, calls } = spying();
    expect(run(`(Echo.echo p : Result String EchoPoint)`, { p }, context)).toEqual({ $tag: "Ok", _0: p });
    expect(calls).toEqual([`${MODULE}:echoPoint`]);
  }, LONG);

  test("unannotated, the untagged record fixes nothing: the parameters are named, nothing runs", () => {
    const { context, calls } = spying();
    expect(() => run(`Echo.echo p`, { p: { x: 1, y: 2 } }, context))
      .toThrow(/^Echo\.echo: the class parameters s and a are not fixed by the arguments; write the type, or select the instance/);
    expect(calls).toEqual([]);
  }, LONG);

  test("a record not in EchoPoint is refused, naming the argument, and the selected method never runs", () => {
    const { context, calls } = spying();
    for (const p of [{ x: "no", y: 2 }, { x: 1 }]) {
      expect(() => run(`(Echo.echo p : Result String EchoPoint)`, { p }, context))
        .toThrow(/^Echo\.echo: argument 1 is not shown to be a value of its parameter type in Echo String EchoPoint \(strict membership answered no\)$/);
    }
    expect(calls).toEqual([]);
  }, LONG);
});
