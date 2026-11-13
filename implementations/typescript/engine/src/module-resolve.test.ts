// ---------------------------------------------------------------------------
// module-resolve.test.ts — module-substrate Phase 2b conformance.
//
// Phase 2a (`4ab6beb`) taught the parser `module … where` headers + the four
// Haskell `import` forms and had `loadFenelModule` CAPTURE them. Nothing
// resolved. This phase wires resolution per OQ4 (gradual; keep the coherent
// flat-global fallback):
//   1. Qualified  `Telegram.run_collector` → the member id `Telegram:run_collector`.
//   2. Unqualified → the block-scoped import frame (innermost `import` wins) …
//   3. … then the existing flat-global `getFunction` for a UNIQUE spelling.
//      Resolution-substrate Phase 1b later made a multi-binding spelling a
//      fail-closed ambiguity instead of preserving the old last-wins map result.
//
// The load-bearing trap: `Telegram.run_collector` and a qualified typeclass
// method (`Monad.bind`) parse to the SAME `{method:[…]}` shape (uppercase head
// + lowercase member). The discriminator is the HEAD — a registered Module head
// forks module resolution; a class head stays method dispatch. Block (ii)
// proves both resolve in ONE ctx without cross-contamination.
//
// Blocks mirror the brief's test plan (i)–(vii):
//   (i)   qualified `M.x` resolves to id `M:x` (eval + the getFunction branch).
//   (ii)  module `M.x` and class `Class.method` both resolve (no shadowing).
//   (iii) an `as` alias resolves a qualified name.
//   (iv)  a selective import makes an unqualified name resolve — even where
//         flat-global is AMBIGUOUS (and therefore fails closed).
//   (v)   `hiding` excludes a member from the unqualified frame.
//   (vi)  REGRESSION: a name that resolves today (flat-global, zero imports)
//         still resolves — the fallback is intact (load-bearing proof).
//   (vii) importing a non-existent module/member does NOT throw at resolution
//         time for unrelated names (no eager-validation regression).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { evaluate, withImports } from "./json-logic";
import { parse } from "./fenel-parser";
import { Nothing } from "./type-foundation";
import type { Interface, FieldDef, FenelType } from "./types";

// A `.fenel` module with a `module … where` header → ids `${header}:${member}`.
const telegramSrc = `module Telegram where
run_collector a = a
stop_collector a = a
`;

const TEST_MONOID_MAPPEND = "test:moduleResolveMonoidMappend";

// (i) — qualified module resolution -----------------------------------------

describe("(i) qualified M.x resolves to the member id M:x", () => {
  const mod = loadFenelModule(telegramSrc, "arg-fallback-ignored");
  const reg = createRegistry([mod]);
  const ctx = reg.evaluateContext();

  test("the header drives ids: member fn id is Telegram:run_collector", () => {
    expect(mod.name).toBe("Telegram");
    expect(mod.functions?.map((f) => f.id).sort()).toEqual([
      "Telegram:run_collector",
      "Telegram:stop_collector",
    ]);
  });

  test("getFunction('Telegram.run_collector') resolves the member by id (.→: rewrite)", () => {
    // `Telegram.run_collector` parses to {method:…}, but the getFunction dotted
    // branch also handles hand-written `{call:["Telegram.run_collector"]}` /
    // id-string positions.
    expect(reg.getFunction("Telegram.run_collector")?.id).toBe("Telegram:run_collector");
    expect(reg.evaluateContext().getFunction?.("Telegram.run_collector")?.id).toBe(
      "Telegram:run_collector",
    );
  });

  test("evaluating `Telegram.run_collector 7` invokes the module member (arg flows through)", () => {
    expect(parse("Telegram.run_collector 7")).toEqual({
      method: ["Telegram", "run_collector", 7],
    });
    expect(evaluate(parse("Telegram.run_collector 7"), {}, ctx)).toBe(7);
  });

  test("a bare `Telegram.run_collector` is a first-class typed reference", () => {
    // modules-as-values Phase 1: the same `{$ref}` shape every function value
    // has (it was the bare id string "Telegram:run_collector").
    expect(evaluate(parse("Telegram.run_collector"), {}, ctx)).toEqual({ $ref: "Telegram:run_collector" });
  });

  test("a Module head with a NON-member falls through to method dispatch (member-id gate)", () => {
    // `Telegram:ghost` is unregistered → not module-resolved → method dispatch,
    // which (no Telegram class) surfaces an unresolved-dispatch error rather
    // than silently mis-resolving as a module member.
    expect(() => evaluate(parse("Telegram.ghost 1"), {}, ctx)).toThrow();
  });
});

// (ii) — module vs class: both resolve, no cross-contamination ---------------

describe("(ii) module M.x and class Class.method both resolve in one ctx", () => {
  // Class half — a synthetic Monoid on a FRESH throwaway registry (the
  // phase-3.5 oracle pattern); the String instance carries a descriptor whose
  // pure test implementation lives in the evaluation context's native table.
  const fp = (name: string, type: FenelType): FieldDef => ({
    name,
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  });
  const monoidSeed: Interface = {
    name: "Monoid",
    params: [{ name: "a" }],
    methods: [
      { name: "mappend", params: [fp("_0", { $var: "a" }), fp("_1", { $var: "a" })], returns: { $var: "a" } },
    ],
  };
  const dispatchRegistry = createDispatchRegistry();
  dispatchRegistry.defineClass(monoidSeed);
  dispatchRegistry.addInstance({
    typeName: "Monoid",
    args: ["String"],
    methods: { mappend: TEST_MONOID_MAPPEND },
  });

  // Module half — `Telegram` lives in the SAME ctx (its dispatchRegistry IS the
  // fixture, so both layers coexist).
  const mod = loadFenelModule(telegramSrc, "x");
  const reg = createRegistry([mod], { dispatchRegistry });
  const baseCtx = reg.evaluateContext();
  const ctx = {
    ...baseCtx,
    // The synthetic class lives only in the fresh fixture registry.
    _routingTable: undefined,
    _routingTableVersion: undefined,
    natives: {
      ...(baseCtx.natives ?? {}),
      [TEST_MONOID_MAPPEND]: (...args: unknown[]) => `${String(args[0])}${String(args[1])}`,
    },
  };

  test("module head `Telegram.run_collector 5` → module member resolution", () => {
    expect(evaluate(parse("Telegram.run_collector 5"), {}, ctx)).toBe(5);
  });

  test("class head `Monoid.mappend \"a\" \"b\"` → typeclass-method dispatch (NOT swallowed)", () => {
    expect(parse('Monoid.mappend "a" "b"')).toEqual({ method: ["Monoid", "mappend", "a", "b"] });
    expect(evaluate(parse('Monoid.mappend "a" "b"'), {}, ctx)).toBe("ab");
  });

  test("module resolution keys on Module-membership, not the dotted shape", () => {
    // Both `Telegram.run_collector` and `Monoid.mappend` are {method:…} shapes.
    // Only the Module head rewrites to a real member fn id; the class head has
    // no `Monoid:*` member at all (its method lives in typeclass dispatch,
    // proven above) — so the fork keys on Module-membership, not the shape.
    expect(reg.getFunction("Telegram.run_collector")?.id).toBe("Telegram:run_collector");
    expect(reg.listModuleMembers("Telegram").sort()).toEqual([
      "run_collector",
      "stop_collector",
    ]);
    expect(reg.listModuleMembers("Monoid")).toEqual([]);
  });
});

// (iii) — `as` alias ---------------------------------------------------------

describe("(iii) `import Telegram as Tg` resolves qualified Tg.member", () => {
  const mod = loadFenelModule(telegramSrc, "x");
  const reg = createRegistry([mod]);
  const ctx = reg.evaluateContext();
  const frame = reg.buildImportFrame([{ module: "Telegram", as: "Tg" }]);

  test("the frame carries the alias Tg → Telegram, no unqualified bindings", () => {
    expect(frame).toEqual({ names: {}, aliases: { Tg: "Telegram" } });
  });

  test("`Tg.run_collector 9` resolves as `Telegram.run_collector` under the alias frame", () => {
    const out = withImports(ctx, frame, (c) => evaluate(parse("Tg.run_collector 9"), {}, c));
    expect(out).toBe(9);
  });

  test("without the alias frame, `Tg` is not a module → falls through (no module resolution)", () => {
    expect(() => evaluate(parse("Tg.run_collector 9"), {}, ctx)).toThrow();
  });
});

// (iv) / (v) / (vii) — unqualified import frame over ambiguous flat-global ----

// Two modules each export `helper` (colliding codeName → flat-global fails
// closed) plus a distinct member, so an import can be shown to resolve the
// ambiguity and `hiding` can be shown to exclude.
const fooSrc = `module Foo where
helper x = "foo"
other x = "foo-other"
`;
const barSrc = `module Bar where
helper x = "bar"
`;

describe("(iv) selective import resolves an unqualified name over ambiguous flat-global", () => {
  const reg = createRegistry([loadFenelModule(fooSrc, "x"), loadFenelModule(barSrc, "x")]);
  const ctx = reg.evaluateContext();

  test("flat-global `helper` fails closed instead of selecting by registration order", () => {
    expect(() => evaluate(parse("helper 0"), {}, ctx)).toThrow(
      'ambiguous bare name "helper" — 2 unrelated bindings (Foo:helper, Bar:helper); qualify with `Module.helper`',
    );
  });

  test("`import Foo (helper)` binds helper → Foo:helper, overriding the ambiguity", () => {
    const frame = reg.buildImportFrame([{ module: "Foo", names: ["helper"] }]);
    expect(frame).toEqual({ names: { helper: "Foo:helper" }, aliases: {} });
    const out = withImports(ctx, frame, (c) => evaluate(parse("helper 0"), {}, c));
    expect(out).toBe("foo");
  });

  test("innermost import wins (Bar frame nested inside Foo frame)", () => {
    const fooFrame = reg.buildImportFrame([{ module: "Foo", names: ["helper"] }]);
    const barFrame = reg.buildImportFrame([{ module: "Bar", names: ["helper"] }]);
    const out = withImports(ctx, fooFrame, (c1) =>
      withImports(c1, barFrame, (c2) => evaluate(parse("helper 0"), {}, c2)),
    );
    expect(out).toBe("bar");
  });
});

describe("(v) `hiding` excludes a member from the unqualified frame", () => {
  const reg = createRegistry([loadFenelModule(fooSrc, "x"), loadFenelModule(barSrc, "x")]);
  const ctx = reg.evaluateContext();

  test("`import Foo hiding (helper)` binds `other` but NOT `helper`", () => {
    const frame = reg.buildImportFrame([{ module: "Foo", hiding: ["helper"] }]);
    expect(frame.names).toEqual({ other: "Foo:other" });
    expect(frame.names.helper).toBeUndefined();
  });

  test("under the hiding frame, `helper` falls through to fail-closed ambiguity; unique `other` resolves", () => {
    const frame = reg.buildImportFrame([{ module: "Foo", hiding: ["helper"] }]);
    expect(() => withImports(ctx, frame, (c) => evaluate(parse("helper 0"), {}, c))).toThrow(
      'ambiguous bare name "helper" — 2 unrelated bindings (Foo:helper, Bar:helper); qualify with `Module.helper`',
    );
    expect(withImports(ctx, frame, (c) => evaluate(parse("other 0"), {}, c))).toBe("foo-other");
  });
});

// (vi) — REGRESSION: flat-global fallback intact with zero imports -----------

describe("(vi) a name that resolves today still resolves with zero imports (fallback intact)", () => {
  const reg = createRegistry([loadFenelModule(fooSrc, "x"), loadFenelModule(barSrc, "x")]);
  const ctx = reg.evaluateContext();

  test("a unique codeName resolves via flat-global with NO import frame in scope", () => {
    // `other` is unique to Foo (no collision) → flat-global codeName lookup.
    expect(ctx._importStack).toBeUndefined();
    expect(evaluate(parse("other 0"), {}, ctx)).toBe("foo-other");
  });

  test("by-id resolution is unchanged (the canonical path)", () => {
    expect(evaluate({ call: ["Foo:helper", 0] }, {}, ctx)).toBe("foo");
  });
});

// (vii) — no eager validation: importing a ghost doesn't break unrelated names

describe("(vii) importing a non-existent module/member does not throw at resolution time", () => {
  const reg = createRegistry([loadFenelModule(fooSrc, "x")]);
  const ctx = reg.evaluateContext();

  test("building a frame for a non-existent module/member does not throw", () => {
    expect(() => reg.buildImportFrame([{ module: "Ghost", names: ["nope"] }])).not.toThrow();
    expect(() => reg.buildImportFrame([{ module: "Ghost", hiding: ["nope"] }])).not.toThrow();
  });

  test("a ghost selective import binds the (unresolvable) name lazily, breaking nothing else", () => {
    const frame = reg.buildImportFrame([{ module: "Ghost", names: ["nope"] }]);
    expect(frame).toEqual({ names: { nope: "Ghost:nope" }, aliases: {} });
    // An UNRELATED name still resolves via flat-global under the ghost frame.
    expect(withImports(ctx, frame, (c) => evaluate(parse("helper 0"), {}, c))).toBe("foo");
  });

  test("a ghost hiding import yields an empty frame (no members to keep)", () => {
    expect(reg.buildImportFrame([{ module: "Ghost", hiding: ["nope"] }])).toEqual({
      names: {},
      aliases: {},
    });
  });
});

// Namespace-policy regression ------------------------------------------------

describe("declaring-module members honor explicit function namespaces", () => {
  // modules-as-values (2026-09-24) — the two shapes the repository containers
  // took when they became identifiers. `set` (was `decidable-membership`) is
  // named like its header, so it needs no policy. `compileJs` (was
  // `compile-js`) is header-less: the loader argument `compile-js` stays the
  // function-id namespace, declared explicitly, under an identifier container.
  const setModule = loadFenelModule(`module set where
contains x = "set"
`, "set");
  const compileJsSource = loadFenelModule(`compileFenelToJs x = "js"
`, "compile-js");
  const compileJs = {
    ...compileJsSource,
    name: "compileJs",
    functionNamespace: "compile-js",
  };

  // rights R2a — this fixture exercises the CROSS-PREFIX re-id mechanism, which
  // is generic. It used to be spelled with the real `policykit` module's ids;
  // that module is deleted, and leaving its name here would make a grep for the
  // second engine find a live code reference to something that no longer exists.
  const policykitSource = loadFenelModule(`module policykit where
@codeName "policykitCheck"
check x = "policykit"
dispatchCheck x = "dispatch"
`, "policykit");
  const policykit = {
    ...policykitSource,
    functionNamespaceOverrides: [{
      functionId: "policydispatch:check",
      namespace: "policydispatch",
    }],
    functions: (policykitSource.functions ?? []).map((fn) =>
      fn.id === "policykit:dispatchCheck"
        ? { ...fn, id: "policydispatch:check" }
        : fn
    ),
    instances: (policykitSource.instances ?? []).map((instance) =>
      instance.args[0] === "policykit:dispatchCheck"
        ? { ...instance, args: ["policydispatch:check", ...instance.args.slice(1)] }
        : instance
    ),
  };

  const proverSource = loadFenelModule(`module prover where
kernelVerify x = "verified"
`, "prover");
  const prover = {
    ...proverSource,
    functionNamespaceOverrides: [{
      functionId: "kernel:verify",
      namespace: "kernel",
    }],
    functions: (proverSource.functions ?? []).map((fn) =>
      fn.id === "prover:kernelVerify"
        ? { ...fn, id: "kernel:verify" }
        : fn
    ),
    instances: (proverSource.instances ?? []).map((instance) =>
      instance.args[0] === "prover:kernelVerify"
        ? { ...instance, args: ["kernel:verify", ...instance.args.slice(1)] }
        : instance
    ),
  };

  const reg = createRegistry([setModule, compileJs, policykit, prover]);
  const ctx = reg.evaluateContext();

  test("container member rosters retain declaration names, not target-id namespaces", () => {
    expect(reg.listModuleMembers("set")).toEqual(["contains"]);
    expect(reg.listModuleMembers("compileJs")).toEqual(["compileFenelToJs"]);
    expect(reg.listModuleMembers("policykit")).toEqual(["check", "dispatchCheck"]);
    expect(reg.listModuleMembers("prover")).toEqual(["kernelVerify"]);
    // A function-id namespace is not a container.
    expect(reg.listModuleMembers("compile-js")).toEqual([]);
  });

  test("qualified and runtime-carrier lookups reach the full canonical target", () => {
    expect(reg.getFunction("set.contains")?.id).toBe("set:contains");
    expect(reg.getFunction("set:contains")?.id).toBe("set:contains");
    expect(reg.getFunction("compileJs.compileFenelToJs")?.id).toBe("compile-js:compileFenelToJs");
    expect(reg.getFunction("compileJs:compileFenelToJs")?.id).toBe("compile-js:compileFenelToJs");
    expect(reg.getFunction("compile-js:compileFenelToJs")?.id).toBe("compile-js:compileFenelToJs");
    // The retired container spellings resolve nowhere.
    expect(reg.getFunction("decidable-membership.contains")).toBeUndefined();
    expect(reg.getFunction("decidable-membership:contains")).toBeUndefined();
    expect(reg.getFunction("compile-js.compileFenelToJs")).toBeUndefined();
    expect(reg.getFunction("policykit.dispatchCheck")?.id).toBe("policydispatch:check");
    expect(reg.getFunction("policykit:dispatchCheck")?.id).toBe("policydispatch:check");
    expect(reg.getFunction("prover.kernelVerify")?.id).toBe("kernel:verify");
    expect(reg.getFunction("prover:kernelVerify")?.id).toBe("kernel:verify");
  });

  test("selective and hiding frames transport exact target ids", () => {
    expect(reg.buildImportFrame([{
      module: "policykit",
      names: ["dispatchCheck"],
    }])).toEqual({
      names: { dispatchCheck: "policydispatch:check" },
      aliases: {},
    });
    expect(reg.buildImportFrame([{
      module: "policykit",
      hiding: ["check"],
    }])).toEqual({
      names: { dispatchCheck: "policydispatch:check" },
      aliases: {},
    });
  });

  test("public import-frame ingress rejects non-canonical and mixed modes", () => {
    expect(() => reg.buildImportFrame([{
      module: "policykit",
      qualified: true,
      names: ["dispatchCheck"],
    }])).toThrow("import modes are mutually exclusive");
    expect(() => reg.buildImportFrame([{
      module: "policykit",
      as: "P",
      hiding: ["check"],
    }])).toThrow("import modes are mutually exclusive");
    expect(() => reg.buildImportFrame([{
      module: "policykit",
      qualified: false,
    }])).toThrow("expected true when present");
  });

  test("qualified aliases execute through the same exact member index", () => {
    const permissionsFrame = reg.buildImportFrame([{ module: "policykit", as: "P" }]);
    const proverFrame = reg.buildImportFrame([{ module: "prover", as: "Pr" }]);
    const setFrame = reg.buildImportFrame([{ module: "set", as: "D" }]);
    const compileFrame = reg.buildImportFrame([{ module: "compileJs", as: "C" }]);
    expect(withImports(ctx, permissionsFrame, (scope) =>
      evaluate(parse("P.dispatchCheck 0"), {}, scope)
    )).toBe("dispatch");
    expect(withImports(ctx, proverFrame, (scope) =>
      evaluate(parse("Pr.kernelVerify 0"), {}, scope)
    )).toBe("verified");
    expect(withImports(ctx, setFrame, (scope) =>
      evaluate(parse("D.contains 0"), {}, scope)
    )).toBe("set");
    expect(withImports(ctx, compileFrame, (scope) =>
      evaluate(parse("C.compileFenelToJs 0"), {}, scope)
    )).toBe("js");
  });

  test("the renamed containers are written dotted, as a call head and as a value", () => {
    expect(evaluate(parse("set.contains 0"), {}, ctx)).toBe("set");
    expect(evaluate(parse("compileJs.compileFenelToJs 0"), {}, ctx)).toBe("js");
    expect(evaluate(parse("set.contains"), {}, ctx)).toEqual({ $ref: "set:contains" });
    expect(evaluate(parse("compileJs.compileFenelToJs"), {}, ctx)).toEqual({
      $ref: "compile-js:compileFenelToJs",
    });
  });
});
