// C1: exercise the actual TypeEditor's host registry transport without mounting
// unrelated browser leaves. The planner itself remains the Fenel-owned API.
import { describe, expect, test } from "bun:test";
import type { FieldDef, FenelType } from "@fenel/engine/types";
import type { FieldEditPlan, FieldEditPlanArgs } from "@fenel/engine/authoring/field-render";
import type { AuthoringSession } from "../expression-runner/authoring-session";
import type { EvaluateContext } from "@fenel/engine/expressions";

const source = await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text();
const resolveStart = source.indexOf("export function resolveElInType(");
const resolveEnd = source.indexOf('import { MarkupEditor', resolveStart);
const resolveBody = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(resolveStart, resolveEnd).replace("export function", "function"));
const prepareResolve = new Function("scopedConcreteType", "dependentTypeForValuePath", "FIELD_AUTHORING_ENV", `${resolveBody}; return resolveElInType;`) as (
  scoped: (...args: unknown[]) => FenelType | undefined, legacy: (...args: unknown[]) => FenelType, environment: unknown,
) => (type: FenelType, values: Record<string, unknown>, session?: AuthoringSession) => FenelType;
const editorStart = source.indexOf("function TypeEditor(");
const start = source.indexOf("  const plan = createMemo", editorStart);
const end = source.indexOf("  return (", start);
const fieldStart = source.indexOf("function fieldForType(");
const fieldEnd = source.indexOf("/** Type-only editor", fieldStart);
const body = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(fieldStart, fieldEnd) + source.slice(start, end));
type Registry = { getIdentifiedEntity: (handle: string) => { type: FenelType } | undefined };
const prepare = new Function("props", "field", "recordValues", "registry", "fieldEditPlan", "createMemo", "refHandle", "Nothing", "Just", "planningContext",
  `${body}; return plan;`) as (
    props: { type: FenelType; value: unknown }, field: () => FieldDef, recordValues: () => Record<string, unknown>,
    registry: () => Registry | undefined, planner: (args: FieldEditPlanArgs) => FieldEditPlan,
    memo: (read: () => FieldEditPlan) => () => FieldEditPlan, handle: (type: FenelType) => string | undefined,
    nothing: unknown, just: (value: unknown) => unknown, planningContext: () => EvaluateContext,
  ) => () => FieldEditPlan;
const nothing = { $tag: "Nothing" } as const;
const named = { $ref: "captured-type" };
const synthetic: FieldDef = { name: "value", type: named, label: nothing, ui: nothing, meta: {} };

function fixture(current: Registry | undefined) {
  const calls: FieldEditPlanArgs[] = [];
  const context: EvaluateContext = { _activeTags: ["captured-reader"] };
  const requested: FieldEditPlan = { name: "value", label: "Captured name", typeLabel: "Captured type", required: false,
    editor: { kind: "unsupported", rawType: named, reason: "unknown named type" } };
  const props = { type: named as FenelType, value: { title: "Draft" } };
  const read = prepare(props, () => synthetic, () => ({ sibling: "current" }), () => current, args => {
    calls.push(args);
    return args.field.type === named ? requested : { ...requested, required: true,
      editor: { kind: "record", rawType: args.field.type, fields: (args.field.type as Extract<FenelType, { $record: unknown }>).$record.fields } };
  }, read => read, type => "$ref" in type ? type.$ref : undefined, nothing, value => ({ $tag: "Just", _0: value }), () => context);
  return { read, calls, requested, context, replaceRegistry: (next: Registry | undefined) => { current = next; } };
}

describe("nested type editor captured declaration", () => {
  test("a synthetic list slot resolves its type without fabricating field identity", () => {
    const field: FieldDef = { ...synthetic, name: "title", type: { $ref: "String" },
      key: { $tag: "NamedField", ref: { $ref: "captured-title-field" } } };
    const declaration: FenelType = { $record: { fields: [field] } };
    const run = fixture({ getIdentifiedEntity: handle => handle === "captured-type" ? { type: declaration } : undefined });
    const plan = run.read();
    expect(plan.editor).toEqual({ kind: "record", rawType: declaration, fields: [field] });
    expect(plan.label).toBe("Captured name");
    expect(run.calls).toHaveLength(2);
    for (const call of run.calls) {
      expect(call.registry).toBeUndefined();
      expect(call.evaluateContext).toBe(run.context);
      expect(call.field.key).toBeUndefined();
      expect(call.recordValues).toEqual({ sibling: "current" });
    }
    expect(run.calls[1]!.field.type).toBe(declaration);
  });

  test("missing captured declarations retain the original unsupported plan", () => {
    const run = fixture(undefined);
    expect(run.read()).toBe(run.requested);
    expect(run.calls).toHaveLength(1);
  });

  test("a replaced reader resolves the same handle in its own current declaration", () => {
    const first: FenelType = { $record: { fields: [{ ...synthetic, name: "first" }] } };
    const second: FenelType = { $record: { fields: [{ ...synthetic, name: "second" }] } };
    const run = fixture({ getIdentifiedEntity: () => ({ type: first }) });
    expect(run.read().editor.rawType).toBe(first);
    run.replaceRegistry({ getIdentifiedEntity: () => ({ type: second }) });
    expect(run.read().editor.rawType).toBe(second);
  });
});

describe("dependent field current reader", () => {
  const dependent: FenelType = { $el: { call: ["captured.type", { var: "selectedType" }] } };
  const session = { evaluateContext: { reader: "current" }, environment: { reader: "current" },
    registry: { reader: "current" } } as unknown as AuthoringSession;

  test("scoped resolution receives the exact session and current sibling data", () => {
    const calls: unknown[][] = [];
    const concrete: FenelType = { $arrow: { params: [], returns: { $ref: "String" } } };
    const resolve = prepareResolve((...args) => { calls.push(args); return concrete; }, () => {
      throw Error("A scoped field must not consult the legacy global resolver");
    }, {});
    const values = { selectedType: { $ref: "String" } };
    expect(resolve(dependent, values, session)).toBe(concrete);
    expect(calls).toEqual([[dependent, session.evaluateContext, session.environment, session.registry, values]]);
  });

  test("an undecided scoped type stays unresolved without global fallback", () => {
    const resolve = prepareResolve(() => undefined, () => { throw Error("global fallback"); }, {});
    expect(resolve(dependent, {}, session)).toBe(dependent);
  });

  test("unprepared standalone callers retain the existing compatibility route", () => {
    const concrete: FenelType = { $ref: "Number" };
    const resolve = prepareResolve(() => { throw Error("no session was supplied"); }, () => concrete, {});
    expect(resolve(dependent, {})).toBe(concrete);
  });
});
