// ---------------------------------------------------------------------------
// modules-as-values Phase 2c — StorageHandler (`workstreams/modules-as-values/
// briefs/phase-2c-tag-classes-and-traversable.md` § "StorageHandler").
//
// StorageHandler's parameter is only a tag (the backend: `Db`, `Memory`,
// `Bundle`), so each method is typed as the storage leaves it names (Rom's
// 2026-09-25 decision (a)), placeholders included: `store : (String, String,
// Map String Any, String) -> { id: String }`, `load : (String, String) -> Maybe
// ({ })`, … (`fenel/modules/storage/types.fenel` records why a declared
// `StoredRow` is deferred). A method takes its arguments together, the arity of
// the leaves. The class parameter appears in no argument, so dispatch does not
// change. The dispatch seed derives from the `.fenel` record. This suite pins:
//   (A) the eight methods stay at RETURN_POSITION, on the live seed, the
//       registry lookup and a fresh derivation from the `.fenel` record;
//   (B) each method's type is its three leaves' own declared type;
//   (C) the system registry's bare-name routing table (routes, dispatch
//       positions, general classes, and the StorageHandler instance keys) is
//       identical to the snapshot taken at HEAD 06302ef8 before any change
//       (`modules-as-values-storage-handler.routing-snapshot.json`);
//   (D) each of the 24 values is the qualified reference `storage.<member>`,
//       resolving to exactly the id its HEAD string named;
//   (E) each instance's methods are a value of the class record type, and a
//       wrong arity or a non-callable is refused.
// How the storage readers treat a reference — only through the storage
// module's own declarations, never a registry — is pinned in the runtime
// suites `handlers/storage-backends` and `rights-r2b-partition`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  dispatchPositionForSeed,
  methodDispatchPosition,
  seedFromType,
  RETURN_POSITION,
} from "./effect-dispatch";
import { dispatchRegistry } from "./system-entities";
import { getSystemRegistry } from "./system-registry";
import { loadFenelModule } from "./fenel-module";
import { instanceMethodsValueType } from "./authoring/value-authoring";
import { validate } from "./validate";
import { functionRefHandle } from "./type-foundation";
import { storageModule } from "./modules/storage";
import type { FenelType, Interface } from "./types";
import TYPECLASS_SPECS_SRC from "../../../../fenel/std/interfaces.fenel?raw";
import ROUTING_SNAPSHOT from "./modules-as-values-storage-handler.routing-snapshot.json";

const specs = loadFenelModule(TYPECLASS_SPECS_SRC, "std");
const shEntity = specs.entities?.find((e) => e.id === "StorageHandler");
if (!shEntity?.type) throw new Error("missing .fenel class StorageHandler");
const shRecord: FenelType = shEntity.type;
const classParam = String(shEntity.params?.[0]);

const BACKENDS = ["Db", "Memory", "Bundle"] as const;
const METHODS = ["store", "load", "update", "delete", "list", "appendEvent", "loadType", "loadTypeByName"] as const;
/** HEAD 06302ef8's value for `backend.method`: `storage:dbStore`, … */
const idOf = (backend: string, method: string): string =>
  `storage:${backend.toLowerCase()}${method[0]!.toUpperCase()}${method.slice(1)}`;

const liveSeed = (): Interface => {
  const seed = dispatchRegistry.getClass("StorageHandler");
  if (!seed) throw new Error("class StorageHandler is not registered");
  return seed;
};
const derivedSeed = (): Interface => seedFromType("StorageHandler", shRecord, classParam);
const signatures = (seed: Interface) =>
  seed.methods.map((m) => ({ name: m.name, params: m.params, returns: m.returns }));
type Field = { name: string; type: FenelType };
const fieldsOf = (t: FenelType): Field[] => (t as { $record: { fields: Field[] } }).$record.fields;
/** A type without its presentation and identity slots, to compare a class
 *  field's arrow with a function's own declaration. */
const shape = (t: unknown): unknown =>
  JSON.parse(JSON.stringify(t, (k, v) => (["label", "ui", "meta", "key"].includes(k) ? undefined : v)));

const liveMethods = (backend: string): Record<string, unknown> => {
  const inst = dispatchRegistry
    .listInstances("StorageHandler")
    .find((i) => JSON.stringify(i.args) === JSON.stringify([backend]));
  if (!inst) throw new Error(`no StorageHandler ${backend} instance`);
  return inst.methods as Record<string, unknown>;
};

describe("Phase 2c StorageHandler (A) — every method stays at return position", () => {
  it("the class parameter is the backend tag", () => {
    expect(classParam).toBe("backend");
  });

  for (const method of METHODS) {
    it(`${method}: RETURN_POSITION on the live seed, the registry lookup, and the .fenel derivation`, () => {
      expect(dispatchPositionForSeed(liveSeed(), method)).toBe(RETURN_POSITION);
      expect(methodDispatchPosition(dispatchRegistry, "StorageHandler", method)).toBe(RETURN_POSITION);
      expect(dispatchPositionForSeed(derivedSeed(), method)).toBe(RETURN_POSITION);
    });
  }
});

describe("Phase 2c StorageHandler (B) — each method is typed as the leaves it names", () => {
  it("the live seed is the .fenel record's derivation", () => {
    expect(liveSeed().params).toEqual(derivedSeed().params);
    expect(signatures(liveSeed())).toEqual(signatures(derivedSeed()));
    expect(liveSeed().methods.map((m) => m.name)).toEqual([...METHODS]);
  });

  it("every method is function-typed, with its three leaves' parameter and return types", () => {
    for (const method of liveSeed().methods) {
      expect({ method: method.name, type: fieldsOf(shRecord).find((f) => f.name === method.name)?.type })
        .toHaveProperty("type.$arrow");
      for (const backend of BACKENDS) {
        const leaf = storageModule.functions?.find((f) => f.id === idOf(backend, method.name));
        expect({ id: idOf(backend, method.name), found: leaf !== undefined }).toEqual({ id: idOf(backend, method.name), found: true });
        expect({ leaf: leaf!.id, params: leaf!.params.map((p) => shape(p.type)) })
          .toEqual({ leaf: leaf!.id, params: method.params.map((p) => shape(p.type)) });
        expect({ leaf: leaf!.id, returns: shape(leaf!.returns) })
          .toEqual({ leaf: leaf!.id, returns: shape(method.returns) });
      }
    }
  });
});

type RoutingRow = { typeName: string; key: string; scope: unknown; priority: number; methods?: Record<string, unknown> };

describe("Phase 2c StorageHandler (C) — the system registry's routing table is unchanged", () => {
  const table = getSystemRegistry().routingTable() as unknown as {
    routes: Array<{ name: string }>;
    posIdx: Record<string, number>;
    generalIdx: Record<string, true>;
    instanceIdx: Record<string, Record<string, RoutingRow[]>>;
  };
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  it("no StorageHandler method is a bare-name route", () => {
    for (const method of METHODS) {
      expect({ method, position: table.posIdx[`StorageHandler.${method}`] }).toEqual({ method, position: RETURN_POSITION });
      expect({ method, routed: table.routes.some((r) => r.name === method) }).toEqual({ method, routed: false });
    }
  });

  it("bare-name routes are identical to the pre-change snapshot", () => {
    expect(plain(table.routes)).toEqual(ROUTING_SNAPSHOT.routes);
  });

  it("per-(class, method) dispatch positions are identical to the pre-change snapshot", () => {
    expect(plain(table.posIdx)).toEqual(ROUTING_SNAPSHOT.posIdx);
  });

  it("general (pattern-bearing) classes are identical to the pre-change snapshot", () => {
    expect(plain(table.generalIdx)).toEqual(ROUTING_SNAPSHOT.generalIdx);
  });

  it("the three StorageHandler instances keep their keys, scopes, priorities and method names", () => {
    const projected = Object.fromEntries(
      Object.entries(table.instanceIdx.StorageHandler ?? {}).map(([key, rows]) => [
        key,
        rows.map((r) => ({
          typeName: r.typeName,
          key: r.key,
          scope: r.scope,
          priority: r.priority,
          methodNames: Object.keys(r.methods ?? {}).sort(),
        })),
      ]),
    );
    expect(plain(projected)).toEqual(ROUTING_SNAPSHOT.instanceKeys.StorageHandler);
  });
});

describe("Phase 2c StorageHandler (D) — each value names the act its HEAD string named", () => {
  const registry = getSystemRegistry();
  for (const backend of BACKENDS) {
    it(`StorageHandler ${backend}: eight qualified references, each resolving to its HEAD id`, () => {
      const methods = liveMethods(backend);
      expect(Object.keys(methods).sort()).toEqual([...METHODS].sort());
      for (const method of METHODS) {
        const id = idOf(backend, method);
        expect({ method, value: methods[method] }).toEqual({ method, value: { $ref: `storage.${id.slice("storage:".length)}` } });
        const handle = functionRefHandle(methods[method]);
        expect({ method, id: handle === undefined ? undefined : registry.getFunction(handle)?.id }).toEqual({ method, id });
      }
    });
  }
});

describe("Phase 2c StorageHandler (E) — the instances validate against the class record type", () => {
  const registry = getSystemRegistry();
  for (const backend of BACKENDS) {
    it(`StorageHandler ${backend}: its methods are a value of the class record type`, () => {
      const type = instanceMethodsValueType("StorageHandler", [backend], registry);
      expect(fieldsOf(type).map((f) => f.name)).toEqual([...METHODS]);
      for (const field of fieldsOf(type)) {
        expect({ field: field.name, type: field.type }).toHaveProperty("type.$arrow");
      }
      const result = validate(type, liveMethods(backend), null, { registry });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  it("the arrows are checked: a wrong arity and a non-callable are refused", () => {
    const type = instanceMethodsValueType("StorageHandler", ["Db"], registry);
    const base = liveMethods("Db");
    expect(validate(type, { ...base, store: { $ref: "std:add" } }, null, { registry }).errors).toEqual([
      { path: "store", message: 'Function "std:add" has 2 param(s) but expected 4' },
    ]);
    expect(validate(type, { ...base, load: 42 }, null, { registry }).valid).toBe(false);
  });
});
