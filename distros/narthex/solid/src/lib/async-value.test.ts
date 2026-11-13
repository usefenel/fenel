// Run with --conditions=browser --conditions=development for staged writes.
import { expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush, isPending } from "solid-js";
import { createAsyncValue } from "./async-value";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flush();
}

test("manual refetch reports loading and awaits committed data", async () => {
  let request = deferred<string>();
  const { value, dispose } = createRoot((dispose) => ({
    value: createAsyncValue(() => true, () => request.promise), dispose,
  }));
  try {
    expect(value.loading).toBe(true);
    request.resolve("first");
    await settle();
    expect(value()).toBe("first");
    expect(value.loading).toBe(false);

    request = deferred<string>();
    let finished = false;
    const refetch = value.refetch().then(() => { finished = true; });
    await settle();
    expect(value.loading).toBe(true);
    expect(value()).toBe("first");
    expect(finished).toBe(false);

    request.resolve("second");
    await refetch;
    expect(value()).toBe("second");
    expect(value.loading).toBe(false);

    request = deferred<string>();
    const failed = value.refetch();
    await settle();
    expect(value.loading).toBe(true);
    const error = new Error("offline");
    request.reject(error);
    await failed;
    expect(value.error).toBe(error);
    expect(value()).toBeUndefined();
    expect(value.loading).toBe(false);
  } finally { dispose(); }
});

test("synchronous fetcher failures stay inline and retain reactive dependencies", async () => {
  const failure = new Error("invalid options");
  const { value, setName, dispose } = createRoot((dispose) => {
    const [name, setName] = createSignal("invalid");
    return {
      value: createAsyncValue(() => true, () => {
        const current = name();
        if (current === "invalid") throw failure;
        return current;
      }), setName, dispose,
    };
  });
  try {
    expect(value()).toBeUndefined();
    expect(value.error).toBe(failure);
    expect(value.loading).toBe(false);
    setName("recovered");
    await settle();
    expect(value()).toBe("recovered");
    expect(value.error).toBeUndefined();
    setName("changed again");
    await settle();
    expect(value()).toBe("changed again");
  } finally { dispose(); }
});

test("overlapping refreshes keep loading until the newest result commits", async () => {
  const older = deferred<string>();
  const newer = deferred<string>();
  let calls = 0;
  const { value, dispose } = createRoot((dispose) => ({
    value: createAsyncValue(() => true, () => {
      calls++;
      return calls === 1 ? "initial" : calls === 2 ? older.promise : newer.promise;
    }), dispose,
  }));
  try {
    await settle();
    expect(value()).toBe("initial");
    const first = value.refetch();
    await settle();
    const second = value.refetch();
    await settle();
    expect(calls).toBe(3);
    expect(value.loading).toBe(true);
    older.resolve("superseded");
    await settle();
    expect(value.loading).toBe(true);
    expect(value()).toBe("initial");
    newer.resolve("current");
    await Promise.all([first, second]);
    expect(value()).toBe("current");
    expect(value.loading).toBe(false);
  } finally { dispose(); }
});

test("source changes discard older requests and a disabled source does not fetch", async () => {
  const old = deferred<string>();
  const next = deferred<string>();
  const calls: string[] = [];
  const { value, setSource, dispose } = createRoot((dispose) => {
    const [source, setSource] = createSignal<string | null>(null);
    return {
      value: createAsyncValue(source, (key) => {
        calls.push(key);
        return key === "old" ? old.promise : next.promise;
      }), setSource, dispose,
    };
  });
  try {
    expect(value()).toBeUndefined();
    expect(value.loading).toBe(false);
    setSource("old");
    await settle();
    setSource("next");
    await settle();
    next.resolve("current");
    await settle();
    old.resolve("stale");
    await settle();
    expect(value()).toBe("current");
    expect(calls).toEqual(["old", "next"]);
    setSource(null);
    await settle();
    expect(value()).toBeUndefined();
    expect(value.loading).toBe(false);
    expect(calls).toEqual(["old", "next"]);
  } finally { dispose(); }
});

// Demo 1 (2026-11-08): a Local field plan nested in a record editor re-plans on
// every sibling edit. With held flights, Solid rc.7 parked such a transition
// for good after every worker answer had landed: the CalendarDate parts stayed
// "Preparing" with blocked inputs. A non-holding read starts each flight fresh.
test("holdTransitions false: a later change holds no transition and keeps the last answer readable", async () => {
  const answers = { a: deferred<string>(), b: deferred<string>() };
  const { value, derived, setKey, dispose } = createRoot((dispose) => {
    const [key, setKey] = createSignal<"a" | "b">("a");
    const value = createAsyncValue(key, (current) => answers[current].promise, { holdTransitions: false });
    const derived = createMemo(() => ({ loading: value.loading, shown: value() }));
    return { value, derived, setKey, dispose };
  });
  try {
    expect(value.loading).toBe(true);
    answers.a.resolve("A");
    await settle();
    expect(derived()).toEqual({ loading: false, shown: "A" });
    setKey("b");
    await settle();
    // The later flight is visible as loading, with the last answer, and nothing
    // downstream waits on a held transition.
    expect(isPending(derived)).toBe(false);
    expect(derived()).toEqual({ loading: true, shown: "A" });
    answers.b.resolve("B");
    await settle();
    expect(isPending(derived)).toBe(false);
    expect(derived()).toEqual({ loading: false, shown: "B" });
  } finally { dispose(); }
});

test("holdTransitions false: refetch and failures keep the inline three-state read", async () => {
  let request = deferred<string>();
  const { value, dispose } = createRoot((dispose) => ({
    value: createAsyncValue(() => true, () => request.promise, { holdTransitions: false }), dispose,
  }));
  try {
    request.resolve("first");
    await settle();
    expect(value()).toBe("first");
    request = deferred<string>();
    const refetch = value.refetch();
    await settle();
    expect(value.loading).toBe(true);
    expect(value()).toBe("first");
    const error = new Error("offline");
    request.reject(error);
    await refetch;
    await settle();
    expect(value.error).toBe(error);
    expect(value()).toBeUndefined();
    expect(value.loading).toBe(false);
  } finally { dispose(); }
});
