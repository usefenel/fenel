import { describe, expect, test } from "bun:test";
import type { CatalogSection } from "../type-catalog";
import type { FieldDef, FenelType, TypeView } from "../types";
import { Just, Nothing, peelMaybeValue } from "../type-foundation";
import { createTemplateRegistry } from "../template-registry";
import { dispatchEngineBody, dispatchedTraversalSemanticSlotsError, marshalTraversalDeclarationType } from "../engine-bodies-dispatch";

test("full view drafts retain inline targets and localized display data through JSON persistence", () => {
  const draft = {
    name: "polymorphic-card",
    targetType: { $var: "a" } as FenelType,
    description: { en: "A card", fr: "Une carte" },
    readDisplay: { labelMap: { pending: "Waiting" }, colorMap: { pending: "orange" } },
    editDisplay: {
      options: [{ value: "pending", label: { en: "Waiting", fr: "En attente" }, image: "pending.svg" }],
      refFilter: { var: "candidate.enabled" },
    },
    layout: { sections: [], responsive: [{ maxWidth: 640, sections: [{ rows: [] }] }] },
    listDisplay: { style: "table" as const, columns: [{ field: "status", editable: true }] },
  };
  const stored = JSON.parse(JSON.stringify(normalizeTypeViewDraft(draft))) as TypeView;
  expect(normalizeTypeViewDraft(typeViewToDraft(stored))).toEqual(stored);
  expect(stored.targetType).toEqual({ $var: "a" });
  expect(typeViewToDraft(stored).editDisplay?.options).toEqual(draft.editDisplay.options);
});
import {
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
} from "./environment";
import {
  buildSurfaceCatalogSnapshot,
  createSurfaceEnvironment,
  defaultLayoutForType,
  defaultListDisplayForType,
  editDisplayToDraft,
  fieldCandidatesForType,
  normalizeTypeViewDraft,
  planSurfaceForType,
  readDisplayToDraft,
  surfaceBuiltinTypeViews,
  surfaceConditionContext,
  surfaceConditionScopeForType,
  surfaceLayoutRenderPlan,
  surfaceListDisplayRenderPlan,
  surfaceReadValuePlan,
  surfaceReaderViewPlan,
  targetTypeOptionsForCatalog,
  typeViewToDraft,
  typeViewsForSurface,
} from "./surface";

describe("declared collection card presentation", () => {
  const record: FenelType = { $record: { fields: [
    { name: "name", type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} },
  ] } };
  const constructor: FenelType = { $variant: { cases: [{ name: "Entry", label: Nothing, fields: record.$record.fields }] } };
  const wire = (type: FenelType) => marshalTraversalDeclarationType(type, "collection-policy", { graftMissingSemanticKeys: false }).type;
  const policy = (type?: FenelType, facts: unknown[] = []) => dispatchEngineBody("engine:surfaceCollectionContentFirst", [
    type === undefined ? Nothing : Just(wire(type)), facts,
  ]);

  test("records and single data constructors use content first through captured aliases and refinements", () => {
    expect(policy(record)).toBe(true);
    expect(policy(constructor)).toBe(true);
    const alias = { $ref: "DeclaredMember" } as FenelType;
    const captured = [{ name: "DeclaredMember", type: Just(wire({ $refined: { base: constructor, set: { $tag: "SeAll" } } })), reference: wire(alias) }];
    expect(policy(alias, captured)).toBe(true);
    expect(policy(alias)).toBe(false);
    expect(policy(alias, [{ name: "DeclaredMember", type: Just(wire(alias)), reference: wire(alias) }])).toBe(false);
  });

  test("broad and heterogeneous declarations retain member identities, including identically typed functions", () => {
    for (const type of [undefined, { $var: "a" }, { $complement: { $void: true } },
      { $arrow: { params: [], returns: record } }, { $union: [record, constructor] },
      { $el: { var: "selected" } }, { $opaque: { name: "Carrier", pure: constructor } },
      { $variant: { cases: [{ name: "A", fields: [] }, { name: "B", fields: [] }] } },
    ] as (FenelType | undefined)[]) expect(policy(type)).toBe(false);
  });

  test("an aggregate Viewable selects the existing whole component before structural fallback", () => {
    const view: TypeView = { name: "recipe-card", readComponent: "recipe-card", display: Nothing };
    const args = { views: [view], componentNames: ["recipe-card"],
      methods: { defaultView: "recipe-card", defaultInlineView: "recipe-card" },
      compact: false, hasFields: false, record: false, evaluateContext: {} };
    expect(surfaceReaderViewPlan(args).view?.readComponent).toBe("recipe-card");
    expect(surfaceReaderViewPlan({ ...args, methods: {} }).view).toBeUndefined();
    expect(surfaceReaderViewPlan({ ...args, componentNames: [] }).view).toBeUndefined();
  });
});

const str = { $ref: "String" } as FenelType;
const num = { $ref: "Number" } as FenelType;
const bool = { $ref: "Boolean" } as FenelType;

function field(name: string, type: FenelType, label?: string): FieldDef {
  return { name, label: label ? Just(label) : Nothing, type, meta: {}, ui: Nothing };
}

const profileType = {
  $record: {
    fields: [
      field("firstName", str, "First name"),
      field("email", { $refined: { base: str, set: { $tag: "SeRef", handle: "format:email" } } } as FenelType, "Email"),
      field("active", bool, "Active"),
      field("stats", {
        $record: {
          fields: [
            field("score", num, "Score"),
          ],
        },
      } as FenelType, "Stats"),
    ],
  },
} as FenelType;

const catalogSections: CatalogSection[] = [
  {
    id: "atom",
    label: "Atoms",
    description: "atoms",
    entries: [
      { id: "atom:String", name: "String", description: "text", category: "atom", entity: { id: "String", type: str } },
    ],
  },
  {
    id: "format",
    label: "Formats",
    description: "formats",
    entries: [
      { id: "format:email", name: "Email", description: "email text", category: "format", entity: { id: "Email", type: str } },
    ],
  },
  {
    id: "entity",
    label: "Entities",
    description: "entities",
    entries: [
      { id: "entity:Profile", name: "Profile", description: "profile rows", category: "entity", entity: { id: "Profile", type: profileType } },
    ],
  },
];

const authoringSnapshot = buildAuthoringCatalogSnapshot(catalogSections);
const authoringEnv = createAuthoringEnvironment(authoringSnapshot);

const detailView: TypeView = {
  name: "profile-detail",
  targetType: { $ref: "Profile" },
  display: Nothing,
  layout: {
    sections: [{ rows: [{ slots: [{ field: "firstName", span: 6 }] }] }],
  },
};

const cardView: TypeView = {
  name: "profile-cards",
  targetType: { $ref: "Profile" },
  display: Nothing,
  readComponent: "profile-card",
  listDisplay: {
    style: "cards",
    columns: [{ field: "firstName", label: "First name" }],
  },
};

const userDetailView: TypeView = {
  name: "profile-user-detail",
  targetType: { $ref: "Profile" },
  display: Nothing,
  layout: {
    sections: [{ rows: [{ slots: [{ field: "email", span: 12 }] }] }],
  },
};

const surfaceEnv = createSurfaceEnvironment({
  authoring: authoringEnv,
  catalog: buildSurfaceCatalogSnapshot(authoringSnapshot, {
    views: [detailView, cardView, userDetailView],
    defaultViewByTypeName: { Profile: "profile-detail" },
  }),
  resolveNamedType: (name) => name === "Profile" ? profileType : undefined,
});

function requireBuiltin(name: string): TypeView {
  const view = surfaceBuiltinTypeViews().find((candidate) => candidate.name === name);
  if (!view) throw new Error(`Missing built-in TypeView ${name}`);
  return view;
}

describe("surface catalog and field planning", () => {
  test("builds target-type options from the authoring catalog", () => {
    const options = targetTypeOptionsForCatalog(authoringSnapshot).map((option) => ({
      value: option.value,
      group: option.group,
    }));
    expect(options).toContainEqual({ value: "String", group: "Scalar" });
    expect(options).toContainEqual({ value: "Email", group: "Format" });
    expect(options).toContainEqual({ value: "Profile", group: "Entity" });
  });

  test("derives field candidates and condition scope from the target type", () => {
    const candidates = fieldCandidatesForType(surfaceEnv, { $ref: "Profile" } as FenelType);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "firstName",
      "email",
      "active",
      "stats",
      "stats.score",
    ]);
    expect(candidates.find((candidate) => candidate.path === "stats.score")?.depth).toBe(1);

    const scope = surfaceConditionScopeForType(surfaceEnv, { $ref: "Profile" } as FenelType, "edit");
    expect(scope.variables.map((variable) => variable.name)).toContain("firstName");
    expect(scope.variables.map((variable) => variable.name)).toContain("_mode");
    expect(scope.variables.map((variable) => variable.name)).toContain("_channel");
  });

  test("plans default layout and list display over typed fields", () => {
    const layout = defaultLayoutForType(surfaceEnv, { $ref: "Profile" } as FenelType);
    expect(layout.sections[0]?.rows[0]?.slots.map((slot) => slot.field)).toEqual(["firstName", "email"]);

    const list = defaultListDisplayForType(surfaceEnv, { $ref: "Profile" } as FenelType);
    expect(list.style).toBe("table");
    expect(list.columns?.map((column) => column.field)).toEqual(["firstName", "email", "active", "stats"]);
  });
});

describe("surface draft normalization", () => {
  test("round-trips TypeView display drafts through canonical Maybe slots", () => {
    const view = normalizeTypeViewDraft({
      name: " profile-status ",
      description: "Status display",
      targetTypeName: "Profile",
      readDisplay: { format: "badge", labelMap: { active: "Active" } },
      editDisplay: { widget: "select" },
      listDisplay: { style: "table", columns: [{ field: "firstName" }] },
    });

    expect(view.name).toBe("profile-status");
    expect(view.targetType).toEqual({ $ref: "Profile" });
    const display = view.display.$tag === "Just" ? view.display._0 : null;
    expect(display?.read.$tag).toBe("Just");
    expect(display?.edit.$tag).toBe("Just");
    expect(readDisplayToDraft(display?.read.$tag === "Just" ? display.read._0 : undefined)).toEqual({
      format: "badge",
      labelMap: { active: "Active" },
    });
    expect(editDisplayToDraft(display?.edit.$tag === "Just" ? display.edit._0 : undefined)).toEqual({
      widget: "select",
    });
    expect(typeViewToDraft(view).targetTypeName).toBe("Profile");
  });
});

describe("surface selection cascade", () => {
  test("uses explicit, entity-default, matching, and inferred plans before universal fallback", () => {
    const explicit = planSurfaceForType(surfaceEnv, { $ref: "Profile" } as FenelType, "list", {
      explicitViewName: "profile-cards",
    });
    expect(explicit.source).toBe("explicit");
    expect(explicit.listDisplay?.style).toBe("cards");
    expect(explicit.componentName).toBe("profile-card");
    expect(explicit.fallback).toBe("universal-renderer");

    const entityDefault = planSurfaceForType(surfaceEnv, { $ref: "Profile" } as FenelType, "read");
    expect(entityDefault.source).toBe("entity-default");
    expect(entityDefault.layout?.sections[0]?.rows[0]?.slots[0]?.field).toBe("firstName");

    const userOverride = planSurfaceForType(surfaceEnv, { $ref: "Profile" } as FenelType, "read", {
      userOverrideViewName: "profile-user-detail",
    });
    expect(userOverride.source).toBe("user-override");
    expect(userOverride.layout?.sections[0]?.rows[0]?.slots[0]?.field).toBe("email");

    const matching = planSurfaceForType(
      createSurfaceEnvironment({
        authoring: authoringEnv,
        catalog: buildSurfaceCatalogSnapshot(authoringSnapshot, { views: [cardView] }),
        resolveNamedType: (name) => name === "Profile" ? profileType : undefined,
      }),
      { $ref: "Profile" } as FenelType,
      "list",
    );
    expect(matching.source).toBe("matching-view");

    const inferred = planSurfaceForType(
      createSurfaceEnvironment({
        authoring: authoringEnv,
        catalog: buildSurfaceCatalogSnapshot(authoringSnapshot),
        resolveNamedType: (name) => name === "Profile" ? profileType : undefined,
      }),
      { $ref: "Profile" } as FenelType,
      "edit",
    );
    expect(inferred.source).toBe("inferred-structural");
    expect(inferred.layout?.sections.length).toBe(1);
  });

  test("lists applicable views and builds condition runtime context", () => {
    expect(typeViewsForSurface(surfaceEnv, { $ref: "Profile" } as FenelType, "list").map((view) => view.name)).toEqual([
      "profile-cards",
    ]);
    expect(surfaceConditionContext({ firstName: "Ada" }, "read")).toEqual({
      firstName: "Ada",
      _mode: "read",
      _channel: "web",
    });
  });
});

describe("Fenel-authored surface library", () => {
  test("exposes built-in seeded domain views as ordinary TypeView data", () => {
    const views = surfaceBuiltinTypeViews();
    const names = views.map((view) => view.name);
    expect(names).toContain("profile-detail");
    expect(names).toContain("profile-cards");
    expect(names).toContain("profile-table");
    expect(names).toContain("item-detail");
    expect(names).toContain("item-table");
    expect(names).toContain("inventory-detail");
    expect(names).toContain("purchase-table");

    const profileDetail = requireBuiltin("profile-detail");
    expect(typeViewToDraft(profileDetail).targetTypeName).toBe("profile");
    expect(profileDetail.layout?.sections[0]?.rows[1]?.slots.map((slot) => slot.field)).toEqual([
      "firstName",
      "lastName",
    ]);

    const itemTable = requireBuiltin("item-table");
    expect(itemTable.listDisplay?.columns?.map((column) => column.field)).toEqual([
      "name",
      "slug",
      "type",
      "createdAt",
    ]);
  });

  test("feeds Fenel-authored built-ins through the existing planner cascade", () => {
    const builtins = surfaceBuiltinTypeViews();
    const env = createSurfaceEnvironment({
      authoring: authoringEnv,
      catalog: buildSurfaceCatalogSnapshot(authoringSnapshot, {
        views: builtins,
        defaultViewByTypeName: { profile: "profile-detail" },
      }),
      resolveNamedType: (name) => name === "profile" ? profileType : undefined,
    });

    const entityDefault = planSurfaceForType(env, { $ref: "profile" } as FenelType, "read");
    expect(entityDefault.source).toBe("entity-default");
    expect(entityDefault.view?.name).toBe("profile-detail");
    expect(entityDefault.layout?.sections[0]?.rows[2]?.slots.map((slot) => slot.template)).toEqual([
      "email",
      "phone-formatted",
    ]);

    const listEnv = createSurfaceEnvironment({
      authoring: authoringEnv,
      catalog: buildSurfaceCatalogSnapshot(authoringSnapshot, { views: builtins }),
      resolveNamedType: (name) => name === "profile" ? profileType : undefined,
    });
    const profileList = planSurfaceForType(listEnv, { $ref: "profile" } as FenelType, "list");
    expect(profileList.source).toBe("matching-view");
    expect(profileList.view?.name).toBe("profile-cards");
    expect(profileList.listDisplay?.style).toBe("cards");
    expect(profileList.componentName).toBe("profile-card");

    const userView: TypeView = {
      name: "profile-user-low",
      targetType: { $ref: "profile" },
      display: Nothing,
      layout: { sections: [{ rows: [{ slots: [{ field: "active", span: 12 }] }] }] },
    };
    const userEnv = createSurfaceEnvironment({
      authoring: authoringEnv,
      catalog: buildSurfaceCatalogSnapshot(authoringSnapshot, {
        views: [...builtins, userView],
        defaultViewByTypeName: { profile: "profile-detail" },
      }),
      resolveNamedType: (name) => name === "profile" ? profileType : undefined,
    });
    const userPlan = planSurfaceForType(userEnv, { $ref: "profile" } as FenelType, "read", {
      userOverrideViewName: "profile-user-low",
    });
    expect(userPlan.source).toBe("user-override");
    expect(userPlan.layout?.sections[0]?.rows[0]?.slots[0]?.field).toBe("active");
  });

  test("round-trips seeded views through the general view editor shape", () => {
    const profileDetail = requireBuiltin("profile-detail");
    const draft = typeViewToDraft(profileDetail);
    const normalized = normalizeTypeViewDraft(draft);

    expect(normalized.name).toBe("profile-detail");
    expect(typeViewToDraft(normalized).targetTypeName).toBe("profile");
    expect(normalized.display).toEqual(Nothing);
    expect(normalized.layout?.sections[0]?.rows[0]?.slots[0]?.field).toBe("type");
  });
});

describe("Fenel-owned surface registry semantics", () => {
  test("resolves TypeView inheritance with Maybe-aware display merges", () => {
    const registry = createTemplateRegistry();
    const parent = normalizeTypeViewDraft({
      name: "status-base",
      readDisplay: { format: "badge", emptyText: "-" },
      editDisplay: { widget: "select" },
      layout: { sections: [{ rows: [{ slots: [{ field: "active", span: 6 }] }] }] },
    });
    const child = normalizeTypeViewDraft({
      name: "status-child",
      extends: "status-base",
      readDisplay: { labelMap: { active: "Active" } },
      editDisplay: { placeholder: "Choose status" },
      readComponent: "missing-status-read",
    });
    registry.registerAll([parent, child]);

    const resolved = registry.resolve("status-child");
    expect(resolved?.name).toBe("status-child");
    expect(resolved?.layout?.sections[0]?.rows[0]?.slots[0]?.field).toBe("active");
    expect(resolved?.readComponent).toBe("missing-status-read");
    expect(registry.getComponent("missing-status-read")).toBeNull();

    const display = peelMaybeValue(resolved?.display ?? Nothing);
    const read = peelMaybeValue(display?.read ?? Nothing);
    const edit = peelMaybeValue(display?.edit ?? Nothing);
    expect(readDisplayToDraft(read ?? undefined)).toEqual({
      format: "badge",
      labelMap: { active: "Active" },
      emptyText: "-",
    });
    expect(editDisplayToDraft(edit ?? undefined)).toEqual({
      widget: "select",
      placeholder: "Choose status",
    });
  });

  test("selects conditional defaults before fallback defaults and resolves inheritance", () => {
    const registry = createTemplateRegistry();
    const base = normalizeTypeViewDraft({
      name: "text-base",
      readDisplay: { format: "text" },
    });
    const fallback = normalizeTypeViewDraft({
      name: "email-fallback",
      extends: "text-base",
      readDisplay: { icon: "mail" },
    });
    const vip = normalizeTypeViewDraft({
      name: "email-vip",
      extends: "email-fallback",
      readDisplay: { prefix: "VIP " },
    });
    registry.registerAll([base, fallback, vip]);
    registry.setDefault("$refined", "email-fallback");
    registry.setDefaultRules("$refined", [
      { when: { var: "vip" }, template: "email-vip" },
    ]);

    expect(registry.getDefault("$refined", { vip: false })?.name).toBe("email-fallback");
    expect(registry.getDefault("$refined", { vip: true })?.name).toBe("email-vip");

    const selected = registry.resolveForField(
      field("email", { $refined: { base: str, set: { $tag: "SeRef", handle: "format:email" } } } as FenelType),
      { vip: true },
    );
    expect(selected?.name).toBe("email-vip");
    expect(readDisplayToDraft(
      peelMaybeValue(peelMaybeValue(selected?.display ?? Nothing)?.read ?? Nothing) ?? undefined,
    )).toEqual({
      format: "text",
      icon: "mail",
      prefix: "VIP ",
    });
  });
});

describe("Fenel-owned surface render plans", () => {
  const statusTemplate = normalizeTypeViewDraft({
    name: "status-template",
    readDisplay: {
      format: "badge",
      labelMap: { active: "Active" },
      colorMap: { active: "green" },
      transform: "uppercase",
      emptyText: "No status",
      prefix: "(",
      suffix: ")",
    },
    readComponent: "status-read",
  });
  const statusRead = peelMaybeValue(peelMaybeValue(statusTemplate.display)?.read ?? Nothing) ?? undefined;

  test("projects read-display plans in Fenel before Solid renders them", () => {
    const active = surfaceReadValuePlan("active", statusRead, "read-display");
    expect(active.kind).toBe("badge");
    expect(active.text).toBe("(ACTIVE)");
    expect(active.color).toBe("green");
    expect(active.empty).toBe(false);

    const empty = surfaceReadValuePlan("", statusRead, "read-display");
    expect(empty.text).toBe("NO STATUS");
    expect(empty.empty).toBe(true);

    const dateTemplate = normalizeTypeViewDraft({
      name: "date-template",
      readDisplay: { format: "date-short" },
    });
    const dateRead = peelMaybeValue(peelMaybeValue(dateTemplate.display)?.read ?? Nothing) ?? undefined;
    const date = surfaceReadValuePlan("2026-01-02", dateRead, "read-display");
    expect(date.kind).toBe("date-short");
    expect(date.hostFormat).toBe("date-short");
    expect(date.text).toBe("2026-01-02");
  });

  test("plans visible layout slots, template components, read fallback, and missing fields", () => {
    const fields = [
      field("active", bool, "Active"),
      field("email", str, "Email"),
    ];
    const plan = surfaceLayoutRenderPlan({
      layout: {
        sections: [
          {
            title: "Hidden",
            when: { var: "hide" },
            rows: [{ slots: [{ field: "active" }] }],
          },
          {
            title: "Visible",
            rows: [
              {
                gap: "1rem",
                slots: [
                  { field: "active", span: 4, template: "status-template" },
                  { field: "missing", span: 2 },
                  { field: "email", when: { var: "showEmail" } },
                ],
              },
            ],
          },
        ],
      },
      fields,
      values: { active: "active", hide: false, showEmail: false },
      errors: { active: "Bad status" },
      mode: "read",
      resolveTemplate: (name) => name === "status-template" ? statusTemplate : undefined,
    });

    expect(plan.context._mode).toBe("read");
    expect(plan.sections.map((section) => section.title)).toEqual(["Visible"]);
    expect(plan.sections[0]?.rows[0]?.gap).toBe("1rem");
    expect(plan.sections[0]?.rows[0]?.slots.map((slot) => slot.fieldName)).toEqual(["active", "missing"]);

    const active = plan.sections[0]?.rows[0]?.slots[0];
    expect(active?.label).toBe("active");
    expect(active?.span).toBe(4);
    expect(active?.componentName).toBe("status-read");
    expect(active?.templateName).toBe("status-template");
    expect(active?.template?.name).toBe("status-template");
    expect(active?.fallbackKind).toBe("read-display");
    expect(active?.display?.text).toBe("(ACTIVE)");
    expect(active?.error).toBe("Bad status");

    const missing = plan.sections[0]?.rows[0]?.slots[1];
    expect(missing?.fallbackKind).toBe("missing-field");
    expect(missing?.field).toBeUndefined();
  });

  test("plans list-display columns for DataTable leaves", () => {
    const plan = surfaceListDisplayRenderPlan({
      listDisplay: {
        style: "table",
        columns: [
          { field: "active", label: "Status", span: 3, template: "status-template" },
          { field: "email" },
          { field: "ghost" },
        ],
      },
      fields: [
        field("active", bool, "Active"),
        field("email", str, "Email"),
      ],
      resolveTemplate: (name) => name === "status-template" ? statusTemplate : undefined,
    });

    expect(plan.style).toBe("table");
    expect(plan.columns.map((column) => column.fieldName)).toEqual(["active", "email", "ghost"]);
    expect(plan.columns[0]).toMatchObject({
      label: "Status",
      span: 3,
      componentName: "status-read",
      fallbackKind: "read-display",
      editable: false,
    });
    expect(readDisplayToDraft(plan.columns[0]?.readDisplay)).toMatchObject({
      format: "badge",
      labelMap: { active: "Active" },
    });
    expect(plan.columns[1]?.fallbackKind).toBe("scalar");
    expect(plan.columns[2]?.fallbackKind).toBe("missing-field");
  });
});

// Record constructors retain a runtime tag even though their declared shape is
// a record. A tag chooses a payload only for an actual variant declaration.
// The identities below are the original Local D1 fixture, captured read-only.
describe("read child types of tagged record values", () => {
  const calendarDate = { $ref: "4a6fd49d-82cb-4446-99f5-49afe6c07d09" } as FenelType;
  const person = { $ref: "99185fac-6bf2-4dd4-b6c9-7a01cf482f8a" } as FenelType;
  const identified = (name: string, type: FenelType, id: string): FieldDef => ({
    ...field(name, type), key: { $tag: "NamedField", ref: { $ref: id } },
  });
  const transaction = { $record: { fields: [
    identified("amount", num, "55251e48-9875-4f7c-868c-b04360bd4e23"),
    identified("person", person, "929ef44d-2d50-40b9-98d0-6dabe64b282b"),
    identified("date", calendarDate, "e808a887-bbf2-4af2-b936-a2d04ccae455"),
  ] } } as FenelType;
  const transactionOwner = "3a5887cf-f2ef-483d-a9e2-0e21c44b7eb2";
  const wire = (type: FenelType) => marshalTraversalDeclarationType(type, "reader-test", { graftMissingSemanticKeys: false }).type;
  const select = (type: FenelType | undefined, key: string | number, tag?: string,
    facts: unknown[] = [], element?: FenelType) => dispatchEngineBody("engine:surfaceReaderChildTypePlan", [
      type ? Just(wire(type)) : Nothing, element ? Just(element) : Nothing, key,
      tag === undefined ? Nothing : Just(tag), facts,
    ]);

  test("the original Transaction date and person retain their exact types with and without a record tag", () => {
    for (const tag of [undefined, transactionOwner]) {
      expect(select(transaction, "date", tag)).toEqual(Just(calendarDate));
      expect(select(transaction, "person", tag)).toEqual(Just(person));
      expect(select(transaction, "amount", tag)).toEqual(Just(num));
    }
  });

  test("a named record uses its captured declaration rather than interpreting its tag as a variant case", () => {
    const named = { $ref: transactionOwner } as FenelType;
    const facts = [{ name: transactionOwner, type: Just(wire(transaction)), reference: wire(named) }];
    expect(select(named, "date", transactionOwner, facts)).toEqual(Just(calendarDate));
    expect(select(named, "missing", transactionOwner, facts)).toEqual(Nothing);
  });

  test("variant payloads still require the exact case and exact physical field", () => {
    const variant = { $variant: { cases: [
      { name: "Scheduled", fields: [field("date", calendarDate)] },
      { name: "Named", fields: [field("date", str)] },
      { name: "Empty", fields: [] },
    ] } } as FenelType;
    expect(select(variant, "date", "Scheduled")).toEqual(Just(calendarDate));
    expect(select(variant, "date", "Named")).toEqual(Just(str));
    expect(select(variant, "date", "Empty")).toEqual(Nothing);
    expect(select(variant, "date", "Unknown")).toEqual(Nothing);
    expect(select(variant, "date")).toEqual(Nothing);
    expect(select(variant, "other", "Scheduled")).toEqual(Nothing);
  });

  test("missing and cyclic declarations do not acquire record fields", () => {
    const unknown = { $ref: "MissingOwner" } as FenelType;
    expect(select(unknown, "date", transactionOwner)).toEqual(Nothing);
    expect(select(undefined, "date", transactionOwner)).toEqual(Nothing);
    const a = { $ref: "CycleA" } as FenelType, b = { $ref: "CycleB" } as FenelType;
    expect(select(a, "date", transactionOwner, [
      { name: "CycleA", type: Just(wire(b)), reference: wire(a) },
      { name: "CycleB", type: Just(wire(a)), reference: wire(b) },
    ])).toEqual(Nothing);
  });

  test("list element projection and non-field misses keep their existing behavior", () => {
    expect(select(undefined, 0, undefined, [], calendarDate)).toEqual(Just(calendarDate));
    expect(select(undefined, 0)).toEqual(Nothing);
    expect(select(undefined, "0", undefined, [], calendarDate)).toEqual(Nothing);
    expect(select(transaction, "missing", transactionOwner)).toEqual(Nothing);
  });
});

describe("declared fields in the reader value plan", () => {
  const owner = "490400f1-4b02-4e63-8590-ea83161a5d96";
  const alias = "1f311cf5-1a80-447f-b9a2-631dc211f45e";
  const slots: FieldDef[] = [
    { ...field("order", num), key: { $tag: "NamedField", ref: { $ref: "2390b916-03b1-4c86-9790-0476f4883c08" } } },
    { ...field("name", str), key: { $tag: "NamedField", ref: { $ref: "dabd3205-957e-40f4-8384-f0b1c43d7d3e" } } },
    { ...field("capital", str), key: { $tag: "NamedField", ref: { $ref: "a4ab670c-65e7-4bd9-85ab-0f97fa29223a" } } },
  ];
  // The Greek catalogue has this ordinary one-constructor, explicit-tag shape.
  const letter = { $variant: { discriminator: "$tag", cases: [{ name: "Letter", fields: slots }] } } as FenelType;
  const record = { $record: { fields: slots } } as FenelType;
  const refined = (base: FenelType): FenelType => ({ $refined: { base, set: { $tag: "SeAll" } } });
  const opaque = (pure: FenelType): FenelType => ({ $opaque: { name: "ReaderNative", pure } });
  const capture = (type: FenelType, prefix: string) =>
    marshalTraversalDeclarationType(type, prefix, { graftMissingSemanticKeys: false });
  const reference = capture({ $ref: owner }, "reference").type;
  const project = (declared: unknown, facts: unknown[] = []) =>
    dispatchEngineBody("engine:surfaceReaderValueTypesPlan", [Just(declared), Nothing, Nothing, facts]) as {
      fieldTokens: typeof Nothing | { $tag: "Just"; _0: string[] };
      nominal: unknown;
      valueType: unknown;
    };
  const captured = (type: unknown) => [{ name: owner, type: Just(type), reference }];

  test("one-constructor fields retain declaration order, exact owner and packet-local token bindings", () => {
    for (const type of [letter, refined(letter)]) {
      expect(dispatchedTraversalSemanticSlotsError(type)).toEqual(Nothing);
      const batch = capture(type, "letter");
      const expected = [...batch.fields.keys()];
      expect(project(batch.type).fieldTokens).toEqual(Just(expected));
      const named = project(reference, captured(batch.type));
      expect(named.fieldTokens).toEqual(Just(expected));
      expect(named.nominal).toEqual(Just(owner));
      expect(named.valueType).toEqual(Just(reference));
      const selected = peelMaybeValue<string[]>(named.fieldTokens)!;
      expect(selected.map(token => batch.fields.get(token)?.name)).toEqual(["order", "name", "capital"]);
      selected.forEach((token, index) => expect(batch.fields.get(token)).toBe(slots[index]));
    }
    const batch = capture(letter, "aliased-letter");
    const aliasReference = capture({ $ref: alias }, "alias-reference").type;
    expect(project(reference, [
      { name: owner, type: Just(aliasReference), reference },
      { name: alias, type: Just(batch.type), reference: aliasReference },
    ]).fieldTokens).toEqual(Just([...batch.fields.keys()]));
  });

  test("record selectors keep their existing behavior and opaque pure constructors stay hidden", () => {
    const emptyRecord = { $record: { fields: [] } } as FenelType;
    for (const type of [record, opaque(record), emptyRecord, opaque(emptyRecord)]) {
      const batch = capture(type, "record");
      const expected = Just([...batch.fields.keys()]);
      expect(project(batch.type).fieldTokens).toEqual(expected);
      expect(project(reference, captured(batch.type)).fieldTokens).toEqual(expected);
    }
    const refinedRecord = capture(refined(record), "refined-record");
    expect(project(refinedRecord.type).fieldTokens).toEqual(Just([...refinedRecord.fields.keys()]));
    expect(project(reference, captured(refinedRecord.type)).fieldTokens).toEqual(Just([]));
    for (const type of [opaque(letter), refined(opaque(letter))]) {
      const batch = capture(type, "native");
      expect(project(batch.type).fieldTokens).toEqual(Nothing);
      expect(project(reference, captured(batch.type)).fieldTokens).toEqual(Just([]));
    }
    const nullary = capture({ $variant: { cases: [{ name: "Only", label: Nothing, fields: [] }] } }, "nullary");
    expect(project(nullary.type).fieldTokens).toEqual(Just([]));
  });

  test("sums, unresolved declarations and dependent forms do not acquire one case's fields", () => {
    for (const type of [
      { $variant: { cases: [{ name: "Letter", fields: slots }, { name: "Other", fields: [] }] } },
      { $variant: { cases: [] } },
      { $union: [letter, record] },
      { $el: { var: "selectedType" } },
    ] as FenelType[]) {
      const batch = capture(type, "unselected");
      expect(project(batch.type).fieldTokens).toEqual(Nothing);
      expect(project(reference, captured(batch.type)).fieldTokens).toEqual(Just([]));
    }
    expect(project(reference).fieldTokens).toEqual(Nothing);
    expect(project(reference, [{ name: owner, type: Nothing, reference }]).fieldTokens).toEqual(Nothing);
    const aliasReference = capture({ $ref: alias }, "cycle-reference").type;
    expect(project(reference, [
      { name: alias, type: Just(capture(letter, "other-owner").type), reference: aliasReference },
    ]).fieldTokens).toEqual(Nothing);
    expect(project(reference, [
      { name: owner, type: Just(aliasReference), reference },
      { name: alias, type: Just(reference), reference: aliasReference },
    ]).fieldTokens).toEqual(Just([]));
  });
});
