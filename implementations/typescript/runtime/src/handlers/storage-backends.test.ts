import { describe, expect, it } from "vitest";
import { dispatchRegistry, perform } from "@fenel/engine";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { codecModule } from "@fenel/engine/modules/codec";
import { storageModule } from "@fenel/engine/modules/storage";
import { functionRefHandle } from "@fenel/engine/type-foundation";
import { GLOBAL_ONLY } from "@fenel/engine";
import {
  activeStorageBackendTag,
  installDbBackend,
  installMemoryBackend,
  isReferenceType,
  performStorageMethod,
  storageDescriptor,
  storageRuntimeModule,
  withStorageBackend,
} from "./storage-backends";
import { storageActsByHandle } from "../authority-mint";

const reg = createRegistry([stdModule, codecModule, storageRuntimeModule]);
const ioContext = {
  accountId: "storage-seam-account",
  profileId: "storage-seam-profile",
  callFunction: async () => null,
  dispatchAction: async () => null,
};
const NOTHING = { $tag: "Nothing" } as const;

const STORAGE_METHODS = [
  "store",
  "load",
  "update",
  "delete",
  "list",
  "appendEvent",
  "loadType",
  "loadTypeByName",
] as const;

const DESCRIPTORS = {
  Db: {
    store: "storage:dbStore",
    load: "storage:dbLoad",
    update: "storage:dbUpdate",
    delete: "storage:dbDelete",
    list: "storage:dbList",
    appendEvent: "storage:dbAppendEvent",
    loadType: "storage:dbLoadType",
    loadTypeByName: "storage:dbLoadTypeByName",
  },
  Memory: {
    store: "storage:memoryStore",
    load: "storage:memoryLoad",
    update: "storage:memoryUpdate",
    delete: "storage:memoryDelete",
    list: "storage:memoryList",
    appendEvent: "storage:memoryAppendEvent",
    loadType: "storage:memoryLoadType",
    loadTypeByName: "storage:memoryLoadTypeByName",
  },
  Bundle: {
    store: "storage:bundleStore",
    load: "storage:bundleLoad",
    update: "storage:bundleUpdate",
    delete: "storage:bundleDelete",
    list: "storage:bundleList",
    appendEvent: "storage:bundleAppendEvent",
    loadType: "storage:bundleLoadType",
    loadTypeByName: "storage:bundleLoadTypeByName",
  },
} as const;

describe("StorageHandler descriptors", () => {
  it("keeps the declared method set", () => {
    const cls = dispatchRegistry.getClass("StorageHandler");
    expect(cls).toBeDefined();
    expect((cls?.methods ?? []).map((method) => method.name).sort()).toEqual(
      [...STORAGE_METHODS].sort(),
    );
  });

  it("resolves Db, Memory, and Bundle to data-only canonical descriptors", () => {
    for (const tag of ["Db", "Memory", "Bundle"] as const) {
      const methods = dispatchRegistry.resolve(tag, "StorageHandler", GLOBAL_ONLY);
      expect(methods, tag).toBeDefined();
      // modules-as-values Phase 2c: a value is the act's id string or a
      // function reference to it; either way the seam reads the id.
      expect(Object.keys(methods ?? {}).sort()).toEqual([...STORAGE_METHODS].sort());
      for (const value of Object.values(methods ?? {})) {
        expect(typeof value === "string" || functionRefHandle(value) !== undefined, `${tag} ${JSON.stringify(value)}`)
          .toBe(true);
      }
      expect(Object.fromEntries(
        STORAGE_METHODS.map((method) => [method, storageDescriptor(tag, method, GLOBAL_ONLY)]),
      )).toEqual(DESCRIPTORS[tag]);
      expect(Object.values(methods ?? {}).some((value) => typeof value === "function"))
        .toBe(false);
    }
  });

  it("keeps every protected storage implementation in the perform table only", () => {
    const frame = reg.evaluateContext();
    for (const descriptor of Object.values(DESCRIPTORS).flatMap((methods) =>
      Object.values(methods)
    )) {
      expect(frame.natives[descriptor], descriptor).toBeUndefined();
      expect(
        frame._nativePerformDescriptors?.plain[descriptor],
        descriptor,
      ).toBe(true);
    }
  });
});

// modules-as-values Phase 2c — a StorageHandler method value is the act's id
// string, or a function reference (`{$ref}`) to one of the storage module's own
// acts. The reference is read only through `storageActsByHandle` over the
// repository's `storageModule`, never through a registry, so every other handle
// throws before anything is performed.
describe("storageDescriptor — an id string, or a reference to a storage act", () => {
  const OWNER = "storage-descriptor-probe-account";
  const TAG = "StorageDescriptorProbe";
  const visibility = { kind: "frame", account: OWNER, tags: [] } as const;

  /** Selects `method` from a probe row OWNED by `OWNER`, so the row can be
   *  removed again (nobody owns a global row). `afterRegister` runs between the
   *  registration and the read. */
  function descriptorOf(
    methods: Record<string, unknown>,
    method: keyof typeof DESCRIPTORS.Db,
    afterRegister?: () => void,
  ): string {
    dispatchRegistry.addInstance({
      typeName: "StorageHandler",
      args: [TAG],
      methods,
      scope: { kind: "account", accountId: OWNER },
    } as never);
    try {
      afterRegister?.();
      return storageDescriptor(TAG, method, visibility);
    } finally {
      dispatchRegistry.removeInstance("StorageHandler", TAG, OWNER);
      expect(dispatchRegistry.resolve(TAG, "StorageHandler", visibility)).toBeUndefined();
    }
  }

  it("returns an id string as it stands, declared act or not", () => {
    expect(descriptorOf({ load: "storage:memoryLoad" }, "load")).toBe("storage:memoryLoad");
    // The rights R3a steering pins register strings that name no storage act;
    // the string path does not check them, and the gate judges the act on its
    // own name.
    expect(descriptorOf({ load: "r3a:probeStore" }, "load")).toBe("r3a:probeStore");
  });

  it("maps a qualified or colon reference to each of the 24 acts' ids", () => {
    for (const [backend, methods] of Object.entries(DESCRIPTORS)) {
      for (const [method, id] of Object.entries(methods)) {
        const member = id.slice("storage:".length);
        const name = method as keyof typeof DESCRIPTORS.Db;
        expect(descriptorOf({ [method]: { $ref: `storage.${member}` } }, name), `${backend}.${method}`)
          .toBe(id);
        expect(descriptorOf({ [method]: { $ref: id } }, name), `${backend}.${method}`).toBe(id);
      }
    }
  });

  it("refuses every other handle, including ones a registry would resolve", () => {
    const handles = [
      "memoryLoad", // the bare member (the codeName map would resolve it)
      "0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", // a UUID
      "evil.memoryLoad", // another module's member
      "probe:memoryLoad", // another module's id
      "storage.jsonContains", // a storage declaration that is not an act
      "storage:jsonContains",
      "storage.",
      "storage",
    ];
    for (const handle of handles) {
      expect(() => descriptorOf({ load: { $ref: handle } }, "load"), handle).toThrow(
        `StorageHandler ${TAG}.load references ${JSON.stringify(handle)}, `
        + "which is not one of the storage module's own acts",
      );
    }
  });

  it("reads only an own data `$ref`: no getter runs, no prototype is read", () => {
    const notData = `StorageHandler ${TAG}.load is not a data descriptor`;
    expect(() => descriptorOf({ load: Object.create({ $ref: "storage.memoryLoad" }) }, "load"))
      .toThrow(notData);
    for (const value of [{ $ref: "" }, { $ref: 7 }, [], ["storage:memoryLoad"], 7, null, {}]) {
      expect(() => descriptorOf({ load: value }, "load"), JSON.stringify(value)).toThrow(notData);
    }
    // The registry refuses an accessor at registration…
    let getterRan = false;
    const accessor = () => Object.defineProperty({}, "$ref", {
      get: () => {
        getterRan = true;
        return "storage.memoryLoad";
      },
      enumerable: true,
    });
    expect(() => descriptorOf({ load: accessor() }, "load")).toThrow(/accessor/);
    // …and one added after registration is still never run by the reader.
    const value: Record<string, unknown> = {};
    expect(() => descriptorOf({ load: value }, "load", () => {
      Object.defineProperty(value, "$ref", {
        get: () => {
          getterRan = true;
          return "storage.memoryLoad";
        },
        enumerable: true,
      });
    })).toThrow(notData);
    expect(getterRan).toBe(false);
  });

  it("takes each qualified handle from the loader's declaration name", () => {
    // `storageActsByHandle` derives the member from the id, because the
    // registry's module view has no `functionSignatureDeclarations`. This pins
    // that derivation to the loader's own declaration names.
    const acts = new Set(
      (storageModule.functions ?? [])
        .filter((fn) => (fn.requires ?? []).some(
          (constraint) => constraint.class.entityId === "HasStateIO",
        ))
        .map((fn) => fn.id),
    );
    expect(acts.size).toBe(24);
    expect(storageModule.name).toBe("storage");
    const expected: Array<[string, string]> = [];
    for (const declaration of storageModule.functionSignatureDeclarations ?? []) {
      if (!acts.has(declaration.functionId)) continue;
      expected.push([declaration.functionId, declaration.functionId]);
      expected.push([`storage.${declaration.declarationName}`, declaration.functionId]);
    }
    expect(expected).toHaveLength(48);
    expect([...storageActsByHandle(storageModule)].sort()).toEqual(expected.sort());
  });
});

describe("Memory StorageHandler through perform", () => {
  it("refuses duplicate ids across accounts and returns detached stored values", async () => {
    installMemoryBackend();
    const accountId = "memory-value-isolation";
    const id = crypto.randomUUID();
    const input = { nested: { n: 1 }, tags: ["a", "b"] };
    await performStorageMethod(reg, ioContext, "store", [accountId, "Widget", input, id]);
    input.nested.n = 99;
    const first = await performStorageMethod(reg, ioContext, "load", [accountId, id]);
    expect(first?.data).toEqual({ nested: { n: 1 }, tags: ["a", "b"] });
    (first!.data.nested as { n: number }).n = 100;
    expect((await performStorageMethod(reg, ioContext, "load", [accountId, id]))?.data.nested).toEqual({ n: 1 });
    await expect(performStorageMethod(reg, ioContext, "store", [accountId, "Other", {}, id])).rejects.toThrow("already exists");
    await expect(performStorageMethod(reg, ioContext, "store", ["other-account", "Other", {}, id])).rejects.toThrow("already exists");
    const update = { nested: { n: 2 } };
    const returned = await performStorageMethod(reg, ioContext, "update", [accountId, id, update]);
    update.nested.n = 3;
    (returned!.data.nested as { n: number }).n = 4;
    const listed = await performStorageMethod(reg, ioContext, "list", [accountId, "Widget"]);
    (listed[0]!.data.nested as { n: number }).n = 5;
    expect((await performStorageMethod(reg, ioContext, "load", [accountId, id]))?.data.nested).toEqual({ n: 2 });
    await performStorageMethod(reg, ioContext, "delete", [accountId, id]);
  }, 120_000);

  it("uses JSONB containment for arrays, nested objects, missing keys and scalars", async () => {
    installMemoryBackend();
    const accountId = "memory-jsonb-containment";
    const id = crypto.randomUUID();
    await performStorageMethod(reg, ioContext, "store", [accountId, "Widget", { tags: ["a", "b"], object: { a: null, b: 2 }, n: "1" }, id]);
    const count = async (where: Record<string, unknown>) => (await performStorageMethod(reg, ioContext, "list", [accountId, "Widget", undefined, where])).length;
    expect(await count({ tags: ["b"] })).toBe(1);
    expect(await count({ tags: ["b", "b"] })).toBe(1);
    expect(await count({ tags: "b" })).toBe(0);
    expect(await count({ tags: ["c"] })).toBe(0);
    expect(await count({ tags: [["b"]] })).toBe(0);
    expect(await count({ object: {} })).toBe(1);
    expect(await count({ object: { a: null } })).toBe(1);
    expect(await count({ object: { missing: null } })).toBe(0);
    expect(await count({ n: 1 })).toBe(0);
    await performStorageMethod(reg, ioContext, "delete", [accountId, id]);
  }, 120_000);

  it("speaks the canonical Maybe ABI declared by the public descriptors", async () => {
    installMemoryBackend();
    const accountId = "storage-seam-canonical-maybe";
    const firstId = "storage-canonical-row-1";
    const secondId = "storage-canonical-row-2";
    const frame = {
      ...reg.evaluateContext(),
      _ioHandlerContext: ioContext,
    };

    await perform(frame, {
      descriptor: "storage:memoryStore",
      args: [accountId, "Widget", { name: "canonical", n: 1 }, firstId],
    });
    await perform(frame, {
      descriptor: "storage:memoryStore",
      args: [accountId, "Widget", { name: "other", n: 2 }, secondId],
    });

    expect(await perform(frame, {
      descriptor: "storage:memoryLoad",
      args: [accountId, "missing-row"],
    })).toEqual(NOTHING);
    expect(await perform(frame, {
      descriptor: "storage:memoryLoad",
      args: [accountId, firstId],
    })).toMatchObject({ $tag: "Just", _0: { id: firstId } });

    const allRows = await perform(frame, {
      descriptor: "storage:memoryList",
      args: [accountId, "Widget", NOTHING, NOTHING],
    }) as Array<{ id: string }>;
    expect(allRows.map((row) => row.id).sort()).toEqual([firstId, secondId]);

    const limitedRows = await perform(frame, {
      descriptor: "storage:memoryList",
      args: [accountId, "Widget", { $tag: "Just", _0: 1 }, NOTHING],
    }) as Array<{ id: string }>;
    expect(limitedRows).toHaveLength(1);

    const filteredRows = await perform(frame, {
      descriptor: "storage:memoryList",
      args: [
        accountId,
        "Widget",
        NOTHING,
        { $tag: "Just", _0: { name: "canonical" } },
      ],
    }) as Array<{ id: string }>;
    expect(filteredRows.map((row) => row.id)).toEqual([firstId]);

    expect(await perform(frame, {
      descriptor: "storage:memoryUpdate",
      args: [accountId, "missing-row", {}],
    })).toEqual(NOTHING);
    expect(await perform(frame, {
      descriptor: "storage:memoryLoadTypeByName",
      args: [accountId, "GeoLevel"],
    })).toMatchObject({ $tag: "Just", _0: { name: "GeoLevel" } });
    expect(await perform(frame, {
      descriptor: "storage:memoryAppendEvent",
      args: [{
        accountId,
        type: "canonical_event",
        payload: NOTHING,
        aggregateType: NOTHING,
        aggregateId: NOTHING,
        profileId: NOTHING,
      }],
    })).toBeUndefined();
  });

  it("store -> load -> update -> list -> appendEvent -> delete", async () => {
    installMemoryBackend();
    const accountId = "storage-seam-memory-round-trip";
    const firstId = "storage-row-1";
    const secondId = "storage-row-2";

    expect(await performStorageMethod(
      reg,
      ioContext,
      "store",
      [accountId, "Widget", { name: "alpha", n: 1 }, firstId],
    )).toEqual({ id: firstId });

    const loaded = await performStorageMethod(
      reg,
      ioContext,
      "load",
      [accountId, firstId],
    );
    expect(loaded?.data).toEqual({ name: "alpha", n: 1 });
    expect(await performStorageMethod(
      reg,
      ioContext,
      "load",
      ["storage-seam-other-account", firstId],
    )).toBeNull();

    const updated = await performStorageMethod(
      reg,
      ioContext,
      "update",
      [accountId, firstId, { name: "beta", n: 2 }],
    );
    expect(updated?.data).toEqual({ name: "beta", n: 2 });

    await performStorageMethod(
      reg,
      ioContext,
      "store",
      [accountId, "Widget", { name: "gamma", n: 2 }, secondId],
    );
    await performStorageMethod(
      reg,
      ioContext,
      "store",
      [accountId, "Other", { name: "delta", n: 2 }, "storage-other-row"],
    );

    const widgets = await performStorageMethod(
      reg,
      ioContext,
      "list",
      [accountId, "Widget"],
    );
    expect(widgets.map((row) => row.id).sort()).toEqual([firstId, secondId]);

    const filtered = await performStorageMethod(
      reg,
      ioContext,
      "list",
      [accountId, "Widget", undefined, { name: "gamma" }],
    );
    expect(filtered.map((row) => row.id)).toEqual([secondId]);
    const bothN2 = await performStorageMethod(
      reg,
      ioContext,
      "list",
      [accountId, "Widget", undefined, { n: 2 }],
    );
    expect(bothN2.map((row) => row.id).sort()).toEqual([firstId, secondId]);

    await expect(performStorageMethod(
      reg,
      ioContext,
      "appendEvent",
      [{ accountId, type: "widget_created", payload: { id: secondId } }],
    )).resolves.toBeUndefined();

    await performStorageMethod(reg, ioContext, "delete", [accountId, firstId]);
    await expect(
      performStorageMethod(reg, ioContext, "delete", [accountId, firstId]),
    ).resolves.toBeUndefined();
    expect(await performStorageMethod(
      reg,
      ioContext,
      "load",
      [accountId, firstId],
    )).toBeNull();
  });
});

describe("storage selection", () => {
  it("is Memory-first, supports Db boot install, and restores scoped swaps", async () => {
    installMemoryBackend();
    expect(activeStorageBackendTag()).toBe("Memory");
    installDbBackend();
    expect(activeStorageBackendTag()).toBe("Db");
    installMemoryBackend();

    await withStorageBackend("Db", async () => {
      expect(activeStorageBackendTag()).toBe("Db");
    });
    expect(activeStorageBackendTag()).toBe("Memory");
  });

  it("recognizes loader-derived reference types", () => {
    expect(isReferenceType("Currency")).toBe(true);
    expect(isReferenceType("Country")).toBe(true);
    expect(isReferenceType("Widget")).toBe(false);
    expect(isReferenceType("profile")).toBe(false);
  });
});

describe("Bundle StorageHandler through perform", () => {
  it("serves the bundled reference register", async () => {
    const rows = await performStorageMethod(
      reg,
      ioContext,
      "list",
      ["storage-seam-account", "Currency"],
      { typeName: "Currency" },
    );
    const direct = dispatchRegistry
      .listInstances("Currency")
      .map((instance) => instance.methods as Record<string, unknown>);
    expect(rows.map((row) => row.data)).toEqual(direct);
    const usd = rows.find((row) => row.data.code === "USD");
    expect(usd?.id).toBe("USD");
    expect(usd?.entityType).toBe("Currency");
  });

  it("rejects writes", async () => {
    await expect(performStorageMethod(
      reg,
      ioContext,
      "store",
      ["storage-seam-account", "Currency", {}, "USD"],
      { typeName: "Currency" },
    )).rejects.toThrow("read-only");
  });
});
