import { describe, expect, test } from "bun:test";
import type { FieldDef, FenelType } from "./types";
import { canonical } from "./locale";
import { getSystemRegistry } from "./system-registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import { fieldEditPlan } from "./authoring/field-render";
import { formSessionPlan } from "./authoring/form-runtime";
import { fenelTypeToJsonSchema, formToJsonSchema } from "./json-schema";
import { validate } from "./validate";
import { buildTelegramFormSteps } from "./telegram-form";
import {
  createSurfaceEnvironment,
  defaultListDisplayForType,
} from "./authoring/surface";

const registry = getSystemRegistry();

function identifiedField(entityId: string, fieldName: string): FieldDef {
  const type = registry.getIdentifiedEntity(entityId)?.type;
  if (!type || !("$record" in type)) throw new Error(`missing record ${entityId}`);
  const field = type.$record.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`missing field ${entityId}.${fieldName}`);
  return field;
}

describe("identified field product readers", () => {
  test("field/form plans and widget hints consume the UUID presentation view", () => {
    const field = identifiedField("function", "function");
    const edit = fieldEditPlan({ registry, field });
    expect(edit.label).toBe("Spec");
    expect(edit.helpText).toBe("FenelFunction spec — params, returns, body");

    const session = formSessionPlan({ registry, fields: [field] });
    expect(session.fields[0]?.label).toBe("Spec");
    expect(field.label).toEqual({ $tag: "Nothing" });
    expect(field.ui).toEqual({ $tag: "Nothing" });
  });

  test("JSON schema and validation messages use the UUID label/display", () => {
    const field = identifiedField("function", "function");
    const type: FenelType = { $record: { fields: [field] } };
    const schema = formToJsonSchema([field], { registry });
    expect(schema.properties?.function?.title).toBe("Spec");
    expect(schema.properties?.function?.description)
      .toBe("FenelFunction spec — params, returns, body");
    expect(validate(type, {}, null, { registry }).errors[0]?.message).toBe("Spec is required");
  });

  test("nested record and variant readers retain the explicit registry", () => {
    const pageType = registry.getIdentifiedEntity("page")?.type;
    if (!pageType || !("$record" in pageType)) throw new Error("missing identified page");
    const config = pageType.$record.fields.find((field) => field.name === "config");
    if (!config) throw new Error("missing page.config");

    const schema = fenelTypeToJsonSchema(pageType, {}, registry);
    expect(schema.properties?.config?.properties?.redirectUrl?.title).toBe("Redirect URL");

    const configResult = validate(
      { $record: { fields: [config] } },
      { config: { brandColor: "", logo: "", thankYouMessage: "" } }, null,
      { registry },
    );
    expect(configResult.errors.find((error) => error.path === "config.redirectUrl")?.message)
      .toBe("Redirect URL is required");

    const variantType = registry.getIdentifiedEntity("Evidence")?.type;
    if (!variantType || !("$variant" in variantType)) {
      throw new Error("missing identified Evidence variant");
    }
    const variantCase = variantType.$variant.cases.find((candidate) => candidate.fields?.length);
    const variantField = variantCase?.fields?.[0];
    if (!variantCase || !variantField) throw new Error("missing Evidence payload field");
    const variantLabel = canonical(
      resolveIdentifiedFieldView(registry, variantField).presentation.label,
    );
    const variantSchema = fenelTypeToJsonSchema(variantType, {}, registry);
    expect(variantSchema.oneOf?.find((entry) =>
      entry.properties?.[variantType.$variant.discriminator ?? "$tag"]?.const === variantCase.name
    )?.properties?.[variantField.name]?.title).toBe(variantLabel);

    const variantResult = validate(
      variantType,
      { [variantType.$variant.discriminator ?? "$tag"]: variantCase.name }, null,
      { registry },
    );
    expect(variantResult.errors.find((error) => error.path.endsWith(variantField.name))?.message)
      .toBe(`${variantLabel} is required`);
  });

  test("Telegram and inferred table labels use UUID facets", () => {
    const field = identifiedField("platform", "handleMaxLength");
    const type: FenelType = { $record: { fields: [field] } };
    const definition = { slug: "platform", type };
    const telegram = buildTelegramFormSteps(registry, definition);
    expect(telegram.steps[0]?.label).toBe("Max Length");
    expect(telegram.steps[0]?.message).toContain("Max Length");

    const surface = defaultListDisplayForType(
      createSurfaceEnvironment({ registry }),
      type,
    );
    expect(surface.columns?.[0]?.label).toBe("Max Length");
  });

  test("an explicit product registry never becomes a keyless compatibility reader", () => {
    const keyless: FieldDef = {
      name: "legacyName",
      type: { $ref: "String" },
      label: { $tag: "Nothing" },
      ui: { $tag: "Nothing" },
      meta: {},
    };
    const type: FenelType = { $record: { fields: [keyless] } };
    const validation = validate(type, {}, null, { registry });
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]?.message).toContain("invalid named field");
    expect(() => formToJsonSchema([keyless], { registry })).toThrow("invalid named field");
    expect(() => defaultListDisplayForType(
      createSurfaceEnvironment({ registry }),
      type,
    )).toThrow("invalid named field");
  });

  test("surface readers preserve unresolved-presentation diagnostics", () => {
    const unknown: FieldDef = {
      name: "unknown",
      key: {
        $tag: "NamedField",
        ref: { $ref: "ef2dd2ba-198d-4aa8-a7b8-469669e5510f" },
      },
      type: { $ref: "String" },
      label: { $tag: "Nothing" },
      ui: { $tag: "Nothing" },
      meta: {},
    };
    let thrown: unknown;
    try {
      defaultListDisplayForType(
        createSurfaceEnvironment({ registry }),
        { $record: { fields: [unknown] } },
      );
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { diagnostic?: { $tag?: string } })?.diagnostic?.$tag)
      .toBe("UnresolvedFieldPresentation");
  });
});
