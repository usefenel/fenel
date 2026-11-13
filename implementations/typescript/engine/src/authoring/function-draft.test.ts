import { expect, test } from "bun:test";
import type { FenelFunction, FenelType, FieldDef, FunctionSignatureDeclaration, TypeScheme } from "../types";
import { Anything, Nothing } from "../type-foundation";
import { inferAuthoringFunctionDraft, judgeAuthoringFunctionDraftSave } from "./function-draft";
import { createAuthoringEnvironment, type AuthoringEnvironment } from "./environment";
import { loadFenelModule } from "../fenel-module";
import { createRegistry } from "../registry";

const environment = () => createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
  catalogTypes: [], operatorCodeNameByNotation: new Map() });
const variable = (name: string): FenelType => ({ $var: name });
const field = (name: string, type: FenelType, index = 0): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {},
  key: { $tag: "NamedField", ref: { $ref: `568323ee-c990-4d11-850f-${String(index).padStart(12, "0")}` } } });
const authored = { $tag: "Authored", source: { $tag: "HostSpec", module: "authoring-fixture" } } as const;
function draft(params: FieldDef[], returns: FenelType, body: FenelFunction["body"], inferResult: boolean,
  names = ["a"]): { fn: FenelFunction; declaration: FunctionSignatureDeclaration } {
  const fn: FenelFunction = { id: "draftIdentity", params, returns, body };
  const scheme: TypeScheme = { quantified: names.map(sourceName => ({ id: `draftIdentity:${sourceName}`, sourceName, kind: { $tag: "KType" } })),
    body: { $arrow: { params, returns } } };
  const declaration: FunctionSignatureDeclaration = { functionId: fn.id, declarationName: fn.id, codeName: fn.id,
    params: params.map(() => authored), returns: inferResult ? { $tag: "Absent" } : authored, scheme };
  return { fn, declaration };
}

test("whole draft inference keeps shared binders and rejects a distinct binder result", () => {
  const same = draft([field("x", variable("a")), field("y", variable("a"), 1)], variable("a"), { var: "y" }, false);
  const shared = inferAuthoringFunctionDraft(same.fn, same.declaration, environment());
  expect(shared.outcome.$tag).toBe("Solved");
  expect(shared.fn?.params.map(param => param.type)).toEqual([variable("a"), variable("a")]);
  expect(shared.fn?.returns).toEqual(variable("a"));
  const distinct = draft([field("x", variable("a")), field("y", variable("b"), 1)], variable("a"), { var: "y" }, false, ["a", "b"]);
  expect(inferAuthoringFunctionDraft(distinct.fn, distinct.declaration, environment()).outcome.$tag).toBe("Invalid");
}, 120_000);

test("inferred generic identity ignores the result placeholder and recomputes after a body edit", () => {
  const input = draft([field("x", variable("a"))], { $ref: "String" }, { var: "x" }, true);
  const first = inferAuthoringFunctionDraft(input.fn, input.declaration, environment());
  expect(first.outcome.$tag).toBe("Solved");
  expect(first.fn?.returns).toEqual(variable("a"));
  expect(first.scheme?.quantified).toEqual(input.declaration.scheme?.quantified);
  expect(first.info?.returns.$tag).toBe("Inferred");
  expect(first.fn?.params[0]?.key).toEqual(input.fn.params[0]?.key);
  const edited = inferAuthoringFunctionDraft({ ...input.fn, body: 42 }, input.declaration, environment());
  expect(edited.outcome.$tag).toBe("Solved");
  expect(edited.fn?.returns).not.toEqual(first.fn?.returns);
  expect(input.declaration.returns).toEqual({ $tag: "Absent" });
}, 120_000);

test("whole authored result mismatches and recursive drafts use the current candidate", () => {
  const mismatch = draft([], { $ref: "String" }, 42, false, []);
  expect(inferAuthoringFunctionDraft(mismatch.fn, mismatch.declaration, environment()).outcome.$tag).toBe("Invalid");
  const recursive = draft([field("x", variable("a"))], { $ref: "String" }, {
    if: [true, { var: "x" }, { call: ["draftIdentity", { var: "x" }] }],
  }, true);
  let oldSelfReads = 0;
  const captured: AuthoringEnvironment = { ...environment(), getFunctionEntry: id => { if (id === recursive.fn.id) oldSelfReads++; return undefined; } };
  const result = inferAuthoringFunctionDraft(recursive.fn, recursive.declaration, captured);
  expect(result.outcome.$tag).toBe("Solved");
  expect(result.fn?.returns).toEqual(variable("a"));
  expect(oldSelfReads).toBe(0);
}, 120_000);

test("whole draft preserves higher-kinded application evidence", () => {
  const applied: FenelType = { $el: { call: ["f", variable("a")] } };
  const input = draft([field("data", applied)], { $ref: "String" }, { var: "data" }, true, ["f", "a"]);
  const kind = { $tag: "KArrow" as const, input: { $tag: "KType" as const }, output: { $tag: "KType" as const } };
  input.declaration = { ...input.declaration, scheme: { ...input.declaration.scheme!,
    quantified: [{ id: "draftIdentity:f", sourceName: "f", kind }, input.declaration.scheme!.quantified[1]!],
    applications: [{ path: ["$arrow", "params", "0", "type"], headVarId: "draftIdentity:f", args: [variable("a")], kind }],
  } };
  const result = inferAuthoringFunctionDraft(input.fn, input.declaration, environment());
  expect(result.outcome.$tag).toBe("Solved");
  expect(result.fn?.returns).toEqual(applied);
  expect(result.scheme?.quantified.find(row => row.sourceName === "f")?.kind).toEqual(kind);
  expect(result.scheme?.applications).toHaveLength(2);
  expect(result.fn?.params[0]?.key).toEqual(input.fn.params[0]?.key);
}, 120_000);

test("whole draft uses its captured source routes and fresh external body references", () => {
  const module = loadFenelModule(`
    same : a -> a
    same data = data
    number : Number -> Number
    number data = data
    editing : String -> String
    editing data = same data
  `, "draft_scope");
  const registry = createRegistry([module]);
  const fn = registry.getFunction("draft_scope:editing")!;
  const declaration = { ...module.functionSignatureDeclarations!.find(row => row.functionId === fn.id)!, returns: { $tag: "Absent" as const } };
  const captured: AuthoringEnvironment = { ...environment(), getFunctionEntry: id => {
    const entry = registry.getFunction(id);
    const info = registry.getFunctionSignatureInfo(id);
    return entry && info ? { ...entry, targetId: entry.id, scheme: info.scheme, signatureOutcome: info.outcome } : undefined;
  } };
  expect(inferAuthoringFunctionDraft(fn, declaration, captured, { registry }).outcome.$tag).toBe("Solved");
  const changed = { ...fn, body: { call: ["number", { var: "data" }] } };
  expect(inferAuthoringFunctionDraft(changed, declaration, captured, { registry }).outcome.$tag).toBe("Invalid");
  expect(registry.getFunction(fn.id)?.body).toEqual(fn.body);
}, 120_000);

test("whole draft retains nominal declaration identities", () => {
  const input = draft([field("token", { $ref: "Token" })], { $ref: "Token" }, { var: "token" }, false, []);
  const identity = '["saved-owner","Token"]';
  input.declaration = { ...input.declaration, scheme: { ...input.declaration.scheme!, nominals: [
    { path: ["$arrow", "params", "0", "type"], identity, publicName: "Token" },
    { path: ["$arrow", "returns"], identity, publicName: "Token" },
  ] } };
  const result = inferAuthoringFunctionDraft(input.fn, input.declaration, environment());
  expect(result.outcome.$tag).toBe("Solved");
  expect(result.scheme?.nominals?.every(nominal => nominal.identity === identity)).toBe(true);
  expect(result.scheme?.nominals).toHaveLength(2);
}, 120_000);

// The canonical equation abstains at a set former, and an authored result is
// trusted without a body check once saved: the existing containment verdict of
// the body's own inferred result decides Save instead.
test("an authored set-former result is decided by the existing containment verdict", () => {
  const num: FenelType = { $ref: "Number" }, str: FenelType = { $ref: "String" }, bool: FenelType = { $ref: "Boolean" };
  const save = (returns: FenelType, body: FenelFunction["body"], params: FieldDef[] = [], names: string[] = []) => {
    const input = draft(params, returns, body, false, names);
    return judgeAuthoringFunctionDraftSave(input.fn, input.declaration, environment());
  };
  const refused: Array<[FenelType, FenelFunction["body"]]> = [
    [{ $void: true }, 42], [{ $union: [num, bool] }, "abc"], [{ $complement: num }, 42], [{ $intersect: [str, Anything] }, 42],
  ];
  for (const [returns, body] of refused) {
    const verdict = save(returns, body);
    expect(verdict.inferred.outcome.$tag).toBe("AnnotationRequired");
    expect(verdict).toMatchObject({ invalid: true, needsAnnotation: false });
    expect(verdict.resultMismatch?.expected.body).toEqual(returns);
  }
  for (const [returns, body] of [[Anything, "abc"], [{ $complement: { $void: true } }, 42]] as Array<[FenelType, FenelFunction["body"]]>) {
    const verdict = save(returns, body);
    expect(verdict.inferred.outcome.$tag).toBe("AnnotationRequired");
    expect(verdict).toMatchObject({ invalid: false, needsAnnotation: false });
    expect(verdict.resultMismatch).toBeUndefined();
  }
  // Undecided containment keeps the explicit-result tolerance: a generic
  // parameter returned as "not Number" is neither proven in nor out.
  const undecided = save({ $complement: num }, { var: "x" }, [field("x", variable("a"))], ["a"]);
  expect(undecided.inferred.outcome.$tag).toBe("AnnotationRequired");
  expect(undecided).toMatchObject({ invalid: false, needsAnnotation: false });
  expect(undecided.resultMismatch).toBeUndefined();
  // A constructor result keeps its own refusal from the canonical equation.
  expect(save(str, 42)).toMatchObject({ invalid: true });
  expect(save(str, 42).inferred.outcome.$tag).toBe("Invalid");
}, 120_000);
