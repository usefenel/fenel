import { expect, test } from "bun:test";
import type { FenelType } from "@fenel/engine/types";
import { setExprToTag } from "@fenel/engine/set-marker";
import { definitionBundleToJsonWire, stringifyAuthoringJson } from "./authoring-json";

test("definition bundle HTTP body preserves an unbounded refinement", () => {
  const type = { $refined: { base: { $ref: "String" }, set: {
    $tag: "SePattern", pattern: { t: "rep", child: { t: "match", pred: { $tag: "SeAll" } }, min: 1, max: Infinity },
  } } } satisfies FenelType;
  const request = { ownerMutations: [{ kind: "upsert" as const, owner: {
    kind: "type" as const, ownerKey: "type:Words", storageName: "Words", definition: { id: "Words", type },
  } }] };
  const transmitted = JSON.parse(stringifyAuthoringJson(definitionBundleToJsonWire(request)));
  const set = transmitted.ownerMutations[0].owner.definition.type.$refined.set;
  expect(set.pattern.max).toBe("unbounded");
  expect(setExprToTag(set)).toEqual(type.$refined.set);
  expect(type.$refined.set.pattern.max).toBe(Infinity);
});

test("non-finite arbitrary data fails instead of being silently changed to null", () => {
  expect(() => stringifyAuthoringJson({ literal: { t: "rep", max: Infinity } })).toThrow("non-finite");
  expect(() => stringifyAuthoringJson({ value: NaN })).toThrow("non-finite");
  expect(() => stringifyAuthoringJson({ value: new Uint8Array([1, 2]) })).toThrow("Bytes slot");
  expect(() => stringifyAuthoringJson({ value: 123n })).toThrow("unsupported bigint");
  expect(() => stringifyAuthoringJson([undefined])).toThrow("absent list item");
  expect(() => stringifyAuthoringJson(new Array(1))).toThrow("absent list item");
  expect(JSON.parse(stringifyAuthoringJson({ literal: { t: "rep", max: "unbounded" } })))
    .toEqual({ literal: { t: "rep", max: "unbounded" } });
});
