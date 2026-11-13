import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { soundModule } from "./sound";
import { trackModule } from "./track";
import { Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, soundModule, trackModule]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("track module — registration", () => {
  it("registers Track and TrackEntry as record entities", () => {
    expect(reg.getEntity("Track")?.type).toMatchObject({
      $record: { fields: [{ name: "entries" }] },
    });
    expect(reg.getEntity("TrackEntry")?.type).toMatchObject({
      $record: {
        fields: [
          { name: "start", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "sound", label: Nothing, type: { $ref: "Sound" }, meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("exposes natives through the registry", () => {
    expect(reg.getFunctionByCodeName("track")).toBeTruthy();
    expect(reg.getFunctionByCodeName("trackEntry")).toBeTruthy();
    expect(reg.getFunctionByCodeName("mixDown")).toBeTruthy();
    expect(reg.getFunctionByCodeName("sampleTrackAt")).toBeTruthy();
  });
});

describe("track module — single entry", () => {
  it("a track with one entry at start=0 plays that sound directly", () => {
    const note = call("sine", 1);
    const entry = call("trackEntry", 0, note);
    const t = call("track", [entry]);
    const mixed = call("mixDown", t);

    // At t=0.25, sin(π/2) = 1
    const a = call("sampleSound", mixed, call("time", 0.25)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(1, 5);
  });

  it("a track entry at start=1 is silent before t=1", () => {
    const note = call("sine", 1);
    const entry = call("trackEntry", 1, note);
    const t = call("track", [entry]);
    const mixed = call("mixDown", t);

    // At t=0.5, the entry hasn't started yet
    const a = call("sampleSound", mixed, call("time", 0.5)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);

    // At t=1.25, the entry has been playing 0.25s — sin(π/2) = 1
    const b = call("sampleSound", mixed, call("time", 1.25)) as { l: number; r: number };
    expect(b.l).toBeCloseTo(1, 5);
  });
});

describe("track module — multi-entry mix", () => {
  it("two simultaneous notes sum their amplitudes (clamped)", () => {
    const e1 = call("trackEntry", 0, call("gain", 0.4, call("sine", 1)));
    const e2 = call("trackEntry", 0, call("gain", 0.3, call("sine", 1)));
    const t = call("track", [e1, e2]);
    const mixed = call("mixDown", t);
    // At t=0.25, both contribute their max: 0.4 + 0.3 = 0.7
    const a = call("sampleSound", mixed, call("time", 0.25)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0.7, 5);
  });

  it("staggered notes play in sequence", () => {
    const e1 = call("trackEntry", 0, call("gain", 0.5, call("sine", 1)));
    const e2 = call("trackEntry", 1, call("gain", 0.5, call("sine", 1)));
    const t = call("track", [e1, e2]);
    const mixed = call("mixDown", t);

    // At t=0.25: only e1 plays. e1 contributes 0.5 * sin(π/2) = 0.5.
    const a = call("sampleSound", mixed, call("time", 0.25)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0.5, 5);

    // At t=1.25: e1 contributes 0.5 * sin(2.5π) = 0.5 * sin(0.5π) = 0.5
    //           e2 contributes 0.5 * sin(π/2) = 0.5
    // Total: 1.0
    const b = call("sampleSound", mixed, call("time", 1.25)) as { l: number; r: number };
    expect(b.l).toBeCloseTo(1.0, 5);
  });
});

describe("track module — render", () => {
  it("render a mixedDown track to an AudioBuffer", () => {
    const e1 = call("trackEntry", 0, call("sine", 1));
    const t = call("track", [e1]);
    const mixed = call("mixDown", t);
    const buf = call("renderSound", mixed, 1, 100) as {
      sampleRate: number;
      samples: { l: number; r: number }[];
    };
    expect(buf.samples).toHaveLength(100);
    expect(buf.samples[25]!.l).toBeCloseTo(1, 5);
  });
});
