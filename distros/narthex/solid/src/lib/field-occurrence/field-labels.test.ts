// @ts-nocheck -- Bun's test globals are outside the Solid ambient tsconfig.
// What a person types as a field or case name is a human label (Labelable);
// the code name is derived from it (Rom, 2026-11-08).
import { beforeAll, describe, expect, test } from "bun:test";
import { createRoot, flush } from "solid-js";
import {
  caseCodeNameFromLabel,
  desiredFieldFacetValues,
  loadFieldNaming,
  fieldCodeFollowsLabel,
  fieldLabelFacetText,
  fieldLabelInputValue,
  namedFieldOccurrence,
  relabelFieldOccurrence,
} from "./model";
import { createTypeDraft, typeDraftWithTypedName } from "../type-draft-save";

const ID = "11111111-1111-4111-8111-111111111111";

beforeAll(() => loadFieldNaming());

describe("a new field's name input (lane D, rehearsal Nov 8 22:30)", () => {
  test("typing \"name\" into a new field yields the label \"name\" and the code name \"name\"", () => {
    const field = namedFieldOccurrence(ID, "field1");
    // The input shows nothing to append to; the person types "name".
    const shown = fieldLabelInputValue(field, fieldLabelFacetText({}, ID), true);
    expect(shown).toBe("");
    const typed = shown + "name";
    const next = relabelFieldOccurrence(field, {}, typed, fieldCodeFollowsLabel(field, fieldLabelFacetText({}, ID)));
    expect(fieldLabelFacetText(next.facets, ID)).toBe("name");
    expect(next.field.name).toBe("name");
    // Once named, the input shows its label.
    expect(fieldLabelInputValue(next.field, fieldLabelFacetText(next.facets, ID), true)).toBe("name");
  });

  test("an existing field without a label still shows its code name", () => {
    expect(fieldLabelInputValue(namedFieldOccurrence(ID, "amount"), undefined, false)).toBe("amount");
  });

  test("the editor's label input reads through this value, on input and on refusal", async () => {
    const source = await Bun.file(new URL("./FieldOccurrenceEditorBase.tsx", import.meta.url)).text();
    expect(source).toContain("value={labelInputValue()}");
    expect(source).toContain("event.currentTarget.value = labelInputValue();");
    expect(source).toContain("fieldLabelInputValue(props.field, labelText(), newField() && !codeEdited())");
  });
});

describe("typed field names are labels", () => {
  test("a typed \"Amount paid\" is the Labelable label and derives the code name amountPaid", () => {
    const field = namedFieldOccurrence(ID, "field1");
    const next = relabelFieldOccurrence(field, {}, "Amount paid", fieldCodeFollowsLabel(field, undefined));
    expect(next.field.name).toBe("amountPaid");
    expect(next.field.key).toEqual(field.key);
    expect(next.field.label).toEqual({ $tag: "Nothing" });
    expect(fieldLabelFacetText(next.facets, ID)).toBe("Amount paid");
    expect(desiredFieldFacetValues({ [ID]: next.facets })).toEqual([
      { fieldId: ID, typeName: "Labelable", methods: { label: "Amount paid" } },
    ]);
  });

  test("a typed \"amount\" is the label \"amount\" and the code name \"amount\"", () => {
    const field = namedFieldOccurrence(ID, "field1");
    const next = relabelFieldOccurrence(field, {}, "amount", true);
    expect(next.field.name).toBe("amount");
    expect(fieldLabelFacetText(next.facets, ID)).toBe("amount");
  });

  test("typing letter by letter keeps the code name following the label", () => {
    let field = namedFieldOccurrence(ID, "field1");
    let facets = {};
    for (const text of ["A", "Am", "Amount", "Amount ", "Amount p", "Amount paid"]) {
      const next = relabelFieldOccurrence(field, facets, text, fieldCodeFollowsLabel(field, fieldLabelFacetText(facets, ID)));
      field = next.field; facets = next.facets;
    }
    expect(field.name).toBe("amountPaid");
    expect(fieldLabelFacetText(facets, ID)).toBe("Amount paid");
  });

  test("relabelling keeps the code name once it no longer follows (an existing field, or an edited code name)", () => {
    const field = namedFieldOccurrence(ID, "amt");
    expect(fieldCodeFollowsLabel(field, "Amount")).toBe(false);
    const next = relabelFieldOccurrence(field, {}, "Amount paid", false);
    expect(next.field).toBe(field);
    expect(fieldLabelFacetText(next.facets, ID)).toBe("Amount paid");
  });

  test("a cleared label removes the Labelable facet", () => {
    const field = namedFieldOccurrence(ID, "amount");
    const labelled = relabelFieldOccurrence(field, {}, "amount", false).facets;
    expect(fieldLabelFacetText(relabelFieldOccurrence(field, labelled, "", false).facets, ID)).toBeUndefined();
  });

  test("a typed case name derives a constructor code name", () => {
    expect(caseCodeNameFromLabel("Paid in cash")).toBe("PaidInCash");
    expect(caseCodeNameFromLabel("pending")).toBe("Pending");
  });

  test("the type draft saves the typed label as the field's Labelable facet and the derived code name", async () => {
    const bundles = [];
    const host = {
      reconcile: (scheme, nextBody) => ({ ok: true, scheme: { ...scheme, body: nextBody } }),
      assertAppearanceDrafts: () => {},
      saveDefinition: async (bundle) => { bundles.push(bundle); return {}; },
      typesChanged: () => {},
      add: async () => true,
      newId: () => "type-1",
      resurrections: () => ({ fieldIds: () => [], onChange: () => {}, clear: () => {} }),
    };
    let dispose;
    const draft = createRoot((d) => { dispose = d; return createTypeDraft(host); });
    const field = namedFieldOccurrence(ID, "field1");
    const typed = relabelFieldOccurrence(field, {}, "Amount paid", fieldCodeFollowsLabel(field, undefined));
    draft.setReps({ Codeable: { codeName: "Transaction" } });
    draft.changeTypeShape({ $record: { fields: [typed.field] } });
    draft.changeFieldFacet(ID, typed.facets);
    flush();
    expect(await draft.save()).toBe(true);
    dispose();
    const owner = bundles[0].ownerMutations[0].owner;
    expect(owner.definition.type.$record.fields[0].name).toBe("amountPaid");
    expect(owner.definition.type.$record.fields[0].label).toEqual({ $tag: "Nothing" });
    expect(bundles[0].desiredFacets).toEqual([{ fieldId: ID, typeName: "Labelable", methods: { label: "Amount paid" } }]);
    expect(bundles[0].replaceFacetFieldIds).toEqual([ID]);
  });

  test("a typed type name is the type's Labelable label and derives its Codeable", () => {
    const write = (d, t, m, x) => ({ ...d, [t]: { ...(d[t] ?? {}), [m]: x } });
    let reps = {};
    for (const text of ["B", "Bank", "Bank ", "Bank transaction"]) reps = typeDraftWithTypedName(reps, text, write);
    expect(reps).toEqual({ Labelable: { label: "Bank transaction" }, Codeable: { codeName: "BankTransaction" } });
    expect(typeDraftWithTypedName({}, "Person", write)).toEqual({ Labelable: { label: "Person" }, Codeable: { codeName: "Person" } });
    // A Codeable edited on its own no longer follows the label.
    const edited = { Labelable: { label: "Bank transaction" }, Codeable: { codeName: "Txn" } };
    expect(typeDraftWithTypedName(edited, "Bank transfer", write).Codeable).toEqual({ codeName: "Txn" });
  });
});
