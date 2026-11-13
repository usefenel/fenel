import { beforeAll, describe, expect, test } from "bun:test";
import { createRegistry, type ModuleRegistry } from "./registry";
import type { FenelModule, FenelType } from "./types";
import { DeclarationNameError, loadFenelModule } from "./fenel-module";
import { stdModule } from "./modules/std";
import { declaringModuleOfInstance, type DispatchRegistry } from "./dispatch-registry";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { moduleSourceCoordinate, type EvaluateContext } from "./json-logic";
import { createStockDispatchRegistry } from "./system-entities";

function fixture(moduleName: string, entityName: string, type: FenelType): FenelModule {
  const id = `${moduleName}:value`;
  return {
    name: moduleName,
    label: moduleName,
    entities: [{ id: entityName, type }],
    functions: [{ id, params: [], returns: { $ref: entityName } }],
    nativeImpls: { [id]: () => 1 },
  };
}

function functionReturnOwner(registry: ModuleRegistry, id: string): string {
  const scheme = registry.getFunctionScheme(id);
  const identity = scheme?.nominals?.find((item) =>
    item.path.length === 2 && item.path[0] === "$arrow" && item.path[1] === "returns")?.identity;
  if (identity === undefined) throw new Error(`missing nominal scheme: ${id} ${JSON.stringify(registry.getFunctionSignatureInfo(id))}`);
  return identity;
}

describe("registry nominal identity projection", () => {
  test("aliases and refinements expose the same owner identity as callable schemes", () => {
    const registry = createRegistry([
      fixture("Aliases", "CountAlias", { $ref: "Number" }),
      fixture("Refinements", "PositiveCount", {
        $refined: { base: { $ref: "Number" }, set: { $tag: "SeEnum", values: [1] } },
      }),
    ], { publishCatalogEntities: false });
    expect(registry.getEntityNominalIdentity("CountAlias"))
      .toBe(functionReturnOwner(registry, "Aliases:value"));
    expect(registry.getEntityNominalIdentity("PositiveCount"))
      .toBe(functionReturnOwner(registry, "Refinements:value"));
    expect(registry.listConstructorSignatures().filter((entry) =>
      entry.ownerName === "CountAlias" || entry.ownerName === "PositiveCount")).toHaveLength(0);
    expect(registry.getEntityNominalIdentity("MissingType")).toBeUndefined();
  }, 180_000);

  // Per-owner type identity (modules-as-values Phase 5, S2): each owner of a
  // shared name reads its own owner-keyed lock row, so module order cannot move
  // a UUID from one owner to the other. Bare-name lookups keep selecting the
  // last registered owner (S2 changes no bare reader).
  test("same-name owners keep their own UUIDs in either module order; bare projection follows the selected view", () => {
    const first = fixture("First", "Shared", { $ref: "Number" });
    const second = fixture("Second", "Shared", { $ref: "String" });
    const FIRST = "6320dc73-0000-4000-8000-000000000001";
    const SECOND = "6320dc73-0000-4000-8000-000000000002";
    const lock = new Map([
      ["type/module/First/Shared", FIRST],
      ["type/module/Second/Shared", SECOND],
    ]);
    for (const modules of [[first, second], [second, first]]) {
      const registry = createRegistry(modules, { publishCatalogEntities: false, codeNameLock: lock });
      const selected = registry.getIdentifiedEntity("Shared")!;
      const firstOwner = functionReturnOwner(registry, "First:value");
      const secondOwner = functionReturnOwner(registry, "Second:value");
      expect(firstOwner).not.toBe(secondOwner);
      expect(registry.getEntityNominalIdentity("Shared"))
        .toBe(functionReturnOwner(registry, `${selected.module}:value`));

      expect(registry.getTypeUuid("First", "Shared")).toBe(FIRST);
      expect(registry.getTypeUuid("Second", "Shared")).toBe(SECOND);
      expect(registry.getEntity(FIRST)?.module).toBe("First");
      expect(registry.getEntity(SECOND)?.module).toBe("Second");
      expect(registry.getEntityNominalIdentity(FIRST)).toBe(firstOwner);
      expect(registry.getEntityNominalIdentity(SECOND)).toBe(secondOwner);
      // A UUID names its one owner exactly; the shared bare spelling names no identity.
      expect(registry.getUuid(FIRST)).toBe(FIRST);
      expect(registry.getUuid(SECOND)).toBe(SECOND);
      expect(registry.getUuid("Shared")).toBeUndefined();
      expect(registry.getTypeUuid("Third", "Shared")).toBeUndefined();
    }
  }, 180_000);

  test("entity UUID lookup carries the same nominal identity as its source name", () => {
    const uuid = "6320dc73-82e5-45e9-8b63-97b757cb66b7";
    const registry = createRegistry([fixture("Aliases", "CountAlias", { $ref: "Number" })], {
      publishCatalogEntities: false,
      codeNameLock: new Map([["type/module/Aliases/CountAlias", uuid]]),
    });
    expect(registry.getIdentifiedEntity(uuid)?.id).toBe("CountAlias");
    expect(registry.getEntityNominalIdentity(uuid)).toBe(registry.getEntityNominalIdentity("CountAlias"));
    expect(registry.getUuid("CountAlias")).toBe(uuid);
    expect(registry.getUuid(uuid)).toBe(uuid);
    expect(registry.getTypeUuid("Aliases", "CountAlias")).toBe(uuid);
  }, 180_000);

  // Demo 1 typed entry (2026-11-07): an exact type identity handle names its
  // own owner in every call-site frame (detached, a source function, a
  // declaration's own frame), as callableTypeOwnerFor already treats it.
  test("an exact type identity handle resolves to its own owner without a name frame", () => {
    const uuid = "6320dc73-82e5-45e9-8b63-97b757cb66b9";
    const registry = createRegistry([fixture("Aliases", "CountAlias", { $ref: "Number" }),
      fixture("Holders", "CountHolder", { $record: { fields: [{ name: "_0", type: { $ref: uuid },
        key: { $tag: "PositionalField", index: 0 }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }] } } as FenelType)], {
      publishCatalogEntities: false,
      codeNameLock: new Map([["type/module/Aliases/CountAlias", uuid]]),
    });
    const owner = registry.getEntityNominalIdentity("CountAlias");
    expect(owner).toBeDefined();
    const root = (result: ReturnType<ModuleRegistry["callSiteTyping"]["resolveType"]>) =>
      result.ok ? result.type.nominals?.find(row => row.path.length === 0)?.identity : undefined;
    expect(root(registry.callSiteTyping.resolveType({ $ref: uuid }, undefined))).toBe(owner);
    expect(root(registry.callSiteTyping.resolveType({ $ref: uuid }, "Holders:value"))).toBe(owner);
    // Inside another declaration's own frame (a Local Person's phone field).
    const holder = registry.getEntityNominalIdentity("CountHolder")!;
    const field = registry.callSiteTyping.resolveTypeInDeclaration?.({ $ref: uuid }, holder);
    expect(field?.ok && field.type.nominals?.find(row => row.path.length === 0)?.identity).toBe(owner);
    // The bare spelling keeps its frame rule; unknown UUIDs and non-type handles stay missing.
    expect(registry.callSiteTyping.resolveType({ $ref: "CountAlias" }, undefined).ok).toBe(false);
    expect(registry.callSiteTyping.resolveType({ $ref: "6320dc73-82e5-45e9-8b63-97b757cb66ba" }, undefined).ok).toBe(false);
    expect(registry.callSiteTyping.resolveType({ $ref: "Aliases:value" }, undefined).ok).toBe(false);
  }, 180_000);

  test("a bare type row is not a type identity", () => {
    const uuid = "6320dc73-82e5-45e9-8b63-97b757cb66b8";
    const registry = createRegistry([fixture("Aliases", "CountAlias", { $ref: "Number" })], {
      publishCatalogEntities: false,
      codeNameLock: new Map([["CountAlias", uuid]]),
    });
    expect(registry.getUuid("CountAlias")).toBeUndefined();
    expect(registry.getEntity(uuid)).toBeUndefined();
    expect(registry.callSiteTyping.resolveType({ $ref: uuid }, undefined).ok).toBe(false);
    expect(registry.getTypeUuid("Aliases", "CountAlias")).toBeUndefined();
    expect(registry.getEntity("CountAlias")?.module).toBe("Aliases");
  }, 180_000);
});

describe("source-owned implicit prelude Bool binding", () => {
  let registry: ModuleRegistry;
  beforeAll(() => {
    const prelude = loadFenelModule(`module PreludeBoolSourceProbe where
PreludeFlagHolderProbe = PreludeFlagHolderProbe flag: Bool
preludeFlagProbe : (flag: Bool) -> PreludeFlagHolderProbe
preludeFlagProbe flag = PreludeFlagHolderProbe flag
`, "PreludeBoolSourceProbe");
    const local = loadFenelModule(`module LocalBoolSourceProbe where
Bool = LocalFlagOffProbe | LocalFlagOnProbe
LocalFlagHolderProbe = LocalFlagHolderProbe flag: Bool
localFlagProbe : (flag: Bool) -> LocalFlagHolderProbe
localFlagProbe flag = LocalFlagHolderProbe flag
`, "LocalBoolSourceProbe");
    const missing = loadFenelModule(`module MissingBoolProviderProbe where
MissingBoolAvailableProbe = MissingBoolAvailableProbe
`, "MissingBoolProviderProbe");
    const explicit = loadFenelModule(`module ExplicitBoolSourceProbe where
import MissingBoolProviderProbe (Bool)
ExplicitFlagHolderProbe = ExplicitFlagHolderProbe flag: Bool
explicitFlagProbe : (flag: Bool) -> ExplicitFlagHolderProbe
explicitFlagProbe flag = ExplicitFlagHolderProbe flag
`, "ExplicitBoolSourceProbe");
    // Source-handle routing fixture. Strict physical field identities are
    // covered by the existing semantic-slots tests.
    registry = createRegistry([stdModule, prelude, local, missing, explicit], { publishCatalogEntities: false });
  }, 180_000);

  function rootOwner(result: ReturnType<ModuleRegistry["callSiteTyping"]["resolveType"]>) {
    return result.ok ? result.type.nominals?.find(row => row.path.length === 0)?.identity : undefined;
  }

  test("the actual source field resolves Bool to registered Boolean", () => {
    const fn = registry.getFunction("PreludeBoolSourceProbe:preludeFlagProbe");
    const reader = registry.evaluateContext();
    if (!fn) throw new Error("Actual prelude source function unavailable");
    const holder = reader._typeFamilyOwner?.("PreludeFlagHolderProbe", fn.id);
    if (!holder) throw new Error("Actual prelude holder declaration unavailable");
    const systemOwner = registry.getEntityNominalIdentity("Boolean");
    expect(systemOwner).toBeDefined();
    expect(rootOwner(registry.callSiteTyping.resolveType({ $ref: "Bool" }, fn.id))).toBe(systemOwner);
    const fields = registry.callSiteTyping.resolveTypeInDeclaration?.(holder.type, holder.ownerIdentity);
    if (!fields?.ok) throw new Error("Actual holder field scheme unavailable");
    expect(fields.type.nominals?.some(row => row.publicName === "Bool" && row.identity === systemOwner)).toBe(true);
  }, 180_000);

  test("a local Bool declaration owns its actual source field", () => {
    const fn = registry.getFunction("LocalBoolSourceProbe:localFlagProbe");
    const reader = registry.evaluateContext();
    if (!fn) throw new Error("Actual local source function unavailable");
    const local = reader._typeFamilyOwner?.("Bool", fn.id);
    const holder = reader._typeFamilyOwner?.("LocalFlagHolderProbe", fn.id);
    if (!local || !holder) throw new Error("Actual local Bool declaration unavailable");
    expect(local.ownerIdentity).not.toBe(registry.getEntityNominalIdentity("Boolean"));
    expect(rootOwner(registry.callSiteTyping.resolveType({ $ref: "Bool" }, fn.id))).toBe(local.ownerIdentity);
    const fields = registry.callSiteTyping.resolveTypeInDeclaration?.(holder.type, holder.ownerIdentity);
    if (!fields?.ok) throw new Error("Actual local field scheme unavailable");
    expect(fields.type.nominals?.some(row => row.publicName === "Bool" && row.identity === local.ownerIdentity)).toBe(true);
  }, 180_000);

  test("an explicit missing import and a detached Bool do not borrow the prelude alias", () => {
    const fn = registry.getFunction("ExplicitBoolSourceProbe:explicitFlagProbe");
    if (!fn) throw new Error("Actual explicit-import source function unavailable");
    expect(registry.callSiteTyping.resolveType({ $ref: "Bool" }, fn.id).ok).toBe(false);
    expect(registry.callSiteTyping.resolveType({ $ref: "Bool" }, undefined).ok).toBe(false);
    expect(rootOwner(registry.callSiteTyping.resolveType({ $ref: "Boolean" }, undefined)))
      .toBe(registry.getEntityNominalIdentity("Boolean"));
  }, 180_000);
});

test("registered class-only nominal owners reject conflicting authored import selections", () => {
  let rejected: unknown;
  try {
    loadFenelModule(`module RosterConflictingSelections where
import RosterFirstOwner (RosterSharedType)
import RosterSecondOwner (RosterSharedType)
`, "RosterConflictingSelections", { dispatchInstanceFile: true });
  } catch (error) {
    rejected = error;
  }
  expect(rejected).toBeInstanceOf(DeclarationNameError);
  if (!(rejected instanceof DeclarationNameError)) throw new Error("Expected declaration-name refusal");
  expect(rejected.errors).toEqual([expect.objectContaining({
    $tag: "SelectionConflict", name: "RosterSharedType",
    first: expect.objectContaining({ source: "RosterFirstOwner", name: "RosterSharedType" }),
    second: expect.objectContaining({ source: "RosterSecondOwner", name: "RosterSharedType" }),
  })]);
}, 180_000);

describe("registered class-only nominal owners", () => {
  let registry: ModuleRegistry;
  let reader: EvaluateContext;
  let captured: DispatchRegistry;
  let sourceMarkerNames: string[];
  const FIRST = "6320dc73-0000-4000-8000-000000000021";
  const SECOND = "6320dc73-0000-4000-8000-000000000022";

  beforeAll(() => {
    const load = (source: string, name: string) => loadFenelModule(source, name, { dispatchInstanceFile: true });
    const modules = [
      load(`module RosterPreludeProbe where
preludeMarker : Representational Codeable
preludeMarker = Representational
`, "RosterPreludeProbe"),
      load(`module RosterUnknownProbe where
unknownMarker : Representational RosterNeverDeclared
unknownMarker = Representational
`, "RosterUnknownProbe"),
      load(`module RosterMissingProvider where
RosterAvailable = RosterAvailable
`, "RosterMissingProvider"),
      load(`module RosterMissingImportProbe where
import RosterMissingProvider (Codeable)
missingMarker : Representational Codeable
missingMarker = Representational
`, "RosterMissingImportProbe"),
      load(`module RosterFirstOwner where
RosterSharedType = RosterFirstValue
`, "RosterFirstOwner"),
      load(`module RosterSecondOwner where
RosterSharedType = RosterSecondValue
`, "RosterSecondOwner"),
      load(`module RosterSelectedOwner where
import RosterFirstOwner (RosterSharedType)
selectedMarker : Representational RosterSharedType
selectedMarker = Representational
`, "RosterSelectedOwner"),
      load(`module RosterOtherSelectedOwner where
import RosterSecondOwner (RosterSharedType)
otherSelectedMarker : Representational RosterSharedType
otherSelectedMarker = Representational
`, "RosterOtherSelectedOwner"),
      load(`module RosterAmbiguousScope where
RosterLeftScopeType = RosterLeftScopeValue
`, "RosterAmbiguousScope"),
      load(`module RosterAmbiguousScope where
RosterRightScopeType = RosterRightScopeValue
`, "RosterAmbiguousScope"),
    ];
    // Private source-owned pool: no test row mutates the process registry.
    const pool = createStockDispatchRegistry();
    sourceMarkerNames = pool.listInstances("Representational").map(row => {
      const name = row.args[0];
      if (typeof name !== "string") throw new Error("Repository marker source has no class-name argument");
      return name;
    });
    // Use the loader's actual argument-reference evidence and the same
    // declaring-module registration boundary as installed source instances.
    for (const mod of modules) {
      for (const row of mod.instances ?? []) pool.addInstance(row, { declaringModule: mod.name });
    }
    registry = createRegistry([stdModule, ...modules], {
      dispatchRegistry: pool, publishCatalogEntities: false,
      codeNameLock: new Map([
        ["type/module/RosterFirstOwner/RosterSharedType", FIRST],
        ["type/module/RosterSecondOwner/RosterSharedType", SECOND],
      ]),
    });
    reader = registry.evaluateContext();
    if (reader._specRegistry === undefined) throw new Error("Captured dispatch registry unavailable");
    captured = reader._specRegistry;
  }, 180_000);

  function markerIn(moduleName: string) {
    const rows = captured.listInstances("Representational").filter(row => declaringModuleOfInstance(row) === moduleName);
    if (rows.length !== 1) throw new Error(`Expected one source marker in ${moduleName}, got ${rows.length}`);
    return rows[0]!;
  }

  function rootOwner(result: ReturnType<ModuleRegistry["callSiteTyping"]["resolveType"]>) {
    return result.ok ? result.type.nominals?.find(row => row.path.length === 0)?.identity : undefined;
  }

  const appliedCodeable: FenelType = { $el: { call: ["Codeable", { $ref: "String" }] } };

  test("captured repository markers retain the complete source roster and drive the existing Fenel family projection", () => {
    expect(sourceMarkerNames.length).toBeGreaterThan(0);
    for (const name of ["Codeable", "Labelable", "Describable"]) expect(sourceMarkerNames).toContain(name);
    const rows = captured.listInstances("Representational").filter(row => declaringModuleOfInstance(row) === "std");
    expect(rows.map(row => row.args[0])).toEqual(sourceMarkerNames);
    for (const name of sourceMarkerNames) expect(captured.getClass(name)).toBeDefined();
    const markers = rows.map(row => ({ args: row.args, methods: row.methods,
      scope: row.scope ?? "global", priority: row.priority ?? 0 }));
    expect(dispatchEngineBody("engine:representationalClassNamesFromSnapshot", [
      markers, captured.listClasses().map(cls => cls.name),
    ], reader)).toEqual(sourceMarkerNames);
  }, 180_000);

  test("an admitted class-only declaration resolves to its exact owner without entering the catalogue partition", () => {
    const identity = registry.getEntityNominalIdentity("Codeable");
    expect(identity).toBeDefined();
    const selected = registry.callSiteTyping.resolveType(appliedCodeable, moduleSourceCoordinate("RosterPreludeProbe"));
    expect(selected.ok).toBe(true);
    expect(rootOwner(selected)).toBe(identity);
    expect(markerIn("RosterPreludeProbe").args).toEqual(["Codeable"]);
    expect(registry.listIdentifiedEntities().some(entity => entity.id === "Codeable")).toBe(false);
    // Declaration kind survives admission: a parameterized class is not a
    // nullary type merely because its owner can now be found.
    const bare = registry.callSiteTyping.resolveType({ $ref: "Codeable" }, moduleSourceCoordinate("RosterPreludeProbe"));
    expect(bare.ok).toBe(false);
    expect(bare.ok ? undefined : bare.reason).toBe("malformed");
  }, 180_000);

  test("unknown and explicitly missing imported marker arguments remain unresolved", () => {
    // Unresolved reference carriers are observed transport data, outside TypeExpr.
    const unknownArgs: readonly unknown[] = markerIn("RosterUnknownProbe").args;
    const missingImportArgs: readonly unknown[] = markerIn("RosterMissingImportProbe").args;
    expect(unknownArgs).toEqual([{ $ref: "RosterNeverDeclared" }]);
    expect(missingImportArgs).toEqual([{ $ref: "Codeable" }]);
    for (const [type, owner] of [
      [{ $ref: "RosterNeverDeclared" }, "RosterUnknownProbe"],
      [appliedCodeable, "RosterMissingImportProbe"],
    ] as const) {
      const result = registry.callSiteTyping.resolveType(type, moduleSourceCoordinate(owner));
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.reason).toBe("missing");
    }
  }, 180_000);

  test("competing names retain exact owners and legal selective imports", () => {
    const firstOwner = registry.getEntityNominalIdentity(FIRST);
    const secondOwner = registry.getEntityNominalIdentity(SECOND);
    expect(firstOwner).toBeDefined();
    expect(secondOwner).toBeDefined();
    expect(firstOwner).not.toBe(secondOwner);
    expect(registry.getTypeUuid("RosterFirstOwner", "RosterSharedType")).toBe(FIRST);
    expect(registry.getTypeUuid("RosterSecondOwner", "RosterSharedType")).toBe(SECOND);
    for (const [moduleName, identity] of [
      ["RosterFirstOwner", firstOwner], ["RosterSecondOwner", secondOwner],
      ["RosterSelectedOwner", firstOwner], ["RosterOtherSelectedOwner", secondOwner],
    ] as const) {
      const selected = registry.callSiteTyping.resolveType({ $ref: "RosterSharedType" }, moduleSourceCoordinate(moduleName));
      expect(selected.ok).toBe(true);
      expect(rootOwner(selected)).toBe(identity);
    }
    expect(markerIn("RosterSelectedOwner").args).toEqual(["RosterSharedType"]);
    expect(markerIn("RosterOtherSelectedOwner").args).toEqual(["RosterSharedType"]);
    // Neither global uniqueness nor the last bare-name reader grants access
    // to a module that selected no owner of this name.
    expect(registry.callSiteTyping.resolveType({ $ref: "RosterSharedType" }, moduleSourceCoordinate("RosterPreludeProbe")).ok).toBe(false);
  }, 180_000);

  test("ambiguous source coordinates and detached classes do not gain a prelude escape", () => {
    const ambiguous = registry.callSiteTyping.resolveType({ $ref: "Number" }, moduleSourceCoordinate("RosterAmbiguousScope"));
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.ok ? undefined : ambiguous.reason).toBe("ambiguous");
    const detached = registry.callSiteTyping.resolveType(appliedCodeable, undefined);
    expect(detached.ok).toBe(false);
    expect(detached.ok ? undefined : detached.reason).toBe("missing");
    expect(rootOwner(registry.callSiteTyping.resolveType({ $ref: "Number" }, undefined)))
      .toBe(registry.getEntityNominalIdentity("Number"));
  }, 180_000);
});
