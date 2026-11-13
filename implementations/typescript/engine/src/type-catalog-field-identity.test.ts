import { describe, expect, test } from "bun:test";

import { dispatchedTraversalSemanticSlotsError } from "./engine-bodies-dispatch";
import { modulesFor } from "./module-manifest";
import {
  __catalogStructuralEqualForTests,
  getCatalog,
  getCatalogEntry,
  getIdentifiedEntityTypeByName,
  registerCatalogEntities,
  registerIdentifiedCatalogEntity,
} from "./type-catalog";
import type { FenelFunction, FenelType } from "./types";
import type { ModuleRegistry } from "./registry";

type SignatureRoot = {
  readonly fnId: string;
  readonly path: string;
  readonly type: FenelType;
};

function signatureRoots(fn: FenelFunction): SignatureRoot[] {
  return [
    ...fn.params.map((param, index) => ({
      fnId: fn.id,
      path: `params[${index}]`,
      type: param.type,
    })),
    { fnId: fn.id, path: "returns", type: fn.returns },
  ];
}

function invalidRoots(functions: readonly FenelFunction[]): Array<SignatureRoot & { error: string }> {
  const invalid: Array<SignatureRoot & { error: string }> = [];
  for (const fn of functions) {
    for (const root of signatureRoots(fn)) {
      const error = dispatchedTraversalSemanticSlotsError(root.type);
      if (error.$tag === "Just") invalid.push({ ...root, error: error._0 });
    }
  }
  return invalid;
}

describe("type catalog strict function identity source", () => {
  test("raw keyless signatures never become formatter or seeding payloads", () => {
    const sourceById = new Map<string, FenelFunction>();
    for (const module of modulesFor("seed")) {
      for (const fn of module.functions ?? []) {
        if (!sourceById.has(fn.id)) sourceById.set(fn.id, fn);
      }
    }
    const sourceFns = [...sourceById.values()];
    const rawInvalid = invalidRoots(sourceFns);

    // Repository census after the Phase-4b entry close: these are the exact
    // raw source roots that remain unsafe for the former eager display-catalog
    // path. Sanctioned keyless List carriers now receive their two semantic
    // axes from the generated repository lock at the traversal boundary, so
    // they no longer inflate this raw-source census. 62 roots contain missing
    // named/arrow FieldKeys; two are dependent `$el` payloads.
    expect(rawInvalid).toHaveLength(64);
    expect(rawInvalid.filter((root) => root.error.includes("field semantic slot")))
      .toHaveLength(62);
    expect(
      rawInvalid.some((root) =>
        root.fnId === "std:attr"
        && root.path === "returns"
        && root.error.includes("field semantic slot")),
    ).toBe(true);

    const functionSection = getCatalog().find((section) => section.id === "function");
    expect(functionSection).toBeDefined();
    const entries = functionSection!.entries;
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    expect(entries).toHaveLength(sourceFns.length);

    const catalogFns = entries.map((entry) => {
      if (entry.fn === undefined) throw new Error(`missing catalog function payload ${entry.id}`);
      const raw = sourceById.get(entry.id);
      if (raw === undefined) throw new Error(`catalog contains non-seed function ${entry.id}`);
      // The API seeder must never receive the raw module-owned graph.
      expect(entry.fn).not.toBe(raw);

      // Validate the top-level parameter field container independently of its
      // child types. This catches a registry that identified nested records but
      // accidentally left named function parameters keyless.
      const parameterSlotsOnly: FenelType = {
        $arrow: {
          params: entry.fn.params.map((param) => ({
            ...param,
            type: { $unit: true },
          })),
          returns: { $unit: true },
        },
      };
      expect(dispatchedTraversalSemanticSlotsError(parameterSlotsOnly)).toEqual({
        $tag: "Nothing",
      });
      return entry.fn;
    });

    // Every field-bearing catalog root is identity-total. The only remaining
    // generic-traversal abstentions are the two expression-valued `$el` roots,
    // which format directly as `$el` and never enter peelList/peelMaybe.
    const catalogInvalid = invalidRoots(catalogFns);
    expect(catalogInvalid.every((root) => !root.error.includes("field semantic slot"))).toBe(true);
    expect(
      catalogInvalid.map((root) => `${root.fnId}:${root.path}:${root.error}`).sort(),
    ).toEqual([
      "state:registerRepresentation:params[2]:invalid own-data type boundary",
      "state:tryCreateInstanceByName:params[1]:invalid own-data type boundary",
    ]);

    for (const fnId of new Set(rawInvalid.map((root) => root.fnId))) {
      expect(entryById.get(fnId)?.fn).not.toBe(sourceById.get(fnId));
    }

    const rawAttr = sourceById.get("std:attr")!;
    const rawValue = (rawAttr.returns as {
      $record: { fields: Array<{ name: string; key?: unknown }> };
    }).$record.fields.find((field) => field.name === "value")!;
    expect(rawValue.name).toBe("value");
    expect(rawValue.key).toBeUndefined();

    const identifiedAttr = entryById.get("std:attr")!.fn!;
    const identifiedValue = (identifiedAttr.returns as {
      $record: {
        fields: Array<{
          name: string;
          key?: { $tag: string; ref?: { $ref?: string } };
        }>;
      };
    }).$record.fields.find((field) => field.name === "value")!;
    expect(identifiedValue.name).toBe("value");
    expect(identifiedValue.key?.$tag).toBe("NamedField");
    expect(identifiedValue.key?.ref?.$ref).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }, 1_200_000);
});

describe("catalog projections for checked editor registries", () => {
  test("scopes function views and schemes without changing the repository catalog", () => {
    const repository = getCatalog();
    const functions = repository.find((section) => section.id === "function")!.entries;
    const entries = new Map(functions.map((entry) => [entry.id, entry]));
    const target = functions[0]!;
    let reads = 0;
    // These facades expose distinct views of the already checked functions.
    // An explicit scope must use BOTH its view and scheme, never fall back to
    // a process-global function when a scoped lookup is missing or mismatched.
    const scope = (marker: string): ModuleRegistry => ({
      getIdentifiedFunction: (id: string) => {
        reads++;
        const fn = entries.get(id)?.fn;
        return fn && { ...fn, body: { var: marker } };
      },
      getFunctionScheme: (id: string) => structuredClone(entries.get(id)?.scheme),
    }) as ModuleRegistry;
    const accountA = scope("account-a");
    const accountB = scope("account-b");
    const first = getCatalog(accountA);
    const builtReads = reads;
    expect(getCatalog(accountA)).toBe(first);
    expect(reads).toBe(builtReads);
    expect(getCatalogEntry(target.id, accountA)?.fn?.body).toEqual({ var: "account-a" });
    expect(getCatalogEntry(target.id, accountB)?.fn?.body).toEqual({ var: "account-b" });
    expect(getCatalogEntry(target.id, accountA)?.scheme).toEqual(target.scheme);
    expect(getCatalogEntry(target.id, accountA)?.scheme).not.toBe(target.scheme);
    expect(getCatalog()).toBe(repository);
    expect(getCatalogEntry(target.id)).toBe(target);

    const revisedA = scope("account-a-new-snapshot");
    expect(getCatalogEntry(target.id, revisedA)?.fn?.body).toEqual({ var: "account-a-new-snapshot" });
    expect(getCatalogEntry(target.id, accountB)?.fn?.body).toEqual({ var: "account-b" });

    registerCatalogEntities([{ id: "ScopedCatalogRefresh", type: { $unit: true } }]);
    expect(getCatalog(accountA)).not.toBe(first);
    expect(getCatalogEntry("entity:ScopedCatalogRefresh", accountA)).toBeDefined();
    expect(getCatalogEntry(target.id)?.fn?.body).toEqual(target.fn!.body);

    const incomplete = { ...accountA, getIdentifiedFunction: () => undefined } as ModuleRegistry;
    expect(() => getCatalog(incomplete)).toThrow("supplied registry has no exact identified function");
    const mismatched = { ...accountA, getIdentifiedFunction: () => ({ ...target.fn!, id: "wrong-function" }) } as ModuleRegistry;
    expect(() => getCatalog(mismatched)).toThrow("supplied registry has no exact identified function");
  }, 1_200_000);
});

describe("type catalog identified bare-name collision memory", () => {
  test("the structural comparator is cycle-safe and property-order independent", () => {
    const left: Record<string, unknown> = {};
    left.alpha = { value: 1 };
    left.self = left;
    const right: Record<string, unknown> = {};
    right.self = right;
    right.alpha = { value: 1 };
    const different: Record<string, unknown> = {};
    different.self = different;
    different.alpha = { value: 2 };

    expect(__catalogStructuralEqualForTests(left, right)).toBe(true);
    expect(__catalogStructuralEqualForTests(left, different)).toBe(false);
  });

  test("a declaration-complete collision survives later registrations", () => {
    const name = "Phase4bPersistentBareCollision";
    const first = { $unit: true } as FenelType;
    const second = { $void: true } as FenelType;

    registerCatalogEntities([{ id: name, module: "phase4b-a", type: first }]);
    registerIdentifiedCatalogEntity({ id: name, type: first });
    expect(getIdentifiedEntityTypeByName(name)).toBe(first);

    registerCatalogEntities([{ id: name, module: "phase4b-b", type: second }]);
    registerIdentifiedCatalogEntity({ id: name, type: second });
    expect(getIdentifiedEntityTypeByName(name)).toBeUndefined();

    // Registering another catalog row must not disturb the declaration-complete
    // collision set or reopen a first/last-wins window for this bare name.
    registerCatalogEntities([{
      id: "Phase4bCollisionCacheClearProbe",
      module: "phase4b-c",
      type: { $unit: true } as FenelType,
    }]);
    expect(getIdentifiedEntityTypeByName(name)).toBeUndefined();
  });

  test("an unrelated catalog registration preserves a non-system strict view", () => {
    const name = "Phase4bCustomStrictIdentifiedEntity";
    const identified = {
      $record: {
        fields: [{
          name: "value",
          key: {
            $tag: "NamedField",
            ref: { $ref: "3fe3272b-68ea-4b43-86f6-c887e2a53388" },
          },
          type: { $unit: true },
        }],
      },
    } as FenelType;

    registerCatalogEntities([{
      id: name,
      module: "phase4b-custom-strict",
      type: {
        $record: {
          fields: [{ name: "value", type: { $unit: true } }],
        },
      } as FenelType,
    }]);
    registerIdentifiedCatalogEntity({ id: name, type: identified });
    expect(getIdentifiedEntityTypeByName(name)).toBe(identified);

    // registerCatalogEntities used to clear every identified projection here,
    // forcing a non-system view through a system-registry PEEK that cannot
    // resolve it. Only the newly affected bare name may now be invalidated.
    registerCatalogEntities([{
      id: "Phase4bUnrelatedCatalogRegistration",
      module: "phase4b-unrelated",
      type: { $void: true } as FenelType,
    }]);
    expect(getIdentifiedEntityTypeByName(name)).toBe(identified);
  });
});
