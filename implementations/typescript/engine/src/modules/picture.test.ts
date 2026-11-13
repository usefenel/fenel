import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, pictureModule]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("picture module — registration", () => {
  it("registers the Picture entity (variant)", () => {
    const ent = reg.getEntity("Picture");
    const cases = (ent!.type as any)?.$variant?.cases;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.map((c: any) => c.name)).toEqual(["Raster", "Field"]);
  });

  it("registers the Point entity (record)", () => {
    const ent = reg.getEntity("Point");
    expect(ent?.type).toMatchObject({
      $record: {
        fields: [
          { name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "y", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("exposes sample and render through the registry", () => {
    expect(reg.getFunctionByCodeName("pictureSample")?.id).toBe("picture:sample");
    expect(reg.getFunctionByCodeName("pictureRender")?.id).toBe("picture:render");
    expect(reg.getFunctionByCodeName("solid")).toBeTruthy();
    expect(reg.getFunctionByCodeName("circle")).toBeTruthy();
    expect(reg.getFunctionByCodeName("over")).toBeTruthy();
    expect(reg.getFunctionByCodeName("dist")).toBeTruthy();
  });
});

describe("picture module — primitives", () => {
  it("color builds an RGBA record", () => {
    expect(call("color", 10, 20, 30, 40)).toEqual({ r: 10, g: 20, b: 30, a: 40 });
  });

  it("color clamps out-of-range bytes", () => {
    expect(call("color", -5, 999, 128, 256)).toEqual({ r: 0, g: 255, b: 128, a: 255 });
  });

  it("point builds an x/y record", () => {
    expect(call("point", 3, 4)).toEqual({ x: 3, y: 4 });
  });

  it("dist computes Euclidean distance", () => {
    const a = call("point", 0, 0);
    const b = call("point", 3, 4);
    expect(call("dist", a, b)).toBe(5);
  });

  it("alphaBlend mixes top onto bot", () => {
    expect(call("alphaBlend", RED, BLUE)).toEqual(RED);
    expect(call("alphaBlend", TRANSPARENT, BLUE)).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 255,
    });
  });
});

describe("picture module — solid + sample", () => {
  it("solid produces a Field-tagged Picture", () => {
    const pic = call("solid", RED) as Record<string, unknown>;
    expect(pic.$tag).toBe("Field");
  });

  it("sample of a solid Picture returns the constant color", () => {
    const pic = call("solid", RED);
    const pt = call("point", 5, 5);
    expect(call("picture:sample", pic, pt)).toEqual(RED);
  });
});

describe("picture module — circle + sample", () => {
  it("sample inside circle returns the fill color", () => {
    // Circle at (10, 10) with radius 5, filled red.
    const center = call("point", 10, 10);
    const pic = call("circle", center, 5, RED);
    const inside = call("point", 10, 10);
    expect(call("picture:sample", pic, inside)).toEqual(RED);
  });

  it("sample outside circle returns transparent", () => {
    const center = call("point", 10, 10);
    const pic = call("circle", center, 5, RED);
    const outside = call("point", 100, 100);
    expect(call("picture:sample", pic, outside)).toEqual(TRANSPARENT);
  });

  it("sample at exactly the radius is inside (<=)", () => {
    const center = call("point", 10, 10);
    const pic = call("circle", center, 5, RED);
    const onEdge = call("point", 15, 10);
    expect(call("picture:sample", pic, onEdge)).toEqual(RED);
  });
});

describe("picture module — render", () => {
  it("renders a solid Picture as a uniform Image", () => {
    const pic = call("solid", RED);
    const img = call("picture:render", pic, 4, 3) as {
      width: number;
      height: number;
      pixels: typeof RED[];
    };
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.pixels).toHaveLength(12);
    for (const px of img.pixels) expect(px).toEqual(RED);
  });

  it("renders a circle at the expected pixel positions", () => {
    // 16x16 image, red circle radius 4 centered at (8, 8).
    // The pixel at (8, 8) — center — should be red.
    // The pixel at (0, 0) — corner — should be transparent.
    const center = call("point", 8, 8);
    const pic = call("circle", center, 4, RED);
    const img = call("picture:render", pic, 16, 16) as {
      width: number;
      height: number;
      pixels: typeof RED[];
    };
    expect(img.width).toBe(16);
    expect(img.height).toBe(16);
    const at = (x: number, y: number) => img.pixels[y * 16 + x];
    expect(at(8, 8)).toEqual(RED);
    expect(at(0, 0)).toEqual(TRANSPARENT);
    expect(at(15, 15)).toEqual(TRANSPARENT);
    // (12, 8) is exactly radius=4 from (8, 8) → inside (<=).
    expect(at(12, 8)).toEqual(RED);
    // (13, 8) is distance 5 from center → outside.
    expect(at(13, 8)).toEqual(TRANSPARENT);
  });
});

describe("picture module — over (compositing)", () => {
  it("over places a foreground Picture above a background", () => {
    // Red circle (radius 3 at center (5,5)) over solid blue, on a 10x10 grid.
    // At the center, red covers blue. Far from center, blue shows through.
    const c = call("point", 5, 5);
    const fg = call("circle", c, 3, RED);
    const bg = call("solid", BLUE);
    const composed = call("over", fg, bg);
    const img = call("picture:render", composed, 10, 10) as {
      width: number;
      height: number;
      pixels: typeof RED[];
    };
    const at = (x: number, y: number) => img.pixels[y * 10 + x];
    expect(at(5, 5)).toEqual(RED);
    expect(at(0, 0)).toEqual(BLUE);
    expect(at(9, 9)).toEqual(BLUE);
  });
});
