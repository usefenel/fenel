import { beforeAll, describe, expect, test } from "bun:test";
import mediaSource from "../../../../../fenel/modules/std/media-types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { createRegistry, type ModuleRegistry } from "../registry";
import { inferJsonLogicType, type JsonLogicInferenceOptions } from "../signature-inference";
import { projectAuthoringScheme } from "../authoring/call-guidance";
import { peelListForAuthoring } from "../authoring/type-authoring";
import { imgGrayscale, imgInvert, imgPixelate, imgSolid } from "../image-ops";
import type { FenelType, TypeScheme } from "../types";

function recordFields(type: FenelType) {
  if (!("$record" in type)) throw new Error("expected a raw record type");
  return type.$record.fields;
}

function hasAnonymousMediaRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasAnonymousMediaRecord);
  const record = (value as { $record?: { fields: { name: string }[] } }).$record;
  if (record) {
    const names = new Set(record.fields.map((field) => field.name));
    if (["width", "height", "pixels"].every((name) => names.has(name))
      || ["r", "g", "b", "a"].every((name) => names.has(name))) return true;
  }
  return Object.values(value).some(hasAnonymousMediaRecord);
}

function rootNominal(scheme: TypeScheme): string | undefined {
  return scheme.nominals?.find((nominal) => nominal.path.length === 0)?.identity;
}

describe("shared Image and RgbaPixel declarations", () => {
  test("declares raw records and keeps the pixel element as the common RgbaPixel reference", () => {
    const media = loadFenelModule(mediaSource, "std-media-types");
    const color = media.entities?.find((entry) => entry.id === "RgbaPixel");
    const image = media.entities?.find((entry) => entry.id === "Image");
    expect(color).toBeDefined();
    expect(image).toBeDefined();
    expect(Object.keys(color!.type)).toEqual(["$record"]);
    expect(Object.keys(image!.type)).toEqual(["$record"]);
    expect(recordFields(color!.type).map((field) => [field.name, field.type])).toEqual([
      ["r", { $ref: "Nat" }], ["g", { $ref: "Nat" }],
      ["b", { $ref: "Nat" }], ["a", { $ref: "Nat" }],
    ]);
    const fields = recordFields(image!.type);
    expect(fields.map((field) => field.name)).toEqual(["width", "height", "pixels"]);
    expect(fields.slice(0, 2).map((field) => field.type)).toEqual([{ $ref: "Nat" }, { $ref: "Nat" }]);
    expect(peelListForAuthoring(fields[2]!.type)?.elem).toEqual({ $ref: "RgbaPixel" });
  }, 180_000);

  test("native image data keeps its existing untagged pixel and image carriers", () => {
    const input = imgSolid(2, 1, 10, 20, 30, 128);
    const original = structuredClone(input);
    expect(input).toEqual({
      width: 2, height: 1,
      pixels: [{ r: 10, g: 20, b: 30, a: 128 }, { r: 10, g: 20, b: 30, a: 128 }],
    });
    expect(imgInvert(input)).toEqual({
      width: 2, height: 1,
      pixels: [{ r: 245, g: 235, b: 225, a: 128 }, { r: 245, g: 235, b: 225, a: 128 }],
    });
    const processed = imgPixelate(imgGrayscale(input), 1);
    expect(Object.keys(processed).sort()).toEqual(["height", "pixels", "width"]);
    for (const pixel of processed.pixels) {
      expect(Object.keys(pixel).sort()).toEqual(["a", "b", "g", "r"]);
      expect(pixel.r).toBe(pixel.g);
      expect(pixel.g).toBe(pixel.b);
      expect(pixel.a).toBe(128);
    }
    expect(input).toEqual(original);
    expect(imgInvert({ width: 0, height: 0, pixels: [] })).toEqual({ width: 0, height: 0, pixels: [] });
  });
});

describe("image function type composition", () => {
  let registry: ModuleRegistry;
  beforeAll(async () => {
    const { stdModule } = await import("./std");
    registry = createRegistry([stdModule], {
      publishCatalogEntities: false,
      fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source" },
    });
  }, 180_000);

  function schemeFor(id: string): TypeScheme {
    const scheme = registry.getFunctionScheme(id);
    if (!scheme) throw new Error(`${id}: ${JSON.stringify(registry.getFunctionSignatureInfo(id)?.outcome)}`);
    return scheme;
  }

  function projection(id: string, path: string[]): TypeScheme {
    const projected = projectAuthoringScheme(schemeFor(id), path);
    if (!projected) throw new Error(`missing type at ${id}:${path.join(".")}`);
    return projected;
  }

  const parameter = (id: string, index: number) => projection(id, ["$arrow", "params", String(index), "type"]);
  const returned = (id: string) => projection(id, ["$arrow", "returns"]);

  function options(bindings: JsonLogicInferenceOptions["bindings"]): JsonLogicInferenceOptions {
    return {
      bindings,
      resolveFunction(id) {
        const fn = registry.getIdentifiedFunction(id);
        if (!fn) return undefined;
        return {
          params: fn.params, returns: fn.returns, scheme: registry.getFunctionScheme(id),
          targetId: fn.id, signatureOutcome: registry.getFunctionSignatureInfo(id)?.outcome,
        };
      },
    };
  }

  test("uses one Image entity identity across all image function signatures", () => {
    const image = registry.getIdentifiedEntity("Image");
    const color = registry.getIdentifiedEntity("RgbaPixel");
    expect(image).toBeDefined();
    expect(color).toBeDefined();
    for (const entity of [image!, color!]) {
      const fields = recordFields(entity.type);
      const keys = fields.map((field) => field.key?.$tag === "NamedField" ? field.key.ref.$ref : undefined);
      expect(keys.every((key) => key !== undefined)).toBe(true);
      expect(new Set(keys).size).toBe(fields.length);
    }
    const functions = registry.listFunctions().filter((fn) => fn.id.startsWith("std:image"));
    const imageResults = functions.filter((fn) => "$ref" in fn.returns && fn.returns.$ref === "Image");
    const nonImageHelpers = new Set([
      "std:imageSourceByte", "std:imageSourcePixel", "std:imageSourceOverPixel", "std:imageSourcePixelAt",
      "std:imageSourceOverlayPixel", "std:imageSourceIndicesFrom", "std:imageSourceKernel", "std:imageSourceKernelTap",
      "std:imageSourceConvolvedSum", "std:imageSourceConvolvedPixel",
    ]);
    // Public raster operations retain their Image result independently of
    // the source pixel/byte/kernel helpers that share the image name prefix.
    for (const id of ["std:imageSample", "std:imageRetro", "std:imageGaussianBlur", "std:imageBoxBlur", "std:imageOverlay"]) {
      expect(imageResults.some((fn) => fn.id === id), `${id} must return Image`).toBe(true);
    }
    expect(registry.getFunction("std:imageSourceByte")?.returns).toEqual({ $ref: "Nat" });
    for (const id of ["std:imageSourcePixel", "std:imageSourceOverPixel", "std:imageSourcePixelAt", "std:imageSourceOverlayPixel", "std:imageSourceConvolvedPixel"]) {
      expect(registry.getFunction(id)?.returns, id).toEqual({ $ref: "RgbaPixel" });
    }
    const kernelTap = registry.getFunction("std:imageSourceKernelTap")!.returns;
    for (const id of ["std:imageSourceIndicesFrom", "std:imageSourceKernel"]) {
      const result = registry.getFunction(id)!.returns;
      if (!("$opaque" in result) || result.$opaque.pure === undefined || !("$variant" in result.$opaque.pure)) throw new Error(`${id} must declare the existing List representation`);
      expect(result.$opaque.name, id).toBe("List");
      const element = result.$opaque.pure.$variant.cases.find(entry => entry.name === "Cons")?.fields?.find(field => field.name === "head")?.type;
      expect(element, `${id} list element`).toBeDefined();
      if (id === "std:imageSourceIndicesFrom") expect(element).toEqual({ $ref: "Number" });
      else expect(Object.fromEntries(recordFields(element!).map(field => [field.name, field.type]))).toEqual({
        x: { $ref: "Number" }, y: { $ref: "Number" }, weight: { $ref: "Number" },
      });
    }
    expect(Object.fromEntries(recordFields(kernelTap).map(field => [field.name, field.type]))).toEqual({
      x: { $ref: "Number" }, y: { $ref: "Number" }, weight: { $ref: "Number" },
    });
    const identity = rootNominal(returned("std:imageSample"));
    expect(identity).toBeDefined();
    for (const fn of functions) {
      if (!nonImageHelpers.has(fn.id)) expect(fn.returns, `${fn.id} must return Image`).toEqual({ $ref: "Image" });
      expect(hasAnonymousMediaRecord([fn.params, fn.returns]), fn.id).toBe(false);
      if (imageResults.includes(fn)) {
        expect(fn.returns, fn.id).toEqual({ $ref: "Image" });
        expect(rootNominal(returned(fn.id)), fn.id).toBe(identity);
      }
      fn.params.forEach((param, index) => {
        if ("$ref" in param.type && param.type.$ref === "Image") {
          expect(rootNominal(parameter(fn.id, index)), `${fn.id}:${param.name}`).toBe(identity);
        }
      });
    }
  }, 180_000);

  test("nested generators and transforms infer Image without per-call record field mismatches", () => {
    const result = inferJsonLogicType({
      call: ["std:imageRetro", {
        call: ["std:imagePosterize", { call: ["std:imageSample", { var: "sample" }] }, { var: "levels" }],
      }, { var: "factor" }],
    }, options({
      sample: parameter("std:imageSample", 0),
      levels: parameter("std:imagePosterize", 1),
      factor: parameter("std:imageRetro", 1),
    }));
    expect(result.outcome.$tag, JSON.stringify(result.outcome)).toBe("Solved");
    expect(result.type).toEqual({ $ref: "Image" });
    expect(rootNominal(result.scheme!)).toBe(rootNominal(returned("std:imageSample")));
  }, 180_000);

  test("typed Image input composes through different transforms and still rejects a scalar input", () => {
    const bindings = {
      image: parameter("std:imageGrayscale", 0),
      factor: parameter("std:imagePixelate", 1),
    };
    const result = inferJsonLogicType({
      call: ["std:imagePixelate", { call: ["std:imageGrayscale", { var: "image" }] }, { var: "factor" }],
    }, options(bindings));
    expect(result.outcome.$tag, JSON.stringify(result.outcome)).toBe("Solved");
    expect(result.type).toEqual({ $ref: "Image" });
    expect(inferJsonLogicType({ call: ["std:imageGrayscale", { var: "factor" }] }, options(bindings)).outcome.$tag)
      .toBe("Invalid");
  }, 180_000);
});
