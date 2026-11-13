import { describe, expect, test } from "bun:test";
import { exprNodeToLogic, type ExprNode } from "@fenel/engine/authoring/expression";
import {
  appendExpressionAt, expressionAt, removeExpressionAt, replaceExpressionAt, retainExpressionChildren, projectAuthoredRead,
} from "./locus-expression-edit";
import type { FenelType } from "@fenel/engine/types";
import { restoreSavedExpressionDeclaration } from "./saved-expression-map";
import { Nothing } from "@fenel/engine/type-foundation";

const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const list = (...entries: ExprNode[]): ExprNode => literal({ __list: entries });
const ref: ExprNode = { kind: "ref", savedExprId: "source-photo" };
const call: ExprNode = { kind: "call", fnId: "picture:invert", args: [ref] };

const recordType = (fields: Record<string, FenelType>): FenelType => ({ $record: { fields: Object.entries(fields).map(([name, type]) => ({
  name, type, label: Nothing, ui: Nothing, meta: {},
})) } });
const recordExpr = (fields: Record<string, ExprNode>): ExprNode => literal({ __record: { fields: Object.entries(fields).map(([name, value]) => ({ name, value })) } });

describe("reading an admitted authored producer without its unrelated siblings", () => {
  test("nested declared records retain the exact selected reference and absolute source coordinates", () => {
    const selected: ExprNode = { kind: "ref", savedExprId: "fenel" };
    const skipped: ExprNode = { kind: "call", fnId: "unrelated-heavy-work", args: [] };
    const source = recordExpr({ Demo: recordExpr({ Fenel: selected, Other: skipped }), Library: skipped });
    const type = recordType({ Demo: recordType({ Fenel: { $ref: "Project" }, Other: { $ref: "Image" } }), Library: { $ref: "Any" } });
    const projected = projectAuthoredRead(source, ["Demo", "Fenel", "namedAfter"], type);
    expect(projected.expression).toBe(selected);
    expect(projected.type).toEqual({ $ref: "Project" });
    expect(projected.basePath).toEqual(["Demo", "Fenel"]);
    expect(projected.resultPath).toEqual(["namedAfter"]);
    expect(expressionAt(source, ["Demo", "Other"])).toBe(skipped);
  });

  test("lexical, ascribed, saved-declaration and dependent boundaries keep their enclosing producer", () => {
    const child = recordExpr({ selected: literal(1) });
    const type = recordType({ selected: { $ref: "Number" } });
    for (const source of [literal({ __let: { bindings: [{ name: "x", expr: literal(1) }], body: child } }),
      literal({ __ann: { expr: child, type } }), literal({ __where: { body: child, bindings: [] } }),
      literal({ __withInstance: { frame: literal({}), body: child } }),
      restoreSavedExpressionDeclaration(child, { type })]) {
      const projected = projectAuthoredRead(source, ["selected"], type);
      expect(projected.expression).toBe(source);
      expect(projected.basePath).toEqual([]);
      expect(projected.resultPath).toEqual(["selected"]);
    }
    const dependent: FenelType = { $el: { var: "sibling" } };
    const projected = projectAuthoredRead(child, ["selected"], recordType({ selected: dependent }));
    expect(projected.expression).toBe(child);
    expect(projected.type).toEqual(recordType({ selected: dependent }));
  });

  test("a computed or variant result retains its producer and residual path; unproved list prefixes stay whole", () => {
    const computed: ExprNode = { kind: "call", fnId: "produce-record", args: [] };
    const source = recordExpr({ computed });
    const projected = projectAuthoredRead(source, ["computed", "answer"], recordType({ computed: { $variant: { cases: [] } } }));
    expect(projected.expression).toBe(computed);
    expect(projected.basePath).toEqual(["computed"]);
    expect(projected.resultPath).toEqual(["answer"]);
    const values = list(computed);
    expect(projectAuthoredRead(values, [0, "answer"], { $ref: "List" }).expression).toBe(values);
  });
});

describe("editing authored containers without snapshots", () => {
  test("replacing one list item retains sibling reference and function-call objects", () => {
    const initial = list(literal("a"), ref, call);
    const changed = replaceExpressionAt(initial, [0], literal("edited"));
    expect(expressionAt(changed, [1])).toBe(ref);
    expect(expressionAt(changed, [2])).toBe(call);
    expect(expressionAt(initial, [0])).toEqual(literal("a"));
  });

  test("nested record edits retain field metadata and untouched expressions", () => {
    const initial = literal({ __record: { note: "keep", fields: [
      { name: "title", value: literal("old"), fieldId: "title-id" },
      { name: "photos", value: list(ref, call), fieldId: "photos-id" },
    ] } });
    const changed = replaceExpressionAt(initial, ["photos", 0], literal("replacement"));
    expect(expressionAt(changed, ["photos", 1])).toBe(call);
    expect((changed as any).value.__record.note).toBe("keep");
    expect((changed as any).value.__record.fields[1].fieldId).toBe("photos-id");
    expect(expressionAt(initial, ["photos", 0])).toBe(ref);
  });

  test("plain data can receive a live ref without storing an ExprNode as the value", () => {
    const changed = replaceExpressionAt(literal({ photos: ["old", "keep"], title: "Album" }), ["photos", 0], ref);
    expect(expressionAt(changed, ["photos", 0])).toBe(ref);
    expect(exprNodeToLogic(changed, { resolver: () => literal("live photo") }))
      .toEqual({ photos: ["live photo", "keep"], title: "Album" });
  });

  test("append, reorder and delete retain expressions in their new positions", () => {
    const initial = appendExpressionAt(list(literal("a"), ref), [], call);
    const reordered = retainExpressionChildren(initial, [], [2, 1]);
    expect(expressionAt(reordered, [0])).toBe(call);
    expect(expressionAt(reordered, [1])).toBe(ref);
    expect(expressionAt(removeExpressionAt(reordered, [0]), [0])).toBe(ref);
  });

  test("moving a nested expression out preserves its live reference", () => {
    const initial = list(list(ref, literal("sibling")), call);
    const moved = expressionAt(initial, [0, 0]);
    const result = appendExpressionAt(removeExpressionAt(initial, [0, 0]), [], moved);
    expect(expressionAt(result, [2])).toBe(ref);
    expect(expressionAt(result, [1])).toBe(call);
    expect(expressionAt(result, [0, 0])).toEqual(literal("sibling"));
  });

  test("marker-shaped raw sibling data is not activated by promotion", () => {
    const markerData = { __list: [{ kind: "ref", savedExprId: "must-stay-data" }] };
    const initial = literal([markerData, "change"]);
    const result = replaceExpressionAt(initial, [1], literal("changed"));
    expect(exprNodeToLogic(result, { resolver: () => { throw new Error("Data was executed"); } }))
      .toEqual([markerData, "changed"]);
  });

  test("tagged data retains its constructor while constant fields change or reorder", () => {
    const initial = literal({ $tag: "Album", title: "old", names: ["a", "b"] });
    const changed = replaceExpressionAt(initial, ["names", 1], literal("edited"));
    expect((changed as any).value).toEqual({ $tag: "Album", title: "old", names: ["a", "edited"] });
    expect((retainExpressionChildren(changed, [], ["names"]) as any).value)
      .toEqual({ $tag: "Album", names: ["a", "edited"] });
    expect(() => replaceExpressionAt(initial, ["title"], ref)).toThrow("constructor expression");
  });

  test("explicit constructor expressions can retain live field expressions", () => {
    const initial = literal({ __construct: { tag: "Album", fields: [
      { name: "title", value: literal("old") }, { name: "photo", value: ref },
    ] } });
    const changed = replaceExpressionAt(initial, ["title"], literal("new"));
    expect((changed as any).value.__construct.tag).toBe("Album");
    expect(expressionAt(changed, ["photo"])).toBe(ref);
  });
});

describe("owner boundaries and invalid edits", () => {
  test("traversing calls, parameters, nested references or computed literal forms refuses", () => {
    for (const computed of [ref, call, { kind: "param", name: "photos" } as ExprNode,
      literal({ __apply: { target: ref, args: [] } }), literal({ __where: { body: ref, bindings: [] } })]) {
      expect(() => replaceExpressionAt(list(computed), [0, "title"], literal("bad"))).toThrow();
      expect(() => appendExpressionAt(computed, [], literal("bad"))).toThrow();
    }
    // Replacing the reference SLOT itself is an intentional authored edit.
    expect(expressionAt(replaceExpressionAt(list(ref), [0], literal("new")), [0])).toEqual(literal("new"));
  });

  test("missing, wrong-kind, duplicate and non-integer keys refuse", () => {
    const initial = list(ref, call);
    for (const path of [[3], [-1], [0.5], ["0"]]) {
      expect(() => replaceExpressionAt(initial, path, literal("bad"))).toThrow();
    }
    expect(() => retainExpressionChildren(initial, [], [0, 0])).toThrow();
    expect(() => replaceExpressionAt(literal({ title: "a" }), ["missing"], ref)).toThrow();
    expect(() => appendExpressionAt(literal({ title: "a" }), [], ref)).toThrow();
    expect(() => removeExpressionAt(initial, [])).toThrow();
  });

  test("ambiguous duplicate record fields refuse instead of editing a hidden occurrence", () => {
    const initial = literal({ __record: { fields: [
      { name: "same", value: ref }, { name: "same", value: call },
    ] } });
    expect(() => replaceExpressionAt(initial, ["same"], literal("bad"))).toThrow("repeats");
  });

  test("a literal __proto__ field is data and does not change object prototypes", () => {
    const initial = literal(JSON.parse('{"__proto__":"old","name":"record"}'));
    const changed = replaceExpressionAt(initial, ["__proto__"], ref);
    expect(expressionAt(changed, ["__proto__"])).toBe(ref);
    const lowered = exprNodeToLogic(changed, { resolver: () => literal("safe") }) as Record<string, unknown>;
    expect(Object.hasOwn(lowered, "__proto__")).toBe(true);
    expect(lowered.__proto__).toBe("safe");
  });
});

describe("constructor applications written for typed data", () => {
  const customer: ExprNode = { kind: "call", fnId: "crm:Customer", args: [literal("A"), literal("a@x"), ref] };
  const options = { constructorFields: (fnId: string) => fnId === "crm:Customer" ? ["name", "email", "photo"] : undefined };

  test("a field is edited in place, and its siblings keep their expressions", () => {
    const changed = replaceExpressionAt(list(customer), [0, "email"], literal("b@x"), options);
    const edited = expressionAt(changed, [0], options) as Extract<ExprNode, { kind: "call" }>;
    expect(edited.fnId).toBe("crm:Customer");
    expect(edited.args[1]).toEqual(literal("b@x"));
    expect(edited.args[2]).toBe(ref);
    expect(expressionAt(changed, [0, "name"], options)).toEqual(literal("A"));
  });

  test("a constructor keeps every field in its place", () => {
    expect(() => removeExpressionAt(customer, ["email"], options)).toThrow(/every field/);
    expect(() => retainExpressionChildren(customer, [], ["email", "name", "photo"], options)).toThrow(/every field/);
    expect(() => appendExpressionAt(customer, [], literal("extra"), options)).toThrow();
  });

  test("a call the session does not know as a constructor stays computed", () => {
    expect(() => replaceExpressionAt(list(call), [0, "title"], literal("bad"), options)).toThrow(/computed/);
    expect(() => replaceExpressionAt(list(customer), [0, "email"], literal("b@x"))).toThrow(/computed/);
  });
});
