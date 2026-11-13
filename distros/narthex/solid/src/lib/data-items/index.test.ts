import { describe, expect, test } from "bun:test";
import type { CatalogEntry, CatalogSection, FenelType } from "@fenel/engine";
import type { DataItem } from "../data-search";
import { userFnItems, userTypeItems, userTypeRouteId, type UserTypeRow } from "./user-items";
import type { UserFn } from "./index";

// Exercise the actual egress assembly with already-settled String metadata;
// loading a process-global registry is unnecessary for these source DTOs.
const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();
const entryStart = source.indexOf("export function entryToItem(");
const entryEnd = source.indexOf("export type UserType =", entryStart);
const buildStart = source.indexOf("export function buildDataItems(");
const buildEnd = source.indexOf("/** The committed account's tables", buildStart);
if ([entryStart, entryEnd, buildStart, buildEnd].some(index => index < 0))
  throw new Error("The canonical data-item assembly is missing.");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const declarations = [source.slice(entryStart, entryEnd), source.slice(buildStart, buildEnd)]
  .join("\n").replaceAll("export function", "function");
const forbidden = () => { throw new Error("A source-owned DTO must not acquire the global catalog or inspect a set."); };
const buildDataItems = new Function("canonical", "peelSetExpr", "getCatalog", "userTypeItems", "userFnItems", "userTypeRouteId",
  `${transpiler.transformSync(declarations)}; return buildDataItems;`)
  ((text: string) => text, forbidden, forbidden, userTypeItems, userFnItems, userTypeRouteId) as
    (options: { catalog?: CatalogSection[]; userTypes?: UserTypeRow[]; userFns?: UserFn[]; includeCatalog?: boolean }) => DataItem[];
const identity = "0d803573-aefa-4f5c-8473-f0920c56e744";
const otherIdentity = "1be37e4e-31e4-4e3a-9c4a-424cc3e63851";
const shape: FenelType = { $ref: "Number" };
const entry = (routeId: string, entityId: string, name = "Counter"): CatalogEntry => ({
  id: routeId, name, description: "Catalog description", category: "entity", entity: { id: entityId, type: shape },
});

describe("source-owned function catalog identity deduplication", () => {
  const fnIdentity = "2e24d39f-22e5-4b7b-9f70-cc21d0f0c6fe";
  const otherFnIdentity = "6d47ab34-361f-40d1-8fcf-ff0982f92147";
  const fnEntry = (id: string, targetId = id, name = "Same label"): CatalogEntry => ({
    id, name, description: "Catalog description", category: "function", fn: { id: targetId, params: [], returns: shape },
  });
  const fnCatalog = (...entries: CatalogEntry[]): CatalogSection[] => [{ id: "function", label: "Functions", description: "", entries }];
  const fnRow = (id: string, name = id): UserFn => ({ id, name, label: "Same label", codeName: "localCodeName",
    icon: "function", description: "Source function help", function: { id, params: [], returns: shape, body: 42 } });
  test("one actual function id retains the richer source label, code name, icon and signature", () => {
    const items = buildDataItems({ catalog: fnCatalog(fnEntry(fnIdentity)), userFns: [fnRow(fnIdentity)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ routeId: fnIdentity, routeBase: "/app/functions/", kind: "function", source: "user",
      label: "Same label", codeName: "localCodeName", icon: "function", description: "Source function help" });
    expect(items[0]!.signature?.returns).toBe(shape);
  });
  test("equal labels and signatures preserve distinct function identities", () => {
    const items = buildDataItems({ catalog: fnCatalog(fnEntry(fnIdentity), fnEntry(otherFnIdentity)), userFns: [fnRow(fnIdentity)] });
    expect(items.map(item => item.routeId)).toEqual([fnIdentity, otherFnIdentity]);
    expect(items.map(item => item.label)).toEqual(["Same label", "Same label"]);
    expect(items.map(item => item.source)).toEqual(["user", "system"]);
  });
  test("different catalog and storage routes still refer to the same exact function value id", () => {
    const items = buildDataItems({ catalog: fnCatalog(fnEntry("catalog-route", fnIdentity), fnEntry("another-catalog-route", fnIdentity)),
      userFns: [fnRow(fnIdentity, "source-function-route")] });
    expect(items).toHaveLength(1);
    expect(items[0]!.routeId).toBe("source-function-route");
    expect(items[0]!.source).toBe("user");
  });
  test("distinct catalog positions and the source-only tail retain their original order", () => {
    const items = buildDataItems({ catalog: fnCatalog(fnEntry("before"), fnEntry(fnIdentity), fnEntry("after")),
      userFns: [fnRow(otherFnIdentity), fnRow(fnIdentity)] });
    expect(items.map(item => item.routeId)).toEqual(["before", fnIdentity, "after", otherFnIdentity]);
    expect(items[1]!.source).toBe("user");
  });
  test("source-only function projection never acquires a catalog", () => {
    const items = buildDataItems({ includeCatalog: false, userFns: [fnRow(fnIdentity), fnRow(otherFnIdentity)] });
    expect(items.map(item => item.routeId)).toEqual([fnIdentity, otherFnIdentity]);
  });
});
const catalog = (...entries: CatalogEntry[]): CatalogSection[] => [{ id: "entity", label: "Types", description: "", entries }];
const local: UserTypeRow = { name: identity, label: "Counter", description: "Local description", icon: "hash", type: shape };

describe("source-owned data catalog identity deduplication", () => {
  test("the checked bare UUID and the local prefixed route yield one row with local presentation", () => {
    const items = buildDataItems({ catalog: catalog(entry(identity, identity)), userTypes: [local] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "entity", routeId: `entity:${identity}`, source: "user",
      label: "Counter", description: "Local description", icon: "hash" });
    expect(items[0]!.type).toBe(shape);
  });
  test("equal labels and the same structural type preserve distinct nominal identities", () => {
    const items = buildDataItems({ catalog: catalog(entry(identity, identity), entry(otherIdentity, otherIdentity)), userTypes: [local] });
    expect(items.map(item => item.routeId)).toEqual([`entity:${identity}`, otherIdentity]);
    expect(items.map(item => item.label)).toEqual(["Counter", "Counter"]);
    expect(items[0]!.type).toBe(items[1]!.type);
    expect(items.map(item => item.source)).toEqual(["user", "system"]);
  });
  test("an existing prefixed catalog route still deduplicates and qualified foreign routes stay intact", () => {
    const items = buildDataItems({ catalog: catalog(entry(`entity:${identity}`, identity),
      entry("entity:another.Counter", "another.Counter")), userTypes: [local] });
    expect(items.map(item => item.routeId)).toEqual([`entity:${identity}`, "entity:another.Counter"]);
  });
  test("catalog route aliases to the same declared identity do not add a second local row", () => {
    const items = buildDataItems({ catalog: catalog(entry("counter-catalog-alias", identity)), userTypes: [local] });
    expect(items.map(item => item.routeId)).toEqual([`entity:${identity}`]);
  });
  test("without a local row the exact catalog address is retained", () => {
    const items = buildDataItems({ catalog: catalog(entry(identity, identity)), userTypes: [] });
    expect(items).toHaveLength(1);
    expect(items[0]!.routeId).toBe(identity);
    expect(items[0]!.source).toBe("system");
  });
});
