// Run with --conditions=browser --conditions=development (reactive writes).
import { expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import type { FenelType } from "@fenel/engine/types";
import { cardTypeSource, type CardRead } from "./card-type-source";

const anything: FenelType = { $ref: "Any" };
const image = { width: 2, height: 1, pixels: [[0, 0, 0, 255], [255, 255, 255, 255]] };

test("an undecided card's type line follows its value read AFTER the caption mounted (Data instead of files, B24)", () => {
  // The live reader answers later than the caption: no snapshot value, then the read.
  const [read, setRead] = createSignal<CardRead | undefined>(undefined);
  const { source, dispose } = createRoot(dispose => ({ source: createMemo(() => cardTypeSource(anything, undefined, read())), dispose }));
  try {
    flush();
    expect(source()).toEqual({ use: "declared", type: anything });
    setRead({ value: image, kind: "Image" });
    flush();
    expect(source()).toEqual({ use: "kind", kind: "Image" });
    // A reader that names no constructor still gives the value for its shape.
    setRead({ value: image });
    flush();
    expect(source()).toEqual({ use: "value", value: image });
  } finally { dispose(); }
});

test("a checked type always wins; a snapshot value of an undecided card is used at once", () => {
  const number: FenelType = { $ref: "Number" };
  expect(cardTypeSource(number, 42, { value: 42, kind: "Number" })).toEqual({ use: "declared", type: number });
  expect(cardTypeSource(anything, image, undefined)).toEqual({ use: "value", value: image });
  expect(cardTypeSource(undefined, "text", undefined)).toEqual({ use: "value", value: "text" });
});
