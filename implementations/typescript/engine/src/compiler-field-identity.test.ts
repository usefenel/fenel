import { describe, expect, test } from "vitest";
import {
  compileSourceFromUnknown,
  type CompileSource,
} from "./compilable";
import {
  compileConstructorSlotTable,
  compileConstructorWireName,
  compileConstructorWireNames,
  compileFieldSlotListOccurrences,
  compileFunctionParamSlots,
  compileFunctionTypeOwnerIds,
  isCompilerOwnedStableSlotList,
  isCompilerOwnedStableSlotTable,
  positionalCompileFieldSlots,
  type CompileFieldSlot,
} from "./compile-field-slots";
import {
  dispatchedMakeEffectsExplicit,
  dispatchedNormaliseToCore,
} from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";
import { compileFenelToJsNative } from "./modules/compile-js";
import { compileFenelToWasmNative } from "./modules/compile-wasm";
import { compileFenelToLlvmNative } from "./modules/compile-llvm";
import { buildNormaliseToCoreSamples, effectfulCanary } from "./self-host-samples";
import { getRepositoryCompilerMetadataView } from "./compiler-metadata-view";
import { getSystemRegistry } from "./system-registry";
import { deduplicateSemanticEntityOwnerProjections } from "./registry";
import { animationModule } from "./modules/animation";
import { gamesModule } from "./modules/games";
import { telegramModule } from "./modules/telegram";
import type { FenelType } from "./types";

void engineModule;

const REPOSITORY_COMPILER_TEST_TIMEOUT_MS = 1_800_000;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function namedSlot(wireName: string, id: string): CompileFieldSlot {
  return {
    key: { $tag: "NamedField", ref: { $ref: id } },
    wireName,
  };
}

function variantEntity(
  id: string,
  ctor: string,
  fields: readonly CompileFieldSlot[],
): { id: string; type: FenelType } {
  return {
    id,
    type: {
      $variant: {
        cases: [{
          name: ctor,
          fields: fields.map((field) => ({
            name: field.wireName,
            key: field.key,
            type: field.type ?? { $ref: "String" },
          })),
        }],
      },
    } as FenelType,
  };
}

describe("compiler constructor reflection identity", () => {
  test("repository profile union supplies self-host params and engine-owned constructors", () => {
    const view = getRepositoryCompilerMetadataView();
    const parseEffect = view.getIdentifiedFunction("engine:parseEffectFnId");
    expect(parseEffect?.params[0]?.key?.$tag).toBe("NamedField");
    for (const fnId of [
      "engine:normaliseToCore",
      "compile-js:normaliseToCore",
      "compile-wasm:normaliseToCore",
      "compile-llvm:normaliseToCore",
      // Exact, explicitly-declared namespace divergences: the containing
      // display module is not inferred from these prefixes.
      "set:witnessSound",
      "kernel:verify",
      "subject:accountId",
    ]) {
      expect(view.getIdentifiedFunction(fnId)?.id, fnId).toBe(fnId);
    }
    // All four functions above share the same current Codeable. Compiler
    // metadata is exact-owner-only and must not inherit registry last-wins.
    expect(view.getIdentifiedFunction("normaliseToCore")).toBeUndefined();
    const constructors = compileConstructorSlotTable(view);
    const curvePath = constructors["CurvePath"];
    expect(curvePath?.map((slot) => slot.wireName)).toEqual(["anchors", "segments"]);
    expect(curvePath?.every((slot) => slot.key.$tag === "NamedField")).toBe(true);
    for (const [ctor, wireNames] of [
      ["JlObject", ["fields"]],
      ["FtNamed", ["name", "raw"]],
      ["SfRecord", ["fields", "raw"]],
      ["CeLit", ["value"]],
      ["CeConstruct", ["ctor", "args", "fields"]],
    ] as const) {
      expect(constructors[ctor]?.map((slot) => slot.wireName), ctor).toEqual(wireNames);
      expect(constructors[ctor]?.every((slot) => slot.key.$tag === "NamedField"), ctor)
        .toBe(true);
    }
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.listIdentifiedEntities())).toBe(true);
    expect(Object.isFrozen(view.listIdentifiedEntities()[0])).toBe(true);
    expect(Object.isFrozen(parseEffect)).toBe(true);
    expect(Object.isFrozen(parseEffect?.params)).toBe(true);
  }, REPOSITORY_COMPILER_TEST_TIMEOUT_MS);

  test("real constructor collision stays unscoped until an exact owner is supplied", () => {
    const view = getRepositoryCompilerMetadataView();
    expect(compileConstructorSlotTable(view)["User"]).toBeUndefined();

    const telegramUser = compileConstructorSlotTable(view, { ownerIds: ["User"] });
    const subjectUser = compileConstructorSlotTable(view, { ownerIds: ["Subject"] });
    expect(telegramUser["User"]?.map((slot) => slot.wireName)).toEqual([
      "id",
      "isBot",
      "firstName",
      "lastName",
      "username",
      "languageCode",
      "isPremium",
      "canJoinGroups",
      "canManageBots",
    ]);
    expect(subjectUser["User"]?.map((slot) => slot.wireName)).toEqual([
      "accountId",
      "userId",
    ]);
    expect(telegramUser["User"]?.every((slot) => slot.key.$tag === "NamedField")).toBe(true);
    expect(telegramUser["User"]?.[0]?.key).not.toEqual(subjectUser["User"]?.[0]?.key);

    const source: CompileSource = {
      name: "identifiedTelegramUser",
      params: [telegramUser["User"]![0]!],
      body: {
        construct: ["User", {
          id: { var: "id" },
          isBot: false,
          firstName: "Ada",
          lastName: { construct: ["Nothing"] },
          username: { construct: ["Nothing"] },
          languageCode: { construct: ["Nothing"] },
          isPremium: { construct: ["Nothing"] },
          canJoinGroups: { construct: ["Nothing"] },
          canManageBots: { construct: ["Nothing"] },
        }],
      },
      requires: [],
      ctorDefs: telegramUser,
    };
    const core = dispatchedNormaliseToCore(source);
    expect(core.$tag).toBe("Ok");
    if (core.$tag === "Ok") {
      const fields = (core._0.body as { fields?: CompileFieldSlot[] }).fields;
      expect(fields).toEqual(telegramUser["User"]);
    }

    const subjectSource: CompileSource = {
      name: "identifiedSubjectUser",
      params: [subjectUser["User"]![0]!],
      body: {
        construct: ["User", {
          accountId: { var: "accountId" },
          userId: "user-1",
        }],
      },
      requires: [],
      ctorDefs: subjectUser,
    };

    for (const [targetSource, expectedSlot, otherSlot] of [
      [source, telegramUser["User"]![0]!, subjectUser["User"]![0]!],
      [subjectSource, subjectUser["User"]![0]!, telegramUser["User"]![0]!],
    ] as const) {
      for (const result of [
        compileFenelToJsNative(targetSource),
        compileFenelToWasmNative(targetSource),
        compileFenelToLlvmNative(targetSource),
      ]) {
        expect(result.$tag).toBe("Ok");
        if (result.$tag !== "Ok") continue;
        expect(result._0.fieldSlots[0]?.key).toEqual(expectedSlot.key);
        const nestedSlots = compileFieldSlotListOccurrences(result._0)
          .flatMap((occurrence) => Array.isArray(occurrence.value) ? occurrence.value : []);
        expect(nestedSlots).toEqual(expect.arrayContaining([
          expect.objectContaining({
            wireName: expectedSlot.wireName,
            key: expectedSlot.key,
          }),
        ]));
        expect(nestedSlots).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ key: otherSlot.key }),
        ]));
      }
    }
  }, REPOSITORY_COMPILER_TEST_TIMEOUT_MS);

  test("explicit owner selection rejects divergent repository definitions", () => {
    const view = getRepositoryCompilerMetadataView();
    expect(() => compileConstructorSlotTable(view, { ownerIds: ["LookupResult"] }))
      .toThrow(/owner LookupResult has conflicting (Conflict|Unique) definitions/);
  }, 120_000);

  test("catalog deduplication uses canonical type semantics, not host serialization order", () => {
    const firstType = {
      $refined: {
        base: { $ref: "String" },
        set: {
          $tag: "SeInterval",
          interval: { lo: { $tag: "Nothing" }, hi: { $tag: "Nothing" } },
        },
      },
    } as FenelType;
    const secondType = {
      $refined: {
        set: {
          interval: { hi: { $tag: "Nothing" }, lo: { $tag: "Nothing" } },
          $tag: "SeInterval",
        },
        base: { $ref: "String" },
      },
    } as FenelType;
    const registry = {
      listIdentifiedEntities: () => [
        variantEntity("SemanticOwner", "SemanticCtor", [{ ...namedSlot("value", UUID_A), type: firstType }]),
        variantEntity("SemanticOwner", "SemanticCtor", [{ ...namedSlot("value", UUID_A), type: secondType }]),
      ],
    };

    expect(compileConstructorSlotTable(registry, { ownerIds: ["SemanticOwner"] })["SemanticCtor"])
      .toEqual([{ ...namedSlot("value", UUID_A), type: firstType }]);
  });

  test("object-correct registry enumeration selects the identified IR definition", () => {
    const rows = getSystemRegistry()
      .listIdentifiedEntities()
      .filter((entity) => entity.id === "CompileFieldSlot");
    expect(rows).toHaveLength(1);
    for (const row of rows) {
      const fields = (row.type as { $record?: { fields?: Array<{ key?: unknown }> } }).$record?.fields ?? [];
      expect(fields.length).toBe(3);
      expect(fields.every((field) => field.key !== undefined)).toBe(true);
    }
  }, REPOSITORY_COMPILER_TEST_TIMEOUT_MS);

  test("entity enumeration keeps exact module owners across module-order reversal", () => {
    const forwardModules = [telegramModule, animationModule, gamesModule];
    const roster = (modules: typeof forwardModules) =>
      deduplicateSemanticEntityOwnerProjections(
        modules.flatMap((module) => (module.entities ?? []).map((entity) => ({
          ...entity,
          module: entity.module ?? module.name,
        }))),
      )
        .filter((entity) => entity.id === "Animation" || entity.id === "Game")
        .map((entity) => ({ id: entity.id, module: entity.module, type: entity.type }))
        .sort((left, right) =>
          `${left.module}\0${left.id}`.localeCompare(`${right.module}\0${right.id}`)
        );

    const forward = roster(forwardModules);
    const reversed = roster([...forwardModules].reverse());
    expect(forward.map(({ id, module }) => [module, id])).toEqual([
      ["animation", "Animation"],
      ["games", "Game"],
      ["telegram", "Animation"],
      ["telegram", "Game"],
    ]);
    expect(reversed).toEqual(forward);
    expect(forward.find((entity) => entity.module === "animation")?.type)
      .not.toEqual(forward.find((entity) => entity.module === "telegram" && entity.id === "Animation")?.type);
    expect(forward.find((entity) => entity.module === "games")?.type)
      .not.toEqual(forward.find((entity) => entity.module === "telegram" && entity.id === "Game")?.type);
  });

  test("unscoped duplicate constructor spelling is omitted; owner scope selects UUID", () => {
    const ownerA = variantEntity("AIResponse", "Parsed", [namedSlot("value", UUID_A)]);
    const ownerB = variantEntity("FieldParseResult", "Parsed", [namedSlot("value", UUID_B)]);
    const registry = {
      // Repeated identical registrations model the target-module projections.
      listIdentifiedEntities: () => [ownerA, ownerB, ownerA],
    };

    expect(compileConstructorSlotTable(registry)["Parsed"]).toBeUndefined();
    const ownerATable = compileConstructorSlotTable(registry, { ownerIds: ["AIResponse"] });
    expect(isCompilerOwnedStableSlotTable(ownerATable)).toBe(true);
    expect(isCompilerOwnedStableSlotList(ownerATable["Parsed"])).toBe(true);
    expect(Object.isFrozen(ownerATable)).toBe(true);
    expect(Object.isFrozen(ownerATable["Parsed"])).toBe(true);
    expect(ownerATable["Parsed"]).toEqual([
      { ...namedSlot("value", UUID_A), type: { $ref: "String" } },
    ]);
    expect(compileConstructorSlotTable(registry, { ownerIds: ["FieldParseResult"] })["Parsed"]).toEqual([
      { ...namedSlot("value", UUID_B), type: { $ref: "String" } },
    ]);
  });

  test("an applied boundary head selects the exact constructor owner", () => {
    const pattern = variantEntity("Pattern", "PatLit", [namedSlot("value", UUID_A)]);
    const corePattern = variantEntity("CorePattern", "PatLit", [namedSlot("value", UUID_B)]);
    const registry = { listIdentifiedEntities: () => [pattern, corePattern] };
    const fn = {
      params: [{
        name: "pattern",
        type: { $el: { call: ["Pattern", { $ref: "Any" }] } },
      }],
      returns: { $ref: "Boolean" },
    } as never;

    expect(compileConstructorSlotTable(registry)["PatLit"]).toBeUndefined();
    const preferredOwnerIds = compileFunctionTypeOwnerIds(fn);
    expect(preferredOwnerIds).toContain("Pattern");
    expect(compileConstructorSlotTable(registry, { preferredOwnerIds })["PatLit"]).toEqual([
      { ...namedSlot("value", UUID_A), type: { $ref: "String" } },
    ]);
  }, 30_000);

  test("constructor tables keep prototype-hostile semantic names as own data", () => {
    const registry = {
      listIdentifiedEntities: () => [
        variantEntity("ProtoOwner", "__proto__", [namedSlot("value", UUID_A)]),
        variantEntity("CtorOwner", "constructor", [namedSlot("value", UUID_B)]),
      ],
    };
    const table = compileConstructorSlotTable(registry);
    expect(Object.getPrototypeOf(table)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(table, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(table, "constructor")).toBe(true);
    expect(table["__proto__"]?.[0]?.key).toEqual(namedSlot("value", UUID_A).key);
    expect(table["constructor"]?.[0]?.key).toEqual(namedSlot("value", UUID_B).key);
  });

  test("constructor tables admit validated lock-less SourceHandles and reject malformed lookalikes", () => {
    const handle = "field:type%3ASourceOwner/named%3Avalue";
    const registry = {
      listIdentifiedEntities: () => [
        variantEntity("SourceOwner", "SourceCtor", [namedSlot("value", handle)]),
      ],
    };
    expect(compileConstructorSlotTable(registry)["SourceCtor"]).toEqual([
      { ...namedSlot("value", handle), type: { $ref: "String" } },
    ]);

    for (const malformed of [
      "field:owner//named%3Avalue",
      "field:owner/named%ZZvalue",
      "field:owner",
      "field:type:owner/named:value",
    ]) {
      expect(() => compileConstructorSlotTable({
        listIdentifiedEntities: () => [
          variantEntity("BadSourceOwner", "BadSourceCtor", [namedSlot("value", malformed)]),
        ],
      })).toThrow("compiler constructor type: invalid semantic slots");
    }
  }, 30_000);

  test("mutable registry inputs invalidate constructor plans by exact marshalled input", () => {
    const entity = variantEntity("MutableOwner", "Before", [namedSlot("value", UUID_A)]);
    let entities = [entity];
    const registry = { listIdentifiedEntities: () => entities };
    const before = compileConstructorSlotTable(registry);
    expect(before["Before"]?.[0]?.key).toEqual(namedSlot("value", UUID_A).key);

    entities = [variantEntity(
      "MutableOwner",
      "After",
      [namedSlot("changed", UUID_B)],
    )];
    const after = compileConstructorSlotTable(registry);
    expect(after).not.toBe(before);
    expect(after["Before"]).toBeUndefined();
    expect(after["After"]?.[0]).toMatchObject(namedSlot("changed", UUID_B));
  }, 30_000);

  test("function owner discovery sees only Fenel-decided type positions", () => {
    const fn = {
      params: [{
        name: "input",
        key: { $tag: "NamedField", ref: { $ref: UUID_A } },
        type: {
          $record: {
            fields: [{
              name: "payload",
              key: { $tag: "NamedField", ref: { $ref: UUID_B } },
              type: {
                $refined: {
                  base: { $ref: "ActualBaseOwner" },
                  set: { $tag: "SeRef", handle: "SetExprFakeOwner", nested: { $ref: "SetRefFakeOwner" } },
                },
              },
              label: { $ref: "LabelFakeOwner" },
              meta: { nested: { $ref: "MetaFakeOwner" } },
              ui: { $tag: "Just", _0: { $ref: "UiFakeOwner" } },
            }, {
              name: "application",
              key: { $tag: "NamedField", ref: { $ref: UUID_A } },
              type: { $el: { call: ["ApplicationHeadOwner", { $ref: "ActualArgumentOwner" }] } },
            }],
          },
        },
      }],
      returns: {
        $opaque: {
          name: "EnvelopeOwner",
          pure: {
            $arrow: {
              params: [{
                name: "arg",
                key: { $tag: "NamedField", ref: { $ref: UUID_A } },
                type: { $ref: "ActualArrowOwner" },
              }],
              returns: {
                $tagged: {
                  value: { $ref: "ActualValueOwner" },
                  phantom: { $ref: "ActualPhantomOwner" },
                },
              },
            },
          },
        },
      },
    } as never;

    expect(compileFunctionTypeOwnerIds(fn)).toEqual([
      "ActualArgumentOwner",
      "ActualArrowOwner",
      "ActualBaseOwner",
      "ActualPhantomOwner",
      "ActualValueOwner",
      "ApplicationHeadOwner",
      "EnvelopeOwner",
    ]);
    expect(compileFunctionTypeOwnerIds(fn)).toBe(compileFunctionTypeOwnerIds(fn));

    (fn as unknown as { returns: FenelType }).returns = { $ref: "MutatedOwner" };
    expect(compileFunctionTypeOwnerIds(fn)).toEqual([
      "ActualArgumentOwner",
      "ActualBaseOwner",
      "ApplicationHeadOwner",
      "MutatedOwner",
    ]);
  });
});

describe("compiler slot ingress delegates semantic policy to Fenel", () => {
  const base = (params: unknown[], ctorDefs?: Record<string, unknown>) => ({
    name: "slotAudit",
    params,
    body: 1,
    requires: [],
    ...(ctorDefs === undefined ? {} : { ctorDefs }),
  });

  test.each([
    ["malformed UUID", [namedSlot("x", "not-a-uuid")]],
    ["duplicate semantic key", [namedSlot("a", UUID_A), namedSlot("b", UUID_A)]],
    ["duplicate wire projection", [namedSlot("a", UUID_A), namedSlot("a", UUID_B)]],
    ["positional ordinal mismatch", [{ key: { $tag: "PositionalField", index: 4 }, wireName: "x" }]],
  ])("rejects %s", (_label, params) => {
    const result = dispatchedNormaliseToCore(base(params as unknown[]) as never);
    expect(result.$tag).toBe("Err");
  });

  test("allows readable positional compiler names when ordinals agree", () => {
    const result = dispatchedNormaliseToCore(base(positionalCompileFieldSlots(["a", "b"])) as never);
    expect(result.$tag).toBe("Ok");
  });

  test("strict constructor ingress preserves prototype-hostile names as own data", () => {
    const rawCtorDefs: Record<string, unknown> = {};
    Object.defineProperty(rawCtorDefs, "__proto__", {
      value: [namedSlot("protoField", UUID_A)],
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(rawCtorDefs, "constructor", {
      value: [namedSlot("constructorField", UUID_B)],
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const result = compileSourceFromUnknown(base([], rawCtorDefs));
    expect(result.$tag).toBe("Ok");
    if (result.$tag !== "Ok") return;

    const checked = result._0.ctorDefs!;
    expect(Object.getPrototypeOf(checked)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(checked, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(checked, "constructor")).toBe(true);
    expect(checked["__proto__"]?.[0]?.key).toEqual(namedSlot("protoField", UUID_A).key);
    expect(checked["constructor"]?.[0]?.key).toEqual(namedSlot("constructorField", UUID_B).key);
  });

  test("strict compiler ingress rejects inherited source and slot semantics", () => {
    const inheritedSource = Object.create(base([namedSlot("value", UUID_A)]));
    expect(compileSourceFromUnknown(inheritedSource).$tag).toBe("Err");

    const inheritedSlot = Object.create(namedSlot("value", UUID_A));
    expect(compileSourceFromUnknown(base([inheritedSlot])).$tag).toBe("Err");

    const inheritedKey = Object.create(namedSlot("value", UUID_A).key);
    expect(compileSourceFromUnknown(base([{ wireName: "value", key: inheritedKey }])).$tag)
      .toBe("Err");

    const inheritedWire = Object.create({ wireName: "value" }) as Record<string, unknown>;
    inheritedWire.key = namedSlot("value", UUID_A).key;
    expect(compileSourceFromUnknown(base([inheritedWire])).$tag).toBe("Err");

    const inheritedSlotKey = Object.create({ key: namedSlot("value", UUID_A).key }) as Record<string, unknown>;
    inheritedSlotKey.wireName = "value";
    expect(compileSourceFromUnknown(base([inheritedSlotKey])).$tag).toBe("Err");

    const inheritedIndex = Object.create({ index: 0 }) as Record<string, unknown>;
    inheritedIndex.$tag = "PositionalField";
    expect(compileSourceFromUnknown(base([{ wireName: "value", key: inheritedIndex }])).$tag)
      .toBe("Err");

    const inheritedRef = Object.create({ ref: { $ref: UUID_A } }) as Record<string, unknown>;
    inheritedRef.$tag = "NamedField";
    expect(compileSourceFromUnknown(base([{ wireName: "value", key: inheritedRef }])).$tag)
      .toBe("Err");

    const refWithInheritedId = Object.create({ $ref: UUID_A });
    expect(compileSourceFromUnknown(base([{
      wireName: "value",
      key: { $tag: "NamedField", ref: refWithInheritedId },
    }])).$tag).toBe("Err");
  });

  test("strict compiler ingress never evaluates inherited optional metadata", () => {
    const inherited = Object.create({
      get requires(): never { throw new Error("inherited requires read"); },
      get ctorDefs(): never { throw new Error("inherited ctorDefs read"); },
      get callBindings(): never { throw new Error("inherited callBindings read"); },
    }) as Record<string, unknown>;
    inherited.name = "own-source";
    inherited.params = [namedSlot("value", UUID_A)];
    inherited.body = 1;
    expect(compileSourceFromUnknown(inherited).$tag).toBe("Ok");
  });

  test("constructor wire DTO ingress is own-data, target-total, and accessor inert", () => {
    const target = "@ctor/compiler-audit/Owner/Ctor";
    const accepted = compileSourceFromUnknown({
      name: "wireDto",
      params: [],
      body: { construct: [target] },
      ctorDefs: { [target]: [] },
      ctorWireNames: { [target]: "Ctor" },
    });
    expect(accepted.$tag).toBe("Ok");
    if (accepted.$tag === "Ok") {
      expect(accepted._0.ctorWireNames?.[target]).toBe("Ctor");
      expect(Object.getPrototypeOf(accepted._0.ctorWireNames)).toBeNull();
      expect(Object.isFrozen(accepted._0.ctorWireNames)).toBe(true);
    }

    const missingTarget = compileSourceFromUnknown({
      name: "wireDtoMissing",
      params: [],
      body: 1,
      ctorDefs: { Known: [] },
      ctorWireNames: { [target]: "Ctor" },
    });
    expect(missingTarget.$tag).toBe("Err");
    if (missingTarget.$tag === "Err") {
      expect(missingTarget._0).toMatchObject({
        $tag: "Unsupported",
        reason: expect.stringContaining("has no ctorDefs entry"),
      });
    }

    for (const [sourceCtor, wireName] of [
      [target, "@ctor/compiler-audit/Other/Ctor"],
      ["Ctor", target],
    ] as const) {
      const reservedProjection = compileSourceFromUnknown({
        name: "wireDtoReservedProjection",
        params: [],
        body: { construct: [sourceCtor] },
        ctorDefs: { [sourceCtor]: [] },
        ctorWireNames: { [sourceCtor]: wireName },
      });
      expect(reservedProjection.$tag).toBe("Err");
      if (reservedProjection.$tag === "Err") {
        expect(reservedProjection._0).toMatchObject({
          $tag: "Unsupported",
          reason: expect.stringContaining("reserved @ctor/ semantic-target namespace"),
        });
      }
    }

    let getterCalls = 0;
    const accessorMap: Record<string, unknown> = {};
    Object.defineProperty(accessorMap, target, {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("constructor wire getter invoked");
      },
    });
    const accessorResult = compileSourceFromUnknown({
      name: "wireDtoAccessor",
      params: [],
      body: 1,
      ctorDefs: { [target]: [] },
      ctorWireNames: accessorMap,
    });
    expect(accessorResult.$tag).toBe("Err");
    expect(getterCalls).toBe(0);
  });

  test("compiler slot locator reads only dense own data and keeps accessors inert", () => {
    let getterCalls = 0;
    const accessorSlot: Record<string, unknown> = Object.create({
      inherited: "ignored",
    });
    Object.defineProperty(accessorSlot, "wireName", {
      value: "payload",
      enumerable: false,
    });
    Object.defineProperty(accessorSlot, "key", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("slot key getter invoked");
      },
    });
    const construct: Record<string, unknown> = Object.create(null);
    Object.defineProperty(construct, "$tag", { value: "EConstruct", enumerable: false });
    Object.defineProperty(construct, "fields", { value: [accessorSlot], enumerable: false });

    const inheritedConstruct = Object.create({
      $tag: "EConstruct",
      get fields(): never {
        getterCalls += 1;
        throw new Error("inherited fields getter invoked");
      },
    });
    const accessorConstruct: Record<string, unknown> = { $tag: "EConstruct" };
    Object.defineProperty(accessorConstruct, "fields", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("construct fields getter invoked");
      },
    });
    const occurrences = compileFieldSlotListOccurrences({
      $tag: "CoreProgram",
      params: [namedSlot("arg", UUID_A)],
      body: { nodes: [construct, inheritedConstruct, accessorConstruct] },
    });

    expect(getterCalls).toBe(0);
    const located = occurrences.find((row) => row.path === "$.body.nodes[0].fields");
    expect(Array.isArray(located?.value)).toBe(true);
    const snapshotted = (located?.value as Array<Record<string, unknown>>)[0]!;
    expect(Object.getPrototypeOf(snapshotted)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(snapshotted, "wireName")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snapshotted, "key")).toBe(false);
    expect(occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.body.nodes[2].fields", value: undefined }),
    ]));
    expect(occurrences.some((row) => row.path.includes("nodes[1].fields"))).toBe(false);
  });

  test("compiler slot locator fails closed on sparse, accessor-indexed, and cyclic graphs", () => {
    const sparse = new Array(1);
    expect(compileFieldSlotListOccurrences({
      $tag: "CoreProgram",
      params: sparse,
      body: { $tag: "EVar", name: "x" },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.params", value: undefined }),
    ]));

    let getterCalls = 0;
    const accessorIndexed = new Array(1);
    Object.defineProperty(accessorIndexed, "0", {
      get(): never {
        getterCalls += 1;
        throw new Error("array index getter invoked");
      },
    });
    expect(compileFieldSlotListOccurrences({
      $tag: "CoreProgram",
      params: accessorIndexed,
      body: { $tag: "EVar", name: "x" },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.params", value: undefined }),
    ]));
    expect(getterCalls).toBe(0);

    const body: Record<string, unknown> = {};
    body.loop = body;
    expect(compileFieldSlotListOccurrences({
      $tag: "CoreProgram",
      params: [namedSlot("x", UUID_A)],
      body,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.body.loop", value: undefined }),
    ]));
  });

  test("function metadata projection rejects inherited/accessor carriers without invoking them", () => {
    let getterCalls = 0;
    const accessorFn: Record<string, unknown> = { returns: { $ref: "Number" } };
    Object.defineProperty(accessorFn, "params", {
      get(): never {
        getterCalls += 1;
        throw new Error("params getter invoked");
      },
    });
    expect(() => compileFunctionParamSlots(accessorFn as never)).toThrow("params must be own data");
    expect(() => compileFunctionTypeOwnerIds(accessorFn as never)).toThrow("params must be own data");

    const inheritedFn = Object.create({ params: [namedSlot("x", UUID_A)] });
    inheritedFn.returns = { $ref: "Number" };
    expect(() => compileFunctionParamSlots(inheritedFn)).toThrow("params must be own data");

    const cyclicType: Record<string, unknown> = {};
    cyclicType.self = cyclicType;
    expect(() => compileFunctionTypeOwnerIds({
      params: [{ name: "x", type: cyclicType }],
      returns: { $ref: "Number" },
    } as never)).toThrow("cyclic metadata");

    const accessorRef: Record<string, unknown> = {};
    Object.defineProperty(accessorRef, "$ref", {
      get(): never {
        getterCalls += 1;
        throw new Error("nested type getter invoked");
      },
    });
    expect(() => compileFunctionTypeOwnerIds({
      params: [{ name: "x", type: accessorRef }],
      returns: { $ref: "Number" },
    } as never)).toThrow();
    expect(getterCalls).toBe(0);
  });

  test("function and constructor owner discovery preflight complete TraversalType slots", () => {
    const keyless = {
      $record: {
        fields: [{ name: "lost", type: { $ref: "String" } }],
      },
    } as FenelType;
    expect(() => compileFunctionTypeOwnerIds({
      params: [{ name: "arg", type: keyless }],
      returns: { $ref: "Number" },
    } as never)).toThrow("compiler function type owners: invalid semantic slots");

    const registry = {
      listIdentifiedEntities: () => [{
        id: "BadOwner",
        type: {
          $variant: {
            cases: [{ name: "Bad", fields: [{ name: "lost", type: { $ref: "String" } }] }],
          },
        } as FenelType,
      }],
    };
    expect(() => compileConstructorSlotTable(registry))
      .toThrow("compiler constructor type: invalid semantic slots");
  });

  test("constructor metadata registry and rows require dense own-data capabilities", () => {
    let getterCalls = 0;
    const inheritedRegistry = Object.create({
      get listIdentifiedEntities(): never {
        getterCalls += 1;
        throw new Error("registry getter invoked");
      },
    });
    expect(() => compileConstructorSlotTable(inheritedRegistry))
      .toThrow("listIdentifiedEntities must be an own data function");

    const accessorRegistry: Record<string, unknown> = {};
    Object.defineProperty(accessorRegistry, "listIdentifiedEntities", {
      get(): never {
        getterCalls += 1;
        throw new Error("registry accessor invoked");
      },
    });
    expect(() => compileConstructorSlotTable(accessorRegistry as never))
      .toThrow("listIdentifiedEntities must be an own data function");

    expect(() => compileConstructorSlotTable({
      listIdentifiedEntities: () => new Array(1),
    } as never)).toThrow("sparse or inherited index 0");

    const entity: Record<string, unknown> = { id: "AccessorOwner" };
    Object.defineProperty(entity, "type", {
      get(): never {
        getterCalls += 1;
        throw new Error("entity type getter invoked");
      },
    });
    expect(() => compileConstructorSlotTable({
      listIdentifiedEntities: () => [entity],
    } as never)).toThrow("type must be own data");

    const nestedAccessorType: Record<string, unknown> = {};
    Object.defineProperty(nestedAccessorType, "$ref", {
      get(): never {
        getterCalls += 1;
        throw new Error("nested entity type getter invoked");
      },
    });
    expect(() => compileConstructorSlotTable({
      listIdentifiedEntities: () => [{ id: "NestedAccessorOwner", type: nestedAccessorType }],
    } as never)).toThrow();
    expect(getterCalls).toBe(0);
  });

  test("strict compiler ingress canonicalizes accepted source and slots to own data", () => {
    const result = compileSourceFromUnknown(base([namedSlot("value", UUID_A)]));
    expect(result.$tag).toBe("Ok");
    if (result.$tag !== "Ok") return;
    expect(Object.getPrototypeOf(result._0)).toBeNull();
    expect(Object.getPrototypeOf(result._0.params[0])).toBeNull();
    expect(Object.getPrototypeOf(result._0.params[0]!.key)).toBeNull();
    if (result._0.params[0]!.key.$tag === "NamedField") {
      expect(Object.getPrototypeOf(result._0.params[0]!.key.ref)).toBeNull();
    }
  });

  test("standalone self-host fixtures declare positional identity explicitly", () => {
    expect(compileFunctionParamSlots(effectfulCanary)).toEqual([{
      key: { $tag: "PositionalField", index: 0 },
      wireName: "v",
      type: { $ref: "Number" },
    }]);

    const constructorSlot = namedSlot("value", UUID_A);
    const sampleInput = buildNormaliseToCoreSamples({ Just: [constructorSlot] })[0]?.[0] as {
      ctorDefs?: unknown[];
    };
    expect(sampleInput.ctorDefs).toEqual([{
      $tag: "CtorDefEntry",
      name: "Just",
      wireName: "Just",
      fields: [constructorSlot],
      ambiguous: false,
    }]);
  });

  test("registered intermediate pass rejects keyless params and construct metadata", () => {
    const keylessParams = dispatchedMakeEffectsExplicit({
      $tag: "CoreProgram",
      name: "bad",
      params: [{ wireName: "x" }],
      body: { $tag: "EVar", name: "x" },
      requires: [],
    } as never);
    expect(keylessParams.$tag).toBe("Err");

    const keylessConstruct = dispatchedMakeEffectsExplicit({
      $tag: "CoreProgram",
      name: "badConstruct",
      params: [namedSlot("x", UUID_A)],
      body: {
        $tag: "EConstruct",
        ctor: "C",
        args: [{ $tag: "EVar", name: "x" }],
        fields: [{ wireName: "payload" }],
      },
      requires: [],
    } as never);
    expect(keylessConstruct.$tag).toBe("Err");
  });
});

test("named UUID metadata survives Core and all three target modules", () => {
  const parameter = namedSlot("renamed", UUID_A);
  const ctorField = namedSlot("payload", UUID_B);
  const source: CompileSource = {
    name: "identityAudit",
    params: [parameter],
    body: { construct: ["IdentityAudit", { payload: { var: "renamed" } }] },
    requires: [],
    ctorDefs: { IdentityAudit: [ctorField] },
  };

  const core = dispatchedNormaliseToCore(source);
  expect(core.$tag).toBe("Ok");
  if (core.$tag === "Ok") {
    expect(core._0.params).toEqual([parameter]);
    expect((core._0.body as { fields?: unknown }).fields).toEqual([ctorField]);
  }

  const js = compileFenelToJsNative(source);
  const wasm = compileFenelToWasmNative(source);
  const llvm = compileFenelToLlvmNative(source);
  expect(js.$tag).toBe("Ok");
  expect(wasm.$tag).toBe("Ok");
  expect(llvm.$tag).toBe("Ok");
  if (js.$tag === "Ok") expect(js._0.fieldSlots).toEqual([parameter]);
  if (wasm.$tag === "Ok") {
    expect(wasm._0.fieldSlots).toEqual([parameter]);
    expect(wasm._0.componentExports?.[0]?.params).toEqual([parameter]);
  }
  if (llvm.$tag === "Ok") expect(llvm._0.fieldSlots).toEqual([parameter]);
});

test("exact constructor targets select owner fields before every backend emits the short wire tag", () => {
  const leftTarget = "@ctor/compile-left/Shared/Dup";
  const rightTarget = "@ctor/compile-right/Shared/Dup";
  const leftSlot = namedSlot("leftValue", UUID_A);
  const rightSlot = namedSlot("rightValue", UUID_B);
  const registry = {
    listIdentifiedEntities: () => [{
      ...variantEntity("Shared", "Dup", [leftSlot]),
      module: "compile-left",
    }, {
      ...variantEntity("Shared", "Dup", [rightSlot]),
      module: "compile-right",
    }],
  };
  const ctorDefs = compileConstructorSlotTable(registry);
  expect(ctorDefs.Dup).toBeUndefined();
  expect(ctorDefs[leftTarget]).toEqual([{ ...leftSlot, type: { $ref: "String" } }]);
  expect(ctorDefs[rightTarget]).toEqual([{ ...rightSlot, type: { $ref: "String" } }]);
  expect(compileConstructorWireName(ctorDefs, leftTarget)).toBe("Dup");
  expect(compileConstructorWireName(ctorDefs, rightTarget)).toBe("Dup");

  const source: CompileSource = {
    name: "exactConstructorWireAudit",
    params: [namedSlot("input", UUID_A)],
    body: {
      match: [
        { construct: [leftTarget, { leftValue: { var: "input" } }] },
        { $tag: leftTarget, leftValue: { $bind: "selected" } },
        { var: "selected" },
        "_",
        null,
      ],
    },
    requires: [],
    ctorDefs,
    ctorWireNames: compileConstructorWireNames(ctorDefs),
  };
  const core = dispatchedNormaliseToCore(source);
  expect(core.$tag).toBe("Ok");
  expect(JSON.stringify(core)).not.toContain(leftTarget);
  expect(JSON.stringify(core)).toContain('"ctor":"Dup"');
  if (core.$tag === "Ok") {
    const coreText = JSON.stringify(core._0.body);
    expect(coreText.match(/"ctor":"Dup"/g)?.length).toBe(2);
    expect(coreText).toContain(UUID_A);
    expect(coreText).not.toContain(UUID_B);
  }

  const js = compileFenelToJsNative(source);
  const wasm = compileFenelToWasmNative(source);
  const llvm = compileFenelToLlvmNative(source);
  expect(js.$tag).toBe("Ok");
  expect(wasm.$tag).toBe("Ok");
  expect(llvm.$tag).toBe("Ok");
  expect(JSON.stringify(js)).not.toContain(leftTarget);
  expect(JSON.stringify(wasm)).not.toContain(leftTarget);
  expect(JSON.stringify(llvm)).not.toContain(leftTarget);

  const missingProjection = dispatchedNormaliseToCore({
    ...source,
    ctorWireNames: undefined,
  });
  expect(missingProjection.$tag).toBe("Err");
  if (missingProjection.$tag === "Err") {
    expect(missingProjection._0).toMatchObject({
      $tag: "Unsupported",
      reason: "constructor wire projection must leave the reserved @ctor namespace",
    });
  }

  for (const [sourceCtor, wireName] of [
    [leftTarget, rightTarget],
    ["Dup", leftTarget],
  ] as const) {
    const malformedSource = {
      name: "reservedConstructorWireAudit",
      params: [],
      requires: [],
      ctorDefs: { [sourceCtor]: [] },
      ctorWireNames: { [sourceCtor]: wireName },
    };
    for (const body of [
      { construct: [sourceCtor] },
      { match: [null, { $tag: sourceCtor }, true, "_", false] },
    ]) {
      const rejected = dispatchedNormaliseToCore({ ...malformedSource, body });
      expect(rejected.$tag).toBe("Err");
      if (rejected.$tag === "Err") {
        expect(rejected._0).toMatchObject({
          $tag: "Unsupported",
          reason: "constructor wire projection must leave the reserved @ctor namespace",
        });
      }
    }
  }
}, REPOSITORY_COMPILER_TEST_TIMEOUT_MS);
