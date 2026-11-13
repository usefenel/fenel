import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../fenel-module";
import STORAGE_FENEL from "../../../../../fenel/modules/storage/types.fenel?raw";
import STORAGE_INSTANCES_FENEL from "../../../../../fenel/modules/storage/instances.fenel?raw";
import { storageModule } from "./storage";

const BACKENDS = ["db", "memory", "bundle"] as const;
const METHODS = [
  "store",
  "load",
  "update",
  "delete",
  "list",
  "appendEvent",
  "loadType",
  "loadTypeByName",
] as const;

const EXPECTED_IDS = BACKENDS.flatMap((backend) =>
  METHODS.map((method) =>
    `storage:${backend}${method[0]!.toUpperCase()}${method.slice(1)}`,
  ),
);

// modules-as-values Phase 2c: each method value is the qualified reference to
// its storage act (`storage.dbStore` names `storage:dbStore`).
const expectedMethods = (backend: (typeof BACKENDS)[number]) =>
  Object.fromEntries(
    METHODS.map((method) => [
      method,
      { $ref: `storage.${backend}${method[0]!.toUpperCase()}${method.slice(1)}` },
    ]),
  );

describe("storage declaration module", () => {
  test("types.fenel owns exactly the 24 required HasStateIO descriptors", () => {
    const loaded = loadFenelModule(STORAGE_FENEL, "storage");
    expect((loaded.functions ?? []).map((fn) => fn.id)).toEqual(EXPECTED_IDS);

    for (const fn of loaded.functions ?? []) {
      expect(fn.body, `${fn.id} must remain a foreign declaration`).toBeUndefined();
      expect(fn.requires).toEqual([
        {
          class: { $tag: "Id", entityId: "HasStateIO" },
          args: [{ $var: "scope" }],
        },
      ]);
    }
  });

  test("instances.fenel projects three global reference-only dictionaries", () => {
    const instances = loadFenelModule(STORAGE_INSTANCES_FENEL, "storage", {
      dispatchInstanceFile: true,
    }).instances ?? [];

    expect(instances).toEqual([
      {
        typeName: "StorageHandler",
        args: ["Db"],
        methods: expectedMethods("db"),
        scope: { kind: "global" },
      },
      {
        typeName: "StorageHandler",
        args: ["Memory"],
        methods: expectedMethods("memory"),
        scope: { kind: "global" },
      },
      {
        typeName: "StorageHandler",
        args: ["Bundle"],
        methods: expectedMethods("bundle"),
        scope: { kind: "global" },
      },
    ]);
  });

  test("the engine seam retains foreign descriptors, declared pure queries and instances", () => {
    expect((storageModule.functions ?? []).filter((fn) => fn.body === undefined).map((fn) => fn.id)).toEqual(EXPECTED_IDS);
    expect(storageModule.functions?.find((fn) => fn.id === "storage:jsonContains")?.body).toBeDefined();
    expect(storageModule.functionSignatureDeclarations?.map((declaration) => declaration.functionId))
      .toContain("storage:jsonContains");
    expect(storageModule.nativeImpls).toBeUndefined();

    const storageInstances = (storageModule.instances ?? []).filter(
      (instance) => instance.typeName === "StorageHandler",
    );
    expect(storageInstances.map((instance) => instance.args[0])).toEqual([
      "Db",
      "Memory",
      "Bundle",
    ]);
  });
});
