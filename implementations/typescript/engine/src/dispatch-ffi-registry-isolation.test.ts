import { afterEach, describe, expect, test } from "bun:test";
import { dispatchNativesCtx } from "../../../../fenel/modules/dispatch/ffi/dispatch-ffi";
import { createDispatchRegistry } from "./dispatch-registry";
import type { EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { dispatchRegistry as repositoryRegistry } from "./system-entities";
import { accountDispatchFrame } from "./authority-test-support";
import type { Instance, Interface } from "./types";

// ⚠ rights R3a — A WRITE NEEDS AN ACCOUNT FRAME, so the contexts here carry one.
//
// Registry AUTHORITY still follows the evaluation context, which is what this
// file is about and what every assertion below still measures. What changed is
// that a registration's SCOPE is no longer argued: the two register natives ask
// one Fenel disposition (`dispatch:registrationScope`) what account owns the
// row, and a frame that derives none REFUSES. A bare `{ _specRegistry: reg }`
// derives none AND cannot resolve the disposition, so it now writes nothing at
// all — which is the decode's fail-closed rule, not a fixture accident, and the
// last test in this describe pins it directly.
const ACCOUNT_A = "r3a-ffi-isolation-account-a";
const ACCOUNT_B = "r3a-ffi-isolation-account-b";

const CLASS = "DispatchFfiIsolationTest";
const TARGET = "same-structural-token";
const STALE_TARGET = "stale-process-global-token";
const CONTEXT_FREE_TARGET = "context-free-compat-token";
const MISSING_CONTEXT_TARGET = "missing-context-must-not-write";

const byType = (target: string) => ({ $tag: "ByType", target });
const noScope = { $tag: "Nothing" };
type HostileRecord = Record<"__proto__" | "constructor", { owner: string }>;

const interfaceFor = (label: string): Interface => ({
  name: CLASS,
  label,
  methods: [{
    name: "owner",
    params: [],
    returns: { $ref: "String" },
  }],
});

afterEach(() => {
  // rights R3a — removal names an OWNER. The repository rows this file plants
  // directly (`addInstance`, no scope) are GLOBAL and are deliberately not
  // removable through the API, so they carry a per-run unique target instead
  // and the cleanup removes only what a native wrote.
  for (const target of [TARGET, STALE_TARGET, CONTEXT_FREE_TARGET, MISSING_CONTEXT_TARGET]) {
    for (const owner of [ACCOUNT_A, ACCOUNT_B]) {
      repositoryRegistry.removeInstance(CLASS, target, owner);
    }
  }
});

describe("dispatch FFI registry authority", () => {
  test("identical tokens remain isolated across evaluation registries", () => {
    const registryA = createDispatchRegistry();
    const registryB = createDispatchRegistry();
    registryA.defineClass(interfaceFor("registry A"));
    registryB.defineClass(interfaceFor("registry B"));
    const ctxA = accountDispatchFrame(ACCOUNT_A, registryA) as EvaluateContext;
    const ctxB = accountDispatchFrame(ACCOUNT_B, registryB) as EvaluateContext;

    dispatchNativesCtx.register(ctxA, CLASS, byType(TARGET), { owner: "A" }, noScope);
    dispatchNativesCtx.register(ctxB, CLASS, byType(TARGET), { owner: "B" }, noScope);

    expect(dispatchNativesCtx.lookupAll(ctxA, CLASS, TARGET)).toEqual([{ owner: "A" }]);
    expect(dispatchNativesCtx.lookupAll(ctxB, CLASS, TARGET)).toEqual([{ owner: "B" }]);
    expect(dispatchNativesCtx.lookup(ctxA, CLASS, TARGET)).toEqual({
      $tag: "Unique",
      value: { owner: "A" },
    });
    expect(dispatchNativesCtx.lookupOne(ctxB, CLASS, TARGET)).toEqual({
      $tag: "Just",
      _0: { owner: "B" },
    });
    expect(dispatchNativesCtx.listAllInstances(ctxA, CLASS)).toEqual([
      expect.objectContaining({
        args: [TARGET],
        methods: { owner: "A" },
        // rights R3a — the row is OWNED by the frame that wrote it, and the
        // native's `scope` argument (`Nothing` here) was ignored.
        scope: { kind: "account", accountId: ACCOUNT_A },
      }),
    ]);
    expect(dispatchNativesCtx.getType(ctxA, CLASS)).toEqual({
      $tag: "Just",
      _0: interfaceFor("registry A"),
    });
    expect(dispatchNativesCtx.getType(ctxB, CLASS)).toEqual({
      $tag: "Just",
      _0: interfaceFor("registry B"),
    });
    expect(repositoryRegistry.listInstances(CLASS)
      .filter((row) => row.args[0] === TARGET)).toEqual([]);

    dispatchNativesCtx.unregister(ctxA, CLASS, TARGET);
    expect(dispatchNativesCtx.lookupAll(ctxA, CLASS, TARGET)).toEqual([]);
    expect(dispatchNativesCtx.lookupAll(ctxB, CLASS, TARGET)).toEqual([{ owner: "B" }]);
  }, 200_000);

  test("stale global rows are invisible and a registry-less ctx cannot mutate them", () => {
    repositoryRegistry.addInstance({
      typeName: CLASS,
      args: [STALE_TARGET],
      methods: { owner: "stale-global" },
    });
    const localRegistry = createDispatchRegistry();
    const localCtx = accountDispatchFrame(ACCOUNT_A, localRegistry) as EvaluateContext;
    const registrylessCtx = accountDispatchFrame(ACCOUNT_A) as EvaluateContext;
    delete (registrylessCtx as Record<string, unknown>)["_specRegistry"];

    expect(dispatchNativesCtx.lookupAll(localCtx, CLASS, STALE_TARGET)).toEqual([]);
    expect(dispatchNativesCtx.lookup(localCtx, CLASS, STALE_TARGET)).toEqual({ $tag: "None" });
    expect(dispatchNativesCtx.listAllInstances(localCtx, CLASS)).toEqual([]);

    dispatchNativesCtx.register(
      registrylessCtx,
      CLASS,
      byType(MISSING_CONTEXT_TARGET),
      { owner: "must-not-publish" },
      noScope,
    );
    dispatchNativesCtx.unregister(registrylessCtx, CLASS, STALE_TARGET);
    expect(repositoryRegistry.listInstances(CLASS)
      .filter((row) => row.args[0] === MISSING_CONTEXT_TARGET)).toEqual([]);
    expect(repositoryRegistry.listInstances(CLASS)
      .filter((row) => row.args[0] === STALE_TARGET)
      .map((row) => row.methods)).toEqual([{ owner: "stale-global" }]);

    dispatchNativesCtx.register(
      localCtx,
      CLASS,
      byType(STALE_TARGET),
      { owner: "local" },
      noScope,
    );
    expect(dispatchNativesCtx.lookupAll(localCtx, CLASS, STALE_TARGET)).toEqual([
      { owner: "local" },
    ]);
    expect(repositoryRegistry.listInstances(CLASS)
      .filter((row) => row.args[0] === STALE_TARGET)
      .map((row) => row.methods)).toEqual([{ owner: "stale-global" }]);
  }, 200_000);

  // ⚠ rights R3a — THE CONTEXT-FREE COMPATIBILITY WRITE IS GONE. The repository
  // fallback still serves a genuinely context-free READ, but a WRITE from a
  // context that derives no account refuses: the register native asks the Fenel
  // disposition and there is nothing to own the row with. This is the fence
  // that closes the executed `$where`-under-the-harness channel — an authored
  // predicate evaluated under the engine harness's bootstrap frame used to be
  // able to plant a `{kind:"global"}` row, and that harness frame derives no
  // account either.
  test("a context that derives no account CANNOT write, in either direction", () => {
    const contextFree = undefined as unknown as EvaluateContext;
    expect(() => dispatchNativesCtx.register(
      contextFree,
      CLASS,
      byType(CONTEXT_FREE_TARGET),
      { owner: "repository-compat" },
      noScope,
    )).toThrow(/account frame/);
    expect(repositoryRegistry.listInstances(CLASS)
      .filter((row) => row.args[0] === CONTEXT_FREE_TARGET)).toEqual([]);
    // the READ side is unchanged — a context-free lookup still reaches the
    // repository, it simply finds nothing because nothing was written.
    expect(dispatchNativesCtx.lookupAll(contextFree, CLASS, CONTEXT_FREE_TARGET)).toEqual([]);
    expect(() => dispatchNativesCtx.unregister(contextFree, CLASS, CONTEXT_FREE_TARGET))
      .toThrow(/account frame/);
  }, 200_000);
});

describe("registry-local facet clone isolation", () => {
  test("preserves hostile own keys and normal/null prototypes recursively", () => {
    const nestedArg = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nestedArg, "__proto__", {
      value: { owner: "arg-proto" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(nestedArg, "constructor", {
      value: { owner: "arg-constructor" },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const methods: Record<string, unknown> = {};
    Object.defineProperty(methods, "__proto__", {
      value: { owner: "method-proto" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(methods, "constructor", {
      value: { owner: "method-constructor" },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const facet: Instance = {
      typeName: "PrototypeCloneFacet",
      args: [TARGET, nestedArg as unknown as Instance["args"][number]],
      methods,
      scope: "account",
    };
    const first = createRegistry([], { fieldRepresentations: [facet] });
    const second = createRegistry([], { fieldRepresentations: [facet] });
    const firstFacet = first.getFieldRepresentation(
      "PrototypeCloneFacet",
      TARGET,
      "account",
    )!;
    const secondFacet = second.getFieldRepresentation(
      "PrototypeCloneFacet",
      TARGET,
      "account",
    )!;
    const firstArg = firstFacet.args[1] as unknown as HostileRecord;
    const secondArg = secondFacet.args[1] as unknown as HostileRecord;
    const firstMethods = firstFacet.methods as unknown as HostileRecord;
    const secondMethods = secondFacet.methods as unknown as HostileRecord;

    expect(Object.getPrototypeOf(firstArg)).toBeNull();
    expect(Object.getPrototypeOf(firstMethods)).toBe(Object.prototype);
    for (const key of ["__proto__", "constructor"] as const) {
      expect(Object.prototype.hasOwnProperty.call(firstArg, key)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(firstMethods, key)).toBe(true);
    }
    expect(firstArg["__proto__"].owner).toBe("arg-proto");
    expect(firstArg["constructor"].owner).toBe("arg-constructor");
    expect(firstMethods["__proto__"].owner).toBe("method-proto");
    expect(firstMethods["constructor"].owner).toBe("method-constructor");

    firstArg["__proto__"].owner = "first-only";
    firstMethods["constructor"].owner = "first-only";
    expect(secondArg["__proto__"].owner).toBe("arg-proto");
    expect(secondMethods["constructor"].owner).toBe("method-constructor");
    expect((nestedArg["__proto__"] as { owner: string }).owner).toBe("arg-proto");
    expect((methods["constructor"] as { owner: string }).owner).toBe("method-constructor");
  }, 120_000); // P4-prep: 30s pin exceeded by the cold facet-clone walk on the Windows box (the P2 "timeout pins corrected" class)
});
