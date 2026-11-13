// ---------------------------------------------------------------------------
// Tests for `effect-dispatch.ts` — resolveEffect, requiresFor,
// effectMethod, resolveAllRequires.
//
// Cover the core paths: block-scope frame wins over registry, registry
// fallback, missing-instance error, multi-constraint resolution.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  resolveEffect,
  resolveMethod,
  BY_PRIORITY,
  effectMethod,
  resolveAllRequires,
  requiresFor,
} from "./effect-dispatch";
import {
  withInstance,
  type EvaluateContext,
  type TypeclassDictFrame,
} from "./json-logic";
import type { FenelFunction } from "./types";

describe("requiresFor", () => {
  it("returns empty array when fn has no requires", () => {
    const fn: FenelFunction = {
      id: "test:pure",
      params: [],
      returns: { $ref: "Int" },
    };
    expect(requiresFor(fn)).toEqual([]);
  });

  it("returns the declared constraint set", () => {
    const fn: FenelFunction = {
      id: "test:effectful",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }],
    };
    expect(requiresFor(fn)).toHaveLength(1);
    expect(requiresFor(fn)[0]?.class).toEqual({ $tag: "Id", entityId: "HasStateIO" });
  });
});

describe("resolveEffect", () => {
  it("rejects a methods-envelope accessor without invoking it", () => {
    const reg = createDispatchRegistry();
    let reads = 0;
    const instance = {
      typeName: "AccessorEnvelope",
      args: ["scope"],
    } as unknown as Parameters<typeof reg.addInstance>[0];
    Object.defineProperty(instance, "methods", {
      enumerable: true,
      get() {
        reads += 1;
        return { run: "unsafe" };
      },
    });

    expect(() => reg.addInstance(instance)).toThrow("own methods data record");
    expect(reads).toBe(0);
  });

  it("rejects an accessor method without invoking it during registration", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "AccessorMethod",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    let reads = 0;
    const methods: Record<string, unknown> = {};
    Object.defineProperty(methods, "run", {
      enumerable: true,
      get() {
        reads += 1;
        return "unsafe";
      },
    });
    expect(() =>
      reg.addInstance({ typeName: "AccessorMethod", args: ["scope"], methods })
    ).toThrow("accessor value at methods.run");
    expect(reads).toBe(0);
  });

  it("resolves from registry when no dict-stack", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestEffect",
      args: ["account"],
      methods: { run: "test:effectRegistryRun" },
    });
    const result = resolveEffect(undefined, reg, "TestEffect", "account");
    expect(result).toBeDefined();
    expect(result?.source.kind).toBe("instance");
    expect(result?.methods.run).toBe("test:effectRegistryRun");
  });

  it("returns undefined when nothing in scope", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestEffect",
      params: [{ name: "scope" }],
      methods: [],
    });
    expect(resolveEffect(undefined, reg, "TestEffect", "missing")).toBeUndefined();
  });

  it("preserves the registry's zero-argument wildcard semantics", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "ZeroArgEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "ZeroArgEffect",
      args: [],
      methods: { run: "test:effectZeroArgRun" },
    });
    const resolved = resolveEffect(undefined, reg, "ZeroArgEffect", "any-target");
    expect(resolved?.methods.run).toBe("test:effectZeroArgRun");
  });

  it("preserves the registry's type-pattern wildcard semantics", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "PatternEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "PatternEffect",
      args: [{ $var: "scope" }],
      methods: { run: "test:effectPatternRun" },
    });
    const resolved = resolveEffect(undefined, reg, "PatternEffect", "concrete-target");
    expect(resolved?.methods.run).toBe("test:effectPatternRun");
  });

  it("keeps zero-argument and type-pattern rows on the method fallback", () => {
    for (const [typeName, instanceArgs, expected] of [
      ["ZeroMethod", [], "zero-method"],
      ["PatternMethod", [{ $var: "scope" }], "pattern-method"],
    ] as const) {
      const reg = createDispatchRegistry();
      reg.defineClass({
        name: typeName,
        params: [{ name: "scope" }],
        methods: [{
          name: "run",
          params: [{ name: "value", type: { $var: "scope" } } as never],
          returns: { $ref: "Unit" },
        }],
      });
      reg.addInstance({
        typeName,
        args: [...instanceArgs],
        methods: { run: expected },
      });
      expect(resolveMethod(typeName, "run", ["value"], {}, reg)).toMatchObject({
        $tag: "Unique",
        method: expected,
        key: "String",
      });
    }
  });

  it("preserves mixed exact/general priority, visibility, source, and conflicts", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MixedMethod",
      params: [{ name: "scope" }],
      methods: [{
        name: "run",
        params: [{ name: "value", type: { $var: "scope" } } as never],
        returns: { $ref: "Unit" },
      }],
    });
    const exact = {
      typeName: "MixedMethod",
      args: ["String"],
      methods: { run: "exact" },
      scope: { kind: "tag", tag: "exp" } as const,
      priority: 20,
    };
    const wildcard = {
      typeName: "MixedMethod",
      args: [{ $var: "scope" }],
      methods: { run: "wildcard" },
      priority: 10,
    };
    reg.addInstance(exact);
    reg.addInstance(wildcard);

    const untaggedEffect = resolveEffect({}, reg, "MixedMethod", "String");
    expect(untaggedEffect?.source).toEqual({ kind: "instance", instance: wildcard });
    expect(resolveMethod("MixedMethod", "run", ["value"], {}, reg)).toMatchObject({
      $tag: "Unique",
      method: "wildcard",
    });
    expect(resolveMethod(
      "MixedMethod",
      "run",
      ["value"],
      { _activeTags: ["exp"] },
      reg,
    )).toMatchObject({ $tag: "Unique", method: "exact" });

    reg.addInstance({
      typeName: "MixedMethod",
      args: [],
      methods: { run: "zero-arg-tie" },
      priority: 10,
    });
    expect(resolveMethod("MixedMethod", "run", ["value"], {}, reg)).toMatchObject({
      $tag: "Conflict",
      key: "String",
    });
  });

  it("does not let lower-priority exact duplicates conflict above a wildcard winner", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MixedTop",
      params: [{ name: "scope" }],
      methods: [{
        name: "run",
        params: [{ name: "value", type: { $var: "scope" } } as never],
        returns: { $ref: "Unit" },
      }],
    });
    reg.addInstance({ typeName: "MixedTop", args: ["String"], methods: { run: "exact-a" }, priority: 0 });
    reg.addInstance({ typeName: "MixedTop", args: ["String"], methods: { run: "exact-b" }, priority: 0 });
    reg.addInstance({ typeName: "MixedTop", args: [{ $var: "s" }], methods: { run: "wildcard" }, priority: 10 });
    expect(resolveMethod("MixedTop", "run", ["value"], {}, reg)).toMatchObject({
      $tag: "Unique",
      method: "wildcard",
    });
  });

  // rights R3a — THE COARSE BUCKET IS GONE, so this is now the OWNERSHIP
  // question the bucket could not ask. `removeInstancesOwnedBy(a)` removes
  // exactly the rows account `a` owns: a tag row named `global`, a real global
  // row, and ANOTHER account's row all survive. The retired assertion —
  // "`removeInstancesByScope("account")` leaves nothing" — is precisely the
  // defect: one caller's refresh emptied every other account's dispatch.
  it("removes only the rows one account owns, and nothing else", () => {
    const reg = createDispatchRegistry();
    const A = "acct-a";
    const B = "acct-b";
    reg.addInstance({
      typeName: "Scoped",
      args: ["tagged"],
      methods: {},
      scope: { kind: "tag", tag: "global" },
    });
    reg.addInstance({
      typeName: "Scoped",
      args: ["global"],
      methods: {},
      scope: { kind: "global" },
    });
    reg.addInstance({
      typeName: "Scoped",
      args: ["ownedA"],
      methods: {},
      scope: { kind: "account", accountId: A },
    });
    reg.addInstance({
      typeName: "Scoped",
      args: ["ownedB"],
      methods: {},
      scope: { kind: "account", accountId: B },
    });
    reg.removeInstancesOwnedBy(A);
    expect(reg.listInstances("Scoped").map((instance) => instance.args[0])).toEqual([
      "tagged",
      "global",
      "ownedB",
    ]);
    reg.removeInstancesOwnedBy(B);
    expect(reg.listInstances("Scoped").map((instance) => instance.args[0])).toEqual([
      "tagged",
      "global",
    ]);
  });

  it("treats prototype-hostile method names as own semantic keys", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "PrototypeMethodEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "__proto__", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "PrototypeMethodEffect",
      args: ["scope"],
      methods: { ["__proto__"]: "safe-method" },
    });
    const resolved = resolveEffect(undefined, reg, "PrototypeMethodEffect", "scope");
    expect(Object.prototype.hasOwnProperty.call(resolved?.methods, "__proto__")).toBe(true);
    expect(resolved?.methods["__proto__"]).toBe("safe-method");
  });

  it("does not project inherited constructor from an empty block dictionary", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "ConstructorMethodEffect",
      params: [{ name: "scope" }],
      methods: [{
        name: "constructor",
        params: [{ name: "value", type: { $var: "scope" } } as never],
        returns: { $ref: "Unit" },
      }],
    });
    const frame: TypeclassDictFrame = {
      typeName: "ConstructorMethodEffect",
      args: ["String"],
      methods: {},
    };
    const ctx: EvaluateContext = { _dictStack: [frame] };
    expect(resolveMethod(
      "ConstructorMethodEffect",
      "constructor",
      ["value"],
      ctx,
      reg,
    )).toMatchObject({ $tag: "None" });
    expect(() => effectMethod(
      { methods: frame.methods, source: { kind: "block", frame } },
      "constructor",
    )).toThrow(/has no method/);
  });

  it("block-scope frame wins over registry", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestEffect",
      args: ["account"],
      methods: { run: "test:effectRegistryShadowedRun" },
    });
    const ctx: EvaluateContext = {};
    const frame: TypeclassDictFrame = {
      typeName: "TestEffect",
      args: ["account"],
      methods: { run: "test:effectBlockRun" },
    };
    withInstance(ctx, frame, (innerCtx) => {
      const result = resolveEffect(innerCtx, reg, "TestEffect", "account");
      expect(result?.source.kind).toBe("block");
      // Innermost frame's descriptor wins.
      expect(result?.methods.run).toBe("test:effectBlockRun");
    });
  });

  // F→A (universal-dispatch-convergence Phase 6c) — the RETURN-POSITION /
  // capability priority-pick is a face of THIS resolver: `BY_PRIORITY` picks
  // the highest-`priority` instance of the class (the retired
  // `listProvidersSorted[0]` behavior, now inside the one resolver).
  describe("BY_PRIORITY (capability priority-pick)", () => {
    const provReg = () => {
      const reg = createDispatchRegistry();
      reg.defineClass({
        name: "Cap",
        params: [{ name: "provider" }],
        methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
      });
      return reg;
    };

    it("picks the highest-priority provider", () => {
      const reg = provReg();
      reg.addInstance({ typeName: "Cap", args: ["lo"], priority: 5, methods: { run: "test:capLowRun" } });
      reg.addInstance({ typeName: "Cap", args: ["hi"], priority: 20, methods: { run: "test:capHighRun" } });
      const result = resolveEffect(undefined, reg, "Cap", BY_PRIORITY);
      expect(result?.source.kind).toBe("instance");
      expect(result?.methods.run).toBe("test:capHighRun");
    });

    it("treats a missing priority as 0", () => {
      const reg = provReg();
      reg.addInstance({ typeName: "Cap", args: ["default"], methods: { run: "test:capDefaultRun" } });
      reg.addInstance({ typeName: "Cap", args: ["ranked"], priority: 1, methods: { run: "test:capRankedRun" } });
      expect(resolveEffect(undefined, reg, "Cap", BY_PRIORITY)?.methods.run).toBe("test:capRankedRun");
    });

    it("returns undefined when the class has no providers", () => {
      expect(resolveEffect(undefined, provReg(), "Cap", BY_PRIORITY)).toBeUndefined();
    });
  });
});

describe("effectMethod", () => {
  it("returns the method when present", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestEffect",
      args: ["account"],
      methods: { run: "test:effectMethodRun" },
    });
    const resolved = resolveEffect(undefined, reg, "TestEffect", "account");
    expect(resolved).toBeDefined();
    expect(effectMethod(resolved!, "run")).toBe("test:effectMethodRun");
  });

  it("throws when method missing", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestEffect",
      params: [{ name: "scope" }],
      methods: [{ name: "run", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestEffect",
      args: ["account"],
      methods: { run: "test:effectMissingMethodRun" },
    });
    const resolved = resolveEffect(undefined, reg, "TestEffect", "account");
    expect(() => effectMethod(resolved!, "nonexistent")).toThrow(/has no method/);
  });
});

describe("resolveAllRequires", () => {
  it("resolves every constraint on a function", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "EffectA",
      params: [{ name: "s" }],
      methods: [],
    });
    reg.defineClass({
      name: "EffectB",
      params: [{ name: "s" }],
      methods: [],
    });
    reg.addInstance({ typeName: "EffectA", args: ["scope-1"], methods: { a: 1 } });
    reg.addInstance({ typeName: "EffectB", args: ["scope-1"], methods: { b: 2 } });
    const fn: FenelFunction = {
      id: "test:multi",
      params: [],
      returns: { $ref: "Unit" },
      requires: [
        { class: { $tag: "Id", entityId: "EffectA" }, args: [{ $var: "s" }] },
        { class: { $tag: "Id", entityId: "EffectB" }, args: [{ $var: "s" }] },
      ],
    };
    const all = resolveAllRequires(undefined, reg, fn, () => "scope-1");
    expect(Object.keys(all).sort()).toEqual(["EffectA", "EffectB"]);
  });

  it("throws when any constraint is unresolved", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "EffectA",
      params: [{ name: "s" }],
      methods: [],
    });
    // No instance for EffectA :: scope-X
    const fn: FenelFunction = {
      id: "test:missing",
      params: [],
      returns: { $ref: "Unit" },
      requires: [{ class: { $tag: "Id", entityId: "EffectA" }, args: [{ $var: "s" }] }],
    };
    expect(() => resolveAllRequires(undefined, reg, fn, () => "scope-X")).toThrow(
      /no instance found/,
    );
  });
});
