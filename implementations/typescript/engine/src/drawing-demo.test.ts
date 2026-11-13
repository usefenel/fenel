import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import SOURCE from "../../../../fenel/modules/publicdemo/drawing-demo.fenel?raw";
import INSTANCES from "../../../../fenel/modules/publicdemo/drawing-instances.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { pictureModule } from "./modules/picture";
import { pathModule } from "./modules/path";
import { validateValue } from "./validate";

// C1: complete authored source through existing evaluator/media leaves. These
// fixtures supply no helper native, drawing model or replacement renderer.
type Point = { x: number; y: number };
type CurvePath = { anchors: Point[]; segments: unknown[] };
type Image = { width: number; height: number; pixels: Array<{ r: number; g: number; b: number; a: number }> };
type FormulaResult = { $tag: "FormulaCurveResult"; points: Point[]; curve: CurvePath; picture: unknown; image: Image; explanation: string };
type DrawingResult = { $tag: "LayeredDrawingResult"; radius: number; position: number; polygon: CurvePath; line: CurvePath; picture: unknown; image: Image };
type PointChart = { $tag: "PointLineChart"; points: Point[]; bounds: { $tag: "PointChartBounds"; xMin: number; xMax: number; yMin: number; yMax: number };
  plot: { width: number; height: number; right: number; xAxisY: number; yAxisX: number; path: string;
    marks: Array<{ $tag: "PointChartMark"; x: number; y: number; label: string; value: number; valueLabel: string; title: string }> } };
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, pictureModule, pathModule, loadFenelModule(SOURCE, "DrawingDemo")]);
  context = registry.evaluateContext();
}, 600_000);

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [`DrawingDemo:${name}`, ...args] }, {}, context);
}
const square = { __fenelFn: true, params: ["x"], body: { call: ["mul", { var: "x" }, { var: "x" }] }, closure: {} };
const shiftedLine = { __fenelFn: true, params: ["x"], body: { call: ["add", { var: "x" }, 3] }, closure: {} };
function digest(image: Image): string {
  return createHash("sha256").update(Buffer.from(image.pixels.flatMap(pixel => [pixel.r, pixel.g, pixel.b, pixel.a]))).digest("hex");
}
function imageChecks(image: Image): void {
  expect([image.width, image.height, image.pixels.length]).toEqual([72, 48, 3456]);
  expect(image.pixels.every(pixel => [pixel.r, pixel.g, pixel.b, pixel.a].every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255))).toBe(true);
}

describe("source-owned formula and geometry demo", () => {
  test("the starting formula is a real callable and the same source owns both examples", () => {
    const inputs = call("drawingDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs.map(entry => entry.function)).toEqual([
      { $ref: "DrawingDemo:formulaCurve" }, { $ref: "DrawingDemo:layeredDrawing" }, { $ref: "DrawingDemo:formulaChart" },
    ]);
    expect(inputs[0]!.arguments[0]).toEqual({ $ref: "DrawingDemo:squareFormula" });
    expect(inputs[1]!.arguments).toEqual([8, 51]);
    expect(inputs[2]!.arguments[0]).toEqual({ $ref: "DrawingDemo:squareFormula" });
    const result = call("formulaCurve", inputs[0]!.arguments[0]) as FormulaResult;
    expect(result.points.map(point => point.y)).toEqual(result.points.map(point => point.x * point.x));
  });

  test("point charts preserve numerical x spacing, signed y coordinates and original input order", () => {
    const points = [{ x: -2, y: -4 }, { x: -1, y: 0 }, { x: 4, y: 8 }];
    const chart = call("pointLineChart", points) as PointChart;
    expect(chart.$tag).toBe("PointLineChart");
    expect(chart.points).toEqual(points);
    expect(chart.bounds).toEqual({ $tag: "PointChartBounds", xMin: -2, xMax: 4, yMin: -4, yMax: 8 });
    expect(chart.plot.marks.map(p => [p.x, p.y])).toEqual([[30, 160], [100, 110], [450, 10]]);
    expect(chart.plot.yAxisX).toBe(170);
    expect(chart.plot.xAxisY).toBe(110);
    expect(chart.plot.marks.map(p => [p.label, p.value, p.title])).toEqual([["-2", -4, "(-2, -4)"], ["", 0, "(-1, 0)"], ["4", 8, "(4, 8)"]]);
    expect(chart.plot.path).toBe("M 30 160 L 100 110 L 450 10");
    const unsorted = call("pointLineChart", [points[2], points[0], points[1]]) as PointChart;
    expect(unsorted.points).toEqual([points[2]!, points[0]!, points[1]!]);
    expect(unsorted.plot.marks.map(p => p.title)).toEqual(["(4, 8)", "(-2, -4)", "(-1, 0)"]);
  });

  test("negative, constant, zero, empty and singleton point charts keep finite nonzero domains", () => {
    for (const points of [[], [{ x: 0, y: 0 }], [{ x: 4, y: -3 }], [{ x: -2, y: -3 }, { x: 4, y: -3 }], [{ x: -2, y: 0 }, { x: 4, y: 0 }]]) {
      const chart = call("pointLineChart", points) as PointChart;
      expect(chart.$tag).toBe("PointLineChart");
      expect(chart.bounds.xMax - chart.bounds.xMin).toBeGreaterThan(0);
      expect(chart.bounds.yMax - chart.bounds.yMin).toBeGreaterThan(0);
      expect(chart.plot.marks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(chart.plot.path).not.toMatch(/NaN|Infinity/);
    }
    expect((call("pointLineChart", []) as PointChart).plot.path).toBe("");
    expect((call("pointLineChart", [{ x: 0, y: 0 }]) as PointChart).plot.marks).toEqual([{ $tag: "PointChartMark", x: 30, y: 160, label: "0", value: 0, valueLabel: "0", title: "(0, 0)" }]);
    expect((call("pointLineChart", [{ x: -2, y: -3 }, { x: 4, y: -3 }]) as PointChart).plot.marks.map(p => p.y)).toEqual([160, 160]);
  });

  test("the point chart refuses non-finite and extreme coordinates before producing SVG geometry", () => {
    for (const value of [NaN, Infinity, -Infinity, 1e308, -1e308, 1000001, -1000001]) {
      for (const point of [{ x: value, y: 0 }, { x: 0, y: value }]) {
        expect(call("pointLineChart", [point])).toEqual({ $tag: "PointLineChartRefused", reason: "Coordinates must be finite and between -1000000 and 1000000." });
      }
    }
    const chart = call("pointLineChart", [{ x: -1000000, y: -1000000 }, { x: 1000000, y: 1000000 }]) as PointChart;
    expect(chart.plot.marks.map(p => [p.x, p.y])).toEqual([[30, 160], [450, 10]]);
  });

  test("point chart carriers refuse before projection and recover with actual point data", () => {
    const points = [{ x: -2, y: -4 }, { x: 4, y: 8 }];
    for (const carrier of [undefined, null, {}, "", "points", 7, false, { length: 0 }, { 0: points[0], length: 1 }]) {
      expect(invokeCallable({ $ref: "DrawingDemo:pointLineChart" }, [carrier], context))
        .toEqual({ $tag: "PointLineChartRefused", reason: "Points must be a list." });
      const recovered = invokeCallable({ $ref: "DrawingDemo:pointLineChart" }, [points], context) as PointChart;
      expect(recovered.$tag).toBe("PointLineChart");
      expect(recovered.points).toEqual(points);
      expect(recovered.plot.path).toBe("M 30 160 L 450 10");
    }
    const empty = invokeCallable({ $ref: "DrawingDemo:pointLineChart" }, [[]], context) as PointChart;
    expect(empty.$tag).toBe("PointLineChart");
    expect(empty.points).toEqual([]);
    expect(empty.plot.path).toBe("");
    expect(empty.plot.marks).toEqual([]);
  });

  test("the formula chart shares exact samples and changes its geometry and labels together", () => {
    const squared = call("formulaChart", square) as PointChart;
    const negative = call("formulaChart", { __fenelFn: true, params: ["x"], body: { call: ["sub", { var: "x" }, 3] }, closure: {} }) as PointChart;
    expect(squared.points).toEqual((call("formulaCurve", square) as FormulaResult).points);
    expect(squared.bounds).toEqual({ $tag: "PointChartBounds", xMin: -3, xMax: 3, yMin: 0, yMax: 9 });
    expect(negative.bounds).toEqual({ $tag: "PointChartBounds", xMin: -3, xMax: 3, yMin: -6, yMax: 0 });
    expect(negative.plot.marks.map(p => p.value)).toEqual(negative.points.map(p => p.y));
    expect(negative.plot.path).not.toBe(squared.plot.path);
    expect(negative.plot.marks[0]!.title).toBe("(-3, -6)");
    const instances = loadFenelModule(INSTANCES, "DrawingDemo", { dispatchInstanceFile: true }).instances!;
    expect(instances).toContainEqual(expect.objectContaining({ typeName: "Viewable", args: ["PointLineChart"], methods: { defaultView: "point-line-chart", defaultInlineView: "point-line-chart" } }));
  });

  test("an edited function changes all exact typed samples and the rendered curve", () => {
    const parabola = call("formulaCurve", square) as FormulaResult;
    const linear = call("formulaCurve", shiftedLine) as FormulaResult;
    const xs = Array.from({ length: 25 }, (_, index) => -3 + index / 4);
    expect(parabola.$tag).toBe("FormulaCurveResult");
    expect(parabola.points).toEqual(xs.map(x => ({ x, y: x * x })));
    expect(linear.points).toEqual(xs.map(x => ({ x, y: x + 3 })));
    expect(parabola.curve.anchors).toEqual(parabola.points.map(point => ({ x: 6 + (point.x + 3) * 10, y: 43 - point.y * 3 })));
    expect(parabola.curve.segments).toHaveLength(24);
    expect(parabola.curve.segments.every(segment => JSON.stringify(segment) === JSON.stringify({ $ref: "path:line" }))).toBe(true);
    for (let index = 0; index < 24; index++) {
      const a = parabola.curve.anchors[index]!;
      const b = parabola.curve.anchors[index + 1]!;
      expect(evaluate({ call: [parabola.curve.segments[index], 0.5, a, b] }, {}, context)).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    imageChecks(parabola.image);
    imageChecks(linear.image);
    expect(digest(parabola.image)).toBe("40ceb3219615d55f2912180c7efcfeb49ec301ee02befdcfb1b6e80d922244a9");
    expect(digest(parabola.image)).not.toBe(digest(linear.image));
    expect(digest(parabola.image)).toBe(digest((call("formulaCurve", square) as FormulaResult).image));
    expect(parabola.explanation).toContain("25 samples");
    expect(parabola.explanation).toContain("canvas edges");
  });

  test("circle edits preserve the paths and background while updating the correct layer", () => {
    const original = call("layeredDrawing", 8, 51) as DrawingResult;
    const larger = call("layeredDrawing", 12, 51) as DrawingResult;
    const moved = call("layeredDrawing", 8, 23) as DrawingResult;
    expect(original.$tag).toBe("LayeredDrawingResult");
    expect(original.polygon.anchors).toEqual([{ x: 7, y: 41 }, { x: 26, y: 20 }, { x: 43, y: 41 }, { x: 7, y: 41 }]);
    expect(original.polygon.segments).toHaveLength(3);
    expect(original.line.anchors).toEqual([{ x: 5, y: 8 }, { x: 66, y: 38 }]);
    expect(original.line.segments).toHaveLength(1);
    for (const result of [original, larger, moved]) imageChecks(result.image);
    expect(digest(original.image)).toBe("570f1b216c6aa7abeb1474aff0c3b0ea1580dcaebf7c4539ad3a0d230f116ef5");
    expect(larger.polygon).toEqual(original.polygon);
    expect(moved.line).toEqual(original.line);
    expect(digest(original.image)).not.toBe(digest(larger.image));
    expect(digest(original.image)).not.toBe(digest(moved.image));
    const at = (image: Image, x: number, y: number) => image.pixels[y * image.width + x];
    expect(at(original.image, 0, 0)).toEqual({ r: 245, g: 247, b: 250, a: 255 });
    expect(at(original.image, 51, 16)).toEqual({ r: 239, g: 169, b: 73, a: 255 });
    expect(at(original.image, 26, 30)).toEqual({ r: 126, g: 199, b: 153, a: 255 });
    expect(at(moved.image, 23, 16)).toEqual({ r: 239, g: 169, b: 73, a: 255 });
    expect(at(moved.image, 51, 16)).toEqual({ r: 245, g: 247, b: 250, a: 255 });
  });

  test("the existing strict checker accepts bounded controls and refuses invalid carriers", () => {
    const fn = registry.getFunction("DrawingDemo:layeredDrawing")!;
    const options = { registry, coerce: false, strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    for (const [index, valid, invalid] of [[0, [2, 8, 12], [1, 13, 2.5, "8"]], [1, [16, 23.5, 56], [15, 57, "51"]]] as const) {
      for (const value of valid) expect(validateValue(fn.params[index]!.type, value, null, options).valid, `${index}=${value}`).toBe(true);
      for (const value of invalid) expect(validateValue(fn.params[index]!.type, value, null, options).valid, `${index}=${value}`).toBe(false);
    }
    expect(fn.body).toBeDefined();
    expect(registry.getFunction("DrawingDemo:formulaCurve")!.params[0]!.type).toHaveProperty("$arrow");
  }, 600_000);

  test("whole-file native parser matches its compatibility oracle", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    const source = SOURCE.replace(/\r\n?/g, "\n");
    const native = parseViaFenelParser(source);
    expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(native).toEqual(JSON.parse(JSON.stringify(parse(source))));
  }, 600_000);

  // LAUNCH-PLAN row 9: a function card's sampled plot.
  test("a function graph samples 51 points over its range and draws the shared chart", () => {
    const chart = call("functionGraph", square, -5, 5) as PointChart;
    expect(chart.$tag).toBe("PointLineChart");
    expect(chart.points).toHaveLength(51);
    expect(chart.points[0]).toEqual({ x: -5, y: 25 });
    expect(chart.points[25]).toEqual({ x: 0, y: 0 });
    expect(chart.points[50]).toEqual({ x: 5, y: 25 });
    expect(chart.bounds).toEqual({ $tag: "PointChartBounds", xMin: -5, xMax: 5, yMin: 0, yMax: 25 });
    expect(chart.plot.marks).toHaveLength(51);
    expect(chart.plot.path.startsWith("M 30 10 L ")).toBe(true);
    expect(chart.plot.path).not.toMatch(/ M |NaN|Infinity/);
    const shifted = call("functionGraph", shiftedLine, 16, 56) as PointChart;
    expect([shifted.points[0], shifted.points[50]]).toEqual([{ x: 16, y: 19 }, { x: 56, y: 59 }]);
  });

  test("non-finite samples leave gaps instead of refusing the whole graph", () => {
    const reciprocal = { __fenelFn: true, params: ["x"], body: { if: [{ "==": [{ var: "x" }, 0] }, Number.NaN, { call: ["div", 1, { var: "x" }] }] }, closure: {} };
    const chart = call("functionGraph", reciprocal, -5, 5) as PointChart;
    expect(chart.$tag).toBe("PointLineChart");
    expect(chart.points).toHaveLength(50);
    expect(chart.points.some(point => point.x === 0)).toBe(false);
    expect(chart.plot.path.match(/M /g)).toHaveLength(2);
    expect(chart.plot.path).not.toMatch(/NaN|Infinity/);
    const nothing = { __fenelFn: true, params: ["x"], body: Number.NaN, closure: {} };
    expect((call("functionGraph", nothing, -5, 5) as { $tag: string }).$tag).toBe("PointLineChartRefused");
    expect((call("functionGraph", square, 5, -5) as { $tag: string }).$tag).toBe("PointLineChartRefused");
  });
});

describe("public drawing source in the checked repository profile", () => {
  let product: ModuleRegistry;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { publicDrawingDemoModule }] = await Promise.all([
      import("./module-manifest"), import("./repository-registry"), import("./modules/public-demos"),
    ]);
    expect(modulesFor("seed").includes(publicDrawingDemoModule)).toBe(true);
    expect(modulesFor("execute").includes(publicDrawingDemoModule)).toBe(true);
    product = createRepositoryRegistry(modulesFor("seed"));
  }, 900_000);

  test("exact public identities retain the authored arrow, result and named field handles", () => {
    for (const member of ["formulaCurve", "layeredDrawing", "formulaChart", "pointLineChart"]) {
      const id = `DrawingDemo:${member}`;
      const handle = product.getUuid(id)!;
      expect(handle).toMatch(/^[0-9a-f-]{36}$/i);
      expect(product.getFunction(handle)?.id).toBe(id);
      expect(product.getFunction(`DrawingDemo.${member}`)?.id).toBe(id);
      const fn = product.getIdentifiedFunction(handle)!;
      expect(product.getFunctionSignatureInfo(handle)!.outcome.$tag).toBe("Solved");
      for (const field of fn.params) {
        expect(field.key?.$tag).toBe("NamedField");
        if (field.key?.$tag !== "NamedField") throw new Error("Public arguments need their exact named field identity");
        expect(product.getFieldIdentityByHandle(field.key.ref.$ref)?.field.name).toBe(field.name);
      }
    }
    expect(product.getFunction("DrawingDemo:formulaCurve")!.params[0]!.type).toHaveProperty("$arrow");
  });

  test("source input transport and UUID execution preserve callable data and pinned image bytes", () => {
    const context = product.evaluateContext();
    const provider = product.getUuid("DrawingDemo:drawingDemoStartingInputs")!;
    const inputs = evaluate({ call: [{ $ref: provider }] }, {}, context) as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs).toHaveLength(3);
    expect(inputs[0]!.arguments[0]).toEqual({ $ref: product.getUuid("DrawingDemo:squareFormula") });
    expect(inputs[2]!.function).toEqual({ $ref: product.getUuid("DrawingDemo:formulaChart")! });
    expect((evaluate({ call: [inputs[2]!.function, ...inputs[2]!.arguments] }, {}, context) as PointChart).bounds).toEqual({ $tag: "PointChartBounds", xMin: -3, xMax: 3, yMin: 0, yMax: 9 });
    for (const [index, member, expected] of [
      [0, "formulaCurve", "40ceb3219615d55f2912180c7efcfeb49ec301ee02befdcfb1b6e80d922244a9"],
      [1, "layeredDrawing", "570f1b216c6aa7abeb1474aff0c3b0ea1580dcaebf7c4539ad3a0d230f116ef5"],
    ] as const) {
      const handle = product.getUuid(`DrawingDemo:${member}`)!;
      expect(inputs[index]!.function).toEqual({ $ref: handle });
      const result = evaluate({ call: [inputs[index]!.function, ...inputs[index]!.arguments] }, {}, context) as FormulaResult | DrawingResult;
      imageChecks(result.image);
      expect(digest(result.image)).toBe(expected);
    }
  }, 600_000);

});
