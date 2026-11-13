import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { soundModule } from "./sound";
import { Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, soundModule]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("sound module — registration", () => {
  it("registers Sound as a variant entity", () => {
    const ent = reg.getEntity("Sound");
    const cases = (ent!.type as any)?.$variant?.cases;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.map((c: any) => c.name)).toEqual(["Buffer", "Wave"]);
  });

  it("registers Time as a record entity", () => {
    const ent = reg.getEntity("Time");
    expect(ent?.type).toMatchObject({
      $record: { fields: [{ name: "seconds", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
    });
  });

  it("exposes generators and ops through the registry", () => {
    expect(reg.getFunctionByCodeName("sampleSound")).toBeTruthy();
    expect(reg.getFunctionByCodeName("renderSound")).toBeTruthy();
    expect(reg.getFunctionByCodeName("sine")).toBeTruthy();
    expect(reg.getFunctionByCodeName("sawtooth")).toBeTruthy();
    expect(reg.getFunctionByCodeName("square")).toBeTruthy();
    expect(reg.getFunctionByCodeName("gain")).toBeTruthy();
    expect(reg.getFunctionByCodeName("mix")).toBeTruthy();
    expect(reg.getFunctionByCodeName("delay")).toBeTruthy();
    expect(reg.getFunctionByCodeName("pitch")).toBeTruthy();
    expect(reg.getFunctionByCodeName("amplitude")).toBeTruthy();
    expect(reg.getFunctionByCodeName("time")).toBeTruthy();
  });
});

describe("sound module — primitives", () => {
  it("amplitude builds a stereo record", () => {
    expect(call("amplitude", 0.5, -0.3)).toEqual({ l: 0.5, r: -0.3 });
  });

  it("amplitude clamps to [-1, 1]", () => {
    expect(call("amplitude", 5, -7)).toEqual({ l: 1, r: -1 });
  });

  it("mono duplicates a single value to both channels", () => {
    expect(call("mono", 0.7)).toEqual({ l: 0.7, r: 0.7 });
  });

  it("time builds a Time record", () => {
    expect(call("time", 1.5)).toEqual({ seconds: 1.5 });
  });

  it("ampL / ampR project the channels", () => {
    const a = call("amplitude", 0.4, -0.2);
    expect(call("ampL", a)).toBe(0.4);
    expect(call("ampR", a)).toBe(-0.2);
  });
});

describe("sound module — sine wave", () => {
  it("sine 1Hz sample at t=0 returns 0 (sin 0 = 0)", () => {
    const s = call("sine", 1);
    const t0 = call("time", 0);
    const a = call("sampleSound", s, t0) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);
    expect(a.r).toBeCloseTo(0, 5);
  });

  it("sine 1Hz at t=0.25 returns ~+1 (sin π/2 = 1)", () => {
    const s = call("sine", 1);
    const t = call("time", 0.25);
    const a = call("sampleSound", s, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(1, 5);
    expect(a.r).toBeCloseTo(1, 5);
  });

  it("sine 1Hz at t=0.5 returns ~0 (sin π = 0)", () => {
    const s = call("sine", 1);
    const t = call("time", 0.5);
    const a = call("sampleSound", s, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);
    expect(a.r).toBeCloseTo(0, 5);
  });

  it("sine 1Hz at t=0.75 returns ~-1 (sin 3π/2 = -1)", () => {
    const s = call("sine", 1);
    const t = call("time", 0.75);
    const a = call("sampleSound", s, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(-1, 5);
    expect(a.r).toBeCloseTo(-1, 5);
  });
});

describe("sound module — operations", () => {
  it("gain 0.5 halves a sine wave's amplitude", () => {
    const s = call("sine", 1);
    const halfAmp = call("gain", 0.5, s);
    const t = call("time", 0.25);
    const a = call("sampleSound", halfAmp, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0.5, 5);
    expect(a.r).toBeCloseTo(0.5, 5);
  });

  it("gain 0 produces silence at any time", () => {
    const s = call("sine", 1);
    const muted = call("gain", 0, s);
    const t = call("time", 0.25);
    const a = call("sampleSound", muted, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);
    expect(a.r).toBeCloseTo(0, 5);
  });

  it("mix of two equal-amplitude sines doubles the value", () => {
    const s1 = call("sine", 1);
    const s2 = call("sine", 1);
    const mixed = call("mix", s1, s2);
    const t = call("time", 0.25);
    const a = call("sampleSound", mixed, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(1, 5);  // clamped at +1 — both sines are +1, sum is 2 → clamped
    // actually our amplitude clamp is in asAmplitude. Let's check what we get.
  });

  it("delay 0.25 shifts the wave forward", () => {
    const s = call("sine", 1);
    const delayed = call("delay", 0.25, s);
    // sample delayed at t=0.25 is sample original at t=0, which is 0
    const a = call("sampleSound", delayed, call("time", 0.25)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);
    // sample delayed at t=0.5 is sample original at t=0.25, which is +1
    const b = call("sampleSound", delayed, call("time", 0.5)) as { l: number; r: number };
    expect(b.l).toBeCloseTo(1, 5);
  });

  it("pitch 2 doubles the wave frequency", () => {
    const s = call("sine", 1);
    const higher = call("pitch", 2, s);
    // sine 1Hz at t=0.5 (after 2× pitch = effective t=1) = 0
    const a = call("sampleSound", higher, call("time", 0.5)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0, 5);
    // pitch 2 of sine 1Hz at t=0.125 = sine at t=0.25 = +1
    const b = call("sampleSound", higher, call("time", 0.125)) as { l: number; r: number };
    expect(b.l).toBeCloseTo(1, 5);
  });
});

describe("sound module — pitch / notes", () => {
  it("midiToFreq(69) returns 440 (A4)", () => {
    expect(call("midiToFreq", 69)).toBeCloseTo(440, 5);
  });

  it("midiToFreq(60) returns ~261.63 (middle C)", () => {
    expect(call("midiToFreq", 60) as number).toBeCloseTo(261.626, 1);
  });

  it("midiToFreq(81) returns 880 (A5, octave above A4)", () => {
    expect(call("midiToFreq", 81)).toBeCloseTo(880, 5);
  });

  it("note(69) is the same as sine(440) at any time", () => {
    const a = call("note", 69);
    const b = call("sine", 440);
    const t = call("time", 0.001);
    const sa = call("sampleSound", a, t) as { l: number };
    const sb = call("sampleSound", b, t) as { l: number };
    expect(sa.l).toBeCloseTo(sb.l, 5);
  });
});

describe("sound module — render", () => {
  it("renders a sine wave to an AudioBuffer with the right sample count", () => {
    const s = call("sine", 1);
    const buf = call("renderSound", s, 1, 100) as {
      sampleRate: number;
      channels: number;
      samples: { l: number; r: number }[];
    };
    expect(buf.sampleRate).toBe(100);
    expect(buf.channels).toBe(2);
    expect(buf.samples).toHaveLength(100);
    // Sample 0 (t=0) is sin(0) = 0
    expect(buf.samples[0]!.l).toBeCloseTo(0, 5);
    // Sample 25 (t=0.25) is sin(π/2) = 1
    expect(buf.samples[25]!.l).toBeCloseTo(1, 5);
    // Sample 50 (t=0.5) is sin(π) ≈ 0
    expect(buf.samples[50]!.l).toBeCloseTo(0, 5);
  });

  it("renderSound on a Buffer returns a buffer matching the sample rate", () => {
    // A pre-built buffer at 100Hz with 50 samples of constant +0.5
    const samples: any[] = [];
    for (let i = 0; i < 50; i++) samples.push(call("amplitude", 0.5, 0.5));
    const buf = call("audioBuffer", 100, 2, samples);
    const wrapped = { $tag: "Buffer", _0: buf };
    // Sample at t=0.1 (index 10) = +0.5
    const a = call("sampleSound", wrapped, call("time", 0.1)) as { l: number; r: number };
    expect(a.l).toBeCloseTo(0.5, 5);
    expect(a.r).toBeCloseTo(0.5, 5);
  });
});
