import { describe, expect, test } from "bun:test";
import { projectReaderTypePreviewInSession } from "./reader-presentation";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry";
import { Nothing, Result, Str } from "@fenel/engine/type-foundation";
import { unfold } from "@fenel/engine/set-algebra";

// Actual Fenel syntax walker, projector, type details and printer over a small
// captured reader. The registry/field read ports are inert fixtures, not a new
// checked-registry build. Preview syntax carries no admission evidence.
const field = (name, type, key) => ({ name, type, ...(key ? { key } : {}), label: Nothing, ui: Nothing, meta: {} });
function fixture() {
  let reads = 0;
  const namedField = "b1000000-0000-4000-8000-000000000011";
  const registry = {
    getIdentifiedEntity(name) {
      reads++;
      // A new carrier at every acquisition reproduces the object-identity
      // trap without changing the captured declaration denoted by this ref.
      if (name === "AliasA") return { id: name, type: { $ref: "AliasB" } };
      if (name === "AliasB") return { id: name, type: { $record: { fields: [
        field("next", { $ref: "AliasA" }),
        field("wireTitle", Str, { $tag: "NamedField", ref: { $ref: namedField } }),
      ] } } };
      if (name === "String") return { id: name, type: { $opaque: { name: "String", pure: { $variant: {
        cases: [{ name: "EmptyText", fields: [] }, { name: "TextCharacters", fields: [field("characters", { $var: "CharSequence" })] }],
      } } } } };
      return undefined;
    },
    getFunction: () => undefined,
    getEntityNominalIdentity: name => name === "AliasA" || name === "AliasB" ? "physical-alias-owner" : undefined,
    getUuid: () => undefined,
    getFieldRepresentation(typeName, identity) {
      return typeName === "Labelable" && identity === namedField ? { methods: { label: { fr: "Titre", en: "Human field title" } } } : undefined;
    },
  };
  const session = { registry, environment: { catalog: { referenceRoutes: [], exactConstructorRoutes: [], patternConstructors: [] },
    resolveTypeRef: () => undefined }, evaluateContext: {} };
  return { registry, session, source: { catalog: [], types: [], functionRows: [] }, reads: () => reads };
}

function assertRenderedClosure(packet) {
  const rows = new Map(packet.rows.map(row => [row.type, row]));
  const labels = new Map(packet.fieldLabels.map(row => [row.field, row.label]));
  const inspected = new Set();
  const visit = type => {
    if (inspected.has(type)) return;
    inspected.add(type);
    const row = rows.get(type);
    expect(row).toBeDefined();
    expect(row.description.type).toBe(type);
    expect(row.presentation.type).toBe(type);
    const shape = row.description.previewShape;
    expect(shape).toBeDefined();
    const fields = "$record" in shape ? shape.$record.fields : "$arrow" in shape ? shape.$arrow.params
      : "$variant" in shape && shape.$variant.cases.length === 1 ? shape.$variant.cases[0].fields ?? [] : [];
    for (const child of fields) { expect(labels.has(child)).toBe(true); visit(child.type); }
    if ("$arrow" in shape) visit(shape.$arrow.returns);
    if ("$variant" in shape && shape.$variant.cases.length !== 1) {
      expect(row.caseRecords).toHaveLength(shape.$variant.cases.length);
      for (const [index, record] of row.caseRecords.entries()) {
        expect(record.$record.fields).toBe(shape.$variant.cases[index].fields);
        visit(record);
      }
    }
  };
  visit(packet.root);
  return { rows, labels };
}

describe("actual reader type preview syntax owners", () => {
  test("fresh recursive aliases terminate and every displayed field remains in the transported graph", () => {
    const h = fixture(), root = { $ref: "AliasA" };
    const packet = projectReaderTypePreviewInSession(root, h.session, "registry", h.source, ["type", "stack"]);
    expect(packet.root).toBe(root);
    expect(packet.rows.length).toBeLessThan(40);
    expect(h.reads()).toBeLessThan(300);
    const graph = assertRenderedClosure(packet);
    expect([...graph.labels.values()]).toContain("Human field title");
    const wire = structuredClone(registryTransportSnapshot(packet, "actual preview packet"));
    assertRenderedClosure(wire);
    expect(wire.root).not.toBe(root);
    expect(wire.rows[0].type).toBe(wire.root);
    // Opening the declaration retains its original nominal handle; the record
    // is a read shape and never replaces the type held by the occurrence.
    expect(wire.rows[0].presentation.type).toEqual({ $ref: "AliasA" });
    expect(wire.rows[0].description.previewShape).not.toEqual(wire.root);
  }, 60_000);

  test("nested variants, arrows, Result returns, native wrappers and unresolved types retain their owners", () => {
    const h = fixture();
    const result = Result(Str, Str);
    const root = { $arrow: { params: [field("input", { $ref: "AliasA" })], returns: { $variant: { cases: [
      { name: "Ready", fields: [field("format", { $arrow: { params: [field("value", Str)], returns: result } })] },
      { name: "Waiting", fields: [field("future", { $ref: "Unresolved" })] },
    ] } } } };
    const packet = projectReaderTypePreviewInSession(root, h.session, "session", h.source, ["type", "stack"]);
    const graph = assertRenderedClosure(packet);
    expect(graph.rows.get(result).presentation.label).toBe("Result String String");
    expect(graph.rows.get(result).description.code).toBe("Result String String");
    const missing = packet.rows.find(row => row.type.$ref === "Unresolved");
    expect(missing.description.previewShape).toBe(missing.type);
    expect(missing.presentation.type).toEqual({ $ref: "Unresolved" });
    expect(graph.rows.get(Str).presentation.type).toBe(Str);
    expect(graph.rows.get(Str).description.previewShape).toBeDefined();
    assertRenderedClosure(structuredClone(registryTransportSnapshot(packet, "actual nested preview packet")));
  }, 60_000);

  test("unkeyed draft fields are syntax while malformed type carriers refuse", () => {
    const h = fixture(), draft = { $record: { fields: [field("draftField", { $unit: true })] } };
    expect(projectReaderTypePreviewInSession(draft, h.session, "registry", h.source, []).fieldLabels[0].label).toBe("draftField");
    for (const malformed of [{ $unit: false }, { $ref: 17 }, { notAType: true }]) {
      expect(() => projectReaderTypePreviewInSession(malformed, h.session, "registry", h.source, [])).toThrow("invalid type carrier");
    }
  }, 60_000);

  test("direct and differently named nested mu binders keep finite read edges", () => {
    const h = fixture();
    const direct = { $mu: { var: "Self", body: { $variant: { cases: [
      { name: "Stop", fields: [], label: Nothing },
      { name: "More", fields: [field("next", { $var: "Self" })], label: Nothing },
    ] } } } };
    const inner = { $mu: { var: "B", body: { $record: { fields: [field("outer", { $var: "A" })] } } } };
    const nested = { $mu: { var: "A", body: { $record: { fields: [field("inner", inner)] } } } };
    const innerView = unfold(nested).$record.fields[0].type;
    expect(unfold(innerView).$record.fields[0].type).toBe(nested);
    for (const root of [direct, nested]) {
      const packet = projectReaderTypePreviewInSession(root, h.session, "registry", h.source, []);
      expect(packet.rows.length).toBeLessThan(40);
      expect(packet.root).toBe(root);
      expect(packet.rows[0].description.previewShape).not.toBe(root);
      assertRenderedClosure(packet);
      assertRenderedClosure(structuredClone(registryTransportSnapshot(packet, "actual recursive preview packet")));
    }
  }, 60_000);
});
