import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { soundModule } from "./sound";
import { animationModule } from "./animation";
import { movieModule } from "./movie";
import { Nothing } from "../type-foundation";
const reg = createRegistry([
  stdModule,
  pictureModule,
  soundModule,
  animationModule,
  movieModule,
]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };
const SILENT = { l: 0, r: 0 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("movie module — registration", () => {
  it("registers Movie as a variant entity", () => {
    const ent = reg.getEntity("Movie");
    const cases = (ent!.type as any)?.$variant?.cases;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.map((c: any) => c.name)).toEqual(["Recorded", "MovieAt"]);
  });

  it("registers Scene as a record entity", () => {
    const ent = reg.getEntity("Scene");
    expect(ent?.type).toMatchObject({
      $record: {
        fields: [
          { name: "visual", label: Nothing, type: { $ref: "Picture" }, meta: {}, ui: Nothing },
          { name: "audio", label: Nothing, type: { $ref: "Amplitude" }, meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("exposes the bridge primitives + helpers through the registry", () => {
    expect(reg.getFunctionByCodeName("sampleMovie")).toBeTruthy();
    expect(reg.getFunctionByCodeName("renderMovie")).toBeTruthy();
    expect(reg.getFunctionByCodeName("scene")).toBeTruthy();
    expect(reg.getFunctionByCodeName("withAudio")).toBeTruthy();
    expect(reg.getFunctionByCodeName("silentMovie")).toBeTruthy();
  });
});

describe("movie module — withAudio composes animation + sound", () => {
  it("scene at t=0 is the animation's picture and the sound's amplitude", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const snd = call("sine", 1);
    const movie = call("withAudio", anim, snd);

    const t0 = call("time", 0);
    const scene = call("sampleMovie", movie, t0) as { visual: unknown; audio: { l: number; r: number } };

    // Visual: sampling the scene's Picture at any point should give RED.
    const pt = call("point", 5, 5);
    expect(call("sample", scene.visual, pt)).toEqual(RED);

    // Audio: at t=0 sin(0) = 0 → silence
    expect(scene.audio.l).toBeCloseTo(0, 5);
    expect(scene.audio.r).toBeCloseTo(0, 5);
  });

  it("scene at t=0.25 has animation's picture and audio at sin(π/2) = 1", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const snd = call("sine", 1);
    const movie = call("withAudio", anim, snd);

    const t = call("time", 0.25);
    const scene = call("sampleMovie", movie, t) as { audio: { l: number; r: number } };
    expect(scene.audio.l).toBeCloseTo(1, 5);
  });
});

describe("movie module — silentMovie", () => {
  it("audio is always zero", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const movie = call("silentMovie", anim);

    const scene = call("sampleMovie", movie, call("time", 0.5)) as {
      audio: { l: number; r: number };
    };
    expect(scene.audio).toEqual(SILENT);
  });
});

describe("movie module — render", () => {
  it("renders synchronized frames + audio", () => {
    const pic = call("solid", RED);
    const anim = call("freeze", pic);
    const snd = call("sine", 1);
    const movie = call("withAudio", anim, snd);

    // 1s movie at 4 fps and 100 Hz audio. 4 frames + 100 audio samples.
    const result = call("renderMovie", movie, 1, 4, 100, 8, 8) as {
      fps: number;
      width: number;
      height: number;
      frames: { width: number; height: number; pixels: typeof RED[] }[];
      audio: { sampleRate: number; channels: number; samples: { l: number; r: number }[] };
    };

    expect(result.fps).toBe(4);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.frames).toHaveLength(4);
    expect(result.audio.sampleRate).toBe(100);
    expect(result.audio.samples).toHaveLength(100);

    // Every frame is solid RED (frozen picture).
    for (const frame of result.frames) {
      expect(frame.width).toBe(8);
      expect(frame.height).toBe(8);
      for (const px of frame.pixels) expect(px).toEqual(RED);
    }

    // Audio sample 0 (t=0): sin(0) = 0
    expect(result.audio.samples[0]!.l).toBeCloseTo(0, 5);
    // Audio sample 25 (t=0.25): sin(π/2) = 1
    expect(result.audio.samples[25]!.l).toBeCloseTo(1, 5);
    // Audio sample 50 (t=0.5): sin(π) = 0
    expect(result.audio.samples[50]!.l).toBeCloseTo(0, 5);
  });
});
