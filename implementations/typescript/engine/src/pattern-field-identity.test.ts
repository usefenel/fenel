import { describe, expect, test } from "bun:test";
import type { CompileFieldSlot } from "./compilable";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedExprToJsonLogic,
  marshalPatterns,
} from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import type { FieldKey, SetExpr } from "./types";

const UUID_A = "31111111-1111-4111-8111-111111111111";
const UUID_B = "32222222-2222-4222-8222-222222222222";

const namedKey = (id: string): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: id },
});

const namedSlot = (wireName: string, id: string): CompileFieldSlot => ({
  key: namedKey(id),
  wireName,
});

const positionalSlot = (wireName: string, index: number): CompileFieldSlot => ({
  key: { $tag: "PositionalField", index },
  wireName,
});

const enumSet = (...values: unknown[]): SetExpr => ({
  $tag: "SeEnum",
  values,
} as SetExpr);

const ctorSet = (
  ctor: string,
  fields: ReadonlyArray<{ key: FieldKey; wireName: string; set: SetExpr }>,
): SetExpr => ({
  $tag: "SeCtor",
  ctor,
  fields: fields.map((field) => ({ $tag: "SetCtorField", ...field })),
} as SetExpr);

const patVar = (name: string): unknown => ({ $tag: "PatVar", name });
const patCtor = (
  ctor: string,
  args: unknown[],
  fields?: CompileFieldSlot[],
): unknown => ({
  $tag: "PatConstruct",
  ctor,
  args,
  ...(fields === undefined ? {} : { fields }),
});

function checkMatch(
  branch: SetExpr,
  pattern: unknown,
  goal: SetExpr,
): "true" | "false" | "nothing" {
  const expr = {
    $tag: "EMatch",
    scrutinee: { $tag: "EVar", name: "value" },
    arms: [{ pattern, body: { $tag: "EVar", name: "payload" } }],
  };
  const result = dispatchEngineBodyWithDeciderCtx("engine:checkExpr", [
    expr,
    [{ name: "value", set: branch }],
    goal,
  ]) as { $tag?: string; _0?: unknown };
  return result.$tag === "Just"
    ? result._0 === true ? "true" : "false"
    : "nothing";
}

describe("resolved pattern slots preserve semantic identity", () => {
  test("a rename keeps matching by UUID and narrows through the branch's current wire projection", () => {
    const payload = enumSet(7);
    const branch = ctorSet("Box", [{
      key: namedKey(UUID_A),
      wireName: "afterRename",
      set: payload,
    }]);
    const pattern = patCtor("Box", [patVar("payload")], [
      namedSlot("beforeRename", UUID_A),
    ]);

    expect(checkMatch(branch, pattern, payload)).toBe("true");
  });

  test("the same wire spelling with a different UUID does not acquire meaning", () => {
    const payload = enumSet(7);
    const branch = ctorSet("Box", [{
      key: namedKey(UUID_A),
      wireName: "payload",
      set: payload,
    }]);
    const pattern = patCtor("Box", [patVar("payload")], [
      namedSlot("payload", UUID_B),
    ]);

    expect(checkMatch(branch, pattern, payload)).toBe("nothing");
  });

  test("positional identity remains structural", () => {
    const payload = enumSet(7);
    const branch = ctorSet("Box", [{
      key: { $tag: "PositionalField", index: 0 },
      wireName: "_0",
      set: payload,
    }]);
    const pattern = patCtor("Box", [patVar("payload")], [
      positionalSlot("_0", 0),
    ]);

    expect(checkMatch(branch, pattern, payload)).toBe("true");
  });
});

describe("pattern property boundaries", () => {
  test("marshalPatterns projects resolved slots to wireName without stringifying them", () => {
    expect(marshalPatterns(patCtor("Box", [patVar("payload")], [
      namedSlot("afterRename", UUID_A),
    ]))).toEqual({
      $tag: "Box",
      afterRename: { $bind: "payload" },
    });
  });

  test("marshalPatterns authors hostile resolved and generic keys as own data properties", () => {
    const resolved = marshalPatterns(patCtor("Box", [patVar("payload")], [
      namedSlot("__proto__", UUID_A),
    ])) as Record<string, unknown>;
    expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(resolved, "__proto__")).toBe(true);
    expect(resolved["__proto__"]).toEqual({ $bind: "payload" });

    const genericInput = Object.fromEntries([
      ["__proto__", { nested: patVar("value") }],
      ["constructor", 7],
    ]);
    const generic = marshalPatterns(genericInput) as Record<string, unknown>;
    expect(Object.getPrototypeOf(generic)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(generic, "__proto__")).toBe(true);
    expect(generic["__proto__"]).toEqual({ nested: { $bind: "value" } });
    expect(generic["constructor"]).toBe(7);
  });

  test("interpreted resolved patterns require hostile fields to be own properties", () => {
    for (const [wireName, id] of [
      ["__proto__", UUID_A],
      ["constructor", UUID_B],
    ] as const) {
      const pattern = marshalPatterns(patCtor("Box", [patVar("payload")], [
        namedSlot(wireName, id),
      ]));
      const match = (scrutinee: Record<string, unknown>): unknown => evaluate({
        match: [scrutinee, pattern, { var: "payload" }, "miss"],
      });

      expect(match({ $tag: "Box" })).toBe("miss");

      const inherited = Object.create(Object.fromEntries([
        [wireName, `inherited-${wireName}`],
      ])) as Record<string, unknown>;
      inherited["$tag"] = "Box";
      expect(match(inherited)).toBe("miss");

      const own = { $tag: "Box" } as Record<string, unknown>;
      Object.defineProperty(own, wireName, {
        value: `own-${wireName}`,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      expect(match(own)).toBe(`own-${wireName}`);
    }
  });

  test("marshalPatterns preserves truly unresolved parser-surface names and positional fallback", () => {
    expect(marshalPatterns({
      $tag: "PatConstruct",
      ctor: "SurfaceBox",
      args: [patVar("payload")],
      fields: ["authoredName"],
    })).toEqual({
      $tag: "SurfaceBox",
      authoredName: { $bind: "payload" },
    });
    expect(marshalPatterns(patCtor("PosBox", [patVar("payload")]))).toEqual({
      $tag: "PosBox",
      _0: { $bind: "payload" },
    });
  });

  test("the partial evaluator projects resolved wireName only for the concrete object read", () => {
    const verdict = dispatchEngineBody("engine:peMatchPattern", [
      { $tag: "Box", afterRename: 7 },
      patCtor("Box", [patVar("payload")], [namedSlot("afterRename", UUID_A)]),
      null,
    ]);
    expect(verdict).toEqual({
      kind: "match",
      binds: [{ name: "payload", value: 7 }],
    });
  });

  test("the partial evaluator retains the fields-absent positional fallback", () => {
    const verdict = dispatchEngineBody("engine:peMatchPattern", [
      { $tag: "Box", _0: 7 },
      patCtor("Box", [patVar("payload")]),
      null,
    ]);
    expect(verdict).toEqual({
      kind: "match",
      binds: [{ name: "payload", value: 7 }],
    });
  });

  test("residual construct egress chooses positional form by FieldKey, not spelling", () => {
    expect(dispatchedExprToJsonLogic({
      $tag: "EConstruct",
      ctor: "Box",
      args: [{ $tag: "ELit", value: 7 }],
      fields: [positionalSlot("readableSourceName", 0)],
    })).toEqual({ construct: ["Box", 7] });
  });

  test("residual named construct egress projects the current wireName", () => {
    expect(dispatchedExprToJsonLogic({
      $tag: "EConstruct",
      ctor: "Box",
      args: [{ $tag: "ELit", value: 7 }],
      fields: [namedSlot("afterRename", UUID_A)],
    })).toEqual({ construct: ["Box", { afterRename: 7 }] });
  });
});
