// @ts-nocheck -- Bun test harness is outside the Solid ambient tsconfig.
import { describe, expect, test } from "bun:test";
import { cloneDraftValue, draftValueFingerprint } from "../native-draft";
import { snapshot, createMemo } from "solid-js";

// Exercise the real route handlers without starting a router, browser or API.
const source = await Bun.file(new URL("../../routes/app/functions/[name]/index.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const fingerprintStart = source.indexOf("  function saveFingerprint()");
const fingerprint = source.slice(fingerprintStart, source.indexOf("  async function handleSave", fingerprintStart));
const saveStart = source.indexOf("  async function handleSave");
const saveSource = source.slice(saveStart, source.indexOf("  const profilesData", saveStart));

function setup({ isNew = false, active = false, failDefinition = false, failActivation = false, definition,
  afterDefinition = () => {} } = {}) {
  const events = []; let error = null; let saving = false; let persistedActive = true;
  const store = {
    state: { id: isNew ? null : "row-id", name: "notify", active }, dirty: true,
    fieldFacets: {}, fieldResurrectionIds: [],
    definition: definition ?? { params: [], returns: { $ref: "Number" }, body: 49 },
    serialize: () => ({ id: store.state.name, ...store.definition }),
    setStorageId: (id) => { store.state.id = id; },
    markClean: () => { events.push("clean"); store.dirty = false; },
  };
  const api = {
    definitionBundleSave: async (request) => {
      events.push(["definition", request]);
      if (failDefinition) throw new Error("definition failed");
      afterDefinition(store);
      return { snapshot: { owners: [{ kind: "function", storageName: "notify", storageId: "row-id" }] } };
    },
    functionSetActive: async (id, active) => {
      events.push(["active", id, active]);
      if (failActivation) throw new Error("activation failed");
      return { id, active };
    },
  };
  const make = new Function("functionStore", "saving", "setSaving", "setError", "api", "persistedActive", "fnData",
    "setPersistedActive", "desiredFieldFacetValues", "fieldFacetReplacementIds", "isNew", "navigate", "cloneDraftValue", "draftValueFingerprint",
    `let editorGeneration = 0; ${transpiler.transformSync(fingerprint + saveSource)} return handleSave;`);
  const save = make(store, () => saving, (next) => { saving = next; }, (next) => { error = next; }, api,
    () => persistedActive, () => undefined, (next) => { persistedActive = next; }, () => [], () => [], () => isNew,
    (path) => events.push(["navigate", path]), cloneDraftValue, draftValueFingerprint);
  return { save, store, events, error: () => error };
}

describe("function save acknowledgements", () => {
  test("Inactive is acknowledged separately before marking the editor clean", async () => {
    const h = setup(); await h.save();
    expect(h.events.map((event) => Array.isArray(event) ? event[0] : event)).toEqual(["definition", "active", "clean"]);
    expect(h.events[1]).toEqual(["active", "row-id", false]);
    expect(Object.hasOwn(h.events[0][1].ownerMutations[0].owner.definition, "active")).toBe(false);
    expect(h.store.dirty).toBe(false);
  });

  test("activation failure retains a new definition identity and unsaved state", async () => {
    const h = setup({ isNew: true, failActivation: true }); await h.save();
    expect(h.store.state.id).toBe("row-id");
    expect(h.store.dirty).toBe(true);
    expect(h.error()).toBe("activation failed");
    expect(h.events.some((event) => event[0] === "navigate")).toBe(false);
  });

  test("a rejected definition never changes activation", async () => {
    const h = setup({ failDefinition: true }); await h.save();
    expect(h.events).toHaveLength(1);
    expect(h.store.dirty).toBe(true);
  });

  test("an unchanged active control does not send an activation operation", async () => {
    const h = setup({ active: true }); await h.save();
    expect(h.events.map((event) => Array.isArray(event) ? event[0] : event)).toEqual(["definition", "clean"]);
  });

  test("edits made during save are not falsely marked clean", async () => {
    const h = setup({ afterDefinition: (store) => { store.state.name = "next-edit"; } }); await h.save();
    expect(h.store.dirty).toBe(true);
    expect(h.events.includes("clean")).toBe(false);
  });

  test("an incomplete step source refuses saving the older valid expression", async () => {
    const h = setup();
    h.store.bodyEditIssue = "Complete the step code before saving.";
    await h.save();
    expect(h.events).toEqual([]);
    expect(h.error()).toBe("Complete the step code before saving.");
    h.store.bodyEditIssue = undefined;
    await h.save();
    expect(h.events.some((event) => event[0] === "definition")).toBe(true);
  });

  test("an incomplete step edit during save is not marked clean by the older acknowledgement", async () => {
    const h = setup({ afterDefinition: (store) => { store.bodyEditIssue = "Complete the step code before saving."; } });
    await h.save();
    expect(h.store.dirty).toBe(true);
    expect(h.events.includes("clean")).toBe(false);
  });

  test("actual save snapshot preserves native body/return types and isolates edits during save", async () => {
    const unbounded = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
    const h = setup({ definition: { params: [], returns: unbounded, body: { ann: ["text", unbounded] } },
      afterDefinition: (store) => { store.definition.returns.$refined.set.pattern.max = null; } });
    await h.save();
    const sent = h.events.find((event) => event[0] === "definition")[1].ownerMutations[0].owner.definition;
    expect(sent.returns.$refined.set.pattern.max).toBe(Infinity);
    expect(sent.body.ann[1].$refined.set.pattern.max).toBe(Infinity);
    expect(h.store.definition.returns.$refined.set.pattern.max).toBeNull();
    expect(h.store.dirty).toBe(true);
    expect(h.events.includes("clean")).toBe(false);
  });

  test("native numeric edits during save do not collide with null or positive zero", async () => {
    for (const [before, after] of [[Infinity, null], [-0, 0], [NaN, null]]) {
      const h = setup({ definition: { params: [], returns: { $ref: "Value" }, body: before }, afterDefinition: (store) => { store.definition.body = after; } });
      await h.save();
      expect(h.store.dirty).toBe(true);
      expect(h.events.includes("clean")).toBe(false);
    }
  });

  test("function detail data unwraps the server envelope once", async () => {
    const start = source.indexOf("  const fnData = createMemo(");
    const fetchSource = source.slice(start, source.indexOf("  createEffect(", start));
    const fetch = new Function("createMemo", "isNew", "params", "getFunctionByName",
      `${transpiler.transformSync(fetchSource)} return fnData;`);
    const row = { id: "row-id", name: "notify", active: true, function: { id: "notify", body: 49 } };
    const result = await fetch((work) => work(), () => false, { name: "notify" }, async () => ({ definition: row }));
    expect(result).toEqual(row);
  });

  test("instance detail resolves the actual row identity from its server envelope", async () => {
    const instanceSource = await Bun.file(new URL("../../routes/app/functions/[name]/instances/[id].tsx", import.meta.url)).text();
    const start = instanceSource.indexOf("  const fnRow = createMemo(");
    const fetchSource = instanceSource.slice(start, instanceSource.indexOf("\n  return (", start));
    const fetch = new Function("createMemo", "params", "getFunctionByName", `${transpiler.transformSync(fetchSource)} return fnRow;`);
    const row = { id: "physical-function", name: "notify", function: { id: "account:notify" } };
    expect(await fetch((work) => work(), { name: "notify" }, async () => ({ definition: row }))).toEqual(row);
  });
});
