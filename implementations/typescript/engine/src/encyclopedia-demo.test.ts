// C1: execute the Fenel source against the existing country reference rows.
// The two fixture natives are the real A2 source-reflection and B3 type-envelope
// bridges; neither filters, projects or invents country data in TypeScript.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, evaluateWithTrace, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { dispatchRegistry } from "./system-entities";
import { countries } from "./reference-data";
import { Just, Nothing, setExprAsType } from "./type-foundation";
import { peelSetExpr } from "./set-marker";
import { fieldEditPlan } from "./authoring/field-render";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import { validateValue } from "./validate";
import type { FenelType, SetExpr } from "./types";
import SOURCE from "../../../../fenel/modules/publicdemo/encyclopedia-demo.fenel?raw";

type CountryRow = { $tag: "EncyclopediaCountry"; flag: string; name: string; code: string; currency: string; language: string };
type EncyclopediaResult = {
  countries: CountryRow[];
  count: number;
  codes: string[];
  countryCodeType: FenelType;
  selected: { $tag: string; _0?: CountryRow };
  membership: unknown;
};

let registry: ModuleRegistry;
let context: EvaluateContext;
let catalogue: CountryRow[];

function call(name: string, ...args: unknown[]): unknown {
  return withInterpretedResolver(() => invokeCallable({ $ref: `EncyclopediaDemo:${name}` }, args, context));
}

beforeAll(() => withInterpretedResolver(() => {
  const loaded = loadFenelModule(SOURCE, "EncyclopediaDemo");
  const demo = {
    ...loaded,
    nativeImpls: {
      "EncyclopediaDemo:encyclopediaSourceCountries": () => countries,
      "EncyclopediaDemo:encyclopediaTypeFromSet": (base: unknown, constraint: unknown) =>
        setExprAsType(base as FenelType, constraint as SetExpr),
    },
  };
  registry = createRegistry([stdModule, decidableMembershipModule, demo], { dispatchRegistry });
  context = registry.evaluateContext();
  catalogue = call("encyclopediaCountries") as CountryRow[];
}), 60_000);

describe("bounded country encyclopedia", () => {
  test("the source projects the existing catalogue without replacing or mutating it", () => {
    const before = structuredClone(countries);
    const projected = call("encyclopediaCountries") as CountryRow[];
    expect(projected).toEqual(catalogue);
    expect(projected).toHaveLength(countries.length);
    for (let index = 0; index < countries.length; index++) {
      const original = countries[index]!;
      const flag = withInterpretedResolver(() => invokeCallable({ $ref: "std:countryFlag" }, [original.code], context));
      expect(flag).toBeDefined();
      expect(typeof flag).toBe("string");
      if (typeof flag !== "string") throw new Error("Country flag projection did not return a String.");
      expect(projected[index]).toEqual({ $tag: "EncyclopediaCountry", flag, name: original.name, code: original.code,
        currency: original.currency, language: original.language });
    }
    expect(projected.find(country => country.code === "FR")?.flag).toBe("🇫🇷");
    expect(projected.find(country => country.code === "US")?.flag).toBe("🇺🇸");
    expect(countries).toEqual(before);
  });

  test("EUR and USD change the rows, derived type and selected country together", () => {
    for (const [currency, included, excluded] of [["EUR", "FR", "US"], ["USD", "US", "FR"]] as const) {
      const result = call("countryEncyclopedia", currency, included) as EncyclopediaResult;
      expect(result.count).toBe(result.countries.length);
      expect(result.count).toBeGreaterThan(0);
      expect(result.countries.every(country => country.currency === currency)).toBe(true);
      expect(result.codes).toContain(included);
      expect(result.codes).not.toContain(excluded);
      expect(result.codes).toEqual([...new Set(result.countries.map(country => country.code))]);
      expect(result.selected).toEqual(Just(result.countries.find(country => country.code === included)!));
      expect(result.membership).toEqual(Just(true));
      expect("$refined" in result.countryCodeType).toBe(true);
      if ("$refined" in result.countryCodeType) {
        expect(peelSetExpr(result.countryCodeType.$refined.set)).toEqual({ kind: "SeEnum", values: result.codes });
      }
    }
  });

  test("a country excluded by the filter cannot become a selected result", () => {
    const result = call("countryEncyclopedia", "EUR", "US") as EncyclopediaResult;
    expect(result.selected).toEqual(Nothing);
    expect(result.membership).toEqual(Just(false));
    expect(result.codes).not.toContain("US");
  });

  test("an unknown currency produces an empty code type, with no admitted country", () => {
    const result = call("countryEncyclopedia", "UNKNOWN", "FR") as EncyclopediaResult;
    expect(result.countries).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.codes).toEqual([]);
    expect(result.selected).toEqual(Nothing);
    expect(result.membership).toEqual(Just(false));
    if (!("$refined" in result.countryCodeType)) throw new Error("The finite code type was not preserved.");
    expect(peelSetExpr(result.countryCodeType.$refined.set)).toEqual({ kind: "SeEnum", values: [] });
  });

  test("the declared dependent parameter evaluates to the displayed finite type and ordinary select plan", () => {
    const fn = registry.getFunction("EncyclopediaDemo:countryEncyclopedia")!;
    const field = fn.params[1]!;
    expect(field.name).toBe("countryCode");
    if (!("$el" in field.type)) throw new Error("The country input lost its declared dependent type.");
    const dependentPayload = field.type.$el;
    for (const currency of ["EUR", "USD"]) {
      const values = { currency };
      const evaluated = withInterpretedResolver(() => evaluateWithTrace(dependentPayload, values, context).result) as FenelType;
      const displayed = call("countryCodeType", currency) as FenelType;
      expect(evaluated).toEqual(displayed);
      const plan = withInterpretedResolver(() => fieldEditPlan({
        field: { ...field, type: evaluated }, value: currency === "EUR" ? "FR" : "US",
      }));
      expect(plan.editor.kind).toBe("select");
      if (plan.editor.kind !== "select") throw new Error("The finite member type did not produce a select.");
      expect(plan.editor.options.map(option => option.value)).toEqual(call("encyclopediaCountryCodesForCurrency", catalogue, currency) as string[]);
    }
  });

  test("source-owned defaults retain the same source catalogue and callable identities", () => {
    const starts = call("encyclopediaDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(starts).toHaveLength(3);
    expect(starts[0]!.function.$ref).toBeTruthy();
    expect(starts[0]!.arguments).toEqual(["EUR", "FR"]);
    const result = withInterpretedResolver(() => invokeCallable(starts[0]!.function, starts[0]!.arguments, context)) as EncyclopediaResult;
    expect(result.selected).toMatchObject({ $tag: "Just", _0: { code: "FR", currency: "EUR" } });
  });
});

describe("public country demo in the repository seed profile", () => {
  let product: ModuleRegistry;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { publicEncyclopediaDemoModule }] = await Promise.all([
      import("./module-manifest"),
      import("./repository-registry"),
      import("./modules/public-demos"),
    ]);
    const modules = modulesFor("seed");
    expect(modules.includes(publicEncyclopediaDemoModule)).toBe(true);
    product = createRepositoryRegistry(modules);
  }, 900_000);

  // C1 product regression: validate the real public values against checked
  // declarations, preserving $tag rather than silently stripping added data.
  test("checked country signatures strictly admit the real tagged catalogue and results", () => withInterpretedResolver(() => {
    for (const name of ["encyclopediaSourceCountries", "encyclopediaProjectCountries", "encyclopediaCountries"]) {
      const id = `EncyclopediaDemo:${name}`;
      const info = product.getFunctionSignatureInfo(id)!;
      expect(info.outcome.$tag, `${id}: ${JSON.stringify(info.outcome)}`).toBe("Solved");
      expect(product.getFunctionScheme(id)).toBeDefined();
    }
    const dependentInfo = product.getFunctionSignatureInfo("EncyclopediaDemo:countryEncyclopedia")!;
    expect(dependentInfo.outcome.$tag).toBe("AnnotationRequired");
    if (dependentInfo.outcome.$tag !== "AnnotationRequired") throw new Error("The value-dependent inference boundary changed.");
    expect(dependentInfo.outcome.diagnostics.map(diagnostic => diagnostic.code)).toContain("inference.value-dependent-type");
    expect(dependentInfo.params.map(slot => slot.$tag)).toEqual(["Authored", "Authored"]);
    expect(dependentInfo.returns.$tag).toBe("Authored");
    const dependentFn = product.getIdentifiedFunction("EncyclopediaDemo:countryEncyclopedia")!;
    expect(dependentFn.params.map(field => field.name)).toEqual(["currency", "countryCode"]);
    expect(dependentFn.params[1]!.type).toHaveProperty("$el");
    const productContext = product.evaluateContext();
    const options = { registry: product, functions: productContext, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    const publicCall = (name: string, ...args: unknown[]) => {
      const uuid = product.getUuid(`EncyclopediaDemo:${name}`)!;
      expect(uuid).toBeTruthy();
      return invokeCallable({ $ref: uuid }, args, productContext);
    };

    const raw = publicCall("encyclopediaSourceCountries");
    const rawFn = product.getIdentifiedFunction("EncyclopediaDemo:encyclopediaSourceCountries")!;
    const rawChecked = validateValue(rawFn.returns, raw, null, options);
    expect(rawChecked.valid, JSON.stringify(rawChecked.errors)).toBe(true);
    expect(rawChecked.value).toEqual(countries);

    const projected = publicCall("encyclopediaCountries") as CountryRow[];
    const catalogueFn = product.getIdentifiedFunction("EncyclopediaDemo:encyclopediaCountries")!;
    const catalogueChecked = validateValue(catalogueFn.returns, projected, null, options);
    expect(catalogueChecked.valid, JSON.stringify(catalogueChecked.errors)).toBe(true);
    expect(catalogueChecked.value).toEqual(projected);
    expect(projected).toEqual(catalogue);

    const rowType = product.getIdentifiedEntity("EncyclopediaCountry")!.type;
    expect(rowType).toHaveProperty("$variant");
    if (!("$variant" in rowType)) throw new Error("The catalogue row lost its tagged declaration.");
    expect(rowType.$variant.discriminator).toBe("$tag");
    expect(rowType.$variant.cases[0]!.fields!.map(field => field.name)).toEqual(["code", "name", "currency", "language"]);
    for (const projectedRow of projected) {
      const rowChecked = validateValue(rowType, projectedRow, null, options);
      expect(rowChecked.valid, `${projectedRow.code}: ${JSON.stringify(rowChecked.errors)}`).toBe(true);
      expect(rowChecked.value).toEqual(projectedRow);
    }
    const row = projected[0]!;
    const { $tag: _tag, ...untagged } = row as CountryRow & { $tag: string };
    for (const invalid of [untagged, { ...row, $tag: "Country" }, { ...row, centroid: [0, 0] }]) {
      expect(validateValue(rowType, invalid, null, options).valid).toBe(false);
    }

    const resultFn = product.getIdentifiedFunction("EncyclopediaDemo:countryEncyclopedia")!;
    for (const [currency, countryCode] of [["EUR", "FR"], ["USD", "US"], ["UNKNOWN", "FR"]]) {
      const result = publicCall("countryEncyclopedia", currency, countryCode) as EncyclopediaResult & { $tag: string };
      expect(result.$tag).toBe("CountryEncyclopediaResult");
      const resultChecked = validateValue(resultFn.returns, result, null, options);
      expect(resultChecked.valid, `${currency}: ${JSON.stringify(resultChecked.errors)}`).toBe(true);
      expect(resultChecked.value).toEqual(result);
      expect(validateValue(resultFn.returns, { ...result, added: true }, null, options).valid).toBe(false);
      expect(validateValue(resultFn.returns, { ...result, $tag: "Country" }, null, options).valid).toBe(false);
    }
  }), 180_000);
});
