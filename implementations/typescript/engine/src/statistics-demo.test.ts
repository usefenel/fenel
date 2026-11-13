import { beforeAll, describe, expect, test } from "bun:test";
import TYPES from "../../../../fenel/modules/publicdemo/statistics-types.fenel?raw";
import SOURCE from "../../../../fenel/modules/publicdemo/statistics-demo.fenel?raw";
import INPUTS from "../../../../fenel/modules/publicdemo/statistics-inputs.fenel?raw";
import DRAWING from "../../../../fenel/modules/publicdemo/drawing-demo.fenel?raw";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { pictureModule } from "./modules/picture";
import { pathModule } from "./modules/path";
import { Just, Nothing } from "./type-foundation";
import { validateValue } from "./validate";
import { parse } from "./fenel-parser";
import { print } from "./engine-bodies-dispatch";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./authoring/environment";
import { exprNodeToLogic, logicToExprNode } from "./authoring/expression-authoring";

// C1: authored statistics execute through the existing evaluator and std
// leaves. This harness adds no aggregation native or presentation algorithm.
type Summary = { $tag: "NumberSummary"; count: number; total: number; average: unknown; minimum: unknown; maximum: unknown };
type Customer = { $tag: "StatisticsCustomer"; id: string; name: string };
type Purchase = { $tag: "StatisticsPurchase"; id: string; customerId: string; amountCents: number };
type Breakdown = { $tag: "CustomerPurchaseSummary"; customerId: string; customerName: unknown; count: number; totalCents: number; averageCents: unknown };
type NumberResult = { $tag: "NumberStatistics"; values: number[]; summary: Summary; chart: { $tag: string; points: Array<{ x: number; y: number }> }; explanation: string };
type PurchaseResult = { $tag: "PurchaseStatistics"; customers: Customer[]; purchases: Purchase[]; summary: Summary; breakdown: Breakdown[]; explanation: string };
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, pictureModule, pathModule, loadFenelModule(DRAWING, "DrawingDemo"),
    ...loadFenelModuleUnion([TYPES, SOURCE, INPUTS].map(src => ({ src, name: "StatisticsDemo" })))]);
  context = registry.evaluateContext();
}, 180_000);

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [`StatisticsDemo:${name}`, ...args] }, {}, context);
}
const customer = (id: string, name: string): Customer => ({ $tag: "StatisticsCustomer", id, name });
const purchase = (id: string, customerId: string, amountCents: number): Purchase => ({ $tag: "StatisticsPurchase", id, customerId, amountCents });
const empty: Summary = { $tag: "NumberSummary", count: 0, total: 0, average: Nothing, minimum: Nothing, maximum: Nothing };

describe("Fenel-owned typed statistics", () => {
  test("empty numerical data has no fabricated average or extrema", () => {
    const result = call("numberStatistics", []) as NumberResult;
    expect(result.$tag).toBe("NumberStatistics");
    expect(result.values).toEqual([]);
    expect(result.summary).toEqual(empty);
    expect(result.chart.$tag).toBe("PointLineChart");
    expect(result.chart.points).toEqual([]);
  });

  test.each([
    [[12, 7, 18, 3, 10], 5, 50, 10, 3, 18],
    [[-6, -2, -4], 3, -12, -4, -6, -2],
    [[0.5, -1.5, 4], 3, 3, 1, -1.5, 4],
    [[7, 7, 7], 3, 21, 7, 7, 7],
    [[0], 1, 0, 0, 0, 0],
    [[-1000000, 1000000], 2, 0, 0, -1000000, 1000000],
  ] as const)("ordinary data %j derives its exact summary and chart", (values, count, total, average, minimum, maximum) => {
    const result = call("numberStatistics", values) as NumberResult;
    expect(result.summary).toEqual({ $tag: "NumberSummary", count, total, average: Just(average), minimum: Just(minimum), maximum: Just(maximum) });
    expect(result.values).toEqual([...values]);
    expect(result.chart.points).toEqual(values.map((y, index) => ({ x: index + 1, y })));
  });

  test("editing the input changes summary and typed chart together without mutating the earlier value", () => {
    const original = call("numberStatistics", [2, 4]) as NumberResult;
    const edited = call("numberStatistics", [2, 8, -1]) as NumberResult;
    expect(original.summary.total).toBe(6);
    expect(edited.summary.total).toBe(9);
    expect(edited.chart.points).toEqual([{ x: 1, y: 2 }, { x: 2, y: 8 }, { x: 3, y: -1 }]);
    expect(original.chart.points).toEqual([{ x: 1, y: 2 }, { x: 2, y: 4 }]);
    expect(edited.explanation).toContain("Open Call");
  });

  test("non-finite values, outliers, wrong scalars and oversized collections refuse numerical output", () => {
    for (const values of [[NaN], [Infinity], [-Infinity], [1000001], [-1000001], ["5"], Array(65).fill(1)]) {
      expect(call("numberStatistics", values)).toEqual({ $tag: "NumberStatisticsRefused", reason: "Use at most 64 finite numbers between -1000000 and 1000000." });
    }
    expect((call("numberStatistics", Array(64).fill(1)) as NumberResult).summary.total).toBe(64);
  });

  test("non-list carriers refuse statistics and chart output before collection adapters can treat them as empty", () => {
    const reason = "Use at most 64 finite numbers between -1000000 and 1000000.";
    for (const values of [7, "abc", "", false, null, {}, { length: 0 }, { $tag: "Nothing" }]) {
      expect(invokeCallable({ $ref: "StatisticsDemo:numberStatistics" }, [values], context)).toEqual({ $tag: "NumberStatisticsRefused", reason });
      expect(invokeCallable({ $ref: "StatisticsDemo:numberChart" }, [values], context)).toEqual({ $tag: "PointLineChartRefused", reason });
    }
    expect((call("numberStatistics", []) as NumberResult).summary).toEqual(empty);
    expect((call("numberStatistics", [2, 8, -1]) as NumberResult).summary.total).toBe(9);
  });

  test("the direct chart operation presents the admitted statistics projection and preserves input refusals", () => {
    for (const values of [[], [12, 7, 18, 3, 10], [-6, 0.5, 7]]) {
      expect(call("numberChart", values)).toEqual((call("numberStatistics", values) as NumberResult).chart);
    }
    for (const values of [[Infinity], [1000001], Array(65).fill(1)]) {
      expect(call("numberChart", values)).toEqual({ $tag: "PointLineChartRefused", reason: "Use at most 64 finite numbers between -1000000 and 1000000." });
    }
  });

  test("CRM breakdown reconciles all rows including known zero-purchase customers and unknown ids", () => {
    const customers = [customer("a", "Ada"), customer("b", "Bo"), customer("zero", "Cy")];
    const purchases = [purchase("1", "a", 1200), purchase("2", "a", 800), purchase("3", "b", 1500), purchase("4", "unknown", 500)];
    const result = call("purchaseStatistics", customers, purchases) as PurchaseResult;
    expect(result.$tag).toBe("PurchaseStatistics");
    expect(result.customers).toEqual(customers);
    expect(result.purchases).toEqual(purchases);
    expect(result.summary).toEqual({ $tag: "NumberSummary", count: 4, total: 4000, average: Just(1000), minimum: Just(500), maximum: Just(1500) });
    expect(result.breakdown).toEqual([
      { $tag: "CustomerPurchaseSummary", customerId: "a", customerName: Just("Ada"), count: 2, totalCents: 2000, averageCents: Just(1000) },
      { $tag: "CustomerPurchaseSummary", customerId: "b", customerName: Just("Bo"), count: 1, totalCents: 1500, averageCents: Just(1500) },
      { $tag: "CustomerPurchaseSummary", customerId: "zero", customerName: Just("Cy"), count: 0, totalCents: 0, averageCents: Nothing },
      { $tag: "CustomerPurchaseSummary", customerId: "unknown", customerName: Nothing, count: 1, totalCents: 500, averageCents: Just(500) },
    ]);
    expect(result.breakdown.reduce((sum, row) => sum + row.count, 0)).toBe(result.summary.count);
    expect(result.breakdown.reduce((sum, row) => sum + row.totalCents, 0)).toBe(result.summary.total);
    expect(call("customerBreakdown", customers, purchases)).toEqual({ $tag: "Ok", _0: result.breakdown });
  });

  test("empty and edited CRM inputs retain undefined average and whole-cent units", () => {
    const noData = call("purchaseStatistics", [], []) as PurchaseResult;
    expect(noData.summary).toEqual(empty);
    expect(noData.breakdown).toEqual([]);
    const result = call("purchaseStatistics", [customer("a", "Ada")], [purchase("1", "a", 0), purchase("2", "a", 1)]) as PurchaseResult;
    expect(result.summary.average).toEqual(Just(0.5));
    expect(result.breakdown[0]).toMatchObject({ count: 2, totalCents: 1, averageCents: Just(0.5) });
    const changed = call("purchaseStatistics", [customer("a", "Ada")], [purchase("2", "a", 7)]) as PurchaseResult;
    expect(changed.breakdown[0]).toMatchObject({ count: 1, totalCents: 7, averageCents: Just(7) });
    expect(result.summary.total).toBe(1);
  });

  test("purchase ids do not silently deduplicate supplied rows", () => {
    const rows = [purchase("repeated", "a", 1200), purchase("repeated", "a", 800)];
    const result = call("purchaseStatistics", [customer("a", "Ada")], rows) as PurchaseResult;
    expect(result.purchases).toEqual(rows);
    expect(result.summary).toMatchObject({ count: 2, total: 2000, average: Just(1000) });
    expect(result.breakdown).toEqual([
      { $tag: "CustomerPurchaseSummary", customerId: "a", customerName: Just("Ada"), count: 2, totalCents: 2000, averageCents: Just(1000) },
    ]);
  });

  test("duplicate customer ids, invalid cents and oversized CRM data refuse instead of double-counting", () => {
    const reason = "Use at most 64 customers with unique ids and 64 purchases with whole amounts from 0 through 1000000 cents.";
    for (const [customers, purchases] of [
      [[customer("a", "Ada"), customer("a", "Another Ada")], [purchase("1", "a", 7)]],
      [[], [purchase("1", "unknown", -1)]],
      [[], [purchase("1", "unknown", 0.5)]],
      [[], [purchase("1", "unknown", 1000001)]],
      [[], [purchase("1", "unknown", Infinity)]],
      [[], [{ $tag: "StatisticsPurchase", id: "1", customerId: "unknown", amountCents: "12" }]],
      [Array.from({ length: 65 }, (_, index) => customer(String(index), "Name")), []],
      [[], Array.from({ length: 65 }, (_, index) => purchase(String(index), "unknown", 1))],
    ]) {
      expect(call("purchaseStatistics", customers, purchases)).toEqual({ $tag: "PurchaseStatisticsRefused", reason });
      expect(call("customerBreakdown", customers, purchases)).toEqual({ $tag: "Err", _0: reason });
    }
  });

  test("each CRM list carrier must be a list before purchase statistics or table data can be produced", () => {
    const reason = "Use at most 64 customers with unique ids and 64 purchases with whole amounts from 0 through 1000000 cents.";
    for (const carrier of [7, "abc", "", false, null, {}, { length: 0 }, { $tag: "Nothing" }]) {
      for (const args of [[carrier, []], [[], carrier], [carrier, carrier]]) {
        expect(invokeCallable({ $ref: "StatisticsDemo:purchaseStatistics" }, args, context)).toEqual({ $tag: "PurchaseStatisticsRefused", reason });
        expect(invokeCallable({ $ref: "StatisticsDemo:customerBreakdown" }, args, context)).toEqual({ $tag: "Err", _0: reason });
      }
    }
    expect((call("purchaseStatistics", [], []) as PurchaseResult).summary).toEqual(empty);
    expect(call("customerBreakdown", [], [])).toEqual({ $tag: "Ok", _0: [] });
  });

  test("starting inputs are source-owned callable values and aggregation bodies contain no sum/avg call", () => {
    const inputs = call("statisticsDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs.map(input => input.function)).toEqual([{ $ref: "StatisticsDemo:numberStatistics" }, { $ref: "StatisticsDemo:purchaseStatistics" }, { $ref: "StatisticsDemo:customerBreakdown" }, { $ref: "StatisticsDemo:numberChart" }]);
    expect((evaluate({ call: [inputs[0]!.function, ...inputs[0]!.arguments] }, {}, context) as NumberResult).summary.total).toBe(50);
    expect((evaluate({ call: [inputs[1]!.function, ...inputs[1]!.arguments] }, {}, context) as PurchaseResult).summary.total).toBe(4000);
    const rows = call("statisticsSampleBreakdown") as Breakdown[];
    expect(rows.map(row => [row.customerId, row.count, row.totalCents, row.averageCents])).toEqual([
      ["ada", 2, 2000, Just(1000)], ["bo", 1, 1500, Just(1500)], ["cy", 0, 0, Nothing], ["guest", 1, 500, Just(500)],
    ]);
    expect(rows.reduce((count, row) => count + row.count, 0)).toBe(4);
    expect(rows.reduce((total, row) => total + row.totalCents, 0)).toBe(4000);
    for (const fn of registry.modules.find(module => module.name === "StatisticsDemo")!.functions!) {
      expect(fn.body, fn.id).toBeDefined();
      expect(JSON.stringify(fn.body)).not.toMatch(/"(?:std:)?(?:sum|avg)"/);
    }
  });

  test("complete statistics source files stay on the Fenel parser path and match the compatibility oracle", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    for (const [name, source] of [["types", TYPES], ["functions", SOURCE], ["inputs", INPUTS]] as const) {
      const native = parseViaFenelParser(source);
      expect(native, name).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(native).toEqual(JSON.parse(JSON.stringify(parse(source))));
    }
  }, 60_000);
});

describe("production statistics in the checked execute profile", () => {
  let product: ModuleRegistry;
  let productContext: EvaluateContext;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { publicStatisticsDemoModule }, { dispatchRegistry }, { mintAnonymousAuthority }] = await Promise.all([
      import("./module-manifest"), import("./repository-registry"), import("./modules/public-demos"),
      import("./system-entities"), import("../../runtime/src/authority-mint"),
    ]);
    expect(modulesFor("seed").includes(publicStatisticsDemoModule)).toBe(true);
    expect(modulesFor("execute").includes(publicStatisticsDemoModule)).toBe(true);
    product = createRepositoryRegistry(modulesFor("execute"), { dispatchRegistry });
    productContext = { ...product.evaluateContext(), _authority: mintAnonymousAuthority(product) };
  }, 900_000);

  function productCall(name: string, ...args: unknown[]): unknown {
    const fn = product.getFunction(`StatisticsDemo.${name}`);
    if (!fn) throw new Error(`Missing source-owned StatisticsDemo.${name}`);
    const handle = product.getUuid(fn.id);
    if (!handle || product.getFunction(handle)?.id !== fn.id) throw new Error(`Missing exact identity for StatisticsDemo.${name}`);
    return invokeCallable({ $ref: handle }, args, productContext);
  }

  test("physical identities retain checked public signatures and named input fields", () => {
    for (const name of ["numberStatistics", "purchaseStatistics", "customerBreakdown", "numberChart", "statisticsDemoStartingInputs", "statisticsSampleNumbers", "statisticsSampleCustomers", "statisticsSamplePurchases", "statisticsSampleBreakdown"]) {
      const fn = product.getFunction(`StatisticsDemo.${name}`)!;
      expect(fn).toBeDefined();
      const handle = product.getUuid(fn.id)!;
      expect(handle).toMatch(/^[0-9a-f-]{36}$/i);
      expect(product.getFunction(handle)?.id).toBe(fn.id);
      expect(product.getFunctionSignatureInfo(handle)!.outcome.$tag).toBe("Solved");
      for (const field of product.getIdentifiedFunction(handle)!.params) {
        expect(field.key?.$tag).toBe("NamedField");
        if (field.key?.$tag !== "NamedField") throw new Error("Statistics inputs must retain their field identities");
        expect(product.getFieldIdentityByHandle(field.key.ref.$ref)?.field.name).toBe(field.name);
      }
    }
    for (const name of ["NumberSummary", "NumberStatistics", "StatisticsCustomer", "StatisticsPurchase", "StatisticsAmount", "CustomerPurchaseSummary", "PurchaseStatistics"]) {
      const entity = product.getIdentifiedEntity(name)!;
      expect(entity.module).toBe("StatisticsDemo");
      const handle = product.getUuid(entity.id)!;
      expect(product.getEntityNominalIdentity(handle)).toBe(product.getEntityNominalIdentity(name));
    }
    expect(product.getEntityNominalIdentity("StatisticsPurchase")).not.toBe(product.getEntityNominalIdentity("Purchase"));
  });

  test("anonymous UUID providers execute the real functions with exact summaries and existing chart projection", () => {
    const inputs = productCall("statisticsDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs.map(input => input.function.$ref)).toEqual(["numberStatistics", "purchaseStatistics", "customerBreakdown", "numberChart"].map(name => product.getUuid(`StatisticsDemo:${name}`)!));
    const numeric = invokeCallable(inputs[0]!.function, inputs[0]!.arguments, productContext) as NumberResult;
    const commerce = invokeCallable(inputs[1]!.function, inputs[1]!.arguments, productContext) as PurchaseResult;
    expect(numeric.summary).toEqual({ $tag: "NumberSummary", count: 5, total: 50, average: Just(10), minimum: Just(3), maximum: Just(18) });
    expect(numeric.chart.$tag).toBe("PointLineChart");
    expect(numeric.chart.points).toEqual([{ x: 1, y: 12 }, { x: 2, y: 7 }, { x: 3, y: 18 }, { x: 4, y: 3 }, { x: 5, y: 10 }]);
    expect(commerce.summary).toEqual({ $tag: "NumberSummary", count: 4, total: 4000, average: Just(1000), minimum: Just(500), maximum: Just(1500) });
    expect(commerce.breakdown.map(row => [row.customerId, row.count, row.totalCents])).toEqual([["ada", 2, 2000], ["bo", 1, 1500], ["cy", 0, 0], ["guest", 1, 500]]);
    expect(productCall("customerBreakdown", ...inputs[1]!.arguments)).toEqual({ $tag: "Ok", _0: commerce.breakdown });
    expect(productCall("statisticsSampleBreakdown")).toEqual(commerce.breakdown);
    expect(invokeCallable(inputs[3]!.function, inputs[3]!.arguments, productContext)).toEqual(numeric.chart);
    expect((productCall("numberStatistics", [2, 8, -1]) as NumberResult).summary.total).toBe(9);
    expect(productCall("numberStatistics", [Infinity])).toHaveProperty("$tag", "NumberStatisticsRefused");
  }, 60_000);

  test("the actual strict checker admits source-owned inputs and outputs and rejects malformed record carriers", () => {
    const options = { registry: product, coerce: false, strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    const customers = productCall("statisticsSampleCustomers") as Customer[];
    const purchases = productCall("statisticsSamplePurchases") as Purchase[];
    const fn = product.getIdentifiedFunction(product.getUuid("StatisticsDemo:purchaseStatistics")!)!;
    const numericFn = product.getIdentifiedFunction(product.getUuid("StatisticsDemo:numberStatistics")!)!;
    for (const [type, value] of [
      [fn.params[0]!.type, customers], [fn.params[1]!.type, purchases],
      [fn.returns, productCall("purchaseStatistics", customers, purchases)],
      [numericFn.returns, productCall("numberStatistics", [12, 7, 18, 3, 10])],
      [numericFn.returns, productCall("numberStatistics", [])],
      [numericFn.returns, productCall("numberStatistics", [-2.5, 0, 3])],
      [product.getIdentifiedFunction(product.getUuid("StatisticsDemo:numberChart")!)!.returns, productCall("numberChart", [])],
      [fn.returns, productCall("purchaseStatistics", [], [])],
      [product.getIdentifiedFunction(product.getUuid("StatisticsDemo:statisticsSampleBreakdown")!)!.returns, productCall("statisticsSampleBreakdown")],
    ] as const) {
      const checked = validateValue(type, value, null, options);
      expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
    }
    for (const row of [
      { $tag: "StatisticsPurchase", id: "1", customerId: "ada", amountCents: "12" },
      { $tag: "StatisticsPurchase", id: "1", customerId: "ada", amountCents: 0.5 },
      { $tag: "StatisticsPurchase", id: "1", customerId: "ada", amountCents: -1 },
      { $tag: "StatisticsPurchase", id: "1", customerId: "ada", amountCents: 1000001 },
      { $tag: "StatisticsPurchase", id: "1", amountCents: 12 },
    ]) expect(validateValue(fn.params[1]!.type, [row], null, options).valid).toBe(false);
  }, 60_000);

  test("the shared Code lens keeps exact purchase constructor targets, typed inputs and calculations", () => {
    const customers = productCall("statisticsSampleCustomers") as Customer[];
    const purchases = productCall("statisticsSamplePurchases") as Purchase[];
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], {
      registry: product, sourceModule: "StatisticsDemo",
    }));
    const target = environment.resolveConstructorTarget?.("StatisticsPurchase");
    expect(target).toMatch(/^@ctor\//);
    const code = print(exprNodeToLogic(logicToExprNode(purchases)));
    expect(code).toContain("StatisticsPurchase {");
    expect(code).not.toContain("$tag");
    const draft = logicToExprNode(parse(code), [], environment.resolveFunctionId);
    const logic = exprNodeToLogic(draft, { constructorName: environment.resolveConstructorTarget }) as Array<{ construct: unknown[] }>;
    expect(logic.map(row => row.construct[0])).toEqual(purchases.map(() => target));
    const reapplied = evaluate(logic, {}, productContext) as Purchase[];
    expect(reapplied).toEqual(purchases);
    const fn = product.getIdentifiedFunction(product.getUuid("StatisticsDemo:purchaseStatistics")!)!;
    const options = { registry: product, coerce: false, strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    const checked = validateValue(fn.params[1]!.type, reapplied, null, options);
    expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
    const before = productCall("purchaseStatistics", customers, purchases) as PurchaseResult;
    expect(productCall("purchaseStatistics", customers, reapplied)).toEqual(before);
    const edited = logicToExprNode(parse(code.replace("1200", "2200")), [], environment.resolveFunctionId);
    const changedPurchases = evaluate(exprNodeToLogic(edited, { constructorName: environment.resolveConstructorTarget }), {}, productContext);
    const after = productCall("purchaseStatistics", customers, changedPurchases) as PurchaseResult;
    expect(after.summary.total).toBe(5000);
    expect(after.breakdown.find(row => row.customerId === "ada")?.totalCents).toBe(3000);
    expect(() => parse('[{ $tag = "StatisticsPurchase", amountCents = 2200, customerId = "ada", id = "p1" }]')).toThrow();
    expect(productCall("purchaseStatistics", customers, purchases)).toEqual(before);
    expect(before.summary.total).toBe(4000);
  }, 180_000);
});
