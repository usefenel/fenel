import { expect, test } from "bun:test";
import { createViewPersistence } from "./home-view-persistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("edits queued behind an in-flight save use its acknowledged version", async () => {
  const started = deferred<void>();
  const first = deferred<{ version: number }>();
  const writes: { values: number[]; version: number | undefined }[] = [];
  const queue = createViewPersistence<number[]>({
    delay: 60_000, changed: () => {}, version: () => 7,
    write: async (_id, values, version) => {
      writes.push({ values, version });
      if (writes.length === 1) { started.resolve(); return first.promise; }
      return { version: 9 };
    },
    writtenVersion: (result) => (result as { version: number }).version,
    refresh: async () => {},
  });
  queue.update("list", [1]);
  const saving = queue.flush("list");
  await started.promise;
  expect(queue.discard("list")).toBe(false);
  queue.update("list", [1, 2]);
  first.resolve({ version: 8 });
  expect(await saving).toBe(true);
  expect(writes).toEqual([{ values: [1], version: 7 }, { values: [1, 2], version: 8 }]);
  expect(queue.status()).toEqual([]);
});

test("a conflicting save preserves the local draft and its original baseline across refresh and retry", async () => {
  let serverVersion = 3;
  const versions: (number | undefined)[] = [];
  const queue = createViewPersistence<string[]>({
    delay: 60_000, changed: () => {}, version: () => serverVersion,
    write: async (_id, _values, version) => {
      versions.push(version);
      throw new Error("Your data changed in another session.");
    },
    refresh: async () => {},
  });
  queue.update("list", ["my edit"]);
  serverVersion = 4;
  expect(await queue.flush("list")).toBe(false);
  expect(queue.read("list", ["someone else's edit"])).toEqual(["my edit"]);
  expect(queue.status()[0]!.error).toContain("another session");
  expect(await queue.flush("list")).toBe(false);
  expect(versions).toEqual([3, 3]);
  expect(queue.discard("list")).toBe(true);
  expect(queue.read("list", ["someone else's edit"])).toEqual(["someone else's edit"]);
  expect(queue.status()).toEqual([]);
});
