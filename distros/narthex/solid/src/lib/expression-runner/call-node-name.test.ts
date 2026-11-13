// Nov 12 (Rom, on the solve example's graph: "solve is a human readable label, not just a codable name"). A call
// node shows the function's label and a constructor's own Labelable (keyed by its tag, the lookup its glyph and read
// card use); a code name is shown as written, in the code face, only when there is no label. No registry.
//   bun test ./distros/narthex/solid/src/lib/expression-runner/call-node-name.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { callNodeDisplayName, constructorCallLabel } from "./call-node-name";

const solve = { id: "SolverDemo:solve", codeName: "solve", label: "Solve", kind: "function" };
const unlabelled = { id: "SolverDemo:helper", codeName: "helper", label: "helper", kind: "function" };
const allNumbers = { id: "AllNumbers", codeName: "AllNumbers", label: "AllNumbers", kind: "constructor",
  parentEntity: "SolveDomain", targetId: "@ctor/SolverDemo/SolveDomain/AllNumbers" };
const labels = (table: Record<string, string>) => {
  const seen: unknown[] = [];
  return { seen, name: (value: unknown) => { seen.push(value); return table[(value as { $tag: string }).$tag]; } };
};

describe("a call node's shown name", () => {
  test("a function shows its label as text", () => {
    expect(callNodeDisplayName(solve, solve.id, labels({}))).toEqual({ text: "Solve", code: false });
  });

  test("a function without a label shows its code name in the code face", () => {
    expect(callNodeDisplayName(unlabelled, unlabelled.id, labels({}))).toEqual({ text: "helper", code: true });
  });

  test("a call with no catalogue entry shows the written handle as code", () => {
    expect(callNodeDisplayName(undefined, "SolverDemo:solve", labels({}))).toEqual({ text: "solve", code: true });
  });

  test("a constructor shows its own label, asked by its bare tag", () => {
    const reader = labels({ AllNumbers: "All numbers" });
    expect(callNodeDisplayName(allNumbers, allNumbers.targetId, reader)).toEqual({ text: "All numbers", code: false });
    expect(reader.seen).toEqual([{ $tag: "AllNumbers" }]);
  });

  test("a constructor without a label (or whose label is its tag) stays its code name", () => {
    expect(callNodeDisplayName(allNumbers, allNumbers.targetId, labels({}))).toEqual({ text: "AllNumbers", code: true });
    expect(callNodeDisplayName(allNumbers, allNumbers.targetId, labels({ AllNumbers: "AllNumbers" }))).toEqual({ text: "AllNumbers", code: true });
    expect(callNodeDisplayName(allNumbers, allNumbers.targetId, undefined)).toEqual({ text: "AllNumbers", code: true });
  });

  test("a reader that fails names nothing; a function never asks the constructor lookup", () => {
    expect(constructorCallLabel(allNumbers, { name: () => { throw new Error("no frame"); } })).toBeUndefined();
    const reader = labels({ solve: "Wrong" });
    expect(callNodeDisplayName(solve, solve.id, reader)).toEqual({ text: "Solve", code: false });
    expect(reader.seen).toEqual([]);
  });

  test("the same bare value is asked for each render (a Local reader keys its packets by identity)", () => {
    const reader = labels({ AllNumbers: "All numbers" });
    callNodeDisplayName(allNumbers, allNumbers.targetId, reader);
    callNodeDisplayName(allNumbers, allNumbers.targetId, reader);
    expect(reader.seen[0]).toBe(reader.seen[1]);
  });

  test("both call node surfaces of the editor use it", async () => {
    const editor = (await readFile(new URL("./index.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    expect(editor.match(/<DisplayNameText name=\{callNodeDisplayName\(entry\(\), props\.node\.fnId, items\)\} \/>/g)).toHaveLength(2);
    expect(editor).not.toContain("<DisplayNameText name={entry() ? functionDisplayName(entry()!) : codeName(fnCodeName(props.node.fnId))} />");
  });
});
