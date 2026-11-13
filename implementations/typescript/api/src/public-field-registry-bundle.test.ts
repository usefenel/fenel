import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { PublicFieldRootBinding } from "@fenel/engine/field-authoring";
import type { FenelType } from "@fenel/engine/types";
import { getSystemEntity } from "@fenel/engine";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { typeFromJsonWire, typeToJsonWire } from "@fenel/engine/authoring/expression";
import {
  loadPublicFieldRegistryBundle,
  PublicFieldRegistryBundleError,
  scopePublicFieldRegistrySnapshot,
  type PublicFieldRegistrySemantics,
} from "./public-field-registry-bundle";

const VISIBLE = "11111111-1111-4111-8111-111111111111";
const SECRET = "22222222-2222-4222-8222-222222222222";
const DEAD = "33333333-3333-4333-8333-333333333333";
const ADDRESS = "44444444-4444-4444-8444-444444444444";
const COUNTRY = "55555555-5555-4555-8555-555555555555";
const REPOSITORY = "66666666-6666-4666-8666-666666666666";
const UNKNOWN = "77777777-7777-4777-8777-777777777777";
const TYPE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const binding = (name: string, origin: "account" | "repository" = "account", id = TYPE_ID): PublicFieldRootBinding => ({ origin, id, name });

const REPOSITORY_TYPES = new Set(["String", "Number", "Boolean", "RepositoryAddress"]);
const TEST_SEMANTICS: PublicFieldRegistrySemantics = {
  repositoryTypeExists: (name) => REPOSITORY_TYPES.has(name),
  repositoryFields: () => [],
};

function field(
  id: string,
  currentCodeName: string,
  status: "live" | "tombstoned" = "live",
) {
  return {
    id,
    currentCodeName,
    status,
    realm: "account" as const,
    reuseVisibility: "account" as const,
    origin: {
      owner: {
        $tag: "TypeFieldOwner" as const,
        module: { $tag: "Nothing" as const },
        localId: `private-${currentCodeName}`,
      },
      path: [{ $tag: "FieldNamed" as const, name: currentCodeName }],
    },
  };
}

function typeOwner(name: string, type: FenelType) {
  return {
    ownerKey: `type:${name}`,
    kind: "type" as const,
    storageName: name,
    storageId: TYPE_ID,
    definition: { id: name, type },
  };
}

function labelFacet(fieldId: string, label: string) {
  return {
    rowId: `row-${fieldId}`,
    fieldId,
    typeName: "Labelable",
    methods: { label },
    scope: "account" as const,
    priority: 100,
  };
}

function snapshot(visibleId = VISIBLE, secretId = SECRET): FieldPersistenceSnapshot {
  return {
    owners: [
      typeOwner("public-form", { $record: { fields: [namedField(visibleId)] } }),
      typeOwner("private-ledger", {
        $record: { fields: [namedField(secretId, "privateNote")] },
      }),
    ],
    fields: [
      field(visibleId, "email"),
      field(secretId, "privateNote"),
      field(DEAD, "retired", "tombstoned"),
    ],
    facets: [
      labelFacet(visibleId, "Public email"),
      labelFacet(secretId, "Do not expose"),
      labelFacet(DEAD, "Retired"),
    ],
  };
}

function namedField(
  fieldId: string,
  name = "email",
  type: FenelType = { $ref: "String" },
) {
  return {
    name,
    key: { $tag: "NamedField" as const, ref: { $ref: fieldId } },
    type,
    label: { $tag: "Nothing" as const },
    ui: { $tag: "Nothing" as const },
    meta: {},
  };
}

function expectBundleError(
  run: () => unknown,
  code: PublicFieldRegistryBundleError["code"],
): void {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PublicFieldRegistryBundleError);
    expect((error as PublicFieldRegistryBundleError).code).toBe(code);
  }
}

describe("public field-registry bundle", () => {
  test("production semantics recognize repository type leaves", () => {
    const source = snapshot();
    const type = { $record: { fields: [namedField(VISIBLE)] } };
    const scoped = scopePublicFieldRegistrySnapshot("public-form", type, source);
    expect(scoped.fields.map((entry) => entry.id)).toEqual([VISIBLE]);
  });

  test("serves only reachable live Fields/facets and strips private persistence metadata", () => {
    const source = snapshot();
    const type = {
      $record: {
        fields: [{
          ...namedField(VISIBLE),
          type: {
            $variant: {
              cases: [{
                name: "Nested",
                label: { $tag: "Nothing" as const },
                fields: [namedField(VISIBLE, "email")],
              }],
            },
          },
        }],
      },
    };
    const scoped = scopePublicFieldRegistrySnapshot(
      "public-form",
      type,
      source,
      TEST_SEMANTICS,
    );

    expect(scoped.owners).toEqual([{
      ownerKey: "type:public-form",
      kind: "type",
      storageName: "public-form",
      definition: { id: "public-form", type },
    }]);
    expect(scoped.fields).toEqual([{
      id: VISIBLE,
      currentCodeName: "email",
      status: "live",
      realm: "account",
      reuseVisibility: "account",
    }]);
    expect(scoped.facets).toEqual([{
      fieldId: VISIBLE,
      typeName: "Labelable",
      methods: { label: "Public email" },
      scope: "account",
      priority: 100,
    }]);
    expect(JSON.stringify(scoped)).not.toContain("private-ledger");
    expect(JSON.stringify(scoped)).not.toContain("Do not expose");
    expect(JSON.stringify(scoped)).not.toContain("row-");
    expect(source.owners).toHaveLength(2);
    expect(source.fields).toHaveLength(3);
  });

  test("walks nested and cyclic account type refs without exposing unrelated owners", () => {
    const rootType = {
      $record: { fields: [namedField(VISIBLE, "email", { $ref: "Address" })] },
    };
    const addressType = {
      $record: { fields: [namedField(ADDRESS, "street", { $ref: "Country" })] },
    };
    const countryType = {
      $record: { fields: [namedField(COUNTRY, "country", { $ref: "Address" })] },
    };
    const source: FieldPersistenceSnapshot = {
      owners: [
        typeOwner("public-form", rootType),
        typeOwner("Address", addressType),
        typeOwner("Country", countryType),
        typeOwner("private-ledger", {
          $record: { fields: [namedField(SECRET, "privateNote")] },
        }),
      ],
      fields: [
        field(VISIBLE, "email"),
        field(ADDRESS, "street"),
        field(COUNTRY, "country"),
        field(SECRET, "privateNote"),
      ],
      facets: [
        labelFacet(VISIBLE, "Email"),
        labelFacet(ADDRESS, "Street"),
        labelFacet(COUNTRY, "Country"),
        labelFacet(SECRET, "Secret"),
      ],
    };

    const scoped = scopePublicFieldRegistrySnapshot(
      "public-form",
      rootType,
      source,
      TEST_SEMANTICS,
    );

    expect(scoped.owners.map((owner) => owner.storageName)).toEqual([
      "public-form",
      "Address",
      "Country",
    ]);
    expect(scoped.fields.map((entry) => entry.id)).toEqual([VISIBLE, ADDRESS, COUNTRY]);
    expect(scoped.facets.map((entry) => entry.fieldId)).toEqual([VISIBLE, ADDRESS, COUNTRY]);
    expect(JSON.stringify(scoped)).not.toContain("private-ledger");
    expect(JSON.stringify(scoped)).not.toContain("Secret");
  });

  test("keeps repository types and Fields out of the account wire projection", () => {
    const rootType = {
      $record: {
        fields: [
          namedField(VISIBLE, "email", { $ref: "RepositoryAddress" }),
          namedField(REPOSITORY, "repositoryCode"),
        ],
      },
    };
    const source: FieldPersistenceSnapshot = {
      owners: [typeOwner("public-form", rootType)],
      fields: [field(VISIBLE, "email")],
      facets: [labelFacet(VISIBLE, "Email")],
    };
    const semantics: PublicFieldRegistrySemantics = {
      ...TEST_SEMANTICS,
      repositoryFields: () => [{
        id: REPOSITORY,
        currentCodeName: "repositoryCode",
        realm: "repository",
      }],
    };

    const scoped = scopePublicFieldRegistrySnapshot(
      "public-form",
      rootType,
      source,
      semantics,
    );

    expect(scoped.owners.map((owner) => owner.storageName)).toEqual(["public-form"]);
    expect(scoped.fields.map((entry) => entry.id)).toEqual([VISIBLE]);
    expect(scoped.facets.map((entry) => entry.fieldId)).toEqual([VISIBLE]);
    expect(scoped.owners.some((owner) => owner.storageName === "RepositoryAddress")).toBe(false);
  });

  test("fails closed for unresolved type refs and unknown/tombstoned Field UUIDs", () => {
    const base = snapshot();
    expectBundleError(
      () => scopePublicFieldRegistrySnapshot(
        "public-form",
        { $record: { fields: [namedField(VISIBLE, "email", { $ref: "MissingType" })] } },
        base,
        TEST_SEMANTICS,
      ),
      "UnresolvedTypeReference",
    );
    expectBundleError(
      () => scopePublicFieldRegistrySnapshot(
        "public-form",
        { $record: { fields: [namedField(UNKNOWN, "unknown")] } },
        base,
        TEST_SEMANTICS,
      ),
      "UnresolvedFieldReference",
    );
    expectBundleError(
      () => scopePublicFieldRegistrySnapshot(
        "public-form",
        { $record: { fields: [namedField(DEAD, "retired")] } },
        base,
        TEST_SEMANTICS,
      ),
      "TombstonedFieldReference",
    );
  });

  test("fails closed when a reachable owner contains an unresolved Field", () => {
    const rootType = {
      $record: { fields: [namedField(VISIBLE, "email", { $ref: "Address" })] },
    };
    const source: FieldPersistenceSnapshot = {
      owners: [
        typeOwner("public-form", rootType),
        typeOwner("Address", {
          $record: { fields: [namedField(DEAD, "retired")] },
        }),
      ],
      fields: [field(VISIBLE, "email"), field(DEAD, "retired", "tombstoned")],
      facets: [],
    };
    expectBundleError(
      () => scopePublicFieldRegistrySnapshot(
        "public-form",
        rootType,
        source,
        TEST_SEMANTICS,
      ),
      "TombstonedFieldReference",
    );
  });

  test("loads and scopes the exact requested account without cross-account bleed", async () => {
    const otherVisible = "88888888-8888-4888-8888-888888888888";
    const loads: string[] = [];
    const byAccount = new Map([
      ["account-a", snapshot(VISIBLE, SECRET)],
      ["account-b", snapshot(otherVisible, SECRET)],
    ]);
    const load = async (accountId: string) => {
      loads.push(accountId);
      return byAccount.get(accountId)!;
    };

    const a = await loadPublicFieldRegistryBundle(
      "account-a",
      "public-form",
      { $record: { fields: [namedField(VISIBLE)] } },
      binding("public-form"),
      load,
      TEST_SEMANTICS,
    );
    const b = await loadPublicFieldRegistryBundle(
      "account-b",
      "public-form",
      { $record: { fields: [namedField(otherVisible)] } },
      binding("public-form"),
      load,
      TEST_SEMANTICS,
    );

    expect(loads).toEqual(["account-a", "account-b"]);
    expect(a.rootTypeName).toBe("public-form");
    expect(b.rootTypeName).toBe("public-form");
    expect(a.snapshot.fields.map((entry) => entry.id)).toEqual([VISIBLE]);
    expect(b.snapshot.fields.map((entry) => entry.id)).toEqual([otherVisible]);
    expect(JSON.stringify(a)).not.toContain(otherVisible);
    expect(JSON.stringify(b)).not.toContain(VISIBLE);
  });

  test("canonical primitive terminals retain Field normalization and the private closure fence", () => {
    for (const primitive of ["Date", "File"]) {
      const root = { $record: { fields: [namedField(VISIBLE, "email", { $ref: primitive })] } };
      const bundle = scopePublicFieldRegistrySnapshot("public-form", root, snapshot(), {
        repositoryFields: () => [],
      });
      expect(bundle.owners.map(owner => owner.storageName)).toEqual(["public-form"]);
      expect(bundle.fields.map(row => row.id)).toEqual([VISIBLE]);
      expect(JSON.stringify(bundle)).not.toContain(SECRET);
    }
    const unknownRoot = { $record: { fields: [namedField(VISIBLE, "email", { $ref: "UnknownDateAlias" })] } };
    expectBundleError(() => scopePublicFieldRegistrySnapshot("public-form", unknownRoot, snapshot(), {
      repositoryFields: () => [],
    }), "UnresolvedTypeReference");
  });

  test("terminal primitive roots do not acquire a nonexistent identified entity", async () => {
    let acquired = false;
    const bundle = await loadPublicFieldRegistryBundle("publisher", "Date", { $ref: "Date" }, binding("Date", "repository", "Date"), async () => ({
      owners: [], fields: [], facets: [],
    }), {
      repositoryFields: () => [],
      repositoryRootType: async () => { acquired = true; throw new Error("Primitive terminals have no entity projection"); },
    });
    expect(acquired).toBe(false);
    expect(bundle).toEqual({ rootTypeName: "Date", snapshot: { owners: [], fields: [], facets: [] } });
  });

  test("repository roots traverse the identified projection while retaining the reachable public closure", async () => {
    const repositoryId = "99999999-9999-4999-8999-999999999999";
    const rawRoot = { $record: { fields: [{ name: "details", type: { $ref: "PublicDetails" } }] } } as FenelType;
    const identifiedRoot = { $record: { fields: [namedField(repositoryId, "details", { $ref: "PublicDetails" })] } };
    const publicDetails = { $record: { fields: [namedField(VISIBLE)] } };
    const source = {
      ...snapshot(),
      owners: [typeOwner("PublicDetails", publicDetails), typeOwner("PrivateDetails", { $record: { fields: [namedField(SECRET)] } })],
    };
    const requests: Array<{ accountId: string; name: string }> = [];
    const bundle = await loadPublicFieldRegistryBundle("publisher", "RepositoryForm", rawRoot, binding("RepositoryForm", "repository"), async () => source, {
      ...TEST_SEMANTICS,
      repositoryTypeExists: (name) => name === "RepositoryForm" || TEST_SEMANTICS.repositoryTypeExists!(name),
      repositoryFields: () => [{ id: repositoryId, currentCodeName: "details", realm: "repository" }],
      repositoryRootType: async (accountId, name) => { requests.push({ accountId, name }); return identifiedRoot; },
      repositoryRootDeclaration: () => rawRoot,
    });
    expect(requests).toEqual([{ accountId: "publisher", name: "RepositoryForm" }]);
    expect(bundle.rootTypeName).toBe("RepositoryForm");
    expect(bundle.snapshot.owners.map(owner => owner.storageName)).toEqual(["PublicDetails"]);
    expect(bundle.snapshot.fields.map(row => row.id)).toEqual([VISIBLE]);
    expect(JSON.stringify(bundle)).not.toContain(SECRET);
    expect(JSON.stringify(bundle)).not.toContain("PrivateDetails");
    expect(JSON.stringify(bundle)).not.toContain(repositoryId);
  });

  test("unchanged account-owned roots never select a same-named repository type", async () => {
    const publicViewType = { $record: { fields: [namedField(VISIBLE)] } };
    const source = { ...snapshot(), owners: [typeOwner("RepositoryForm", publicViewType)] };
    let acquired = false;
    const bundle = await loadPublicFieldRegistryBundle("publisher", "RepositoryForm", publicViewType, binding("RepositoryForm"), async () => source, {
      ...TEST_SEMANTICS,
      repositoryTypeExists: (name) => name === "RepositoryForm" || TEST_SEMANTICS.repositoryTypeExists!(name),
      repositoryRootType: async () => { acquired = true; throw new Error("Account roots must keep their view-authoritative type"); },
    });
    expect(acquired).toBe(false);
    const owner = bundle.snapshot.owners[0];
    if (owner?.kind !== "type") throw new Error("Expected the public type owner");
    expect(owner.definition.type).toEqual(publicViewType);
    expect(bundle.snapshot.fields.map(row => row.id)).toEqual([VISIBLE]);
    expect(JSON.stringify(bundle)).not.toContain(SECRET);
  });

  test("independently decoded type-row and committed-graph wires keep an unchanged account root", async () => {
    const authored = { $record: { fields: [namedField(VISIBLE)] } };
    const wire = JSON.parse(JSON.stringify(typeToJsonWire(authored)));
    const rowType = typeFromJsonWire(wire);
    const graphType = typeFromJsonWire(JSON.parse(JSON.stringify(wire)));
    expect(rowType).not.toBe(graphType);
    const source = { ...snapshot(), owners: [typeOwner("public-form", graphType)] };
    const result = await loadPublicFieldRegistryBundle("publisher", "public-form", rowType, binding("public-form"), async () => source);
    expect(result.snapshot.fields.map(row => row.id)).toEqual([VISIBLE]);
    expect(result.snapshot.owners[0]?.definition).toEqual({ id: "public-form", type: rowType });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("a real repository profile row uses the immutable identified root and empty account projection", async () => {
    const entity = getSystemEntity("profile");
    expect(entity?.type).toBeDefined();
    if (entity?.type === undefined) throw new Error("Missing repository profile fixture");
    const rowType = typeFromJsonWire(JSON.parse(JSON.stringify(typeToJsonWire(entity.type))));
    const loads: string[] = [];
    const result = await loadPublicFieldRegistryBundle("publisher", "profile", rowType, binding("profile", "repository", "profile"), async accountId => {
      loads.push(accountId); return { owners: [], fields: [], facets: [] };
    });
    expect(loads).toEqual(["publisher"]);
    expect(getSystemRegistry().getIdentifiedEntity("profile")?.type).toBeDefined();
    expect(result).toEqual({ rootTypeName: "profile", snapshot: { owners: [], fields: [], facets: [] } });
  });

  test("deleted, replaced and edited account roots refuse before same-name repository acquisition", async () => {
    const publicViewType = { $record: { fields: [namedField(VISIBLE)] } };
    const original = typeOwner("RepositoryForm", publicViewType);
    for (const owners of [
      [],
      [{ ...original, storageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      [typeOwner("RepositoryForm", { $record: { fields: [namedField(SECRET)] } })],
    ]) {
      let acquired = false;
      await expect(loadPublicFieldRegistryBundle("publisher", "RepositoryForm", publicViewType, binding("RepositoryForm"), async () => ({ ...snapshot(), owners }), {
        ...TEST_SEMANTICS,
        repositoryTypeExists: () => true,
        repositoryRootDeclaration: () => publicViewType,
        repositoryRootType: async () => { acquired = true; return publicViewType; },
      })).rejects.toMatchObject({ name: "PublicFieldRegistryBundleError", code: "RootTypeChanged" });
      expect(acquired).toBe(false);
    }
  });

  test("repository roots refuse a new account shadow or changed repository declaration", async () => {
    const rawRoot = { $record: { fields: [namedField(VISIBLE)] } };
    const cases: Array<[FieldPersistenceSnapshot, FenelType]> = [
      [{ ...snapshot(), owners: [typeOwner("RepositoryForm", rawRoot)] }, rawRoot],
      [{ owners: [], fields: [], facets: [] }, { $record: { fields: [namedField(SECRET)] } }],
    ];
    for (const [source, declaration] of cases) {
      let acquired = false;
      await expect(loadPublicFieldRegistryBundle("publisher", "RepositoryForm", rawRoot, binding("RepositoryForm", "repository"), async () => source, {
        ...TEST_SEMANTICS,
        repositoryTypeExists: () => true,
        repositoryRootDeclaration: () => declaration,
        repositoryRootType: async () => { acquired = true; return rawRoot; },
      })).rejects.toMatchObject({ name: "PublicFieldRegistryBundleError", code: "RootTypeChanged" });
      expect(acquired).toBe(false);
    }
  });

  test("missing or mismatched internal read bindings cannot produce a bundle", async () => {
    const type = { $record: { fields: [namedField(VISIBLE)] } };
    for (const captured of [undefined, binding("other-name"), binding("public-form", "account", "different-row")]) {
      await expect(loadPublicFieldRegistryBundle("publisher", "public-form", type, captured, async () => snapshot(), TEST_SEMANTICS))
        .rejects.toMatchObject({ name: "PublicFieldRegistryBundleError", code: "RootTypeChanged" });
    }
  });

  test("a recognized repository root without an identified projection fails closed", async () => {
    let normalizationCalls = 0;
    await expect(loadPublicFieldRegistryBundle("publisher", "RepositoryForm", { $record: { fields: [] } }, binding("RepositoryForm", "repository"), async () => snapshot(), {
      ...TEST_SEMANTICS,
      repositoryTypeExists: () => true,
      repositoryRootType: async () => undefined,
      repositoryRootDeclaration: () => ({ $record: { fields: [] } }),
      normalize: () => { normalizationCalls++; throw new Error("Missing identified roots must not be traversed"); },
    })).rejects.toMatchObject({ name: "PublicFieldRegistryBundleError", code: "UnresolvedRootType" });
    expect(normalizationCalls).toBe(0);
  });

  test("invalid supplied root types fail before graph or identified-root acquisition", async () => {
    let graphLoads = 0;
    let identifiedLoads = 0;
    await expect(loadPublicFieldRegistryBundle("publisher", "RepositoryForm", { unexpected: true }, binding("RepositoryForm", "repository"), async () => {
      graphLoads++; return snapshot();
    }, {
      ...TEST_SEMANTICS,
      repositoryTypeExists: () => true,
      repositoryRootType: async () => { identifiedLoads++; return { $record: { fields: [] } }; },
    })).rejects.toMatchObject({ name: "PublicFieldRegistryBundleError", code: "InvalidRootType" });
    expect(graphLoads).toBe(0);
    expect(identifiedLoads).toBe(0);
  });

  test("both anonymous GET lanes attach a bundle using their resolved account and type", async () => {
    const [formsRaw, pagesRaw] = await Promise.all([
      readFile(new URL("./routes/forms.ts", import.meta.url), "utf8"),
      readFile(new URL("./routes/pages.ts", import.meta.url), "utf8"),
    ]);
    const formsSource = formsRaw.replaceAll("\r\n", "\n");
    const pagesSource = pagesRaw.replaceAll("\r\n", "\n");
    expect(formsSource).toContain("loadPublicFieldRegistryBundle(\n        accountId,\n        view._0.typeName,\n        view._0.type,");
    expect(formsSource).toContain("view._0.rootBinding,");
    expect(formsSource).toContain("const { rootBinding: _binding, ...publicView } = view._0;");
    expect(formsSource).toContain("return c.json({ ...publicView, slug, fieldRegistry });");
    expect(pagesSource).toContain("loadPublicFieldRegistryBundle(\n      page.accountId,\n      publicView.form.typeName,\n      publicView.form?.type,");
    expect(pagesSource).toContain("publicView.form.rootBinding,");
    expect(pagesSource).toContain("const { rootBinding: _binding, ...publicForm } = publicView.form;");
    expect(pagesSource).toContain("return c.json({ ...publicView, form: publicForm, fieldRegistry });");
    expect(formsSource + pagesSource).not.toContain("loadAccountExecutionRegistryForRequest");
  });
});
