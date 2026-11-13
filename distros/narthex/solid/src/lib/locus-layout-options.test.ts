import { describe, expect, test } from "bun:test";
import { List } from "@fenel/engine/type-foundation";
import { locusLayoutOption, locusLayoutOptions } from "./locus-layout-options";
import { placementFromItem } from "./locus-canvas-data";

const values = (input: Parameters<typeof locusLayoutOptions>[0]) => locusLayoutOptions(input).map((option) => option.value);

describe("presentations follow the subject", () => {
  test("strings and booleans offer the generic desktop presentation without geographic layouts", () => {
    expect(values({ type: { $ref: "String" }, value: "text" })).toEqual(["value", "desktop", "code"]);
    expect(values({ type: { $ref: "Boolean" }, value: true })).toEqual(["value", "desktop", "code"]);
  });

  test("a list offers data-free layouts and an explicit canvas derivation", () => {
    expect(values({ type: List({ $ref: "String" }), value: ["a"], canDeriveCanvas: true }))
      .toEqual(["list", "table", "grid", "desktop", "tree", "tabs", "derive-canvas", "code"]);
  });

  test("a root that cannot retain a safe live source does not offer cyclic derivation", () => {
    expect(values({ value: [] })).toEqual(["list", "table", "grid", "desktop", "tree", "tabs", "code"]);
  });

  test("a list offers a table, except where its layout cannot hold one", () => {
    expect(values({ type: List({ $ref: "String" }), value: [] })).toContain("table");
    expect(values({ value: ["a"], canTable: false })).toEqual(["list", "grid", "desktop", "tree", "tabs", "code"]);
  });

  test("a placeAll derivation renders as a canvas, including its known empty result", () => {
    const placement = placementFromItem({ x: 0.2, y: 0.3 });
    expect(values({ value: [{ placement, item: "photo" }], derivedCanvas: true })).toContain("canvas");
    expect(values({ value: [], derivedCanvas: true })).toContain("canvas");
    expect(values({ value: [], derivedCanvas: true })).not.toContain("derive-canvas");
  });

  test("a Calendar is offered only when the Fenel projection placed calendar days", () => {
    const grouping = { $tag: "Just", _0: { $tag: "OrdinaryMap", entries: [{ key: { year: 2024, month: 2, day: 29 }, value: [] }] } };
    expect(values({ value: grouping })).not.toContain("calendar");
    expect(values({ value: grouping, calendar: false })).not.toContain("calendar");
    expect(values({ value: grouping, calendar: true })).toEqual(["list", "grid", "desktop", "tree", "tabs", "calendar", "code"]);
    expect(values({ value: [{ date: "2024-02-29" }] })).not.toContain("calendar");
  });

  test("a decided grouping offers its table, and a chart only when its values are numbers", () => {
    const grouping = { $tag: "Just", _0: { $tag: "OrdinaryMap", entries: [{ key: "Sam", value: 90 }] } };
    expect(values({ value: grouping })).toEqual(["list", "grid", "desktop", "tree", "tabs", "code"]);
    expect(values({ value: grouping, groupingTable: true })).toEqual(["list", "table", "grid", "desktop", "tree", "tabs", "code"]);
    expect(values({ value: grouping, groupingTable: true, chart: true })).toEqual(["list", "table", "grid", "desktop", "tree", "tabs", "chart", "code"]);
    expect(values({ value: grouping, groupingTable: true, canTable: false })).not.toContain("table");
  });

  test("a list that merely holds Placed values is data, not a canvas", () => {
    const placement = placementFromItem({ x: 0.2, y: 0.3 });
    expect(values({ value: [{ placement, item: "photo" }] })).not.toContain("canvas");
    expect(values({ value: [{ placement: { at: { x: 0.1, y: NaN } }, item: "photo" }] }))
      .not.toContain("canvas");
  });

  test("an image's storage fields do not make it a collection presentation", () => {
    const image = { width: 1, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }] };
    expect(values({ type: { $ref: "Image" }, value: image })).toEqual(["value", "desktop", "code"]);
  });

  test("records offer field presentations, without assigning positions or dates", () => {
    // A table is the view of a LIST: one record is not a table of one row.
    expect(values({ value: { name: "A", valid: true }, canDeriveCanvas: true }))
      .toEqual(["list", "grid", "desktop", "tree", "tabs", "code"]);
  });

  test("Code remains available for incomplete and runtime carriers without claiming a codec", () => {
    for (const value of [undefined, new ArrayBuffer(2), { $tag: "Ref", id: "exact-held-identity" }]) {
      expect(values({ value })).toContain("code");
    }
    expect(locusLayoutOption("value")).toEqual({ value: "value", label: "Data", icon: "package" });
  });
});
