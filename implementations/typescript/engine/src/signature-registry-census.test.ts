import { describe, expect, test } from "bun:test";

import { createDispatchRegistry } from "./dispatch-registry";
import { modulesFor } from "./module-manifest";
import { createRepositoryRegistry } from "./repository-registry";
import type { FenelFunction, TypeScheme } from "./types";

function expectNoSolverMeta(value: unknown, context: string): void {
  const serialized = JSON.stringify(value);
  expect(serialized, `${context}: internal inference constructor escaped`).not.toContain("ItMeta");
  expect(serialized, `${context}: fresh solver id escaped`).not.toContain("?m:");
}

function expectUniqueSchemeBinders(scheme: TypeScheme, context: string): void {
  const ids = scheme.quantified.map(({ id }) => id);
  const sourceNames = scheme.quantified.map(({ sourceName }) => sourceName);
  expect(new Set(ids).size, `${context}: duplicate quantified id`).toBe(ids.length);
  expect(new Set(sourceNames).size, `${context}: duplicate quantified source name`).toBe(
    sourceNames.length,
  );
}

function expectedCompatibilityArrow(
  fn: {
    readonly params: ReadonlyArray<FenelFunction["params"][number]>;
    readonly returns: FenelFunction["returns"];
  },
): TypeScheme["body"] {
  return { $arrow: { params: [...fn.params], returns: fn.returns } };
}

describe("authoritative repository signature census", () => {
  test("every default product-registry face exposes one frozen, meta-free effective scheme", () => {
    const registry = createRepositoryRegistry(modulesFor("seed"), {
      dispatchRegistry: createDispatchRegistry(),
    });
    const functions = registry.listFunctions();
    const functionSet = new Set(functions);

    expect(functions.length).toBeGreaterThan(0);
    expect(new Set(functions.map(({ id }) => id)).size).toBe(functions.length);
    expect(registry.listFunctions()).not.toBe(functions);
    expect(registry.listFunctions()).toEqual(functions);

    for (const fn of functions) {
      const context = `function ${fn.id}`;
      const info = registry.getFunctionSignatureInfo(fn.id);
      expect(info, `${context}: missing FunctionSignatureInfo`).toBeDefined();
      if (info === undefined) continue;

      expect(registry.getFunction(fn.id), `${context}: id lookup diverged`).toBe(fn);
      expect(registry.getIdentifiedFunction(fn.id), `${context}: identified lookup diverged`).toBe(
        fn,
      );
      expect(registry.getFunctionScheme(fn.id), `${context}: scheme lookup diverged`).toBe(
        info.scheme,
      );
      expect(info.functionId).toBe(fn.id);
      expect(info.params).toHaveLength(fn.params.length);
      const paramTags: string[] = info.params.map((slot) => slot.$tag);
      const returnTag: string = info.returns.$tag;
      expect(paramTags, `${context}: Absent param`).not.toContain("Absent");
      expect(returnTag, `${context}: Absent return`).not.toBe("Absent");
      expect(info.scheme.body, `${context}: compatibility arrow diverged`).toEqual(
        expectedCompatibilityArrow(fn),
      );
      expectUniqueSchemeBinders(info.scheme, context);
      expectNoSolverMeta(fn, `${context} effective function`);
      expectNoSolverMeta(info.scheme, `${context} scheme`);

      expect(Object.isFrozen(fn), `${context}: function is mutable`).toBe(true);
      expect(Object.isFrozen(fn.params), `${context}: params are mutable`).toBe(true);
      expect(fn.params.every(Object.isFrozen), `${context}: param is mutable`).toBe(true);
      expect(Object.isFrozen(fn.returns), `${context}: return is mutable`).toBe(true);
      expect(Object.isFrozen(info), `${context}: signature info is mutable`).toBe(true);
      expect(Object.isFrozen(info.params), `${context}: declaration slots are mutable`).toBe(true);
      expect(info.params.every(Object.isFrozen), `${context}: declaration slot is mutable`).toBe(
        true,
      );
      expect(Object.isFrozen(info.returns), `${context}: return declaration is mutable`).toBe(
        true,
      );
      expect(Object.isFrozen(info.scheme), `${context}: scheme is mutable`).toBe(true);
      expect(Object.isFrozen(info.scheme.quantified), `${context}: binders are mutable`).toBe(true);
      expect(registry.getRawFunctionForDebug(fn.id), `${context}: raw source missing`).not.toBe(fn);
    }

    const moduleFunctions = registry.modules.flatMap((module) => module.functions ?? []);
    expect(new Set(moduleFunctions).size).toBe(functions.length);
    expect(registry.modules.every(Object.isFrozen), "module projection is mutable").toBe(true);
    expect(
      registry.modules.every((module) => Object.isFrozen(module.functions)),
      "module function projection is mutable",
    ).toBe(true);
    for (const fn of moduleFunctions) {
      expect(functionSet.has(fn), `module face leaked a non-effective ${fn.id}`).toBe(true);
      expect(registry.getFunction(fn.id), `module face diverged for ${fn.id}`).toBe(fn);
    }

    const options = registry.functionOptions();
    expect(options).toHaveLength(functions.length);
    for (const option of options) {
      // `functionOptions.value` prefers a Codeable projection but deliberately
      // falls back to the exact id when a function has no Codeable instance.
      // Resolve through the public union lookup; widening the code-name-only
      // face to accept ids would collapse those two identity namespaces.
      const selected = registry.getFunction(option.value);
      expect(selected, `function option ${option.value} did not resolve`).toBeDefined();
      if (selected === undefined) continue;
      expect(functionSet.has(selected), `function option ${option.value} leaked a non-effective view`).toBe(
        true,
      );
      expect(registry.getIdentifiedFunction(option.value)).toBe(selected);
      expect(registry.getFunctionScheme(option.value)).toBe(
        registry.getFunctionSignatureInfo(selected.id)?.scheme,
      );
    }

    const constructors = registry.listConstructorSignatures();
    expect(constructors.length).toBeGreaterThan(0);
    expect(Object.isFrozen(constructors), "constructor catalog is mutable").toBe(true);
    expect(new Set(constructors.map(({ targetId }) => targetId)).size).toBe(constructors.length);
    expect(constructors.some(({ outcome }) => outcome.$tag === "Solved")).toBe(true);
    for (const constructor of constructors) {
      const context = `constructor ${constructor.targetId}`;
      expect(Object.isFrozen(constructor), `${context}: row is mutable`).toBe(true);
      expect(Object.isFrozen(constructor.params), `${context}: params are mutable`).toBe(true);
      if (constructor.outcome.$tag === "Solved") {
        expect(constructor.scheme, `${context}: solved row has no scheme`).toBeDefined();
        if (constructor.scheme === undefined) continue;
        expect(constructor.scheme.body).toEqual(expectedCompatibilityArrow(constructor));
        expectUniqueSchemeBinders(constructor.scheme, context);
        expectNoSolverMeta(constructor.scheme, `${context} scheme`);
        expect(Object.isFrozen(constructor.scheme), `${context}: scheme is mutable`).toBe(true);
      } else {
        expect(constructor.scheme, `${context}: fenced row exposed a scheme`).toBeUndefined();
        expect(constructor.outcome.diagnostics.length, `${context}: fence has no diagnostic`)
          .toBeGreaterThan(0);
      }
    }
  }, 1_800_000);
});
