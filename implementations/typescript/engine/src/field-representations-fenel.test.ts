import { describe, expect, test } from "bun:test";

import {
  projectFieldFacets,
  resolveRegistryFieldPresentation,
  tryProjectFieldFacets,
} from "./field-representations";
import { createRegistry, type ModuleRegistry } from "./registry";
import {
  fieldPath,
  type FieldEntity,
  type FieldIdentity,
  type FieldOwner,
  type FieldPathSegment,
} from "./field-identity";
import { Nothing } from "./type-foundation";
import type { FieldFacetSourceDirective, IdentifiedFieldDef } from "./types";
import { loadFenelModule } from "./fenel-module";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const owner = {
  $tag: "TypeFieldOwner" as const,
  module: { $tag: "Just" as const, _0: "demo" },
  localId: "Demo",
};
const otherOwner = {
  $tag: "TypeFieldOwner" as const,
  module: { $tag: "Just" as const, _0: "demo" },
  localId: "Other",
};
const sourceField = {
  name: "title",
  type: { $ref: "String" as const },
  label: Nothing,
  ui: Nothing,
  meta: {},
};
const identifiedField: IdentifiedFieldDef = {
  ...sourceField,
  key: { $tag: "NamedField", ref: { $ref: ID } },
};
const occurrence: FieldIdentity = {
  owner,
  path: [fieldPath.named("title")],
  qualifiedName: "field:demo/title",
  ownerLookupKey: "field:type%3Ademo%3ADemo/",
  lockName: "field:demo/title",
  token: "root0:0",
  ingress: "ordinary-named",
  realm: "repository-source",
  declaresEntity: true,
  sourceField,
  field: identifiedField,
};
const entity: FieldEntity = {
  id: ID,
  currentCodeName: "title",
  occurrences: [occurrence],
};

function directive(
  source: FieldFacetSourceDirective["source"],
  selector = "title",
  entityId = "Demo",
): FieldFacetSourceDirective {
  return {
    owner: { module: "demo", entityId },
    selector,
    source,
    provenance: { module: "demo", declaration: entityId, selector },
  };
}

function namedOccurrence(
  id: string,
  path: readonly FieldPathSegment[],
  typedOwner: FieldOwner = owner,
  authoredName?: string,
): FieldIdentity {
  const last = path.at(-1);
  const name = authoredName ?? (last?.$tag === "FieldNamed" ? last.name : "field");
  const source = { ...sourceField, name };
  const identified: IdentifiedFieldDef = {
    ...source,
    key: { $tag: "NamedField", ref: { $ref: id } },
  };
  return {
    owner: typedOwner,
    path,
    qualifiedName: `field:test/${id}/${path.length}`,
    ownerLookupKey: typedOwner === otherOwner
      ? "field:type%3Ademo%3AOther/"
      : "field:type%3Ademo%3ADemo/",
    lockName: `field:test/${id}/${path.length}`,
    token: `${id}:${path.length}`,
    ingress: "ordinary-named",
    realm: "repository-source",
    declaresEntity: true,
    sourceField: source,
    field: identified,
  };
}

function positionalOccurrence(
  index: number,
  path: readonly FieldPathSegment[],
  typedOwner: FieldOwner = owner,
): FieldIdentity {
  const source = { ...sourceField, name: `_${index}` };
  const identified: IdentifiedFieldDef = {
    ...source,
    key: { $tag: "PositionalField", index },
  };
  return {
    owner: typedOwner,
    path,
    qualifiedName: `field:test/position/${index}/${path.length}`,
    ownerLookupKey: typedOwner === otherOwner
      ? "field:type%3Ademo%3AOther/"
      : "field:type%3Ademo%3ADemo/",
    lockName: `field:test/position/${index}/${path.length}`,
    token: `position:${index}:${path.length}`,
    ingress: "positional",
    realm: "repository-source",
    declaresEntity: false,
    sourceField: source,
    field: identified,
  };
}

function fieldEntity(id: string, currentCodeName: string, occurrences: readonly FieldIdentity[]): FieldEntity {
  return { id, currentCodeName, occurrences };
}

describe("Fenel field facet projection", () => {
  test("standard function parameter labels survive the module's existing aggregation", async () => {
    const { stdModule } = await import("./modules/std");
    const labels = stdModule.fieldFacetDirectives?.filter((directive) =>
      "functionId" in directive.owner
      && ["std:join", "std:reverse", "std:words"].includes(directive.owner.functionId)
    );
    expect(labels?.map((directive) => [directive.owner, directive.selector, directive.source]))
      .toEqual([
        [{ functionId: "std:reverse" }, "arr", { kind: "label", label: "Items" }],
        [{ functionId: "std:join" }, "arr", { kind: "label", label: "Items" }],
        [{ functionId: "std:join" }, "separator", { kind: "label", label: "Separator" }],
        [{ functionId: "std:words" }, "s", { kind: "label", label: "Text" }],
      ]);
  });

  test("function parameter labels use declaration identities for Fenel and native functions", () => {
    const loaded = loadFenelModule([
      "module demo where",
      '@codeName "shownName"',
      '@fieldLabel "text" "Text"',
      "read : (text: String) -> String",
      "read text = text",
      "@native",
      '@fieldLabel "items" "Items"',
      "reverse : (items: List String) -> List String",
    ].join("\n"), "ignored");
    expect(loaded.fieldFacetDirectives).toEqual([
      {
        owner: { functionId: "demo:read" },
        selector: "text",
        source: { kind: "label", label: "Text" },
        provenance: { module: "demo", declaration: "read", selector: "text" },
      },
      {
        owner: { functionId: "demo:reverse" },
        selector: "items",
        source: { kind: "label", label: "Items" },
        provenance: { module: "demo", declaration: "reverse", selector: "items" },
      },
    ]);
    const text = namedOccurrence(ID, [fieldPath.named("text")], {
      $tag: "FunctionFieldOwner", id: "demo:read",
    });
    const items = namedOccurrence(ID_2, [fieldPath.named("items")], {
      $tag: "FunctionFieldOwner", id: "demo:reverse",
    });
    const projected = projectFieldFacets(
      [fieldEntity(ID, "text", [text]), fieldEntity(ID_2, "items", [items])],
      [text, items],
      loaded.fieldFacetDirectives!,
    );
    expect(projected.labelables.map((facet) => [facet.args[0], facet.methods.label]))
      .toEqual([[ID, "Text"], [ID_2, "Items"]]);
    expect(projected.labelables.every((facet) => !String(facet.args[0]).includes(".")))
      .toBe(true);
  });

  test("function parameter labels reach the existing registry field presentation", () => {
    const loaded = loadFenelModule(
      '@fieldLabel "text" "Text to read"\nread : (text: String) -> String\nread text = text\n', "demo",
    );
    const registry = createRegistry([loaded], { publishCatalogEntities: false });
    const parameter = registry.getFunction("demo:read")?.params[0];
    expect(parameter?.key?.$tag).toBe("NamedField");
    if (parameter?.key?.$tag !== "NamedField") throw new Error("expected an identified function parameter");
    expect(resolveRegistryFieldPresentation(registry, parameter.key.ref.$ref).label)
      .toBe("Text to read");
  });

  test("function parameter selectors retain missing, positional, and cross-owner refusals", () => {
    const loaded = loadFenelModule(
      '@native\n@fieldLabel "text" "Text"\nread : (text: String) -> String\n', "demo",
    );
    const parameterOwner: FieldOwner = { $tag: "FunctionFieldOwner", id: "demo:read" };
    const parameters = [
      { occurrence: namedOccurrence(ID, [fieldPath.named("other")], parameterOwner), tag: "MissingFieldFacetSelector" },
      { occurrence: positionalOccurrence(0, [fieldPath.named("text")], parameterOwner), tag: "PositionalFieldFacetSelector" },
      { occurrence: namedOccurrence(ID, [fieldPath.named("text")], { $tag: "FunctionFieldOwner", id: "demo:other" }), tag: "CrossOwnerFieldFacetSelector" },
      { occurrence: namedOccurrence(ID, [fieldPath.named("text")], owner), tag: "CrossOwnerFieldFacetSelector" },
    ];
    for (const { occurrence: parameter, tag } of parameters) {
      const entities = parameter.field.key.$tag === "NamedField"
        ? [fieldEntity(ID, parameter.sourceField.name, [parameter])]
        : [];
      const projected = tryProjectFieldFacets(entities, [parameter], loaded.fieldFacetDirectives!);
      expect(projected.ok).toBe(false);
      if (!projected.ok) expect(projected.error.$tag).toBe(tag);
    }
  });

  test("function parameter labels keep selector uniqueness and other facets type-only", () => {
    expect(() => loadFenelModule([
      '@fieldLabel "text" "Text"',
      "read : (text: String) -> String",
      '@fieldLabel "text" "Other"',
      "read text = text",
    ].join("\n"), "demo")).toThrow(/@fieldLabel "text" is declared more than once/);
    expect(() => loadFenelModule(
      '@native\n@widget "text" "input"\nread : (text: String) -> String\n', "demo",
    )).toThrow(/@widget may not be placed on a function declaration/);
  });

  test("resolves contextual and UUID presentation precedence independently per slot", () => {
    const instances = new Map([
      ["Codeable", { typeName: "Codeable", args: [ID], methods: { codeName: "displayName" } }],
      ["Labelable", { typeName: "Labelable", args: [ID], methods: { label: "Facet label" } }],
      ["Describable", { typeName: "Describable", args: [ID], methods: { description: "Facet description" } }],
      ["Iconable", { typeName: "Iconable", args: [ID], methods: { icon: "facet-icon" } }],
      ["Displayable", { typeName: "Displayable", args: [ID], methods: { hint: { widget: "facet-widget" } } }],
    ]);
    const registry = {
      getFieldRepresentation: (typeName: string) => instances.get(typeName),
    } as unknown as ModuleRegistry;

    expect(resolveRegistryFieldPresentation(registry, ID, {
      display: { widget: "override-widget" },
    })).toEqual({
      label: "Facet label",
      description: "Facet description",
      icon: "facet-icon",
      display: { widget: "override-widget" },
      source: "contextual-override",
    });
    expect(resolveRegistryFieldPresentation(registry, ID, { label: "Override label" })).toEqual({
      label: "Override label",
      description: "Facet description",
      icon: "facet-icon",
      display: { widget: "facet-widget" },
      source: "contextual-override",
    });
    instances.delete("Labelable");
    expect(resolveRegistryFieldPresentation(registry, ID)).toEqual({
      label: "Display Name",
      description: "Facet description",
      icon: "facet-icon",
      display: { widget: "facet-widget" },
      source: "uuid-field-facet",
    });
  });

  test("projects Codeable/Labelable and merges widget/help on the UUID target", () => {
    const projected = projectFieldFacets([entity], [occurrence], [
      directive({ kind: "label", label: "Title" }),
      directive({ kind: "widget", widget: "text" }),
      directive({ kind: "helpText", helpText: "Shown publicly" }),
      directive({ kind: "repositoryReuse" }),
    ]);
    expect(projected.codeables).toHaveLength(1);
    expect(projected.labelables[0]?.args).toEqual([ID]);
    expect(projected.displayables[0]?.args).toEqual([ID]);
    expect(projected.displayables[0]?.methods).toEqual({
      hint: {
        widget: { $tag: "Just", _0: "text" },
        helpText: { $tag: "Just", _0: "Shown publicly" },
      },
    });
    expect(projected.repositoryReusable).toEqual([ID]);
    expect(projected.all.some((facet) => String(facet.args[0]).includes("."))).toBe(false);
  });

  test("missing selector is a structured error", () => {
    const bad = { ...directive({ kind: "label", label: "Bad" }), selector: "missing" };
    const result = tryProjectFieldFacets([entity], [occurrence], [bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("MissingFieldFacetSelector");
  });

  test("resolves nested-record and case-qualified variant selectors through typed paths", () => {
    const nested = namedOccurrence(ID_2, [
      fieldPath.named("profile"),
      fieldPath.named("displayName"),
    ]);
    const variant = namedOccurrence(ID_3, [
      fieldPath.named("choice"),
      fieldPath.variantCase("Person"),
      fieldPath.named("displayName"),
    ]);
    const projected = projectFieldFacets(
      [
        fieldEntity(ID_2, "displayName", [nested]),
        fieldEntity(ID_3, "displayName", [variant]),
      ],
      [nested, variant],
      [
        directive({ kind: "label", label: "Nested name" }, "profile.displayName"),
        directive({ kind: "label", label: "Variant name" }, "choice.Person.displayName"),
      ],
    );
    expect(projected.labelables.map((facet) => facet.args[0]).sort()).toEqual([ID_2, ID_3].sort());
  });

  test("rejects a readable selector shared by distinct nested and variant typed paths", () => {
    const nested = namedOccurrence(ID_2, [
      fieldPath.named("choice"),
      fieldPath.named("Person"),
      fieldPath.named("displayName"),
    ]);
    const variant = namedOccurrence(ID_3, [
      fieldPath.named("choice"),
      fieldPath.variantCase("Person"),
      fieldPath.named("displayName"),
    ]);
    const result = tryProjectFieldFacets(
      [
        fieldEntity(ID_2, "displayName", [nested]),
        fieldEntity(ID_3, "displayName", [variant]),
      ],
      [nested, variant],
      [directive({ kind: "label", label: "Ambiguous" }, "choice.Person.displayName")],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("AmbiguousFieldFacetSelector");
  });

  test("classifies an exact typed positional occurrence before considering other owners", () => {
    const positional = positionalOccurrence(0, [fieldPath.named("items"), fieldPath.position(0)]);
    const elsewhere = namedOccurrence(ID_2, [fieldPath.named("items"), fieldPath.named("_0")], otherOwner);
    const result = tryProjectFieldFacets(
      [fieldEntity(ID_2, "_0", [elsewhere])],
      [positional, elsewhere],
      [directive({ kind: "label", label: "Not global" }, "items._0")],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("PositionalFieldFacetSelector");
  });

  test("rejects a selector shared by named and positional occurrences in one owner", () => {
    const positional = positionalOccurrence(0, [fieldPath.named("items"), fieldPath.position(0)]);
    const named = namedOccurrence(ID_2, [fieldPath.named("items"), fieldPath.named("_0")]);
    const result = tryProjectFieldFacets(
      [fieldEntity(ID_2, "_0", [named])],
      [positional, named],
      [directive({ kind: "label", label: "Ambiguous" }, "items._0")],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("AmbiguousFieldFacetSelector");
  });

  test("classifies a selector that resolves only under another typed owner", () => {
    const elsewhere = namedOccurrence(ID_2, [fieldPath.named("title")], otherOwner);
    const result = tryProjectFieldFacets(
      [fieldEntity(ID_2, "title", [elsewhere])],
      [elsewhere],
      [directive({ kind: "label", label: "Wrong owner" })],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("CrossOwnerFieldFacetSelector");
  });

  test("classifies identical duplicate source-selector slots instead of collapsing them", () => {
    const duplicate = directive({ kind: "label", label: "Title" });
    const result = tryProjectFieldFacets([entity], [occurrence], [duplicate, duplicate]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.$tag).toBe("DuplicateFieldFacetSelector");
      expect(result.error.typeName).toBe("Labelable");
    }
  });

  test("classifies conflicting duplicate source-selector slots in either order", () => {
    const first = directive({ kind: "label", label: "First" });
    const second = directive({ kind: "label", label: "Second" });
    for (const directives of [[first, second], [second, first]]) {
      const result = tryProjectFieldFacets([entity], [occurrence], directives);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.$tag).toBe("ConflictingFieldFacetSelector");
        expect(result.error.typeName).toBe("Labelable");
      }
    }
  });

  test("dedupes identical UUID facets across owners but rejects conflicting values", () => {
    const inDemo = namedOccurrence(ID, [fieldPath.named("title")]);
    const inOther = namedOccurrence(ID, [fieldPath.named("headline")], otherOwner, "headline");
    const reusedEntity = fieldEntity(ID, "title", [inDemo, inOther]);
    const same = projectFieldFacets(
      [reusedEntity],
      [inDemo, inOther],
      [
        directive({ kind: "label", label: "Shared" }, "title"),
        directive({ kind: "label", label: "Shared" }, "headline", "Other"),
      ],
    );
    expect(same.labelables).toHaveLength(1);

    const conflict = tryProjectFieldFacets(
      [reusedEntity],
      [inDemo, inOther],
      [
        directive({ kind: "label", label: "First" }, "title"),
        directive({ kind: "label", label: "Second" }, "headline", "Other"),
      ],
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.$tag).toBe("ConflictingFieldFacet");
  });
});
