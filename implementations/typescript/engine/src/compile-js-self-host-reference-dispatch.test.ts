// modules-as-values — the compiled `$fenel` dispatcher when a dispatch class's
// method value is a function REFERENCE (`{$ref: handle}`) instead of an id
// string.
//
// The self-host classifier installs a compiled dispatcher for every bare name
// routed through a class (`take` → `Sequential`). The Fenel resolver answers
// `Resolved <method value>`, and the dispatcher used to index `$fenel` with
// that value as if it were always an id string, so a reference threw "not
// installed in $fenel" in the compiled path while the interpreted path ran the
// referenced function. The dispatcher now resolves the handle through the
// harness registry to the canonical id its `$fenel` entries are keyed by.
//
// The routing table is projected when the classifier module loads, so the
// fixture row must exist BEFORE the classifier is imported: this file imports
// it dynamically, after planting the row. A `Sequential List` row above the
// boot row's priority names the same functions the boot row names, through
// references (a dotted handle for `take`).
//
// The direct dispatcher test proves global class dispatch through a reference.
// The last test checks source-scoped `algebra:seqTakeTwo xs = take 2 xs`: its
// local algebra.take binding returns a Vec on both paths. Its strict repository
// compiler metadata needs a current `.fenel.lock` like other registry tests.

import { beforeAll, describe, expect, test } from "bun:test";

type Classifier = typeof import("./compile-js-self-host-classifier");
let classifier: Classifier;

beforeAll(async () => {
  const { dispatchRegistry } = await import("./system-entities");
  const boot = dispatchRegistry
    .listInstances("Sequential")
    .find((i) => i.args[0] === "List");
  if (boot === undefined) throw new Error("fixture: no boot `Sequential List` instance");
  dispatchRegistry.addInstance({
    typeName: "Sequential",
    args: ["List"],
    methods: {
      take: { $ref: "std.take" },
      drop: { $ref: "std:drop" },
      splitAt: { $ref: "algebra:splitAt" },
    },
    priority: (boot.priority ?? 0) + 100,
  });
  classifier = await import("./compile-js-self-host-classifier");
}, 1_800_000);

describe("compiled dispatch through a referenced class method", () => {
  test("the compiled `take` dispatcher runs the referenced function (List ⇒ std:take)", () => {
    const take = classifier.compiledDispatcherFor("take");
    expect(typeof take).toBe("function");
    expect(take!(2, [10, 20, 30, 40])).toEqual([10, 20]);
  });

  test("a Resolved method value maps to its canonical `$fenel` key", () => {
    const { compiledDispatchTargetId } = classifier;
    expect(compiledDispatchTargetId("take", "std:take")).toBe("std:take");
    expect(compiledDispatchTargetId("take", { $ref: "std:take" })).toBe("std:take");
    expect(compiledDispatchTargetId("take", { $ref: "std.take" })).toBe("std:take");
  });

  test("a reference to no function, an inherited `$ref` and a non-callable value throw", () => {
    const { compiledDispatchTargetId } = classifier;
    expect(() => compiledDispatchTargetId("take", { $ref: "std:noSuchTake" })).toThrow(/std:noSuchTake/);
    expect(() => compiledDispatchTargetId("take", Object.create({ $ref: "std:take" }))).toThrow();
    expect(() => compiledDispatchTargetId("take", 42)).toThrow();
  });

  test("`seqTakeTwo` over a List classifies OK: compiled and interpreted agree", () => {
    expect(classifier.classifyFnId("algebra:seqTakeTwo")).toEqual({ status: "OK", samplesCompared: 1 });
  }, 1_800_000);
});
