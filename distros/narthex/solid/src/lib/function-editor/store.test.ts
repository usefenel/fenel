// @ts-nocheck -- Bun's test globals are outside the Solid ambient tsconfig.
import { afterEach, describe, expect, test } from "bun:test";
import { flush } from "solid-js";
import { Nothing } from "@fenel/engine/type-foundation";
import { createFunctionEditorStore, functionStore } from "./store";

const FIELD_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => { functionStore.reset(); flush(); });

describe("whole function source lifetime", () => {
  const body = { do: [{ call: ["sleep", { duration: "5s" }] }] };
  function sourceStore() {
    const store = createFunctionEditorStore();
    store.load({ id: "source", name: "source", active: true, body });
    flush();
    return store;
  }

  test("whole Code source and its Save issue survive selection and metadata changes", () => {
    const store = sourceStore();
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.select([0]);
    store.setBodyEditIssue("Incomplete step");
    flush();
    expect(store.bodyEditIssue).toBe("Incomplete source");
    expect(store.stepBodyEditIssue).toBe("Incomplete step");
    store.select(null);
    store.setName("renamed");
    store.setParams([]);
    store.setReturns({ $ref: "Unit" });
    store.setStorageId("acknowledged");
    flush();
    expect(store.bodySourceDraft.text).toBe("(");
    expect(store.bodyEditIssue).toBe("Incomplete source");
    expect(store.stepBodyEditIssue).toBeUndefined();
    expect(store.body).toEqual(body);
    expect(store.dirty).toBe(true);
  });

  test("valid parse reinstalls exact source after a deferred body replacement", () => {
    const store = sourceStore();
    const next = { do: [{ call: ["sleep", { duration: "9s" }] }] };
    const text = 'do\n  sleep { duration = "9s" }  -- retain this comment';
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.replaceBody(next);
    store.setBodySourceDraft(text, undefined, next);
    flush();
    expect(store.body).toEqual(next);
    expect(store.bodySourceDraft.text).toBe(text);
    expect(store.bodyEditIssue).toBeUndefined();
    store.select(null);
    flush();
    expect(store.bodySourceDraft.text).toBe(text);
  });

  test("actual body changes retire Code source and do not revive it after ABA", () => {
    const store = sourceStore();
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.updateStep([0], { type: "wait", condition: { op: "duration", value: "9s" } });
    flush();
    expect(store.bodySourceDraft).toBeUndefined();
    store.replaceBody(body);
    flush();
    expect(store.bodySourceDraft).toBeUndefined();
    expect(store.bodyEditIssue).toBeUndefined();
  });

  test("queued body ABA cannot revive or retain a source installed between mutations", () => {
    const store = sourceStore();
    const original = store.state.steps.map(step => ({ ...step }));
    store.replaceSteps([{ type: "wait", condition: { op: "duration", value: "9s" } }]);
    store.setBodySourceDraft("(", "Incomplete source");
    store.replaceSteps(original);
    flush();
    expect(store.body).toEqual(body);
    expect(store.bodySourceDraft).toBeUndefined();
    expect(store.bodyEditIssue).toBeUndefined();
  });

  test("queued direct body ABA retires discarded raw source using pending source state", () => {
    const store = sourceStore();
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.replaceBody({ do: [{ call: ["sleep", { duration: "9s" }] }] });
    store.replaceBody(body);
    flush();
    expect(store.body).toEqual(body);
    expect(store.bodySourceDraft).toBeUndefined();
    expect(store.bodyEditIssue).toBeUndefined();
  });

  test("an incomplete edit immediately after a valid parse retains the pending admitted body", () => {
    const store = sourceStore();
    store.replaceBody(5);
    store.setBodySourceDraft("5", undefined, 5);
    store.setBodySourceDraft("5 +", "Incomplete source");
    store.replaceBody(5);
    flush();
    expect(store.body).toBe(5);
    expect(store.bodySourceDraft.text).toBe("5 +");
    expect(store.bodyEditIssue).toBe("Incomplete source");
  });

  test("no-op and invalid row changes preserve Code source", () => {
    const store = sourceStore();
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.updateStep([0], store.state.steps[0]);
    store.updateStep([99], { type: "wait", condition: { op: "duration", value: "9s" } });
    store.addStep([99, "s"], 0, { type: "wait", condition: { op: "duration", value: "9s" } });
    store.insertStep([99, "s"], 0, { type: "wait", condition: { op: "duration", value: "9s" } });
    store.removeStep([99]);
    store.replaceBody(body);
    flush();
    expect(store.bodySourceDraft.text).toBe("(");
    expect(store.bodyEditIssue).toBe("Incomplete source");
  });

  test("an explicit branch label edit retires Code source even when its projected body is unchanged", () => {
    const store = createFunctionEditorStore();
    const branch = { type: "branch", arms: [{ id: "arm", label: "Old label",
      when: { op: "compare", field: "value", cmp: "==", value: "1" }, steps: [] }] };
    store.replaceSteps([branch]);
    flush();
    const before = store.body;
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    store.updateStep([0], { ...branch, arms: [{ ...branch.arms[0], label: "New label" }] });
    flush();
    expect(store.body).toEqual(before);
    expect(store.bodySourceDraft).toBeUndefined();
    expect(store.bodyEditIssue).toBeUndefined();
  });

  for (const transition of ["load", "reset"]) test(`${transition} retires raw source even for equal text or unchanged storage identity`, () => {
    const store = sourceStore();
    const key = store.nativeDocumentKey;
    store.setBodySourceDraft("(", "Incomplete source");
    flush();
    if (transition === "load") store.load({ id: "source", name: "source", active: true, body });
    else store.reset();
    flush();
    expect(store.bodySourceDraft).toBeUndefined();
    expect(store.bodyEditIssue).toBeUndefined();
    expect(store.nativeDocumentKey).not.toBe(key);
  });
});

describe("visual function store signature", () => {
  for (const transition of ["load", "reset"]) test(`${transition} discards an old deletion so a late confirmation cannot remove a new step`, () => {
    functionStore.load({ id: "old", name: "old", active: true,
      body: { do: [{ call: ["notify", { text: "old" }] }] } });
    flush();
    functionStore.requestDelete([0]);
    flush();
    expect(functionStore.pendingDelete).toEqual([0]);
    const body = { do: [{ call: ["notify", { text: "keep the new step" }] }] };
    if (transition === "load") {
      functionStore.load({ id: "new", name: "new", active: true, body });
      flush();
    } else {
      functionStore.reset();
      flush();
      functionStore.insertStep([], 0, { type: "action", name: "notify", params: { text: "keep the new step" } });
      flush();
    }
    expect(functionStore.pendingDelete).toBeNull();
    functionStore.confirmDelete();
    flush();
    expect(functionStore.serialize().body).toEqual(body);
    expect(functionStore.state.steps).toHaveLength(1);
  });

  test("composer stores retain independent steps, signature and delete state", () => {
    const first = createFunctionEditorStore();
    const second = createFunctionEditorStore();
    first.load({ id: "first", name: "first", active: true, body: { do: [] } });
    second.load({ id: "second", name: "second", active: true, body: "keep me" });
    functionStore.load({ id: "page", name: "page", active: true, body: 49 });
    flush();
    first.insertStep([], 0, { type: "action", name: "notify", params: { text: "hello" } });
    first.setReturns({ $union: [{ $ref: "String" }, { $ref: "Number" }] });
    first.requestDelete([0]);
    flush();
    expect(first.serialize().body).toEqual({ do: [{ call: ["notify", { text: "hello" }] }] });
    expect(second.serialize().body).toBe("keep me");
    expect(second.state.steps).toEqual([]);
    expect(second.state.returns).toEqual({ $ref: "Unit" });
    expect(second.pendingDelete).toBeNull();
    expect(functionStore.serialize().body).toBe(49);
    expect(functionStore.pendingDelete).toBeNull();
    first.reset();
    flush();
    expect(second.serialize().body).toBe("keep me");
    expect(functionStore.serialize().body).toBe(49);
  });
  test("loaded params and returns survive serialize", () => {
    functionStore.load({
      id: "account:greet",
      name: "greet",
      active: true,
      params: [{
        name: "who",
        key: { $tag: "NamedField", ref: { $ref: FIELD_ID } },
        type: { $ref: "String" },
        label: Nothing,
        ui: Nothing,
        meta: {},
      }],
      returns: { $ref: "String" },
      program: { cat: ["Hello ", { var: "who" }] },
    });
    flush();

    const serialized = functionStore.serialize();
    expect(serialized.params).toEqual(functionStore.params);
    expect(serialized.params[0]?.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: FIELD_ID },
    });
    expect(serialized.returns).toEqual({ $ref: "String" });
  });

  test("removing or reusing a param forgets client facet replacement authority", () => {
    functionStore.load({
      id: "account:greet",
      name: "greet",
      active: true,
      params: [{
        name: "who",
        key: { $tag: "NamedField", ref: { $ref: FIELD_ID } },
        type: { $ref: "String" },
        label: Nothing,
        ui: Nothing,
        meta: {},
      }],
      returns: { $ref: "String" },
      program: { var: "who" },
    });
    functionStore.setFieldFacets(FIELD_ID, {});
    flush();
    expect(Object.keys(functionStore.fieldFacets)).toEqual([FIELD_ID]);

    functionStore.forgetFieldFacets(FIELD_ID);
    flush();
    expect(functionStore.fieldFacets).toEqual({});
    functionStore.removeParam(0);
    flush();
    expect(functionStore.fieldFacets).toEqual({});
  });

  test("persisted facet hydration does not make an untouched function dirty", () => {
    functionStore.load({
      id: "account:greet",
      name: "greet",
      active: true,
      params: [],
      returns: { $ref: "String" },
      program: { var: "who" },
    });
    flush();
    expect(functionStore.dirty).toBe(false);
    functionStore.hydrateFieldFacets(FIELD_ID, {});
    flush();
    expect(functionStore.fieldFacets).toEqual({ [FIELD_ID]: {} });
    expect(functionStore.dirty).toBe(false);
  });
});

function documentWait(value = "5s") {
  return { type: "wait", condition: { op: "duration", value } };
}

function selectedDocumentStore() {
  const store = createFunctionEditorStore();
  store.replaceSteps([documentWait(), documentWait()]);
  store.select([0]);
  flush();
  return store;
}

describe("selected step native document ownership", () => {
  test("new and reset function drafts have fresh native owners even with null storage IDs and equal defaults", () => {
    const store = createFunctionEditorStore();
    const initial = store.nativeDocumentKey;
    store.setVar("same", "20");
    flush();
    expect(store.nativeDocumentKey).toBe(initial);
    store.replaceBody({ do: [] });
    flush();
    expect(store.nativeDocumentKey).toBe(initial);
    store.reset();
    store.setVar("same", "20");
    flush();
    expect(store.state.id).toBe(null);
    expect(store.state.vars.same).toBe("20");
    expect(store.nativeDocumentKey).not.toBe(initial);
    const reset = store.nativeDocumentKey;
    store.load({ id: "loaded", name: "same", active: true, vars: { same: "20" }, body: { do: [] } });
    flush();
    expect(store.nativeDocumentKey).not.toBe(reset);
  });
  test("same-row edits and reselecting that row retain its document", () => {
    const store = selectedDocumentStore();
    const key = store.selectedStepDocumentKey;
    expect(key).toBeTruthy();
    store.select([0]);
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
    store.updateStep([0], documentWait("8s"));
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
    store.updateStep([1], documentWait("20s"));
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
  });

  test("equal-text rows have separate document lifetimes and no row cache", () => {
    const store = selectedDocumentStore();
    const first = store.selectedStepDocumentKey;
    store.select([1]);
    flush();
    const second = store.selectedStepDocumentKey;
    expect(second).not.toBe(first);
    store.select([0]);
    flush();
    expect(store.selectedStepDocumentKey).not.toBe(first);
    expect(store.selectedStepDocumentKey).not.toBe(second);
  });

  test("equal-text insertion and reordering at the selected coordinate start fresh documents", () => {
    const store = selectedDocumentStore();
    const original = store.selectedStepDocumentKey;
    store.insertStep([], 0, documentWait());
    flush();
    const inserted = store.selectedStepDocumentKey;
    expect(inserted).not.toBe(original);
    const [first, second, third] = store.state.steps;
    store.replaceSteps([second, first, third]);
    flush();
    expect(store.selectedStepDocumentKey).not.toBe(original);
    expect(store.selectedStepDocumentKey).not.toBe(inserted);
  });

  test("an unrelated append keeps the selected document", () => {
    const store = selectedDocumentStore();
    const key = store.selectedStepDocumentKey;
    store.addStep([], 2, documentWait("30s"));
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
    store.insertStep([], 3, documentWait("40s"));
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
  });

  test("closing and reopening, deleting, and replacing a body release the old document", () => {
    const store = selectedDocumentStore();
    const key = store.selectedStepDocumentKey;
    store.select(null);
    flush();
    expect(store.selectedStepDocumentKey).toBeUndefined();
    store.select([0]);
    flush();
    const reopened = store.selectedStepDocumentKey;
    expect(reopened).not.toBe(key);
    store.removeStep([0]);
    flush();
    expect(store.selectedStepDocumentKey).toBeUndefined();
    store.select([0]);
    flush();
    const remaining = store.selectedStepDocumentKey;
    store.replaceBody({ do: [{ call: ["sleep", { duration: "5s" }] }] });
    flush();
    expect(store.selectedStepDocumentKey).toBeUndefined();
    store.select([0]);
    flush();
    expect(store.selectedStepDocumentKey).not.toBe(remaining);
  });

  test("independent composer stores never change each other's document ownership", () => {
    const first = selectedDocumentStore();
    const second = selectedDocumentStore();
    const firstKey = first.selectedStepDocumentKey;
    const secondKey = second.selectedStepDocumentKey;
    first.select([1]);
    flush();
    expect(first.selectedStepDocumentKey).not.toBe(firstKey);
    expect(second.selectedStepDocumentKey).toBe(secondKey);
    second.updateStep([0], documentWait("9s"));
    flush();
    const changedFirst = first.selectedStepDocumentKey;
    expect(second.selectedStepDocumentKey).toBe(secondKey);
    first.reset();
    flush();
    expect(first.selectedStepDocumentKey).toBeUndefined();
    expect(second.selectedStepDocumentKey).toBe(secondKey);
    expect(changedFirst).toBeTruthy();
  });

  test("two queued updates preserve ownership through imperative reads before commit", () => {
    const store = selectedDocumentStore();
    const key = store.selectedStepDocumentKey;
    store.updateStep([0], documentWait("8s"));
    expect(store.selectedStepDocumentKey).toBe(key);
    store.updateStep([0], documentWait("9s"));
    expect(store.selectedStepDocumentKey).toBe(key);
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
    expect(store.state.steps[0]).toEqual(documentWait("9s"));
  });

  test("nested row edits preserve ownership while an equal-text sibling insertion resets it", () => {
    const store = createFunctionEditorStore();
    store.replaceSteps([{ type: "scope", vars: {}, steps: [documentWait(), documentWait()] }]);
    store.select([0, "s", 0]);
    flush();
    const key = store.selectedStepDocumentKey;
    store.updateStep([0, "s", 0], documentWait("9s"));
    flush();
    expect(store.selectedStepDocumentKey).toBe(key);
    store.insertStep([0, "s"], 0, documentWait("9s"));
    flush();
    expect(store.selectedStepDocumentKey).not.toBe(key);
  });
});
