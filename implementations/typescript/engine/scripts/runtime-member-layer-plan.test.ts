// C1/C2: execute the source layer selection without building a registry.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "../src/fenel-parser";
import { resolveLocalCallHeads } from "../src/fenel-module";
import { evaluate, type EvaluateContext } from "../src/json-logic";
import { marshalTraversalDeclarationType } from "../src/engine-bodies-dispatch";
import { pureValueType } from "../src/authoring/value-authoring";
import { unfold } from "../src/set-algebra";
import { Nothing } from "../src/maybe-value";
import type { FieldDef, FenelFunction, FenelType } from "../src/types";
import { stdNatives } from "../../../../fenel/modules/std/ffi/std-ffi";

const source = readFileSync(resolve(import.meta.dir, "../../../../fenel/modules/engine/type-algebra.fenel"), "utf8");
const start = source.indexOf("RuntimeMemberLayerPlan =");
const end = source.indexOf("typeAlgebraConstructorMemberType :", start);
if (start < 0 || end <= start) throw new Error("runtime member layer source boundaries are missing");
const boundedSource = source.slice(start, end).replace(/\s*@category "engine-internal"\s*$/u, "");
const program = parse(`module engine where\n${boundedSource}`) as {
  program: { def?: { name: string; params: string[]; body: unknown } }[];
};
const functions = new Map<string, FenelFunction>();
for (const item of program.program) {
  if (item.def === undefined) continue;
  const def = item.def;
  functions.set(def.name, {
    id: def.name,
    params: def.params.map(name => ({ name, type: { $complement: { $void: true } }, label: Nothing, ui: Nothing, meta: {} })),
    returns: { $complement: { $void: true } },
    body: resolveLocalCallHeads(def.body, def.params) as FenelFunction["body"],
  });
}
const context: EvaluateContext = {
  getFunction: name => functions.get(name),
  natives: { ...stdNatives },
  _constructors: {
    RuntimeMemberKeep: [], RuntimeMemberUseRaw: ["_0"],
    RuntimeMemberResolveRef: ["_0"], RuntimeMemberUnfold: ["_0"],
  },
};
const marshal = (type: FenelType) => marshalTraversalDeclarationType(type, "runtime-member-test", {
  graftMissingSemanticKeys: false, repositoryCanonicalKeys: false,
}).type;
const plan = (type: FenelType, resolved = false) => evaluate({ call: [
  resolved ? "typeAlgebraRuntimeMemberResolvedLayerPlan" : "typeAlgebraRuntimeMemberLayerPlan", { var: "node" },
] }, { node: marshal(type) }, context) as { $tag: string; _0?: unknown };

const field = (type: FenelType): FieldDef => ({
  name: "child", key: { $tag: "PositionalField", index: 0 }, type, label: Nothing, ui: Nothing, meta: {},
});
const record: FenelType = { $record: { fields: [field({ $ref: "Int" })] } };
const opaque: FenelType = { $opaque: { name: "Captured", pure: record } };
const mu: FenelType = { $mu: { var: "self", body: { $record: { fields: [
  field({ $var: "self" }),
] } } } };
const refined = (base: FenelType): FenelType => ({ $refined: { base, set: { $tag: "SeAll" } } });
const tagged = (value: FenelType): FenelType => ({ $tagged: { value, phantom: { $unit: true } } });

describe("captured runtime member source layer plan", () => {
  test("outer tags and refinements expose exactly one opaque pure layer", () => {
    for (const input of [opaque, refined(opaque), tagged(opaque), refined(tagged(opaque))]) {
      const result = plan(input);
      expect(result.$tag).toBe("RuntimeMemberUseRaw");
      expect(result._0).toBe(record);
      expect(result._0).toBe(pureValueType(input, () => undefined));
    }
    for (const pure of [opaque, mu, tagged(record)]) {
      const input: FenelType = { $opaque: { name: "Outer", pure } };
      expect(plan(input)).toEqual({ $tag: "RuntimeMemberUseRaw", _0: pure });
      expect(plan(input)._0).toBe(pureValueType(input, () => undefined));
    }
  });

  test("unselected structural roots retain the original declaration", () => {
    for (const input of [record, refined(record), tagged(record), { $unit: true } as FenelType]) {
      expect(plan(input)).toEqual({ $tag: "RuntimeMemberKeep" });
      expect(pureValueType(input, () => undefined)).toBeUndefined();
    }
  });

  test("references request one current-reader lookup without peeling its resolved wrappers", () => {
    for (const input of [{ $ref: "Captured" } as FenelType, tagged({ $ref: "Captured" }), refined({ $ref: "Captured" })]) {
      expect(plan(input)).toEqual({ $tag: "RuntimeMemberResolveRef", _0: "Captured" });
      expect(plan(opaque, true)).toEqual({ $tag: "RuntimeMemberUseRaw", _0: record });
      expect(pureValueType(input, () => opaque)).toBe(record);
      for (const resolved of [record, tagged(opaque), refined(opaque), { $ref: "Other" } as FenelType]) {
        expect(plan(resolved, true)).toEqual({ $tag: "RuntimeMemberKeep" });
        expect(pureValueType(input, () => resolved)).toBeUndefined();
      }
      expect(pureValueType(input, () => undefined)).toBeUndefined();
    }
  });

  test("root mu reentry retains substitution and the original recursive owner", () => {
    for (const input of [mu, refined(mu), tagged(mu)]) {
      const result = plan(input);
      expect(result.$tag).toBe("RuntimeMemberUnfold");
      expect(result._0).toBe(mu);
      const unfolded = unfold(result._0 as typeof mu & { $mu: { var: string; body: FenelType } });
      const expected = pureValueType(input, () => undefined);
      if (expected === undefined) throw new Error("legacy root mu control did not unfold");
      expect(unfolded).toEqual(expected);
      expect((unfolded as { $record: { fields: { type: FenelType }[] } }).$record.fields[0]!.type).toBe(mu);
    }
    expect(plan(mu, true)).toEqual({ $tag: "RuntimeMemberUnfold", _0: mu });
  });
});
