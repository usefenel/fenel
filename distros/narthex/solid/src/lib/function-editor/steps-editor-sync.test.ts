// @ts-nocheck -- Executes the production lens synchronization before its JSX.
import { describe, expect, test } from "bun:test";
import { createEffect, createMemo, createRoot, createSignal, flush } from "solid-js";
import { cloneDraftValue, draftValueFingerprint } from "../native-draft";
import { createFunctionEditorStore, projectBodyToSteps } from "./store";
import { parse, ParseError } from "@fenel/engine/fenel-parser";
import { printFenel } from "@fenel/engine";
import { stepToExpr } from "./types";

const source = await Bun.file(new URL("./StepsEditor.tsx", import.meta.url)).text();
const start = source.indexOf("  const store = createFunctionEditorStore();");
const end = source.indexOf("  return <FunctionEditorContext", start);
const synchronize = new Function("createEffect", "createFunctionEditorStore", "cloneDraftValue", "draftValueFingerprint", "props",
  new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)));

function harness(initialBody) {
  let dispose, store;
  let replaceBody, replaceParams;
  const emitted = [];
  createRoot((cleanup) => {
    dispose = cleanup;
    const [body, setBody] = createSignal(initialBody);
    const [params, setParams] = createSignal([]);
    replaceBody = setBody;
    replaceParams = setParams;
    synchronize(createEffect, () => store = createFunctionEditorStore(), cloneDraftValue, draftValueFingerprint, {
      get body() { return body(); }, get params() { return params(); }, name: "fixture",
      onChange: (next) => { emitted.push(cloneDraftValue(next)); setBody(next); },
    });
  });
  flush();
  return { store, replaceBody, replaceParams, emitted, dispose };
}

describe("step lens draft synchronization", () => {
  test("incoming expressions remain exact and do not echo the older step projection", () => {
    const h = harness("");
    try {
      expect(h.store.body).toBe("");
      expect(h.emitted).toEqual([]);
      for (const body of [false, { var: "who" }, { do: [{ call: ["notify", { text: "incoming" }] }] }]) {
        h.replaceBody(body);
        flush();
        expect(h.store.body).toEqual(body);
        expect(h.emitted).toEqual([]);
      }
    } finally { h.dispose(); }
  });

  test("actual step edits emit once and signature updates retain the body and selection", () => {
    const h = harness({ do: [{ call: ["notify", { text: "before" }] }] });
    try {
      h.store.select([0]);
      h.store.updateStep([0], { type: "action", name: "notify", params: { text: "after" } });
      flush();
      expect(h.emitted).toEqual([{ do: [{ call: ["notify", { text: "after" }] }] }]);
      expect(h.store.selectedPath).toEqual([0]);
      h.replaceParams([{ name: "input", type: { $ref: "String" } }]);
      flush();
      expect(h.store.params[0].name).toBe("input");
      expect(h.store.selectedPath).toEqual([0]);
      expect(h.emitted).toHaveLength(1);
    } finally { h.dispose(); }
  });
});

const stepEditorSource = await Bun.file(new URL("./StepEditor.tsx", import.meta.url)).text();
const stepCodeStart = stepEditorSource.indexOf("  const [codeView, setCodeView] = createSignal(false);");
const stepCodeEnd = stepEditorSource.indexOf("\n  return (", stepCodeStart);
const initializeStepCode = new Function("createEffect", "createMemo", "createSignal", "draftValueFingerprint", "projectBodyToSteps",
  "print", "stepToExpr", "parse", "ParseError", "functionStore",
  new Bun.Transpiler({ loader: "ts" }).transformSync(stepEditorSource.slice(stepCodeStart, stepCodeEnd)
    + "\nreturn { change: handleCodeChange, draft: codeDraft, error: codeError };"));

function stepCodeHarness() {
  let dispose, store, code;
  createRoot((cleanup) => {
    dispose = cleanup;
    store = createFunctionEditorStore();
    code = initializeStepCode(createEffect, createMemo, createSignal, draftValueFingerprint,
      projectBodyToSteps, printFenel, stepToExpr, parse, ParseError, store);
  });
  // Loading and selection are imperative actions after the editor owner exists.
  store.load({ name: "draft", body: { do: [
    { call: ["sleep", { duration: "5s" }] },
    { call: ["sleep", { duration: "20s" }] },
  ] } });
  store.select([0]);
  flush();
  return { store, code, dispose };
}

describe("step code draft ownership", () => {
  test("character input retains incomplete source and publishes only a lossless step", () => {
    const h = stepCodeHarness();
    try {
      const original = cloneDraftValue(h.store.body);
      const text = 'sleep { duration = "9s" }';
      for (let length = 1; length <= text.length; length++) {
        const prefix = text.slice(0, length);
        h.code.change(prefix);
        flush();
        expect(h.code.draft()).toBe(prefix);
        if (length < text.length) expect(h.store.body).toEqual(original);
        if (length < text.length) expect(h.store.bodyEditIssue).toBeTruthy();
      }
      expect(h.code.error()).toBe(null);
      expect(h.store.bodyEditIssue).toBeUndefined();
      expect(h.store.body.do[0]).toEqual({ call: ["sleep", { duration: "9s" }] });
      h.code.change('sleep  { duration = "9s" }  ');
      flush();
      expect(h.code.draft()).toBe('sleep  { duration = "9s" }  ');
      expect(h.store.body.do[0]).toEqual({ call: ["sleep", { duration: "9s" }] });
    } finally { h.dispose(); }
  }, 30_000); // Includes the first real Fenel printer call in a cold test process.

  test("unsupported expressions and multiple steps retain the last valid expression", () => {
    const h = stepCodeHarness();
    try {
      const original = cloneDraftValue(h.store.body);
      for (const text of ["s", "42", "add 1 2", 'do { sleep { duration = "1s" }; sleep { duration = "2s" } }']) {
        h.code.change(text);
        flush();
        expect(h.code.draft()).toBe(text);
        expect(h.code.error()).toBeTruthy();
        expect(h.store.body).toEqual(original);
      }
      h.code.change('sleep { duration = "7s" }');
      flush();
      expect(h.code.error()).toBe(null);
      expect(h.store.body.do[0]).toEqual({ call: ["sleep", { duration: "7s" }] });
    } finally { h.dispose(); }
  });

  test("external step and selection changes replace the local source and clear its error", () => {
    const h = stepCodeHarness();
    try {
      expect(h.store.dirty).toBe(false);
      h.code.change("sleep {");
      flush();
      expect(h.code.error()).toBeTruthy();
      expect(h.store.dirty).toBe(true);
      h.store.select([0]);
      flush();
      expect(h.code.draft()).toBe("sleep {");
      expect(h.store.bodyEditIssue).toBeTruthy();
      h.store.updateStep([0], { type: "wait", condition: { op: "duration", value: "8s" } });
      flush();
      expect(h.code.draft()).toBe('sleep { duration = "8s" }');
      expect(h.code.error()).toBe(null);
      h.code.change("s");
      flush();
      h.store.select([1]);
      flush();
      expect(h.code.draft()).toBe('sleep { duration = "20s" }');
      expect(h.code.error()).toBe(null);
      h.code.change("s");
      flush();
      h.store.select(null);
      flush();
      expect(h.store.bodyEditIssue).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("deleting the selected row clears its discarded source issue before its editor is disposed", () => {
    const h = stepCodeHarness();
    try {
      h.code.change("s");
      flush();
      expect(h.store.bodyEditIssue).toBeTruthy();
      h.store.removeStep([0]);
      flush();
      expect(h.store.selectedPath).toBe(null);
      expect(h.store.bodyEditIssue).toBeUndefined();
      expect(h.store.body.do).toEqual([{ call: ["sleep", { duration: "20s" }] }]);
    } finally { h.dispose(); }
  });
});
