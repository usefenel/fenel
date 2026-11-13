// @ts-nocheck -- Production owners are extracted into bounded fixtures.
import { describe, expect, test } from "bun:test";
import { readLocusCatalogReference, resolveLocusCatalogReference } from "./locus-catalog-reference";
import { expressionAt } from "./locus-expression-edit";

const entry = (await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const home = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`Call handoff boundary moved: ${start}`);
  return source.slice(from, to);
}
function bind(source, bindings, result) {
  return new Function(...Object.keys(bindings), `${transpiler.transformSync(source)}; return ${result};`)(...Object.values(bindings));
}
const reference = { kind: "literal", value: { $ref: "signup-uuid" } };
const fn = { id: "CheckDemo:checkSignUp", params: [{ name: "draft", type: { $ref: "SignUpDraft" } }], returns: { $ref: "SignUpDraft" } };
const focus = { kind: "value", viewId: "public-root", itemId: "demo", rootItem: true, path: ["Input checking"] };
const destination = { ...focus, path: [...focus.path, "Sign up with live hints"] };
const item = { id: "$field:Sign up with live hints", caption: "Sign up with live hints", source: { kind: "expr", expr: reference } };
const lookups = { fn: id => id === "signup-uuid" ? fn : undefined, entry: () => undefined, entityType: () => undefined };

describe("the early function card uses the reader's existing catalogue", () => {
  function probe(runtime) {
    return bind(section(entry, "  function callablePreviewReference(", "  function previewableValue("), {
      props: { readRuntime: runtime }, sessionEpoch: () => 7,
      previewExpression: item => item.source.expr, readLocusCatalogReference, resolveLocusCatalogReference,
    }, "callablePreviewReference");
  }
  test("public and Local exact function refs qualify; names, ordinary types and pending refs do not", () => {
    for (const kind of ["public", "local"]) {
      const read = probe({ kind, epoch: 7, client: { signal: { aborted: false } }, catalogLookups: lookups });
      expect(read(item)).toBe("signup-uuid");
      for (const value of ["Sign up with live hints", { $ref: "type-uuid" }, { $ref: "pending-uuid" },
        { $pin: "type", id: "signup-uuid" }, { $ref: "signup-uuid", unrelated: true }]) {
        expect(read({ source: { expr: { kind: "literal", value } } })).toBeUndefined();
      }
    }
  });
  test("unprepared and retired readers cannot use any ambient registry", () => {
    const forbidden = { fn: () => { throw new Error("Retired catalogue read"); } };
    expect(probe(undefined)(item)).toBeUndefined();
    expect(probe({ epoch: 6, client: { signal: { aborted: false } }, catalogLookups: forbidden })(item)).toBeUndefined();
    expect(probe({ epoch: 7, client: { signal: { aborted: true } }, catalogLookups: forbidden })(item)).toBeUndefined();
  });
  test("the actual menu action retains the canonical occurrence and checks it again at selection", () => {
    const branch = section(entry, "      ...(callable && target?.item", "      ...(target?.item ? [{ id: \"code\"");
    const target = { item, focus, source: "public", epoch: 7, rootId: "public-root", revision: 2 };
    let root = { id: "public-root", revision: 2 }, current = true, callable = "signup-uuid";
    const calls = [], errors = [];
    const rows = bind(`const rows = [${branch}];`, {
      callable, target, into: destination, presentationIsCurrent: () => current, current: () => root,
      callablePreviewReference: () => callable, previewCaption: item => item.caption,
      retarget: (...args) => calls.push(args), setClipboardError: error => errors.push(error),
    }, "rows");
    expect(rows[0].label).toBe("Instantiate function");
    rows[0].onSelect();
    expect(calls).toEqual([[{ kind: "call-function", target: destination, referenceId: "signup-uuid", caption: item.caption,
      scope: focus, source: "public", epoch: 7, rootId: "public-root", revision: 2 }, "source"]]);
    current = false; rows[0].onSelect(); expect(calls).toHaveLength(1);
    current = true; root = { ...root, revision: 3 }; rows[0].onSelect(); expect(errors).toHaveLength(1);
    root = { ...root, revision: 2 }; callable = undefined; rows[0].onSelect(); expect(errors).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });
});

const identityCode = section(home, "function projectAuthoredExpression(", "/** A card holding a type")
  + section(home, "function resolveExpr(", "function rendersPicture(");
const identity = bind(identityCode, { expressionAt, readLocusCatalogReference, resolveLocusCatalogReference }, "({ itemFunction, projectAuthoredExpression })");
function handoff(kind = "public") {
  const source = { kind: "literal", value: { __record: { fields: [{ name: "Input checking", value: { kind: "literal", value: { __record: { fields: [
    { name: "Sign up with live hints", value: reference },
  ] } } } }] } } };
  const original = { id: "demo", source: { kind: "expr", expr: source } };
  const state = { epoch: 7, source: "public", focus, root: { id: "public-root", revision: 2 }, original,
    runtime: undefined, callable: fn, pending: false, failed: false, reference: "signup-uuid" };
  const calls = [], errors = [];
  let compute, apply;
  const session = { registry: { getFunction: id => {
    if (kind === "local") throw new Error("Local calls must not read the page registry");
    return id === state.reference ? state.callable : undefined;
  } } };
  const initialCall = { kind: "call-function", target: destination, referenceId: "signup-uuid", caption: item.caption,
    scope: focus, source: "public", epoch: 7, rootId: "public-root", revision: 2 };
  const reader = { kind, catalogLookups: { ...lookups, fn: id => id === state.reference ? state.callable : undefined },
    ...(kind === "local" ? { observePending: read => ({ value: read(), pending: state.pending, failed: state.failed }) } : {}) };
  bind(section(home, "  let initialCallConsumed = false;", "  let handledAddressRequest = 0;"), {
    initialCall, client: { signal: { aborted: false } }, sessionEpoch: () => state.epoch,
    props: { pane: { source: () => state.source } }, workspaceSourceKey: value => value, scope: () => state.focus,
    draftValueFingerprint: JSON.stringify, root: () => state.root,
    rowById: id => id === state.root?.id ? { id, view: { items: state.original ? [state.original] : [] } } : undefined,
    viewPersistence: { read: (_id, view) => view }, asView: value => value,
    findLocusItem: (items, id) => items.find(item => item.id === id),
    resolveExpr: item => item.source.expr, savedExprById: () => new Map(),
    projectAuthoredExpression: identity.projectAuthoredExpression, expressionEditOptions: () => ({}), readLocusCatalogReference,
    itemFunction: identity.itemFunction, homeAuthoringSession: () => session, reader,
    createMemo: read => read, createEffect: (read, effect) => { compute = read; apply = effect; },
    setCalling: call => calls.push(call), setToolbarError: message => errors.push(message),
  }, "undefined");
  return { state, calls, errors, settle: () => apply(compute()) };
}

describe("the prepared Home rechecks the early call occurrence", () => {
  test("nested public occurrence opens the existing form once without evaluating the container", () => {
    const h = handoff(); h.settle(); h.settle();
    expect(h.calls).toEqual([{ fnId: fn.id, fnName: item.caption }]); expect(h.errors).toEqual([]);
  });
  test("a pending Local catalogue waits for its answer", () => {
    const h = handoff("local"); h.state.callable = undefined; h.state.pending = true; h.settle();
    expect(h.calls).toEqual([]); expect(h.errors).toEqual([]);
    h.state.callable = fn; h.state.pending = false; h.settle(); expect(h.calls).toHaveLength(1);
  });
  test("a failed Local read reports once even when pending stays true", () => {
    const h = handoff("local"); h.state.callable = undefined; h.state.pending = true; h.settle();
    h.state.failed = true; h.settle();
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual(["Could not read this function. Retry its data reader, then instantiate the function again."]);
    h.state.callable = fn; h.state.pending = false; h.state.failed = false; h.settle(); h.settle();
    expect(h.calls).toEqual([]); expect(h.errors).toHaveLength(1);
  });
  for (const change of ["epoch", "source", "revision"]) {
    test(`a late Local callable cannot revive an intent after its ${change} changes`, () => {
      const h = handoff("local"); h.state.callable = undefined; h.state.pending = true; h.settle();
      expect(h.calls).toEqual([]); expect(h.errors).toEqual([]);
      if (change === "epoch") h.state.epoch++;
      if (change === "source") h.state.source = "other-tab";
      if (change === "revision") h.state.root = { ...h.state.root, revision: 3 };
      h.settle(); expect(h.calls).toEqual([]); expect(h.errors).toHaveLength(1);
      h.state.callable = fn; h.state.pending = false; h.settle(); h.settle();
      expect(h.calls).toEqual([]); expect(h.errors).toHaveLength(1);
    });
  }
  test("a computed descendant cannot borrow its container's callable-looking metadata", () => {
    const h = handoff();
    h.state.original = { ...h.state.original, valueType: { $arrow: { params: fn.params, returns: fn.returns } },
      source: { expr: { kind: "call", fnId: "produces-function-record", args: [] } } };
    h.settle(); expect(h.calls).toEqual([]); expect(h.errors).toHaveLength(1);
  });
  for (const change of ["epoch", "source", "focus", "root", "revision", "item", "reference", "type"]) {
    test(`${change} change cannot open the captured call`, () => {
      const h = handoff();
      if (change === "epoch") h.state.epoch++;
      if (change === "source") h.state.source = "this-tab";
      if (change === "focus") h.state.focus = { kind: "root" };
      if (change === "root") h.state.root = { ...h.state.root, id: "other" };
      if (change === "revision") h.state.root = { ...h.state.root, revision: 3 };
      if (change === "item") h.state.original = undefined;
      if (change === "reference") h.state.original = { ...h.state.original, source: { expr: { kind: "literal", value: { $ref: "other" } } } };
      if (change === "type") h.state.callable = undefined;
      h.settle(); h.settle(); expect(h.calls).toEqual([]); expect(h.errors).toHaveLength(1);
    });
  }
});
