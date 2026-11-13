// A21 (Nov 12): the reader presentation marks a label that came from a Labelable instance (authored) so a type named
// "Transaction" in the app (label "Transaction", derived code name "Transaction") reads as a label. Uses the engine's
// projection body (no registry); about 20 s cold.
//   bun test --timeout 120000 ./distros/narthex/solid/src/lib/reader-presentation-authored.test.ts
import { describe, expect, test } from "bun:test";
import { ownPresentationFromReaderSnapshot } from "./reader-presentation";
import { presentedDisplayName } from "./display-name";

describe("the reader presentation's label provenance", () => {
  test("a Labelable instance equal to the code name is an authored label", () => {
    const own = ownPresentationFromReaderSnapshot(undefined, new Map<string, Record<string, unknown>>([
      ["Labelable", { label: { en: "Transaction" } }], ["Codeable", { codeName: "Transaction" }]]), undefined);
    expect(own.labelAuthored).toBe(true);
    expect(presentedDisplayName(own)).toEqual({ text: "Transaction", code: false });
  }, 120000);

  test("no Labelable instance: no authored label, the code name in the code face", () => {
    const own = ownPresentationFromReaderSnapshot(undefined, new Map<string, Record<string, unknown>>([
      ["Codeable", { codeName: "Transaction" }]]), undefined);
    expect(own.labelAuthored).toBeUndefined();
    expect(presentedDisplayName(own)).toEqual({ text: "Transaction", code: true });
  }, 120000);
});
