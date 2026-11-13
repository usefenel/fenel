import { expect, test } from "bun:test";
import {
  identifiedDefinitionView,
  normalizeFieldDeclarations,
} from "./field-identity";
import type { FenelFunction, FenelType, FieldDef } from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };

function field(name: string, type: FenelType): FieldDef {
  return { name, type, label: Nothing, ui: Nothing, meta: {} };
}

function template(name: string) {
  return {
    kind: "type" as const,
    realm: "repository-source" as const,
    entity: {
      id: name,
      module: "matrix",
      params: ["a"],
      type: {
        $opaque: {
          name,
          pure: { $record: { fields: [field("value", { $var: "a" })] } },
        },
      } satisfies FenelType,
    },
  };
}

test("identified view consumes exact root tokens when one carrier object occurs in hostile function order", () => {
  const sharedCarrier = field("value", StringT);
  const use = (name: string): FenelType => ({
    $opaque: {
      name,
      pure: { $record: { fields: [sharedCarrier] } },
    },
  });

  // Intentionally insert `returns` before `params`. The semantic declaration
  // marshaller always visits params first; a generic clone-order/object roster
  // therefore swaps A/B, while the exact token→locator plan cannot.
  const fn = {
    id: "matrix:hostileOrder",
    returns: use("B"),
    params: [field("arg", use("A"))],
  } satisfies FenelFunction;
  const collection = normalizeFieldDeclarations([
    template("A"),
    template("B"),
    { kind: "function", realm: "repository-source", module: "matrix", fn },
  ], { mode: "source-handles" });

  const view = identifiedDefinitionView(fn, collection.viewPlans[2]!);
  const paramType = view.params[0]!.type;
  const returnType = view.returns;
  if (!("$opaque" in paramType) || !("$opaque" in returnType)) {
    throw new Error("expected nominal function carriers");
  }
  const paramPure = paramType.$opaque.pure;
  const returnPure = returnType.$opaque.pure;
  if (paramPure === undefined || returnPure === undefined
    || !("$record" in paramPure) || !("$record" in returnPure)) {
    throw new Error("expected record carrier representations");
  }

  expect(paramPure.$record.fields[0]!.key).toEqual({
    $tag: "NamedField",
    ref: { $ref: "field:type%3Amatrix%3AA/named%3Avalue" },
  });
  expect(returnPure.$record.fields[0]!.key).toEqual({
    $tag: "NamedField",
    ref: { $ref: "field:type%3Amatrix%3AB/named%3Avalue" },
  });
  expect("key" in sharedCarrier).toBe(false);
});

test("an exact explicit source-handle carrier receives the template's final locked UUID", () => {
  const sourceHandle =
    "field:type%3Amatrix%3AExplicitHandleCarrier/named%3Avalue";
  const uuid = "20000000-0000-4000-8000-000000000099";
  const sourceKey = {
    $tag: "NamedField" as const,
    ref: { $ref: sourceHandle },
  };
  const templateField = { ...field("value", { $var: "a" }), key: sourceKey };
  const actualField = { ...field("value", StringT), key: sourceKey };
  const consumerType = {
    $opaque: {
      name: "ExplicitHandleCarrier",
      pure: { $record: { fields: [actualField] } },
    },
  } satisfies FenelType;
  const collection = normalizeFieldDeclarations([
    {
      kind: "type",
      realm: "repository-source",
      entity: {
        id: "ExplicitHandleCarrier",
        module: "matrix",
        params: ["a"],
        type: {
          $opaque: {
            name: "ExplicitHandleCarrier",
            pure: { $record: { fields: [templateField] } },
          },
        },
      },
    },
    {
      kind: "type",
      realm: "repository-source",
      entity: {
        id: "ExplicitHandleConsumer",
        module: "matrix",
        type: consumerType,
      },
    },
  ], {
    mode: "strict-embedded",
    lock: new Map([[sourceHandle, uuid]]),
  });

  expect(collection.attachments[0]?.field.key).toEqual({
    $tag: "NamedField",
    ref: { $ref: uuid },
  });
  const view = identifiedDefinitionView(consumerType, collection.viewPlans[1]!);
  if (!("$opaque" in view) || view.$opaque.pure === undefined
    || !("$record" in view.$opaque.pure)) {
    throw new Error("expected explicit nominal carrier view");
  }
  expect(view.$opaque.pure.$record.fields[0]!.key).toEqual({
    $tag: "NamedField",
    ref: { $ref: uuid },
  });
  expect(actualField.key).toEqual(sourceKey);
});
