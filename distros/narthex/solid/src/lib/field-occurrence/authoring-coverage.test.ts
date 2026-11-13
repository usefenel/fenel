// @ts-nocheck -- Bun's test globals are outside the Solid ambient tsconfig.
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createEffect, onSettled, flush, snapshot } from "../../../node_modules/solid-js/dist/solid.dev.js";
import { instanceKey, isEmptyMethods, normalizeInstanceDraft, representationPresetDraft, withDraft } from "../instances/instance-draft";

const ROOT = new URL("../../../../../../", import.meta.url);

async function source(path: string): Promise<string> {
  return (await readFile(new URL(path, ROOT), "utf8")).replaceAll("\r\n", "\n");
}

function exportedFunction(text: string, name: string, declaration = "export function", indentation = ""): string {
  const exact = text.indexOf(`${declaration} ${name}(`);
  const start = exact >= 0 ? exact : text.indexOf(`${declaration} ${name}<`);
  const end = text.indexOf(`\n${indentation}}`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + indentation.length + 2).replace(/^export /, "");
}

function sourceSection(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

const FIELD_ID = "11111111-1111-4111-8111-111111111111";
const typeOwner = (name = "A") => ({ name, id: `row-${name}`, definition: {
  id: name, label: `${name} label`, description: "Saved description", type: { $record: { fields: [{
    name: "field", key: { $tag: "NamedField", ref: { $ref: FIELD_ID } }, type: { $ref: "String" },
  }] } },
} });

let typeEditorFactory: Promise<Function> | undefined;
async function typeEditorFixture() {
  // Execute the actual lifecycle and submission boundaries with controlled IO.
  // This does not mount the renderer or establish async facet-UI reachability.
  const make = await (typeEditorFactory ??= (async () => {
    const [detail, model, nativeDraft, persistence, session, instanceEditor] = await Promise.all([
      source("distros/narthex/solid/src/routes/app/types/[id]/index.tsx"),
      source("distros/narthex/solid/src/lib/field-occurrence/model.ts"),
      source("distros/narthex/solid/src/lib/native-draft.ts"),
      source("distros/narthex/solid/src/lib/representations/persist.ts"),
      source("distros/narthex/solid/src/lib/browser-session.ts"),
      source("distros/narthex/solid/src/lib/instances/InstanceEditor.tsx"),
    ]);
    const component = detail.slice(detail.indexOf("export function UserDefinedTypeDetail("));
    const facetChange = component.match(/onFieldFacetsChange=\{([^\n]*)\}/)?.[1];
    expect(facetChange).toBeDefined();
    const implementation = `function make(initial) {
      ${["namedFieldId", "fieldFacetDraftsForOccurrences", "desiredFieldFacetValues", "fieldFacetReplacementIds"]
        .map(name => exportedFunction(model, name)).join("\n")}
      ${exportedFunction(nativeDraft, "cloneDraftValue")}
      let epoch = 1;
      const [epochValue, setEpochValue] = createSignal(epoch);
      const sessionEpoch = () => epochValue();
      ${sourceSection(session, "export class StaleSessionResponseError", "export function assertCurrentSession").replace("export class", "class")}
      ${exportedFunction(session, "assertCurrentSession")}
      const io = { bundles: [], representationLookups: [], representations: [], reloads: [], reloadReads: [], invalidations: [] };
      let held;
      const lookupFailures = new Map();
      const waitForIO = async (stage, coordinate) => {
        if (held?.stage === stage || held?.stage === stage + ":" + coordinate) { held.enter(); await held.promise; }
      };
      const [selected, setSelected] = createSignal(initial);
      const props = { get name() { return selected().name; }, get id() { return selected().id; },
        get data() { return { definition: selected().definition }; }, onReload: reloadDefinition };
      const revalidate = key => io.invalidations.push(key);
      const userEntityName = () => props.name;
      const userDef = () => props.data;
      const getTypeByName = async name => { io.reloads.push(name); await waitForIO("reload"); };
      const refresh = async () => { io.reloadReads.push(props.name); };
      ${exportedFunction(detail, "reloadDefinition", "async function", "  ")}
      ${sourceSection(component, "  const [editing", "  const [showDeleteModal")}
      const api = { definitionBundleSave: async bundle => { io.bundles.push(bundle); await waitForIO("definition"); } };
      const defaultApiClient = {};
      const accountFieldRegistry = () => undefined;
      const findExistingRow = async (typeName, targetId) => {
        io.representationLookups.push({ typeName, targetId });
        if (lookupFailures.has(typeName)) throw Error(lookupFailures.get(typeName));
        await waitForIO("representation", typeName); return null;
      };
      const persistInstanceDraft = async draft => { io.representations.push(cloneDraftValue(draft)); };
      ${exportedFunction(persistence, "persistRepresentation", "export async function")}
      // Flat-record fixture: occurrence traversal is outside this lifecycle test.
      const typeFieldOccurrences = type => type.$record.fields;
      ${sourceSection(component, "  function startEdit", "  function startCodeEdit")}
      ${sourceSection(component, "  async function saveEdit", "  function dependents")}
      const authorFieldFacets = ${facetChange};
      async function saveInnerFacet(id, next) {
        const mode = () => "draft", variant = () => "display", draft = () => next;
        const draftMap = () => fieldFacets()[id] ?? {};
        const editingDraftKey = () => instanceKey(next);
        const props = { onDraftsChange: value => authorFieldFacets(id, value) };
        const closeEditor = () => {};
        ${exportedFunction(instanceEditor, "saveDraft", "async function", "  ")}
        await saveDraft();
      }
      return {
        open: () => startEdit(props.data.definition), cancel: cancelEdit, save: saveEdit,
        setLabel: setEditLabel, setDescription: setEditDesc, setShape: setEditType, seedFacets: setFieldFacets,
        editFacet: saveInnerFacet, changeOwner: setSelected,
        failRepresentation: (typeName, message) => lookupFailures.set(typeName, message),
        changeSession(next) { epoch = next; setEpochValue(next); },
        state: () => ({ editing: editing(), saving: saving(), error: error(), facets: cloneDraftValue(fieldFacets()) }), io,
        hold(stage) {
          let resolve, reject, enter;
          const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
          const entered = new Promise(done => { enter = done; });
          held = { stage, promise, resolve, reject, enter };
          return { entered, release(fail = false) {
            const gate = held; held = undefined;
            if (fail) gate.reject(Error("Held stage failed")); else gate.resolve();
          } };
        },
      };
    }`;
    return new Function("createSignal", "createEffect", "onSettled", "snapshot", "instanceKey", "isEmptyMethods", "withDraft",
      "normalizeInstanceDraft", "representationPresetDraft", new Bun.Transpiler({ loader: "ts" }).transformSync(implementation) + "\nreturn make;")(
      createSignal, createEffect, onSettled, snapshot, instanceKey, isEmptyMethods, withDraft, normalizeInstanceDraft, representationPresetDraft);
  })());
  let controls;
  const dispose = createRoot(dispose => { controls = make(typeOwner()); return dispose; });
  flush();
  return { controls, dispose };
}

function applyFacetHydration(editor: string, initial: Record<string, unknown>, loaded: unknown, fieldId: string) {
  const text = editor.replaceAll("\r\n", "\n");
  const start = text.indexOf("  createEffect(\n    () => ({ id: fieldId(), realm: currentIdentityRealm()");
  const end = text.indexOf("\n\n  const reuseRows", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  let current = initial;
  const calls: string[] = [];
  const authoring = {
    get facetsByFieldId() { return current; },
    onFieldFacetsChange(id: string, next: unknown) { calls.push("change"); current = { ...current, [id]: next }; },
    onFieldFacetsHydrate(id: string, next: unknown) { calls.push("hydrate"); current = { ...current, [id]: next }; },
  };
  const run = new Function("createEffect", "fieldId", "currentIdentityRealm", "persistedFacetDrafts", "props", "authoring",
    "facetLoadApplied", "facetDirty", "forgetFacets", "setFacetLoadApplied", "setFacetDirty", "setLocalFacets",
    new Bun.Transpiler({ loader: "ts" }).transformSync(text.slice(start, end)));
  run((read, apply) => apply(read()), () => fieldId, () => "account", () => ({ fieldId, drafts: loaded }), {}, authoring,
    () => false, () => true, () => { throw Error("Unexpected identity cleanup"); }, () => {}, () => {},
    () => { throw Error("Unexpected detached facet state"); });
  return { current, calls };
}

describe("field authoring surface coverage", () => {
  test("field facet hydration preserves owned complete replacement packets, including deletions", async () => {
    const [editor, model] = await Promise.all([
      source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx"),
      source("distros/narthex/solid/src/lib/field-occurrence/model.ts"),
    ]);
    const normalized = model.replaceAll("\r\n", "\n");
    const marshal = new Function("isEmptyMethods", new Bun.Transpiler({ loader: "ts" }).transformSync(
      ["desiredFieldFacetValues", "fieldFacetReplacementIds"].map(name => exportedFunction(normalized, name)).join("\n"),
    ) + "\nreturn map => ({desiredFacets:desiredFieldFacetValues(map),replaceFacetFieldIds:fieldFacetReplacementIds(map)});")(isEmptyMethods);
    const id = "11111111-1111-4111-8111-111111111111";
    const label = { typeName: "Labelable", args: [id], methods: { label: "Saved label" } };
    const description = { typeName: "Describable", args: [id], methods: { description: "Keep this" } };
    for (const sibling of [false, true]) {
      const loaded = { [instanceKey(label)]: label, ...(sibling ? { [instanceKey(description)]: description } : {}) };
      const emptied = { ...label, methods: { label: "" } };
      const deleted = withDraft(loaded, instanceKey(label), emptied, isEmptyMethods(emptied.methods));
      const initial = { [id]: deleted };
      const result = applyFacetHydration(editor, initial, loaded, id);
      expect(result.current).toBe(initial);
      expect(result.calls).toEqual([]);
      expect(marshal(result.current)).toEqual({
        desiredFacets: sibling ? [{ fieldId: id, typeName: "Describable", methods: description.methods }] : [],
        replaceFacetFieldIds: [id],
      });
    }
    const owned = { [instanceKey(label)]: { ...label, methods: { label: "Current complete draft" } } };
    expect(applyFacetHydration(editor, { [id]: owned }, { [instanceKey(label)]: label }, id).current[id]).toBe(owned);
    const absent = applyFacetHydration(editor, {}, { [instanceKey(label)]: label }, id);
    expect(absent.calls).toEqual(["hydrate"]);
    expect(absent.current[id]).toEqual({ [instanceKey(label)]: label });
  });

  test("bulk field facet hydration preserves owned complete maps and fills absent siblings", async () => {
    const text = (await source("distros/narthex/solid/src/routes/app/types/[id]/index.tsx")).replaceAll("\r\n", "\n");
    const start = text.indexOf("    setFieldFacets((current) => ({", text.indexOf("const loaded = accountFieldFacetDrafts(hydration.response"));
    const end = text.indexOf("\n  });", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const apply = new Function("setFieldFacets", "loaded", new Bun.Transpiler({ loader: "ts" }).transformSync(text.slice(start, end)));
    const loaded = { edited: { old: { methods: { label: "Persisted" } } }, absentSibling: {} };
    for (const owned of [{}, { current: { methods: { label: "Authored" } } }]) {
      let current = { edited: owned, retainedSibling: {} };
      apply(next => { current = next(current); }, loaded);
      expect(current.edited).toBe(owned);
      expect(current.absentSibling).toEqual({});
      expect(Object.keys(current)).toEqual(["edited", "retainedSibling", "absentSibling"]);
    }
  });

  test("current identity metadata is fetched by UUID outside the paginated reuse page", async () => {
    const editor = await source(
      "distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx",
    );
    expect(editor).toContain("getFieldAuthoringIdentity");
    expect(editor).toContain("...(await client.getFieldAuthoringIdentity(id))");
    expect(editor).toContain("result?.fieldId === id");
    expect(editor).not.toContain(
      "reuseCandidates().find((row) => row.fieldId === id)",
    );
    // Loading/error are undecided and lock; settled absence is an exhaustive
    // negative and leaves the local draft name editable. Global facets remain
    // separately gated on positive account/local source provenance.
    expect(editor).toContain(
      "(!!fieldId() && (currentIdentity.loading || !!currentIdentity.error))",
    );
    expect(editor).not.toContain("currentIdentityRealm() === undefined");
    expect(editor).toContain('realm === "account" || realm === "local"');
    expect(editor).toContain('field.sourceId !== client.rootId');
    expect(editor).toContain('realm !== "account"');
  });

  test("every persisted type/function field editor carries explicit resurrection authority", async () => {
    const saveSurfaces = await Promise.all([
      "distros/narthex/solid/src/routes/app/types/[id]/index.tsx",
      "distros/narthex/solid/src/routes/app/types/create.tsx",
      "distros/narthex/solid/src/routes/app/functions/index.tsx",
      "distros/narthex/solid/src/routes/app/functions/[name]/index.tsx",
      "distros/narthex/solid/src/routes/app/forms/index.tsx",
      "distros/narthex/solid/src/routes/app/home.tsx",
    ].map(source));
    for (const role of saveSurfaces) expect(role).toContain("resurrectFieldIds");

    const providerSurfaces = await Promise.all([
      "distros/narthex/solid/src/routes/app/types/[id]/index.tsx",
      "distros/narthex/solid/src/routes/app/types/create.tsx",
      "distros/narthex/solid/src/routes/app/functions/index.tsx",
      "distros/narthex/solid/src/lib/function-editor/FunctionCanvas.tsx",
      "distros/narthex/solid/src/routes/app/forms/index.tsx",
      "distros/narthex/solid/src/routes/app/home.tsx",
    ].map(source));
    for (const role of providerSurfaces) {
      expect(role).toContain("onFieldResurrectionChange");
      expect(role).toContain("ownerKey=");
    }
  });

  test("whole-owner resurrection queries carry kind and storage identity", async () => {
    const api = await source("distros/narthex/solid/src/lib/api.ts");
    expect(api).toContain("ownerKind: target.ownerKind");
    expect(api).toContain("storageName: target.storageName");

    const core = await source(
      "implementations/typescript/core/src/field-definition-command.ts",
    );
    expect(core).toContain("placeholderResurrectionOwner");
    expect(core).toContain("queryFieldResurrectionCandidates(owner, account.currentFields)");
  });

  test("facet hydration is field-tagged and cannot dirty the function draft", async () => {
    const [editor, canvas, store] = await Promise.all([
      source("distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx"),
      source("distros/narthex/solid/src/lib/function-editor/FunctionCanvas.tsx"),
      source("distros/narthex/solid/src/lib/function-editor/store.ts"),
    ]);
    expect(editor).toContain("return { fieldId: id, drafts }");
    expect(editor).toContain("persisted.fieldId !== id");
    expect(editor).toContain("getFieldFacetInstances");
    expect(canvas).toContain("onFieldFacetsHydrate=");
    const hydrateBody = store.slice(
      store.indexOf("hydrateFieldFacets("),
      store.indexOf("forgetFieldFacets("),
    );
    expect(hydrateBody).not.toContain("setDirty(true)");
  });

  test("type source stays readonly and visual authoring stages until explicit serialized save", async () => {
    const detail = await source(
      "distros/narthex/solid/src/routes/app/types/[id]/index.tsx",
    );
    expect(detail).toContain('<FenelCodeEditor value={codeSource()} readonly');
    expect(detail).toContain('<TypeBuilder value={editType()} onChange={setEditType}');
    expect(detail).toContain("onClick={saveEdit}");
    // Submission contents and awaiting are exercised by the lifecycle controls below.
    expect(detail).not.toContain("void api.definitionBundleSave(");
  });

  test("home pin authoring persists facet-only changes and fences repository types", async () => {
    const home = await source("distros/narthex/solid/src/routes/app/home.tsx");
    expect(home).toContain("bodyChanged || sigChanged || fieldAuthoringChanged");
    // Since 60a61cfe save() captures typeDraftDirty() into its intent first.
    expect(home).toContain('const typeDirty = !!(ep && nextType && entityState?.kind === "persisted" && typeDraftDirty());');
    expect(home).toContain("intent.typeDirty || fieldAuthoringChanged");
    expect(home).toContain("Repository and module types are authored in their source module.");
    expect(home).toContain("onFieldFacetsHydrate={hydrateFieldFacet}");
  });

  test("FunctionSpec showcase mode cannot perform account identity writes", async () => {
    const [editor, showcase] = await Promise.all([
      source("distros/narthex/solid/src/lib/function-spec-editor/FunctionSpecEditor.tsx"),
      source("distros/narthex/solid/src/routes/app/ui-showcase.tsx"),
    ]);
    expect(editor).toContain('authoringMode: "draft-only"');
    expect(editor).toContain('when={props.authoringMode === "persisted"}');
    expect(showcase).toContain('authoringMode="draft-only"');
  });
});

describe("dedicated type editor lifecycle boundaries", () => {
  test("Cancel writes nothing and reopening discards complete field facet drafts", async () => {
    const { controls: c, dispose } = await typeEditorFixture();
    try {
      c.open(); flush();
      c.seedFacets({ [FIELD_ID]: {}, abandonedSibling: {} }); flush();
      c.cancel(); flush();
      expect(c.state().editing).toBe(false);
      expect(c.io.bundles).toEqual([]);
      expect(c.io.representationLookups).toEqual([]);
      c.open(); flush();
      expect(c.state().facets).toEqual({});
      expect(c.io.bundles).toEqual([]);
    } finally { dispose(); }
  });

  test("genuine inner facet Save stays staged until the captured outer bundle is saved", async () => {
    const { controls: c, dispose } = await typeEditorFixture();
    try {
      c.open(); flush();
      const label = { typeName: "Labelable", args: [FIELD_ID], methods: { label: "Saved field" } };
      const description = { typeName: "Describable", args: [FIELD_ID], methods: { description: "Keep sibling facet" } };
      c.seedFacets({ [FIELD_ID]: { [instanceKey(label)]: label, [instanceKey(description)]: description }, removedField: {} }); flush();
      await c.editFacet(FIELD_ID, { ...label, methods: { label: "Authored field" } }); flush();
      expect(c.io.bundles).toEqual([]);
      expect(c.io.representationLookups).toEqual([]);
      expect(c.state().facets[FIELD_ID][instanceKey(label)].methods.label).toBe("Authored field");
      const shape = typeOwner().definition.type;
      c.setShape(shape); c.setLabel("Submitted label"); c.setDescription("Submitted description"); flush();
      const gate = c.hold("definition");
      const saving = c.save(); await gate.entered;
      const bundle = c.io.bundles[0];
      expect(bundle.ownerMutations[0].owner).toMatchObject({ ownerKey: "type:A", storageName: "A", storageId: "row-A" });
      expect(bundle.replaceFacetFieldIds).toEqual([FIELD_ID]);
      expect(bundle.desiredFacets).toHaveLength(2);
      expect(bundle.desiredFacets).toEqual(expect.arrayContaining([
        { fieldId: FIELD_ID, typeName: "Labelable", methods: { label: "Authored field" } },
        { fieldId: FIELD_ID, typeName: "Describable", methods: description.methods },
      ]));
      // Challenge the captured values directly; pending browser editing is separately locked.
      shape.$record.fields[0].name = "Later field";
      c.setLabel("Later label"); c.setDescription("Later description"); flush();
      expect(bundle.ownerMutations[0].owner.definition.type.$record.fields[0].name).toBe("field");
      gate.release(); await saving; flush();
      expect(c.io.representations.map(draft => [draft.typeName, draft.args[0], draft.methods])).toEqual([
        ["Codeable", "A", { codeName: "A" }],
        ["Labelable", "A", { label: "Submitted label" }],
        ["Describable", "A", { description: "Submitted description" }],
      ]);
      expect(c.io.reloads).toEqual(["A"]);
      expect(c.io.invalidations).toEqual(["definition"]);
      expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
    } finally { dispose(); }
  });

  for (const stage of ["definition", "representation", "reload"]) {
    for (const canceled of [false, true]) {
      test(`${stage} failure ${canceled ? "cannot affect a canceled edit" : "remains visible for its current edit"}`, async () => {
        const { controls: c, dispose } = await typeEditorFixture();
        try {
          c.open(); flush();
          const gate = c.hold(stage);
          const saving = c.save(); await gate.entered;
          if (canceled) { c.cancel(); flush(); c.open(); flush(); expect(c.state().editing).toBe(false); }
          gate.release(true); await saving; flush();
          expect(c.state()).toMatchObject({ editing: !canceled, saving: false, error: canceled ? "" : "Held stage failed" });
          if (canceled) { c.open(); flush(); expect(c.state().editing).toBe(true); }
        } finally { dispose(); }
      });
    }
  }

  for (const change of ["owner", "owner ABA", "session", "session ABA", "dispose"]) {
    test(`captured submission survives ${change} without stale owner UI or reload`, async () => {
      const { controls: c, dispose } = await typeEditorFixture();
      try {
        c.open(); c.setLabel("Original submitted label"); flush();
        const gate = c.hold("definition");
        const saving = c.save(); await gate.entered;
        if (change.startsWith("owner")) {
          c.changeOwner(typeOwner("B")); flush();
          if (change.endsWith("ABA")) { c.changeOwner(typeOwner("A")); flush(); }
        } else if (change.startsWith("session")) {
          c.changeSession(2); flush();
          if (change.endsWith("ABA")) { c.changeSession(3); flush(); }
        } else { dispose(); }
        gate.release(); await saving; flush();
        expect(c.io.bundles[0].ownerMutations[0].owner.storageName).toBe("A");
        expect(c.io.reloads).toEqual([]);
        expect(c.io.invalidations).toEqual(change.startsWith("session") ? [] : ["definition"]);
        if (change.startsWith("session")) expect(c.io.representationLookups).toEqual([]);
        else expect(c.io.representations.find(draft => draft.typeName === "Labelable")).toMatchObject({ args: ["A"], methods: { label: "Original submitted label" } });
        if (change !== "dispose") expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
      } finally { dispose(); }
    });
  }

  test("Cancel plus route change finishes only the original accepted owner and metadata", async () => {
    const { controls: c, dispose } = await typeEditorFixture();
    try {
      c.open(); c.setLabel("Accepted label"); c.setDescription("Accepted description"); flush();
      const gate = c.hold("definition");
      const saving = c.save(); await gate.entered;
      c.cancel(); flush(); c.open(); flush();
      expect(c.state().editing).toBe(false);
      c.changeOwner(typeOwner("B")); flush();
      c.setLabel("New owner label"); c.setDescription("New owner description"); flush();
      gate.release(); await saving; flush();
      expect(c.io.bundles[0].ownerMutations[0].owner).toMatchObject({ storageName: "A", storageId: "row-A" });
      expect(c.io.representations.map(draft => [draft.typeName, draft.args[0], draft.methods])).toEqual([
        ["Codeable", "A", { codeName: "A" }],
        ["Labelable", "A", { label: "Accepted label" }],
        ["Describable", "A", { description: "Accepted description" }],
      ]);
      expect(c.io.reloads).toEqual([]);
      expect(c.io.invalidations).toEqual(["definition"]);
      expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
      c.open(); flush(); expect(c.state().editing).toBe(true);
    } finally { dispose(); }
  });

  test("a session change during representation lookup cannot issue its later write", async () => {
    const { controls: c, dispose } = await typeEditorFixture();
    try {
      c.open(); flush();
      const gate = c.hold("representation");
      const saving = c.save(); await gate.entered;
      c.changeSession(2); flush();
      gate.release(); await saving; flush();
      expect(c.io.representations).toEqual([]);
      expect(c.io.invalidations).toEqual([]);
      expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
    } finally { dispose(); }
  });

  test("same-turn duplicate Save calls share one submitted operation and one reload", async () => {
    const { controls: c, dispose } = await typeEditorFixture();
    try {
      c.open(); flush();
      const gate = c.hold("definition");
      const first = c.save(), second = c.save(); await gate.entered;
      expect(c.io.bundles).toHaveLength(1);
      gate.release(); await Promise.all([first, second]); flush();
      expect(c.io.reloads).toEqual(["A"]);
      expect(c.io.invalidations).toEqual(["definition"]);
      expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
    } finally { dispose(); }
  });

  for (const fail of [false, true]) {
    test(`owner ${fail ? "ABA during a failing" : "change during a successful"} reload invalidates once and cannot update stale UI`, async () => {
      const { controls: c, dispose } = await typeEditorFixture();
      try {
        c.open(); flush();
        const gate = c.hold("reload");
        const saving = c.save(); await gate.entered;
        c.changeOwner(typeOwner("B")); flush();
        if (fail) { c.changeOwner(typeOwner("A")); flush(); }
        gate.release(fail); await saving; flush();
        expect(c.io.reloads).toEqual(["A"]);
        expect(c.io.invalidations).toEqual(["definition"]);
        expect(c.state()).toMatchObject({ editing: false, saving: false, error: "" });
      } finally { dispose(); }
    });
  }

  for (const canceled of [false, true]) {
    test(`failed parallel metadata Save drains its held sibling ${canceled ? "after Cancel" : "before reporting the first failure"}`, async () => {
      const { controls: c, dispose } = await typeEditorFixture();
      try {
        c.open(); flush();
        c.failRepresentation("Codeable", "First metadata failure");
        const gate = c.hold("representation:Labelable");
        let settled = false;
        const saving = c.save().then(() => { settled = true; });
        await gate.entered;
        // Let the independent rejection and ready sibling settle, without advancing the held IO.
        await new Promise(resolve => setImmediate(resolve)); flush();
        expect(settled).toBe(false);
        expect(c.state()).toMatchObject({ saving: true, error: "" });
        expect(c.io.representations.map(draft => draft.typeName)).toEqual(["Describable"]);
        if (canceled) { c.cancel(); flush(); }
        c.open(); await c.save(); flush();
        expect(c.io.bundles).toHaveLength(1);
        expect(c.state().editing).toBe(!canceled);
        gate.release(true); await saving; flush();
        expect(c.state()).toMatchObject({ saving: false, error: canceled ? "" : "First metadata failure" });
        c.open(); flush(); expect(c.state().editing).toBe(true);
      } finally { dispose(); }
    });
  }
});
