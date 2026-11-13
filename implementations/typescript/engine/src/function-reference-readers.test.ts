// modules-as-values — readers of typeclass-instance method values accept a
// function REFERENCE (`{$ref: handle}`) wherever they accept the function's id
// string, and give it exactly the treatment that string gets. This file pins
// the shared own-data helper and the registry's `Class.method` capability
// lookup. The other readers are pinned beside their own suites:
// derive-applicative-traversable, totality-kernel-gate, evaluate-with,
// evaluator-dispatch, authoring/expression-authoring, validate, and
// compile-js-self-host-reference-dispatch.

import { describe, expect, test } from "bun:test";
import { createEngineBootstrapRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { functionRefHandle } from "./type-foundation";
import type { FenelFunction, FenelModule } from "./types";

describe("functionRefHandle — a function id string, or an own-data `{$ref}`", () => {
  test("a string is its own handle", () => {
    expect(functionRefHandle("std:add")).toBe("std:add");
    expect(functionRefHandle("")).toBe("");
  });

  test("an own `$ref` holding a non-empty string is the handle, whatever its form", () => {
    expect(functionRefHandle({ $ref: "std:add" })).toBe("std:add");
    expect(functionRefHandle({ $ref: "std.add" })).toBe("std.add");
    expect(functionRefHandle({ $ref: "0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" })).toBe(
      "0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    );
  });

  test("anything else is not a reference: no inherited `$ref`, no accessor is run", () => {
    let getterRan = false;
    const accessor = Object.defineProperty({}, "$ref", {
      get: () => {
        getterRan = true;
        return "std:add";
      },
      enumerable: true,
    });
    const values: unknown[] = [
      undefined, null, 7, true, [], ["std:add"], {}, { $ref: "" }, { $ref: 7 },
      { ref: "std:add" }, Object.create({ $ref: "std:add" }), accessor,
    ];
    for (const value of values) expect(functionRefHandle(value)).toBeUndefined();
    expect(getterRan).toBe(false);
  });
});

describe("registry — a `Class.method` capability whose provider method is a reference", () => {
  const greet: FenelFunction = {
    id: "refprobe:greet",
    params: [{
      name: "value",
      type: { $ref: "String" },
      label: { $tag: "Nothing" },
      ui: { $tag: "Nothing" },
      meta: {},
    }],
    returns: { $ref: "String" },
    body: { var: "value" },
  };
  const probeModule: FenelModule = {
    name: "refprobe",
    label: "Reference capability probe",
    entities: [],
    functions: [greet],
  };

  /** A registry whose one `RefProbeCapability` provider carries `greetValue`
   *  as its `greet` method. */
  function registryWith(greetValue: unknown) {
    const dispatchRegistry = createDispatchRegistry();
    dispatchRegistry.defineClass({
      name: "RefProbeCapability",
      params: [{ name: "provider" }],
      methods: [{ name: "greet", params: [], returns: { $ref: "String" } }],
    });
    dispatchRegistry.addInstance({
      typeName: "RefProbeCapability",
      args: ["primary"],
      methods: { greet: greetValue },
    });
    return createEngineBootstrapRegistry([probeModule], {
      dispatchRegistry,
      publishCatalogEntities: false,
    });
  }

  const lookup = (greetValue: unknown): string | undefined =>
    registryWith(greetValue).getFunction("RefProbeCapability.greet")?.id;

  test("the id string resolves (the baseline)", () => {
    expect(lookup("refprobe:greet")).toBe("refprobe:greet");
  });

  test("a reference by id resolves to the same function", () => {
    expect(lookup({ $ref: "refprobe:greet" })).toBe("refprobe:greet");
  });

  test("a dotted handle resolves exactly as the dotted string does", () => {
    expect(lookup({ $ref: "refprobe.greet" })).toBe(lookup("refprobe.greet"));
    expect(lookup({ $ref: "refprobe.greet" })).toBe("refprobe:greet");
  });

  test("an unresolvable reference resolves to nothing, like an unknown string", () => {
    expect(lookup("refprobe:missing")).toBeUndefined();
    expect(lookup({ $ref: "refprobe:missing" })).toBeUndefined();
  });

  test("a reference naming a capability method is not followed (no second capability hop)", () => {
    expect(lookup("RefProbeCapability.greet")).toBeUndefined();
    expect(lookup({ $ref: "RefProbeCapability.greet" })).toBeUndefined();
  });
});
