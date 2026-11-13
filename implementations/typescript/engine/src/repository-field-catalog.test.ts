import { describe, expect, test } from "bun:test";
import {
  queryAvailableFieldReuse,
  repositoryFieldCatalog,
} from "./repository-field-catalog";
import { Nothing } from "./type-foundation";

describe("repository field catalog immutability", () => {
  test("deep-freezes recursive occurrence types and Displayable hints", () => {
    const catalog = repositoryFieldCatalog();
    const field = catalog.fields.find((row) => row.occurrenceTypes.length > 0);
    const displayable = catalog.displayables[0];

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.fields)).toBe(true);
    expect(Object.isFrozen(field?.occurrenceTypes)).toBe(true);
    expect(Object.isFrozen(field?.occurrenceTypes[0])).toBe(true);
    expect(Object.isFrozen(displayable?.methods)).toBe(true);
    expect(Object.isFrozen(displayable?.methods["hint"])).toBe(true);
  });

  // 20802 catalog rows: this scans the whole catalog and crosses bun's 5s
  // default on a slower box (MEASURED ~6-7s here, and it times out identically
  // at the previous commit — a hardware fact, not a regression). Stated as one,
  // exactly as `premise-licence.test.ts` states its own. A default-timeout
  // failure here is indistinguishable from a semantic one, which is the actual
  // hazard: it makes a real gate read as broken and get ignored.
  test("available-field helper normalizes account owners that reuse repository UUIDs", () => {
    const reusable = repositoryFieldCatalog().fields.find(
      (field) => field.reuseVisibility === "repository",
    );
    expect(reusable).toBeDefined();
    if (reusable === undefined) return;

    const page = queryAvailableFieldReuse({
      accountOwners: [{
        ownerKey: "type:repository-reuse-probe",
        kind: "type",
        storageName: "RepositoryReuseProbe",
        definition: {
          id: "RepositoryReuseProbe",
          type: {
            $record: {
              fields: [{
                name: reusable.codeName,
                key: { $tag: "NamedField", ref: { $ref: reusable.fieldId } },
                type: reusable.occurrenceTypes[0] ?? { $ref: "String" },
                label: Nothing,
                ui: Nothing,
                meta: {},
              }],
            },
          },
        },
      }],
      accountFields: [],
      accountFacets: [],
      query: { search: reusable.codeName },
    });

    expect(page.fields).toContainEqual(
      expect.objectContaining({ fieldId: reusable.fieldId }),
    );
  }, 60000);
});

test("core loads every raw repository candidate and identity kind through the explicit leaves", async () => {
  // Exercise the existing private loader without DB commands or registry
  // construction. Imports remain real package subpaths; no catalogue is mocked.
  const text = await Bun.file(new URL("../../core/src/field-definition-command.ts", import.meta.url)).text();
  const begin = text.indexOf("async function loadRepositoryCatalog()");
  const end = text.indexOf("\nfunction publicRepositoryFields(", begin);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const body = new Bun.Transpiler({ loader: "ts" }).transformSync(text.slice(begin, end).replaceAll("import(", "load("));
  const load = new Function("load", `${body}; return loadRepositoryCatalog;`)(
    (specifier: string) => import(specifier),
  );
  const actual = await load();
  const catalog = repositoryFieldCatalog();
  const { repositoryIdentityKinds } = await import("./repository-identity-manifest");
  expect(catalog.fields.length).toBeGreaterThan(0);
  expect(actual.candidates).toEqual(catalog.fields.map(field => ({
    fieldId: field.fieldId, codeName: field.codeName,
    ...(field.label === undefined ? {} : { label: field.label }),
    owners: field.owners, occurrenceTypes: field.occurrenceTypes,
    status: "live", realm: "repository", reuseVisibility: field.reuseVisibility,
  })));
  expect(actual.candidates.map((field: { fieldId: string }) => field.fieldId))
    .toEqual(catalog.fields.map(field => field.fieldId));
  expect(actual.facetInterfaceNames).toEqual(catalog.facetInterfaceNames);
  expect(actual.identityKinds).toEqual(repositoryIdentityKinds());
}, 60_000);
