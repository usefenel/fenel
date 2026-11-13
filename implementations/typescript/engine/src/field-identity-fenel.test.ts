import { describe, expect, test } from "bun:test";
import FIELD_IDENTITY_SOURCE from "../../../../fenel/modules/engine/field-identity.fenel?raw";
import FIELD_KEY_SOURCE from "../../../../fenel/modules/engine/field-key.fenel?raw";
import {
  __engineHarnessResolverArtifactFreshForTests,
  dispatchEngineBody,
  setResolverInterpreted,
  withInterpretedResolver,
} from "./engine-bodies-dispatch";
import {
  fieldIdentitySourceKeyToWire,
  normalizeFieldDeclarations,
  tryNormalizeFieldDeclarations,
  type FieldIdentityCollectionOptions,
  type FieldIdentityRealm,
} from "./field-identity";
import { loadFenelModule } from "./fenel-module";
import { engineModule } from "./modules/engine";
import { createEngineBootstrapRegistry } from "./registry";
import type { FenelType, FieldDef, FieldKey } from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };
const UUID_A = "20000000-0000-4000-8000-000000000001";
const UUID_B = "20000000-0000-4000-8000-000000000002";

function field(name: string, type: FenelType = StringT, key?: FieldKey): FieldDef {
  return {
    name,
    type,
    ...(key === undefined ? {} : { key }),
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function typeRoot(
  id: string,
  type: FenelType,
  realm: FieldIdentityRealm = "repository-source",
  module = "matrix",
) {
  return {
    kind: "type" as const,
    realm,
    entity: { id, module, type },
  };
}

const sourceOptions: FieldIdentityCollectionOptions = {
  mode: "source-handles",
};

describe("field normalization resolver representation", () => {
  test("certified and forced interpreted resolution preserve the complete result and refusals", () => {
    const roots = [typeRoot("ResolverParity", {
      $record: { fields: [field("first"), field("second")] },
    })];
    const requirements = withInterpretedResolver(() => normalizeFieldDeclarations(roots, {
      mode: "collect-requirements", lock: new Map(),
    }));
    expect(requirements.lockRequests).toHaveLength(2);
    const lock = new Map(requirements.lockRequests.map((row, index) => [row.name, index === 0 ? UUID_A : UUID_B] as const));
    const strict: FieldIdentityCollectionOptions = {
      mode: "strict-embedded", lock,
      identityKinds: new Map([[UUID_A, "field"], [UUID_B, "field"]]),
    };
    const agree = (input: Parameters<typeof tryNormalizeFieldDeclarations>[0], options: FieldIdentityCollectionOptions) => {
      const before = structuredClone({ input, options });
      const compiled = tryNormalizeFieldDeclarations(input, options);
      const interpreted = withInterpretedResolver(() => tryNormalizeFieldDeclarations(input, options));
      expect(compiled).toEqual(interpreted);
      expect({ input, options }).toEqual(before);
      return compiled;
    };
    setResolverInterpreted(false);
    try {
      // A stale artifact must not turn this into two interpreted-only runs.
      expect(__engineHarnessResolverArtifactFreshForTests()).toBe(true);
      const valid = agree(roots, strict);
      expect(valid.ok).toBe(true);
      if (valid.ok) {
        expect(valid.value.occurrences.map(row => row.field.key)).toEqual([
          { $tag: "NamedField", ref: { $ref: UUID_A } },
          { $tag: "NamedField", ref: { $ref: UUID_B } },
        ]);
        expect(valid.value.viewPlans).toHaveLength(1);
      }
      expect(agree(roots, { ...strict, lock: new Map() })).toMatchObject({
        ok: false, error: { $tag: "MissingRepositoryFieldLock" },
      });
      expect(agree([typeRoot("WrongKind", {
        $record: { fields: [field("first", StringT, { $tag: "NamedField", ref: { $ref: UUID_A } })] },
      }, "account-authored")], {
        mode: "strict-embedded", identityKinds: new Map([[UUID_A, "type"]]),
      })).toMatchObject({ ok: false, error: { $tag: "WrongFieldIdentityKind" } });
      expect(agree([
        typeRoot("Shared", { $record: { fields: [field("alpha")] } }, "repository-source", "alpha"),
        typeRoot("Shared", { $record: { fields: [field("beta")] } }, "repository-source", "beta"),
        typeRoot("Consumer", { $opaque: { name: "Shared", pure: { $record: { fields: [field("unresolved")] } } } }, "repository-source", "gamma"),
      ], sourceOptions)).toMatchObject({ ok: false, error: { $tag: "AmbiguousNominalFieldOwner" } });
    } finally {
      setResolverInterpreted(null);
    }
  }, 90_000);
});

describe("Fenel-owned field identity model", () => {
  test("the realizable ADTs load as language entities and the public body dispatches", () => {
    // FieldRef and FieldKey are declared in field-key.fenel, the rest here.
    const loaded = [
      loadFenelModule(FIELD_KEY_SOURCE, "engine"),
      loadFenelModule(FIELD_IDENTITY_SOURCE, "engine"),
    ];
    const required = [
      "Field",
      "FieldRef",
      "FieldKey",
      "FieldOwner",
      "FieldIdentityRealm",
      "FieldIdentityMode",
      "FieldPathSegment",
      "FieldIdentityCollection",
      "FieldIdentityError",
    ];
    const loadedIds = new Set(loaded.flatMap((module) => (module.entities ?? []).map((entity) => entity.id)));
    const catalogIds = new Set((engineModule.entities ?? []).map((entity) => entity.id));
    const registry = createEngineBootstrapRegistry([engineModule]);
    for (const id of required) {
      expect(loadedIds.has(id)).toBe(true);
      expect(catalogIds.has(id)).toBe(true);
      expect(registry.getEntity(id)).toBeDefined();
    }

    expect(dispatchEngineBody("engine:fieldIdentityNormalizeTypeOwner", [
      { $tag: "Just", _0: "demo" },
      "demo:Thing",
    ])).toEqual({
      $tag: "TypeFieldOwner",
      module: { $tag: "Just", _0: "demo" },
      localId: "Thing",
    });
  }, 30_000);

  test("attachment-chain resolution prefers exact occurrences and rejects ambiguous or cyclic witnesses", () => {
    const owner = {
      $tag: "TypeFieldOwner",
      module: { $tag: "Just", _0: "matrix" },
      localId: "AttachmentResolution",
    } as const;
    const attachment = (actualToken: string, templateToken: string, qname = "q") => ({
      $tag: "FieldIdentityAttachment",
      owner,
      actualToken,
      templateToken,
      templateQualifiedName: qname,
    });
    const resolve = (
      attachments: ReturnType<typeof attachment>[],
      occurrences: Array<{ token: string; qualifiedName: string }>,
      incoming: ReturnType<typeof attachment>,
    ) => dispatchEngineBody("engine:fieldIdentitySpecializationResolveAttachment", [
      attachments,
      occurrences,
      [],
      incoming,
    ]) as { matched: boolean; attachment: ReturnType<typeof attachment> };

    const occurrenceFirst = resolve(
      [attachment("middle", "other")],
      [{ token: "middle", qualifiedName: "q" }],
      attachment("actual", "middle"),
    );
    expect(occurrenceFirst.matched).toBe(true);
    expect(occurrenceFirst.attachment.templateToken).toBe("middle");
    expect(resolve(
      [attachment("middle", "left"), attachment("middle", "right")],
      [],
      attachment("actual", "middle"),
    ).matched).toBe(false);
    expect(resolve(
      [attachment("middle", "next", "other-q")],
      [],
      attachment("actual", "middle"),
    ).matched).toBe(false);
    expect(resolve(
      [attachment("middle", "next"), attachment("next", "middle")],
      [],
      attachment("actual", "middle"),
    ).matched).toBe(false);
    expect(resolve(
      [],
      [{ token: "middle", qualifiedName: "other-q" }],
      attachment("actual", "middle"),
    ).matched).toBe(false);
  });

  test("one traversal boundary covers every structural role and terminates through mu/opaque", () => {
    const leaf = (name: string): FenelType => ({
      $record: { fields: [field(name)] },
    });
    const type: FenelType = {
      $record: {
        fields: [
          field("record", leaf("recordLeaf")),
          field("variant", {
            $variant: {
              cases: [{ name: "Case", label: Nothing, fields: [field("caseLeaf")] }],
            },
          }),
          field("arrow", {
            $arrow: { params: [field("paramLeaf")], returns: leaf("returnLeaf") },
          }),
          field("tuple", { $tuple: [leaf("tupleLeaf")] }),
          field("app", { $el: { call: ["Carrier", leaf("appLeaf")] } } as FenelType),
          field("map", { $map: { keys: { $tag: "SeAll" }, values: leaf("mapLeaf") } }),
          field("refined", {
            $refined: { base: leaf("refinedLeaf"), set: { $tag: "SeAll" } },
          }),
          field("union", { $union: [leaf("unionLeaf")] }),
          field("intersect", { $intersect: [leaf("intersectLeaf")] }),
          field("complement", { $complement: leaf("complementLeaf") }),
          field("tagged", {
            $tagged: { value: leaf("valueLeaf"), phantom: leaf("phantomLeaf") },
          }),
          field("mu", { $mu: { var: "X", body: leaf("muLeaf") } }),
          field("opaque", { $opaque: { name: "Inline", pure: leaf("opaqueLeaf") } }),
        ],
      },
    };
    const result = normalizeFieldDeclarations([typeRoot("AllRoles", type)], sourceOptions);
    const tags = new Set(result.occurrences.flatMap((occurrence) =>
      occurrence.path.map((segment) => segment.$tag)
    ));
    for (const tag of [
      "FieldNamed",
      "FieldCase",
      "FieldArrowReturn",
      "FieldTuple",
      "FieldTypeArg",
      "FieldMapValue",
      "FieldRefinedBase",
      "FieldUnion",
      "FieldIntersect",
      "FieldComplement",
      "FieldTaggedValue",
      "FieldTaggedPhantom",
    ] as const) expect(tags.has(tag)).toBe(true);
    expect(result.occurrences.some((item) => item.field.name === "muLeaf")).toBe(true);
    expect(result.occurrences.some((item) => item.field.name === "opaqueLeaf")).toBe(true);
  });

  test("typed path roles and URL encoding keep hostile authored names injective", () => {
    const names = ["_return", "/", "case:x", "%2F", "space name", "é"];
    const type: FenelType = { $record: { fields: names.map((name) => field(name)) } };
    const result = normalizeFieldDeclarations([typeRoot("Encoding", type)], sourceOptions);
    const qualified = result.occurrences.map((item) => item.qualifiedName);
    expect(new Set(qualified).size).toBe(names.length);
    expect(qualified.some((name) => name.includes("%252F"))).toBe(true);
    expect(qualified.some((name) => name.includes("%2F"))).toBe(true);
    expect(qualified.some((name) => name.includes("%20"))).toBe(true);
  });

  test("sibling serialization matches the public owner/path serializers for hostile names", () => {
    const typeOwner = { $tag: "TypeFieldOwner", module: { $tag: "Just", _0: "m /%é" }, localId: "owner😀" };
    const owners = [
      typeOwner,
      { $tag: "TypeFieldOwner", module: Nothing, localId: "owner /%é" },
      { $tag: "FunctionFieldOwner", id: "function /%é" },
      { $tag: "InlineNominalFieldOwner", parent: typeOwner, name: "inline /%é" },
    ];
    const parents = [[], [
      { $tag: "FieldCase", name: "case /%é" },
      { $tag: "FieldTuple", index: 2 },
      { $tag: "FieldNamed", name: "parent😀" },
    ]];
    const names = ["first /%é", "second😀", "constructor", "__proto__", "_return"];
    for (const owner of owners) for (const parent of parents) {
      const fields = names.map((name, index) => ({
        name, token: `sibling-${index}`, raw: field(name),
        key: { $tag: "NoFieldKey" }, type: { $tag: "TtNamed", name: "String" },
      }));
      const result = dispatchEngineBody("engine:fieldIdentityWalkFields", [
        fields, owner, parent, Nothing, { $tag: "RepositorySource" },
        { realm: { $tag: "RepositorySource" }, mode: { $tag: "SourceHandles" }, lockIndex: {} },
        { occurrences: [], inlineDefs: [], needsMint: [], attachments: [], ownedTokens: [], error: Nothing },
      ]) as { error: { $tag: string }; occurrences: Array<{ qualifiedName: string; ownerLookupKey: string; containerName: string; path: unknown[] }> };
      expect(result.error).toEqual(Nothing);
      expect(result.occurrences).toHaveLength(names.length);
      for (const occurrence of result.occurrences) {
        expect(occurrence.qualifiedName).toBe(dispatchEngineBody("engine:fieldIdentityQualifiedName", [owner, occurrence.path]) as string);
        expect(occurrence.ownerLookupKey).toBe(dispatchEngineBody("engine:fieldIdentityQualifiedName", [owner, []]) as string);
        expect(occurrence.containerName).toBe(dispatchEngineBody("engine:fieldIdentityContainerName", [owner, parent]) as string);
      }
    }
  });

  test("serialization sharing preserves empty lists, token skips and malformed-string refusal order", () => {
    const validOwner = { $tag: "TypeFieldOwner", module: Nothing, localId: "RefusalOrder" };
    const malformedOwner = { ...validOwner, localId: "bad\uD800" };
    const marker = (name: string, token = name) => ({
      name, token, raw: field(name), key: { $tag: "NoFieldKey" }, type: { $tag: "TtNamed", name: "String" },
    });
    const state = { occurrences: [], inlineDefs: [], needsMint: [], attachments: [], ownedTokens: [] as string[], error: Nothing };
    const walk = (fields: ReturnType<typeof marker>[], owner = validOwner, parent: unknown[] = [], initial = state, strict = false) =>
      dispatchEngineBody("engine:fieldIdentityWalkFields", [
        fields, owner, parent, Nothing, { $tag: "RepositorySource" },
        { realm: { $tag: "RepositorySource" }, mode: { $tag: strict ? "StrictEmbedded" : "SourceHandles" }, lockIndex: {} }, initial,
      ]) as { error: { $tag: string; _0?: { $tag: string } }; occurrences: unknown[]; ownedTokens: string[] };
    const malformedPath = [{ $tag: "FieldNamed", name: "bad\uD800" }];
    expect(walk([], malformedOwner, malformedPath)).toEqual(state);
    expect(walk([marker("bad\uD800", "owned")], malformedOwner, malformedPath, { ...state, ownedTokens: ["owned"] })).toEqual({ ...state, ownedTokens: ["owned"] });
    for (const owner of [validOwner, malformedOwner]) {
      expect(walk([marker("_00"), marker("bad\uD800")], owner, malformedPath).error._0?.$tag).toBe("InvalidPositionalName");
    }
    const afterSibling = walk([marker("valid"), marker("_00"), marker("bad\uD800")]);
    expect(afterSibling.error._0?.$tag).toBe("InvalidPositionalName");
    expect(afterSibling.occurrences).toHaveLength(1);
    expect(walk([marker("first"), marker("bad\uD800")], validOwner, [], state, true).error._0?.$tag).toBe("MissingRepositoryFieldLock");
    expect(() => walk([marker("valid")], malformedOwner)).toThrow();
    expect(() => walk([marker("valid"), marker("bad\uD800")])).toThrow();
  });

  test("distinct typed inline owners cannot alias through the legacy lock serializer", () => {
    const leaf = { $record: { fields: [field("b")] } } satisfies FenelType;
    const direct = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: { id: "inline:type:x:a", type: leaf },
    };
    const nested = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "x",
        type: { $opaque: { name: "a", pure: leaf } } satisfies FenelType,
      },
    };
    const result = tryNormalizeFieldDeclarations([direct, nested], sourceOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.$tag).toBe("DuplicateFieldPath");
      expect(result.error.message).toContain("typed owner/path values collide");
    }
  });

  test("active raw cycles become deterministic TtUnknown back-edges", () => {
    const cycle = { $record: { fields: [] as FieldDef[] } } satisfies FenelType;
    cycle.$record.fields.push(field("self", cycle));
    const first = normalizeFieldDeclarations([typeRoot("Cycle", cycle)], sourceOptions);
    const second = normalizeFieldDeclarations([typeRoot("Cycle", cycle)], sourceOptions);
    expect(first.occurrences.map((item) => item.qualifiedName)).toEqual(
      second.occurrences.map((item) => item.qualifiedName),
    );
    expect(first.occurrences).toHaveLength(1);
  });
});

describe("realm, mode, reuse, and structural integrity", () => {
  test("repository/account/transient combinations enforce their distinct ingress rules", () => {
    const missing = typeRoot("Missing", { $record: { fields: [field("name")] } });
    const strict = tryNormalizeFieldDeclarations([missing], {
      mode: "strict-embedded",
      lock: new Map(),
    });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.error.$tag).toBe("MissingRepositoryFieldLock");

    const collected = normalizeFieldDeclarations([missing], {
      mode: "collect-requirements",
      lock: new Map(),
    });
    expect(collected.lockRequests).toHaveLength(1);

    const accountMissing = tryNormalizeFieldDeclarations([
      typeRoot("AccountMissing", { $record: { fields: [field("name")] } }, "account-authored"),
    ], { mode: "strict-embedded", lock: new Map() });
    expect(accountMissing.ok).toBe(false);
    if (!accountMissing.ok) expect(accountMissing.error.$tag).toBe("AccountFieldNeedsUuid");

    const accountUuidAsName = tryNormalizeFieldDeclarations([
      typeRoot(
        "AccountUuidAsName",
        { $record: { fields: [field(UUID_A)] } },
        "account-authored",
      ),
    ], { mode: "strict-embedded", lock: new Map() });
    expect(accountUuidAsName.ok).toBe(false);
    if (!accountUuidAsName.ok) {
      expect(accountUuidAsName.error.$tag).toBe("AccountFieldNeedsUuid");
    }

    const explicit = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const account = normalizeFieldDeclarations([
      typeRoot("Account", { $record: { fields: [field("name", StringT, explicit)] } }, "account-authored"),
    ], { mode: "strict-embedded", lock: new Map() });
    expect(account.entities[0]?.id).toBe(UUID_A);

    const draft = normalizeFieldDeclarations([
      typeRoot("Draft", { $record: { fields: [field("name")] } }, "transient-draft"),
    ], { mode: "source-handles" });
    expect(draft.needsMint).toHaveLength(1);
    const invalidDraft = tryNormalizeFieldDeclarations([
      typeRoot("Draft", { $record: { fields: [field("name")] } }, "transient-draft"),
    ], { mode: "strict-embedded", lock: new Map() });
    expect(invalidDraft.ok).toBe(false);
    if (!invalidDraft.ok) expect(invalidDraft.error.$tag).toBe("InvalidFieldKey");
  });

  test("account code-name collisions never adopt repository pins", () => {
    const root = typeRoot(
      "Collision",
      { $record: { fields: [field("sameName")] } },
      "account-authored",
    );
    const probe = normalizeFieldDeclarations([
      { ...root, realm: "repository-source" as const },
    ], { mode: "collect-requirements", lock: new Map() });
    const lockName = probe.lockRequests[0]!.name;
    const result = tryNormalizeFieldDeclarations([root], {
      mode: "strict-embedded",
      lock: new Map([[lockName, UUID_A]]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("AccountFieldNeedsUuid");
  });

  test("the same typed owner cannot be deduped across repository and account realms", () => {
    const repository = typeRoot(
      "RealmCollision",
      { $record: { fields: [field("sameName")] } },
      "repository-source",
    );
    const account = { ...repository, realm: "account-authored" as const };
    const collected = normalizeFieldDeclarations([repository], {
      mode: "collect-requirements",
      lock: new Map(),
    });
    const lock = new Map([[collected.lockRequests[0]!.name, UUID_A]]);
    for (const roots of [[repository, account], [account, repository]]) {
      const result = tryNormalizeFieldDeclarations(roots, {
        mode: "strict-embedded",
        lock,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe("ConflictingFieldDeclaration");
    }
  });

  test("kind reservations and live external catalogs are separate proofs", () => {
    const explicit = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const root = typeRoot(
      "Reuse",
      { $record: { fields: [field("shared", StringT, explicit)] } },
      "account-authored",
    );
    for (const kind of ["function", "type", "reserved"]) {
      const wrong = tryNormalizeFieldDeclarations([root], {
        mode: "strict-embedded",
        identityKinds: new Map([[UUID_A, kind]]),
      });
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.error.$tag).toBe("WrongFieldIdentityKind");
    }

    const liveKindOnly = tryNormalizeFieldDeclarations([root], {
      mode: "strict-embedded",
      identityKinds: new Map([[UUID_A, "field"]]),
    });
    expect(liveKindOnly.ok).toBe(false);
    if (!liveKindOnly.ok) expect(liveKindOnly.error.$tag).toBe("UnresolvedFieldHandle");

    const external = normalizeFieldDeclarations([root], {
      mode: "strict-embedded",
      identityKinds: new Map([[UUID_A, "field"]]),
      externalFields: [{ id: UUID_A, currentCodeName: "shared" }],
    });
    expect(external.occurrences[0]?.field.key).toEqual(explicit);
  });

  test("normalization reports the first wrong-kind occurrence in encounter order", () => {
    const firstKey = { $tag: "NamedField", ref: { $ref: UUID_B } } as const;
    const secondKey = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const result = tryNormalizeFieldDeclarations([
      typeRoot("OrderedKinds", {
        $record: {
          fields: [
            field("first", StringT, firstKey),
            field("second", StringT, secondKey),
          ],
        },
      }, "account-authored"),
    ], {
      mode: "strict-embedded",
      identityKinds: new Map([
        [UUID_B, "type"],
        [UUID_A, "function"],
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.$tag).toBe("WrongFieldIdentityKind");
      expect(result.error.handle).toBe(UUID_B);
      expect(result.error.actualKind).toBe("type");
    }
  });

  test("same UUID/name reuse succeeds; duplicate seats and simultaneous names fail", () => {
    const key = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const good = normalizeFieldDeclarations([
      typeRoot("A", { $record: { fields: [field("shared", StringT, key)] } }),
      typeRoot("B", { $record: { fields: [field("shared", { $ref: "Number" }, key)] } }),
    ], { mode: "collect-requirements" });
    expect(good.entities).toHaveLength(1);
    expect(good.entities[0]?.occurrences).toHaveLength(2);

    const duplicate = tryNormalizeFieldDeclarations([
      typeRoot("Dup", { $record: { fields: [
        field("first", StringT, key),
        field("second", StringT, key),
      ] } }),
    ], { mode: "collect-requirements" });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.$tag).toBe("DuplicateFieldIdentity");

    const names = tryNormalizeFieldDeclarations([
      typeRoot("A", { $record: { fields: [field("shared", StringT, key)] } }),
      typeRoot("B", { $record: { fields: [field("other", StringT, key)] } }),
    ], { mode: "collect-requirements" });
    expect(names.ok).toBe(false);
    if (!names.ok) expect(names.error.$tag).toBe("FieldCodeableConflict");
  });

  test("canonical declaration equality ignores presentation/property order but rejects semantics", () => {
    const leftField = field("value");
    const rightField = {
      meta: {},
      ui: Nothing,
      type: { $ref: "String" } as FenelType,
      label: { $tag: "Just", _0: "Value" } as const,
      name: "value",
    } satisfies FieldDef;
    const equal = normalizeFieldDeclarations([
      typeRoot("Repeated", { $record: { fields: [leftField] } }),
      typeRoot("Repeated", { $record: { fields: [rightField] } }),
    ], sourceOptions);
    expect(equal.occurrences).toHaveLength(1);
    const duplicateAttachment = equal.attachments.find((item) => item.sourceField === rightField);
    if (duplicateAttachment === undefined) {
      throw new Error("expected duplicate-root attachment witness");
    }
    expect(duplicateAttachment.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: duplicateAttachment.templateQualifiedName },
    });
    expect(duplicateAttachment.templateToken).not.toBe(duplicateAttachment.token);

    const different = tryNormalizeFieldDeclarations([
      typeRoot("Repeated", { $record: { fields: [leftField] } }),
      typeRoot("Repeated", { $record: { fields: [field("value", { $ref: "Number" })] } }),
    ], sourceOptions);
    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.error.$tag).toBe("ConflictingFieldDeclaration");
  });

  test("duplicate-root conflicts retain first conflicting encounter order", () => {
    const result = tryNormalizeFieldDeclarations([
      typeRoot("Zed", { $record: { fields: [field("same")] } }),
      typeRoot("Alpha", { $record: { fields: [field("same")] } }),
      typeRoot("Zed", { $record: { fields: [field("zedConflict", { $ref: "Number" })] } }),
      typeRoot("Alpha", { $record: { fields: [field("alphaConflict", { $ref: "Number" })] } }),
    ], sourceOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.$tag).toBe("ConflictingFieldDeclaration");
      expect(result.error.owner).toMatchObject({
        $tag: "TypeFieldOwner",
        localId: "Zed",
      });
    }
  });

  test("nominal indexes preserve module-local, unique-global, and ambiguous lookup semantics", () => {
    const local = normalizeFieldDeclarations([
      typeRoot("Shared", { $record: { fields: [field("alphaDeclaration")] } }, "repository-source", "alpha"),
      typeRoot("Shared", { $record: { fields: [field("betaDeclaration")] } }, "repository-source", "beta"),
      typeRoot("LocalConsumer", {
        $opaque: {
          name: "Shared",
          pure: { $record: { fields: [field("alphaDeclaration")] } },
        },
      }, "repository-source", "alpha"),
    ], sourceOptions);
    expect(local.occurrences.filter((item) => item.field.name === "alphaDeclaration")).toHaveLength(1);

    const global = normalizeFieldDeclarations([
      typeRoot("Shared", { $record: { fields: [field("declaration")] } }, "repository-source", "alpha"),
      typeRoot("GlobalConsumer", {
        $opaque: {
          name: "Shared",
          pure: { $record: { fields: [field("declaration")] } },
        },
      }, "repository-source", "gamma"),
    ], sourceOptions);
    expect(global.occurrences.filter((item) => item.field.name === "declaration")).toHaveLength(1);

    const ambiguous = tryNormalizeFieldDeclarations([
      typeRoot("Shared", { $record: { fields: [field("alphaDeclaration")] } }, "repository-source", "alpha"),
      typeRoot("Shared", { $record: { fields: [field("betaDeclaration")] } }, "repository-source", "beta"),
      typeRoot("AmbiguousConsumer", {
        $opaque: {
          name: "Shared",
          pure: { $record: { fields: [field("mustNotWalkAmbiguousPure")] } },
        },
      }, "repository-source", "gamma"),
    ], sourceOptions);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error.$tag).toBe("AmbiguousNominalFieldOwner");

    const taggedModule = normalizeFieldDeclarations([
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "Shared",
          type: { $record: { fields: [field("unmoduledDeclaration")] } },
        },
      },
      typeRoot("Shared", { $record: { fields: [field("noneModuleDeclaration")] } }, "repository-source", "none"),
      typeRoot("NoneModuleConsumer", {
        $opaque: {
          name: "Shared",
          pure: { $record: { fields: [field("noneModuleDeclaration")] } },
        },
      }, "repository-source", "none"),
    ], sourceOptions);
    expect(taggedModule.occurrences.filter((item) =>
      item.field.name === "noneModuleDeclaration"
    )).toHaveLength(1);
  });

  test("registered nominal specialization mismatches fail closed", () => {
    const pairTemplate: FenelType = {
      $opaque: {
        name: "ParamPair",
        pure: {
          $record: {
            fields: [
              field("left", { $var: "a" }),
              field("right", { $var: "a" }),
            ],
          },
        },
      },
    };
    const templateRoot = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "ParamPair",
        module: "matrix",
        params: ["a"],
        type: pairTemplate,
      },
    };
    const consumer = (id: string, pure: FenelType) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id,
        module: "matrix",
        type: { $opaque: { name: "ParamPair", pure } } as FenelType,
      },
    });
    const malformed = [
      consumer("WrongConstructor", {
        $variant: { cases: [{ name: "Pair", label: Nothing, fields: [] }] },
      }),
      consumer("WrongArity", {
        $record: { fields: [field("left", StringT)] },
      }),
      consumer("DisagreeingBinder", {
        $record: {
          fields: [
            field("left", StringT),
            field("right", { $ref: "Number" }),
          ],
        },
      }),
    ];

    for (const invalid of malformed) {
      const result = tryNormalizeFieldDeclarations([templateRoot, invalid], sourceOptions);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.$tag).toBe("InvalidNominalSpecialization");
        expect(result.error.name).toBe("ParamPair");
      }
    }
  });

  test("repeated formal representations attach later clone and shared-DAG tokens to the first ordinal", () => {
    const repeatedTemplate = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "RepeatedCarrier",
        module: "matrix",
        params: ["a"],
        type: {
          $opaque: {
            name: "RepeatedCarrier",
            pure: {
              $record: {
                fields: [
                  field("left", { $var: "a" }),
                  field("right", { $var: "a" }),
                ],
              },
            },
          },
        } as FenelType,
      },
    };
    const consumer = (id: string, left: FenelType, right: FenelType) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id,
        module: "matrix",
        type: {
          $opaque: {
            name: "RepeatedCarrier",
            pure: {
              $record: {
                fields: [field("left", left), field("right", right)],
              },
            },
          },
        } as FenelType,
      },
    });

    const firstDeep = field("deep");
    const laterDeep = field("deep");
    const clones = normalizeFieldDeclarations([
      repeatedTemplate,
      consumer(
        "RepeatedCloneConsumer",
        { $record: { fields: [firstDeep] } },
        { $record: { fields: [laterDeep] } },
      ),
    ], sourceOptions);
    const cloneOccurrence = clones.occurrences.find((item) =>
      item.sourceField === firstDeep
      && item.owner.$tag === "TypeFieldOwner"
      && item.owner.localId === "RepeatedCloneConsumer"
    );
    const cloneAlias = clones.attachments.find((item) => item.sourceField === laterDeep);
    if (cloneOccurrence === undefined || cloneAlias === undefined) {
      throw new Error("expected repeated clone occurrence and alias witness");
    }
    expect(cloneOccurrence.path).toEqual([
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "deep" },
    ]);
    expect(cloneAlias.templateToken).toBe(cloneOccurrence.token);
    expect(cloneAlias.templateQualifiedName).toBe(cloneOccurrence.qualifiedName);

    const sharedDeep = field("deep");
    const sharedRepresentation: FenelType = { $record: { fields: [sharedDeep] } };
    const shared = normalizeFieldDeclarations([
      repeatedTemplate,
      consumer("RepeatedSharedConsumer", sharedRepresentation, sharedRepresentation),
    ], sourceOptions);
    expect(shared.occurrences.filter((item) =>
      item.sourceField === sharedDeep
      && item.owner.$tag === "TypeFieldOwner"
      && item.owner.localId === "RepeatedSharedConsumer"
    )).toHaveLength(1);
    expect(shared.attachments.filter((item) => item.sourceField === sharedDeep)).toHaveLength(1);
  });

  test("missing inline nominal proofs keep repeated outer-formal aliases at the outer ordinal", () => {
    const inlinePair = (name: string, left: FenelType, right: FenelType): FenelType => ({
      $opaque: {
        name,
        pure: {
          $record: {
            fields: [field("left", left), field("right", right)],
          },
        },
      },
    });
    const registeredOuter = (
      id: string,
      nominalName: string,
      inline: FenelType,
      params: string[] | undefined,
    ) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id,
        module: "matrix",
        ...(params === undefined ? {} : { params }),
        type: {
          $opaque: {
            name: nominalName,
            pure: { $record: { fields: [field("inline", inline)] } },
          },
        } as FenelType,
      },
    });
    const assertOuterAlias = (
      template: ReturnType<typeof registeredOuter>,
      consumer: ReturnType<typeof registeredOuter>,
      first: FieldDef,
      later: FieldDef,
    ) => {
      const result = normalizeFieldDeclarations([template, consumer], sourceOptions);
      const occurrence = result.occurrences.find((item) => item.sourceField === first);
      const alias = result.attachments.find((item) => item.sourceField === later);
      if (occurrence === undefined || alias === undefined) {
        throw new Error("expected missing-inline repeated-formal witness");
      }
      expect(occurrence.path).toEqual([
        { $tag: "FieldTypeArg", index: 0 },
        { $tag: "FieldNamed", name: "deep" },
      ]);
      expect(alias.templateToken).toBe(occurrence.token);
      expect(alias.templateQualifiedName).toBe(occurrence.qualifiedName);
    };

    const directFirst = field("deep");
    const directLater = field("deep");
    assertOuterAlias(
      registeredOuter(
        "MissingInlineOuter",
        "MissingInlineOuter",
        inlinePair("MissingInlinePair", { $var: "a" }, { $var: "a" }),
        ["a"],
      ),
      registeredOuter(
        "MissingInlineOuterConsumer",
        "MissingInlineOuter",
        inlinePair(
          "MissingInlinePair",
          { $record: { fields: [directFirst] } },
          { $record: { fields: [directLater] } },
        ),
        undefined,
      ),
      directFirst,
      directLater,
    );

    const nestedInline = (left: FenelType, right: FenelType): FenelType => ({
      $opaque: {
        name: "MissingInlineShell",
        pure: {
          $record: {
            fields: [field("nested", inlinePair("MissingInlineNestedPair", left, right))],
          },
        },
      },
    });
    const nestedFirst = field("deep");
    const nestedLater = field("deep");
    assertOuterAlias(
      registeredOuter(
        "MissingNestedInlineOuter",
        "MissingNestedInlineOuter",
        nestedInline({ $var: "a" }, { $var: "a" }),
        ["a"],
      ),
      registeredOuter(
        "MissingNestedInlineOuterConsumer",
        "MissingNestedInlineOuter",
        nestedInline(
          { $record: { fields: [nestedFirst] } },
          { $record: { fields: [nestedLater] } },
        ),
        undefined,
      ),
      nestedFirst,
      nestedLater,
    );

    const registeredInner = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "RegisteredInsideMissingInline",
        module: "matrix",
        params: ["c"],
        type: inlinePair(
          "RegisteredInsideMissingInline",
          { $var: "c" },
          { $var: "c" },
        ),
      },
    };
    const registeredNested = (first: FieldDef, later: FieldDef): FenelType => ({
      $opaque: {
        name: "MissingInlineAroundRegistered",
        pure: {
          $record: {
            fields: [field("nested", inlinePair(
              "RegisteredInsideMissingInline",
              { $record: { fields: [first] } },
              { $record: { fields: [later] } },
            ))],
          },
        },
      },
    });
    const canonicalInnerFirst = field("deep");
    const canonicalInnerLater = field("deep");
    const consumerInnerFirst = field("deep");
    const consumerInnerLater = field("deep");
    const fixedTemplate = registeredOuter(
      "MissingInlineRegisteredOuter",
      "MissingInlineRegisteredOuter",
      registeredNested(canonicalInnerFirst, canonicalInnerLater),
      undefined,
    );
    const fixedConsumer = registeredOuter(
      "MissingInlineRegisteredConsumer",
      "MissingInlineRegisteredOuter",
      registeredNested(consumerInnerFirst, consumerInnerLater),
      undefined,
    );
    const fixedResult = normalizeFieldDeclarations(
      [registeredInner, fixedTemplate, fixedConsumer],
      sourceOptions,
    );
    const fixedOccurrence = fixedResult.occurrences.find((item) =>
      item.sourceField === consumerInnerFirst
    );
    const fixedAlias = fixedResult.attachments.find((item) =>
      item.sourceField === consumerInnerLater
    );
    if (fixedOccurrence === undefined || fixedAlias === undefined) {
      throw new Error("expected independent registered-inner alias through missing inline");
    }
    expect(fixedOccurrence.path).toEqual([
      { $tag: "FieldNamed", name: "inline" },
      { $tag: "FieldNamed", name: "nested" },
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "deep" },
    ]);
    expect(fixedAlias.templateToken).toBe(fixedOccurrence.token);
    expect(fixedAlias.templateQualifiedName).toBe(fixedOccurrence.qualifiedName);
  });

  test("nested repeated formals and equivalent duplicate roots flatten aliases to canonical occurrences", () => {
    const inner = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "NestedRepeatedInner",
        module: "matrix",
        params: ["c"],
        type: {
          $opaque: {
            name: "NestedRepeatedInner",
            pure: {
              $record: {
                fields: [
                  field("left", { $var: "c" }),
                  field("right", { $var: "c" }),
                ],
              },
            },
          },
        } as FenelType,
      },
    };
    const nestedOuter = (first: FieldDef, later: FieldDef) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "NestedRepeatedOuter",
        module: "matrix",
        type: {
          $opaque: {
            name: "NestedRepeatedOuter",
            pure: {
              $record: {
                fields: [field("inner", {
                  $opaque: {
                    name: "NestedRepeatedInner",
                    pure: {
                      $record: {
                        fields: [
                          field("left", { $record: { fields: [first] } }),
                          field("right", { $record: { fields: [later] } }),
                        ],
                      },
                    },
                  },
                })],
              },
            },
          },
        } as FenelType,
      },
    });

    const canonicalFirst = field("deep");
    const canonicalLater = field("deep");
    const duplicateFirst = field("deep");
    const duplicateLater = field("deep");
    const result = normalizeFieldDeclarations([
      inner,
      nestedOuter(canonicalFirst, canonicalLater),
      nestedOuter(duplicateFirst, duplicateLater),
    ], sourceOptions);
    const canonical = result.occurrences.find((item) => item.sourceField === canonicalFirst);
    const canonicalAlias = result.attachments.find((item) => item.sourceField === canonicalLater);
    const duplicateFirstAlias = result.attachments.find((item) => item.sourceField === duplicateFirst);
    const duplicateLaterAlias = result.attachments.find((item) => item.sourceField === duplicateLater);
    if (
      canonical === undefined
      || canonicalAlias === undefined
      || duplicateFirstAlias === undefined
      || duplicateLaterAlias === undefined
    ) throw new Error("expected flattened nested repeated-formal witnesses");
    expect(canonical.path).toEqual([
      { $tag: "FieldNamed", name: "inner" },
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "deep" },
    ]);
    for (const alias of [canonicalAlias, duplicateFirstAlias, duplicateLaterAlias]) {
      expect(alias.templateToken).toBe(canonical.token);
      expect(alias.templateQualifiedName).toBe(canonical.qualifiedName);
    }
  });

  test("registered nominal specialization compares every fixed payload exactly", () => {
    const carrier = (fixed: FenelType, value: FenelType): FenelType => ({
      $opaque: {
        name: "FixedCarrier",
        pure: {
          $record: {
            fields: [
              field("fixed", fixed),
              field("value", value),
            ],
          },
        },
      },
    });
    const templateRoot = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "FixedCarrier",
        module: "matrix",
        params: ["a"],
        type: carrier({ $el: { var: "fixed" } }, { $var: "a" }),
      },
    };
    const actualRoot = (id: string, fixed: FenelType) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id,
        module: "matrix",
        type: carrier(fixed, StringT),
      },
    });
    const mismatches: Array<[string, FenelType, FenelType]> = [
      [
        "el-content",
        { $el: { var: "fixed" } },
        { $el: { var: "hostile" } },
      ],
      [
        "map-key-domain",
        { $map: { keys: { $tag: "SeAll" }, values: StringT } },
        { $map: { keys: { $tag: "SeNone" }, values: StringT } },
      ],
      [
        "refinement-set",
        { $refined: { base: StringT, set: { $tag: "SeAll" } } },
        { $refined: { base: StringT, set: { $tag: "SeNone" } } },
      ],
    ];

    for (const [id, templateFixed, actualFixed] of mismatches) {
      const root = {
        ...templateRoot,
        entity: { ...templateRoot.entity, type: carrier(templateFixed, { $var: "a" }) },
      };
      const result = tryNormalizeFieldDeclarations(
        [root, actualRoot(id, actualFixed)],
        sourceOptions,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.$tag).toBe("InvalidNominalSpecialization");
        expect(result.error.name).toBe("FixedCarrier");
      }
    }

    const exact = normalizeFieldDeclarations([
      templateRoot,
      actualRoot("exact-fixed-payload", { $el: { var: "fixed" } }),
    ], sourceOptions);
    expect(exact.occurrences.some((item) => item.field.name === "fixed")).toBe(true);
  });

  test("nominal field-key matching is exact except for one-way keyless identification", () => {
    const namedA = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const namedB = { $tag: "NamedField", ref: { $ref: UUID_B } } as const;
    const canonicalSource = {
      $tag: "NamedField",
      ref: { $ref: "field:type%3Amatrix%3AKeyedCarrier/named%3Avalue" },
    } as const;
    const arbitrarySource = {
      $tag: "NamedField",
      ref: { $ref: "field:type%3Amatrix%3AOther/named%3Avalue" },
    } as const;
    const positional0 = { $tag: "PositionalField", index: 0 } as const;
    const carrier = (key: FieldKey | undefined, value: FenelType, name = "value"): FenelType => ({
      $opaque: {
        name: "KeyedCarrier",
        pure: { $record: { fields: [field(name, value, key)] } },
      },
    });
    const template = (key?: FieldKey, name = "value") => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "KeyedCarrier",
        module: "matrix",
        params: ["a"],
        type: carrier(key, { $var: "a" }, name),
      },
    });
    const consumer = (id: string, key?: FieldKey, name = "value") => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id,
        module: "matrix",
        type: carrier(key, {
          $record: { fields: [field("nested")] },
        }, name),
      },
    });

    // Repository source templates legitimately predate identification. An
    // already-identified use may add either named or positional identity, but
    // the key must be the exact result of resolving the registered template
    // owner/path in this normalization context—not merely valid-looking.
    for (const [root, use] of [
      [template(), consumer("keyless-to-canonical-source", canonicalSource)],
      [template(namedA), consumer("same-explicit-key", namedA)],
      [template(undefined, "_0"), consumer("keyless-to-positional", positional0, "_0")],
    ] as const) {
      const result = normalizeFieldDeclarations([root, use], sourceOptions);
      expect(result.occurrences.some((item) => item.field.name === "nested")).toBe(true);
    }

    const canonicalLockName = "field:type%3Amatrix%3AKeyedCarrier/named%3Avalue";
    const locked = normalizeFieldDeclarations([
      template(),
      {
        ...consumer("keyless-to-canonical-uuid", namedA),
        entity: {
          ...consumer("keyless-to-canonical-uuid", namedA).entity,
          type: carrier(namedA, StringT),
        },
      },
    ], {
      mode: "strict-embedded",
      lock: new Map([[canonicalLockName, UUID_A]]),
    });
    expect(locked.occurrences.find((item) => item.field.name === "value")?.field.key)
      .toEqual(namedA);

    const malformedNamed = {
      $tag: "NamedField",
      ref: { $ref: "not-an-identified-field" },
    } as const;
    for (const [root, use] of [
      [template(namedA), consumer("different-explicit-handle", namedB)],
      [template(namedA), consumer("missing-explicit-handle")],
      [template(positional0, "_0"), consumer("missing-explicit-position", undefined, "_0")],
      [template(), consumer("arbitrary-valid-source-handle", arbitrarySource)],
      [template(), consumer("malformed-identified-use", malformedNamed)],
    ] as const) {
      const result = tryNormalizeFieldDeclarations([root, use], sourceOptions);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe("InvalidNominalSpecialization");
    }


    const arbitraryUuid = tryNormalizeFieldDeclarations([
      template(),
      {
        ...consumer("arbitrary-valid-uuid", namedB),
        entity: {
          ...consumer("arbitrary-valid-uuid", namedB).entity,
          type: carrier(namedB, StringT),
        },
      },
    ], {
      mode: "strict-embedded",
      lock: new Map([[canonicalLockName, UUID_A]]),
    });
    expect(arbitraryUuid.ok).toBe(false);
    if (!arbitraryUuid.ok) {
      expect(arbitraryUuid.error.$tag).toBe("InvalidNominalSpecialization");
    }
  });

  test("successful exact named and positional carriers publish attachment witnesses", () => {
    const named = { $tag: "NamedField", ref: { $ref: UUID_A } } as const;
    const positional = { $tag: "PositionalField", index: 0 } as const;

    for (const [id, name, key] of [
      ["ExplicitNamedUse", "value", named],
      ["ExplicitPositionalUse", "_0", positional],
    ] as const) {
      const templateField = field(name, { $var: "a" }, key);
      const actualField = field(name, StringT, key);
      const result = normalizeFieldDeclarations([
        {
          kind: "type",
          realm: "repository-source",
          entity: {
            id: "ExplicitCarrier",
            module: "matrix",
            params: ["a"],
            type: {
              $opaque: {
                name: "ExplicitCarrier",
                pure: { $record: { fields: [templateField] } },
              },
            } as FenelType,
          },
        },
        {
          kind: "type",
          realm: "repository-source",
          entity: {
            id,
            module: "matrix",
            type: {
              $opaque: {
                name: "ExplicitCarrier",
                pure: { $record: { fields: [actualField] } },
              },
            } as FenelType,
          },
        },
      ], sourceOptions);

      const attachment = result.attachments.find((item) => item.sourceField === actualField);
      expect(attachment).toBeDefined();
      expect(attachment?.field.key).toEqual(key);
      expect(attachment?.templateToken).not.toBe(attachment?.token);
      expect(attachment?.owner).toEqual({
        $tag: "TypeFieldOwner",
        module: { $tag: "Just", _0: "matrix" },
        localId: id,
      });
    }
  });

  test("nested inline nominal carriers are proved and attached under their local owner", () => {
    const templateInlineField = field("value", { $var: "a" });
    const templateOuterField = field("local", {
      $opaque: {
        name: "InlineLocal",
        pure: { $record: { fields: [templateInlineField] } },
      },
    });
    const actualDeepField = field("deep");
    const actualInlineField = field("value", {
      $record: { fields: [actualDeepField] },
    });
    const actualOuterField = field("local", {
      $opaque: {
        name: "InlineLocal",
        pure: { $record: { fields: [actualInlineField] } },
      },
    });
    const result = normalizeFieldDeclarations([
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "InlineOuter",
          module: "matrix",
          params: ["a"],
          type: {
            $opaque: {
              name: "InlineOuter",
              pure: { $record: { fields: [templateOuterField] } },
            },
          } as FenelType,
        },
      },
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "InlineConsumer",
          module: "matrix",
          type: {
            $opaque: {
              name: "InlineOuter",
              pure: { $record: { fields: [actualOuterField] } },
            },
          } as FenelType,
        },
      },
    ], sourceOptions);

    const outerAttachment = result.attachments.find((item) => item.sourceField === actualOuterField);
    const inlineAttachment = result.attachments.find((item) => item.sourceField === actualInlineField);
    if (outerAttachment === undefined || inlineAttachment === undefined) {
      throw new Error("expected nested nominal attachment witnesses");
    }
    expect(outerAttachment.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: outerAttachment.templateQualifiedName },
    });
    expect(inlineAttachment.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: inlineAttachment.templateQualifiedName },
    });
    expect(inlineAttachment.templateQualifiedName).toContain("type%3Ainline%3A");
    expect(result.occurrences.find((item) => item.field.name === "deep")?.owner).toEqual({
      $tag: "TypeFieldOwner",
      module: { $tag: "Just", _0: "matrix" },
      localId: "InlineConsumer",
    });
  });

  test("independent nested registered bindings walk under the referring semantic type-arg path", () => {
    const innerRoot = (params: readonly string[], fields: FieldDef[]) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "NestedInner",
        module: "matrix",
        params,
        type: {
          $opaque: {
            name: "NestedInner",
            pure: { $record: { fields } },
          },
        } as FenelType,
      },
    });
    const fixedRecord = (deep: FieldDef): FenelType => ({
      $record: { fields: [deep] },
    });

    // NestedInner<c> specializes c to a fixed record that is not an outer
    // parameter. Its fields belong to the referring root at inner/type-arg:0.
    const templateDeep = field("deep");
    const outerValue = field("value", fixedRecord(templateDeep));
    const outerRoot = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "NestedOuter",
        module: "matrix",
        type: {
          $opaque: {
            name: "NestedOuter",
            pure: {
              $record: {
                fields: [field("inner", {
                  $opaque: {
                    name: "NestedInner",
                    pure: { $record: { fields: [outerValue] } },
                  },
                })],
              },
            },
          },
        } as FenelType,
      },
    };
    const actualDeep = field("deep");
    const actualValue = field("value", fixedRecord(actualDeep));
    const result = normalizeFieldDeclarations([
      innerRoot(["c"], [field("value", { $var: "c" })]),
      outerRoot,
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "NestedBindingConsumer",
          module: "matrix",
          type: {
            $opaque: {
              name: "NestedOuter",
              pure: {
                $record: {
                  fields: [field("inner", {
                    $opaque: {
                      name: "NestedInner",
                      pure: { $record: { fields: [actualValue] } },
                    },
                  })],
                },
              },
            },
          } as FenelType,
        },
      },
    ], sourceOptions);
    const consumerDeep = result.occurrences.filter((item) =>
      item.field.name === "deep"
      && item.owner.$tag === "TypeFieldOwner"
      && item.owner.localId === "NestedBindingConsumer"
    );
    expect(consumerDeep).toHaveLength(1);
    expect(consumerDeep[0]?.path).toEqual([
      { $tag: "FieldNamed", name: "inner" },
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "deep" },
    ]);
    expect(result.attachments.find((item) => item.sourceField === actualValue)).toBeDefined();
  });

  test("coincident outer and nested binder names remain separate ordinal namespaces", () => {
    const fixedRecord = (deep: FieldDef): FenelType => ({ $record: { fields: [deep] } });
    const innerRoot = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "CoincidentInner",
        module: "matrix",
        params: ["c"],
        type: {
          $opaque: {
            name: "CoincidentInner",
            pure: { $record: { fields: [field("value", { $var: "c" })] } },
          },
        } as FenelType,
      },
    };
    const templateInnerDeep = field("innerDeep");
    const outerRoot = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "CoincidentOuter",
        module: "matrix",
        params: ["c"],
        type: {
          $opaque: {
            name: "CoincidentOuter",
            pure: {
              $record: {
                fields: [
                  field("outerValue", { $var: "c" }),
                  field("inner", {
                    $opaque: {
                      name: "CoincidentInner",
                      pure: {
                        $record: {
                          fields: [field("value", fixedRecord(templateInnerDeep))],
                        },
                      },
                    },
                  }),
                ],
              },
            },
          },
        } as FenelType,
      },
    };
    const outerDeep = field("outerDeep");
    const innerDeep = field("innerDeep");
    const result = normalizeFieldDeclarations([
      innerRoot,
      outerRoot,
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "CoincidentConsumer",
          module: "matrix",
          type: {
            $opaque: {
              name: "CoincidentOuter",
              pure: {
                $record: {
                  fields: [
                    field("outerValue", fixedRecord(outerDeep)),
                    field("inner", {
                      $opaque: {
                        name: "CoincidentInner",
                        pure: {
                          $record: {
                            fields: [field("value", fixedRecord(innerDeep))],
                          },
                        },
                      },
                    }),
                  ],
                },
              },
            },
          } as FenelType,
        },
      },
    ], sourceOptions);

    const owned = result.occurrences.filter((item) =>
      item.owner.$tag === "TypeFieldOwner" && item.owner.localId === "CoincidentConsumer"
    );
    expect(owned.find((item) => item.field.name === "outerDeep")?.path).toEqual([
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "outerDeep" },
    ]);
    expect(owned.find((item) => item.field.name === "innerDeep")?.path).toEqual([
      { $tag: "FieldNamed", name: "inner" },
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "innerDeep" },
    ]);
  });

  test("equivalent duplicate roots attach independent nested binding fields to canonical tokens", () => {
    const fixedRecord = (deep: FieldDef): FenelType => ({ $record: { fields: [deep] } });
    const inner = {
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "DuplicateNestedInner",
        module: "matrix",
        params: ["c"],
        type: {
          $opaque: {
            name: "DuplicateNestedInner",
            pure: { $record: { fields: [field("value", { $var: "c" })] } },
          },
        } as FenelType,
      },
    };
    const canonicalDeep = field("deep");
    const duplicateDeep = {
      ...field("deep"),
      label: { $tag: "Just", _0: "Duplicate presentation" } as const,
    };
    const outer = (deep: FieldDef) => ({
      kind: "type" as const,
      realm: "repository-source" as const,
      entity: {
        id: "DuplicateNestedOuter",
        module: "matrix",
        type: {
          $opaque: {
            name: "DuplicateNestedOuter",
            pure: {
              $record: {
                fields: [field("inner", {
                  $opaque: {
                    name: "DuplicateNestedInner",
                    pure: {
                      $record: { fields: [field("value", fixedRecord(deep))] },
                    },
                  },
                })],
              },
            },
          },
        } as FenelType,
      },
    });

    const result = normalizeFieldDeclarations([
      inner,
      outer(canonicalDeep),
      outer(duplicateDeep),
    ], sourceOptions);
    expect(result.occurrences.filter((item) =>
      item.field.name === "deep"
      && item.owner.$tag === "TypeFieldOwner"
      && item.owner.localId === "DuplicateNestedOuter"
    )).toHaveLength(1);
    const duplicateAttachment = result.attachments.find((item) => item.sourceField === duplicateDeep);
    if (duplicateAttachment === undefined) {
      throw new Error("expected nested duplicate-root attachment witness");
    }
    expect(duplicateAttachment.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: duplicateAttachment.templateQualifiedName },
    });
  });

  test("registered nominal parameters must be non-empty and unique", () => {
    for (const [id, params] of [
      ["EmptyParam", [""]],
      ["DuplicateParam", ["a", "a"]],
    ] as const) {
      const result = tryNormalizeFieldDeclarations([{
        kind: "type",
        realm: "repository-source",
        entity: {
          id,
          module: "matrix",
          params,
          type: {
            $opaque: {
              name: id,
              pure: { $record: { fields: [field("value", { $var: "a" })] } },
            },
          },
        },
      }], sourceOptions);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.$tag).toBe("InvalidNominalSpecialization");
        expect(result.error.name).toBe(id);
      }
    }
  });

  test("registered nominal substitutions are function-owned at a semantic type-arg path", () => {
    const template: FenelType = {
      $opaque: {
        name: "ParamBox",
        pure: {
          $record: { fields: [field("value", { $var: "a" })] },
        },
      },
    };
    const actual: FenelType = {
      $opaque: {
        name: "ParamBox",
        pure: {
          $record: {
            fields: [
              field("value", {
                $record: { fields: [field("nested")] },
              }),
            ],
          },
        },
      },
    };
    const result = normalizeFieldDeclarations([
      {
        kind: "type",
        realm: "repository-source",
        entity: {
          id: "ParamBox",
          module: "matrix",
          params: ["a"],
          type: template,
        },
      },
      {
        kind: "function",
        realm: "repository-source",
        module: "matrix",
        fn: {
          id: "matrix:useParamBox",
          params: [field("box", actual)],
          returns: StringT,
        },
      },
    ], sourceOptions);

    expect(result.occurrences.filter((item) => item.field.name === "value")).toHaveLength(1);
    const nested = result.occurrences.find((item) => item.field.name === "nested");
    expect(nested?.owner).toEqual({
      $tag: "FunctionFieldOwner",
      id: "matrix:useParamBox",
    });
    expect(nested?.path).toEqual([
      { $tag: "FieldNamed", name: "box" },
      { $tag: "FieldTypeArg", index: 0 },
      { $tag: "FieldNamed", name: "nested" },
    ]);
  });

  test("normalize→wire→normalize preserves explicit key bytes", () => {
    const key = { $tag: "NamedField", ref: { $ref: UUID_B } } as const;
    const first = normalizeFieldDeclarations([
      typeRoot("RoundTrip", { $record: { fields: [field("id", StringT, key)] } }, "account-authored"),
    ], { mode: "strict-embedded" });
    expect(fieldIdentitySourceKeyToWire(first.occurrences[0]!)).toEqual(key);
    const second = normalizeFieldDeclarations([
      typeRoot("RoundTrip", {
        $record: { fields: [field("id", StringT, fieldIdentitySourceKeyToWire(first.occurrences[0]!))] },
      }, "account-authored"),
    ], { mode: "strict-embedded" });
    expect(second.occurrences[0]?.field.key).toEqual(first.occurrences[0]?.field.key);
  });

  test("the kernel carries its canonical owner lookup key on every occurrence", () => {
    const typeCollection = normalizeFieldDeclarations([
      typeRoot("OwnerKey", { $record: { fields: [field("value")] } }),
    ], sourceOptions);
    expect(typeCollection.occurrences[0]?.ownerLookupKey)
      .toBe("field:type%3Amatrix%3AOwnerKey/");

    const functionCollection = normalizeFieldDeclarations([{
      kind: "function",
      realm: "repository-source",
      module: "demo",
      fn: {
        id: "demo:ownerKey",
        params: [field("value")],
        returns: StringT,
      },
    }], sourceOptions);
    expect(functionCollection.occurrences[0]?.ownerLookupKey)
      .toBe("field:function%3Ademo%3AownerKey/");
  });
});

describe("Fenel-first and bootstrap source gates", () => {
  test("high-cardinality kernel stages avoid append-based output accumulation", () => {
    const loaded = loadFenelModule(FIELD_IDENTITY_SOURCE, "engine");
    const bodies = new Map((loaded.functions ?? []).map((fn) => [fn.id, fn.body]));
    const uniqueRoots = JSON.stringify(bodies.get("engine:fieldIdentityUniqueRoots"));
    // S2: the walk and normalization stages keep their merge in the staged
    // helpers the monolithic entry points delegate to.
    const walkRoots = JSON.stringify(bodies.get("engine:fieldIdentityMergeWalkedRoots"));
    const normalizeOccurrences = JSON.stringify(
      bodies.get("engine:fieldIdentityNormalizeWithContext"),
    );
    const buildEntities = JSON.stringify(
      bodies.get("engine:fieldIdentityBuildEntities"),
    );
    const buildLockRequests = JSON.stringify(
      bodies.get("engine:fieldIdentityBuildLockRequests"),
    );

    expect(uniqueRoots).toContain("groupBy");
    expect(walkRoots).toContain("flatMap");
    expect(normalizeOccurrences).toContain("takeWhile");
    expect(buildEntities).toContain("groupBy");
    expect(buildEntities).toContain("flatMap");
    expect(buildLockRequests).toContain("groupBy");
    expect(buildLockRequests).toContain("flatMap");
    for (const body of [
      uniqueRoots,
      walkRoots,
      normalizeOccurrences,
      buildEntities,
      buildLockRequests,
    ]) {
      expect(body).not.toContain("appendItem");
    }
  });

  test("the TS bridge contains no retired semantic classifier/walker", async () => {
    const source = await Bun.file(new URL("./field-identity.ts", import.meta.url)).text();
    expect(source).not.toMatch(/UUID_SYNTAX|UUID_RE|positionalFieldNameIndex/);
    expect(source).not.toMatch(/function\s+walk[A-Z]|function\s+resolveNamed/);
    expect(source).not.toMatch(/JSON\.stringify\([^)]*type/);
    expect(source).toContain("dispatchEngineBody(\"engine:collectFieldIdentitiesKernel\"");
  });

  test("bootstrap is hidden from the public registry facade and field body reads no index", async () => {
    const facade = await Bun.file(new URL("./registry-public.ts", import.meta.url)).text();
    const bodyDispatch = await Bun.file(
      new URL("./engine-bodies-dispatch.ts", import.meta.url),
    ).text();
    const body = await Bun.file(
      new URL("../../../../fenel/modules/engine/field-identity.fenel", import.meta.url),
    ).text();
    expect(facade).not.toContain("createEngineBootstrapRegistry");
    const testHarnessExport = bodyDispatch.match(
      /export function harnessForTests[\s\S]*?\n}/,
    )?.[0];
    expect(testHarnessExport).toBeDefined();
    expect(testHarnessExport).not.toMatch(/\breg\b|ModuleRegistry/);
    expect(body).not.toContain("getFieldIdentity");
    expect(body).not.toContain("listFieldIdentities");
  });
});
