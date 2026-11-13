import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { viewModule } from "./view";
import { applyLocusCommands, type LocusCommand, type LocusEntry, type LocusCommandResult } from "../authoring/locus-commands";

const context = createRegistry([stdModule, pictureModule, viewModule]).evaluateContext();
const entries: LocusEntry<unknown>[] = [
  { id: "a", value: { kind: "call", fnId: "never:evaluate-me", args: [] } },
  { id: "b", value: { kind: "ref", savedExprId: "same-asset" } },
];
function commands(values: readonly LocusEntry<unknown>[], edits: LocusCommand<unknown>[]): LocusCommandResult<unknown> {
  return evaluate({ call: ["view:applyLocusCommands", { var: "entries" }, { var: "commands" }] },
    { entries: values, commands: edits }, context) as LocusCommandResult<unknown>;
}
const ok = (value: LocusEntry<unknown>[]): { $tag: "Ok"; _0: LocusEntry<unknown>[] } => ({ $tag: "Ok", _0: value });

describe("Fenel identified-list commands", () => {
  test("append retains expressions and references without evaluating their payloads", () => {
    const entry = { id: "c", value: { bytes: Uint8Array.of(3, 7), bound: Infinity } };
    expect(commands(entries, [{ $tag: "LocusAppend", entry }])).toEqual(ok([...entries, entry]));
    expect(entries).toHaveLength(2);
  });

  test("replacement preserves identity and every unrelated value", () => {
    const replacement = { id: "a", value: "edited" };
    expect(commands(entries, [{ $tag: "LocusReplace", id: "a", entry: replacement }])).toEqual(ok([replacement, entries[1]!]));
    expect(commands(entries, [{ $tag: "LocusReplace", id: "a", entry: { id: "different", value: 0 } }]))
      .toEqual({ $tag: "Err", _0: "An edit cannot change a value's identity." });
  });

  test("remove refuses a missing value and does not mutate its input", () => {
    expect(commands(entries, [{ $tag: "LocusRemove", id: "a" }])).toEqual(ok([entries[1]!]));
    expect(commands(entries, [{ $tag: "LocusRemove", id: "missing" }]))
      .toEqual({ $tag: "Err", _0: "This value is no longer in the root list." });
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("reorder moves complete identified values together", () => {
    expect(commands(entries, [{ $tag: "LocusReorder", ids: ["b", "a"] }])).toEqual(ok([entries[1]!, entries[0]!]));
    for (const ids of [["a"], ["a", "a"], ["a", "b", "c"], ["a", "unknown"]]) {
      expect(commands(entries, [{ $tag: "LocusReorder", ids }]).$tag).toBe("Err");
    }
  });

  test("identities are validated on both the source and every insertion", () => {
    for (const source of [[entries[0]!, entries[0]!], [{ id: "", value: "invalid" }]]) {
      expect(commands(source, []).$tag).toBe("Err");
    }
    for (const entry of [entries[0]!, { id: "", value: "invalid" }]) {
      expect(commands(entries, [{ $tag: "LocusAppend", entry }]).$tag).toBe("Err");
    }
    expect(commands(entries, [])).toEqual(ok(entries));
  });

  test("a command with an unknown tag fails as an Err, never as a missing result", () => {
    const unknown = { $tag: "LocusRename", id: "a" } as unknown as LocusCommand<unknown>;
    expect(commands(entries, [unknown])).toEqual({ $tag: "Err", _0: "This list edit is not recognized." });
    expect(commands(entries, [{ $tag: "LocusRemove", id: "a" }, unknown]).$tag).toBe("Err");
  });

  test("a grouped move succeeds together, and a later failure returns no partial list", () => {
    const appended = { id: "c", value: { kind: "ref", savedExprId: "same-asset" } };
    expect(commands(entries, [{ $tag: "LocusAppend", entry: appended }, { $tag: "LocusRemove", id: "b" }]))
      .toEqual(ok([entries[0]!, appended]));
    expect(commands(entries, [{ $tag: "LocusRemove", id: "a" }, { $tag: "LocusAppend", entry: entries[1]! },
      { $tag: "LocusRemove", id: "b" }])).toEqual({ $tag: "Err", _0: "This value identity already exists." });
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("the persistence bridge executes the same registered Fenel command body", () => {
    expect(applyLocusCommands(entries, [{ $tag: "LocusReorder", ids: ["b", "a"] }])).toEqual(ok([entries[1]!, entries[0]!]));
  }, 120_000);
});
