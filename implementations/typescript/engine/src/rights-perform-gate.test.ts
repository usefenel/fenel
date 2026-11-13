import { describe, expect, test } from "bun:test";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  resolveEffect,
} from "./effect-dispatch";
import {
  evaluate,
  pureEvaluateContext,
  withInstance,
  type EvaluateContext,
  type TypeclassDictFrame,
} from "./json-logic";
import {
  perform,
  type PerformTableController,
} from "./perform";
import {
  mintTestAuthorityFor,
  mintTestAuthorityForNothing,
  testPerformTable,
} from "./authority-test-support";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { timeModule } from "./modules/time";
import { GLOBAL_ONLY } from "./dispatch-registry";
import type {
  FenelFunction,
  FenelModule,
  Interface,
  IOHandlerContext,
} from "./types";

const EFFECT_CONSTRAINT = (className: string) => ({
  class: { $tag: "Id" as const, entityId: className },
  args: [{ $var: "scope" }],
});

function effectClass(name: string): Interface {
  return { name, params: [{ name: "scope" }], methods: [] };
}

type NativeFixture = {
  readonly ctx: EvaluateContext;
  readonly registry: ReturnType<typeof createDispatchRegistry>;
  readonly table: PerformTableController;
  readonly leafHits: () => number;
};

function nativeFixture(options: {
  readonly alsoPermit?: readonly string[];
  readonly id: string;
  readonly codeName: string;
  readonly className?: string;
  readonly registeredClass?: boolean;
  readonly contextNative?: boolean;
  readonly result?: unknown;
}): NativeFixture {
  const registry = createDispatchRegistry();
  if (options.className !== undefined && options.registeredClass !== false) {
    registry.defineClass(effectClass(options.className));
  }
  let hits = 0;
  const leaf = (..._args: unknown[]) => {
    hits++;
    return options.result ?? "leaf";
  };
  const spec: FenelFunction = {
    id: options.id,
    params: [],
    returns: { $ref: "String" },
    ...(options.className === undefined
      ? {}
      : { requires: [EFFECT_CONSTRAINT(options.className)] }),
  };
  const table = testPerformTable();
  const isAct = options.className !== undefined && options.registeredClass !== false;
  const nativePerformDescriptors = {
    context: Object.create(null) as Record<string, true>,
    plain: Object.create(null) as Record<string, true>,
  };
  if (isAct) {
    nativePerformDescriptors[options.contextNative ? "context" : "plain"][options.id] = true;
    table.register(
      options.id,
      (_frame, args) => leaf(...args),
      options.contextNative ? 2 : 1,
    );
  }
  const ctx: EvaluateContext = {
    // rights R2a — the fixture frame names exactly the descriptors the probe is
    // allowed to reach, so every case below exercises the real judgment rather
    // than a bypass. A probe that redirects at a second descriptor must name it.
    _authority: mintTestAuthorityFor([options.id, ...(options.alsoPermit ?? [])]),
    getFunction: (name) =>
      name === options.id || name === options.codeName ? spec : undefined,
    ...(isAct
      ? { _nativePerformDescriptors: nativePerformDescriptors }
      : options.contextNative
        ? { nativesCtx: { [options.id]: (_ctx: EvaluateContext, ...args: unknown[]) => leaf(...args) } }
        : { natives: { [options.id]: leaf } }),
    _specRegistry: registry,
    _performTable: table.handle,
    _activeScopeToken: "account",
    _codeNameFor: (id) => id === options.id ? options.codeName : undefined,
  };
  return { ctx, registry, table, leafHits: () => hits };
}

describe("Landing 1 descriptor-first perform gate", () => {
  test("A0 — dispatch instances reject direct and nested host callables", () => {
    const direct = createDispatchRegistry();
    expect(() => direct.addInstance({
      typeName: "CallableSafety",
      args: ["direct"],
      methods: { run: () => "leak" },
    })).toThrow(/host callable.*descriptor/i);

    const nested = createDispatchRegistry();
    expect(() => nested.addInstance({
      typeName: "CallableSafety",
      args: ["nested"],
      methods: {
        run: {
          descriptor: "probe:run",
          captured: { leak: () => "nested-leak" },
        },
      },
    })).toThrow(/host callable.*descriptor/i);

    let getterReads = 0;
    const nestedAccessor = {
      descriptor: "probe:accessor",
      get captured() {
        getterReads++;
        return () => "leak";
      },
    };
    const accessor = createDispatchRegistry();
    expect(() => accessor.addInstance({
      typeName: "CallableSafety",
      args: ["accessor"],
      methods: { run: nestedAccessor },
    })).toThrow(/accessor value at methods\.run\.captured/i);
    expect(getterReads).toBe(0);

    const cyclicMethod: Record<string, unknown> = {
      descriptor: "probe:cycle",
    };
    cyclicMethod["self"] = cyclicMethod;
    const cyclic = createDispatchRegistry();
    expect(() => cyclic.addInstance({
      typeName: "CallableSafety",
      args: ["cycle"],
      methods: { run: cyclicMethod },
    })).not.toThrow();
    expect(cyclic.resolve("cycle", "CallableSafety", GLOBAL_ONLY)?.["run"]).toBe(cyclicMethod);
  });

  test("Probe 5 — perform consults the live frame authority for the argued act", () => {
    // rights R2a — the Landing-1 shape of this probe pinned a TEST envelope
    // whose only rule was "refuse this exact act". It now pins the SHIPPED
    // judgment: a minted authority whose descriptor enumeration names one leaf
    // and not the other, judged by `authority:permits`.
    const table = testPerformTable();
    let leafHits = 0;
    table.register("probe:envelope", (_frame, args) => {
      leafHits++;
      return args[0];
    }, 0);
    table.register("probe:other", (_frame, args) => {
      leafHits++;
      return args[0];
    }, 0);
    const pinned = { descriptor: "probe:envelope", args: ["pinned"] } as const;

    const permissive: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["probe:envelope", "probe:other"]),
    };
    expect(perform(permissive, pinned)).toBe("pinned");
    expect(leafHits).toBe(1);

    const restricted: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["probe:other"]),
    };
    expect(() => perform(restricted, pinned)).toThrow(
      /authority refused "probe:envelope" \(refused\)/i,
    );
    expect(leafHits).toBe(1);

    expect(perform(restricted, {
      descriptor: "probe:other",
      args: ["different"],
    })).toBe("different");
    expect(leafHits).toBe(2);

    // An empty envelope refuses even a registered descriptor, and an absent
    // handle refuses before the envelope is ever read.
    const nothing: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityForNothing(),
    };
    expect(() => perform(nothing, pinned)).toThrow(/\(refused\)/);
    expect(() => perform({ _performTable: table.handle }, pinned)).toThrow(/\(absent\)/);
    expect(leafHits).toBe(2);
  }, 120_000);

  test("Probe 1 — a captured raw dictionary callable cannot execute through the method surface", () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "CaptureAuthority",
      params: [{ name: "a" }],
      methods: [{
        name: "run",
        params: [{ name: "value", type: { $var: "a" } } as never],
        returns: { $var: "a" },
      }],
    });
    registry.defineClass({
      name: "CapturedCallable",
      params: [{ name: "a" }],
      methods: [{
        name: "run",
        params: [{ name: "value", type: { $var: "a" } } as never],
        returns: { $var: "a" },
      }],
    });
    let dangerHits = 0;
    let safeHits = 0;
    const danger = (value: unknown) => {
      dangerHits++;
      return `danger:${String(value)}`;
    };
    const safe = (value: unknown) => {
      safeHits++;
      return `safe:${String(value)}`;
    };
    const base: EvaluateContext = { _specRegistry: registry };
    const captured = withInstance(
      base,
      { typeName: "CaptureAuthority", args: ["String"], methods: { run: danger } },
      (broad) => resolveEffect(broad, registry, "CaptureAuthority", "String")!.methods["run"],
    );
    const narrow: TypeclassDictFrame = {
      typeName: "CaptureAuthority",
      args: ["String"],
      methods: { run: safe },
    };
    const callCaptured = () => withInstance(base, narrow, (narrowCtx) => withInstance(
      narrowCtx,
      { typeName: "CapturedCallable", args: ["String"], methods: { run: captured } },
      (inner) => evaluate(
        { method: ["CapturedCallable", "run", "payload"] },
        {},
        inner,
      ),
    ));

    expect(callCaptured).toThrow(
      /host callable.*descriptor/i,
    );
    expect(dangerHits).toBe(0);
    expect(safeHits).toBe(0);
  });

  test("Probe 2 — production time:nowIso wiring observes a HasTime block override by authoritative codeName", () => {
    const registry = createRegistry([stdModule, timeModule]);
    const ctx = registry.evaluateContext();
    expect(ctx._codeNameFor?.("time:nowIso")).toBe("nowIso");
    const pinned = {
      __fenelFn: true as const,
      params: [],
      body: "2042-01-02T03:04:05.000Z",
      closure: {},
    };
    const result = withInstance(
      ctx,
      { typeName: "HasTime", args: ["account"], methods: { nowIso: pinned } },
      (inner) => evaluate({ call: ["time:nowIso"] }, {}, inner),
    );
    expect(result).toBe("2042-01-02T03:04:05.000Z");
  }, 60_000);

  test("self-descriptor terminates in exactly one mediated perform", () => {
    const fixture = nativeFixture({
      id: "time:nowIso",
      codeName: "nowIso",
      className: "HasTime",
    });
    const result = withInstance(
      fixture.ctx,
      {
        typeName: "HasTime",
        args: ["account"],
        methods: { nowIso: "time:nowIso" },
      },
      (inner) => evaluate({ call: ["time:nowIso"] }, {}, inner),
    );
    expect(result).toBe("leaf");
    // This act's leaf exists only in the private table, so one leaf hit is one
    // completed perform and also proves the self descriptor did not recurse.
    expect(fixture.leafHits()).toBe(1);
  });

  test("a Ref to a registered host descriptor performs instead of falling through to null", () => {
    const fixture = nativeFixture({
      id: "time:nowIso",
      codeName: "nowIso",
      className: "HasTime",
      alsoPermit: ["test.clock"],
    });
    fixture.table.register(
      "test.clock",
      (_frame, _args) => "ref-override",
      0,
    );
    const baseGetFunction = fixture.ctx.getFunction;
    const bodylessDescriptor: FenelFunction = {
      id: "test.clock",
      params: [],
      returns: { $ref: "String" },
    };
    fixture.ctx.getFunction = (name) =>
      name === "test.clock" ? bodylessDescriptor : baseGetFunction?.(name);
    const result = withInstance(
      fixture.ctx,
      {
        typeName: "HasTime",
        args: ["account"],
        methods: { nowIso: { $ref: "test.clock" } },
      },
      (inner) => evaluate({ call: ["time:nowIso"] }, {}, inner),
    );
    expect(result).toBe("ref-override");
    expect(fixture.leafHits()).toBe(0);
  });

  test("face-name/codeName mismatch misses the override and performs the own leaf", () => {
    const fixture = nativeFixture({
      id: "dispatch:lookupOne",
      codeName: "dispatchLookupOne",
      className: "HasRegistry",
    });
    const wrongFaceOverride = {
      __fenelFn: true as const,
      params: [],
      body: "wrong-override",
      closure: {},
    };
    const result = withInstance(
      fixture.ctx,
      {
        typeName: "HasRegistry",
        args: ["account"],
        methods: { lookupOne: wrongFaceOverride },
      },
      (inner) => evaluate({ call: ["dispatch:lookupOne"] }, {}, inner),
    );
    expect(result).toBe("leaf");
    expect(fixture.leafHits()).toBe(1);
  });

  test("requires-free ctx-native precedence stays direct and never enters perform", () => {
    const fixture = nativeFixture({
      id: "probe:pure",
      codeName: "pureProbe",
      contextNative: true,
      result: "ctx-native",
    });
    fixture.ctx.natives = { "probe:pure": () => "plain-native" };
    expect(evaluate({ call: ["probe:pure"] }, {}, fixture.ctx)).toBe("ctx-native");
    expect(fixture.leafHits()).toBe(1);
    expect(() => perform(
      fixture.ctx,
      { descriptor: "probe:pure", args: [] },
    )).toThrow(/no implementation/i);
  });

  test("pureEvaluateContext preserves mediation carriers but never IOHandlerContext", () => {
    const fixture = nativeFixture({
      id: "time:nowIso",
      codeName: "nowIso",
      className: "HasTime",
      result: "bypass",
    });
    fixture.ctx._ioHandlerContext = {
      accountId: "must-not-copy",
      profileId: "must-not-copy",
      authority: mintTestAuthorityForNothing(),
      callFunction: async () => null,
      dispatchAction: async () => null,
    };
    const pure = pureEvaluateContext(fixture.ctx);
    expect(pure._ioHandlerContext).toBeUndefined();
    const result = withInstance(
      pure,
      {
        typeName: "HasTime",
        args: ["account"],
        methods: {
          nowIso: {
            __fenelFn: true,
            params: [],
            body: "pure-override",
            closure: {},
          },
        },
      },
      (inner) => evaluate({ call: ["time:nowIso"] }, {}, inner),
    );
    expect(result).toBe("pure-override");
    expect(fixture.leafHits()).toBe(0);
  });

  test("predicate-bound requires do not classify a native as an act", () => {
    const fixture = nativeFixture({
      id: "probe:predicateBound",
      codeName: "predicateBound",
      className: "isRecordType",
      registeredClass: false,
      result: "direct",
    });
    // Predicate bounds name a function, not a registered class.
    expect(fixture.registry.getClass("isRecordType")).toBeUndefined();
    expect(evaluate({ call: ["probe:predicateBound"] }, {}, fixture.ctx)).toBe("direct");
    expect(() => perform(
      fixture.ctx,
      { descriptor: "probe:predicateBound", args: [] },
    )).toThrow(/no implementation/i);
  });

  test("a requires-bearing native fails closed when its spec registry is absent", () => {
    const fixture = nativeFixture({
      id: "probe:closed",
      codeName: "closed",
      className: "HasClosedProbe",
    });
    const withoutRegistry: EvaluateContext = {
      ...fixture.ctx,
      _specRegistry: undefined,
    };
    expect(() => evaluate({ call: ["probe:closed"] }, {}, withoutRegistry)).toThrow(
      /native act.*without a spec registry/i,
    );
    // A perform under Top would invoke this table-only leaf. Zero hits proves
    // failure occurred before gate exercise, not after a hidden host call.
    expect(fixture.leafHits()).toBe(0);
  });

  test("table registration fixes ctx-native precedence before perform and aliases cannot lower it", () => {
    const table = testPerformTable();
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor([
        "collision", "io.target", "capture", "alias.self", "alias.retarget", "retarget.first", "retarget.second",
      ]),
    };
    table.register("collision", () => "plain", 1);
    table.register("collision", () => "ctx", 2);
    table.register("collision", () => "io", 0);
    table.register("io.target", () => "aliased-io", 0);
    expect(table.alias("collision", "io.target")).toBe(true);
    expect(perform(frame, { descriptor: "collision", args: [] })).toBe("ctx");
    const params = { value: 42 };
    let capturedArgs: readonly unknown[] | undefined;
    table.register("capture", (_frame, args) => {
      capturedArgs = args;
      return "captured";
    }, 0);
    expect(perform(frame, { descriptor: "capture", args: [params] })).toBe("captured");
    expect(capturedArgs).toEqual([params]);
  });

  test("ModuleRegistry keeps requires-free natives direct and IO callables behind perform", async () => {
    const fixtureModule: FenelModule = {
      name: "perform-fixture",
      label: "Perform fixture",
      functions: [],
      nativeImpls: { "perform-fixture:native": () => "native" },
    };
    // rights R2a — `stdModule` is present because the CHECKER needs it: the
    // authority module is prepended to every registry and its body calls std
    // leaves, so a std-less registry judges nothing and refuses every act.
    const registry = createRegistry([stdModule, fixtureModule], {
      dispatchRegistry: createDispatchRegistry(),
    });
    const frame = registry.evaluateContext();
    expect(evaluate({ call: ["perform-fixture:native"] }, {}, frame)).toBe("native");
    expect(frame._nativePerformDescriptors?.plain["perform-fixture:native"]).toBeUndefined();
    expect(() => perform(
      frame,
      { descriptor: "perform-fixture:native", args: [] },
    )).toThrow(/no implementation/i);

    let rawHits = 0;
    const raw = async (params: Record<string, unknown>) => {
      rawHits++;
      return { action: "continue" as const, value: params["value"] };
    };
    registry.registerIOHandler("fixture.io", raw);
    expect(registry.aliasIOHandler("fixture.io.alias", "fixture.io")).toBe(true);
    const compatibility = registry.getIOHandler("fixture.io.alias")!;
    expect(compatibility).not.toBe(raw);
    const ioContext: IOHandlerContext = {
      accountId: "account",
      profileId: "profile",
      authority: mintTestAuthorityFor(["fixture.io", "fixture.io.alias"], registry),
      callFunction: async () => null,
      dispatchAction: async () => null,
    };
    const params = { value: 42 };
    expect(await compatibility(params, ioContext)).toEqual({
      action: "continue",
      value: 42,
    });
    expect(rawHits).toBe(1);
  }, 30_000);

  test("ModuleRegistry gives registered-class natives table-only residency with ctx precedence", () => {
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(effectClass("HasFixtureAct"));
    const act: FenelFunction = {
      id: "perform-fixture:act",
      params: [],
      returns: { $ref: "String" },
      requires: [EFFECT_CONSTRAINT("HasFixtureAct")],
    };
    const predicate: FenelFunction = {
      id: "perform-fixture:predicate",
      params: [],
      returns: { $ref: "String" },
      requires: [EFFECT_CONSTRAINT("isFixtureValue")],
    };
    const pure: FenelFunction = {
      id: "perform-fixture:pure",
      params: [],
      returns: { $ref: "String" },
    };
    const registry = createRegistry([stdModule, {
      name: "perform-fixture",
      label: "Perform fixture",
      functions: [act, predicate, pure],
      nativeImpls: {
        [act.id]: () => "plain-act",
        [predicate.id]: () => "predicate-direct",
        [pure.id]: () => "plain-pure",
      },
      nativeImplsCtx: {
        [act.id]: () => "ctx-act",
        [pure.id]: () => "ctx-pure",
      },
      ioHandlers: {
        "perform-fixture:io": async () => ({ action: "continue", value: "io" }),
      },
    }], { dispatchRegistry: dispatch });
    const frame = registry.evaluateContext();
    const moduleView = registry.modules.find(({ name }) => name === "perform-fixture");

    expect(moduleView?.nativeImpls).toBeUndefined();
    expect(moduleView?.nativeImplsCtx).toBeUndefined();
    expect(moduleView?.ioHandlers).toBeUndefined();

    expect(frame.natives?.[act.id]).toBeUndefined();
    expect(frame.nativesCtx?.[act.id]).toBeUndefined();
    expect(frame._nativePerformDescriptors?.plain[act.id]).toBe(true);
    expect(frame._nativePerformDescriptors?.context[act.id]).toBe(true);
    expect(evaluate({ call: [act.id] }, {}, frame)).toBe("ctx-act");
    expect(perform(frame, { descriptor: act.id, args: [] })).toBe("ctx-act");

    expect(frame._nativePerformDescriptors?.plain[predicate.id]).toBeUndefined();
    expect(frame.natives?.[predicate.id]).toBeFunction();
    expect(evaluate({ call: [predicate.id] }, {}, frame)).toBe("predicate-direct");
    expect(() => perform(frame, { descriptor: predicate.id, args: [] })).toThrow(
      /no implementation/i,
    );

    expect(frame._nativePerformDescriptors?.plain[pure.id]).toBeUndefined();
    expect(frame._nativePerformDescriptors?.context[pure.id]).toBeUndefined();
    expect(frame.natives?.[pure.id]).toBeFunction();
    expect(frame.nativesCtx?.[pure.id]).toBeFunction();
    expect(evaluate({ call: [pure.id] }, {}, frame)).toBe("ctx-pure");
    expect(() => perform(frame, { descriptor: pure.id, args: [] })).toThrow(
      /no implementation/i,
    );
  }, 30_000);
});
