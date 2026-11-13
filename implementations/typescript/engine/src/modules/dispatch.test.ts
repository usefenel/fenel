import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { soundModule } from "./sound";
import { animationModule } from "./animation";
import { movieModule } from "./movie";
import { eventsModule } from "./events";
import { dispatchModule } from "./dispatch";

const reg = createRegistry([
  stdModule,
  pictureModule,
  soundModule,
  animationModule,
  movieModule,
  eventsModule,
  dispatchModule,
]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("dispatch module — polymorphic sample", () => {
  it("dispatch table is populated for all sampleable variant tags", () => {
    expect(ctx._sampleByTag).toBeTruthy();
    const tags = ctx._sampleByTag!;
    expect(tags["Field"]).toBe("picture:sample");
    expect(tags["Raster"]).toBe("picture:sample");
    expect(tags["Wave"]).toBe("sound:sampleSound");
    expect(tags["Buffer"]).toBe("sound:sampleSound");
    expect(tags["Animate"]).toBe("animation:sampleAnim");
    expect(tags["Frames"]).toBe("animation:sampleAnim");
    expect(tags["MovieAt"]).toBe("movie:sampleMovie");
    expect(tags["Recorded"]).toBe("movie:sampleMovie");
    expect(tags["BehaviorAt"]).toBe("events:sampleBehavior");
  });

  it("polymorphic sample dispatches to picture's sample for Picture values", () => {
    const pic = call("solid", RED);
    const pt = call("point", 5, 5);
    // The codeName "sample" now goes through the dispatch module — but
    // routes to picture's sample for Field-tagged values.
    expect(call("sample", pic, pt)).toEqual(RED);
  });

  it("polymorphic sample dispatches to sound's sample for Sound values", () => {
    const snd = call("sine", 1);
    const t = call("time", 0.25);
    const a = call("sample", snd, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(1, 5);
    expect(a.r).toBeCloseTo(1, 5);
  });

  it("polymorphic sample dispatches to animation's sample for Animation values", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const t = call("time", 0.5);
    const sampledPic = call("sample", anim, t);
    // The result is a Picture; sampling that picture again returns RED.
    expect(call("sample", sampledPic, call("point", 0, 0))).toEqual(RED);
  });

  it("polymorphic sample dispatches to movie's sample for Movie values", () => {
    const anim = call("freeze", call("solid", RED));
    const snd = call("sine", 1);
    const movie = call("withAudio", anim, snd);
    const scene = call("sample", movie, call("time", 0.25)) as {
      visual: unknown;
      audio: { l: number };
    };
    expect(scene.audio.l).toBeCloseTo(1, 5);
  });

  it("polymorphic sample on a Behavior dispatches via Sampleable<Behavior>", () => {
    const beh = call("constant", 42);
    expect(call("sample", beh, call("time", 100))).toBe(42);
  });

  it("returns null for untagged values (graceful degradation)", () => {
    // A plain object with no $tag — no dispatch possible.
    expect(call("sample", { foo: "bar" }, call("time", 0))).toBe(null);
  });
});
