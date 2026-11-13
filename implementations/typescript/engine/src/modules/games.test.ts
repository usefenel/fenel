import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { soundModule } from "./sound";
import { animationModule } from "./animation";
import { movieModule } from "./movie";
import { eventsModule } from "./events";
import { gamesModule } from "./games";
import { Nothing } from "../type-foundation";
const reg = createRegistry([
  stdModule,
  pictureModule,
  soundModule,
  animationModule,
  movieModule,
  eventsModule,
  gamesModule,
]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("games module — registration", () => {
  it("registers Game as a record entity", () => {
    expect(reg.getEntity("Game")?.type).toMatchObject({
      $record: {
        fields: [
          { name: "initial" },
          { name: "update" },
          { name: "view" },
          { name: "inputs", label: Nothing, type: { $ref: "Event" }, meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("exposes mkGame, gameStateAt, gameToAnim, gameToMovie", () => {
    expect(reg.getFunctionByCodeName("mkGame")).toBeTruthy();
    expect(reg.getFunctionByCodeName("gameStateAt")).toBeTruthy();
    expect(reg.getFunctionByCodeName("gameToAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("gameToMovie")).toBeTruthy();
  });
});

describe("games module — counter game (state from clicks)", () => {
  it("counts click events as state, view renders count as a circle radius", () => {
    // Each click increments a counter. View renders a red circle whose
    // radius is the current count. Demonstrates: events → state → picture.

    // update: state, _input -> state + 1
    const updateFn = evaluate(
      { fn: [["state", "input"], { "+": [{ var: "state" }, 1] }] },
      {},
      ctx,
    );
    // view: state -> circle (point 8 8) state RED
    const viewFn = evaluate(
      {
        fn: [
          ["state"],
          { call: ["circle", { call: ["point", 8, 8] }, { var: "state" }, RED] },
        ],
      },
      {},
      ctx,
    );

    // 3 click events at t=0.5, 1.0, 1.5 (payloads ignored).
    const clicks = call("event", [
      call("eventEntry", 0.5, "click"),
      call("eventEntry", 1.0, "click"),
      call("eventEntry", 1.5, "click"),
    ]);
    const game = call("mkGame", 1, updateFn, viewFn, clicks);

    // State at t=0 is 1 (no clicks yet).
    expect(call("gameStateAt", game, call("time", 0))).toBe(1);
    // After 2 clicks (t=1.2), state = 3.
    expect(call("gameStateAt", game, call("time", 1.2))).toBe(3);
    // After all clicks, state = 4.
    expect(call("gameStateAt", game, call("time", 5))).toBe(4);

    // gameToAnim produces an Animation. Sample it at t=1.2 → state=3 →
    // circle radius 3 at center (8,8). Pixel (8,8) should be RED.
    const anim = call("gameToAnim", game);
    const pic = call("sampleAnim", anim, call("time", 1.2));
    expect(call("sample", pic, call("point", 8, 8))).toEqual(RED);
    // Pixel (8, 12) at distance 4 from (8, 8) should be transparent
    // (radius 3 < 4).
    expect(call("sample", pic, call("point", 8, 12))).toEqual(TRANSPARENT);
  });
});

describe("games module — paddle (state-replacement game)", () => {
  it("paddle moves to the latest input position", () => {
    // Paddle game: state is x-coordinate. Each input event carries a new x.
    // update replaces state with input. view renders a circle at (x, 8).

    const updateFn = evaluate(
      { fn: [["s", "x"], { var: "x" }] },
      {},
      ctx,
    );
    const viewFn = evaluate(
      {
        fn: [
          ["s"],
          { call: ["circle", { call: ["point", { var: "s" }, 8] }, 2, RED] },
        ],
      },
      {},
      ctx,
    );
    const moves = call("event", [
      call("eventEntry", 0.5, 4),
      call("eventEntry", 1.0, 8),
      call("eventEntry", 1.5, 12),
    ]);
    const game = call("mkGame", 4, updateFn, viewFn, moves);

    const anim = call("gameToAnim", game);
    // At t=0: paddle at x=4
    let p = call("sampleAnim", anim, call("time", 0));
    expect(call("sample", p, call("point", 4, 8))).toEqual(RED);
    // At t=1.2: paddle at x=8
    p = call("sampleAnim", anim, call("time", 1.2));
    expect(call("sample", p, call("point", 8, 8))).toEqual(RED);
    // At t=2: paddle at x=12
    p = call("sampleAnim", anim, call("time", 2));
    expect(call("sample", p, call("point", 12, 8))).toEqual(RED);
  });
});

describe("games module — gameToMovie", () => {
  it("combines a Game's visuals with a Sound into a Movie", () => {
    const updateFn = evaluate({ fn: [["s", "i"], { "+": [{ var: "s" }, 1] }] }, {}, ctx);
    const viewFn = evaluate(
      { fn: [["s"], { call: ["circle", { call: ["point", 8, 8] }, { var: "s" }, RED] }] },
      {},
      ctx,
    );
    const events = call("event", [
      call("eventEntry", 0.5, "x"),
      call("eventEntry", 1.0, "x"),
    ]);
    const game = call("mkGame", 1, updateFn, viewFn, events);
    const audio = call("sine", 1);
    const movie = call("gameToMovie", game, audio);

    // At t=0.7 (after 1 click): state=2, circle radius 2.
    const scene = call("sampleMovie", movie, call("time", 0.7)) as {
      visual: unknown;
      audio: { l: number; r: number };
    };
    // Visual: circle at (8,8) radius 2 — pixel (8,8) is RED.
    expect(call("sample", scene.visual, call("point", 8, 8))).toEqual(RED);
    // Audio: sin(2π * 1 * 0.7) ≈ -0.951
    expect(scene.audio.l).toBeCloseTo(Math.sin(2 * Math.PI * 0.7), 5);
  });
});
