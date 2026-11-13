import { describe, expect, test } from "bun:test";
import { fieldRecordSlotsPlan, fieldRecordSlotPlan, fieldRecordEditPlan } from "./field-render";
import { dispatchEngineBody, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";
import { Just, Nothing } from "../type-foundation";

const underSource = work => withInterpretedCompiledArtifacts(work);
const caller = names => ({ _constructors: { RecordCase: names } });

describe("batched existing record-slot source owner", () => {
  test("matches each existing slot result in request order, including duplicates and missing slots", () => underSource(() => {
    const shared = { exact: "retained" }, value = { $tag: "RecordCase", title: shared, _1: 7, extra: false };
    const frame = caller(["title", "count"]), fields = ["title", "count", "missing", "$tag", "title"];
    const result = fieldRecordSlotsPlan(value, fields, frame);
    expect(result).toEqual(fields.map(field => ({ field, slot: fieldRecordSlotPlan(value, field, frame) })));
    expect(result.map(entry => entry.field)).toEqual(fields);
    expect(result[0].slot._0.value._0).toBe(shared);
    expect(result[2].slot._0.value).toEqual(Nothing);
    expect(result[1].slot._0.wire).toBe("_1");
    expect(fields).toEqual(["title", "count", "missing", "$tag", "title"]);
  }), 60_000);

  test("retains named, ordinal, nullary and literal-record spelling behavior", () => underSource(() => {
    const frame = caller(["title", "count"]);
    for (const [value, wire] of [
      [{ $tag: "RecordCase", title: "named", count: 2 }, "title"],
      [{ $tag: "RecordCase", _0: "ordinal", _1: 2 }, "_0"],
    ]) {
      const result = fieldRecordSlotsPlan(value, ["title", "$tag"], frame);
      expect(result[0].slot._0.wire).toBe(wire);
      expect(result[1].slot._0.value).toEqual(Just("RecordCase"));
    }
    const literal = { _0: "ordinary dictionary key", kind: "Visible" };
    const plain = fieldRecordSlotsPlan(literal, ["title", "_0", "kind"], frame);
    expect(plain[0].slot._0.value).toEqual(Nothing);
    expect(plain[1].slot._0.value).toEqual(Just("ordinary dictionary key"));
    expect(plain[2].slot._0.value).toEqual(Just("Visible"));
    expect(fieldRecordSlotsPlan({ $tag: "Empty" }, ["$tag"], { _constructors: { Empty: [] } })[0].slot._0.value).toEqual(Just("Empty"));
    expect(fieldRecordSlotsPlan(null, [], frame)).toEqual([]);
  }), 60_000);

  test("uses the caller's captured declaration and keeps malformed declarations unregistered", () => underSource(() => {
    const value = { $tag: "RecordCase", _0: "first", _1: "second" };
    expect(fieldRecordSlotsPlan(value, ["title"], caller(["title", "count"]))[0].slot._0).toMatchObject({ wire: "_0", value: Just("first") });
    expect(fieldRecordSlotsPlan(value, ["title"], caller(["count", "title"]))[0].slot._0).toMatchObject({ wire: "_1", value: Just("second") });
    for (const names of [[, "title"], ["title", 7], "not a declaration"]) {
      const result = fieldRecordSlotsPlan(value, ["title"], caller(names));
      expect(result[0].slot._0).toMatchObject({ wire: "title", value: Nothing });
    }
  }), 60_000);

  test("preserves complete-record ambiguity refusals for every requested field", () => underSource(() => {
    const duplicateNames = fieldRecordSlotsPlan({ $tag: "RecordCase", title: "a" }, ["title", "missing"], caller(["title", "title"]));
    expect(duplicateNames.every(entry => entry.slot.$tag === "Err")).toBe(true);
    const duplicateWires = { $tag: "RecordCase", title: "a", count: 1, _1: 2 };
    const frame = caller(["title", "count"]);
    const result = fieldRecordSlotsPlan(duplicateWires, ["title", "$tag", "missing"], frame);
    expect(result).toEqual(["title", "$tag", "missing"].map(field => ({ field, slot: fieldRecordSlotPlan(duplicateWires, field, frame) })));
    expect(result.every(entry => entry.slot.$tag === "Err")).toBe(true);
  }), 60_000);

  test("empty batches and unusual declared wire names retain single-owner results", () => underSource(() => {
    const cases = [
      [null, ["title", "title"]],
      [{ $tag: "RecordCase", title: "named", _0: "duplicate" }, ["title"]],
      [{ $tag: "RecordCase", _0: "first", _1: "second" }, ["_0", "title"]],
      [{ $tag: "RecordCase", title: "first", _0: "second" }, ["title", "_0"]],
      [{ $tag: "RecordCase", _0: "first" }, [, "title"]],
    ];
    for (const [value, names] of cases) {
      const frame = caller(names);
      expect(fieldRecordSlotsPlan(value, [], frame)).toEqual([]);
      const fields = ["title", "_0", "_1", "missing", "title"];
      expect(fieldRecordSlotsPlan(value, fields, frame)).toEqual(fields.map(field => ({ field, slot: fieldRecordSlotPlan(value, field, frame) })));
    }
  }), 60_000);

  test("batch source pays the declaration scan once plus each admitted lookup", () => underSource(() => {
    let reads = 0;
    const names = ["first", "second", "third", "fourth", "fifth", "sixth"];
    const observed = names.map((name, index) => new Proxy({ $tag: "RepresentationOwnField", name, value: index }, {
      get(target, key, receiver) { if (key === "name") reads++; return Reflect.get(target, key, receiver); },
      getOwnPropertyDescriptor(target, key) { if (key === "name") reads++; return Reflect.getOwnPropertyDescriptor(target, key); },
    }));
    const snapshot = { $tag: "SnapshotRecord", _0: observed }, declared = Just(names), fields = ["first", "second", "first", "third"];
    const measure = work => { reads = 0; const result = work(); return { result, reads }; };
    const validation = measure(() => dispatchEngineBody("engine:fieldRecordValidatePlan", [snapshot, declared]));
    const admitted = measure(() => fields.map(field => dispatchEngineBody("engine:fieldRecordAdmittedSlotPlan", [snapshot, declared, field])));
    const batch = measure(() => dispatchEngineBody("engine:fieldRecordSlotsPlan", [snapshot, declared, fields]));
    const separate = measure(() => fields.map(field => dispatchEngineBody("engine:fieldRecordSlotPlan", [snapshot, declared, field])));
    expect(validation.result.$tag).toBe("Ok"); expect(validation.reads).toBeGreaterThan(0);
    expect(batch.result).toEqual(fields.map((field, index) => ({ field, slot: admitted.result[index] })));
    expect(batch.result.map(entry => entry.slot)).toEqual(separate.result);
    expect(batch.reads).toBe(validation.reads + admitted.reads);
    expect(separate.reads).toBe(fields.length * validation.reads + admitted.reads);
    expect(batch.reads).toBeLessThan(separate.reads);
  }), 60_000);

  test("unreadable fields refuse without executing accessors", () => underSource(() => {
    let reads = 0;
    const value = { $tag: "RecordCase" };
    Object.defineProperty(value, "_0", { enumerable: true, get() { reads++; return "must not read"; } });
    const result = fieldRecordSlotsPlan(value, ["title", "$tag", "missing"], caller(["title"]));
    expect(result.every(entry => entry.slot.$tag === "Err")).toBe(true);
    expect(reads).toBe(0);
    for (const malformed of [null, 7, [], new Date()]) expect(fieldRecordSlotsPlan(malformed, ["title"], caller(["title"]))[0].slot.$tag).toBe("Err");
  }), 60_000);

  test("existing edit uses its returned physical wire and preserves unrelated source data", () => underSource(() => {
    const shared = { retained: true }, value = { $tag: "RecordCase", _0: "before", extra: shared }, frame = caller(["title"]);
    const slot = fieldRecordSlotsPlan(value, ["title"], frame)[0].slot;
    const changed = fieldRecordEditPlan(value, "title", "after", frame);
    expect(changed.$tag).toBe("Ok"); expect(changed._0[slot._0.wire]).toBe("after");
    expect(changed._0.extra).toBe(shared); expect(Object.hasOwn(changed._0, "title")).toBe(false);
    expect(value._0).toBe("before");
  }), 60_000);
});

test("batch adapter observes its descriptor snapshot and declaration exactly once", async () => {
  const text = await Bun.file(new URL("./field-render.ts", import.meta.url)).text();
  const begin = text.indexOf("export function fieldRecordSlotsPlan("), end = text.indexOf("export function fieldRecordEditPlan(", begin);
  if (begin < 0 || end < begin) throw new Error("Record slot adapter boundary moved.");
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(text.slice(begin, end)).replace(/^export /gm, "");
  const value = {}, frame = {}, snapshot = {}, declaration = {}, result = [], observations = [];
  const batch = new Function("representationValueSnapshot", "fieldRecordDeclaration", "dispatchEngineBody", `${code}; return fieldRecordSlotsPlan;`)(
    supplied => { observations.push(["snapshot", supplied]); return snapshot; },
    (supplied, caller) => { observations.push(["declaration", supplied, caller]); return declaration; },
    (name, args, caller) => { observations.push(["source", name, args, caller]); return result; });
  const fields = Object.freeze(["title", "count", "title"]);
  expect(batch(value, fields, frame)).toBe(result);
  expect(observations).toEqual([["snapshot", value], ["declaration", value, frame],
    ["source", "engine:fieldRecordSlotsPlan", [snapshot, declaration, fields], frame]]);
  expect(observations[2][2][2]).not.toBe(fields);
});
