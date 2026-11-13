import { expect, test } from "bun:test";
import { createAccountFieldRegistry } from "../account-field-registry";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "../authoring/environment";
import { exprNodeToLogic, inferAuthoringExpression, type ExprNode } from "../authoring/expression-authoring";
import { canvasExpression } from "../authoring/locus-canvas";
import { evaluate } from "../json-logic";
import { modulesFor } from "../module-manifest";
import { getCatalog } from "../type-catalog";

test("the actual account authoring profile infers and evaluates a live placed-list reference", () => {
  const modules = modulesFor("seed");
  expect(modules.some((module) => module.name === "view")).toBe(true);
  const registry = createAccountFieldRegistry(modules, "locus-profile-test", { owners: [], fields: [], facets: [] });
  expect(registry.getFunction("view:placeAll")).toBeDefined();
  expect(registry.getEntity("Placed")).toBeDefined();
  const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(getCatalog(registry), { registry }));
  const sourceId = "locus:locus-profile-test:numbers";
  const expr = canvasExpression({ kind: "ref", savedExprId: sourceId });
  let source: ExprNode = { kind: "literal", value: { __list: [
    { kind: "literal", value: 7 }, { kind: "literal", value: 2 },
  ] } };
  const resolve = (id: string) => id === sourceId ? source : undefined;
  const inferred = inferAuthoringExpression(expr, { ...environment, resolveSavedExpr: resolve });
  expect(inferred.outcome.$tag).toBe("Solved");
  expect(JSON.stringify(inferred.type)).toContain("Placed");
  const run = () => evaluate(exprNodeToLogic(expr, {
    resolver: resolve,
    fnCodeName: (id) => environment.functionCodeName(id) ?? id,
    constructorName: (id) => environment.constructorCodeName(id),
  }), {}, registry.evaluateContext()) as { placement: unknown; item: unknown }[];
  expect(run().map((value) => value.item)).toEqual([7, 2]);
  source = { kind: "literal", value: [7, 2, 13, 23] };
  const after = run();
  expect(after.map((value) => value.item)).toEqual([7, 2, 13, 23]);
  expect(after.every((value) => value.placement !== undefined)).toBe(true);
}, 240_000);
