// @ts-nocheck -- Bun's test globals are outside the Solid ambient tsconfig.
import { describe, expect, test } from "bun:test";
import {
  desiredFieldFacetValues,
  fieldFacetDraftsForOccurrences,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  namedFieldId,
  namedFieldOccurrence,
  reconcileNamedFieldOccurrences,
} from "./model";

describe("field occurrence authoring boundary", () => {
  test("new named fields carry readable Codeable + explicit UUID ref", () => {
    const field = namedFieldOccurrence(
      "11111111-1111-4111-8111-111111111111",
      "billingEmail",
      { $ref: "String" },
    );
    expect(field.name).toBe("billingEmail");
    expect(field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: "11111111-1111-4111-8111-111111111111" },
    });
    expect(field.name).not.toBe(field.key && field.key.$tag === "NamedField" ? field.key.ref.$ref : "");
  });

  test("rename preserves the explicit identity", () => {
    const field = namedFieldOccurrence(
      "11111111-1111-4111-8111-111111111111",
      "billingEmail",
    );
    const renamed = { ...field, name: "invoiceEmail" };
    expect(renamed.key).toBe(field.key);
  });

  test("code insertion reserves exact identities before positional rename matching", () => {
    const first = namedFieldOccurrence(
      "11111111-1111-4111-8111-111111111111",
      "first",
    );
    const second = namedFieldOccurrence(
      "22222222-2222-4222-8222-222222222222",
      "second",
    );
    const next = reconcileNamedFieldOccurrences([first, second], [
      { codeName: "inserted", occurrenceType: { $ref: "Bool" } },
      { codeName: "first", occurrenceType: { $ref: "String" } },
      { codeName: "second", occurrenceType: { $ref: "Number" } },
    ]);

    expect(namedFieldId(next[1])).toBe(namedFieldId(first));
    expect(namedFieldId(next[2])).toBe(namedFieldId(second));
    expect(new Set(next.map(namedFieldId)).size).toBe(3);

    const retried = reconcileNamedFieldOccurrences(next, [
      { codeName: "inserted", occurrenceType: { $ref: "Bool" } },
      { codeName: "firstRenamed", occurrenceType: { $ref: "String" } },
      { codeName: "second", occurrenceType: { $ref: "Number" } },
    ]);
    expect(retried.map(namedFieldId)).toEqual(next.map(namedFieldId));
  });

  test("facet drafts marshal to canonical account authority", () => {
    expect(desiredFieldFacetValues({})).toBeUndefined();
    expect(desiredFieldFacetValues({
      "11111111-1111-4111-8111-111111111111": {
        Displayable: {
          typeName: "Displayable",
          args: ["11111111-1111-4111-8111-111111111111"],
          methods: { hint: { widget: "textarea" } },
          scope: { kind: "tag", tag: "ignored-ui-value" },
          priority: -1,
        },
      },
    })).toEqual([{
      fieldId: "11111111-1111-4111-8111-111111111111",
      typeName: "Displayable",
      methods: { hint: { widget: "textarea" } },
    }]);
  });

  test("forgetting a removed or reused field transfers facet authority instead of deleting facets", () => {
    const fieldId = "11111111-1111-4111-8111-111111111111";
    const retainedId = "22222222-2222-4222-8222-222222222222";
    const drafts = {
      [fieldId]: {},
      [retainedId]: {
        Labelable: {
          typeName: "Labelable",
          args: [retainedId],
          methods: { label: "Retained" },
        },
      },
    };

    // A present empty map means "replace all optional facets with none".
    expect(fieldFacetReplacementIds(drafts)).toEqual([fieldId, retainedId]);
    const forgotten = forgetFieldFacetDrafts(drafts, fieldId);
    expect(fieldFacetReplacementIds(forgotten)).toEqual([retainedId]);
    expect(desiredFieldFacetValues(forgotten)).toEqual([{
      fieldId: retainedId,
      typeName: "Labelable",
      methods: { label: "Retained" },
    }]);
    expect(forgetFieldFacetDrafts(forgotten, fieldId)).toBe(forgotten);
  });

  test("serialized code saves prune removed field facet replacement targets", () => {
    const removed = namedFieldOccurrence(
      "11111111-1111-4111-8111-111111111111",
      "removed",
    );
    const retained = namedFieldOccurrence(
      "22222222-2222-4222-8222-222222222222",
      "retained",
    );
    const drafts = {
      [namedFieldId(removed)!]: {},
      [namedFieldId(retained)!]: {},
    };
    expect(fieldFacetReplacementIds(
      fieldFacetDraftsForOccurrences(drafts, [retained]),
    )).toEqual([namedFieldId(retained)]);
  });
});
