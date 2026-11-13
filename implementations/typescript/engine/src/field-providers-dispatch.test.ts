import { afterEach, describe, expect, test } from "bun:test";
import {
  dispatchedGetBinding,
  dispatchedGetProvider,
  dispatchedHasBinding,
  dispatchedListBindings,
  dispatchedRegisterBinding,
  dispatchedRegisterBindings,
  dispatchedRegisterProvider,
  dispatchedResolveEntity,
  dispatchedResolveField,
  dispatchedResolveFieldBatch,
  dispatchedUnregisterBinding,
  dispatchedUnregisterProvider,
  dispatchedVirtualFieldsFor,
} from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";
import type {
  FieldBinding,
  FieldProvider,
  FieldRef,
  ProviderFieldTarget,
  ProviderScope,
} from "./types";

const GEOMETRY: FieldRef = { $ref: "00000000-0000-4000-8000-000000000201" };
const FLAG: FieldRef = { $ref: "00000000-0000-4000-8000-000000000202" };
const CODE: FieldRef = { $ref: "00000000-0000-4000-8000-000000000203" };

const repositoryScope: ProviderScope = {
  $tag: "RepositoryProviderScope",
  registryId: "provider-test-repository",
};
const accountAScope: ProviderScope = {
  $tag: "AccountProviderScope",
  accountId: "account-a",
  registryId: "registry-a",
};
const accountBScope: ProviderScope = {
  $tag: "AccountProviderScope",
  accountId: "account-b",
  registryId: "registry-b",
};

const target = (
  scope: ProviderScope,
  field: FieldRef = GEOMETRY,
  owner = "CountryTest",
): ProviderFieldTarget => ({ scope, owner, field });

const geoProvider: FieldProvider = {
  name: "geo-test",
  get: async (key) => `geom:${key}`,
  getBatch: async (keys) => Object.fromEntries(keys.map((key) => [key, `batch:${key}`])),
};
const binding = (
  scope: ProviderScope,
  field: FieldRef = GEOMETRY,
  provider = "geo-test",
  owner = "CountryTest",
): FieldBinding => ({
  target: target(scope, field, owner),
  provider,
  keyField: CODE,
});

for (const scope of [repositoryScope, accountAScope, accountBScope]) {
  afterEach(() => {
    dispatchedUnregisterProvider(scope, "geo-test");
    dispatchedUnregisterProvider(scope, "geo-alt");
    dispatchedUnregisterProvider(scope, "batch-adversarial");
    dispatchedUnregisterProvider(scope, "scalar-adversarial");
    dispatchedUnregisterBinding(target(scope, GEOMETRY));
    dispatchedUnregisterBinding(target(scope, FLAG));
    dispatchedUnregisterBinding(target(scope, GEOMETRY, "OtherCountry"));
  });
}

describe("field provider structural registry", () => {
  test("engine remains native-free and keeps the public registry functions", () => {
    expect(Object.keys(engineModule.nativeImplsCtx ?? {})).toHaveLength(0);
    const ids = new Set((engineModule.functions ?? []).map((fn) => fn.id));
    for (const name of [
      "registerProvider", "unregisterProvider", "getProvider",
      "registerBinding", "registerBindings", "unregisterBinding",
      "getBinding", "listBindings", "hasBinding",
      "clearSessionCache", "clearAllCaches",
    ]) expect(ids.has(`engine:${name}`)).toBe(true);
  });

  test("provider registration is explicitly scoped and duplicate-stable", () => {
    expect(dispatchedGetProvider(repositoryScope, "geo-test").$tag).toBe("ProviderMissing");
    expect(dispatchedRegisterProvider(repositoryScope, geoProvider).$tag).toBe("ProviderRegistered");
    expect(dispatchedRegisterProvider(repositoryScope, geoProvider).$tag).toBe("ProviderDuplicate");
    expect(dispatchedGetProvider(repositoryScope, "geo-test").$tag).toBe("ProviderFound");
    expect(dispatchedGetProvider(accountAScope, "geo-test").$tag).toBe("ProviderMissing");
  });

  test("registration identity reads require own data and keep accessors inert", () => {
    let nameGetterReads = 0;
    const inheritedName = Object.create({ name: "geo-test" }) as FieldProvider;
    Object.defineProperty(inheritedName, "get", {
      value: async () => "must-not-register",
      enumerable: true,
    });
    expect(dispatchedRegisterProvider(repositoryScope, inheritedName).$tag)
      .toBe("ProviderInvalid");

    const accessorName = Object.create(null) as FieldProvider;
    Object.defineProperty(accessorName, "name", {
      enumerable: true,
      get() {
        nameGetterReads += 1;
        throw new Error("provider name accessor must stay inert");
      },
    });
    Object.defineProperty(accessorName, "get", {
      value: async () => "must-not-register",
      enumerable: true,
    });
    expect(dispatchedRegisterProvider(repositoryScope, accessorName).$tag)
      .toBe("ProviderInvalid");
    expect(nameGetterReads).toBe(0);

    let scopeTagGetterReads = 0;
    const accessorScope = Object.create(null) as ProviderScope;
    Object.defineProperty(accessorScope, "$tag", {
      enumerable: true,
      get() {
        scopeTagGetterReads += 1;
        throw new Error("provider scope tag accessor must stay inert");
      },
    });
    expect(dispatchedRegisterProvider(accessorScope, geoProvider).$tag)
      .toBe("ProviderInvalid");
    expect(scopeTagGetterReads).toBe(0);

    let targetGetterReads = 0;
    const accessorBinding = {
      provider: "geo-test",
      keyField: CODE,
    } as FieldBinding;
    Object.defineProperty(accessorBinding, "target", {
      enumerable: true,
      get() {
        targetGetterReads += 1;
        throw new Error("provider target accessor must stay inert");
      },
    });
    expect(dispatchedRegisterBinding(accessorBinding).$tag)
      .toBe("ProviderInvalid");
    expect(targetGetterReads).toBe(0);
  });

  test("binding identity is FieldRef; duplicate and conflict are structured", () => {
    const first = dispatchedRegisterBinding(binding(repositoryScope));
    expect(first.$tag).toBe("ProviderRegistered");
    expect(dispatchedRegisterBinding(binding(repositoryScope)).$tag).toBe("ProviderDuplicate");
    expect(dispatchedRegisterBinding({
      ...binding(repositoryScope),
      provider: "geo-alt",
    }).$tag).toBe("ProviderConflict");
    expect(dispatchedGetBinding(target(repositoryScope)).$tag).toBe("ProviderFound");
    expect(dispatchedHasBinding(target(repositoryScope))).toBe(true);
    expect(dispatchedVirtualFieldsFor(repositoryScope, "CountryTest")).toEqual([GEOMETRY]);
  });

  test("bulk registration and account enumeration cannot cross scope", () => {
    expect(dispatchedRegisterBindings([
      binding(accountAScope, GEOMETRY),
      binding(accountAScope, FLAG),
      binding(accountBScope, GEOMETRY),
    ]).map((row) => row.$tag)).toEqual([
      "ProviderRegistered", "ProviderRegistered", "ProviderRegistered",
    ]);
    expect(dispatchedListBindings(accountAScope)
      .map((row) => row.target.field.$ref)
      .sort()).toEqual([GEOMETRY.$ref, FLAG.$ref].sort());
    expect(dispatchedListBindings(accountBScope).map((row) => row.target.field)).toEqual([
      GEOMETRY,
    ]);
    expect(dispatchedListBindings(repositoryScope)).toEqual([]);
  });
});

describe("field provider async IO leaf", () => {
  test("scalar and batch resolution select by structural target", async () => {
    dispatchedRegisterProvider(repositoryScope, geoProvider);
    dispatchedRegisterBinding(binding(repositoryScope));
    expect(await dispatchedResolveField(target(repositoryScope), "FR")).toBe("geom:FR");
    expect(await dispatchedResolveFieldBatch(target(repositoryScope), ["FR", "DE"]))
      .toEqual({ FR: "batch:FR", DE: "batch:DE" });
    expect(await dispatchedResolveField(target(repositoryScope, FLAG), "FR")).toBeUndefined();
  });

  test("scalar and batch resolution preserve prototype-hostile entity keys", async () => {
    dispatchedRegisterProvider(repositoryScope, geoProvider);
    dispatchedRegisterBinding(binding(repositoryScope));

    expect(await dispatchedResolveField(target(repositoryScope), "__proto__"))
      .toBe("geom:__proto__");
    const batch = await dispatchedResolveFieldBatch(
      target(repositoryScope),
      ["__proto__", "constructor"],
    );
    expect(Object.getPrototypeOf(batch)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(batch, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(batch, "constructor")).toBe(true);
    expect(batch["__proto__"]).toBe("batch:__proto__");
    expect(Reflect.get(batch, "constructor")).toBe("batch:constructor");

    const missing = await dispatchedResolveFieldBatch(
      target(repositoryScope, FLAG),
      ["__proto__"],
    );
    expect(Object.getPrototypeOf(missing)).toBeNull();
    expect(Object.keys(missing)).toEqual([]);
  });

  test("batch planning deduplicates requests and Fenel filters extra, missing, and undefined rows", async () => {
    let requested: string[] = [];
    const adversarial: FieldProvider = {
      name: "batch-adversarial",
      get: async (key) => `scalar:${key}`,
      getBatch: async (keys) => {
        requested = keys;
        return {
          FR: "batch:FR",
          DE: undefined,
          EXTRA: "must-not-leak",
        };
      },
    };
    dispatchedRegisterProvider(repositoryScope, adversarial);
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "batch-adversarial",
    ));

    expect(await dispatchedResolveFieldBatch(
      target(repositoryScope),
      ["FR", "DE", "MISSING", "FR"],
    )).toEqual({ FR: "batch:FR" });
    expect(requested).toEqual(["FR", "DE", "MISSING"]);
  });

  test("optional getBatch accessors stay inert and Fenel selects the scalar fallback", async () => {
    let batchGetterReads = 0;
    const requested: string[] = [];
    const accessorProvider: FieldProvider & { prefix: string } = {
      name: "scalar-adversarial",
      prefix: "safe",
      async get(key) {
        requested.push(key);
        return `${this.prefix}:${key}`;
      },
    };
    Object.defineProperty(accessorProvider, "getBatch", {
      enumerable: true,
      get() {
        batchGetterReads += 1;
        throw new Error("getBatch accessor must stay inert");
      },
    });
    dispatchedRegisterProvider(repositoryScope, accessorProvider);
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "scalar-adversarial",
    ));
    const stored = dispatchedGetProvider(repositoryScope, "scalar-adversarial");
    expect(stored.$tag).toBe("ProviderFound");
    if (stored.$tag === "ProviderFound") {
      expect(Object.getPrototypeOf(stored.value)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(stored.value, "getBatch")).toBe(false);
    }
    expect(batchGetterReads).toBe(0);

    expect(await dispatchedResolveFieldBatch(
      target(repositoryScope),
      ["FR", "DE"],
    )).toEqual({ FR: "safe:FR", DE: "safe:DE" });
    expect(requested.sort()).toEqual(["DE", "FR"]);
    expect(batchGetterReads).toBe(0);
  });

  test("non-enumerable own provider capabilities and receiver state survive registration", async () => {
    const provider = Object.create(null) as FieldProvider & { prefix: string };
    Object.defineProperty(provider, "name", {
      value: "scalar-adversarial",
      enumerable: true,
    });
    Object.defineProperty(provider, "prefix", {
      value: "non-enumerable",
      enumerable: false,
    });
    Object.defineProperty(provider, "get", {
      value: async function (this: { prefix: string }, key: string) {
        return `${this.prefix}:${key}`;
      },
      enumerable: false,
    });
    expect(dispatchedRegisterProvider(repositoryScope, provider).$tag)
      .toBe("ProviderRegistered");
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "scalar-adversarial",
    ));

    const stored = dispatchedGetProvider(repositoryScope, "scalar-adversarial");
    expect(stored.$tag).toBe("ProviderFound");
    if (stored.$tag === "ProviderFound") {
      expect(Object.prototype.hasOwnProperty.call(stored.value, "get")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(stored.value, "prefix")).toBe(true);
    }
    expect(await dispatchedResolveField(target(repositoryScope), "FR"))
      .toBe("non-enumerable:FR");
  });

  test("batch results preserve hostile own data keys and ignore own accessors", async () => {
    let valueGetterReads = 0;
    dispatchedRegisterProvider(repositoryScope, {
      name: "batch-adversarial",
      get: async (key) => `scalar:${key}`,
      getBatch: async () => {
        const result: Record<string, unknown> = Object.create(null);
        Object.defineProperty(result, "__proto__", {
          value: "proto-data",
          enumerable: true,
        });
        Object.defineProperty(result, "constructor", {
          value: "constructor-data",
          enumerable: true,
        });
        Object.defineProperty(result, "FR", {
          enumerable: true,
          get() {
            valueGetterReads += 1;
            throw new Error("batch value accessor must stay inert");
          },
        });
        return result;
      },
    });
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "batch-adversarial",
    ));

    const resolved = await dispatchedResolveFieldBatch(
      target(repositoryScope),
      ["__proto__", "constructor", "FR"],
    );
    expect(Object.getPrototypeOf(resolved)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(resolved, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved, "constructor")).toBe(true);
    expect(resolved["__proto__"]).toBe("proto-data");
    expect(Reflect.get(resolved, "constructor")).toBe("constructor-data");
    expect(Object.prototype.hasOwnProperty.call(resolved, "FR")).toBe(false);
    expect(valueGetterReads).toBe(0);
  });

  test("Fenel selects scalar fallback and omits undefined scalar rows", async () => {
    const requested: string[] = [];
    const scalar: FieldProvider = {
      name: "scalar-adversarial",
      get: async (key) => {
        requested.push(key);
        return key === "DE" ? undefined : `scalar:${key}`;
      },
    };
    dispatchedRegisterProvider(repositoryScope, scalar);
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "scalar-adversarial",
    ));

    expect(await dispatchedResolveFieldBatch(
      target(repositoryScope),
      ["FR", "DE", "FR"],
    )).toEqual({ FR: "scalar:FR" });
    expect(requested.sort()).toEqual(["DE", "FR"]);
  });

  test("entity merge projects current wire names only at the edge", async () => {
    dispatchedRegisterProvider(repositoryScope, geoProvider);
    dispatchedRegisterBinding(binding(repositoryScope));
    const wireName = (ref: FieldRef) => {
      if (ref.$ref === CODE.$ref) return "renamedCode";
      if (ref.$ref === GEOMETRY.$ref) return "renamedGeometry";
      return undefined;
    };
    const entity = { renamedCode: "FR", name: "France" };
    const resolved = await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      entity,
      wireName,
    );
    expect(resolved).toEqual({
      renamedCode: "FR",
      renamedGeometry: "geom:FR",
      name: "France",
    });

    const renamedAgain = await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      { currentCode: "DE" },
      (ref) => ref.$ref === CODE.$ref
        ? "currentCode"
        : ref.$ref === GEOMETRY.$ref ? "currentShape" : undefined,
    );
    expect(renamedAgain).toEqual({
      currentCode: "DE",
      currentShape: "geom:DE",
    });
    expect(dispatchedGetBinding(target(repositoryScope)).$tag).toBe("ProviderFound");
  });

  test("entity resolution reads hostile key fields as own data and writes hostile virtual names safely", async () => {
    const requested: string[] = [];
    dispatchedRegisterProvider(repositoryScope, {
      name: "geo-test",
      get: async (key) => {
        requested.push(key);
        return `geom:${key}`;
      },
    });
    dispatchedRegisterBinding(binding(repositoryScope));

    const inheritedOnly = {};
    expect(await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      inheritedOnly,
      (ref) => ref.$ref === CODE.$ref ? "constructor" : "__proto__",
    )).toBe(inheritedOnly);
    expect(requested).toEqual([]);

    let keyGetterReads = 0;
    const accessorKey: Record<string, unknown> = Object.create(null);
    Object.defineProperty(accessorKey, "constructor", {
      enumerable: true,
      get() {
        keyGetterReads += 1;
        throw new Error("entity key accessor must stay inert");
      },
    });
    expect(await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      accessorKey,
      (ref) => ref.$ref === CODE.$ref ? "constructor" : "__proto__",
    )).toBe(accessorKey);
    expect(keyGetterReads).toBe(0);

    const entity = Object.fromEntries([
      ["constructor", "FR"],
      ["name", "France"],
    ]);
    let copyGetterReads = 0;
    Object.defineProperty(entity, "accessorOnly", {
      enumerable: true,
      get() {
        copyGetterReads += 1;
        throw new Error("entity copy accessor must stay inert");
      },
    });
    const resolved = await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      entity,
      (ref) => ref.$ref === CODE.$ref ? "constructor" : "__proto__",
    );
    expect(requested).toEqual(["FR"]);
    expect(Object.getPrototypeOf(resolved)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(resolved, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved, "accessorOnly")).toBe(false);
    expect(Reflect.get(resolved, "constructor")).toBe("FR");
    expect(resolved["__proto__"]).toBe("geom:FR");
    expect(copyGetterReads).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(entity, "__proto__")).toBe(false);
  });

  test("entity owner selection cannot invoke another owner's binding", async () => {
    let calls = 0;
    const counted: FieldProvider = {
      name: "geo-test",
      get: async (key) => {
        calls += 1;
        return `geom:${key}`;
      },
    };
    dispatchedRegisterProvider(repositoryScope, counted);
    dispatchedRegisterBinding(binding(repositoryScope));
    dispatchedRegisterBinding(binding(
      repositoryScope,
      GEOMETRY,
      "geo-test",
      "OtherCountry",
    ));

    await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      { code: "FR" },
      (ref) => ref.$ref === CODE.$ref ? "code" : "geometry",
    );
    expect(calls).toBe(1);
  });

  test("entity merge omits undefined rows and is atomic when any IO leaf rejects", async () => {
    dispatchedRegisterProvider(repositoryScope, {
      name: "geo-test",
      get: async () => undefined,
    });
    dispatchedRegisterBinding(binding(repositoryScope));
    const entity = { code: "FR", name: "France" };
    expect(await dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      entity,
      (ref) => ref.$ref === CODE.$ref ? "code" : "geometry",
    )).toEqual(entity);

    dispatchedUnregisterProvider(repositoryScope, "geo-test");
    dispatchedUnregisterBinding(target(repositoryScope));
    dispatchedRegisterProvider(repositoryScope, geoProvider);
    dispatchedRegisterProvider(repositoryScope, {
      name: "geo-alt",
      get: async () => { throw new Error("flag unavailable"); },
    });
    dispatchedRegisterBinding(binding(repositoryScope));
    dispatchedRegisterBinding(binding(repositoryScope, FLAG, "geo-alt"));
    const preimage = { code: "FR", name: "France" };
    await expect(dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      preimage,
      (ref) => {
        if (ref.$ref === CODE.$ref) return "code";
        if (ref.$ref === GEOMETRY.$ref) return "geometry";
        if (ref.$ref === FLAG.$ref) return "flag";
        return undefined;
      },
    )).rejects.toThrow("flag unavailable");
    expect(preimage).toEqual({ code: "FR", name: "France" });

    dispatchedUnregisterProvider(repositoryScope, "geo-alt");
    dispatchedUnregisterBinding(target(repositoryScope, FLAG));
    dispatchedRegisterBinding(binding(repositoryScope, FLAG));
    await expect(dispatchedResolveEntity(
      repositoryScope,
      { name: "CountryTest" },
      preimage,
      (ref) => ref.$ref === CODE.$ref ? "code" : "sameProjection",
    )).rejects.toThrow("duplicate wire projection");
    expect(preimage).toEqual({ code: "FR", name: "France" });
  });
});
