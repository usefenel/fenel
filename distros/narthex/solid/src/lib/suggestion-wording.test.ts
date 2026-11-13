import { describe, expect, test } from "bun:test";
import { sentenceRepeatsLabel } from "./suggestion-wording";

describe("a suggestion's sentence is shown only when it adds to the title", () => {
  test("a sentence that repeats the title, with or without its subject, is a repeat", () => {
    expect(sentenceRepeatsLabel("grouped by date", "Group by date")).toBe(true);
    expect(sentenceRepeatsLabel("Items grouped by date", "Group by date")).toBe(true);
    expect(sentenceRepeatsLabel("Transactions grouped by person", "Group by person")).toBe(true);
    expect(sentenceRepeatsLabel("Reversed", "Reverse")).toBe(true);
    expect(sentenceRepeatsLabel("Sorted ascending", "Sort ascending")).toBe(true);
  });

  test("a sentence that says what the title does not is kept", () => {
    expect(sentenceRepeatsLabel("Sum of amount per person", "Sum by key")).toBe(false);
    expect(sentenceRepeatsLabel("Number of transactions per person", "Count by person")).toBe(false);
    expect(sentenceRepeatsLabel("Transactions grouped by the person's name", "Group by person")).toBe(false);
    expect(sentenceRepeatsLabel("grouped by date", "Group by amount")).toBe(false);
  });

  test("an empty side never counts as a repeat", () => {
    expect(sentenceRepeatsLabel("", "Group by date")).toBe(false);
    expect(sentenceRepeatsLabel("grouped by date", "")).toBe(false);
  });
});
