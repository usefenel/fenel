import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { animationModule } from "./animation";
import { List, Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, pictureModule, animationModule]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("animation module — registration", () => {
  it("registers Animation as a variant entity", () => {
    const ent = reg.getEntity("Animation");
    const cases = (ent!.type as any)?.$variant?.cases;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.map((c: any) => c.name)).toEqual(["Frames", "Animate"]);
  });

  it("registers FrameSequence as a record entity", () => {
    const ent = reg.getEntity("FrameSequence");
    expect(ent?.type).toMatchObject({
      $record: {
        fields: [
          { name: "fps", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "frames", label: Nothing, type: List({ $ref: "Image" }), meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("exposes natives and source ops through the registry", () => {
    expect(reg.getFunctionByCodeName("sampleAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("renderAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("freeze")).toBeTruthy();
    expect(reg.getFunctionByCodeName("overAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("delayAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("speedAnim")).toBeTruthy();
  });
});

describe("animation module — freeze", () => {
  it("freeze produces an Animate-tagged Animation", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic) as Record<string, unknown>;
    expect(anim.$tag).toBe("Animate");
  });

  it("sampling a freeze at any time returns the same Picture", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const t1 = call("time", 0);
    const t2 = call("time", 5);
    const p1 = call("sampleAnim", anim, t1);
    const p2 = call("sampleAnim", anim, t2);
    // Sampling those Pictures should give RED at any point.
    const pt = call("point", 5, 5);
    expect(call("sample", p1, pt)).toEqual(RED);
    expect(call("sample", p2, pt)).toEqual(RED);
  });
});

describe("animation module — render", () => {
  it("renders a frozen solid as N frames of the same image", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const seq = call("renderAnim", anim, 1, 4, 2, 2) as {
      fps: number;
      frames: { width: number; height: number; pixels: typeof RED[] }[];
    };
    expect(seq.fps).toBe(4);
    expect(seq.frames).toHaveLength(4);
    for (const frame of seq.frames) {
      expect(frame.width).toBe(2);
      expect(frame.height).toBe(2);
      for (const px of frame.pixels) expect(px).toEqual(RED);
    }
  });

  it("renders a moving circle (different frames have circles in different positions)", () => {
    // Build an animation that moves a red circle horizontally:
    // x = 5 + 5*t.seconds (so at t=0 it's at x=5, at t=1 it's at x=10).
    // Use a closure expressed as a std lambda.
    const animModule = `
      Animation = Frames FrameSequence | Animate (Time -> Picture)

      moving : Animation
      moving = Animate (\\t -> circle (point (5 + 5 * t.seconds) 5) 2 (color 255 0 0 255))
    `;
    // Define moving via the engine: use raw evaluate to construct an
    // Animation value with our own closure.
    const movingAnim = evaluate(
      {
        construct: [
          "Animate",
          {
            fn: [
              "t",
              {
                call: [
                  "circle",
                  {
                    call: [
                      "point",
                      { "+": [5, { "*": [5, { var: "t.seconds" }] }] },
                      5,
                    ],
                  },
                  2,
                  { call: ["color", 255, 0, 0, 255] },
                ],
              },
            ],
          },
        ],
      },
      {},
      ctx,
    );

    // Render 2 frames over 1 second at 2 fps: t=0, t=0.5.
    const seq = call("renderAnim", movingAnim, 1, 2, 16, 10) as {
      frames: { pixels: typeof RED[]; width: number }[];
    };
    expect(seq.frames).toHaveLength(2);

    // Frame 0 (t=0): circle at x=5. Pixel at (5, 5) should be RED.
    const f0 = seq.frames[0]!;
    const p0_55 = f0.pixels[5 * f0.width + 5];
    expect(p0_55).toEqual(RED);

    // Frame 1 (t=0.5): circle at x=7.5. Pixel at (5, 5) should be transparent
    // (now outside circle), pixel at (8, 5) should be RED.
    const f1 = seq.frames[1]!;
    const p1_55 = f1.pixels[5 * f1.width + 5];
    const p1_85 = f1.pixels[5 * f1.width + 8];
    expect(p1_55).toEqual(TRANSPARENT);
    expect(p1_85).toEqual(RED);

    // Suppress the unused-var warning for the alt source-form spec.
    expect(animModule).toContain("moving");
  });
});

describe("animation module — overAnim", () => {
  it("composes two animations per-frame using Picture's over", () => {
    const fg = call("freeze", call("circle", call("point", 5, 5), 2, RED));
    const bg = call("freeze", call("solid", { r: 0, g: 0, b: 255, a: 255 }));
    const composed = call("overAnim", fg, bg);
    const seq = call("renderAnim", composed, 0.5, 2, 10, 10) as {
      frames: { pixels: typeof RED[]; width: number }[];
    };
    const frame = seq.frames[0]!;
    // Center (5, 5) — red circle visible
    expect(frame.pixels[5 * frame.width + 5]).toEqual(RED);
    // Corner (0, 0) — only blue background
    expect(frame.pixels[0]).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });
});
