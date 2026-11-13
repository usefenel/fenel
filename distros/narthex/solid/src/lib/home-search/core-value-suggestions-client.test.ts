import { describe, expect, test } from "bun:test";
import { createCoreValueSuggestionClient } from "./core-value-suggestions-client";
import type { ValueSuggestion } from "./value-suggestions";

type Result = { coreValueSuggestion: { input: string; suggestions: ValueSuggestion[] } };
class ControlledBorrow {
  nextId = 0;
  disposals = 0;
  readonly requests: Array<{ id: number; input: string }> = [];
  readonly pending = new Map<number, { resolve: (result: Result) => void; reject: (error: unknown) => void; cleanup: () => void }>();
  suggest(input: string, signal?: AbortSignal): Promise<Result> {
    const id = ++this.nextId;
    this.requests.push({ id, input });
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); pending.cleanup(); reject(signal?.reason);
      };
      this.pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  reply(id: number, input: string, suggestions: ValueSuggestion[] = []) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id); pending.cleanup(); pending.resolve({ coreValueSuggestion: { input, suggestions } });
  }
  fail(error: Error) {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }
  dispose() { this.disposals++; this.fail(new Error("The typed choices were closed.")); }
}
function fixture() {
  const lifetime = new AbortController();
  const reader = { signal: lifetime.signal };
  const borrow = new ControlledBorrow();
  const client = createCoreValueSuggestionClient(reader, captured => {
    expect(captured).toBe(reader); return borrow;
  });
  return { lifetime, reader, borrow, client };
}
describe("typed choices borrow their captured reader transport", () => {
  test("query cancellation rejects the old consumer and keeps the shared borrow", async () => {
    const { borrow, client } = fixture(), old = new AbortController();
    const first = client.suggest("15", old.signal).catch(error => error);
    old.abort(new Error("Query changed"));
    const second = client.suggest("15.2");
    borrow.reply(1, "15");
    const rows: ValueSuggestion[] = [{ id: "Number", typeName: "Number", label: "Number", type: { $ref: "exact-system-number" },
      detail: "15.2", score: 1, status: "complete", value: 15.2 }];
    borrow.reply(2, "15.2", rows);
    expect((await first).message).toBe("Query changed");
    expect(await second).toEqual(rows);
    expect(borrow.disposals).toBe(0);
    client.dispose();
  });
  test("a mismatched echoed input cannot answer the current query", async () => {
    const { borrow, client } = fixture();
    const result = client.suggest("true").catch(error => error);
    borrow.reply(1, "false");
    expect((await result).message).toBe("The typed choice query changed.");
    client.dispose();
  });
  test("Browse disposal releases only this borrow once and refuses new requests", async () => {
    const { borrow, client } = fixture();
    const result = client.suggest("15").catch(error => error);
    client.dispose(); client.dispose();
    expect((await result).message).toBe("The typed choices were closed.");
    await expect(client.suggest("16")).rejects.toThrow("closed");
    expect(borrow.disposals).toBe(1);
    expect(borrow.requests).toHaveLength(1);
  });
  test("reader closure releases its consumers and stale completion stays closed", async () => {
    const { borrow, client, lifetime } = fixture();
    const result = client.suggest("15").catch(error => error);
    borrow.reply(1, "15");
    lifetime.abort(new Error("Reader closed"));
    expect((await result).message).toBe("The typed choices were closed.");
    expect(borrow.disposals).toBe(1);
  });
  test("a disposed reader never acquires a physical realm", () => {
    const lifetime = new AbortController(); lifetime.abort(new Error("Already closed"));
    let acquisitions = 0;
    expect(() => createCoreValueSuggestionClient({ signal: lifetime.signal }, () => {
      acquisitions++; return new ControlledBorrow();
    })).toThrow("Already closed");
    expect(acquisitions).toBe(0);
  });
  test("a shared transport failure rejects all outstanding consumers", async () => {
    const { borrow, client } = fixture();
    const first = client.suggest("15").catch(error => error), second = client.suggest("16").catch(error => error);
    borrow.fail(new Error("Worker unavailable"));
    expect((await first).message).toBe("Worker unavailable");
    expect((await second).message).toBe("Worker unavailable");
    client.dispose();
  });
});
