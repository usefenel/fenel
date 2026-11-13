// @ts-nocheck -- Bun test harness is outside the Solid ambient tsconfig.
import { afterEach, describe, expect, test } from "bun:test";
import { flush } from "solid-js";
import { functionStore } from "./store";

afterEach(() => { functionStore.reset(); flush(); });

describe("function editor preserves authored bodies", () => {
  test("a storage rename preserves the canonical function identity", () => {
    functionStore.load({ id: "storage-row", functionId: "account:stable-function", name: "before", active: true, body: 7 });
    functionStore.setName("after");
    flush();
    expect(functionStore.serialize().id).toBe("account:stable-function");
    expect(functionStore.state.id).toBe("storage-row");
    expect(functionStore.serialize().body).toBe(7);
  });
  for (const body of [49, "Hello", true, false, null, [], { var: "who" },
    { call: ["add", 1, 2] }, { do: [{ let: { n: 5 } }, { var: "n" }] }]) {
    test(`unchanged and metadata-only saves preserve ${JSON.stringify(body)}`, () => {
      functionStore.load({ id: "stored-id", name: "constant", active: true, body });
      flush();
      expect(functionStore.serialize().body).toEqual(body);
      functionStore.setName("renamed");
      flush();
      expect(functionStore.serialize().body).toEqual(body);
    });
  }

  test("an absent body stays absent", () => {
    functionStore.load({ id: "stored-id", name: "declaration", active: true });
    flush();
    expect(Object.hasOwn(functionStore.serialize(), "body")).toBe(false);
  });

  test("body round trips retain static function requirements", () => {
    const requires = [{ class: "HasNetwork", args: [] }];
    functionStore.load({ id: "stored-id", name: "notify", active: true, body: null, requires });
    functionStore.setName("renamed");
    flush();
    expect(functionStore.serialize().requires).toEqual(requires);
  });

  test("literal code edits survive save and later metadata edits", () => {
    functionStore.load({ id: "stored-id", name: "constant", active: true, body: 49 });
    functionStore.replaceBody(false);
    functionStore.setActive(false);
    flush();
    expect(functionStore.serialize().body).toBe(false);
    expect(functionStore.bodyRequiresCode).toBe(true);
  });

  test("visual editing replaces only a safely represented program", () => {
    functionStore.load({ id: "stored-id", name: "notify", active: true,
      body: { do: [{ call: ["notify", { text: "before" }] }] } });
    flush();
    expect(functionStore.bodyRequiresCode).toBe(false);
    functionStore.updateStep([0], { type: "action", name: "notify", params: { text: "after" } });
    flush();
    expect(functionStore.serialize().body).toEqual({ do: [{ call: ["notify", { text: "after" }] }] });
  });

  test("native value edits cannot collide with the loaded step fingerprint", () => {
    for (const [before, after] of [[Infinity, null], [-0, 0], [NaN, null]]) {
      functionStore.load({ id: "stored-id", name: "notify", active: true, body: { do: [{ call: ["notify", { value: before }] }] } });
      functionStore.updateStep([0], { type: "action", name: "notify", params: { value: after } });
      flush();
      const value = functionStore.serialize().body.do[0].call[1].value;
      expect(Object.is(value, after)).toBe(true);
    }
  });

  test("return type edits replace the variant while preserving native bounds", () => {
    functionStore.load({ id: "stored-id", name: "typed", active: true, returns: { $ref: "Unit" }, body: null });
    flush();
    const type = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
    functionStore.setReturns(type);
    flush();
    expect(functionStore.serialize().returns).toEqual(type);
    expect(Object.hasOwn(functionStore.serialize().returns, "$ref")).toBe(false);
    functionStore.setName("renamed");
    flush();
    expect(functionStore.serialize().returns.$refined.set.pattern.max).toBe(Infinity);
    functionStore.setReturns({ $ref: "String" });
    flush();
    expect(functionStore.serialize().returns).toEqual({ $ref: "String" });
  });
});
