import { describe, expect, mock, test } from "bun:test";

// B4 F2: the page side of the two new closed operations, over a controlled
// worker client: `project-reader-field-names` (one batch per microtask per
// worker snapshot, a malformed or failed answer shows the field's own name,
// a replaced worker asks again) and `judge-reader-compatibility` (an answer
// counts only for its own items, pending is never compatible, a missing
// worker refuses with the existing copy).
const requests: Array<{ handle: unknown; payload: Record<string, unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
let snapshot: object | undefined = { worker: "one" };
let handle: object | undefined = { handle: "one" };
mock.module("./authoring-catalog-worker", () => ({
  authoringWorkerSnapshot: () => snapshot,
  preparedReaderWorkerForSession: () => handle,
  runPreparedReaderWorker: (target: unknown, payload: Record<string, unknown>) => new Promise((resolve, reject) => {
    requests.push({ handle: target, payload, resolve, reject });
  }),
}));
const { localFieldName } = await import("./local-field-names");
const { createLocalPickerCompatibility, LOCAL_PICKER_TOOLS_PENDING } = await import("./local-picker-compatibility");
const { createRoot, createSignal, flush } = await import("solid-js");
const settle = async () => { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } };
const local = { kind: "local" as const, revision: () => 1 };
const session = {} as never;

describe("B4 F2: Local parameter names from the worker", () => {
  test("one batched guidance request per snapshot; answers are cached; a failure shows the field's own name", async () => {
    requests.length = 0;
    expect(localFieldName(local, session, "a")).toBeUndefined();
    expect(localFieldName(local, session, "b")).toBeUndefined();
    expect(localFieldName(local, session, "a")).toBeUndefined();
    await settle();
    expect(requests.map(row => row.payload)).toEqual([{ method: "project-reader-field-names", fieldIds: ["a", "b"], priority: "guidance" }]);
    requests[0]!.resolve({ fieldNames: [{ label: "Amount" }, { unavailable: true }] });
    await settle();
    expect(localFieldName(local, session, "a")).toEqual({ label: "Amount" });
    expect(localFieldName(local, session, "b")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(1);
    // A malformed answer is a failure for its ids.
    expect(localFieldName(local, session, "c")).toBeUndefined();
    await settle();
    requests[1]!.resolve({ fieldNames: [{ label: 3 }] });
    await settle();
    expect(localFieldName(local, session, "c")).toBeUndefined();
    // A replaced worker has its own cache and asks again.
    snapshot = { worker: "two" };
    expect(localFieldName(local, session, "a")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(3);
    expect(requests[2]!.payload.fieldIds).toEqual(["a"]);
    // Account readers never ask.
    expect(localFieldName({ kind: "account", revision: () => 1 }, session, "z")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(3);
  });
});

describe("B4 F2 fix round: Local parameter names follow the reader's capture", () => {
  test("a failed name is asked again after a revision; a new revision re-asks answered names", async () => {
    requests.length = 0;
    snapshot = { worker: "three" };
    let revision = 1;
    const reader = { kind: "local" as const, revision: () => revision };
    expect(localFieldName(reader, session, "x")).toBeUndefined();
    await settle();
    requests[0]!.reject(new Error("worker closed"));
    await settle();
    expect(localFieldName(reader, session, "x")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(1);
    revision = 2;
    expect(localFieldName(reader, session, "x")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(2);
    requests[1]!.resolve({ fieldNames: [{ codeName: "x" }] });
    await settle();
    expect(localFieldName(reader, session, "x")).toEqual({ codeName: "x" });
    revision = 3;
    expect(localFieldName(reader, session, "x")).toBeUndefined();
    await settle();
    expect(requests).toHaveLength(3);
  });
});

describe("B4 F2: Local picker compatibility from the worker", () => {
  test("an answer counts only for its own items; pending is not an answer; a missing worker refuses", async () => {
    requests.length = 0;
    const scheme = (body: unknown) => ({ scheme: { quantified: [], body }, expected: { $ref: "Number" } }) as never;
    const [items, setItems] = createSignal([scheme({ $ref: "Number" })]);
    const { api, dispose } = createRoot(dispose => ({ dispose, api: createLocalPickerCompatibility(() => local, () => session, () => items()) }));
    api.verdicts();
    await settle();
    expect(requests.map(row => row.payload)).toEqual([{ method: "judge-reader-compatibility", items: items() }]);
    expect(api.verdicts()).toBeUndefined();
    expect(api.pending()).toBe(true);
    setItems([scheme({ $ref: "String" })]);
    await settle();
    // The older answer arrives after the list changed: not shown.
    requests[0]!.resolve({ verdicts: [{ compatibility: "compatible" }] });
    await settle();
    expect(api.verdicts()).toBeUndefined();
    requests[1]!.resolve({ verdicts: [{ compatibility: "incompatible" }] });
    await settle();
    expect(api.verdicts()).toEqual([{ compatibility: "incompatible" }]);
    // A malformed answer refuses with copy.
    setItems([scheme({ $ref: "Bool" })]);
    await settle();
    requests[2]!.resolve({ verdicts: [{ compatibility: "yes" }] });
    await settle();
    expect(api.verdicts()).toBeUndefined();
    expect(api.error()).toBe("This picker's choices could not be checked.");
    // No prepared worker: the existing not-ready copy, nothing sent.
    handle = undefined;
    setItems([scheme({ $ref: "Text" })]);
    await settle();
    expect(requests).toHaveLength(3);
    expect(api.error()).toBe(LOCAL_PICKER_TOOLS_PENDING);
    dispose();
    handle = { handle: "one" };
  });
});
