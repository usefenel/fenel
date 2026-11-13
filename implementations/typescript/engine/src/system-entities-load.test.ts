import { describe, expect, test } from "bun:test";
import type { FenelType, FieldDef, LocaleString } from "./types";
import { defaultFieldBindings, dispatchRegistry, systemEntities } from "./system-entities";
import { foundationTemplates, Just, Nothing } from "./type-foundation";
import { getSystemRegistry } from "./system-registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import { countries } from "./reference-data";
import { validateValue } from "./validate";
import { withInterpretedResolver } from "./engine-bodies-dispatch";

const registry = getSystemRegistry();

function recordFields(type: FenelType | undefined): FieldDef[] {
  return type && "$record" in type ? type.$record.fields : [];
}

function field(entityId: string, name: string): FieldDef {
  const entity = registry.getIdentifiedEntity(entityId);
  const found = recordFields(entity?.type).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing ${entityId}.${name}`);
  return found;
}

function rawField(entityId: string, name: string): FieldDef {
  const entity = registry.getEntity(entityId);
  const found = recordFields(entity?.type).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing raw ${entityId}.${name}`);
  return found;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

describe("Phase 2b system definition load", () => {
  test("raw module/system graphs retain empty declaration presentation and no resolved keys", () => {
    for (const [entityId, names] of [
      ["platform", ["handleMaxLength", "handlePattern", "urlTemplate"]],
      ["function", ["function"]],
      ["plan", ["terms"]],
      ["page", ["config"]],
    ] as const) {
      for (const name of names) {
        const raw = rawField(entityId, name);
        expect(raw.key).toBeUndefined();
        expect(raw.label).toEqual({ $tag: "Nothing" });
        expect(raw.ui).toEqual({ $tag: "Nothing" });
      }
    }
  });

  test("identified product views are fresh and every named field carries its UUID", () => {
    const raw = registry.getEntity("platform")!;
    const identified = registry.getIdentifiedEntity("platform")!;
    expect(identified.type).not.toBe(raw.type);
    for (const identifiedField of recordFields(identified.type)) {
      expect(identifiedField.key?.$tag).toBe("NamedField");
      if (identifiedField.key?.$tag === "NamedField") {
        expect(isUuid(identifiedField.key.ref.$ref)).toBe(true);
      }
      expect(identifiedField.label).toEqual({ $tag: "Nothing" });
      expect(identifiedField.ui).toEqual({ $tag: "Nothing" });
    }
  });

  test("source field labels resolve through UUID-keyed Labelable facets", () => {
    const maxLength = field("platform", "handleMaxLength");
    const view = resolveIdentifiedFieldView(registry, maxLength);
    expect(view.presentation).toMatchObject({
      label: "Max Length",
      source: "uuid-field-facet",
    });
    expect(registry.getFieldRepresentation("Labelable", view.fieldId)?.methods.label).toBe("Max Length");
    expect(registry.getFieldRepresentation("Labelable", "platform.handleMaxLength")).toBeUndefined();
  });

  test("widget/help directives merge into one UUID-keyed Displayable", () => {
    const spec = field("function", "function");
    const view = resolveIdentifiedFieldView(registry, spec);
    expect(view.presentation.label).toBe("Spec");
    expect(view.display).toMatchObject({
      widget: { $tag: "Just", _0: "function-editor" },
      helpText: { $tag: "Just", _0: "FenelFunction spec — params, returns, body" },
    });
    expect(registry.getFieldRepresentation("Displayable", view.fieldId)?.methods.hint).toMatchObject({
      widget: { $tag: "Just", _0: "function-editor" },
      helpText: { $tag: "Just", _0: "FenelFunction spec — params, returns, body" },
    });
    expect(registry.getFieldRepresentation("Displayable", "function.function")).toBeUndefined();
  });

  test("contextual presentation wins without mutating the identified or raw field", () => {
    const identified = field("platform", "urlTemplate");
    const before = structuredClone(identified);
    const view = resolveIdentifiedFieldView(registry, identified, {
      label: { fr: "Modèle URL" } satisfies LocaleString,
      display: { widget: { $tag: "Just", _0: "url-editor" } },
    });
    expect(view.presentation.source).toBe("contextual-override");
    expect(view.presentation.label).toEqual({ fr: "Modèle URL" });
    expect(view.display).toMatchObject({ widget: { $tag: "Just", _0: "url-editor" } });
    expect(identified).toEqual(before);
    expect(rawField("platform", "urlTemplate").label).toEqual({ $tag: "Nothing" });
  });

  test("nested source selectors resolve to the nested field UUID", () => {
    const config = field("page", "config");
    if (!("$record" in config.type)) throw new Error("page.config is not a record");
    const redirect = config.type.$record.fields.find((candidate) => candidate.name === "redirectUrl")!;
    const view = resolveIdentifiedFieldView(registry, redirect);
    expect(view.presentation.label).toBe("Redirect URL");
    expect(isUuid(view.fieldId)).toBe(true);
  });

  test("all field facets use UUID targets while unrelated value labels remain dotted", () => {
    for (const instance of registry.listFieldRepresentations()) {
      expect(typeof instance.args[0]).toBe("string");
      expect(isUuid(instance.args[0] as string)).toBe(true);
    }
    expect(dispatchRegistry.listInstances("Labelable").find(
      (instance) => instance.args[0] === "ProfileType.group",
    )?.methods.label).toBe("Group / Organization");
  });

  test("registered foundation entities retain their source type registrations", () => {
    const templates = foundationTemplates();
    const registered = new Map(systemEntities.map((entity) => [entity.id, entity.type]));
    for (const name of ["Latitude", "Longitude", "PhoneNumber", "PageSlug"] as const) {
      expect(registered.get(name)).toBe(templates.entities[name]);
    }
    for (const name of ["PhoneStr", "PhoneNumber"] as const) {
      expect(dispatchRegistry.listInstances("Iconable").find(instance => instance.args[0] === name)?.methods.icon).toBe("phone");
    }
    expect(registry.getEntity("platform")).toBeDefined();
    expect(registry.getEntity("Platform")).toBeUndefined();
  });
});

describe("Country source and optional geographic data", () => {
  const options = { registry, coerce: false, strict: { primitiveTypes: true, rejectAdded: true } };
  const countryType = registry.getIdentifiedEntity("country")!.type;
  const sourceRow = countries.find(country => country.code === "FR")!;

  test("every unchanged reference row inhabits Country without fabricated geography", () => withInterpretedResolver(() => {
    for (const country of countries) {
      expect(Object.hasOwn(country, "centroid")).toBe(false);
      expect(Object.hasOwn(country, "geometry")).toBe(false);
      const checked = validateValue(countryType, country, null, options);
      expect(checked.valid, `${country.code}: ${JSON.stringify(checked.errors)}`).toBe(true);
      expect(checked.value).toEqual(country);
    }
    for (const name of ["code", "alpha3", "name", "dialCode", "currency", "language"]) {
      const incomplete = { ...sourceRow } as Record<string, unknown>;
      delete incomplete[name];
      expect(validateValue(countryType, incomplete, null, options).valid, `${name} must remain required`).toBe(false);
    }
  }), 60_000);

  test("raw provider data and ordinary Nothing/Just values preserve their existing shapes", () => withInterpretedResolver(() => {
    expect(registry.getIdentifiedEntity("GeoPoint")).toBeDefined();
    const centroid = { lat: 48.5, lon: 2.5 };
    const geometry = [[centroid, { lat: -90, lon: -180 }, { lat: 90, lon: 180 }]];
    for (const value of [{ ...sourceRow, centroid, geometry },
      { ...sourceRow, centroid: Nothing, geometry: Nothing },
      { ...sourceRow, centroid: Just(centroid), geometry: Just(geometry) },
      { ...sourceRow, centroid, geometry: [] }]) {
      const checked = validateValue(countryType, value, null, options);
      expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
      expect(checked.value).toEqual(value);
    }
  }), 60_000);

  test("geographic absence does not weaken coordinate bounds or admit malformed present data", () => withInterpretedResolver(() => {
    for (const badCentroid of [{ lat: -91, lon: 2.5 }, { lat: 91, lon: 2.5 },
      { lat: 48.5, lon: -181 }, { lat: 48.5, lon: 181 }, { lat: "48.5", lon: 2.5 }, { lon: 2.5 }]) {
      for (const centroid of [badCentroid, Just(badCentroid)]) {
        expect(validateValue(countryType, { ...sourceRow, centroid }, null, options).valid).toBe(false);
      }
    }
    for (const geometry of ["unavailable", [[{ lat: -91, lon: 2.5 }]], [[{ lat: 48.5, lon: "2.5" }]]]) {
      for (const value of [geometry, Just(geometry)]) {
        expect(validateValue(countryType, { ...sourceRow, geometry: value }, null, options).valid).toBe(false);
      }
    }
  }), 60_000);

  test("geography providers and nested coordinate labels keep their existing field UUIDs", () => {
    const centroid = field("country", "centroid");
    expect(centroid.key).toEqual({ $tag: "NamedField", ref: { $ref: "cd52c958-3207-482e-80dc-b4f313fc1059" } });
    expect(field("country", "geometry").key).toEqual({ $tag: "NamedField", ref: { $ref: "77f0169a-1bbb-46f3-8051-a8e46dade04a" } });
    if (!("$variant" in centroid.type)) throw new Error("Country centroid lost its Maybe declaration");
    const inner = centroid.type.$variant.cases.find(candidate => candidate.name === "Just")!.fields![0]!.type;
    if (!("$record" in inner)) throw new Error("Country centroid lost its coordinate record");
    for (const [name, id, label] of [["lat", "44b77799-52cc-42f7-b942-665c48d2fb09", "Latitude"],
      ["lon", "52328095-fd8b-405e-9eb5-3459f7336323", "Longitude"]] as const) {
      const coordinate = inner.$record.fields.find(candidate => candidate.name === name)!;
      expect(coordinate.key).toEqual({ $tag: "NamedField", ref: { $ref: id } });
      expect(resolveIdentifiedFieldView(registry, coordinate).presentation.label).toBe(label);
    }
    expect(defaultFieldBindings.filter(binding => binding.target.owner === "country").map(binding => ({
      provider: binding.provider, field: binding.target.field, keyField: binding.keyField,
    }))).toEqual([
      { provider: "geo-boundaries", field: { $ref: "77f0169a-1bbb-46f3-8051-a8e46dade04a" }, keyField: { $ref: "65434517-24b1-423f-a90d-3e0aed6e1b8f" } },
      { provider: "geo-centroids", field: { $ref: "cd52c958-3207-482e-80dc-b4f313fc1059" }, keyField: { $ref: "65434517-24b1-423f-a90d-3e0aed6e1b8f" } },
    ]);
  });
});
