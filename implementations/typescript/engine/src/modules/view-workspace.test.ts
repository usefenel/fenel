import { describe, expect, test } from "bun:test";
import { invokeCallable } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { viewModule } from "./view";

const registry = createRegistry([stdModule, pictureModule, viewModule]);
const context = registry.evaluateContext();
const tag = ($tag: string, fields: Record<string, unknown> = {}): any => ({ $tag, ...fields });
const nothing = tag("Nothing");
const just = (value: unknown) => tag("Just", { _0: value });
const publicSource = tag("PublicSource");
const account = (accountId: string) => tag("AccountSource", { accountId });

function run(name: string, ...args: unknown[]): any {
  const fn = registry.getFunction("view." + name);
  if (!fn) throw new Error("Missing Fenel workspace function " + name);
  return invokeCallable({ $ref: fn.id }, args, context);
}

function edit(workspace: any, ...commands: unknown[]): any {
  const result = run("applyWorkspaceCommands", workspace, commands);
  expect(result.$tag).toBe("Ok");
  return result._0;
}

const lens = (id: string, source = publicSource) => run("defaultWorkspaceLens", id, source);
const start = () => run("defaultWorkspace", "public", publicSource);
const add = (id: string, source = publicSource) => tag("AddWorkspaceLens", { lens: lens(id, source) });
const setPresentation = (target: unknown, presentation: string) =>
  tag("SetWorkspacePresentation", { target, presentation: tag(presentation) });
const valueTarget = (source: unknown, focus: unknown) => tag("ValuePresentationTarget", { source, focus });
const focus = (path: unknown[], passThrough: number[] = []) => tag("ValueFocus", {
  listId: "root-account-a", itemId: "same-item", path, rootItem: true, passThrough,
});

describe("Fenel personal workspace", () => {
  test("defaults are ordinary typed data with public anonymous and all-data account sources", () => {
    const workspace = run("workspaceDefaultForAccount", "one", nothing);
    expect(workspace).toMatchObject({
      $tag: "WorkspacePreferences", activeLensId: "one",
      display: tag("SingleLens"),
      bar: tag("WorkspaceBar", { mode: tag("DockedBar"), position: tag("BarTop") }),
      presentations: [],
    });
    expect(workspace.lenses[0]).toMatchObject({
      id: "one", source: publicSource, focus: tag("RootFocus"), title: nothing,
      presentation: tag("AutomaticPresentation"),
    });
    expect(run("workspaceDefaultForAccount", "two", just("account-b")).lenses[0].source).toEqual(tag("AllDataSource"));
    expect(registry.getEntity("WorkspacePreferences")).toBeDefined();
  });

  test("all-data targets retain available source order and coordinates without containing the root itself", () => {
    const sources = [tag("AllDataSource"), publicSource, account("account-a"), tag("ThisTabSource"), account("account-b")];
    expect(run("allDataRootTargets", sources)).toEqual([
      valueTarget(publicSource, tag("RootFocus")),
      valueTarget(account("account-a"), tag("RootFocus")),
      valueTarget(tag("ThisTabSource"), tag("RootFocus")),
      valueTarget(account("account-b"), tag("RootFocus")),
    ]);
    expect(run("allDataRootTargets", [])).toEqual([]);
    expect(run("allDataRootTargets", [tag("AllDataSource")])).toEqual([]);
    expect(run("workspaceSourceEqual", tag("AllDataSource"), tag("AllDataSource"))).toBe(true);
    for (const source of sources.slice(1)) {
      expect(run("workspaceSourceEqual", tag("AllDataSource"), source)).toBe(false);
      expect(run("workspaceSourceEqual", source, tag("AllDataSource"))).toBe(false);
    }
  });

  test("lenses from independent accounts and public data coexist without copying their contents", () => {
    const workspace = edit(start(), add("a", account("account-a")), add("b", account("account-b")));
    expect(workspace.lenses.map((entry: any) => entry.source)).toEqual([publicSource, account("account-a"), account("account-b")]);
    expect(workspace.activeLensId).toBe("b");
    expect(run("workspaceVisibleLenses", workspace).map((entry: any) => entry.id)).toEqual(["b"]);
    const tiled = edit(workspace, tag("SetWorkspaceDisplay", { display: tag("TiledLenses") }));
    expect(run("workspaceTilePlan", tiled, 1200)).toEqual(tag("WorkspaceTilePlan", {
      columns: 2, rows: 2, lensIds: ["public", "a", "b"],
    }));
    expect(run("workspaceTilePlan", tiled, 480)).toEqual(tag("WorkspaceTilePlan", {
      columns: 1, rows: 3, lensIds: ["public", "a", "b"],
    }));
    expect(JSON.stringify(workspace)).not.toContain('"contents"');
  });

  test("four wide tiled lenses make two rows and switching single view retains all saved lenses", () => {
    const workspace = edit(start(), add("a"), add("b"), add("c"),
      tag("SetWorkspaceDisplay", { display: tag("TiledLenses") }));
    expect(run("workspaceTilePlan", workspace, 1200)).toMatchObject({ columns: 2, rows: 2 });
    const single = edit(workspace, tag("SelectWorkspaceLens", { id: "a" }),
      tag("SetWorkspaceDisplay", { display: tag("SingleLens") }));
    expect(single.lenses).toHaveLength(4);
    expect(run("workspaceTilePlan", single, 1200)).toEqual(tag("WorkspaceTilePlan", {
      columns: 1, rows: 1, lensIds: ["a"],
    }));
  });

  test("removing a saved lens selects a survivor and keeps at least one saved definition", () => {
    const original = edit(start(), add("a"));
    const remaining = edit(original, tag("RemoveWorkspaceLens", { id: "a" }));
    expect(remaining.activeLensId).toBe("public");
    expect(remaining.lenses).toHaveLength(1);
    expect(run("applyWorkspaceCommand", remaining, tag("RemoveWorkspaceLens", { id: "public" }))).toEqual(
      tag("Err", { _0: "Keep at least one lens in the workspace." }),
    );
    expect(original.lenses).toHaveLength(2);
  });

  test("closing displayed lenses preserves saved data, selects a survivor, and permits zero displayed lenses", () => {
    const both = edit(start(), add("a"), tag("SetWorkspaceDisplay", { display: tag("TiledLenses") }));
    const one = edit(both, tag("CloseWorkspaceLens", { id: "public" }));
    expect(run("workspaceVisibleLenses", one).map((entry: any) => entry.id)).toEqual(["a"]);
    expect(one.lenses).toEqual(both.lenses);
    const empty = edit(one, tag("CloseWorkspaceLens", { id: "a" }));
    expect(run("workspaceVisibleLenses", empty)).toEqual([]);
    expect(run("workspaceActiveLens", empty)).toEqual(nothing);
    expect(run("workspaceTilePlan", empty, 1200)).toMatchObject({ columns: 1, rows: 0, lensIds: [] });
    expect(run("validateWorkspacePreferences", empty).$tag).toBe("Ok");
    const reopened = edit(empty, tag("OpenWorkspaceLens", { id: "public" }));
    expect(run("workspaceVisibleLenses", reopened).map((entry: any) => entry.id)).toEqual(["public"]);
    const alongside = edit(reopened, tag("OpenWorkspaceLens", { id: "a" }));
    expect(run("workspaceVisibleLenses", alongside).map((entry: any) => entry.id)).toEqual(["a"]);
    expect(alongside.display.groups[0].layers).toEqual([["public"], ["a"]]);
    expect(alongside.activeLensId).toBe("a");
    expect(alongside.lenses).toEqual(both.lenses);
  });

  test("ordered lens groups retain layers and reveal the one underneath when the top closes", () => {
    const original = edit(start(), tag("SetWorkspaceDisplay", { display: run("workspaceGroupedDisplay", start()) }),
      add("a"), tag("OpenWorkspaceLens", { id: "a" }), add("b"), tag("SplitWorkspaceLens", { id: "b" }));
    expect(original.display).toEqual(tag("GroupedLenses", { activeGroupId: "1", groups: [
      tag("LensGroup", { id: "1", layers: [["public"], ["a", "b"]], merged: true }),
    ] }));
    expect(run("workspaceVisibleLenses", original).map((entry: any) => entry.id)).toEqual(["a", "b"]);
    const only = edit(original, tag("SetCurrentLensLayer", { ids: ["b"] }));
    expect(only.display.groups[0].layers).toEqual([["public"], ["b"]]);
    expect(edit(only, tag("SetCurrentLensLayer", { ids: ["a", "b"] })).display.groups[0].layers).toEqual([["public"], ["a", "b"]]);
    const second = edit(original, tag("AddLensGroup", { id: "second" }), tag("OpenWorkspaceLens", { id: "public" }));
    expect(run("workspaceVisibleLenses", second).map((entry: any) => entry.id)).toEqual(["public"]);
    const back = edit(second, tag("SelectLensGroup", { id: "1" }));
    expect(run("workspaceVisibleLenses", back).map((entry: any) => entry.id)).toEqual(["a", "b"]);
    const closed = edit(back, tag("CloseWorkspaceLens", { id: "a" }), tag("CloseWorkspaceLens", { id: "b" }));
    expect(run("workspaceVisibleLenses", closed).map((entry: any) => entry.id)).toEqual(["public"]);
    expect(closed.display.groups[1].layers).toEqual([["public"]]);
    expect(closed.lenses).toEqual(original.lenses);
    expect(run("validateWorkspacePreferences", closed).$tag).toBe("Ok");
  });

  test("shared borders default on, and a free lens is a window that older saves still dock", () => {
    const grouped = edit(start(), tag("SetWorkspaceDisplay", { display: run("workspaceGroupedDisplay", start()) }));
    expect(grouped.display.groups[0].merged).toBe(true);
    const separate = edit(grouped, tag("SetLensGroupMerged", { id: "1", merged: false }));
    expect(separate.display.groups[0].merged).toBe(false);
    const legacy = JSON.parse(JSON.stringify(grouped));
    delete legacy.display.groups[0].merged;
    expect(run("validateWorkspacePreferences", legacy).$tag).toBe("Ok");
    const floated = edit(grouped, tag("EditWorkspaceLens", { id: "public", command: tag("SetLensPlacement", {
      placement: tag("FreePlacement", { x: 12, y: 24, width: 400, height: 300 }),
    }) }));
    expect(floated.lenses[0].placement).toEqual(tag("FreePlacement", { x: 12, y: 24, width: 400, height: 300 }));
    const bare = JSON.parse(JSON.stringify(floated));
    delete bare.lenses[0].placement;
    const moved = edit(bare, tag("EditWorkspaceLens", { id: "public", command: tag("SetLensFocus", { focus: tag("RootFocus") }) }));
    expect(moved.lenses[0].placement).toEqual(tag("DockedPlacement"));
  });

  test("saved group order validates and survives a JSON round trip", () => {
    const base = edit(start(), add("a"), add("b"));
    const displayed = edit(base, tag("SetWorkspaceDisplay", { display: tag("GroupedLenses", {
      activeGroupId: "second", groups: [tag("LensGroup", { id: "first", layers: [["public"]] }),
        tag("LensGroup", { id: "second", layers: [["b", "a"]] })],
    }) }));
    const restored = JSON.parse(JSON.stringify(displayed));
    expect(run("validateWorkspacePreferences", restored).$tag).toBe("Ok");
    expect(run("workspaceVisibleLenses", restored).map((entry: any) => entry.id)).toEqual(["b", "a"]);
    const removed = edit(restored, tag("RemoveLensGroup", { id: "second" }));
    expect(removed.display.activeGroupId).toBe("first");
    expect(run("workspaceVisibleLenses", removed).map((entry: any) => entry.id)).toEqual(["public"]);
    for (const display of [
      tag("GroupedLenses", { activeGroupId: "missing", groups: [tag("LensGroup", { id: "first", layers: [["public"]] })] }),
      tag("GroupedLenses", { activeGroupId: "first", groups: [tag("LensGroup", { id: "first", layers: [["public", "public"]] })] }),
      tag("GroupedLenses", { activeGroupId: "first", groups: [tag("LensGroup", { id: "first", layers: [["missing"]] })] }),
    ]) expect(run("applyWorkspaceCommand", base, tag("SetWorkspaceDisplay", { display })).$tag).toBe("Err");
  });

  test("display selection rejects unknown or repeated saved identities", () => {
    for (const ids of [["missing"], ["public", "public"]]) {
      expect(run("applyWorkspaceCommand", start(), tag("SetWorkspaceDisplay", { display: tag("VisibleLenses", { ids }) })).$tag).toBe("Err");
    }
    expect(run("applyWorkspaceCommand", start(), tag("OpenWorkspaceLens", { id: "missing" })).$tag).toBe("Err");
  });

  test("commands preserve stable identities, reject incomplete reorders, and fail atomically", () => {
    const original = edit(start(), add("a"), add("b"));
    expect(edit(original, tag("ReorderWorkspaceLenses", { ids: ["b", "public", "a"] })).lenses.map((entry: any) => entry.id))
      .toEqual(["b", "public", "a"]);
    for (const command of [
      add("a"), add(""), tag("SelectWorkspaceLens", { id: "missing" }),
      tag("ReplaceWorkspaceLens", { id: "a", lens: lens("changed") }),
      tag("ReorderWorkspaceLenses", { ids: ["public", "a"] }),
      tag("ReorderWorkspaceLenses", { ids: ["public", "a", "a"] }),
      tag("UnknownWorkspaceCommand"),
    ]) {
      expect(run("applyWorkspaceCommands", original, [tag("RemoveWorkspaceLens", { id: "public" }), command]).$tag).toBe("Err");
    }
    expect(original.lenses.map((entry: any) => entry.id)).toEqual(["public", "a", "b"]);
  });

  test("navigation resets temporary presentation but preserves saved preferences", () => {
    const preferred = edit(start(), setPresentation(valueTarget(publicSource, tag("RootFocus")), "GridPresentation"));
    const overridden = edit(preferred, tag("EditWorkspaceLens", {
      id: "public", command: tag("SetLensPresentation", { presentation: tag("ListPresentation") }),
    }));
    const navigated = edit(overridden, tag("EditWorkspaceLens", {
      id: "public", command: tag("SetLensFocus", { focus: focus([]) }),
    }));
    expect(navigated.lenses[0].presentation).toEqual(tag("AutomaticPresentation"));
    expect(navigated.presentations).toEqual(preferred.presentations);
    const switched = edit(navigated, tag("EditWorkspaceLens", {
      id: "public", command: tag("SetLensSource", { source: account("other") }),
    }));
    expect(switched.lenses[0]).toMatchObject({ source: account("other"), focus: tag("RootFocus") });
  });

  test("presentation precedence is lens, exact value, nominal type, then automatic", () => {
    const original = start();
    const typeRef = just("image-type-identity");
    const typeTarget = tag("InhabitantsPresentationTarget", { typeRef: "image-type-identity" });
    const rootTarget = valueTarget(publicSource, tag("RootFocus"));
    const inherited = edit(original, setPresentation(typeTarget, "GridPresentation"));
    expect(run("workspacePresentationFor", original, original.lenses[0], typeRef)).toEqual(tag("AutomaticPresentation"));
    expect(run("workspacePresentationFor", inherited, inherited.lenses[0], typeRef)).toEqual(tag("GridPresentation"));
    expect(run("workspacePresentationFor", inherited, inherited.lenses[0], nothing)).toEqual(tag("AutomaticPresentation"));
    const specific = edit(inherited, setPresentation(rootTarget, "ListPresentation"));
    expect(run("workspacePresentationFor", specific, specific.lenses[0], typeRef)).toEqual(tag("ListPresentation"));
    const temporary = edit(specific, tag("EditWorkspaceLens", {
      id: "public", command: tag("SetLensPresentation", { presentation: tag("TabsPresentation") }),
    }));
    expect(run("workspacePresentationFor", temporary, temporary.lenses[0], typeRef)).toEqual(tag("TabsPresentation"));
    const cleared = edit(specific, setPresentation(rootTarget, "AutomaticPresentation"));
    expect(run("workspacePresentationFor", cleared, cleared.lenses[0], typeRef)).toEqual(tag("GridPresentation"));
    expect(cleared.presentations).toHaveLength(1);
  });

  test("a type value's own presentation does not become its inhabitants' default", () => {
    const typeLens = { ...lens("type"), focus: focus([tag("FieldStep", { name: "Image" })]) };
    const workspace = edit(start(), setPresentation(valueTarget(typeLens.source, typeLens.focus), "TreePresentation"));
    expect(run("workspacePresentationFor", workspace, typeLens, just("Type"))).toEqual(tag("TreePresentation"));
    expect(run("workspacePresentationFor", workspace, lens("image", account("another-account")), just("image-type-identity")))
      .toEqual(tag("AutomaticPresentation"));
    const withDefault = edit(workspace, setPresentation(tag("InhabitantsPresentationTarget", {
      typeRef: "image-type-identity",
    }), "ValuePresentation"));
    expect(run("workspacePresentationFor", withDefault, lens("image", account("another-account")), just("image-type-identity")))
      .toEqual(tag("ValuePresentation"));
  });

  test("preferences separate accounts and field/index paths while ignoring breadcrumb-only stops", () => {
    const fieldPath = focus([tag("FieldStep", { name: "1" })]);
    const indexPath = focus([tag("IndexStep", { index: 1 })]);
    expect(run("workspaceFocusEqual", fieldPath, indexPath)).toBe(false);
    expect(run("workspaceFocusEqual", fieldPath, focus([tag("FieldStep", { name: "1" })], [0]))).toBe(true);
    expect(run("workspaceFocusEqual", fieldPath, focus([]))).toBe(false);
    const workspace = edit(start(), setPresentation(valueTarget(account("a"), fieldPath), "TabsPresentation"));
    expect(run("workspacePresentationFor", workspace, { ...lens("a", account("a")), focus: fieldPath }, nothing))
      .toEqual(tag("TabsPresentation"));
    expect(run("workspacePresentationFor", workspace, { ...lens("b", account("b")), focus: fieldPath }, nothing))
      .toEqual(tag("AutomaticPresentation"));
  });

  test("bar placement is persisted data and unknown renderer codes fail explicitly", () => {
    const bar = tag("WorkspaceBar", { mode: tag("DockedBar"), position: tag("BarLeft") });
    expect(edit(start(), tag("SetWorkspaceBar", { bar })).bar).toEqual(bar);
    expect(run("workspacePresentationCode", tag("GridPresentation"))).toBe("grid");
    expect(run("workspacePresentationFromCode", "grid")).toEqual(tag("Ok", { _0: tag("GridPresentation") }));
    expect(run("workspacePresentationFromCode", "derive-canvas").$tag).toBe("Err");
  });

  test("desktop is a retained lens and value presentation, independent of account data", () => {
    const presentation = run("workspacePresentationFromCode", "desktop");
    expect(presentation).toEqual(tag("Ok", { _0: tag("DesktopPresentation") }));
    expect(run("workspacePresentationCode", presentation._0)).toBe("desktop");
    const workspace = edit(start(), tag("EditWorkspaceLens", { id: "public",
      command: tag("SetLensPresentation", { presentation: presentation._0 }) }));
    expect(run("workspacePresentationFor", workspace, workspace.lenses[0], nothing)).toEqual(presentation._0);
    expect(run("workspacePreferencesFromValue", workspace)).toEqual(just(workspace));
    expect(workspace.lenses[0].source).toEqual(publicSource);
    expect(workspace.lenses[0].focus).toEqual(tag("RootFocus"));
  });

  test("personal root acquisition keeps the occurrence identity and rejects ambiguous saved workspaces", () => {
    const workspace = start();
    const unrelated = { id: "article", value: { title: "An unrelated personal value" } };
    const preferences = { id: "saved-preferences", value: workspace };
    expect(run("workspacePreferenceEntry", [unrelated])).toEqual(tag("Ok", { _0: nothing }));
    expect(run("workspacePreferenceEntry", [unrelated, preferences])).toEqual(tag("Ok", {
      _0: just(tag("LocusEntry", preferences)),
    }));
    expect(run("workspacePreferenceEntry", [preferences, { id: "second-preferences", value: workspace }]).$tag).toBe("Err");
    expect(run("workspacePreferencesFromValue", workspace)).toEqual(just(workspace));
    expect(run("workspacePreferencesFromValue", unrelated.value)).toEqual(nothing);
  });

  test("a recognized malformed saved workspace is an acquisition error instead of an invitation to seed another", () => {
    const broken = { ...start(), activeLensId: "missing" };
    expect(run("workspacePreferencesFromValue", broken)).toEqual(nothing);
    expect(run("workspacePreferenceEntry", [{ id: "saved-preferences", value: broken }])).toEqual(tag("Err", {
      _0: "The selected lens is no longer in the workspace.",
    }));
  });

  test("bootstrap preserves the saved public or other-account lens and exact nested focus", () => {
    const nested = focus([tag("FieldStep", { name: "details" }), tag("IndexStep", { index: 2 })], [0]);
    const saved = edit(start(), tag("AddWorkspaceLens", { lens: { ...lens("other", account("account-b")),
      focus: nested, presentation: tag("TabsPresentation") } }));
    const result = run("workspaceBootstrapPlan", [{ id: "preferences", declaredWorkspace: true, literal: just(saved) }],
      "fresh", just("account-a"), 390);
    expect(result.$tag).toBe("Ok");
    const plan = result._0._0;
    expect(plan.value).toEqual(saved);
    expect(plan.itemId).toEqual(just("preferences"));
    expect(plan.visibleLenses).toEqual([saved.lenses[1]]);
    expect(plan.activeLens).toEqual(just(saved.lenses[1]));
    expect(plan.tilePlan).toEqual(run("workspaceTilePlan", saved, 390));
    expect(plan.presentations).toEqual([tag("WorkspaceBootstrapPresentation", { lensId: "other", presentation: tag("TabsPresentation"), code: "tabs", dependsOnType: false })]);
    const publicPlan = run("workspaceBootstrapPlan", [{ id: "preferences", declaredWorkspace: true, literal: just(start()) }],
      "fresh", just("account-a"), 1200)._0._0;
    expect(publicPlan.visibleLenses[0].source).toEqual(publicSource);
  });

  test("bootstrap defaults use the existing Fenel model without claiming a saved occurrence", () => {
    const result = run("workspaceBootstrapPlan", [
      { id: "article", declaredWorkspace: false, literal: just({ title: "Unrelated" }) },
      { id: "expression", declaredWorkspace: false, literal: nothing },
    ], "fresh", just("account-a"), 1200);
    const plan = result._0._0;
    expect(plan.itemId).toEqual(nothing);
    expect(plan.value).toEqual(run("workspaceDefaultForAccount", "fresh", just("account-a")));
    expect(plan.visibleLenses).toEqual(plan.value.lenses);
  });

  test("bootstrap defers declared computed or nonliteral preferences instead of replacing them", () => {
    for (const literal of [nothing, just({ __let: { bindings: [], body: { kind: "literal", value: start() } } }), just(42)]) {
      expect(run("workspaceBootstrapPlan", [{ id: "computed", declaredWorkspace: true, literal }],
        "fresh", just("account-a"), 390)).toEqual(tag("Ok", { _0: nothing }));
    }
    expect(run("workspaceBootstrapPlan", [
      { id: "known", declaredWorkspace: true, literal: just(start()) },
      { id: "computed", declaredWorkspace: true, literal: nothing },
    ], "fresh", just("account-a"), 390)).toEqual(tag("Ok", { _0: nothing }));
  });

  test("bootstrap rejects recognized invalid preferences and duplicate saved occurrences", () => {
    const broken = { ...start(), activeLensId: "missing" };
    expect(run("workspaceBootstrapPlan", [{ id: "broken", declaredWorkspace: true, literal: just(broken) }],
      "fresh", just("account-a"), 390)).toEqual(tag("Err", { _0: "The selected lens is no longer in the workspace." }));
    const candidates = ["one", "two"].map(id => ({ id, declaredWorkspace: true, literal: just(start()) }));
    expect(run("workspaceBootstrapPlan", candidates, "fresh", just("account-a"), 390).$tag).toBe("Err");
  });

  test("bootstrap presentation codes agree with saved value preferences and actual tiling", () => {
    const saved = edit(start(), setPresentation(valueTarget(publicSource, tag("RootFocus")), "GridPresentation"),
      add("other", account("account-b")), tag("SetWorkspaceDisplay", { display: tag("TiledLenses") }));
    const plan = run("workspaceBootstrapPlan", [{ id: "preferences", declaredWorkspace: true, literal: just(saved) }],
      "fresh", just("account-a"), 1200)._0._0;
    expect(plan.tilePlan).toEqual(run("workspaceTilePlan", saved, 1200));
    expect(plan.visibleLenses).toEqual(run("workspaceVisibleLenses", saved));
    expect(plan.presentations.map((entry: { code: string }) => entry.code)).toEqual(["grid", "auto"]);
  });
});


describe("ordinary lens field preferences", () => {
  test("old lenses retain declaration order; stale and duplicate IDs do not bind to other fields", () => {
    expect(run("workspaceFieldProjection", ["a", "b", "new"], nothing)).toMatchObject({ order: ["a", "b", "new"], visible: ["a", "b", "new"] });
    const fields = just(tag("LensFieldPreferences", { order: ["removed", "b", "b"], hidden: ["a", "removed"] }));
    expect(run("workspaceFieldProjection", ["a", "b", "new"], fields)).toMatchObject({ order: ["b", "a", "new"], visible: ["b", "new"] });
  });
  test("settings preserve data, survive layout/title changes and reset when the subject changes", () => {
    const fields = just(tag("LensFieldPreferences", { order: ["b", "a"], hidden: ["a"] }));
    const original = lens("one");
    const older = { ...original }; delete older.fields;
    expect(run("workspaceLensFields", older)).toEqual(nothing);
    const changed = run("workspaceApplyLensCommand", original, tag("SetLensFields", { fields }));
    expect(changed.$tag).toBe("Ok");
    expect(changed._0).toMatchObject({ source: original.source, focus: original.focus, fields });
    expect(run("workspaceLensWithPresentation", changed._0, tag("TablePresentation")).fields).toEqual(fields);
    expect(run("workspaceLensWithTitle", changed._0, just("Table")).fields).toEqual(fields);
    expect(run("workspaceLensWithFocus", changed._0, tag("ListFocus", { listId: "other" })).fields).toEqual(nothing);
    expect(run("workspaceLensWithSource", changed._0, account("other")).fields).toEqual(nothing);
  });
});
