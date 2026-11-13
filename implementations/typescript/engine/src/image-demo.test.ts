import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import imageDemoSource from "../../../../fenel/examples/image-demo.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { evaluate, type EvaluateContext } from "./json-logic";
import { stdModule } from "./modules/std";
import { createRegistry, type ModuleRegistry } from "./registry";
import { peelList, peelToVariant } from "./set-algebra";
import { peelListForAuthoring, peelResultForAuthoring } from "./authoring/type-authoring";
import type { FenelType } from "./types";
import { validateValue } from "./validate";

// C1 source fixture: the complete Fenel demo composes the shipped image leaves
// and higher-order map. It adds neither a helper native nor a gallery renderer.
type Pixel = { r: number; g: number; b: number; a: number };
type Image = { width: number; height: number; pixels: Pixel[] };
type Results = {
  $tag: "ImageFilterResults";
  radius: number; factor: number;
  original: Image; grayscale: Image; blurred: Image; edges: Image; retro: Image;
  inputImages: Image[]; filteredImages: Image[];
};
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, loadFenelModule(imageDemoSource, "ImageDemo")]);
  context = registry.evaluateContext();
}, 180_000);

function run(radius = 2, factor = 4): Results {
  return evaluate({ call: ["ImageDemo:imageFilterDemo", radius, factor] }, {}, context) as Results;
}

function digest(image: Image): string {
  return createHash("sha256").update(Buffer.from(image.pixels.flatMap((pixel) => [pixel.r, pixel.g, pixel.b, pixel.a]))).digest("hex");
}

describe("joined Fenel image demo", () => {
  test("the callable declares bounded parameters and every output's actual image type", () => {
    const fn = registry.getFunction("ImageDemo:imageFilterDemo")!;
    expect(fn.returns).toEqual({ $ref: "ImageFilterResults" });
    for (const [index, name, bounds] of [[0, "ImageBlurRadius", [0, 4]], [1, "ImagePixelSize", [1, 12]]] as const) {
      expect(fn.params[index]!.type).toEqual({ $ref: name });
      const type = registry.getEntity(name)!.type;
      expect(type).toHaveProperty("$refined");
      if (!("$refined" in type)) throw new Error("Filter parameters must retain their bounds");
      expect(type.$refined.base).toEqual({ $ref: "Nat" });
      expect(type.$refined.set).toMatchObject({
        $tag: "SeInterval",
        interval: {
          lo: { $tag: "Just", _0: { value: bounds[0], inclusive: true } },
          hi: { $tag: "Just", _0: { value: bounds[1], inclusive: true } },
        },
      });
    }
    const resultType = registry.getEntity("ImageFilterResults")!.type;
    if (!("$variant" in resultType)) throw new Error("The declared result must preserve its tagged constructor");
    const variant = resultType.$variant;
    expect(variant.discriminator).toBe("$tag");
    expect(variant.cases.map((entry) => entry.name)).toEqual(["ImageFilterResults"]);
    const fields = new Map(variant.cases[0]!.fields!.map((field) => [field.name, field.type]));
    for (const name of ["original", "grayscale", "blurred", "edges", "retro"]) {
      expect(fields.get(name)).toEqual({ $ref: "Image" });
    }
    for (const name of ["inputImages", "filteredImages"]) {
      expect(peelList(fields.get(name) as FenelType)?.elem).toEqual({ $ref: "Image" });
    }
    expect(fn.body).toBeDefined();
  });

  test("one original landscape produces named, deterministic images and a three-image map", () => {
    const result = run();
    expect(result.$tag).toBe("ImageFilterResults");
    expect(result.radius).toBe(2);
    expect(result.factor).toBe(4);
    expect(result.original).toEqual(evaluate({ call: ["std:imageSample", 0] }, {}, context) as Image);
    const images = [result.original, result.grayscale, result.blurred, result.edges, result.retro, ...result.inputImages, ...result.filteredImages];
    for (const image of images) {
      expect(image.width).toBe(96);
      expect(image.height).toBe(56);
      expect(image.pixels.length).toBe(96 * 56);
      expect(image.pixels.every((pixel) => [pixel.r, pixel.g, pixel.b, pixel.a].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255))).toBe(true);
    }
    expect(result.inputImages.length).toBe(3);
    expect(result.filteredImages.length).toBe(3);
    expect(result.inputImages[0]).toEqual(result.original);
    expect(result.filteredImages[0]).toEqual(result.retro);
    expect(result.grayscale.pixels.every((pixel) => pixel.r === pixel.g && pixel.g === pixel.b)).toBe(true);
    expect(result).toEqual(run());
    for (let index = 0; index < result.inputImages.length; index++) {
      expect(result.filteredImages[index]).toEqual(evaluate({ call: ["ImageDemo:retroLandscape", 4, result.inputImages[index]] }, {}, context) as Image);
    }
    // Pinned after evaluating the full authored module, including the original
    // sample and each composed filter. Never synthesize a displayed answer.
    expect(Object.fromEntries(["original", "grayscale", "blurred", "edges", "retro"].map((name) => [name, digest(result[name as keyof Results] as Image)]))).toEqual({
      original: "5242ac46848180d881f79872e726f2aecccac935c1fe32f42da56be401d20850",
      grayscale: "7f686cdb0a98d463646025b1173f43d14c864d9532fadee956dd1e419932ded6",
      blurred: "b372ca850a02d57a236165546ced2d988678742c573766a3b88f5c82f624c5b1",
      edges: "85bbb9316f1976556d7e721f645387785b8ff442e5e662fa5193adc194562a06",
      retro: "56a623fe75b16b40d1a32e09c4578b7c9dd84de64f5857b6296d7254d55488b2",
    });
  });

  test("edited filter parameters affect their named outputs and the mapped list", () => {
    const unchanged = run(0, 1);
    const filtered = run(3, 8);
    expect(unchanged.blurred).toEqual(unchanged.grayscale);
    expect(unchanged.retro).toEqual(unchanged.grayscale);
    expect(unchanged.original).toEqual(filtered.original);
    expect(unchanged.grayscale).toEqual(filtered.grayscale);
    expect(digest(unchanged.blurred)).not.toBe(digest(filtered.blurred));
    expect(digest(unchanged.edges)).not.toBe(digest(filtered.edges));
    expect(digest(unchanged.retro)).not.toBe(digest(filtered.retro));
    for (let index = 0; index < unchanged.filteredImages.length; index++) {
      expect(digest(unchanged.filteredImages[index]!)).not.toBe(digest(filtered.filteredImages[index]!));
    }
  });

  test("the supplied photograph and extended Fenel editing chain evaluate to valid changed images", () => {
    const images = ["marketPhoto", "marketPhotoPipeline"].map((name) => {
      const id = `ImageDemo:${name}`;
      const fn = registry.getFunction(id)!;
      expect(fn.params).toEqual([]);
      expect(fn.returns).toEqual({ $ref: "Image" });
      expect(fn.body).toBeDefined();
      const callStart = performance.now();
      const image = evaluate({ call: [id] }, {}, context) as Image;
      console.log(`Actual Fenel ${name}: ${Math.round(performance.now() - callStart)} ms`);
      return image;
    });
    for (const image of images) {
      expect(image.width).toBe(96);
      expect(image.height).toBe(128);
      expect(image.pixels.length).toBe(96 * 128);
      expect(image.pixels.every((pixel) => [pixel.r, pixel.g, pixel.b, pixel.a]
        .every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255))).toBe(true);
      expect(image.pixels.every((pixel) => pixel.a === 255)).toBe(true);
      expect(new Set(image.pixels.map((pixel) => `${pixel.r},${pixel.g},${pixel.b}`)).size).toBeGreaterThan(1);
    }
    // Pinned from the preserved photograph's original decoded RGBA bytes.
    // Compact source decoding and byte normalization must preserve them exactly.
    expect(digest(images[0]!)).toBe("4a3dce8ab45af851a339990fe2c0ac2390b61ceea249e95471c6c277e7f1b20b");
    expect(digest(images[1]!)).not.toBe(digest(images[0]!));
    // The same nested expression was checked through the live Local renderer.
    expect(digest(images[1]!)).toBe("701a450912b86713f7f98d69d1f4e4896ff895cf716c2d9cfdb880b2e1e283b1");
    const edited = images[1]!;
    // Sepia orders channels r >= g >= b; the requested inversion reverses
    // that order. Positive box/block averages preserve it outside the stamp.
    const outsideStamp = edited.pixels.filter((_pixel, index) => index % edited.width >= 48 || Math.floor(index / edited.width) >= 28);
    expect(outsideStamp.every(pixel => pixel.r <= pixel.g && pixel.g <= pixel.b)).toBe(true);
    // The existing coloured landscape is composited only at the upper-left;
    // its green pixels visibly break the negative photo's blue channel order.
    const stamp = edited.pixels.filter((_pixel, index) => index % edited.width < 48 && Math.floor(index / edited.width) < 28);
    expect(stamp.some(pixel => pixel.g > pixel.b)).toBe(true);
  }, 60_000);

  test("the canonical build-verification whole-file parser agrees with the performance parser", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    const source = imageDemoSource.replace(/\r\n?/g, "\n");
    const actual = parseViaFenelParser(source, { mode: "build-verification" });
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(actual).toEqual(JSON.parse(JSON.stringify(parse(source))));
  }, 60_000);
});

describe("ordinary typed image rows", () => {
  type Checked<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
  type MatrixResults = {
    $tag: "ImageMatrixResults";
    original: Image; originalRows: Pixel[][];
    width: number; height: number; rows: Pixel[][]; image: Image;
    explanation: string;
  };

  function call<T = unknown>(name: string, ...args: unknown[]): T {
    return evaluate({ call: [`ImageDemo:${name}`, ...args] }, {}, context) as T;
  }

  function sample(): Image { return call("imageMatrixSample"); }
  function rows(): Pixel[][] { return call("imageMatrixSampleRows"); }
  function fromRows(width: unknown, height: unknown, data: unknown): Checked<Image> {
    return call("imageFromRows", width, height, data);
  }

  test("the source retains Image's flat pixels and declares the nested rows as a projection", () => {
    const authored = loadFenelModule(imageDemoSource, "ImageDemo");
    const source = registry.getEntity("Image")!.type;
    if (!("$record" in source)) throw new Error("Image must retain its existing record encoding");
    expect(source.$record.fields.map((field) => field.name)).toEqual(["width", "height", "pixels"]);
    expect(peelListForAuthoring(source.$record.fields[2]!.type)?.elem).toEqual({ $ref: "RgbaPixel" });
    const projection = authored.functions!.find((fn) => fn.id === "ImageDemo:imageRows")!;
    expect(projection.params[0]!.type).toEqual({ $ref: "Image" });
    const projected = peelResultForAuthoring(projection.returns)!.ok;
    expect(peelListForAuthoring(peelListForAuthoring(projected)!.elem)?.elem).toEqual({ $ref: "RgbaPixel" });
    const reconstruction = authored.functions!.find((fn) => fn.id === "ImageDemo:imageFromRows")!;
    expect(reconstruction.params.slice(0, 2).map((param) => param.type)).toEqual([{ $ref: "Nat" }, { $ref: "Nat" }]);
    expect(peelListForAuthoring(peelListForAuthoring(reconstruction.params[2]!.type)!.elem)?.elem).toEqual({ $ref: "RgbaPixel" });
    expect(peelResultForAuthoring(reconstruction.returns)!.ok).toEqual({ $ref: "Image" });
    for (const name of ["imageRows", "imageFromRows", "imageMatrixDemo"]) {
      expect(authored.functions!.find((fn) => fn.id === `ImageDemo:${name}`)!.body).toBeDefined();
    }
  });

  test("the non-square sample projects and reconstructs in exact row-major order", () => {
    const image = sample();
    const matrix = rows();
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
    expect(matrix.map((row) => row.length)).toEqual([3, 3]);
    expect(image.pixels).toEqual(matrix.flat());
    expect(call<Checked<Pixel[][]>>("imageRows", image)).toEqual({ $tag: "Ok", _0: matrix });
    expect(fromRows(3, 2, matrix)).toEqual({ $tag: "Ok", _0: image });
    expect(image.pixels.map((pixel) => [pixel.r, pixel.g, pixel.b, pixel.a])).toEqual([
      [239, 68, 68, 255], [59, 130, 246, 255], [250, 204, 21, 255],
      [168, 85, 247, 255], [255, 255, 255, 255], [30, 41, 59, 255],
    ]);
  });

  test("one ordinary RgbaPixel edit changes its matching pixel while preserving the original", () => {
    const original = sample();
    const edited = rows();
    const pixel = { r: 10, g: 20, b: 30, a: 128 };
    edited[1]![1] = pixel;
    const result = call<Checked<MatrixResults>>("imageMatrixDemo", 3, 2, edited);
    expect(result.$tag).toBe("Ok");
    if (result.$tag !== "Ok") throw new Error(result._0);
    expect(result._0.original).toEqual(original);
    expect(result._0.originalRows).toEqual(rows());
    expect(result._0.rows).toEqual(edited);
    expect(result._0.image).toEqual({ ...original, pixels: original.pixels.map((value, index) => index === 4 ? pixel : value) });
    expect(sample()).toEqual(original);
    expect(call<Checked<Pixel[][]>>("imageRows", result._0.image)).toEqual({ $tag: "Ok", _0: edited });
  });

  test("small, non-square and zero dimensions keep their rows and round-trip without resizing", () => {
    const pixel = rows()[0]![0]!;
    for (const [width, height] of [[1, 1], [2, 3], [0, 0], [0, 3], [3, 0], [16, 1]] as const) {
      const matrix = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ...pixel })));
      const image = { width, height, pixels: matrix.flat() };
      expect(fromRows(width, height, matrix)).toEqual({ $tag: "Ok", _0: image });
      expect(call<Checked<Pixel[][]>>("imageRows", image)).toEqual({ $tag: "Ok", _0: matrix });
    }
    const empty = call<Image>("imageMatrixEmpty");
    expect(empty).toEqual({ width: 0, height: 0, pixels: [] });
    expect(call<Checked<Pixel[][]>>("imageRows", empty)).toEqual({ $tag: "Ok", _0: [] });
  });

  test("invalid dimensions, row counts, ragged rows and flat pixel counts are refused", () => {
    for (const invalid of [-1, 0.5, 17, NaN, Infinity, "3"]) {
      expect(fromRows(invalid, 2, rows()).$tag).toBe("Err");
      expect(fromRows(3, invalid, rows()).$tag).toBe("Err");
      expect(call<Checked<Pixel[][]>>("imageRows", { ...sample(), width: invalid }).$tag).toBe("Err");
    }
    for (const invalid of [[], [rows()[0]], [[...rows()[0]!, rows()[0]![0]], rows()[1]], [rows()[0], []], "rows", [rows()[0], "row"]]) {
      expect(fromRows(3, 2, invalid).$tag).toBe("Err");
    }
    for (const invalid of [[], sample().pixels.slice(1), [...sample().pixels, rows()[0]![0]!], "pixels"]) {
      expect(call<Checked<Pixel[][]>>("imageRows", { ...sample(), pixels: invalid }).$tag).toBe("Err");
    }
  });

  test("byte-channel validation refuses malformed RgbaPixels instead of clipping or coercing them", () => {
    for (const channel of ["r", "g", "b", "a"] as const) {
      for (const invalid of [-1, 0.5, 256, NaN, Infinity, "20", null]) {
        const matrix = rows();
        const malformed = { ...matrix[0]![0]!, [channel]: invalid };
        matrix[0]![0] = malformed as Pixel;
        expect(fromRows(3, 2, matrix).$tag, `${channel}=${invalid}`).toBe("Err");
        expect(call<Checked<Pixel[][]>>("imageRows", { ...sample(), pixels: matrix.flat() }).$tag).toBe("Err");
      }
    }
    const malformed = rows();
    malformed[0]![0] = { r: 0, g: 0, b: 0 } as Pixel;
    expect(fromRows(3, 2, malformed).$tag).toBe("Err");
  });

  test("a refused edit recovers with the corrected rows and source-owned starting inputs", () => {
    const correct = call<Checked<MatrixResults>>("imageMatrixDemo", 3, 2, rows());
    expect(call<Checked<MatrixResults>>("imageMatrixDemo", 3, 2, [rows()[0]!]).$tag).toBe("Err");
    expect(call<Checked<MatrixResults>>("imageMatrixDemo", 3, 2, rows())).toEqual(correct);
    const starting = call<{ function: unknown; arguments: unknown[] }[]>("imageDemoStartingInputs");
    expect(starting.some((entry) => entry.arguments.length === 3 && entry.arguments[0] === 3 && entry.arguments[1] === 2 && JSON.stringify(entry.arguments[2]) === JSON.stringify(rows()))).toBe(true);
  });

});

describe("public image demo in the repository seed profile", () => {
  let product: ModuleRegistry;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { publicImageDemoModule }] = await Promise.all([
      import("./module-manifest"),
      import("./repository-registry"),
      import("./modules/public-demos"),
    ]);
    const modules = modulesFor("seed");
    expect(modules.includes(publicImageDemoModule)).toBe(true);
    product = createRepositoryRegistry(modules);
  }, 900_000);

  test("checked public matrix signatures and strict typed rows retain Image and RgbaPixel identities", () => {
    for (const name of ["imageRows", "imageFromRows", "imageMatrixDemo", "imageMatrixSample", "imageMatrixSampleRows", "imageMatrixEmpty"]) {
      const id = `ImageDemo:${name}`;
      const info = product.getFunctionSignatureInfo(id)!;
      expect(info.outcome.$tag, `${id}: ${JSON.stringify(info.outcome)}`).toBe("Solved");
      expect(product.getFunctionScheme(id)).toBeDefined();
    }
    const fn = product.getIdentifiedFunction("ImageDemo:imageMatrixDemo")!;
    const publicContext = product.evaluateContext();
    const matrix = evaluate({ call: ["ImageDemo:imageMatrixSampleRows"] }, {}, publicContext) as Pixel[][];
    const options = { registry: product, coerce: false, strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    const valid = validateValue(fn.params[2]!.type, matrix, null, options);
    expect(valid.valid, JSON.stringify(valid.errors)).toBe(true);
    for (const pixel of [{ r: -1, g: 0, b: 0, a: 255 }, { r: "0", g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0 }]) {
      const malformed = structuredClone(matrix);
      malformed[0]![0] = pixel as Pixel;
      expect(validateValue(fn.params[2]!.type, malformed, null, options).valid).toBe(false);
    }
    const result = evaluate({ call: ["ImageDemo:imageMatrixDemo", 3, 2, matrix] }, {}, publicContext);
    const checked = validateValue(fn.returns, result, null, options);
    expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
    expect(checked.value).toEqual(result);
  }, 180_000);

  test("public source and UUID references retain checked signatures and field identities", () => {
    const id = "ImageDemo:imageFilterDemo";
    const uuid = product.getUuid(id)!;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(product.getFunction(uuid)?.id).toBe(id);
    expect(product.getFunction("ImageDemo.imageFilterDemo")?.id).toBe(id);
    const fn = product.getIdentifiedFunction(uuid)!;
    const info = product.getFunctionSignatureInfo(uuid)!;
    expect(info.outcome.$tag, JSON.stringify(info.outcome)).toBe("Solved");
    expect(info.returns.$tag).toBe("Authored");
    expect(product.getFunctionScheme(uuid)).toBeDefined();
    for (const field of fn.params) {
      expect(field.key?.$tag).toBe("NamedField");
      if (field.key?.$tag !== "NamedField") throw new Error("Public parameters must retain named field identities");
      expect(field.key.ref.$ref).toMatch(/^[0-9a-f-]{36}$/i);
      expect(product.getFieldIdentityByHandle(field.key.ref.$ref)?.field.name).toBe(field.name);
    }
    const type = product.getIdentifiedEntity("ImageFilterResults")!.type;
    if (!("$variant" in type)) throw new Error("The image demo result must remain an ordinary tagged data type");
    const variant = peelToVariant(type)!;
    expect(variant.discriminator).toBe("$tag");
    expect(variant.cases.map((entry) => entry.name)).toEqual(["ImageFilterResults"]);
    const resultFields = type.$variant.cases[0]!.fields!;
    const resultHandle = product.getUuid("ImageFilterResults")!;
    expect(resultHandle).toMatch(/^[0-9a-f-]{36}$/i);
    expect(product.getIdentifiedEntity(resultHandle)?.id).toBe("ImageFilterResults");
    expect(product.getEntityNominalIdentity(resultHandle)).toBe(product.getEntityNominalIdentity("ImageFilterResults"));
    const keys = resultFields.map((field) => field.key?.$tag === "NamedField" ? field.key.ref.$ref : undefined);
    expect(keys.every((key) => typeof key === "string" && /^[0-9a-f-]{36}$/i.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(resultFields.length);
    for (const field of resultFields) {
      if (field.key?.$tag !== "NamedField") throw new Error("Public result fields must retain named field identities");
      expect(product.getFieldIdentityByHandle(field.key.ref.$ref)?.field.name).toBe(field.name);
    }
  });

  test("the same strict reader accepts valid filter parameters and rejects invalid bounds and carriers", () => {
    const fn = product.getIdentifiedFunction("ImageDemo:imageFilterDemo")!;
    const options = { registry: product, coerce: false, strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    for (const [index, valid, invalid] of [
      [0, [0, 2, 4], [-1, 5, 1.5, "2"]],
      [1, [1, 4, 12], [0, 13, 1.5, "4"]],
    ] as const) {
      for (const value of valid) expect(validateValue(fn.params[index]!.type, value, null, options).valid, `${fn.params[index]!.name}=${value}`).toBe(true);
      for (const value of invalid) expect(validateValue(fn.params[index]!.type, value, null, options).valid, `${fn.params[index]!.name}=${value}`).toBe(false);
    }
  }, 180_000);

  // Demo 2: membership of a pasted Image asked the host for the declaration
  // facts of its pixels' declared names again for every pixel (about 135 ms
  // each: a 96 x 64 paste took 14 minutes). The facts read only the name and
  // the validation's frame, registry and definitions, never the value.
  test("Image membership reads each declared name's facts once, whatever the pixel count", () => {
    const image = { $ref: product.getTypeUuid("std", "Image")! } as FenelType;
    const sized = (width: number, height: number) => ({ width, height,
      pixels: Array.from({ length: width * height }, (_, index) => ({ r: index % 256, g: (index * 7) % 256, b: (index * 13) % 256, a: 255 })) });
    const reads = spyOn(product, "getIdentifiedEntity");
    try {
      const check = (value: unknown) => {
        reads.mockClear();
        const admissions: unknown[] = [];
        const result = validateValue(image, value, null, { registry: product, functions: product.evaluateContext(), coerce: false,
          strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
          observeMembership: () => {}, observeAdmission: plan => { admissions.push(plan); } });
        return { valid: result.valid, reads: reads.mock.calls.length, admissions: admissions.length };
      };
      const small = check(sized(2, 2));
      const large = check(sized(8, 6));
      expect(small.valid).toBe(true);
      expect(large.valid).toBe(true);
      expect(small.reads).toBeGreaterThan(0);
      expect(large.reads).toBe(small.reads);
      expect(large.admissions).toBeGreaterThan(small.admissions);
      const malformed = sized(8, 6);
      malformed.pixels[40] = { r: -1, g: 0, b: 0, a: 255 };
      expect(check(malformed).valid).toBe(false);
    } finally { reads.mockRestore(); }
  }, 600_000);

  test("the exact public callable produces a strictly valid typed result without test-native overrides", () => {
    const uuid = product.getUuid("ImageDemo:imageFilterDemo")!;
    const fn = product.getIdentifiedFunction(uuid)!;
    const callStart = performance.now();
    const result = evaluate({ call: [{ $ref: uuid }, 2, 4] }, {}, product.evaluateContext()) as Results;
    console.log(`Actual public image call: ${Math.round(performance.now() - callStart)} ms`);
    const tiny = evaluate({ call: ["std:imageCrop", result.original, 0, 0, 1, 1] }, {}, product.evaluateContext()) as Image;
    const diagnostic: Results = { ...result, original: tiny, grayscale: tiny, blurred: tiny, edges: tiny, retro: tiny,
      inputImages: [tiny], filteredImages: [tiny] };
    const options = { registry: product, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true } };
    const smallChecked = validateValue(fn.returns, diagnostic, null, options);
    expect(smallChecked.valid, JSON.stringify(smallChecked.errors)).toBe(true);
    expect((smallChecked.value as Results).$tag).toBe("ImageFilterResults");
    const validationStart = performance.now();
    const checked = validateValue(fn.returns, result, null, {
      registry: product, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: true },
    });
    console.log(`Strict full-image validation: ${Math.round(performance.now() - validationStart)} ms`);
    expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
    expect(checked.value).toEqual(result);
    expect(result).toEqual(run());
    expect(result.filteredImages[0]).toEqual(result.retro);
  }, 600_000);
});
