import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { soundModule } from "./sound";
import { animationModule } from "./animation";
import { eventsModule } from "./events";
import { Nothing } from "../type-foundation";
const reg = createRegistry([
  stdModule,
  pictureModule,
  soundModule,
  animationModule,
  eventsModule,
]);
const ctx = reg.evaluateContext();

const RED = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("events module — registration", () => {
  it("registers Event, Behavior, EventEntry as entities", () => {
    expect(reg.getEntity("Event")?.type).toMatchObject({ $record: { fields: [{ name: "entries" }] } });
    expect(reg.getEntity("EventEntry")?.type).toMatchObject({
      $record: {
        fields: [
          { name: "timestamp", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          { name: "payload" },
        ],
      },
    });
    expect(reg.getEntity("Behavior")?.type).toMatchObject({ $variant: { cases: [{ name: "BehaviorAt", label: Nothing }] } });
  });

  it("exposes step, accum, and bridge functions", () => {
    expect(reg.getFunctionByCodeName("event")).toBeTruthy();
    expect(reg.getFunctionByCodeName("eventEntry")).toBeTruthy();
    expect(reg.getFunctionByCodeName("sampleEvent")).toBeTruthy();
    expect(reg.getFunctionByCodeName("step")).toBeTruthy();
    expect(reg.getFunctionByCodeName("accum")).toBeTruthy();
    expect(reg.getFunctionByCodeName("sampleBehavior")).toBeTruthy();
    expect(reg.getFunctionByCodeName("constant")).toBeTruthy();
    expect(reg.getFunctionByCodeName("behaviorToAnim")).toBeTruthy();
    expect(reg.getFunctionByCodeName("behaviorToSound")).toBeTruthy();
  });
});

describe("events module — sample / step", () => {
  it("sampleEvent returns the payload at exactly that timestamp", () => {
    const e1 = call("eventEntry", 1, 100);
    const e2 = call("eventEntry", 2, 200);
    const e3 = call("eventEntry", 3, 300);
    const evt = call("event", [e1, e2, e3]);
    // Maybe-variant shape post-Phase 5b12 events:sampleEvent conformance fix.
    expect(call("sampleEvent", evt, call("time", 2))).toEqual({ $tag: "Just", _0: 200 });
    expect(call("sampleEvent", evt, call("time", 2.5))).toEqual({ $tag: "Nothing" });
  });

  it("step holds the most recent event's payload", () => {
    const e1 = call("eventEntry", 1, "a");
    const e2 = call("eventEntry", 3, "b");
    const e3 = call("eventEntry", 5, "c");
    const evt = call("event", [e1, e2, e3]);
    const beh = call("step", "init", evt);

    // Before any event
    expect(call("sampleBehavior", beh, call("time", 0.5))).toBe("init");
    // Between events
    expect(call("sampleBehavior", beh, call("time", 2))).toBe("a");
    expect(call("sampleBehavior", beh, call("time", 4))).toBe("b");
    // After all events
    expect(call("sampleBehavior", beh, call("time", 100))).toBe("c");
  });

  it("step works with out-of-order entries (sorts internally)", () => {
    const e1 = call("eventEntry", 5, "c");
    const e2 = call("eventEntry", 1, "a");
    const e3 = call("eventEntry", 3, "b");
    const evt = call("event", [e1, e2, e3]);
    const beh = call("step", "init", evt);
    expect(call("sampleBehavior", beh, call("time", 4))).toBe("b");
  });
});

describe("events module — accum", () => {
  it("accum folds events into a state", () => {
    // Register a small adder fn for the test by using a std closure.
    // accum init add events → behavior whose value at t = sum of payloads at events ≤ t.
    const e1 = call("eventEntry", 1, 10);
    const e2 = call("eventEntry", 2, 20);
    const e3 = call("eventEntry", 3, 30);
    const evt = call("event", [e1, e2, e3]);

    // Use std's add (Number -> Number -> Number).
    // accum's fn signature is (state, payload) -> state, so add directly works.
    const beh = call("accum", 0, "add", evt);

    expect(call("sampleBehavior", beh, call("time", 0.5))).toBe(0);
    expect(call("sampleBehavior", beh, call("time", 1.5))).toBe(10);
    expect(call("sampleBehavior", beh, call("time", 2.5))).toBe(30);
    expect(call("sampleBehavior", beh, call("time", 100))).toBe(60);
  });

  it("accum with a closure as the folding function", () => {
    // f acc x = acc * 2 + x  — building a binary number from bit events.
    const fn = evaluate(
      {
        fn: [
          ["acc", "x"],
          { "+": [{ "*": [{ var: "acc" }, 2] }, { var: "x" }] },
        ],
      },
      {},
      ctx,
    );
    const e1 = call("eventEntry", 1, 1);
    const e2 = call("eventEntry", 2, 0);
    const e3 = call("eventEntry", 3, 1);
    const evt = call("event", [e1, e2, e3]);
    const beh = call("accum", 0, fn, evt);

    expect(call("sampleBehavior", beh, call("time", 0.5))).toBe(0);
    expect(call("sampleBehavior", beh, call("time", 1.5))).toBe(1);   // 0*2 + 1
    expect(call("sampleBehavior", beh, call("time", 2.5))).toBe(2);   // 1*2 + 0
    expect(call("sampleBehavior", beh, call("time", 3.5))).toBe(5);   // 2*2 + 1
  });
});

describe("events module — constant behavior", () => {
  it("constant returns the same value at every time", () => {
    const beh = call("constant", 42);
    expect(call("sampleBehavior", beh, call("time", 0))).toBe(42);
    expect(call("sampleBehavior", beh, call("time", 100))).toBe(42);
  });
});

describe("events module — behaviorToAnim bridge", () => {
  it("a Behavior Picture turns into an Animation that renders correctly", () => {
    // Build a "picture behavior" that returns a red circle whose center
    // depends on time. Use a raw closure that calls picture functions.
    const picBehavior = evaluate(
      {
        construct: [
          "BehaviorAt",
          {
            fn: [
              "t",
              {
                call: [
                  "circle",
                  { call: ["point", { "+": [3, { var: "t.seconds" }] }, 5] },
                  2,
                  RED,
                ],
              },
            ],
          },
        ],
      },
      {},
      ctx,
    );

    const anim = call("behaviorToAnim", picBehavior);
    // At t=0: circle at x=3
    const p0 = call("sampleAnim", anim, call("time", 0));
    expect(call("sample", p0, call("point", 3, 5))).toEqual(RED);
    // At t=2: circle at x=5, radius 2. Point at (3, 5) is exactly the
    // boundary (radius 2, included). Use a clearly-outside point at (0, 5).
    const p2 = call("sampleAnim", anim, call("time", 2));
    expect(call("sample", p2, call("point", 5, 5))).toEqual(RED);
    expect(call("sample", p2, call("point", 0, 5))).toEqual(TRANSPARENT);
  });
});

describe("events module — game-shaped flow: event → accum → behavior → animation", () => {
  it("derives a moving circle from a stream of position-update events", () => {
    // Game-shaped flow:
    //   Inputs: events at times 1s, 2s, 3s — each carrying an x-coordinate.
    //   State: a Behavior Number that holds the current x via accum.
    //   Visual: a Behavior Picture mapping current x to a circle there.
    //   Animation: behaviorToAnim of the visual.
    // We then sample the animation at various times and verify pixel positions.

    const e1 = call("eventEntry", 1, 4);
    const e2 = call("eventEntry", 2, 6);
    const e3 = call("eventEntry", 3, 8);
    const events = call("event", [e1, e2, e3]);

    // accum's "fn" replaces state with the latest event payload — that's
    // step semantics. Use \state x -> x.
    const replaceFn = evaluate({ fn: [["s", "x"], { var: "x" }] }, {}, ctx);
    const xBehavior = call("accum", 2, replaceFn, events) as unknown;

    // Visual behavior: map current x to a Picture (circle at that x).
    // Build a closure that invokes sampleBehavior at the same t to get x,
    // then constructs the circle.
    const picBehavior = evaluate(
      {
        construct: [
          "BehaviorAt",
          {
            fn: [
              "t",
              {
                call: [
                  "circle",
                  {
                    call: [
                      "point",
                      { call: ["sampleBehavior", { var: "_xBeh" }, { var: "t" }] },
                      5,
                    ],
                  },
                  2,
                  RED,
                ],
              },
            ],
          },
        ],
      },
      {},
      ctx,
    );
    // Wire the captured x-behavior into the picture closure.
    (picBehavior as any)._0.closure = { _xBeh: xBehavior };

    const anim = call("behaviorToAnim", picBehavior);

    // At t=0.5 (before any events): x = 2 (initial)
    const p0 = call("sampleAnim", anim, call("time", 0.5));
    expect(call("sample", p0, call("point", 2, 5))).toEqual(RED);

    // At t=1.5 (after event 1): x = 4, circle radius 2, so [2..6] is in.
    // (0, 5) is clearly outside (distance 4).
    const p1 = call("sampleAnim", anim, call("time", 1.5));
    expect(call("sample", p1, call("point", 4, 5))).toEqual(RED);
    expect(call("sample", p1, call("point", 0, 5))).toEqual(TRANSPARENT);

    // At t=2.5 (after event 2): x = 6
    const p2 = call("sampleAnim", anim, call("time", 2.5));
    expect(call("sample", p2, call("point", 6, 5))).toEqual(RED);

    // At t=10 (well after all events): x = 8
    const p3 = call("sampleAnim", anim, call("time", 10));
    expect(call("sample", p3, call("point", 8, 5))).toEqual(RED);
  });
});
