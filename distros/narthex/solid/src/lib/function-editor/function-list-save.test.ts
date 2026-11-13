// @ts-nocheck -- Executes the production route save closure without browser/router setup.
import { describe, expect, test } from "bun:test";
const source = await Bun.file(new URL("../../routes/app/functions/index.tsx", import.meta.url)).text();
const start = source.indexOf("  async function handleSubmit");
const save = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, source.indexOf("  async function handleDelete", start)));

function harness({ migrated = false, failRepresentation = false } = {}) {
  const events = []; let error = ""; let saving = false;
  const returns = { $union: [{ $ref: "Int" }, { $ref: "String" }] };
  const requires = [{ class: { $tag: "Id", entityId: "HasNetwork" }, args: [] }];
  const description = { en: "A greeting", fr: "Une salutation" };
  const scope = {
    saving: () => saving, setSaving: (next) => { saving = next; }, setError: (next) => { error = next; },
    name: () => "greet", definitionId: () => "account:stable-greet", params: () => [],
    returns: () => returns, requires: () => requires, description: () => description, category: () => "text",
    initialIdentity: () => migrated ? { description, category: "text", migrateDescription: true, migrateCategory: true } : { description: "", category: "" },
    hasBody: () => true, body: () => false, fieldFacets: () => ({}), fieldResurrections: { fieldIds: () => [] },
    desiredFieldFacetValues: () => [], fieldFacetReplacementIds: () => [],
    api: { definitionBundleSave: async (request) => { events.push(["definition", request]); return {}; } },
    persistRepresentation: async (...args) => { events.push(["representation", ...args]); if (failRepresentation) throw new Error("representation failed"); },
    revalidate: async () => {}, refresh: async () => {}, data: () => undefined,
    reloadUserRegistries: async () => {}, resetForm: () => events.push(["reset"]),
  };
  const make = new Function("scope", `const { ${Object.keys(scope).join(", ")} } = scope; ${save}; return handleSubmit;`);
  return { submit: () => make(scope)({ preventDefault() {} }), events, error: () => error, returns, requires, description };
}

describe("function list owner saves canonical signature and representations", () => {
  test("New opens Home's canonical composer", () => {
    const start = source.indexOf("  function startCreate()");
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, source.indexOf("  function startEdit", start)));
    const paths = [];
    new Function("navigate", `${code}; return startCreate;`)((path) => paths.push(path))();
    expect(paths).toEqual(["/app?new=function"]);
  });
  for (const migrated of [false, true]) test(migrated ? "legacy inline identity migrates to representations" : "new identity persists separately from function spec", async () => {
    const h = harness({ migrated }); await h.submit();
    const definition = h.events[0][1].ownerMutations[0].owner.definition;
    expect(definition).toEqual({ id: "account:stable-greet", params: [], returns: h.returns, requires: h.requires, body: false });
    expect(h.events[1]).toEqual(["representation", "Describable", "account:stable-greet", { description: h.description }]);
    expect(h.events[2]).toEqual(["representation", "Categorizable", "account:stable-greet", { category: "text" }]);
    expect(h.events.at(-1)).toEqual(["reset"]);
  });
  test("a partial representation failure retains the form for retry", async () => {
    const h = harness({ failRepresentation: true }); await h.submit();
    expect(h.events[0][0]).toBe("definition");
    expect(h.events.some((event) => event[0] === "reset")).toBe(false);
    expect(h.error()).toBe("representation failed");
  });
});
