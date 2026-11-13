// @ts-nocheck -- Production route closures with the database command leaf stubbed.
import { expect, test } from "bun:test";
import { functionDefinitionFromJsonWire, functionDefinitionToJsonWire, ownerDefinitionToJsonWire } from "@fenel/engine/authoring/expression";
const source = await Bun.file(new URL("./routes/dashboard.ts", import.meta.url)).text();
const begin = source.indexOf("function functionRowToJsonWire(");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(begin, source.indexOf('dashboardRoutes.delete("/functions/:name"', begin)));

test("function HTTP save keeps canonical identity through storage rename and returns typed body wire", async () => {
  const routes = new Map(); const captured = [];
  const type = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
  const fn = { id: "canonical-function-id", params: [], returns: { $type: true }, body: { ann: [type, { $type: true }] } };
  const scope = {
    dashboardRoutes: Object.fromEntries(["get", "put", "patch"].map((method) => [method, (path, handler) => routes.set(`${method} ${path}`, handler)])),
    objectRecord: (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined,
    // rights R2a — the extracted route closures read the minted authority from
    // the Hono context; these harnesses stub every IO leaf, so an opaque handle
    // is all they need. ⚠ THIS SUITE IS RED AT BASELINE AND STILL IS, for its
    // OWN reason: the extracted slice reaches the catalog-cached list route and
    // the harness models neither `catalogResponse` nor the request header it
    // reads. The extracted range is byte-shape identical before and after R2a
    // (5 routes, 1 `catalogResponse`, 1 `c.req.header`), so this is not R2a's.
    getAccountId: () => "account",
    authorityOf: () => ({}), functionDefinitionToJsonWire, ownerDefinitionToJsonWire,
    executeFieldDefinitionCommand: async (_account, request) => {
      captured.push(request);
      const owner = request.ownerMutations[0].owner;
      return { ok: true, snapshot: { owners: [{ ...owner, definition: functionDefinitionFromJsonWire(owner.definition) }] } };
    },
    invokeIOActionAs: async (_account, _profile, action) => action === "dashboard:listFunctionsMerged"
      ? [{ id: "physical-id", name: "renamed", function: fn }]
      : { $tag: "Just", _0: { id: "physical-id", name: "renamed", function: fn } },
  };
  new Function("scope", `const {${Object.keys(scope).join(",")}} = scope; ${code}`)(scope);
  const ctx = {
    req: { param: () => "renamed", json: async () => ({ function: functionDefinitionToJsonWire(fn) }) },
    json: (value, status = 200) => ({ status, data: JSON.parse(JSON.stringify(value)) }),
  };
  const saved = await routes.get("put /functions/:name")(ctx);
  expect(saved.status).toBe(200);
  expect(captured[0].ownerMutations[0].owner.storageName).toBe("renamed");
  expect(captured[0].ownerMutations[0].owner.definition.id).toBe(fn.id);
  expect(functionDefinitionFromJsonWire(saved.data.definition.definition)).toEqual(fn);
  const listed = await routes.get("get /functions")(ctx);
  const read = await routes.get("get /functions/:name")(ctx);
  expect(functionDefinitionFromJsonWire(listed.data.functions[0].function)).toEqual(fn);
  expect(functionDefinitionFromJsonWire(read.data.definition.function)).toEqual(fn);
});
