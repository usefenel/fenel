// modules-as-values Phase 2d, final review round 3 (slice R3-B) — installed
// source modules: class parameters, and the annotation coordinate of
// instance-owned code.
//
// Everything here goes through the installed path (`prepareSourceModule` →
// `sourceModuleRegistry`, whose dispatch frame is `sourceModuleDispatchRegistry`
// + `bindSourceMethods`, the same pair the runtime's execution registry uses).
//
// (P1) A source class keeps EVERY declared parameter: `Both s a` registers a
//      two-parameter seed, so its methods sit at the return position (the
//      multi-parameter fence) and two instances sharing their first argument
//      (`Both String Number`, `Both String String`) are selected by their
//      complete type, never met on the legacy first-argument route.
// (P2) Code an instance owns — its method lambdas, its class's method defaults,
//      a callable nested in a `Maybe (arrow)` payload — resolves a written type
//      in its DECLARING module: a local type name, an import alias, and a
//      module that holds only instances. The same closure invoked from another
//      module (whose own coordinate cannot see those names) still resolves in
//      its own; the caller's coordinate is never inherited.
import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import algebraSource from "../../../../fenel/std/algebra.fenel?raw";
import { prepareSourceModule, sourceModuleRegistry } from "./authoring/source-module";
import type { DispatchRegistry } from "./dispatch-registry";
import { methodDispatchPosition, RETURN_POSITION } from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate, moduleSourceCoordinate, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { dispatchRegistry as repositoryDispatch } from "./system-entities";
import type { FenelFunction, Instance } from "./types";

const LONG = 600_000;

// The classes. `Both` has two parameters and two instances that share their
// first argument; `Make` is a return-position class the lambdas below call
// with a written result type.
const CORE = String.raw`module R3bCore where

Make a = Make make: Number -> a
Use a = Use use: a -> Number
Opt a = Opt runOpt: Maybe (a -> Number)
Both s a = Both pick: s -> a

bothNumber : Both String Number
bothNumber = Both { pick = \s -> 1 }

bothText : Both String String
bothText = Both { pick = \s -> "one" }
`;

// A type reached only through an import alias (`S.R3bShape` in R3bA).
// Constructors are applied in named functions: an instance method's lambda
// body is projected with a constructor application as a self-evaluating
// `{$tag, field: {var}}` literal (its fields are never evaluated), which is
// the loader's concern, not this file's.
const SHAPES = String.raw`module R3bShapes where
import R3bCore (Make)

R3bShape = R3bShape side: Number

mkShape : Number -> R3bShape
mkShape n = R3bShape { side = n }

sideOf : R3bShape -> Number
sideOf s = s.side

makeShape : Make R3bShape
makeShape = Make { make = mkShape }
`;

// Instance-owned code written against a LOCAL type (R3bLocal), an import ALIAS
// (S.R3bShape), a class method DEFAULT, and a callable nested in a Just payload.
const A = String.raw`module R3bA where
import R3bCore (Make, Use, Opt)
import R3bShapes as S

R3bLocal = R3bLocal n: Number

Dflt a = Dflt run: (a -> Number) = (\x -> nOf (Make.make 2 : R3bLocal))

mkLocal : Number -> R3bLocal
mkLocal n = R3bLocal { n = n }

nOf : R3bLocal -> Number
nOf t = t.n

makeLocal : Make R3bLocal
makeLocal = Make { make = mkLocal }

useNumber : Use Number
useNumber = Use { use = \s -> nOf (Make.make s : R3bLocal) }

useString : Use String
useString = Use { use = \s -> S.sideOf (Make.make 7 : S.R3bShape) }

optNumber : Opt Number
optNumber = Opt { runOpt = Just { _0 = (\s -> nOf (Make.make s : R3bLocal)) } }
`;

// A module that holds ONLY instances (no type, no function of its own).
const ONLY = String.raw`module R3bOnly where
import R3bCore (Make, Use)
import R3bA (R3bLocal, nOf)

useBool : Use Boolean
useBool = Use { use = \b -> nOf (Make.make 3 : R3bLocal) }
`;

// The callers. None of their names can see R3bLocal or the alias S; each body
// carries an annotation, so each runs with its OWN source coordinate.
const CALLER = String.raw`module R3bCaller where
import R3bCore (Use)
import R3bA (Dflt)

dfltNumber : Dflt Number
dfltNumber = Dflt {}

callUse : Number -> Number
callUse x = Use.use (x : Number)

callUseString : String -> Number
callUseString x = Use.use (x : String)

callUseBool : Boolean -> Number
callUseBool x = Use.use (x : Boolean)

callDflt : Number -> Number
callDflt x = Dflt.run (x : Number)
`;

let registry: ModuleRegistry;
let ctx: EvaluateContext;
let spec: DispatchRegistry;

beforeAll(() => {
  registry = sourceModuleRegistry([CORE, SHAPES, A, ONLY, CALLER].map((source, index) =>
    prepareSourceModule(source, `r3b${index}`, undefined, randomUUID)));
  ctx = registry.evaluateContext();
  spec = ctx._specRegistry as DispatchRegistry;
}, LONG);

const run = (source: string, context: EvaluateContext = ctx) => evaluate(parse(source), {}, context);
const call = (fn: string, arg: unknown, context: EvaluateContext = ctx) =>
  evaluate({ call: [fn, arg] }, {}, context);
const apply = (f: unknown, x: unknown, context: EvaluateContext = ctx) =>
  evaluate({ call: [{ var: "f" }, { var: "x" }] }, { f, x }, context);
const row = (typeName: string, args: readonly string[]): Instance => {
  const rows = spec.listInstances(typeName).filter((inst) =>
    JSON.stringify(inst.args) === JSON.stringify(args));
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const method = (typeName: string, args: readonly string[], name: string): unknown =>
  (row(typeName, args).methods as Record<string, unknown>)[name];
/** A Fenel closure's captured source coordinate (own data slot). */
const coordinateOf = (closure: unknown): unknown =>
  (closure as { sourceFunction?: unknown }).sourceFunction;
/** Evaluate as the body of `functionId` evaluates. */
const at = (functionId: string): EvaluateContext => ({ ...ctx, _sourceFunction: functionId });

describe("(P1) an installed source class keeps every declared parameter", () => {
  test("Both s a registers a two-parameter seed; a one-parameter class keeps one", () => {
    expect(spec.getClass("Both")?.params?.map((param) => param.name)).toEqual(["s", "a"]);
    expect(spec.getClass("Make")?.params?.map((param) => param.name)).toEqual(["a"]);
  }, LONG);

  test("its methods sit at the return position (the multi-parameter fence)", () => {
    expect(methodDispatchPosition(spec, "Both", "pick")).toBe(RETURN_POSITION);
    // A single-parameter class keeps its argument route.
    expect(methodDispatchPosition(spec, "Use", "use")).toBe(0);
  }, LONG);

  test("two instances sharing their first argument are each selected by the complete type", () => {
    expect(row("Both", ["String", "Number"])).toBeDefined();
    expect(row("Both", ["String", "String"])).toBeDefined();
    expect(run(`(Both.pick "x" : Number)`)).toBe(1);
    expect(run(`(Both.pick "x" : String)`)).toBe("one");
  }, LONG);

  test("an unannotated call the arguments cannot fix names the unfixed parameter", () => {
    expect(() => run(`Both.pick "x"`)).toThrow(/Both\.pick: the class parameter a is not fixed/);
  }, LONG);

  test("audit: every algebra class seed carries all its declared parameters", () => {
    // Guard for the generic algebra registration (system-entities): today every
    // algebra class has one parameter, so this pins the rule for the next one.
    for (const entity of loadFenelModule(algebraSource, "std").entities ?? []) {
      expect(repositoryDispatch.getClass(entity.id)?.params?.map((param) => param.name))
        .toEqual(entity.params as string[]);
    }
  }, LONG);
});

describe("(P2) instance-owned code resolves written types in its declaring module", () => {
  test("a local type name (R3bLocal) in an instance method lambda", () => {
    expect(run(`Use.use 5`)).toBe(5);
  }, LONG);

  test("an import alias (S.R3bShape) in an instance method lambda", () => {
    expect(run(`Use.use "s"`)).toBe(7);
  }, LONG);

  test("a module that contains only instances", () => {
    expect(run(`Use.use True`)).toBe(3);
  }, LONG);

  test("a class method default resolves in the CLASS's module, for an instance declared elsewhere", () => {
    // dfltNumber (R3bCaller, which cannot see R3bLocal) omits `run`; the default
    // is R3bA's code.
    expect(call("R3bCaller:callDflt", 9)).toBe(2);
  }, LONG);

  test("a callable nested in a Maybe (arrow) payload", () => {
    const runOpt = method("Opt", ["Number"], "runOpt") as { $tag: string; _0: unknown };
    expect(runOpt.$tag).toBe("Just");
    expect(apply(runOpt._0, 4)).toBe(4);
  }, LONG);

  test("negative: the caller's module cannot see the names; the closure still resolves in its own", () => {
    // At the caller's coordinate the spelling denotes nothing.
    expect(() => run(`(Make.make 5 : R3bLocal)`, at("R3bCaller:callUse")))
      .toThrow(/the type R3bLocal is not visible here/);
    expect(() => run(`(Make.make 5 : S.R3bShape)`, at("R3bCaller:callUse")))
      .toThrow(/the type S\.R3bShape is not visible here/);
    // Invoked from R3bCaller's annotated bodies, each closure uses its own.
    expect(call("R3bCaller:callUse", 5)).toBe(5);
    expect(call("R3bCaller:callUseString", "q")).toBe(7);
    expect(call("R3bCaller:callUseBool", true)).toBe(3);
    // The same closure object, applied directly under the caller's coordinate.
    const useNumber = method("Use", ["Number"], "use");
    expect(apply(useNumber, 6, at("R3bCaller:callUse"))).toBe(6);
  }, LONG);

  test("the coordinate is captured at creation, names the declaring module, and absence clears", () => {
    const own = coordinateOf(method("Use", ["Number"], "use"));
    expect(own).toBe(moduleSourceCoordinate("R3bA"));
    expect(coordinateOf(method("Use", ["Boolean"], "use"))).toBe(moduleSourceCoordinate("R3bOnly"));
    expect(coordinateOf(spec.getClass("Dflt")?.methods.find((m) => m.name === "run")?.body))
      .toBe(moduleSourceCoordinate("R3bA"));
    // Never a registered function id.
    expect(registry.getFunction(own as string)).toBeUndefined();
    // A copy without the slot runs detached, never with the caller's coordinate.
    const { sourceFunction: _dropped, ...bare } = method("Use", ["Number"], "use") as Record<string, unknown>;
    expect(() => apply(bare, 5, at("R3bA:useNumber")))
      .toThrow(/the type R3bLocal is not visible without a source function/);
  }, LONG);

  test("the registry resolves a module owner in that module, and fails closed otherwise", () => {
    const resolve = (spelling: string, coordinate: string) =>
      registry.callSiteTyping.resolveType({ $ref: spelling }, coordinate);
    expect(resolve("R3bLocal", moduleSourceCoordinate("R3bA")).ok).toBe(true);
    expect(resolve("S.R3bShape", moduleSourceCoordinate("R3bA")).ok).toBe(true);
    expect(resolve("R3bLocal", moduleSourceCoordinate("R3bOnly")).ok).toBe(true);
    expect(resolve("R3bLocal", moduleSourceCoordinate("R3bCaller")).ok).toBe(false);
    const unknown = resolve("R3bLocal", moduleSourceCoordinate("NoSuchModule"));
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? "" : unknown.message).toMatch(/NoSuchModule/);
  }, LONG);

  test("a malformed or non-canonical module coordinate names no module, and nothing throws", () => {
    // The coordinate is never decoded (no exception to absorb): it is compared
    // with each registered module's canonical coordinate.
    const resolve = (coordinate: string) =>
      registry.callSiteTyping.resolveType({ $ref: "R3bLocal" }, coordinate);
    for (const coordinate of [
      "@module/", // empty name
      "@module/%", // a bad escape
      "@module/%E0%A4%A", // a truncated escape
      "@module/R3b%41", // decodes to R3bA, but is not its canonical spelling
      "@module/r3ba", // another name
    ]) {
      const result = resolve(coordinate);
      expect(result.ok).toBe(false);
    }
    // The canonical spelling of the same module resolves.
    expect(resolve("@module/R3bA").ok).toBe(true);
  }, LONG);

  test("a module coordinate that is a registered function id, or names two modules, fails closed", () => {
    const fn = (id: string): FenelFunction => ({
      id,
      params: [{ name: "value", type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }],
      returns: { $ref: "String" },
      body: { var: "value" },
    });
    const colliding = createRegistry([
      { name: "R3bColl", label: "R3bColl", entities: [], functions: [fn(moduleSourceCoordinate("R3bColl"))] },
    ]);
    const collision = colliding.callSiteTyping.resolveType({ $ref: "String" }, moduleSourceCoordinate("R3bColl"));
    expect(collision.ok).toBe(false);
    expect(collision.ok ? "" : collision.message).toMatch(/names no single declaring module/);

    const twice = createRegistry([
      { name: "R3bTwice", label: "R3bTwice one", entities: [], functions: [fn("R3bTwice:one")] },
      { name: "R3bTwice", label: "R3bTwice two", entities: [], functions: [fn("R3bTwice:two")] },
      { name: "R3bOnce", label: "R3bOnce", entities: [], functions: [fn("R3bOnce:one")] },
    ]);
    const ambiguous = twice.callSiteTyping.resolveType({ $ref: "String" }, moduleSourceCoordinate("R3bTwice"));
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.ok ? "" : ambiguous.reason).toBe("ambiguous");
    // A module registered once resolves in the same registry.
    expect(twice.callSiteTyping.resolveType({ $ref: "String" }, moduleSourceCoordinate("R3bOnce")).ok).toBe(true);
  }, LONG);
});
