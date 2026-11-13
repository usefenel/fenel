import { expect, test } from "bun:test";
import { addressInspectionPanels } from "./address-panels";

test("an address opens the panels it names, in the panels' order, and ignores anything else", () => {
  expect(addressInspectionPanels("?panels=dependencies")).toEqual(["dependencies"]);
  expect(addressInspectionPanels("?panels=Dependencies,data")).toEqual(["data", "dependencies"]);
  expect(addressInspectionPanels("?x=1&panels=code")).toEqual(["code"]);
  expect(addressInspectionPanels("?panels=graph")).toBeUndefined();
  expect(addressInspectionPanels("?panels=")).toBeUndefined();
  expect(addressInspectionPanels("")).toBeUndefined();
});
