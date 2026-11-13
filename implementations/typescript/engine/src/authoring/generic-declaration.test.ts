import { describe, expect, test } from "bun:test";
import { Nothing } from "../type-foundation";
import type { Constraint, FenelType, FieldDef, TypeScheme } from "../types";
import type { ExprNode } from "./expression-authoring";
import { editAuthoringGenericDeclaration, type AuthoringGenericDeclarationDraft } from "./generic-parameters";

const quantified = [{ id: "stable-function-generic", sourceName: "a", kind: { $tag: "KType" as const } }];
const param: FieldDef = { name: "value", key: { $tag: "PositionalField", index: 0 }, type: { $var: "a" }, label: Nothing, ui: Nothing, meta: {} };
const scheme: TypeScheme = {
  quantified,
  body: { $arrow: { params: [param], returns: { $var: "a" } } },
  applications: [], nominals: [], diagnostics: [],
};
const annotation = (type: FenelType, expr: ExprNode = { kind: "param", name: "value" }): ExprNode => ({
  kind: "literal", value: { __ann: { expr, type } },
});
const requirements: readonly Constraint[] = [{ class: { $tag: "Id", entityId: "Eq" }, args: [{ $var: "a" }] }];
function rename<T extends AuthoringGenericDeclarationDraft>(draft: T, sourceName = "element"): T {
  const result = editAuthoringGenericDeclaration(draft, { kind: "rename", id: quantified[0]!.id, sourceName });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("complete generic declaration transactions", () => {
  test("renames signature, body annotation and requires together without replacing sidecars", () => {
    const body = annotation({ $var: "a" });
    const unrelated = { retained: true };
    const draft = { scheme, body, requires: requirements, unrelated, absentMetadata: undefined };
    const changed = rename(draft);
    expect(changed.scheme.quantified).toEqual([{ ...quantified[0]!, sourceName: "element" }]);
    expect(changed.scheme.body).toEqual({ $arrow: { params: [{ ...param, type: { $var: "element" } }], returns: { $var: "element" } } });
    expect(changed.body).toEqual(annotation({ $var: "element" }));
    expect(changed.requires).toEqual([{ class: requirements[0]!.class, args: [{ $var: "element" }] }]);
    expect(changed.requires[0]!.class).toBe(requirements[0]!.class);
    expect(changed.scheme.applications).toBe(scheme.applications);
    expect(changed.scheme.nominals).toBe(scheme.nominals);
    expect(changed.scheme.diagnostics).toBe(scheme.diagnostics);
    expect(changed.unrelated).toBe(unrelated);
    expect(Object.hasOwn(changed, "absentMetadata")).toBe(true);
    expect(draft.body).toBe(body);
    expect(draft.requires).toBe(requirements);
    expect(scheme.quantified[0]!.sourceName).toBe("a");
  });

  test("term lambdas do not shadow type binders; mu annotations retain their own scope", () => {
    const shadow = { $mu: { var: "a", body: { $var: "a" } } } as FenelType;
    const body: ExprNode = { kind: "literal", value: { __lambda: {
      params: ["b"], arrayParams: true,
      body: { kind: "literal", value: { __do: [
        annotation({ $var: "a" }, { kind: "param", name: "b" }), annotation(shadow),
      ] } },
    } } };
    const changed = rename({ scheme, body }, "b");
    const value = (changed.body as Extract<ExprNode, { kind: "literal" }>).value as any;
    expect(value.__lambda.params).toEqual(["b"]);
    expect(value.__lambda.arrayParams).toBe(true);
    expect(value.__lambda.body.value.__do[0]).toEqual(annotation({ $var: "b" }, { kind: "param", name: "b" }));
    expect(value.__lambda.body.value.__do[1].value.__ann.type).toBe(shadow);
  });

  test("local binding annotations and raw ann sites rename while incomplete literal slots survive", () => {
    const hole: ExprNode = { kind: "literal", value: undefined };
    const body: ExprNode = { kind: "literal", value: { __do: [
      { kind: "literal", value: { __let: { bindings: [{ name: "local", type: { $var: "a" }, expr: { kind: "param", name: "value" } }] } } },
      { kind: "literal", value: { ann: [{ var: "local" }, { $var: "a" }] } },
      hole,
    ] } };
    const changed = rename({ scheme, body });
    const steps = ((changed.body as Extract<ExprNode, { kind: "literal" }>).value as any).__do;
    expect(steps[0].value.__let.bindings[0].type).toEqual({ $var: "element" });
    expect(steps[1].value.ann[1]).toEqual({ $var: "element" });
    expect(steps[2]).toBe(hole);
    expect(Object.hasOwn(steps[2], "value")).toBe(true);
  });

  test("removal and kind changes detect usages that exist only outside the signature", () => {
    const unused: TypeScheme = { quantified, body: { $unit: true } };
    for (const draft of [
      { scheme: unused, body: annotation({ $var: "a" }) },
      { scheme: unused, requires: requirements },
    ]) {
      const removed = editAuthoringGenericDeclaration(draft, { kind: "remove", id: quantified[0]!.id });
      expect(removed.ok).toBe(false);
      if (!removed.ok) expect(removed.message).toMatch(/still used/);
      const kind = editAuthoringGenericDeclaration(draft, { kind: "set-kind", id: quantified[0]!.id,
        type: { $arrow: { params: [{ ...param, type: { $type: true } }], returns: { $type: true } } },
      });
      expect(kind.ok).toBe(false);
    }
  });

  test("body capture, unsupported dependent contexts and unknown executable forms refuse atomically", () => {
    const cases: AuthoringGenericDeclarationDraft[] = [
      { scheme, body: annotation({ $mu: { var: "element", body: { $var: "a" } } }), requires: requirements },
      { scheme, body: annotation({ $el: { var: "selectedType" } }), requires: requirements },
      { scheme, body: { kind: "literal", value: { __futureForm: { expression: annotation({ $var: "a" }) } } }, requires: requirements },
    ];
    for (const draft of cases) {
      const result = editAuthoringGenericDeclaration(draft, { kind: "rename", id: quantified[0]!.id, sourceName: "element" });
      expect(result.ok).toBe(false);
      expect(draft.scheme).toBe(scheme);
      expect(draft.requires).toBe(requirements);
      expect(scheme.quantified[0]!.sourceName).toBe("a");
    }
    const capture = editAuthoringGenericDeclaration({ scheme, body: annotation({ $var: "b" }) }, { kind: "add", variable: { id: "fresh-b", sourceName: "b", kind: { $tag: "KType" } } });
    expect(capture.ok).toBe(false);
    if (!capture.ok) expect(capture.message).toMatch(/capture/);
  });

  test("renaming refuses free application heads in body annotations and requires without sidecars", () => {
    const application: FenelType = { $el: { call: ["f", { $ref: "Number" }] } };
    const body = annotation(application);
    const requires: readonly Constraint[] = [{ class: requirements[0]!.class, args: [{ $el: { call: ["f", "Number"] } }] }];
    for (const draft of [{ scheme, body }, { scheme, requires }]) {
      const result = editAuthoringGenericDeclaration(draft, { kind: "rename", id: quantified[0]!.id, sourceName: "f" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/capture/);
      expect(draft.scheme).toBe(scheme);
      expect(draft.scheme.quantified[0]!.sourceName).toBe("a");
    }
    expect(body).toEqual(annotation(application));
    expect(requires[0]!.args).toEqual([{ $el: { call: ["f", "Number"] } }]);
  });

  test("inherited optional accessors are not promoted into declaration facts or invoked", () => {
    let reads = 0;
    const prototype = {};
    for (const name of ["body", "params", "requires"]) Object.defineProperty(prototype, name, { get() { reads += 1; throw new Error("inherited getter invoked"); } });
    const draft = Object.assign(Object.create(prototype), { scheme }) as AuthoringGenericDeclarationDraft;
    const changed = rename(draft);
    expect(reads).toBe(0);
    for (const name of ["body", "params", "requires"]) expect(Object.hasOwn(changed, name)).toBe(false);
  });
});
