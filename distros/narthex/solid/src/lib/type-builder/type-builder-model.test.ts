import { describe, expect, test } from "bun:test";
import type { Constraint, FenelType } from "@fenel/engine/types";
import {
  TYPE_KIND_GROUPS,
  constraintDraftToConstraint,
  constraintToDraft,
  defaultElExpressionForMode,
  defaultTypeForKind,
  detectElMode,
  detectTypeKind,
  fenelTypeToTypeExpr,
  typeExprToFenelType,
  type TypeKind,
} from "@fenel/engine/authoring/type";

const ALL_KINDS: TypeKind[] = [
  "void", "unit", "named", "var", "type",
  "record", "variant", "tuple", "map",
  "list", "maybe", "result",
  "union", "intersect", "complement",
  "el-call", "refined", "mu",
  "tagged", "opaque", "arrow",
  "el",
];

describe("type-builder model", () => {
  test("the picker exposes every supported FenelType constructor exactly once", () => {
    const pickable = TYPE_KIND_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(pickable).size).toBe(pickable.length);
    expect(new Set(pickable)).toEqual(new Set(ALL_KINDS));
  });

  test("defaults detect back to their kind for every pickable former", () => {
    for (const kind of ALL_KINDS) {
      expect(detectTypeKind(defaultTypeForKind(kind))).toBe(kind);
    }
  });

  test("$el expression modes project the canonical expression shapes", () => {
    expect(detectElMode(defaultElExpressionForMode("sibling"))).toBe("sibling");
    expect(detectElMode(defaultElExpressionForMode("call"))).toBe("call");
    expect(detectElMode(defaultElExpressionForMode("if"))).toBe("if");
    expect(detectElMode(defaultElExpressionForMode("match"))).toBe("match");
    expect(detectElMode({ let: { t: { $ref: "String" } } })).toBe("expression");
  });

  test("constraint drafts preserve the persisted class/id shape", () => {
    const constraint = constraintDraftToConstraint({
      interfaceName: "HasStateIO",
      args: [{ $var: "scope" }, { $ref: "Profile" }],
    });
    expect(constraint).toEqual({
      class: { $tag: "Id", entityId: "HasStateIO" },
      args: [{ $var: "scope" }, "Profile"],
    });
    expect(constraintToDraft(constraint)).toEqual({
      interfaceName: "HasStateIO",
      args: [{ $var: "scope" }, { $ref: "Profile" }],
    });
  });

  test("TypeExpr conversion covers named refs, variables, and generic apps", () => {
    const type: FenelType = {
      $el: { call: ["Maybe", { $var: "a" }, { $ref: "Profile" }] },
    };
    const expr = fenelTypeToTypeExpr(type);
    expect(expr).toEqual({
      $el: { call: ["Maybe", { $var: "a" }, "Profile"] },
    });
    expect(typeExprToFenelType(expr)).toEqual(type);
  });

  test("loaded constraints with TypeExpr args become type-builder drafts", () => {
    const loaded: Constraint = {
      class: { $tag: "Id", entityId: "Symbolic" },
      args: [{ $el: { call: ["Vec", "Nat", { $var: "a" }] } }],
    };
    expect(constraintToDraft(loaded)).toEqual({
      interfaceName: "Symbolic",
      args: [{ $el: { call: ["Vec", { $ref: "Nat" }, { $var: "a" }] } }],
    });
  });
});
