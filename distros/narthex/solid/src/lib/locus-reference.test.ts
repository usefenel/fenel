import { describe, expect, test } from "bun:test";
import { followLocusPath } from "./locus-reference";

const reference = (id: string) => ({ $pin: "function", name: id, id });
describe("following a reference in the recursive locus", () => {
  test("follows the referent, including references encountered inside a path", () => {
    const targets = new Map<string, unknown>([
      ["f", { body: { nested: reference("g") } }],
      ["g", { body: [1, 2] }],
    ]);
    const result = followLocusPath(reference("f"), ["body", "nested", "body", 1],
      ref => targets.has(ref.id) ? { value: targets.get(ref.id) } : undefined);
    expect(result.value).toBe(2);
    expect(result.references.map(ref => ref.id)).toEqual(["f", "g"]);
    expect(result.followed).toBe(true);
  });
  test("does not turn an unavailable account reference into an empty value", () => {
    expect(() => followLocusPath(reference("private"), [], () => undefined)).toThrow(/not available in this account/);
  });
  test("a valid undefined referent differs from a missing reference", () => {
    expect(followLocusPath(reference("nothing"), [], () => ({ value: undefined })).value).toBeUndefined();
  });
  test("cycles terminate without recursively expanding a graph", () => {
    expect(() => followLocusPath(reference("a"), [], ref => ({ value: reference(ref.id === "a" ? "b" : "a") })))
      .toThrow(/leads back to itself/);
  });
  test("ordinary containers are unchanged and unrelated references stay unevaluated", () => {
    const data = { a: [1, 2], unused: reference("private") };
    expect(followLocusPath(data, ["a"], () => { throw new Error("unexpected resolution"); }))
      .toEqual({ value: [1, 2], followed: false, references: [] });
  });
  test("canonical Fenel references follow the same account-scoped path as legacy pins", () => {
    const targets = new Map<string, unknown>([
      ["f", { body: { nested: { $ref: "g" } } }],
      ["g", { body: [1, 2] }],
    ]);
    const result = followLocusPath({ $ref: "f" }, ["body", "nested", "body", 1],
      ref => targets.has(ref.id) ? { value: targets.get(ref.id) } : undefined);
    expect(result.value).toBe(2);
    expect(result.references.map(ref => ref.id)).toEqual(["f", "g"]);
  });
  test("missing canonical references fail and mixed-encoding cycles terminate", () => {
    expect(() => followLocusPath({ $ref: "private" }, [], () => undefined)).toThrow(/not available in this account/);
    expect(() => followLocusPath({ $ref: "a" }, [], () => ({ value: reference("a") }))).toThrow(/leads back to itself/);
  });
  test("a reference can be revisited after a finite path step without expanding its whole graph", () => {
    const target = { value: 42, next: { $ref: "node" } };
    const result = followLocusPath({ $ref: "node" }, ["next", "value"], () => ({ value: target }));
    expect(result.value).toBe(42);
    expect(result.references).toHaveLength(2);
  });
  test("admitted functions remain semantic callable references instead of registry records", () => {
    const definition = { id: "f", body: { var: "x" }, params: [{ name: "x" }], returns: { $ref: "a" } };
    for (const value of [reference("f"), { $ref: "f" }]) {
      const result = followLocusPath(value, [], () => ({ value: definition, kind: "function" }));
      expect(result.value).toBe(value);
      expect(result.followed).toBe(true);
      expect(result.references.map(ref => ref.id)).toEqual(["f"]);
      for (const field of ["body", "id", "params", "returns"])
        expect(() => followLocusPath(value, [field], () => ({ value: definition, kind: "function" })))
          .toThrow(/function has no data fields/);
    }
  });
  test("functions encountered in a record stay callable while type references still expose their type", () => {
    const root = { apply: { $ref: "f" }, type: { $ref: "Pair" } };
    const resolve = (ref: { id: string }) => ref.id === "f"
      ? { value: { id: "f", body: 1, params: [], returns: { $unit: true } }, kind: "function" }
      : { value: { $record: { fields: [] } }, kind: "type" };
    expect(followLocusPath(root, ["apply"], resolve).value).toBe(root.apply);
    expect(followLocusPath(root, ["type"], resolve).value).toEqual({ $record: { fields: [] } });
  });
});
