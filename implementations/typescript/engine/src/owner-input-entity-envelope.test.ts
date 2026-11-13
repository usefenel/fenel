import { expect, test } from "bun:test";
import { captureCanonicalModuleDelivery, projectCanonicalModuleEnvelope } from "./owner-input-entity-envelope";

// B3 request fixture only. Integration must obtain this record from the actual
// captured Fenel body; this unit test confers no source-category authority.
const fields = { name: true, entities: true, fieldFacetDirectives: true };
const moduleData = () => ({ name: "Example", entities: [{ id: "ExampleType", type: { $ref: "String" } }],
  functions: [{ id: "Example:f", body: { var: "x" } }] });

test("producer capture and cold capture share one complete own-field envelope operation", () => {
  const producerSource = moduleData();
  const captured = captureCanonicalModuleDelivery(producerSource);
  Object.freeze(producerSource);
  const producer = projectCanonicalModuleEnvelope(captured, fields);
  const cold = projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery(moduleData()), fields);
  expect(producer).toEqual(cold);
  expect((producer as Record<string, unknown>).fieldFacetDirectives).toEqual({ present: false });
  expect((producer as Record<string, unknown>).name).toEqual({ present: true, value: "Example",
    enumerable: true, configurable: true, writable: true });
});

test("later source mutation cannot rewrite the producer's canonical envelope", () => {
  const source = moduleData();
  const captured = captureCanonicalModuleDelivery(source);
  source.entities[0]!.id = "Changed";
  source.functions[0]!.body.var = "changed";
  expect(projectCanonicalModuleEnvelope(captured, fields)).toEqual(
    projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery(moduleData()), fields));
});

test("absence, own undefined and empty facet arrays remain distinct", () => {
  const absent = projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery(moduleData()), fields);
  const undefinedOwn = projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery({ ...moduleData(), fieldFacetDirectives: undefined }), fields);
  const emptyOwn = projectCanonicalModuleEnvelope(captureCanonicalModuleDelivery({ ...moduleData(), fieldFacetDirectives: [] }), fields);
  expect(absent).not.toEqual(undefinedOwn);
  expect(undefinedOwn).not.toEqual(emptyOwn);
  expect(absent).not.toEqual(emptyOwn);
});

test("getters, exotic roots and unreadable field requests refuse without getter invocation", () => {
  let reads = 0;
  const source = moduleData();
  Object.defineProperty(source, "entities", { get() { reads++; return []; } });
  expect(() => captureCanonicalModuleDelivery(source)).toThrow();
  expect(() => captureCanonicalModuleDelivery(new Date(0))).toThrow();
  const request = { ...fields };
  Object.defineProperty(request, "name", { get() { reads++; return true; } });
  const captured = captureCanonicalModuleDelivery(moduleData());
  for (const bad of [request, { name: false }, { name: 1 }, [], Object.create({ name: true })]) {
    expect(() => projectCanonicalModuleEnvelope(captured, bad)).toThrow();
  }
  expect(reads).toBe(0);
});
