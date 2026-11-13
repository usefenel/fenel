import { describe, expect, test } from "bun:test";
import { createFieldPublishGate } from "./field-publish-gate";

// Launch night (Nov 13): a date part typed in a Local form was decoded by the
// reader's worker after its field plan had moved on (or before it was ready
// again), and the field's publish gate dropped it: the input showed 2026 while
// the draft held nothing ("Enter the date." under a filled date).
type Binding = { id: number; field: string; owner: string };

function harness() {
  const published: Array<[number, unknown]> = [];
  let newest: Binding | undefined;
  let ready = true;
  const gate = createFieldPublishGate<Binding>({
    current: () => newest,
    canPublish: (binding) => binding === newest && ready,
    sameField: (left, right) => left.field === right.field && left.owner === right.owner,
    publish: (binding, value) => { published.push([binding.id, value]); },
  });
  return {
    gate, published,
    bind: (binding: Binding) => { newest = binding; },
    setReady: (value: boolean) => { ready = value; },
  };
}

describe("a value typed into a field reaches its draft", () => {
  test("published at once through the current, ready binding", () => {
    const h = harness();
    const b1 = { id: 1, field: "year", owner: "w" };
    h.bind(b1);
    expect(h.gate.send(b1, 2026)).toBe("published");
    expect(h.published).toEqual([[1, 2026]]);
  });

  test("a value published while the plan is not ready is delivered when it becomes ready", () => {
    const h = harness();
    const b1 = { id: 1, field: "year", owner: "w" };
    h.bind(b1); h.setReady(false);
    expect(h.gate.send(b1, 2026)).toBe("held");
    expect(h.published).toEqual([]);
    expect(h.gate.flush()).toBe("waiting");
    h.setReady(true);
    expect(h.gate.flush()).toBe("published");
    expect(h.published).toEqual([[1, 2026]]);
    expect(h.gate.flush()).toBe("empty");
  });

  test("a value published through a superseded binding of the same field goes to the newest one", () => {
    const h = harness();
    const b1 = { id: 1, field: "month", owner: "w" };
    const b2 = { id: 2, field: "month", owner: "w" };
    h.bind(b1); h.bind(b2);
    expect(h.gate.send(b1, 11)).toBe("published");
    expect(h.published).toEqual([[2, 11]]);
    // ...and waits for it when the newest binding is still preparing.
    const b3 = { id: 3, field: "month", owner: "w" };
    h.bind(b3); h.setReady(false);
    expect(h.gate.send(b2, 12)).toBe("held");
    h.setReady(true);
    expect(h.gate.flush()).toBe("published");
    expect(h.published).toEqual([[2, 11], [3, 12]]);
  });

  test("the latest value wins and nothing is published out of order", () => {
    const h = harness();
    const b1 = { id: 1, field: "day", owner: "w" };
    h.bind(b1); h.setReady(false);
    h.gate.send(b1, 1);
    h.gate.send(b1, 13);
    h.setReady(true);
    h.gate.flush();
    expect(h.published).toEqual([[1, 13]]);
    // A held value never follows a newer direct publication.
    h.setReady(false); h.gate.send(b1, 7);
    h.setReady(true); h.gate.send(b1, 8);
    expect(h.gate.flush()).toBe("empty");
    expect(h.published).toEqual([[1, 13], [1, 8]]);
  });

  test("a value of a different field or owner is never delivered elsewhere", () => {
    const h = harness();
    const year = { id: 1, field: "year", owner: "w" };
    const replaced = { id: 2, field: "year", owner: "other worker" };
    h.bind(year);
    h.bind(replaced);
    expect(h.gate.send(year, 2026)).toBe("dropped");
    const month = { id: 3, field: "month", owner: "w" };
    h.bind(year); h.setReady(false);
    expect(h.gate.send(year, 2026)).toBe("held");
    h.bind(month); h.setReady(true);
    expect(h.gate.flush()).toBe("dropped");
    expect(h.published).toEqual([]);
  });

  test("a value sent before any editor of the field was shown is not held", () => {
    const h = harness();
    const b1 = { id: 1, field: "year", owner: "w" };
    h.bind(b1); h.setReady(false);
    expect(h.gate.send(b1, 2026, false)).toBe("dropped");
    h.setReady(true);
    expect(h.gate.flush()).toBe("empty");
    expect(h.published).toEqual([]);
  });
});
