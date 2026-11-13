import { describe, expect, it } from "bun:test";

import {
  assertExactRepositoryFunctionOwner,
  assertExactRepositoryFunctionNamespaceAgreement,
  exactRepositoryCompilerModuleEntityProjection,
  exactRepositoryCompilerModuleFunctionProjection,
  exactRepositoryFunctionNamespacePolicy,
  exactRepositoryCompilerMetadataSnapshot,
} from "./compiler-metadata-view";
import type { FenelFunction, FenelModule, FunctionBody } from "./types";
import { projectEntityFieldFacetDirectives, tryProjectFieldFacets } from "./field-representations";
import { stdModule } from "./modules/std";

function compilerFunction(id: string, body: FunctionBody): FenelFunction {
  return { id, params: [], returns: { $ref: "Boolean" }, body };
}

function namespaceModule(
  name: string,
  metadata: Partial<Pick<
    FenelModule,
    "functionNamespace" | "functionNamespaceOverrides"
  >> = {},
): FenelModule {
  return { name, label: "Namespace policy test", ...metadata };
}

describe("repository compiler metadata snapshots", () => {
  it("projects exact entity authority without reading function or runtime slots", () => {
    let irrelevantReads = 0;
    const entity = {
      id: "Demo",
      module: "demo-owner",
      type: { record: [{ name: "value", type: { $ref: "String" } }] },
      typeScheme: {
        quantified: [],
        body: { record: [{ name: "value", type: { $ref: "String" } }] },
      },
    };
    const directive = {
      owner: { module: "demo-owner", entityId: "Demo" },
      selector: "value",
      source: { kind: "label", label: "Value" },
      provenance: {
        module: "demo-owner",
        declaration: "@fieldLabel value \"Value\"",
        selector: "value",
      },
    };
    const source = {
      name: "demo",
      entities: [entity],
      fieldFacetDirectives: [
        {
          owner: { functionId: "demo:omitted-function" },
          selector: "value",
          source: { kind: "label", label: "Omitted function parameter" },
          provenance: { module: "demo", declaration: "omitted-function", selector: "value" },
        },
        directive,
      ],
    };
    for (const key of ["functions", "instances", "nativeImpls"] as const) {
      Object.defineProperty(source, key, {
        enumerable: true,
        get() {
          irrelevantReads += 1;
          throw new Error(`unexpected ${key} read`);
        },
      });
    }

    const projection = exactRepositoryCompilerModuleEntityProjection(source as never);
    expect(irrelevantReads).toBe(0);
    expect(projection.name).toBe("demo");
    expect(projection.entities?.map((candidate) => candidate.id)).toEqual(["Demo"]);
    expect(projection.entities?.[0]?.module).toBe("demo-owner");
    expect(projection.entities?.[0]?.typeScheme).toEqual(entity.typeScheme as never);
    expect(projection.fieldFacetDirectives).toEqual([directive] as never);
    expect(Object.prototype.hasOwnProperty.call(projection, "functions")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(projection, "instances")).toBe(false);

    entity.id = "mutated-after-projection";
    directive.source.label = "Mutated";
    expect(projection.entities?.[0]?.id).toBe("Demo");
    expect((projection.fieldFacetDirectives?.[0]?.source as { label?: string }).label)
      .toBe("Value");
  });

  it("omits real std parameter facets from the entity-only constructor projection", () => {
    const sourceDirectives = stdModule.fieldFacetDirectives ?? [];
    const sourceBefore = JSON.stringify(sourceDirectives);
    expect(sourceDirectives.some((directive) =>
      "functionId" in directive.owner
      && directive.owner.functionId === "std:reverse"
      && directive.selector === "arr"
    )).toBe(true);
    const projection = exactRepositoryCompilerModuleEntityProjection(stdModule);
    expect(projection.fieldFacetDirectives).toEqual([]);
    expect(projection.entities?.map((entity) => entity.id))
      .toEqual(stdModule.entities?.map((entity) => entity.id));
    expect(JSON.stringify(stdModule.fieldFacetDirectives)).toBe(sourceBefore);
  });

  it("retains absent entity-owner facets so the original selector judgment still refuses them", () => {
    const directive = {
      owner: { module: "demo-owner", entityId: "AbsentType" },
      selector: "arr",
      source: { kind: "label", label: "Value" },
      provenance: { module: "demo-owner", declaration: "AbsentType", selector: "arr" },
    } as const;
    const projection = exactRepositoryCompilerModuleEntityProjection({
      name: "demo",
      entities: [],
      fieldFacetDirectives: [directive],
    });
    expect(projection.fieldFacetDirectives).toEqual([directive]);
    const verdict = tryProjectFieldFacets([], [], projection.fieldFacetDirectives ?? []);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error.$tag).toBe("MissingFieldFacetSelector");
      expect(verdict.error.owner).toEqual({ $tag: "TypeFieldOwner", module: { $tag: "Just", _0: "demo-owner" }, localId: "AbsentType" });
      expect(verdict.error.selector).toBe("arr");
    }
  });

  it("retains an entity arr selector and preserves the original ambiguous-selector refusal", () => {
    const directive = {
      owner: { module: "demo", entityId: "Demo" }, selector: "arr",
      source: { kind: "label", label: "Items" },
      provenance: { module: "demo", declaration: "Demo", selector: "arr" },
    } as const;
    const projection = exactRepositoryCompilerModuleEntityProjection({ name: "demo", entities: [], fieldFacetDirectives: [directive] });
    expect(projection.fieldFacetDirectives).toEqual([directive]);
    const owner = { $tag: "TypeFieldOwner", module: { $tag: "Just", _0: "demo" }, localId: "Demo" };
    // These are the exact occurrence fields consumed by the B3 projection;
    // two distinct named identities share the same admitted owner/path.
    const occurrences = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"].map(id => ({
      owner, path: [{ $tag: "FieldNamed", name: "arr" }],
      field: { key: { $tag: "NamedField", ref: { $ref: id } } },
    }));
    const verdict = tryProjectFieldFacets([], occurrences as never, projection.fieldFacetDirectives ?? []);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error.$tag).toBe("AmbiguousFieldFacetSelector");
      expect(verdict.error.selector).toBe("arr");
      expect(verdict.error.owner).toEqual(owner);
    }
  });

  it("rejects accessor-backed function-owner facets before source projection without invoking them", () => {
    let reads = 0;
    const owner = Object.defineProperty({}, "functionId", {
      enumerable: true,
      get() { reads += 1; return "demo:omitted-function"; },
    });
    const source = {
      name: "demo",
      entities: [],
      fieldFacetDirectives: [{
        owner, selector: "arr", source: { kind: "label", label: "Items" },
        provenance: { module: "demo", declaration: "omitted-function", selector: "arr" },
      }],
    };
    expect(() => exactRepositoryCompilerModuleEntityProjection(source as never))
      .toThrow("cannot be isolated");
    expect(reads).toBe(0);
  });

  it("keeps exact raw entity directives in order while omitting sparse and inherited array rows", () => {
    const directive = (entityId: string) => ({
      owner: { module: "demo", entityId }, selector: "value",
      source: { kind: "label" as const, label: entityId },
      provenance: { module: "demo", declaration: entityId, selector: "value" },
    });
    const first = directive("First");
    const last = directive("Last");
    // Warm the source harness before applying the bounded inherited-slot probe.
    expect(projectEntityFieldFacetDirectives([])).toEqual([]);
    const rows = new Array(5);
    rows[1] = first;
    rows[2] = {
      owner: { functionId: "demo:omitted-function" }, selector: "value",
      source: { kind: "label", label: "Function" },
      provenance: { module: "demo", declaration: "omitted-function", selector: "value" },
    };
    rows[4] = last;
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let selected;
    try {
      Object.defineProperty(Array.prototype, "0", {
        value: directive("Inherited"), configurable: true, writable: true,
      });
      selected = projectEntityFieldFacetDirectives(rows);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(Array.prototype, "0");
      else Object.defineProperty(Array.prototype, "0", previous);
    }
    expect(selected).toEqual([first, last]);
    expect(selected?.[0]).toBe(first);
    expect(selected?.[1]).toBe(last);
  });

  it("rejects an accessor-backed gateway array row without invoking it", () => {
    let reads = 0;
    const rows = Object.defineProperty(new Array(1), "0", {
      enumerable: true,
      get() { reads += 1; throw new Error("array row executed"); },
    });
    expect(() => projectEntityFieldFacetDirectives(rows))
      .toThrow("accessor property");
    expect(reads).toBe(0);
  });

  it("rejects accessor-backed entity inputs without invoking them", () => {
    let reads = 0;
    const source = Object.defineProperty({ name: "demo" }, "entities", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });
    expect(() => exactRepositoryCompilerModuleEntityProjection(source as never))
      .toThrow("demo entities must be an own data property");
    expect(reads).toBe(0);
  });

  it("preserves exact hostile own data and cycle topology in an isolated frozen graph", () => {
    const body = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(body, "__proto__", {
      value: { literal: "hostile-own-data" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(body, "hidden", {
      value: { semantic: 1 },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const source: {
      id: string;
      body: Record<string, unknown>;
      self?: unknown;
    } = { id: "demo:compiler-metadata", body };
    source.self = source;

    const snapshot = exactRepositoryCompilerMetadataSnapshot(source, "test source");
    expect(snapshot).not.toBe(source);
    expect(snapshot.body).not.toBe(body);
    expect(snapshot.self).toBe(snapshot);
    expect(Object.getPrototypeOf(snapshot.body)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(snapshot.body, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(snapshot.body, "hidden")?.enumerable).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.body)).toBe(true);

    (body.hidden as { semantic: number }).semantic = 2;
    expect((snapshot.body.hidden as { semantic: number }).semantic).toBe(1);
  });

  it("rejects accessor-bearing metadata without invoking it", () => {
    let reads = 0;
    const source = Object.defineProperty({ id: "demo:accessor" }, "body", {
      enumerable: true,
      get() {
        reads += 1;
        return { literal: reads };
      },
    });

    expect(() => exactRepositoryCompilerMetadataSnapshot(source, "accessor source"))
      .toThrow("repository compiler metadata: accessor source cannot be isolated");
    expect(reads).toBe(0);
  });

  it("captures module name, functions, and namespace policy once without invoking accessors", () => {
    // A container whose name is not its namespace (the `compileJs` shape).
    for (const key of ["name", "functions"] as const) {
      let reads = 0;
      const source = {
        name: "compileJs",
        functions: [compilerFunction("compile-js:emitJs", { literal: true })],
      };
      Object.defineProperty(source, key, {
        enumerable: true,
        get() {
          reads += 1;
          return key === "name" ? "compileJs" : source.functions;
        },
      });
      expect(() => exactRepositoryCompilerModuleFunctionProjection(source as never))
        .toThrow("must be an own data property");
      expect(reads).toBe(0);
    }

    const descriptorReads = new Map<PropertyKey, number>();
    const target = {
      name: "compileJs",
      functionNamespace: "compile-js",
      functions: [compilerFunction("compile-js:emitJs", { literal: true })],
    };
    const timeVarying = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (descriptor === undefined || key !== "functionNamespace") return descriptor;
        return {
          ...descriptor,
          value: descriptorReads.get(key) === 1 ? "compile-js" : "forged",
        };
      },
    });
    const projection = exactRepositoryCompilerModuleFunctionProjection(timeVarying);
    expect(projection.functionIds).toEqual(["compile-js:emitJs"]);
    expect(projection.namespacePolicy.namespaceFor("compile-js:emitJs")).toBe("compile-js");
    for (const key of [
      "name",
      "functions",
      "functionNamespace",
      "functionNamespaceOverrides",
    ]) {
      expect(descriptorReads.get(key)).toBe(1);
    }
  });

  it("rejects duplicate ids in the compiler source envelope", () => {
    expect(() => exactRepositoryCompilerModuleFunctionProjection({
      name: "demo",
      functions: [
        compilerFunction("demo:one", { literal: 1 }),
        compilerFunction("demo:one", { literal: 1 }),
      ],
    })).toThrow("function roster contains duplicate ids");
  });

  it("requires an exact defining-module prefix and a non-empty hostile-safe local name", () => {
    for (const fnId of [
      "demo:__proto__",
      "demo:constructor",
      "demo:toString",
      "demo:local:with:colons",
    ]) {
      expect(() => assertExactRepositoryFunctionOwner("demo", fnId)).not.toThrow();
    }
    expect(() => assertExactRepositoryFunctionOwner("demo", "other:one"))
      .toThrow("function other:one is not owned by defining module demo");
    expect(() => assertExactRepositoryFunctionOwner("demo", "demo:"))
      .toThrow("expected namespace demo:<non-empty local name>");
    expect(() => assertExactRepositoryFunctionOwner("demo", "demo"))
      .toThrow("expected namespace demo:<non-empty local name>");
  });

  it("accepts only an explicitly declared divergent namespace and rejects prefix forgeries", () => {
    expect(() =>
      assertExactRepositoryFunctionOwner(
        "compileJs",
        "compile-js:emitJs",
        "compile-js",
      )
    ).not.toThrow();
    expect(() =>
      assertExactRepositoryFunctionOwner(
        "compileJs",
        "forged:emitJs",
        "compile-js",
      )
    ).toThrow("expected namespace compile-js:<non-empty local name>");
    expect(() =>
      assertExactRepositoryFunctionOwner(
        "compileJs",
        "compile-js:emitJs",
        "compile-js:forged",
      )
    ).toThrow("expected namespace compile-js:forged:<non-empty local name>");
  });

  it("rejects inherited and accessor-backed functionNamespace metadata without invoking it", () => {
    let inheritedReads = 0;
    const prototype = Object.defineProperty({}, "functionNamespace", {
      enumerable: true,
      get() {
        inheritedReads += 1;
        return "forged";
      },
    });
    const inherited = Object.assign(Object.create(prototype), {
      name: "demo",
      label: "Inherited namespace",
    }) as FenelModule;
    expect(() => exactRepositoryFunctionNamespacePolicy(inherited, ["demo:one"]))
      .toThrow("module demo functionNamespace must not be inherited");
    expect(inheritedReads).toBe(0);

    let ownReads = 0;
    const accessor = namespaceModule("demo");
    Object.defineProperty(accessor, "functionNamespace", {
      enumerable: true,
      get() {
        ownReads += 1;
        return "demo";
      },
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(accessor, ["demo:one"]))
      .toThrow("module demo functionNamespace must be an own data property");
    expect(ownReads).toBe(0);
  });

  it("rejects non-array and accessor-backed namespace override envelopes", () => {
    const nonArray = namespaceModule("demo");
    Object.defineProperty(nonArray, "functionNamespaceOverrides", {
      enumerable: true,
      value: { functionId: "demo:one", namespace: "demo" },
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(nonArray, ["demo:one"]))
      .toThrow("functionNamespaceOverrides must be an array");

    let envelopeReads = 0;
    const accessorEnvelope = namespaceModule("demo");
    Object.defineProperty(accessorEnvelope, "functionNamespaceOverrides", {
      enumerable: true,
      get() {
        envelopeReads += 1;
        return [];
      },
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(accessorEnvelope, ["demo:one"]))
      .toThrow("functionNamespaceOverrides must be an own data property");
    expect(envelopeReads).toBe(0);

    let entryReads = 0;
    const entry = Object.defineProperty({ functionId: "demo:one" }, "namespace", {
      enumerable: true,
      get() {
        entryReads += 1;
        return "demo";
      },
    });
    const accessorEntry = namespaceModule("demo", {
      functionNamespaceOverrides: [entry as { functionId: string; namespace: string }],
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(accessorEntry, ["demo:one"]))
      .toThrow("function namespace overrides cannot be isolated");
    expect(entryReads).toBe(0);
  });

  it("rejects stale and duplicate exact namespace override targets", () => {
    const stale = namespaceModule("demo", {
      functionNamespaceOverrides: [{ functionId: "demo:missing", namespace: "demo" }],
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(stale, ["demo:present"]))
      .toThrow("namespace override targets absent function demo:missing");

    const duplicate = namespaceModule("demo", {
      functionNamespaceOverrides: [
        { functionId: "demo:present", namespace: "demo" },
        { functionId: "demo:present", namespace: "demo" },
      ],
    });
    expect(() => exactRepositoryFunctionNamespacePolicy(duplicate, ["demo:present"]))
      .toThrow("duplicate namespace overrides for demo:present");
  });

  it("rejects empty or colon-bearing default and override namespaces", () => {
    expect(() => exactRepositoryFunctionNamespacePolicy(
      namespaceModule("demo", { functionNamespace: "" }),
      ["demo:one"],
    )).toThrow("functionNamespace must be a non-empty colon-free string");
    expect(() => exactRepositoryFunctionNamespacePolicy(
      namespaceModule("demo", { functionNamespace: "demo:nested" }),
      ["demo:nested:one"],
    )).toThrow("functionNamespace must be a non-empty colon-free string");
    expect(() => exactRepositoryFunctionNamespacePolicy(
      namespaceModule("demo", {
        functionNamespaceOverrides: [{ functionId: "other:one", namespace: "" }],
      }),
      ["other:one"],
    )).toThrow("must carry non-empty functionId/namespace strings");
    expect(() => exactRepositoryFunctionNamespacePolicy(
      namespaceModule("demo", {
        functionNamespaceOverrides: [{ functionId: "other:nested:one", namespace: "other:nested" }],
      }),
      ["other:nested:one"],
    )).toThrow("expected namespace other:nested:<non-empty local name>");
  });

  it("resolves the explicit auth plus folded-subject multi-namespace policy", () => {
    const policy = exactRepositoryFunctionNamespacePolicy(
      namespaceModule("auth", {
        functionNamespaceOverrides: [
          { functionId: "subject:accountId", namespace: "subject" },
          { functionId: "subject:actorId", namespace: "subject" },
        ],
      }),
      ["auth:issueSession", "subject:accountId", "subject:actorId"],
    );
    expect(policy.moduleName).toBe("auth");
    expect(policy.namespaceFor("auth:issueSession")).toBe("auth");
    expect(policy.namespaceFor("subject:accountId")).toBe("subject");
    expect(policy.namespaceFor("subject:actorId")).toBe("subject");
    expect(policy.namespaceFor("subject:missing")).toBeUndefined();
  });

  it("rejects a repeated function id with a conflicting resolved namespace policy", () => {
    expect(() => assertExactRepositoryFunctionNamespaceAgreement(
      "compile-js:emitJs",
      "compileJs",
      "compile-js",
      "compileJs",
      "forged",
    )).toThrow("conflicting function namespaces compile-js/forged");
    expect(() => assertExactRepositoryFunctionNamespaceAgreement(
      "compile-js:emitJs",
      "compileJs",
      "compile-js",
      "other-container",
      "compile-js",
    )).toThrow("conflicting defining modules compileJs/other-container");
    expect(() => assertExactRepositoryFunctionNamespaceAgreement(
      "compile-js:emitJs",
      "compileJs",
      "compile-js",
      "compileJs",
      "compile-js",
    )).not.toThrow();
  });
});
