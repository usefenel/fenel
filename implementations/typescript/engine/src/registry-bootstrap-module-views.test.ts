import { describe, expect, test } from "bun:test";

import { createEngineBootstrapRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import type { FenelModule } from "./types";

// Harness slice 2b: an engine bootstrap registry builds its public module
// roster on first read (no engine path reads it), while a reader still gets
// one stable, frozen roster with the same content as one read at once.
const nothing = { $tag: "Nothing" } as const;

function bootstrapModules(): FenelModule[] {
  return [{
    name: "bootstrap-views",
    label: "Bootstrap views",
    entities: [],
    functions: [{
      id: "bootstrap-views:identity",
      params: [{ name: "value", type: { $ref: "String" }, label: nothing, ui: nothing, meta: {} }],
      returns: { $ref: "String" },
      body: { var: "value" },
    }, {
      id: "bootstrap-views:twice",
      params: [{ name: "value", type: { $ref: "String" }, label: nothing, ui: nothing, meta: {} }],
      returns: { $ref: "String" },
      body: { call: ["bootstrap-views:identity", { call: ["bootstrap-views:identity", { var: "value" }] }] },
    }],
  }];
}

function build() {
  return createEngineBootstrapRegistry(bootstrapModules(), {
    dispatchRegistry: createDispatchRegistry(),
    publishCatalogEntities: false,
  });
}

describe("engine bootstrap module views", () => {
  test("the roster is not built by the bootstrap factory: `modules` is an on-first-read own getter", () => {
    const registry = build();
    const slot = Object.getOwnPropertyDescriptor(registry, "modules");
    expect(slot).toBeDefined();
    expect(typeof slot!.get).toBe("function");
    expect("value" in slot!).toBe(false);
    expect(slot!.enumerable).toBe(true);
    expect(Object.keys(registry)).toContain("modules");
  });

  test("a reader gets one stable, frozen roster equal to one read before any other use", () => {
    const early = build();
    const earlyModules = early.modules;
    const late = build();
    late.evaluateContext();
    late.listFunctions();
    late.getFunction("bootstrap-views:twice");
    const lateModules = late.modules;

    expect(late.modules).toBe(lateModules);
    expect(early.modules).toBe(earlyModules);
    expect(Object.isFrozen(lateModules)).toBe(true);
    expect(Object.isFrozen(lateModules[0])).toBe(true);
    expect(Object.isFrozen(lateModules[0]!.functions)).toBe(true);
    expect(lateModules).toEqual(earlyModules);
    expect(lateModules.map((mod) => mod.name)).toEqual(["authority", "bootstrap-views"]);
    const own = lateModules[1]!;
    expect(Object.keys(own)).toEqual(["entities", "label", "name", "functions"]);
    expect(own.functions!.map((fn) => fn.id)).toEqual(["bootstrap-views:identity", "bootstrap-views:twice"]);
    expect(own.functions![0]).toBe(late.getFunction("bootstrap-views:identity")!);
  });
});
